# opencode-model-fallback

> Native OpenCode V2 plugin with a separate `./v1` compatibility export.

[![Release](https://img.shields.io/github/v/release/VastFuture/opencode-model-fallback)](https://github.com/VastFuture/opencode-model-fallback/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-393%20passing-brightgreen)](#development)

Automatic model fallback plugin for [OpenCode](https://github.com/sst/opencode). When a model API call fails (rate limit, quota, timeout, server error), the plugin **transparently switches to the next model** in a configured chain and replays the request — zero manual intervention.

## OpenCode Version Support

| OpenCode version | Plugin version | Status |
|---|---|---|
| V2 `>= 2.2.5` | `1.0.4` | Primary support; verified with OpenCode `2.2.7` using an installed release package |
| V1 `>= 1.1.0` | `1.0.4` | Compatibility through the separate `opencode-runtime-fallback/v1` export |

The default package export targets OpenCode V2 and uses the public `@opencode/plugin` API. The V1 hook implementation is intentionally isolated behind `opencode-runtime-fallback/v1`; it is not exposed from the V2 entrypoint.

### OpenCode 2.2.7 compatibility fix

Version 1.0.4 resumes the existing V2 context with an empty synthetic steering input after switching models. It does not enqueue a copy of a historical user message: newer queued prompts may not yet appear in `session.context()`. Existing user messages and attachments stay in the context.

OpenCode 2.2.7 discovers `~/.config/opencode/plugins/opencode-model-fallback/` directly. The installer checks the OpenCode version and removes the older bridge to prevent a duplicate plugin ID.

V2 text, reasoning, tool activity and successful execution events now update the fallback watchdog. Agent model references are converted to `provider/model` before entering the V1 state machine, so a failed primary is not selected again by mistake.

Regression coverage: `bun test v2-events.test.ts`. Local runtime verification uses OpenCode 2.2.7 with an isolated configuration and a local synthetic provider, including three consecutive prompts and prompts queued during a failing request. This is local E2 evidence and does not verify live-provider behavior.

---

## Recommended Installation

This maintained build is distributed through GitHub Releases. The npm package with the same name is an upstream package and is not this VastFuture release.

```bash
curl -fL \
  https://github.com/VastFuture/opencode-model-fallback/releases/download/v1.0.4/opencode-runtime-fallback-1.0.4.tgz \
  -o /tmp/opencode-runtime-fallback-1.0.4.tgz
mkdir -p ~/.config/opencode/plugins/opencode-model-fallback
tar -xzf /tmp/opencode-runtime-fallback-1.0.4.tgz \
  -C ~/.config/opencode/plugins/opencode-model-fallback \
  --strip-components=1
npm install --omit=dev --ignore-scripts --legacy-peer-deps --prefer-offline \
  --prefix ~/.config/opencode/plugins/opencode-model-fallback
```

OpenCode 2.2.7 loads this directory directly. When upgrading an older installation on 2.2.7, remove its bridge:

```bash
rm -f ~/.config/opencode/plugins/opencode-model-fallback.js
```

For OpenCode 2.2.5, create the bridge instead:

```bash
printf 'export { default } from "file://%s/.config/opencode/plugins/opencode-model-fallback/dist/index.js"\n' \
  "$HOME" \
  > ~/.config/opencode/plugins/opencode-model-fallback.js
```

OpenCode `2.2.5` automatically discovers the bridge under `~/.config/opencode/plugins/`; remove any `opencode-runtime-fallback` package entry from `opencode.json` to avoid loading the upstream npm package as well.

OpenCode watches configuration changes. Inspect the loaded plugin state after the location has started:

```bash
opencode api plugin.list --param "location[directory]=$HOME"
```

Installation is complete only when the API result contains:

```text
id: opencode-model-fallback
source.type: local
source.path: /home/<user>/.config/opencode/plugins/opencode-model-fallback
state.status: active
```

> Load the plugin only once. OpenCode 2.2.5 reports the bridge path with a `.js` suffix instead of the directory path.

### Alternative installer

The repository installer selects the appropriate entrypoint automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/VastFuture/opencode-model-fallback/main/install.sh | bash
```

---

## Features

- **Automatic fallback** — detects rate limits, quota errors, model-not-found, and other retryable failures; switches models immediately
- **Per-agent chains** — each agent can have its own ordered fallback list
- **Global fallback chain** — shared chain for agents without their own list
- **TTFT timeout** — aborts hung models that produce no tokens within a configurable window; actively streaming models are never interrupted
- **Cooldown & auto-recovery** — failed models enter cooldown and automatically recover
- **Compaction-aware** — handles `/compact` failures with the same fallback logic
- **Subagent sync** — detects empty task results from child sessions and waits for their fallback to complete
- **Custom error patterns** — extend built-in matching with your own regex
- **Toast notifications** — optional UI feedback on model switches

---

## Setup

### 1. Configure fallback models per agent

```json
{
  "agent": {
    "coder": {
      "model": "anthropic/claude-opus-4-6",
      "fallback_models": [
        "openai/gpt-5.4",
        "kimi-for-coding/k2p5"
      ]
    }
  }
}
```

A single string also works: `"fallback_models": "openai/gpt-4o"`

### 2. (Optional) Plugin config file

Create `.opencode/opencode-fallback.jsonc` in your project (or `~/.config/opencode/opencode-fallback.jsonc` globally):

```jsonc
{
  "enabled": true,
  // HTTP codes that trigger fallback. Default: [429, 500, 502, 503, 504]
  "retry_on_errors": [429, 500, 502, 503, 504],
  // Extra regex patterns matched against error messages
  "retryable_error_patterns": [],
  // Max fallback attempts before giving up. Default: 10
  "max_fallback_attempts": 10,
  // Seconds a failed model stays in cooldown. Default: 60
  "cooldown_seconds": 60,
  // Seconds to wait for first token before aborting. 0 = disabled. Default: 30
  "timeout_seconds": 30,
  // Show toast when switching models. Default: true
  "notify_on_fallback": true,
  // Global chain for agents without their own fallback_models
  "fallback_models": ["openai/gpt-5.4", "google/gemini-2.5-pro"]
}
```

Config file locations (first match wins):

| Path | Scope |
|------|-------|
| `.opencode/opencode-fallback.jsonc` | Current project |
| `.opencode/opencode-fallback.json` | Current project |
| `~/.config/opencode/opencode-fallback.jsonc` | Global |
| `~/.config/opencode/opencode-fallback.json` | Global |

---

## How It Works

```
Primary model fails (rate limit / quota / timeout / server error)
  └─▶ Abort in-flight request
  └─▶ Replay message with fallback_models[0]
        └─▶ Fails again → fallback_models[1] → …
              └─▶ All exhausted → surface error to user
```

**Priority**: `agent.fallback_models` in `opencode.json` > `fallback_models` in plugin config > error surfaces to user.

**Message replay** uses three-tier degradation: (1) all parts → (2) text + images → (3) text only, maximising cross-provider compatibility.

---

## Built-in Error Triggers

| Error type | Trigger |
|------------|---------|
| Rate limit | HTTP 429, "rate limit", "too many requests" |
| Quota | "quota exceeded", "quota protection", "usage limit reached", "credit balance too low" |
| Service unavailable | HTTP 503/529, "service unavailable", "overloaded" |
| Server error | HTTP 500, 502, 504 |
| Model not found | "model not found", "model not supported", "model is not available" |
| Missing API key | API key not configured for the provider |

---

## How It Works

See [HOW_IT_WORKS.md](HOW_IT_WORKS.md) for a deep-dive into the plugin architecture, event hooks, TTFT timeout, cooldown, message replay, and subagent sync.

---

## Development

```bash
bun install        # install deps
bun test           # run 393 tests
bun run build      # compile to dist/
bun run typecheck  # type-check without emitting
bun run test:package # build, pack, install, and import both entrypoints
```

---

## License

MIT — originally by [youngbinkim0](https://github.com/youngbinkim0/opencode-fallback), maintained by [VastFuture](https://github.com/VastFuture).
