import type {
	PluginContext,
	ChatMessageInput,
	ChatMessageOutput,
} from "./types"
import { Plugin } from "@opencode/plugin"
import type { FallbackPluginConfig } from "./types"
import createServerHooks from "./v1"
import { logInfo } from "./logger"

function normalizeV2Event(event: { type: string; data?: unknown }) {
	const data = event.data as Record<string, unknown> | undefined
	switch (event.type) {
		case "session.text.delta":
		case "session.text.ended":
		case "session.reasoning.delta":
		case "session.reasoning.ended":
		case "session.tool.called":
		case "session.tool.progress":
		case "session.tool.success":
			return { type: "message.part.delta", properties: data }
		case "session.execution.succeeded":
			return { type: "session.idle", properties: data }
	}
	if (event.type === "session.execution.failed") {
		return { type: "session.error", properties: data }
	}
	if (event.type === "session.retry.scheduled") {
		const error = data?.error as Record<string, unknown> | undefined
		return {
			type: "session.status",
			properties: {
				sessionID: data?.sessionID,
				status: {
					type: "retry",
					attempt: data?.attempt,
					next: data?.at,
					message: error?.message,
				},
			},
		}
	}
	if (event.type === "session.message.content.updated") {
		return {
			type: "message.updated",
			properties: {
				info: { sessionID: data?.sessionID, id: data?.messageID, role: "assistant" },
				parts: data?.content,
			},
		}
	}
	if (event.type === "session.compaction.ended") {
		return { type: "session.compacted", properties: data }
	}
	return { type: event.type, properties: data }
}

function toLegacyMessage(message: Record<string, any>) {
	if (message.info) return message
	const model = message.model
	return {
		info: {
			id: message.id,
			sessionID: message.sessionID,
			role: message.type,
			agent: message.agent,
			model: model ? `${model.providerID}/${model.id}` : undefined,
			providerID: model?.providerID,
			modelID: model?.id,
			error: message.error,
			parts: message.content,
		},
		parts: message.type === "assistant"
			? (message.content ?? [])
			: [{ type: "text", text: message.text ?? "" }],
	}
}

function createV2Adapter(ctx: Plugin.Context): PluginContext {
	const directory = ctx.location.directory
	const session = {
		get: async ({ path }: any) => ({ data: await ctx.session.get({ sessionID: path.id }) }),
		messages: async ({ path }: any) => ({
			data: (await ctx.session.context({ sessionID: path.id })).map((message: any) => toLegacyMessage(message)),
		}),
		abort: async ({ path }: any) => ctx.session.interrupt({ sessionID: path.id }),
		promptAsync: async ({ path, body }: any) => {
			if (body.model) {
				await ctx.session.switchModel({
					sessionID: path.id,
					model: { providerID: body.model.providerID, id: body.model.modelID },
				})
			}
			if (body.agent) {
				await ctx.session.switchAgent({ sessionID: path.id, agent: body.agent })
			}
			// Resume existing context; queued input may be newer than its last user message.
			await ctx.session.synthetic({ sessionID: path.id, text: "", delivery: "steer" })
		},
		summarize: async ({ path, body }: any) => {
			if (body?.providerID && body?.modelID) {
				await ctx.session.switchModel({
					sessionID: path.id,
					model: { providerID: body.providerID, id: body.modelID },
				})
			}
			return ctx.session.compact({ sessionID: path.id, delivery: "queue" })
		},
	}

	return {
		directory,
		client: {
			session,
			tui: { showToast: async () => undefined },
		} as any,
	} as PluginContext
}

async function setupV2(ctx: Plugin.Context) {
	const adapter = createV2Adapter(ctx)
	const hooks = await createServerHooks(adapter, ctx.options as Partial<FallbackPluginConfig>)

	await ctx.agent.transform((editor) => {
		const agents: Record<string, unknown> = {}
		for (const agent of editor.list()) {
			agents[String(agent.id)] = {
				...agent,
				// OpenCode's config transform may assign the model after this callback.
				get model() {
					return agent.model ? `${agent.model.providerID}/${agent.model.id}` : undefined
				},
			}
		}
		void hooks.config?.({ agent: agents })
	})

	await ctx.session.hook("prompt", async (event) => {
		const session = await ctx.session.get({ sessionID: event.sessionID }).catch(() => undefined)
		const model = session?.model
		const output: ChatMessageOutput = {
			message: {
				model: model ? { providerID: model.providerID, modelID: model.id } : undefined,
			} as any,
			parts: [] as any,
		}
		await hooks["chat.message"]?.(
			{
				sessionID: event.sessionID,
				agent: session?.agent,
				model: model ? { providerID: model.providerID, modelID: model.id } : undefined,
			} as ChatMessageInput,
			output,
		)
		const override = output.message?.model
		if (override && (!model || override.providerID !== model.providerID || override.modelID !== model.id)) {
			await ctx.session.switchModel({
				sessionID: event.sessionID,
				model: { providerID: override.providerID, id: override.modelID },
			})
		}
	})

	await ctx.tool.hook("execute.after", async (event: any) => {
		if (event.status !== "completed") return
		const originalResult = event.result
		const originalContent = typeof originalResult?.content === "string"
			? originalResult.content
			: JSON.stringify(originalResult?.content ?? "")
		const output = { title: "", output: originalContent, metadata: originalResult?.metadata }
		await hooks["tool.execute.after"]?.(
			{ tool: event.tool, sessionID: event.sessionID, callID: event.id, args: event.input },
			output,
		)
		if (output.output !== originalContent) {
			event.result = { ...originalResult, content: output.output }
		}
	})

	const controller = new AbortController()
	void (async () => {
		try {
			for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
				await hooks.event?.({ event: normalizeV2Event(event as any) })
			}
		} catch (error) {
			if (!controller.signal.aborted) logInfo("V2 event subscription failed", { error: String(error) })
		}
	})()

	return () => controller.abort()
}

export default Plugin.define({
	id: "opencode-model-fallback",
	setup: setupV2,
})
