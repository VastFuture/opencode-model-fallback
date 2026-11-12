import { expect, test, mock } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "./index"

for (const activity of ["session.text.delta", "session.reasoning.delta", "session.tool.called", "session.tool.success"]) {
	test(`V2 ${activity} prevents successful fallback from replaying old prompts`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "fallback-v2-events-"))
		await mkdir(join(directory, ".opencode"))
		await writeFile(join(directory, ".opencode/opencode-fallback.json"), JSON.stringify({
			fallback_models: ["test/primary", "test/backup", "test/last"],
			timeout_seconds: 0.05,
		}))
		const sessionID = `ses_${activity}`
		const prompt = mock(async (_input: unknown) => {})
		const synthetic = mock(async (_input: unknown) => {})
		const interrupt = mock(async () => {})
		const switchModel = mock(async (_input: unknown) => {})
		let finishEvents!: () => void
		const eventsDone = new Promise<void>((resolve) => { finishEvents = resolve })
		const events = [
			{ type: "session.retry.scheduled", data: {
				sessionID, assistantMessageID: "msg_failed", attempt: 1,
				at: Date.now() + 60_000, error: { message: "Rate limited", statusCode: 429 },
			} },
			{ type: activity, data: { sessionID, assistantMessageID: "msg_backup", delta: "ok" } },
			{ type: "session.execution.succeeded", data: { sessionID } },
		]
		let cleanup: (() => void) | void
		const agent: { id: string; model?: { providerID: string; id: string } } = { id: "build" }
		try {
			cleanup = await plugin.setup({
				location: { directory },
				options: {},
				agent: { transform: async (transform: any) => {
					transform({ list: () => [agent] })
					// OpenCode applies its config transform after plugin transforms.
					agent.model = { providerID: "test", id: "primary" }
				} },
				session: {
					hook: async () => {},
					get: async () => ({ agent: "build", model: { providerID: "test", id: "primary" } }),
					context: async () => ["aaaa", "bbbb", "cccc"].map((text, i) => ({
						id: `msg_${i}`, type: "user", text, time: { created: i },
					})),
					interrupt,
					switchModel,
					switchAgent: async () => {},
					prompt,
					synthetic,
				},
				tool: { hook: async () => {} },
				event: { subscribe: async function* () {
					try { yield* events } finally { finishEvents() }
				} },
			} as any) as (() => void) | void
			await eventsDone
			expect(prompt).not.toHaveBeenCalled()
			expect(synthetic).toHaveBeenCalledTimes(1)
			expect(synthetic.mock.calls[0]?.[0]).toEqual({ sessionID, text: "", delivery: "steer" })
			expect(switchModel.mock.calls[0]?.[0]).toMatchObject({ model: { providerID: "test", id: "backup" } })
			await Bun.sleep(350)
			expect(prompt).not.toHaveBeenCalled()
			expect(synthetic).toHaveBeenCalledTimes(1)
			expect(interrupt).toHaveBeenCalledTimes(1)
		} finally {
			cleanup?.()
			await rm(directory, { recursive: true, force: true })
		}
	})
}

// 2026-11-12 incident: one provider retry event reached several plugin instances
// (re-setup without teardown / several locations), and each one enqueued its own
// empty synthetic resume message -> "message content cannot be empty" HTTP 400.
async function runRetryThroughInstances(directories: string[]) {
	const sessionID = `ses_dup_${crypto.randomUUID()}`
	const synthetic = mock(async (_input: unknown) => {})
	const interrupt = mock(async () => {})
	const switchModel = mock(async (_input: unknown) => {})
	const cleanups: Array<(() => void) | void> = []
	const dones: Promise<void>[] = []
	for (const directory of directories) {
		let finish!: () => void
		dones.push(new Promise<void>((resolve) => { finish = resolve }))
		const agent: { id: string; model?: { providerID: string; id: string } } = { id: "build" }
		const events = [{ type: "session.retry.scheduled", data: {
			sessionID, assistantMessageID: "msg_failed", attempt: 1,
			at: Date.now() + 60_000, error: { message: "Rate limited", statusCode: 429 },
		} }]
		cleanups.push(await plugin.setup({
			location: { directory },
			options: {},
			agent: { transform: async (transform: any) => {
				transform({ list: () => [agent] })
				agent.model = { providerID: "test", id: "primary" }
			} },
			session: {
				hook: async () => {},
				get: async () => ({ agent: "build", model: { providerID: "test", id: "primary" } }),
				context: async () => [{ id: "msg_0", type: "user", text: "hello", time: { created: 0 } }],
				interrupt, switchModel, switchAgent: async () => {}, prompt: async () => {}, synthetic,
			},
			tool: { hook: async () => {} },
			event: { subscribe: async function* () { try { yield* events } finally { finish() } } },
		} as any) as (() => void) | void)
	}
	await Promise.all(dones)
	await Bun.sleep(400)
	cleanups.forEach((cleanup) => cleanup?.())
	return { synthetic, switchModel }
}

async function fallbackDirectory() {
	const directory = await mkdtemp(join(tmpdir(), "fallback-v2-dup-"))
	await mkdir(join(directory, ".opencode"))
	await writeFile(join(directory, ".opencode/opencode-fallback.json"), JSON.stringify({
		fallback_models: ["test/primary", "test/backup", "test/last"],
		timeout_seconds: 0,
	}))
	return directory
}

test("V2 re-setup for the same location does not leave a duplicate subscriber replaying", async () => {
	const directory = await fallbackDirectory()
	try {
		const { synthetic } = await runRetryThroughInstances([directory, directory])
		expect(synthetic).toHaveBeenCalledTimes(1)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test("V2 one retry seen by instances of different locations enqueues a single resume for the session", async () => {
	const a = await fallbackDirectory()
	const b = await fallbackDirectory()
	try {
		const { synthetic } = await runRetryThroughInstances([a, b])
		expect(synthetic).toHaveBeenCalledTimes(1)
	} finally {
		await rm(a, { recursive: true, force: true })
		await rm(b, { recursive: true, force: true })
	}
})
