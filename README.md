# opencode-model-fallback

> Compatible with the OpenCode V2 plugin API while retaining the V1 `server()` entrypoint during migration.

[![npm](https://img.shields.io/npm/v/opencode-runtime-fallback)](https://www.npmjs.com/package/opencode-runtime-fallback)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-387%20passing-brightgreen)](#development)

Automatic model fallback plugin for [OpenCode](https://github.com/sst/opencode). When a model API call fails (rate limit, quota, timeout, server error), the plugin **transparently switches to the next model** in a configured chain and replays the request — zero manual intervention.

---

## Quick Install

```bash
# One-liner
curl -fsSL https://raw.githubusercontent.com/VastFuture/opencode-model-fallback/main/install.sh | bash

# Or via npm
npm install opencode-runtime-fallback
```

Then add to your `opencode.json`:

```json
{
  "plugin": ["opencode-runtime-fallback"]
}
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
