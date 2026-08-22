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

function run(args) {
  return new Promise((resolve) => {
    cp.execFile(process.execPath, [cliPath, ...args], (_err, stdout) => resolve(stdout || ''));
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

function activate(context) {
  const out = vscode.window.createOutputChannel('Notifier');
  out.appendLine('Notifier activated');

  run(['install', 'all']).then((r) => out.appendLine(r.trim() || 'hooks installed'));

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
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
