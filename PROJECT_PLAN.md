# Project Plan

Scope: clean-room reimplementation of every feature in [FEATURES.md](FEATURES.md) §1, plus the Antigravity support and other gaps identified in §2–3, built on the architecture in [ARCHITECTURE.md](ARCHITECTURE.md) and the agent facts in [AGENT_INTEGRATIONS.md](AGENT_INTEGRATIONS.md).

## Implementation status

**Tested (2026-08-22)**: full CLI functional pass against a fresh sandbox `$HOME` — hook install/uninstall for all three agents, dedup (per-session and cross-agent), min-duration threshold, subagent suppression, mute, per-repo `.notifier.json` override, the Antigravity idle heuristic (including the newer-activity-cancels-stale-check path), and the remote-audio relay daemon/client round-trip. Found and fixed two real bugs in the process: (1) `lib/core/engine.js` was recording an event as `dispatched: true` in history/status even when its per-event `level` was `off` — history now reflects the actual outcome, not just the pre-level-check dedup decision; (2) the packaged VSIX only bundled `vscode-extension/`'s own files, so `extension.js`'s `../bin/notifier.js` reference would have been missing at runtime once installed standalone — fixed with a `vscode:prepublish` step (`scripts/vendor.js`) that copies `bin/`+`lib/` into the extension before packaging, with a repo-root fallback path in `extension.js` for local dev before that step has run. `vsce package` produces a working, self-contained 19KB VSIX. Extension activation logic (commands, status bar, output channel, hook-install-on-activate, mute/toggle-auto-mute, focus handler) verified against a mocked `vscode` API, since no real VS Code/Antigravity host was available in the sandbox. Marketplace publish itself is pending real account credentials (publisher id `kamalpulaparthi` is wired in; PAT/publish is left to be run by hand — see [DEPLOYMENT.md](DEPLOYMENT.md)).

**Built.** M0–M4 are implemented as plain Node.js (no TypeScript build step, no npm workspaces — a single package with `lib/` subfolders, per the deviations below) and manually smoke-tested (`install`/`uninstall`/`dispatch`/`mute`/`status` round-tripped against a fake `HOME`). See [README.md](README.md) for the runnable quickstart and [DEPLOYMENT.md](DEPLOYMENT.md) for shipping it.

Deliberate deviations from the original sketch, made to keep the implementation minimal while staying correct:
- **Plain JS, single package** instead of a TS monorepo with separate workspace packages — same `lib/core` / `lib/adapters` / `lib/relay` split, just no build step or multiple `package.json`s to keep in sync.
- **No bundled fallback WAV** — sound backend uses each OS's native sound assets/players and falls back to a terminal bell (`\x07`) rather than shipping a binary asset.
- **Windows popup is a blocking `MessageBox`**, not a toast — flagged as a TODO in `lib/core/popup.js`; fine for v1, worth revisiting.
- **Antigravity idle detection** is a self-canceling detached process per `PostToolUse` event (writes a marker, sleeps 60s, checks if a newer marker superseded it) rather than a persistent daemon — matches the "no daemon" principle in ARCHITECTURE.md while still delivering the M2 idle heuristic.
- **M5 new-feature set delivered so far**: per-repo `.notifier.json` overrides, rich detail in the notification body, and cross-agent dedup (same project + kind within the coalescing window, across different agents) are implemented in `lib/core/config.js`/`state.js`. Notification history is a `status`/output-channel dump rather than a dedicated webview panel — same information, lighter implementation. Auto-installer for platform helpers and the external Slack/webhook relay (M5.5, M5.7) are **not implemented** — they're the two items explicitly called out below as needing their own design pass, and were deprioritized to keep the shipped surface small and correct rather than broad and half-finished.

