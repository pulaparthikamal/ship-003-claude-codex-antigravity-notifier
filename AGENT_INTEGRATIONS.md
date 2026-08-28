# Agent Integration Reference

How each agent exposes lifecycle events, and how we map them onto our canonical event model. This is the ground truth the [architecture](ARCHITECTURE.md) and adapters are built against.

## Canonical event model

Every adapter normalizes its agent's native events into one shape before it reaches the core engine:

```ts
type CanonicalEvent = {
  agent: 'claude' | 'codex' | 'antigravity' | 'cursor' | 'copilot' | string   // adapter-defined for "other"
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

- **Config location**: `~/.codex/hooks.json` (user level) or `<repo>/.codex/hooks.json` (project level) — hooks from every layer that applies run together, layers don't replace each other. We only write the user-level file.
- **Schema — confirmed against `learn.chatgpt.com/docs/hooks`, and it requires the same top-level `"hooks"` wrapper Claude Code uses**, not flat event names at the document root:
  ```json
  { "hooks": { "<EventName>": [ { "matcher": "<optional>", "hooks": [ { "type": "command", "command": "...", "commandWindows": "<optional Windows-only override>", "timeout": 30 } ] } ] } }
  ```
  **This repo's adapter wrote the flat, wrapper-less shape until 2026-08-27** — Codex's real hook reader never recognized that as a registration at all, so every install using that version silently never fired a single Codex notification, on any platform. Fixed in `lib/adapters/codex.js`; `install()` also migrates away from the old flat keys (deletes `PreToolUse`/`Stop` at the root) on re-install, and `notifier doctor` flags a still-unmigrated file.
- **Events we hook**: `PermissionRequest` (→ `permission`) and `Stop`/`SubagentStop` (→ `task_complete`/`subagent_complete`). We deliberately do **not** hook `PreToolUse` for permission: confirmed `PreToolUse` "fires for every tool invocation before execution" regardless of whether a human is involved, while `PermissionRequest` specifically "runs when Codex is about to ask for approval... doesn't run for commands that don't need approval" — the same distinction Claude Code draws between its own `PreToolUse`-equivalent tool events and `PermissionRequest`.
- **`Stop`/`SubagentStop` response requirement, different from every other event and every other agent's hooks**: confirmed "`Stop` expects JSON on `stdout` when it exits `0`. Plain text output is invalid for this event" (every other event treats exit 0 + no output as success). `bin/notifier.js`'s `dispatch` command prints `{"continue":true}` to stdout for exactly these two events (see `codex.respondsWithJson()`), and stays silent for everything else — Cursor's hook contract explicitly forbids printing stdout it might parse as a decision, so this can't be a blanket rule across agents.
- **Windows**: `commandWindows` is a documented sibling field on a `command`-type hook for a Windows-only override; we set it to the same command string as `command` (our absolute, JSON-quoted paths are valid `cmd.exe` syntax too).
- **Payload fields used**: `session_id`, `cwd`, `transcript_path`, `hook_event_name`, `model`, `turn_id`, `tool_name`.
- **Trust step**: hooks aren't active until the user runs `codex` once and accepts "Trust all and continue" — the installer must surface this as a required manual step (same limitation the original extension has).
- **No confirmed legacy `--notify` path**: an earlier version of this doc claimed a legacy `--notify` flag / `notify` config field as a fallback for older Codex versions; current docs make no mention of it and nothing in this codebase implements it. Don't add it without a concrete report from a user on an old Codex version that needs it.

## Antigravity

- **Config location**: `.agents/hooks.json` (per-workspace, takes precedence) or `~/.gemini/config/hooks.json` (global). Confirmed against `antigravity.google/docs/hooks/`.
- **Schema — confirmed, and different from every other adapter here**: events are wrapped under an arbitrary **hook-name key** at the document root, not flat at the root:
  ```json
  { "notifier": { "PreToolUse": [{ "hooks": [{ "type": "command", "command": "...", "timeout": 30 }] }], "Stop": [...] } }
  ```
  An earlier version of this adapter wrote flat `{ "PreToolUse": [...], "Stop": [...] }` at the root — Antigravity doesn't recognize that as a hook registration at all, so it silently never fired. Fixed in `lib/adapters/antigravity.js` (`HOOK_NAME = 'notifier'`); `install()` also migrates away from the old flat keys on re-install. Default `timeout` is 30s when omitted (we set 10 explicitly).
- **Events available today**: `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`. **No dedicated "waiting on input" or "permission prompt" event exists** — confirmed against `antigravity.google/docs/hooks/`: approval gating happens only via `PreToolUse`'s own `decision` output (`allow`/`deny`/`ask`/`force_ask`/`deny_unless_prior_grant`), a gate the hook itself controls, not a separate field or event announcing "a human is now being asked." `PreToolUse`'s real payload (`toolCall.name`/`toolCall.args`, `stepIdx`, plus the common fields) has **no `requires_approval`-style flag at all** — confirmed by capturing a real, live payload on 2026-08-24. A `permission` notification for Antigravity is therefore not implementable against the hook API as it exists today, full stop — not a bug in this adapter, and not something a smarter `normalize()` can work around.
- **`Stop` payload includes `fullyIdle` (boolean)**: "true if the agent is completely finished and all background commands or asynchronous tasks have completed," plus `executionNum`/`terminationReason`/`error`. We currently treat every `Stop` (any payload with no `toolCall`) as `task_complete` regardless of `fullyIdle` — matches Claude Code's own `Stop` handling ("fires on every turn boundary, not just full task completion — the engine's min-duration/dedup logic filters noise"), so this is a deliberate consistency choice, not an oversight, but flagging the field's existence here in case a future pass wants finer-grained detail in the notification body.
- **Mapping / gap-fill**:
  | Native event | Canonical kind | Notes |
  |---|---|---|
  | `Stop` | `task_complete` | |
  | `PreToolUse` / `PostToolUse` | *(none — returns `null`, not dispatched)* | `PostToolUse` fires after **every** tool call, not just the last one; an earlier version defaulted these to `task_complete`, which fired a full notification on every tool call and made per-event sound settings look broken |
  | *(none — genuinely unobservable, see above)* | `permission` | |
  | *(none)* | `idle` | **heuristic-only**: adapter starts a timer on `PostToolUse` and synthesizes an `idle` event if nothing fires again within N seconds — mirrors Claude's `idle_prompt` but computed locally, not agent-reported. **Was silently broken until 2026-08-27**: `scheduleIdleCheck()`'s spawned argv was missing its `'antigravity'` element (present in Cursor's otherwise-identical copy), which shifted every later positional arg left by one inside `bin/notifier.js`'s `idle-check` case — the marker path ended up `undefined`, so the before/after comparison that decides whether to actually dispatch was always false. The timer ran every time; its dispatch was simply unreachable. Fixed — see the fix's own comment in `lib/adapters/antigravity.js`. |
- **Editor coupling**: Antigravity is a VS Code fork; the IDE installs unmodified VS Code extensions directly from the Marketplace. This means our VS Code extension package doubles as the Antigravity extension with no separate build — see [ARCHITECTURE.md](ARCHITECTURE.md#editor-integration-layer).
- **Known upstream bug, Windows**: a live bug report ([Google AI developer forum, Antigravity IDE 1.107.0, Windows 11](https://discuss.ai.google.dev/t/stop-and-posttooluse-hooks-in-agents-hooks-json-never-fire-antigravity-ide-1-107-0-windows/178288)) shows `Stop`/`PostToolUse` hooks never firing on Windows even with the correct wrapper schema and multiple command-shell variants tried, while the exact same command runs fine invoked directly. No confirmed fix as of this writing — treat Antigravity-on-Windows as currently unreliable independent of anything in this repo, not a config bug on the user's end. **If `task_complete` notifications aren't appearing on Windows specifically, this upstream bug — not the idle-heuristic fix above — is the far more likely cause; there is no code-level workaround available from our side.**
- **Open question to revisit**: file an upstream feature request (mirroring `google-antigravity/antigravity-cli#346`) for a first-class notification/idle hook event; track as a follow-up, don't block v1 on it.

