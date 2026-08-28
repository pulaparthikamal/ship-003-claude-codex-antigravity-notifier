const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

// Same VSIX loads unmodified in VS Code and Antigravity (a VS Code fork) —
// this file must stay UI-only per ARCHITECTURE.md#editor-integration-layer;
// all real logic lives in ./lib and is only ever invoked via the CLI.
// ./bin and ./lib are vendored copies of the repo root's, copied in by
// scripts/vendor.js (runs as the vscode:prepublish step) so the packaged
// VSIX is self-contained — see DEPLOYMENT.md. Fall back to the repo-root copy
// when running unpackaged (local dev before the vendor step has run).
const vendoredCliPath = path.join(__dirname, 'bin', 'notifier.js');
const cliPath = fs.existsSync(vendoredCliPath) ? vendoredCliPath : path.join(__dirname, '..', 'bin', 'notifier.js');
const isVendored = fs.existsSync(vendoredCliPath);
const copilotAdapter = require(isVendored ? './lib/adapters/copilot' : '../lib/adapters/copilot');

function workspaceCwd() {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0] ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
}

// cwd matters: the CLI's `install antigravity` writes hooks relative to its
// own process.cwd() (a per-workspace .agents/hooks.json), unlike the Claude/
// Codex adapters which always target a fixed path under $HOME. Without
// explicitly pinning cwd here, execFile inherits the extension host's own
// working directory (not the open project folder), so Antigravity hooks
// silently land somewhere useless and no notification ever fires.
function run(args, cwd = workspaceCwd()) {
  return new Promise((resolve) => {
    cp.execFile(process.execPath, [cliPath, ...args], { cwd }, (err, stdout, stderr) => resolve(err ? `error: ${err.message}\n${stderr || ''}` : stdout || ''));
  });
}

const SOUND_PRESETS = ['Ping', 'Glass', 'Hero', 'Basso', 'Pop', 'Morse', 'Sosumi', 'Submarine', 'Tink', 'Frog', 'Funk', 'Purr', 'Blow', 'Bottle'];
const EVENT_KINDS = [
  { kind: 'task_complete', label: '✅ Task complete' },
  { kind: 'permission', label: '🔐 Needs approval (permission)' },
  { kind: 'question', label: '❓ Question' },
  { kind: 'idle', label: '💤 Idle' },
  { kind: 'subagent_complete', label: '🤖 Subagent done' },
  { kind: 'error', label: '⚠️ Error' }
];

function platformNotificationHelp() {
  if (process.platform === 'darwin') {
    return 'On macOS: System Settings → Notifications → look for "Script Editor" or "terminal-notifier" and make sure it\'s allowed. Also check the Notifier volume isn\'t 0.';
  }
  if (process.platform === 'win32') {
    return 'On Windows: Settings → System → Notifications — make sure notifications are on and Focus Assist isn\'t blocking them.';
  }
  return 'On Linux: make sure a notification daemon is running (most desktops ship one) and libnotify-bin is installed (for notify-send).';
}

async function openNotificationSettings() {
  if (process.platform === 'darwin') {
    await vscode.env.openExternal(vscode.Uri.parse('x-apple.systempreferences:com.apple.preference.notifications'));
  } else if (process.platform === 'win32') {
    await vscode.env.openExternal(vscode.Uri.parse('ms-settings:notifications'));
  } else {
    vscode.window.showInformationMessage(platformNotificationHelp());
  }
}

// Fires a real test notification+sound right at the moment of consent. This
// matters beyond UX: on macOS and Windows, the OS only lists an app under its
// Notifications settings once that app has actually attempted to show one —
// asking-then-immediately-testing is what gets Notifier to appear there at
// all, instead of a silently-blocked notification the user never gets a
// chance to allow.
async function testFireAndVerify(out) {
  await run(['test-sound', 'Ping']);
  const seen = await vscode.window.showInformationMessage('Did you just see a popup and hear a sound?', 'Yes, it worked', 'No, nothing happened');
  if (seen === 'No, nothing happened') {
    const pick = await vscode.window.showWarningMessage(platformNotificationHelp(), 'Open notification settings');
    if (pick) await openNotificationSettings();
  }
  out.appendLine(`Test notification fired (${seen || 'no response'}).`);
}

