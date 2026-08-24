# Notifier — Claude, Codex, Antigravity & Cursor

![Notifier](resources/icon.png)

Sound + popup notifications when Claude Code, Codex, Antigravity, or Cursor finish a task, need permission, or ask a question. Same package installs unmodified in VS Code and in Antigravity (a VS Code fork). GitHub Copilot Chat gets a best-effort MCP-based notify tool (see Limitations).

## Features

- Detects and hooks into **Claude Code**, **Codex CLI**, **Antigravity**, and **Cursor** — one install covers all four.
- On first activation, asks before enabling anything, and fires a real test notification right then — this is also what gets Notifier to actually show up under your OS's notification settings (macOS/Windows only list an app there once it's tried to notify at least once).
- Sound + OS popup on task-complete, permission-needed, and question events.
- Per-event sound picker, volume control, and threshold tuning — no config file editing required.
- Status bar entry with mute / unmute / auto-mute-when-focused.
- Status & history view via the **Notifier: Show Status & History** command.
- Per-repo config overrides (`.notifier.json`) on top of global settings.

## Limitations (read before filing "notifications don't work")

- **GitHub Copilot Chat has no lifecycle API** a third-party extension can observe (confirmed: a feature request asking for exactly this, [microsoft/vscode#310951](https://github.com/microsoft/vscode/issues/310951), is closed "not planned"). `Notifier: Set up GitHub Copilot Chat (MCP, best-effort)…` registers a `notify` MCP tool the model can *choose* to call — it's instruction-compliance, not a guaranteed event. It can be skipped by the model, and it can never fire for something that happens before the model's next turn.
- **Antigravity on Windows has a known, currently-unresolved upstream bug** where `Stop`/`PostToolUse` hooks don't fire at all for some users/versions, independent of anything this extension does (see a live report at the Google AI developer forum). If hooks never fire on Windows+Antigravity even after a fresh install, this is very likely it — not a config issue on your end.
- Every hook command needs *some* real Node.js runtime reachable at install time. Run **`Notifier: Run Doctor`** and look for the `node binary hooks will invoke` line; if it warns about no standalone node, install Node.js and re-run `Notifier: Install Hooks`.

## How to run a command

All Notifier commands run through the **Command Palette**:

1. Press **`Ctrl+Shift+P`** (Windows/Linux) or **`Cmd+Shift+P`** (macOS). Works the same way in both VS Code and Antigravity.
2. Type **`Notifier`** — every command below appears in the filtered list.
3. Select the one you want and press **Enter**.

## Commands

| Command | What it does | Steps |
|---|---|---|
| `Notifier: Install Hooks (Claude, Codex, Antigravity)` | Registers hooks for Claude Code, Codex, Antigravity, and Cursor | `Ctrl+Shift+P` → type `Notifier: Install Hooks` → Enter |
| `Notifier: Enable Notifications…` | Re-runs the first-run consent flow: choose sound+popups / popups-only / off, then fires a real test notification | `Ctrl+Shift+P` → type `Notifier: Enable Notifications` → Enter |
| `Notifier: Open OS Notification Settings` | Opens your OS's notification settings pane directly (macOS/Windows) | `Ctrl+Shift+P` → type `Notifier: Open OS Notification` → Enter |
| `Notifier: Set up GitHub Copilot Chat (MCP, best-effort)…` | Registers a `notify` MCP tool for Copilot Chat's agent mode and optionally adds a custom instruction telling it to call it — see Limitations, this is not a real hook | `Ctrl+Shift+P` → type `Notifier: Set up GitHub Copilot` → Enter |
| `Notifier: Run Doctor` | Diagnoses hook install issues, including which Node binary hook commands will actually invoke | `Ctrl+Shift+P` → type `Notifier: Run Doctor` → Enter |
| `Notifier: Rate this Extension` | Opens the review UI for wherever this install actually came from (VS Code Marketplace or Open VSX) | `Ctrl+Shift+P` → type `Notifier: Rate` → Enter |
| `Notifier: Preview Sound…` | Plays a sound preset so you can audition it before assigning it | `Ctrl+Shift+P` → type `Notifier: Preview Sound` → Enter → pick a sound from the list |
| `Notifier: Choose Sound…` | Assigns a sound preset to a specific event (task complete, permission, question, idle, subagent done, error) | `Ctrl+Shift+P` → type `Notifier: Choose Sound` → Enter → pick the event → pick the sound |
| `Notifier: Set Volume` | Sets notification sound volume (0–100%) | `Ctrl+Shift+P` → type `Notifier: Set Volume` → Enter → type a percentage → Enter |
| `Notifier: Set Threshold` | Suppresses task-complete notifications for tasks shorter than N seconds | `Ctrl+Shift+P` → type `Notifier: Set Threshold` → Enter → type a number of seconds → Enter |
| `Notifier: Toggle Sound` | One-shot mute/unmute toggle | `Ctrl+Shift+P` → type `Notifier: Toggle Sound` → Enter |
| `Notifier: Mute` / `Notifier: Unmute` | Explicit global on/off switch | `Ctrl+Shift+P` → type `Notifier: Mute` (or `Unmute`) → Enter |
| `Notifier: Toggle Auto-mute When Focused` | Suppress notifications while this window is focused | `Ctrl+Shift+P` → type `Notifier: Toggle Auto-mute` → Enter |
| `Notifier: Set up remote audio (play sounds locally over SSH)…` | Routes notification sound to your local machine when the agent runs on a headless remote host | `Ctrl+Shift+P` → type `Notifier: Set up remote audio` → Enter → type the relay port → Enter → follow the two steps printed in the **Notifier** output channel |
| `Notifier: Install terminal-notifier (clickable macOS notifications)` | Installs `terminal-notifier` via Homebrew so macOS popups are clickable | `Ctrl+Shift+P` → type `Notifier: Install terminal-notifier` → Enter (opens a terminal running `brew install terminal-notifier`) |
| `Notifier: Open Settings` | Opens the Settings UI filtered to Notifier's options | `Ctrl+Shift+P` → type `Notifier: Open Settings` → Enter |
| `Notifier: Show Status & History` | Opens the output channel with current config + recent notifications | `Ctrl+Shift+P` → type `Notifier: Show Status & History` → Enter |

## Settings

Reachable via **`Notifier: Open Settings`**, or directly in `settings.json`:

- `notifier.autoMuteWhenFocused` (boolean, default `false`) — suppress sound + popups while this window is focused.
- `notifier.minTaskDurationThreshold` (number, default `0`) — suppress task-complete notifications for tasks shorter than this many seconds.
- `notifier.volume` (number, default `1`) — notification sound volume, 0 (silent) to 1 (full).

## Requirements

- Claude Code, Codex CLI, Antigravity, and/or Cursor installed and used from this machine.
- Codex hooks require one manual trust step: run `codex` once in a terminal and accept "Trust all and continue".
- A real, standalone Node.js install reachable at hook-install time (see Limitations above) — `Notifier: Run Doctor` confirms this.

## More

Full docs, architecture, and per-agent hook details: [github.com/pulaparthikamal/ship-003-claude-codex-antigravity-notifier](https://github.com/pulaparthikamal/ship-003-claude-codex-antigravity-notifier).
