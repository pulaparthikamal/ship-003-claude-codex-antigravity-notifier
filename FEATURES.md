# Claude Notifier — Feature Reference

Source: [Claude Notifier](https://marketplace.visualstudio.com/items?itemName=SingularityInc.claude-notifier) (publisher **SingularityInc**, VS Code Marketplace, v4.0.0/v4.5.0) — GitHub: [ashmitb95/claude-notifier](https://github.com/ashmitb95/claude-notifier).

## 1. Existing features (as shipped today)

### Core notification triggers
- Plays a sound and/or shows an OS notification when an agent:
  - finishes a task
  - needs permission
  - asks a question
  - a subagent stops (Codex)

### Per-event notification customization
- Each event type has its own level: `sound+popup | sound | popup | off`
- Each event can have its own sound preset assigned
- (v4.5.0) Custom label per event — emoji or text, capped at 24 characters
- (v4.5.0) `showChatTitle` / `showDetail` toggles control what's in the notification body (project/chat name vs. task detail) separately from the title

### Sound presets (per OS)
- macOS: Basso, Blow, Bottle, Frog, Funk, Glass, Hero, Morse, Ping, Pop, Purr, Sosumi, Submarine, Tink
- Windows: Windows Notify, tada, chimes, chord, ding, notify, ringin, Windows Background
- Linux: freedesktop XDG sounds (`/usr/share/sounds/freedesktop/stereo/`)
- Fallback: bundled WAV plays if the configured system sound file is missing on disk

### Noise-reduction / advanced settings
- `claudeNotifier.minTaskDurationThreshold` (seconds, default 0) — suppress notifications for tasks that finish faster than this
- `claudeNotifier.autoMuteWhenFocused` (default false) — suppress sound + popups while the VS Code window running the task is focused
- `claudeNotifier.suppressSubagentInteractions` (default true) — silence permission/question hooks that originate from a subagent
- `claudeNotifier.subagentCompleted.level` (default off)
- Deduplication — rapid back-to-back events in one session coalesce into one notification per stage instead of flooding
- Smart detection — no notifications inside Cursor (detects its Composer agent); detects `cmux` and defers; no stray notifications from a folderless window
- Notification title = workspace name / project directory name

### Codex integration
- `claudeNotifier.codex.enabled`
- Registers hooks in `~/.codex/hooks.json`
- Same sounds, per-event levels, mute/auto-mute behavior as Claude Code
- One manual trust step required: run `codex` in a terminal and accept "Trust all and continue"

### Remote host support
- `claudeNotifier.remoteAudio` — routes notification sound to the local machine instead of a headless remote
- Requires a `cn-daemon` helper + SSH reverse port forward
- Command: **Claude Notifier: Set up remote audio…**

### Mute controls
- Global mute via sentinel file: `~/.claude/hooks/claude-notifier-muted` (touch to mute, delete to unmute)
- Windows equivalent via PowerShell `New-Item`
- Per-session disable via `CLAUDE_NOTIFIER_DISABLE` env var (doesn't affect other sessions)

### UI / commands
- Status bar entry — hover for volume control, per-event sound preview/swap, min-duration threshold, auto-mute toggle
- Output channel: **View → Output → Claude Notifier** — activation, signal receipts, dedup decisions
- Commands:
  - `Claude Notifier: Set up remote audio…`
  - `Claude Notifier: Toggle Auto-mute When Focused`
  - `Claude Notifier: Install terminal-notifier (clickable macOS notifications)`

### macOS-specific
- Optional `terminal-notifier` install for clickable notifications (jump back to the triggering window/tab)
- Falls back to `osascript` if not installed

### Platform / editor coverage
- Editors: VS Code, terminal CLI, Vim, any editor driving Claude Code or Codex
- OS: macOS, Windows, WSL, Linux, remote hosts over SSH
- Install via marketplace, or CLI: `curl -fsSL https://raw.githubusercontent.com/ashmitb95/claude-notifier/main/install.sh | bash`

---

## 2. Gaps / reverse-engineering notes

This repo is named `ship-003-claude-codex-antigravity-notifier` — the existing extension covers **Claude Code + Codex only**. The obvious gap is **Antigravity** (Google's agentic IDE) support, plus a few rough edges worth improving on:

- No Antigravity hook integration at all today
- No unified "which agent/session is currently running" view when multiple agents (Claude, Codex, Antigravity) are active across windows
- No history/log of past notifications (only a live output channel, nothing persisted/searchable)
- No Slack/desktop-push relay when the IDE itself isn't focused/open (e.g. phone push, Slack DM)
- No per-project (vs. per-machine) mute/config — settings are global or per-session, not per-repo
- No "summarize what changed" in the notification body — just event + project name, not a diff/todo summary
- terminal-notifier / remote audio setup are manual, multi-step installs, not auto-detected/auto-installed

## 3. Proposed new features for this project

1. **Antigravity hook adapter** — register into Antigravity's agent-event hook mechanism (mirroring the `~/.codex/hooks.json` pattern) so it emits the same task-complete / needs-permission / needs-input events into the shared notifier pipeline.
2. **Unified agent registry** — one status-bar entry that shows counts/state across Claude, Codex, and Antigravity sessions simultaneously (e.g. "2 running · 1 waiting on you"), not just the last event.
3. **Notification history panel** — a sidebar/webview listing recent notifications (agent, project, event, timestamp) so a burst of coalesced/deduped events isn't silently lost.
4. **External relay channel** — optional webhook/Slack/push relay for when the notification should reach the user away from the machine (configurable per event type, reusing the existing per-event level model).
5. **Per-repo config overrides** — allow a `.claude-notifier.json` (or similar) checked into a repo to override global settings (e.g. mute noisy CI-heavy repos without muting everything).
6. **Rich notification body** — include a one-line summary of the finished task (from the agent's final message) instead of just event type + project name, gated behind the existing `showDetail` toggle.
7. **Auto-installer for platform helpers** — detect and offer to install `terminal-notifier` (macOS) and the remote-audio daemon automatically on first run, instead of requiring a manual command.
8. **Cross-agent dedup** — extend the existing same-session dedup so that if Claude and Codex (or Antigravity) fire near-identical events for the same workspace within a short window, they coalesce too.
