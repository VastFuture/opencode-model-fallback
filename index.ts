import type {
	PluginContext,
	FallbackPluginConfig,
	HookDeps,
	ChatMessageInput,
	ChatMessageOutput,
} from "./types"
import type { Context as V2PluginContext } from "@opencode/plugin/promise/plugin"
import { DEFAULT_CONFIG, PLUGIN_NAME } from "./constants"
import { createAutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createMessageUpdateHandler } from "./message-update-handler"
import { createChatMessageHandler } from "./chat-message-handler"
import { normalizeFallbackModelsField } from "./config-reader"
import { isEmptyTaskResult, extractChildSessionID, waitForChildFallbackResult } from "./subagent-result-sync"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { parse as parseJsonc } from "jsonc-parser"
import { logInfo } from "./logger"

declare function setInterval(
	callback: () => void,
	delay: number
): { unref: () => void } & ReturnType<typeof globalThis.setInterval>

function loadPluginConfig(directory: string): Partial<FallbackPluginConfig> {
	const configPaths = [
		join(directory, ".opencode", "opencode-fallback.json"),
		join(directory, ".opencode", "opencode-fallback.jsonc"),
		join(process.env.HOME || "", ".config", "opencode", "opencode-fallback.json"),
		join(process.env.HOME || "", ".config", "opencode", "opencode-fallback.jsonc"),
	]

	for (const configPath of configPaths) {
		if (existsSync(configPath)) {
			try {
				const content = readFileSync(configPath, "utf-8")
				// parseJsonc handles // comments, /* */ blocks, and trailing commas seamlessly
				return parseJsonc(content) as Partial<FallbackPluginConfig>
			} catch (err) {
				logInfo(`[${PLUGIN_NAME}] Failed to parse config: ${configPath}`, err as Record<string, unknown>)
			}
		}
	}

	return {}
}

