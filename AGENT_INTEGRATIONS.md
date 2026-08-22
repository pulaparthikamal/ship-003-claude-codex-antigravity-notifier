# Agent Integration Reference

How each agent exposes lifecycle events, and how we map them onto our canonical event model. This is the ground truth the [architecture](ARCHITECTURE.md) and adapters are built against.

## Canonical event model

Every adapter normalizes its agent's native events into one shape before it reaches the core engine:

```ts
type CanonicalEvent = {
  agent: 'claude' | 'codex' | 'antigravity' | string   // adapter-defined for "other"
  kind: 'permission' | 'question' | 'idle' | 'task_complete' | 'subagent_complete' | 'error'
  sessionId: string
  cwd: string
  projectName: string        // derived from cwd
  detail?: string            // short human-readable summary, if the agent provides one
  toolName?: string          // present for 'permission' events
  timestamp: number          // set by the adapter at receipt, not the agent
}
```

Adapters are the only place agent-specific payload knowledge lives. The core engine (dedup, mute, sound/popup dispatch) never sees raw agent JSON.

## Claude Code

- **Config location** (precedence high→low): `.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.json`, managed/org settings.
- **Schema**:
  ```json
  { "hooks": { "<EventName>": [ { "matcher": "<optional>", "hooks": [ { "type": "command", "command": "...", "timeout": 5 } ] } ] } }
  ```
- **Events we hook**:
  | Event | Matcher | Canonical kind | Notes |
  |---|---|---|---|
  | `Notification` | `permission_prompt` | `permission` | fires ~6s after a permission prompt goes unanswered |
  | `Notification` | `idle_prompt` | `idle` | fires ~60s after Claude finishes and the user hasn't typed |
  | `PermissionRequest` | — | `permission` | fires immediately when the prompt is about to be shown (lower latency than the Notification variant) |
  | `Stop` | — | `task_complete` | fires on every turn boundary, not just full task completion — the engine's min-duration/dedup logic filters noise |
  | `SubagentStop` | — | `subagent_complete` | |
- **Payload fields used**: `session_id`, `cwd`, `transcript_path`, `hook_event_name`, `notification_type`, `tool_name`, `tool_input`.
- **Docs**: `code.claude.com/docs/en/hooks.md`, `code.claude.com/docs/en/hooks-guide.md`.

## Codex CLI

- **Config location**: `~/.codex/hooks.json` — event names at document root (no `hooks` wrapper), unlike Claude Code.
- **Schema**:
  ```json
  { "<EventName>": [ { "matcher": "<optional>", "hooks": [ { "type": "command", "command": "...", "timeout": 30 } ] } ] }
  ```
- **Events we hook**: `PreToolUse` (→ `permission`, when the tool call requires approval), `UserPromptSubmit`/turn boundaries via `Stop` (→ `task_complete`), `PostToolUse` for detail enrichment.
- **Legacy path**: the `--notify` flag / `notify` config field emits `AfterAgent` / `AfterToolUse` in an older payload shape — support it as a fallback adapter for older Codex versions, but prefer `hooks.json`.
- **Payload fields used**: `session_id`, `cwd`, `transcript_path`, `hook_event_name`, `model`, `turn_id`.
- **Trust step**: hooks aren't active until the user runs `codex` once and accepts "Trust all and continue" — the installer must surface this as a required manual step (same limitation the original extension has).

## Antigravity

- **Config location**: `.agents/hooks.json` (per-workspace) or `~/.gemini/config/hooks.json` (global).
- **Schema**: same shell-command-hook shape as the others (stdin JSON in, stdout JSON out).
- **Events available today**: `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`. **No dedicated "waiting on input" or "permission prompt" event is documented yet.**
- **Mapping / gap-fill**:
  | Native event | Canonical kind | Notes |
  |---|---|---|
  | `PreToolUse` (tool requires approval) | `permission` | adapter must inspect the tool metadata itself — Antigravity doesn't flag this explicitly the way Claude Code does |
  | `Stop` | `task_complete` | |
  | *(none)* | `idle` | **heuristic-only**: adapter starts a timer on `PostInvocation`/`PostToolUse` and synthesizes an `idle` event if nothing fires again within N seconds — mirrors Claude's `idle_prompt` but computed locally, not agent-reported |
- **Editor coupling**: Antigravity is a VS Code fork; the IDE installs unmodified VS Code extensions directly from the Marketplace. This means our VS Code extension package doubles as the Antigravity extension with no separate build — see [ARCHITECTURE.md](ARCHITECTURE.md#editor-integration-layer).
- **Open question to revisit**: file an upstream feature request (mirroring `google-antigravity/antigravity-cli#346`) for a first-class notification/idle hook event; track as a follow-up, don't block v1 on it.

## "Other" agents / editors — the generic adapter contract

Any agent that can invoke an arbitrary shell command with a JSON payload (on stdin, argv, or env vars) can be supported without a bespoke adapter, via a documented **generic adapter**:

- User points the generic adapter at their agent's hook command slot.
- User supplies a small mapping config (JSON) telling the adapter which payload field is the session id, cwd, and which values of which field indicate `permission` / `question` / `task_complete`.
- The generic adapter normalizes using that mapping and forwards to the same core engine.

This is how we honor "and other code editors/agents" without hard-coding every possible tool: Claude Code, Codex, and Antigravity ship as first-class adapters with zero config; everything else uses the generic adapter with a short one-time setup.

## Editor-side note

Hooks are registered against the **agent's** config directory, not the editor's. The editor extension's job is UI (status bar, settings, output channel) and *installing* the hook configs above — it is not in the notification data path. This is why the same core engine works identically from a bare terminal, Vim, JetBrains, or any VS Code-compatible IDE.
