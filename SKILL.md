# opencode-model-fallback

Automatic model fallback plugin for OpenCode. When a model API call fails (rate limit, quota, timeout, server error), the plugin transparently switches to the next model in a configured fallback chain and replays the request — zero manual intervention required.

---

## When to Use This Skill

Use this skill when the user mentions:
- "opencode model fallback"
- "opencode plugin for fallback"
- "automatic model switching"
- "handle rate limits in opencode"
- "backup models for opencode"
- "opencode quota errors"
- "opencode model timeout"
- Installing, configuring, or troubleshooting the opencode-runtime-fallback plugin

Also use when the user describes symptoms that this plugin solves:
- "My OpenCode agent keeps hitting rate limits"
- "Model X is unavailable, need a backup"
- "How to handle quota errors automatically"
- "Need automatic retry with different models"

---

## What This Plugin Does

**Core function**: Detects retryable API errors (rate limits, quota exceeded, timeouts, server errors) and automatically switches to the next model in a configured fallback chain.

**Key features**:
- Automatic fallback on rate limit (429), quota errors, model-not-found, timeouts
- Per-agent fallback chains (each agent can have its own list)
- Global fallback chain (shared across agents without their own list)
- TTFT (Time-To-First-Token) timeout detection
- Cooldown & auto-recovery
- Compaction-aware fallback
- Subagent result synchronization
- Toast notifications on model switches

---

## Installation

### Quick Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/VastFuture/opencode-model-fallback/main/install.sh | bash
```

### Manual Install

```bash
npm install opencode-runtime-fallback
```

Then add to `opencode.json`:

```json
{
  "plugin": ["opencode-runtime-fallback"]
}
```

---

## Configuration

### Step 1: Define fallback models per agent

Edit `opencode.json`:

```json
{
  "agent": {
    "coder": {
      "model": "anthropic/claude-opus-4-6",
      "fallback_models": [
        "openai/gpt-5.4",
        "kimi-for-coding/k2p5"
      ]
    },
    "explorer": {
      "model": "google/gemini-2.5-pro",
      "fallback_models": "anthropic/claude-sonnet-4-6"
    }
  }
}
```

**Single string**: `"fallback_models": "openai/gpt-4o"` (one backup model)  
**Array**: `"fallback_models": ["model1", "model2", "model3"]` (multiple backups)

### Step 2: (Optional) Create plugin config file

Create `.opencode/opencode-fallback.jsonc` in your project:

```jsonc
{
  // Master switch. Default: true
  "enabled": true,

  // HTTP codes that trigger fallback. Default: [429, 500, 502, 503, 504]
  "retry_on_errors": [429, 500, 502, 503, 504],

  // Custom error patterns (regex, case-insensitive)
  "retryable_error_patterns": [
    "billing\\s+suspended",
    "entity was not found"
  ],

  // Max fallback attempts. Default: 10
  "max_fallback_attempts": 10,

  // Cooldown duration in seconds. Default: 60
  "cooldown_seconds": 60,

  // TTFT timeout in seconds (0 = disabled). Default: 30
  "timeout_seconds": 30,

  // Show toast notifications. Default: true
  "notify_on_fallback": true,

  // Global fallback chain (for agents without their own list)
  "fallback_models": [
    "openai/gpt-5.4",
    "google/gemini-2.5-pro"
  ]
}
```

**Config file locations** (first match wins):

| Path | Scope |
|------|-------|
| `.opencode/opencode-fallback.jsonc` | Current project |
| `.opencode/opencode-fallback.json` | Current project |
| `~/.config/opencode/opencode-fallback.jsonc` | Global (all projects) |
| `~/.config/opencode/opencode-fallback.json` | Global (all projects) |

---

## How It Works

```
Primary model fails (rate limit / quota / timeout / server error)
  ↓
Plugin aborts in-flight request
  ↓
Replays last user message with fallback_models[0]
  ↓
If that fails → fallback_models[1] → fallback_models[2] → …
  ↓
