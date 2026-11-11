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
		const sessionID = "ses_001"
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