## Cursor

- **Confirmed real, current feature** (introduced Cursor v1.7, Oct 2025). Docs: `cursor.com/docs/hooks`.
- **Config location**: `.cursor/hooks.json` (project root) or `~/.cursor/hooks.json` (global). Precedence (high→low): Enterprise (MDM) → Team (cloud, enterprise-only) → Project → User. **Cloud/background agents only read the project-level file** — a user-level-only install won't reach them.
- **Schema** (its own shape, closer to Claude Code's `hooks` wrapper than Antigravity's, but with its own extra fields):
  ```json
  { "version": 1, "hooks": { "<eventName>": [{ "command": "...", "type": "command", "timeout": 30, "matcher": "...", "loop_limit": 5, "failClosed": false }] } }
  ```
- **Events we hook**: `stop` (→ `task_complete`), `subagentStop` (→ `subagent_complete`), `beforeShellExecution`/`beforeMCPExecution` (→ `permission`, best-effort — see below), `afterAgentResponse` (idle-heuristic trigger only, never dispatches directly).
- **Payload fields used**: `conversation_id` (session id — Cursor has no `session_id` field), `workspace_roots` (array, not a single `cwd` — multi-root aware), `model`/`model_id`, `hook_event_name`.
- **Exit-code semantics differ from Claude Code**: exit `0` = success; exit `2` = block/deny; any other nonzero code = hook failure and **the action proceeds anyway** (fails open by default unless `failClosed: true`). Our hook command must always exit 0 and never print stdout Cursor might parse as a decision — `dispatch` already satisfies both.
- **`beforeShellExecution`/`beforeMCPExecution` caveat**: these are Cursor's approval **gate** points (a hook's response can itself allow/ask/deny), not a passive "the human is now being asked" signal the way Claude Code's `PermissionRequest` is. We map them to `permission` as the closest available analog, but deliberately never emit a decision ourselves — we only observe, never gate, Cursor's own approval flow.
- **No native idle event** — same heuristic-timer approach as Antigravity, triggered off `afterAgentResponse` instead of `PostToolUse`.