## Tech stack decisions

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript / Node.js everywhere | one codebase shared by CLI, adapters, and the extension; matches the ecosystem the original tool and all three agents already assume (Node is on every dev machine that runs Claude Code/Codex) |
| Repo shape | Monorepo, npm/pnpm workspaces | adapters and core must stay in lockstep with the extension; a monorepo avoids version-skew bugs between `notifier-cli` and the VSIX |
| Persistence | Flat JSON files under `~/.notifier/` (`config.json`, `state.json`) | no daemon, no DB — matches "hook command is a short-lived process" constraint from [ARCHITECTURE.md](ARCHITECTURE.md#why-not-a-persistent-daemon-for-the-core-engine) |
| Distribution | VS Code Marketplace + Open VSX (for Antigravity/forks that pull from Open VSX) for the extension; npm package with a `bin` entry + curl-installer script for the CLI | matches original tool's two install paths, covers editor-having and editor-less users |

## Milestones

### M0 — Foundations (no user-visible behavior yet)
- Monorepo scaffold (`packages/core`, `adapters`, `cli`, `relay`, `vscode-extension`), workspace tooling, lint/format/CI.
- `CanonicalEvent` type + config schema (both from ARCHITECTURE.md) implemented in `core`, with unit tests only — no real dispatch yet.
- **Exit criteria**: `core` package has 90%+ coverage on dedup/threshold/mute logic using synthetic events; nothing installed on a real agent yet.

### M1 — Claude Code end-to-end (single agent, CLI-only, macOS first)
- `adapters/claude`: normalizer for `Notification`/`PermissionRequest`/`Stop`/`SubagentStop`.
- `cli install claude`: writes `~/.claude/settings.json` hook entries pointing at `notifier-cli dispatch`.
- macOS sound + popup backends (`afplay`, `osascript`).
- **Exit criteria**: running Claude Code locally on macOS produces a real sound+popup on permission/idle/stop, with dedup and mute verified manually.

### M2 — Multi-platform + Codex + Antigravity adapters
- Windows/Linux sound+popup backends.
- `adapters/codex` (incl. legacy `--notify` fallback) and `adapters/antigravity` (incl. the idle-heuristic timer noted in AGENT_INTEGRATIONS.md).
- Generic adapter + its config format, documented for "other agents."
- **Exit criteria**: same permission/idle/complete flows verified on Windows + Linux, and separately against a real Codex CLI session and a real Antigravity session.

### M3 — Editor integration layer
- `vscode-extension`: settings UI, status bar (volume/preview/threshold/auto-mute), output channel, activation-time `install()` calls into the relevant adapters, focus-flag writer.
- Verify the same VSIX loads and works unmodified inside Antigravity (per the fork-compatibility fact in ARCHITECTURE.md) — this is a **verification task, not a build task**, and is a hard gate before M3 is called done.
- **Exit criteria**: install once from the Marketplace, works identically in VS Code and Antigravity; status bar controls round-trip into `~/.notifier/config.json`.

### M4 — Advanced/original-parity features
- Remote audio relay + SSH reverse-forward setup command.
- macOS `terminal-notifier` optional install command for clickable notifications.
- Notification labels (emoji/text, 24-char cap), `showChatTitle`/`showDetail` toggles.
- **Exit criteria**: full parity with FEATURES.md §1.

### M5 — New features (from FEATURES.md §3)
Ordered by dependency, not just priority — each bullet below is independently shippable:
1. Notification history panel (webview in the extension, reads a capped ring-buffer log the core engine already writes).
2. Per-repo config overrides (`.notifier.json` in a repo root, merged over `~/.notifier/config.json`).
3. Rich notification body (agent-provided summary in `detail`, already plumbed through `CanonicalEvent` since M0 — this milestone is mostly "populate it well per adapter," not new plumbing).
4. Unified multi-agent status bar (aggregate state across concurrently running claude/codex/antigravity sessions, read from `state.json`).
5. Auto-installer for platform helpers (`terminal-notifier`, remote-audio daemon) offered on first run instead of a manual command.
6. Cross-agent dedup (extend the existing per-session dedup key to also coalesce same-project events across different agents within the coalescing window).
7. External relay channel (webhook/Slack) — biggest scope item, deliberately last; needs its own mini design pass (auth storage, rate limits) before implementation.

## Work breakdown by package (cuts across milestones)

- **core**: CanonicalEvent, config schema + loader, dedup/mute/threshold engine, sound/popup backend interfaces + platform impls, log writer. Owner of all logic in ARCHITECTURE.md's "Core engine responsibilities."
- **adapters**: one file per agent (`claude.ts`, `codex.ts`, `antigravity.ts`, `generic.ts`), each exporting `install()`, `uninstall()`, `normalize(rawPayload): CanonicalEvent`.
- **cli**: argument parsing, `install|uninstall|mute|unmute|status|doctor|dispatch` subcommands. `dispatch` is the actual command every agent hook invokes.
- **relay**: remote-audio daemon + SSH setup helper, isolated because it's the only component that's a long-running process.
- **vscode-extension**: UI only, per ARCHITECTURE.md's editor-integration-layer principle — must not reimplement engine logic, only call into `cli`/`core`.

## Testing strategy

- **core**: unit tests with synthetic `CanonicalEvent` streams — dedup windows, threshold edges, mute-file presence/absence, focus-flag interaction.
- **adapters**: fixture-based tests using real captured payloads from each agent's docs/forums (already sourced in AGENT_INTEGRATIONS.md) — assert `normalize()` output shape, not live agent calls.
- **cli**: integration tests that actually write to a temp `HOME` and assert the correct hook config file (`.claude/settings.json`, `~/.codex/hooks.json`, `.agents/hooks.json`) is produced.
- **extension**: manual verification checklist per milestone (VS Code Extension Test Runner for command/activation wiring; sound/popup output is inherently manual/OS-level).
- **cross-editor gate**: M3's Antigravity-compatibility check is a manual smoke test run before every release, not just once at M3.

## Risks / open questions

- **Antigravity has no native "waiting on input" hook event today** — the idle-heuristic timer is a workaround, not equivalent fidelity to Claude Code's `idle_prompt`. Revisit if/when Antigravity ships a dedicated event (track the upstream issue referenced in AGENT_INTEGRATIONS.md).
- **Codex's legacy `--notify` vs. `hooks.json`** — need to confirm which Codex CLI versions in the wild still need the legacy path before deciding whether to ship it as day-1 or a fallback added if users report it's needed.
- **Windows toast implementation** — needs a concrete choice (PowerShell snippet vs. a small native helper) before M2 starts; not yet decided, flag for a quick spike at the start of M2.
- **External relay channel (M5.7)** touches credentials/webhooks — needs its own short design note before coding, not just a milestone bullet.