const EXTENSION_ID = 'kamalpulaparthi.notifier';

// Prefer VS Code's own built-in rating command — it's gallery-aware, so it
// opens the correct review UI for wherever this specific install actually
// came from (VS Code Marketplace or Open VSX), without us having to guess.
// Only extensions installed from a gallery can be rated at all; if this
// install came from a bare .vsix with no gallery metadata, the command
// throws, and there is no separate rating UI to fall back to — surface that
// plainly instead of silently doing nothing.
async function openRatingPage() {
  try {
    await vscode.commands.executeCommand('workbench.extensions.action.rateExtension', EXTENSION_ID);
  } catch {
    vscode.window.showInformationMessage(
      "This install has no marketplace/gallery attached (e.g. installed from a bare .vsix), so there's no rating UI to open. Install from the VS Code Marketplace or Open VSX instead to be able to rate it."
    );
  }
}

// One-time, unobtrusive nudge — never on first run, never more than once,
// always dismissible for good. Exists because "people couldn't find how to
// rate it" is at least as likely a cause as any platform-side bug.
async function maybeNudgeForRating(context) {
  if (context.globalState.get('notifier.ratingNudgeDone')) return;
  const firstActivatedAt = context.globalState.get('notifier.firstActivatedAt');
  if (!firstActivatedAt) {
    context.globalState.update('notifier.firstActivatedAt', Date.now());
    return;
  }
  if ((Date.now() - firstActivatedAt) / (1000 * 60 * 60 * 24) < 3) return;
  context.globalState.update('notifier.ratingNudgeDone', true);
  const pick = await vscode.window.showInformationMessage("Notifier's been running for a few days — if it's been useful, a quick rating helps others find it.", 'Rate it', 'Not now');
  if (pick === 'Rate it') await openRatingPage();
}

async function runOnboarding(context, out) {
  const choice = await vscode.window.showInformationMessage(
    'Notifier can pop up a notification and play a sound when Claude Code, Codex, Antigravity, or Cursor finish a task, need permission, or ask a question. Enable it?',
    'Enable sound + popups',
    'Popups only (no sound)',
    'Not now'
  );
  // subagent_complete is deliberately excluded — it defaults to 'off' because
  // subagent chatter is noisy by nature; onboarding shouldn't override that.
  const onboardedKinds = EVENT_KINDS.filter((k) => k.kind !== 'subagent_complete').map((k) => k.kind);
  if (choice === 'Enable sound + popups') {
    for (const kind of onboardedKinds) await run(['config-set', `events.${kind}.level`, 'sound+popup']);
    await testFireAndVerify(out);
  } else if (choice === 'Popups only (no sound)') {
    for (const kind of onboardedKinds) await run(['config-set', `events.${kind}.level`, 'popup']);
    await testFireAndVerify(out);
  }
  context.globalState.update('notifier.onboarded', true);
}

// Maps a per-agent VS Code setting to the CLI's agents.<name> config key, so
// unchecking e.g. "Enable Cursor" actually stops `install all` from writing
// .cursor/hooks.json into every workspace this extension activates in (see
// the matching check in bin/notifier.js's `install` case) instead of only
// silencing notifications after the fact.
const AGENT_SETTINGS = { enableClaude: 'claude', enableCodex: 'codex', enableAntigravity: 'antigravity', enableCursor: 'cursor' };

async function syncAgentToggles() {
  const cfg = vscode.workspace.getConfiguration('notifier');
  for (const [settingKey, agentName] of Object.entries(AGENT_SETTINGS)) {
    await run(['config-set', `agents.${agentName}`, String(cfg.get(settingKey))]);
  }
}

async function syncAgentTogglesAndInstall(out) {
  await syncAgentToggles();
  out.appendLine((await run(['install', 'all'])).trim() || 'hooks updated');
}