## GitHub Copilot Chat (VS Code extension)

- **No lifecycle API exists for third-party extensions, confirmed.** [microsoft/vscode#310951](https://github.com/microsoft/vscode/issues/310951) — a feature request asking for exactly this (a public API mirroring the internal `ChatSessionStatus`/`onDidChangeStatus`) — is closed **"not planned."** The Chat Participant API (`vscode.chat`) only lets an extension register its own `@participant`; it does not expose Copilot Chat's own panel/conversation lifecycle to observers.
- **The only real, working pattern**: give the model an **MCP tool** and rely on it choosing to call it during its own agent-mode tool loop — the same pattern used by prior art like [davidkelley/agent-notifier](https://github.com/davidkelley/agent-notifier). This repo implements it as `lib/mcp/server.js` (a minimal hand-rolled stdio JSON-RPC server, one tool: `notify`) plus `lib/adapters/copilot.js`, which writes the server registration into the workspace's `.vscode/mcp.json` and optionally proposes a custom instruction in `.github/copilot-instructions.md` telling Copilot to call it.
- **This is instruction-compliance, not a lifecycle guarantee** — the model can simply not call the tool, and it can never fire for something that happens before the model's next turn (e.g. a permission dialog Copilot itself raises outside the tool loop). Always surface this caveat to the user; never present it as equivalent to the real hooks the other adapters use. Because of that, it's excluded from the plain `notifier install all` / activation-time auto-install and requires the dedicated, explicit **Notifier: Set up GitHub Copilot Chat (MCP, best-effort)…** command.

## "Other" agents / editors — the generic adapter contract

Any agent that can invoke an arbitrary shell command with a JSON payload (on stdin, argv, or env vars) can be supported without a bespoke adapter, via a documented **generic adapter**:

- User points the generic adapter at their agent's hook command slot.
- User supplies a small mapping config (JSON) telling the adapter which payload field is the session id, cwd, and which values of which field indicate `permission` / `question` / `task_complete`.
- The generic adapter normalizes using that mapping and forwards to the same core engine.

This is how we honor "and other code editors/agents" without hard-coding every possible tool: Claude Code, Codex, and Antigravity ship as first-class adapters with zero config; everything else uses the generic adapter with a short one-time setup.

## Editor-side note

Hooks are registered against the **agent's** config directory, not the editor's. The editor extension's job is UI (status bar, settings, output channel) and *installing* the hook configs above — it is not in the notification data path. This is why the same core engine works identically from a bare terminal, Vim, JetBrains, or any VS Code-compatible IDE.