async function createServerHooks(
	ctx: PluginContext,
	configOverrides?: Partial<FallbackPluginConfig>
) {
	let agentConfigs: Record<string, unknown> | undefined
	let fileConfig: Partial<FallbackPluginConfig> = loadPluginConfig(ctx.directory)
	let mergedConfig: Required<FallbackPluginConfig> | undefined
	const globalFallbackModels = normalizeFallbackModelsField(fileConfig.fallback_models)

	// Config getter that builds config on first access
	const getConfig = (): Required<FallbackPluginConfig> => {
		mergedConfig ??= {
			enabled:
				configOverrides?.enabled ??
				fileConfig?.enabled ??
				DEFAULT_CONFIG.enabled,
			retry_on_errors:
				configOverrides?.retry_on_errors ??
				fileConfig?.retry_on_errors ??
				DEFAULT_CONFIG.retry_on_errors,
			retryable_error_patterns:
				configOverrides?.retryable_error_patterns ??
				fileConfig?.retryable_error_patterns ??
				DEFAULT_CONFIG.retryable_error_patterns,
			max_fallback_attempts:
				configOverrides?.max_fallback_attempts ??
				fileConfig?.max_fallback_attempts ??
				DEFAULT_CONFIG.max_fallback_attempts,
			cooldown_seconds:
				configOverrides?.cooldown_seconds ??
				fileConfig?.cooldown_seconds ??
				DEFAULT_CONFIG.cooldown_seconds,
			timeout_seconds:
				configOverrides?.timeout_seconds ??
				fileConfig?.timeout_seconds ??
				DEFAULT_CONFIG.timeout_seconds,
			notify_on_fallback:
				configOverrides?.notify_on_fallback ??
				fileConfig?.notify_on_fallback ??
				DEFAULT_CONFIG.notify_on_fallback,
			fallback_models:
				configOverrides?.fallback_models ??
				fileConfig?.fallback_models ??
				DEFAULT_CONFIG.fallback_models,
		}

		return mergedConfig
	}

	const deps: HookDeps = {
		ctx,
		get config() {
			return getConfig()
		},
		get agentConfigs() {
			return agentConfigs
		},
		globalFallbackModels,
		sessionStates: new Map(),
		sessionLastAccess: new Map(),
		sessionRetryInFlight: new Set(),
		sessionAwaitingFallbackResult: new Set(),
		sessionFallbackTimeouts: new Map(),
		sessionFirstTokenReceived: new Map(),
		sessionSelfAbortTimestamp: new Map(),
		sessionParentID: new Map(),
		sessionIdleResolvers: new Map(),
		sessionLastMessageTime: new Map(),
		sessionCompactionInFlight: new Set(),
	}

	const helpers = createAutoRetryHelpers(deps)
	const { handleEvent: baseEventHandler, handleActivity } = createEventHandler(deps, helpers)
	const messageUpdateHandler = createMessageUpdateHandler(deps, helpers)
	const chatMessageHandler = createChatMessageHandler(deps, helpers)

	const cleanupInterval = setInterval(
		helpers.cleanupStaleSessions,
		5 * 60 * 1000
	)
	cleanupInterval.unref()

	logInfo(`Plugin initialized (${globalFallbackModels.length} global fallback model(s) configured)`)

	return {
		name: PLUGIN_NAME,

		config: (opencodeConfig: Record<string, unknown>) => {
			// Try 'agents' (plural) first, then 'agent' (singular)
			const agentsValue = opencodeConfig.agents
			const agentValue = opencodeConfig.agent
			
			if (agentsValue && typeof agentsValue === "object" && !Array.isArray(agentsValue)) {
				agentConfigs = agentsValue as Record<string, unknown>
			} else if (agentValue && typeof agentValue === "object" && !Array.isArray(agentValue)) {
				agentConfigs = agentValue as Record<string, unknown>
			} else {
				agentConfigs = undefined
			}
			
			logInfo(`Plugin initialized with ${agentConfigs ? Object.keys(agentConfigs).length : 0} agents`)
		},

		event: async ({
			event,
		}: {
			event: { type: string; properties?: unknown }
		}) => {
			if (event.type === "message.updated") {
				if (!deps.config.enabled) return
				const props = event.properties as
					| Record<string, unknown>
					| undefined
				await messageUpdateHandler(props)
				return
			}
			
			if (
				event.type === "message.part.delta" ||
				event.type === "session.diff" ||
				event.type === "message.part.updated"
			) {
				const props = event.properties as Record<string, unknown> | undefined
				const info = props?.info as Record<string, unknown> | undefined
				const sessionID =
					(props?.sessionID as string | undefined) ??
					(info?.sessionID as string | undefined) ??
					(info?.id as string | undefined)
				// Extract model from activity event so handleActivity can
				// distinguish stale activity from the failed model vs real
				// activity from the fallback model.
				const activityModel =
					(info?.model as string | undefined) ??
					(typeof info?.providerID === "string" && typeof info?.modelID === "string"
						? `${info.providerID}/${info.modelID}`
						: undefined) ??
					(props?.model as string | undefined)
				if (sessionID) {
					await handleActivity(sessionID, activityModel)
				}
			}
			
			await baseEventHandler({ event })

		},

		"tool.execute.after": async (
			input: { tool: string; sessionID: string; callID: string; args: any },
			output: { title: string; output: string; metadata: any }
		) => {
			// Only intercept task tool calls with empty results
			if (input.tool !== "task" || !isEmptyTaskResult(output.output)) {
				return
			}

			const childSessionID = extractChildSessionID(output.output)
			if (!childSessionID) {
				logInfo("Empty task result but no child session ID found", {
					sessionID: input.sessionID,
					outputPreview: output.output?.substring(0, 200),
				})
				return
			}

			logInfo("Detected empty task result, waiting for child fallback", {
				parentSession: input.sessionID,
				childSession: childSessionID,
			})

			// Wait for child session fallback to complete (bounded)
			const maxWaitMs = Math.min(
				(deps.config.timeout_seconds || 120) * 1000,
				120_000,
			)
			const replacementText = await waitForChildFallbackResult(deps, childSessionID, {
				maxWaitMs,
				pollIntervalMs: 500,
			})

			if (replacementText) {
				output.output = replacementText
				logInfo("Replaced empty task result with fallback response", {
					parentSession: input.sessionID,
					childSession: childSessionID,
					responseLength: replacementText.length,
				})
			} else {
				logInfo("No fallback response available, preserving original output", {
					parentSession: input.sessionID,
					childSession: childSessionID,
				})
			}
		},

		"chat.message": async (
			input: ChatMessageInput,
			output: ChatMessageOutput
		) => {
			await chatMessageHandler(input, output)
		},
	}
}

function normalizeV2Event(event: { type: string; data?: unknown }) {
	const data = event.data as Record<string, unknown> | undefined
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

function createV2Adapter(ctx: V2PluginContext): PluginContext {
	const directory = ctx.location.directory
	const session = {
		get: async ({ path }: any) => ({ data: await ctx.session.get({ sessionID: path.id }) }),
		messages: async ({ path }: any) => ({
			data: (await ctx.session.context({ sessionID: path.id })).map((message: any) => toLegacyMessage(message)),
		}),
		abort: async ({ path }: any) => ctx.session.interrupt({ sessionID: path.id }),
		promptAsync: async ({ path, body }: any) => {
			const text = (body.parts ?? [])
				.filter((part: any) => part.type === "text")
				.map((part: any) => part.text)
				.join("\n")
			if (body.model) {
				await ctx.session.switchModel({
					sessionID: path.id,
					model: { providerID: body.model.providerID, id: body.model.modelID },
				})
			}
			if (body.agent) {
				await ctx.session.switchAgent({ sessionID: path.id, agent: body.agent })
			}
			await ctx.session.prompt({ sessionID: path.id, text, delivery: "queue" })
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

async function setupV2(ctx: V2PluginContext) {
	const adapter = createV2Adapter(ctx)
	const hooks = await createServerHooks(adapter, ctx.options as Partial<FallbackPluginConfig>)

	await ctx.agent.transform((editor) => {
		const agents: Record<string, unknown> = {}
		for (const agent of editor.list()) agents[String(agent.id)] = agent
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

export default {
	id: "opencode-model-fallback",
	setup: setupV2,
	server: createServerHooks,
}
