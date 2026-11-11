# OpenCode 2.2.5 Plugin Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the packaged fallback plugin load through the public OpenCode 2.2.5 plugin API while preserving the existing fallback behavior and a separate V1-compatible entrypoint.

**Architecture:** Keep the existing fallback state machine and V1 hooks unchanged. Replace the hand-written V2 definition with a public `Plugin.define` entrypoint typed against `@opencode/plugin@2.2.5`, isolate V1 export/build output, and verify the packed artifact in an isolated OpenCode service.

**Tech Stack:** TypeScript, Bun, `@opencode/plugin@2.2.5`, Bun test, OpenCode CLI 2.2.5.

---

### Task 1: Lock the OpenCode 2.2.5 loading contract

**Files:**
- Modify: `index.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `package-lock.json`

- [ ] Add a test requiring the default export to be a public V2 definition with stable ID and setup, and requiring V1 compatibility to be available from a separate entrypoint.
- [ ] Run the focused test and confirm it fails because the V1 entrypoint is not separate and the project is still typed against 2.0.29.
- [ ] Upgrade `@opencode/plugin` development and peer compatibility to OpenCode 2.2.5.

### Task 2: Migrate the V2 host integration

**Files:**
- Create: `v1.ts`
- Create: `v2.ts`
- Modify: `index.ts`
- Modify: `build.ts`
- Modify: `package.json`
- Test: `index.test.ts`

- [ ] Move the unchanged V1 server hook factory behind `./v1`.
- [ ] Define the V2 plugin with `Plugin.define` from the public `@opencode/plugin` export.
- [ ] Update V2 prompt, model, tool, and event adapters to the 2.2.5 event contracts without changing fallback selection or replay behavior.
- [ ] Build both entrypoints and expose `.` and `./v1` from the package.
- [ ] Run focused tests, typecheck, and the complete test suite.

### Task 3: Verify the packaged plugin in OpenCode 2.2.5

**Files:**
- Modify: `README.md`

- [ ] Pack the repository with `npm pack` and install the tarball into an isolated OpenCode configuration.
- [ ] Start an isolated OpenCode 2.2.5 service and query `/api/plugin` for the package ID and active state.
- [ ] Verify cleanup/reload and inspect bounded logs for plugin loading errors.
- [ ] Update README support and verification commands with the tested OpenCode and plugin versions.
- [ ] Run `git diff --check` and review the final diff for unrelated changes and sensitive data.
