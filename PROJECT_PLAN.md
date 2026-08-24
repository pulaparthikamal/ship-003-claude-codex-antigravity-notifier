# Project Plan

Scope: clean-room reimplementation of every feature in [FEATURES.md](FEATURES.md) §1, plus the Antigravity support and other gaps identified in §2–3, built on the architecture in [ARCHITECTURE.md](ARCHITECTURE.md) and the agent facts in [AGENT_INTEGRATIONS.md](AGENT_INTEGRATIONS.md).

## Implementation status

**Fixed (2026-08-24)**: a real-world install surfaced four separate root causes for "no notification/sound," on top of adding Cursor and GitHub Copilot Chat support:
1. **`process.execPath` inside the VS Code/Antigravity extension host is the editor's own Electron helper binary, not a real Node** — it only worked when the agent invoking the baked-in hook command happened to be a descendant of the editor's own process tree (inheriting `ELECTRON_RUN_AS_NODE=1`); confirmed by reproducing the crash directly (`Unable to find helper app`) with that env var stripped. This is why Claude Code notifications "just worked" on one machine while Antigravity's separate backend engine got nothing. Fixed: `bin/notifier.js`'s `findRealNode()` resolves a real, absolute `node` path via `which`/`where` at install time. See ARCHITECTURE.md's "Critical gotcha" section.
2. **Antigravity's hooks.json schema was wrong** — flat event keys at the document root instead of the required named-hook-key wrapper, so Antigravity silently never recognized the registration at all. Fixed in `lib/adapters/antigravity.js`; confirmed against `antigravity.google/docs/hooks/`. (Also: `PostToolUse`/unapproved `PreToolUse` were defaulting to `task_complete`, firing a notification on every tool call — fixed to return `null`/no-dispatch instead.)
3. **Windows popups used a blocking `MessageBox.Show`**, which waits for a human click — every agent kills hook commands after a short timeout (5-10s), so the notification was reliably killed before it could ever render. Fixed: a non-blocking WinRT toast, with popup/sound processes now spawned detached+unref'd everywhere so a killed hook can't take the notification down with it.
4. **Linux `notify-send`/audio calls silently failed** when a hook subprocess lacked `DISPLAY`/`DBUS_SESSION_BUS_ADDRESS`/`XDG_RUNTIME_DIR` (common for processes spawned by a CLI agent rather than a direct login session) — fixed with uid-derived defaults in `lib/core/platformEnv.js`. Also fixed: the Linux sound backend was ignoring the `preset` argument entirely and always playing the same tone.

New: first-run consent flow in the extension (asks before enabling sound+popups, fires a real test notification at that moment — which is also what gets an app to show up under macOS/Windows notification settings at all); a first-class **Cursor** adapter (real hooks feature, confirmed via `cursor.com/docs/hooks`); a best-effort MCP `notify` tool for **GitHub Copilot Chat**, which has no lifecycle API at all (confirmed: `microsoft/vscode#310951`, closed "not planned") — explicitly excluded from the default `install all` and gated behind its own consent dialog since it's instruction-compliance, not a real hook.

**Tested (2026-08-22)**: full CLI functional pass against a fresh sandbox `$HOME` — hook install/uninstall for all three agents, dedup (per-session and cross-agent), min-duration threshold, subagent suppression, mute, per-repo `.notifier.json` override, the Antigravity idle heuristic (including the newer-activity-cancels-stale-check path), and the remote-audio relay daemon/client round-trip. Found and fixed two real bugs in the process: (1) `lib/core/engine.js` was recording an event as `dispatched: true` in history/status even when its per-event `level` was `off` — history now reflects the actual outcome, not just the pre-level-check dedup decision; (2) the packaged VSIX only bundled `vscode-extension/`'s own files, so `extension.js`'s `../bin/notifier.js` reference would have been missing at runtime once installed standalone — fixed with a `vscode:prepublish` step (`scripts/vendor.js`) that copies `bin/`+`lib/` into the extension before packaging, with a repo-root fallback path in `extension.js` for local dev before that step has run. `vsce package` produces a working, self-contained 19KB VSIX. Extension activation logic (commands, status bar, output channel, hook-install-on-activate, mute/toggle-auto-mute, focus handler) verified against a mocked `vscode` API, since no real VS Code/Antigravity host was available in the sandbox. Marketplace publish itself is pending real account credentials (publisher id `kamalpulaparthi` is wired in; PAT/publish is left to be run by hand — see [DEPLOYMENT.md](DEPLOYMENT.md)).

**Built.** M0–M4 are implemented as plain Node.js (no TypeScript build step, no npm workspaces — a single package with `lib/` subfolders, per the deviations below) and manually smoke-tested (`install`/`uninstall`/`dispatch`/`mute`/`status` round-tripped against a fake `HOME`). See [README.md](README.md) for the runnable quickstart and [DEPLOYMENT.md](DEPLOYMENT.md) for shipping it.

Deliberate deviations from the original sketch, made to keep the implementation minimal while staying correct:
- **Plain JS, single package** instead of a TS monorepo with separate workspace packages — same `lib/core` / `lib/adapters` / `lib/relay` split, just no build step or multiple `package.json`s to keep in sync.
- **No bundled fallback WAV** — sound backend uses each OS's native sound assets/players and falls back to a terminal bell (`\x07`) rather than shipping a binary asset.
- ~~Windows popup is a blocking `MessageBox`, not a toast~~ — **fixed 2026-08-24**, see the Implementation status entry above; now a non-blocking WinRT toast with `MessageBox` only as a last-resort, detached fallback.
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
- ~~Windows toast implementation~~ — resolved 2026-08-24: WinRT `ToastNotificationManager` via a PowerShell one-liner, borrowing PowerShell's own registered AUMID (no BurntToast/native helper needed).
- **Antigravity-on-Windows hooks not firing at all is a live, unresolved upstream bug** (independent of this repo — see AGENT_INTEGRATIONS.md's Antigravity section) as of the versions tested in the linked report. Revisit once Google ships a fix; don't spend more local debugging time assuming it's a config issue here.
- **External relay channel (M5.7)** touches credentials/webhooks — needs its own short design note before coding, not just a milestone bullet.
