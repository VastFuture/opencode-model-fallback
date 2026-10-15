# opencode-model-fallback

> Compatible with the OpenCode V2 plugin API while retaining the V1 `server()` entrypoint during migration.

[![npm](https://img.shields.io/npm/v/opencode-runtime-fallback)](https://www.npmjs.com/package/opencode-runtime-fallback)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-387%20passing-brightgreen)](#development)

Automatic model fallback plugin for [OpenCode](https://github.com/sst/opencode). When a model API call fails (rate limit, quota, timeout, server error), the plugin **transparently switches to the next model** in a configured chain and replays the request — zero manual intervention.

## OpenCode Version Support

| OpenCode version | Plugin version | Status |
|---|---|---|
| V2 `>= 2.0.27` | `opencode-runtime-fallback >= 0.3.0` | ✅ Primary support; verified with OpenCode `2.0.29` using the package-name installation below |
| V1 `>= 1.1.0` | Current package | ⚠️ Migration compatibility through the retained `server()` entrypoint |

OpenCode V2 users must install `opencode-runtime-fallback` `0.3.0` or newer. Releases `0.2.x` use the legacy function export and fail V2 loading with `Plugin must export a default definition with an id and an effect or setup function`.

---

## Recommended Installation

The recommended setup lets OpenCode load the published npm package by name. OpenCode manages the package under its own cache; do not manually copy `dist/index.js` into the cache or edit cached package files.

```bash
npm view opencode-runtime-fallback version
```

The reported version must be `0.3.0` or newer. Pin that compatible version in the V2-native `plugins` field in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-runtime-fallback@0.3.0"]
}
```

When you intentionally want automatic updates, omit the version and keep the package name only. Existing configurations using the legacy singular `plugin` field also remain accepted during V1-to-V2 migration, so this already-verified form does not need an immediate rewrite:

```json
{
  "plugin": ["opencode-runtime-fallback"]
}
```

Restart the background service and inspect the real loaded plugin state:

```bash
opencode service restart
opencode api get /api/plugin
```

Installation is complete only when the API result contains:

```text
id: opencode-fallback
source.type: package
source.target: opencode-runtime-fallback
source.version: 0.3.0 or newer
state.status: active
```

The published `0.3.x` package reports `opencode-fallback`. A build from the current repository source reports `opencode-model-fallback`; both names refer to this plugin's V2 definition.

If the API reports an older cached version, change the configured package target to an explicit compatible version and restart OpenCode. Do not patch OpenCode's npm cache by hand:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-runtime-fallback@0.3.0"]
}
```

> Load the plugin only once. Do not combine the npm package entry with a local `dist/index.js` path or an auto-discovered copy, or OpenCode will reject the duplicate plugin ID.

### Alternative installer

The repository installer remains available for users who prefer the scripted setup:

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
bun test           # run 387 tests
bun run build      # compile to dist/
bun run typecheck  # type-check without emitting
```

---

## License

MIT — originally by [youngbinkim0](https://github.com/youngbinkim0/opencode-fallback), maintained by [VastFuture](https://github.com/VastFuture).