function activate(context) {
  const out = vscode.window.createOutputChannel('Notifier');
  out.appendLine('Notifier activated');

  syncAgentTogglesAndInstall(out);

  if (!context.globalState.get('notifier.onboarded')) {
    runOnboarding(context, out);
  }
  maybeNudgeForRating(context);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(bell) Notifier';
  status.tooltip = 'Notifier — click for status & history';
  status.command = 'notifier.openHistory';
  status.show();

  const syncSetting = (key) => run(['config-set', key, String(vscode.workspace.getConfiguration('notifier').get(key))]);

  context.subscriptions.push(
    status,
    vscode.commands.registerCommand('notifier.installAll', async () => out.appendLine(await run(['install', 'all']))),
    vscode.commands.registerCommand('notifier.mute', async () => out.appendLine(await run(['mute']))),
    vscode.commands.registerCommand('notifier.unmute', async () => out.appendLine(await run(['unmute']))),
    vscode.commands.registerCommand('notifier.toggleAutoMute', async () => {
      const cfg = vscode.workspace.getConfiguration('notifier');
      const cur = cfg.get('autoMuteWhenFocused');
      await cfg.update('autoMuteWhenFocused', !cur, true);
      out.appendLine(`autoMuteWhenFocused -> ${!cur}`);
    }),
    vscode.commands.registerCommand('notifier.openHistory', async () => {
      out.show();
      out.appendLine(await run(['status']));
    }),
    vscode.commands.registerCommand('notifier.runDoctor', async () => {
      out.show();
      out.appendLine(await run(['doctor']));
    }),
    vscode.commands.registerCommand('notifier.rateExtension', () => openRatingPage()),
    vscode.commands.registerCommand('notifier.previewSound', async () => {
      const picked = await vscode.window.showQuickPick(SOUND_PRESETS, { placeHolder: 'Preview a notification sound' });
      if (!picked) return;
      await run(['test-sound', picked]);
    }),
    vscode.commands.registerCommand('notifier.chooseSound', async () => {
      const event = await vscode.window.showQuickPick(
        EVENT_KINDS.map((e) => ({ label: e.label, kind: e.kind })),
        { placeHolder: 'Which event do you want to change the sound for?' }
      );
      if (!event) return;
      const sound = await vscode.window.showQuickPick(SOUND_PRESETS, { placeHolder: `Sound for ${event.label}` });
      if (!sound) return;
      await run(['config-set', `events.${event.kind}.sound`, sound]);
      await run(['test-sound', sound]);
      out.appendLine(`${event.kind} sound -> ${sound}`);
    }),
    vscode.commands.registerCommand('notifier.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', 'notifier')),
    vscode.commands.registerCommand('notifier.enableNotifications', () => runOnboarding(context, out)),
    vscode.commands.registerCommand('notifier.openNotificationSettings', () => openNotificationSettings()),
    vscode.commands.registerCommand('notifier.setupCopilotMcp', async () => {
      const r = await run(['install', 'copilot']);
      out.appendLine(r.trim() || 'Copilot MCP server registered.');
      const pick = await vscode.window.showInformationMessage(
        'Registered a local "notifier" MCP server for GitHub Copilot Chat. IMPORTANT: Copilot Chat has no lifecycle API to hook into — this only works if the model chooses to call the tool, so it can miss events or be skipped entirely. Add a custom instruction so Copilot actually calls it?',
        'Add recommended instruction',
        'Skip'
      );
      if (pick === 'Add recommended instruction') {
        const cwd = workspaceCwd();
        if (!cwd) {
          vscode.window.showWarningMessage('Open a workspace folder first.');
          return;
        }
        const instrPath = path.join(cwd, '.github', 'copilot-instructions.md');
        fs.mkdirSync(path.dirname(instrPath), { recursive: true });
        const existing = fs.existsSync(instrPath) ? fs.readFileSync(instrPath, 'utf8') : '';
        if (!existing.includes(copilotAdapter.RECOMMENDED_INSTRUCTION)) {
          fs.writeFileSync(instrPath, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}\n${copilotAdapter.RECOMMENDED_INSTRUCTION}\n`);
        }
        out.appendLine(`Added recommended instruction to ${instrPath}`);
        const doc = await vscode.workspace.openTextDocument(instrPath);
        vscode.window.showTextDocument(doc);
      }
    }),
    vscode.commands.registerCommand('notifier.setThreshold', async () => {
      const cfg = vscode.workspace.getConfiguration('notifier');
      const value = await vscode.window.showInputBox({
        prompt: 'Suppress task-complete notifications for tasks shorter than this many seconds',
        value: String(cfg.get('minTaskDurationThreshold') ?? 0),
        validateInput: (v) => (isNaN(Number(v)) || Number(v) < 0 ? 'Enter a number ≥ 0' : undefined)
      });
      if (value === undefined) return;
      await cfg.update('minTaskDurationThreshold', Number(value), true);
      out.appendLine(`minTaskDurationThreshold -> ${value}`);
    }),
    vscode.commands.registerCommand('notifier.setVolume', async () => {
      const cfg = vscode.workspace.getConfiguration('notifier');
      const current = cfg.get('volume');
      const value = await vscode.window.showInputBox({
        prompt: 'Notification volume, 0-100%',
        value: String(Math.round((current ?? 1) * 100)),
        validateInput: (v) => (isNaN(Number(v)) || Number(v) < 0 || Number(v) > 100 ? 'Enter a number between 0 and 100' : undefined)
      });
      if (value === undefined) return;
      const volume = Number(value) / 100;
      await cfg.update('volume', volume, true);
      await run(['config-set', 'volume', String(volume)]);
      await run(['test-sound', 'Ping']);
      out.appendLine(`volume -> ${volume}`);
    }),
    vscode.commands.registerCommand('notifier.toggleSound', async () => {
      const statusJson = await run(['status']);
      let muted = false;
      try {
        muted = JSON.parse(statusJson).muted;
      } catch {
        /* assume unmuted if status couldn't be parsed */
      }
      await run([muted ? 'unmute' : 'mute']);
      out.appendLine(muted ? 'Unmuted.' : 'Muted.');
      vscode.window.setStatusBarMessage(`Notifier: ${muted ? 'sound on' : 'sound off'}`, 3000);
    }),
    vscode.commands.registerCommand('notifier.installTerminalNotifier', async () => {
      if (process.platform !== 'darwin') {
        vscode.window.showInformationMessage('terminal-notifier is macOS-only — not needed on this platform.');
        return;
      }
      const terminal = vscode.window.createTerminal('Notifier: install terminal-notifier');
      terminal.show();
      terminal.sendText('brew install terminal-notifier');
    }),
    vscode.commands.registerCommand('notifier.setupRemoteAudio', async () => {
      const cfg = vscode.workspace.getConfiguration('notifier');
      const port = await vscode.window.showInputBox({
        prompt: 'Local port for the notifier relay (must match your SSH -R forward)',
        value: '47623',
        validateInput: (v) => (isNaN(Number(v)) || Number(v) <= 0 ? 'Enter a valid port number' : undefined)
      });
      if (port === undefined) return;
      await run(['config-set', 'remoteAudio.enabled', 'true']);
      await run(['config-set', 'remoteAudio.port', port]);
      out.show();
      out.appendLine(`Remote audio configured on port ${port}. Two things left, both on your machines:`);
      out.appendLine(`1. On your LOCAL machine (where you want sound to actually play), run: notifier relay ${port}`);
      out.appendLine(`2. When you SSH into the remote host running the agent, add: -R ${port}:localhost:${port}`);
      out.appendLine(`   e.g. ssh -R ${port}:localhost:${port} user@remote-host`);
      vscode.window.showInformationMessage(`Remote audio configured on port ${port} — see the Notifier output channel for the two setup steps.`);
    }),
    vscode.window.onDidChangeWindowState((s) => {
      const cwd = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0] ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
      run(['focus', cwd, String(s.focused)]);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('notifier.autoMuteWhenFocused')) syncSetting('autoMuteWhenFocused');
      if (e.affectsConfiguration('notifier.minTaskDurationThreshold')) syncSetting('minTaskDurationThreshold');
      if (e.affectsConfiguration('notifier.volume')) syncSetting('volume');
      if (Object.keys(AGENT_SETTINGS).some((k) => e.affectsConfiguration(`notifier.${k}`))) syncAgentTogglesAndInstall(out);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