All fallbacks exhausted → surface error to user
```

**Fallback priority**:
1. `agent.fallback_models` in `opencode.json` (highest priority)
2. `fallback_models` in plugin config file
3. No fallback → error surfaces to user

**Message replay strategy**:
1. Try all message parts (text + images + attachments)
2. If fails → try text + images only
3. If fails → try text only

This maximises compatibility across different model providers.

---

## Built-in Error Triggers

The plugin automatically detects these errors without any configuration:

| Error Type | Trigger Conditions |
|------------|-------------------|
| **Rate limit** | HTTP 429, "rate limit", "too many requests" |
| **Quota** | "quota exceeded", "quota protection", "usage limit reached", "credit balance too low" |
| **Service unavailable** | HTTP 503/529, "service unavailable", "overloaded", "temporarily unavailable" |
| **Server error** | HTTP 500, 502, 504 |
| **Model not found** | "model not found", "model not supported", "model is not available" |
| **Missing API key** | API key not configured for the provider |

You can add your own patterns via `retryable_error_patterns` in the config file.

---

## Advanced Features

### TTFT Timeout

**Problem**: A model accepts the request but never produces any tokens (hung).

**Solution**: The plugin starts a timer when a fallback model is invoked. If no token arrives within `timeout_seconds`, the model is aborted and the next fallback is tried.

**Important**: Actively streaming models are **never interrupted**. The timeout only applies when the model is completely silent.

**Config**:
```jsonc
{
  "timeout_seconds": 30  // 0 = disabled
}
```

### Cooldown & Auto-Recovery

**Problem**: A model fails due to temporary issues (rate limit, server overload).

**Solution**: Failed models enter cooldown for `cooldown_seconds`. During cooldown they are skipped in the fallback chain. Once cooldown expires, the plugin automatically tries the primary model again on the next prompt.

**Config**:
```jsonc
{
  "cooldown_seconds": 60  // seconds
}
```

### Compaction-Aware Fallback

**Problem**: The `/compact` command uses special message formats that normal `promptAsync` cannot handle.

**Solution**: The plugin detects compaction messages via the `agent: "compaction"` field and retries via `session.command` instead of `promptAsync`.

**Config**: Define a `"compaction"` agent in your fallback config, or fall back to the global chain.

### Subagent Result Sync

**Problem**: Parent agent uses `task` tool to spawn a child session. Child session hits an error and triggers fallback. Parent receives an empty result before child fallback completes.

**Solution**: The plugin detects empty task results, extracts the child session ID, and waits (with bounded timeout) for the child's fallback to complete before returning the result to the parent.

**Bounded wait**: `min(timeout_seconds * 1000, 120000)` milliseconds (max 2 minutes).

---

## Common Use Cases

### Use Case 1: Rate Limit Protection

**Scenario**: Claude Opus has a low rate limit. You want to automatically fall back to GPT-5.4 when rate limited.

**Config**:
```json
{
  "agent": {
    "coder": {
      "model": "anthropic/claude-opus-4-6",
      "fallback_models": "openai/gpt-5.4"
    }
  }
}
```

### Use Case 2: Cost Optimization

**Scenario**: Start with expensive model, fall back to cheaper ones if unavailable.

**Config**:
```json
{
  "agent": {
    "coder": {
      "model": "anthropic/claude-opus-4-6",
      "fallback_models": [
        "anthropic/claude-sonnet-4-6",
        "openai/gpt-4o",
        "google/gemini-2.5-flash"
      ]
    }
  }
}
```

### Use Case 3: Global Fallback for All Agents

**Scenario**: You have multiple agents and want a shared fallback chain.

**Config** (`.opencode/opencode-fallback.jsonc`):
```jsonc
{
  "fallback_models": [
    "openai/gpt-5.4",
    "google/gemini-2.5-pro",
    "anthropic/claude-sonnet-4-6"
  ]
}
```

Agents without their own `fallback_models` will use this global chain.

### Use Case 4: Disable Plugin Temporarily

**Scenario**: Debug issues by turning off automatic fallback.

**Config**:
```jsonc
{
  "enabled": false
}
```

### Use Case 5: Custom Error Patterns

**Scenario**: Your provider returns custom error messages not covered by built-in patterns.

**Config**:
```jsonc
{
  "retryable_error_patterns": [
    "billing\\s+suspended",
    "account\\s+locked",
    "insufficient\\s+credits"
  ]
}
```

---

## Troubleshooting

### Plugin not switching models

**Check**:
1. `"plugin": ["opencode-runtime-fallback"]` is in `opencode.json`
2. `fallback_models` is defined (per-agent or global)
3. `enabled: true` in plugin config (or omit for default true)
4. Error message matches built-in patterns or your custom patterns

**Debug**:
- Check OpenCode logs for `[opencode-runtime-fallback]` messages
- Set `"notify_on_fallback": true` to see toast notifications

### Fallback models exhausted

**Symptom**: All fallback models fail, error surfaces to user.

**Possible causes**:
1. All models are rate limited
2. API keys missing/invalid for all fallback models
3. All models don't support the input format (e.g. images)

**Solutions**:
- Add more fallback models
- Check API keys
- Use models that support your input format

### TTFT timeout triggering too early

**Symptom**: Models are aborted even though they're about to respond.

**Solution**: Increase `timeout_seconds`:
```jsonc
{
  "timeout_seconds": 60  // or higher
}
```

### Cooldown too short/long

**Symptom**: Failed models retry too quickly (or too slowly).

**Solution**: Adjust `cooldown_seconds`:
```jsonc
{
  "cooldown_seconds": 120  // 2 minutes
}
```

---

## Agent Instructions

When helping users with this plugin:

1. **Always check if plugin is installed**: Look for `"plugin": ["opencode-runtime-fallback"]` in `opencode.json`

2. **Check fallback models are defined**: Either per-agent in `opencode.json` or globally in plugin config

3. **Verify config file location**: First check `.opencode/opencode-fallback.jsonc`, then global `~/.config/opencode/opencode-fallback.jsonc`

4. **Explain fallback priority**: Per-agent > global > no fallback

5. **Recommend realistic fallback chains**: 2-3 models is usually enough. Too many models = longer delays.

6. **Warn about cost implications**: Fallback models may have different pricing. User should be aware.

7. **Suggest testing**: User should trigger an error manually (e.g. invalid API key) to verify fallback works.

8. **Check logs**: OpenCode logs contain `[opencode-runtime-fallback]` entries showing fallback activity.

---

## Repository & Links

- **GitHub**: https://github.com/VastFuture/opencode-model-fallback
- **npm**: https://www.npmjs.com/package/opencode-runtime-fallback
- **Issues**: https://github.com/VastFuture/opencode-model-fallback/issues
- **OpenCode docs**: https://github.com/sst/opencode

---

## License

MIT — originally by [youngbinkim0](https://github.com/youngbinkim0/opencode-fallback), maintained by [VastFuture](https://github.com/VastFuture).
