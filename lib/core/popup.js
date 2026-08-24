const { execFile, execFileSync, spawn } = require('child_process');
const { linuxDesktopEnv } = require('./platformEnv');

function hasTerminalNotifier() {
  try {
    execFileSync('which', ['terminal-notifier'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Every agent kills its hook command after a short timeout (as little as 5s
// for Claude Code). A popup command that waits for the *user* to dismiss it —
// like the previous Windows implementation, `MessageBox.Show`, which blocks
// until clicked — never gets the chance to render before the hook is killed,
// so nothing ever appeared on Windows. Spawning detached + unref lets the
// notifier CLI process (and the agent's hook pipeline) return immediately
// while the popup keeps running independently to completion.
function fireAndForget(cmd, args, env) {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Well-known AUMID for powershell.exe's own Start Menu shortcut — the
// standard way to raise a real, non-blocking Action Center toast from a
// plain PowerShell one-liner with no extra module install (BurntToast uses
// the same trick under its own registered AUMID).
const WIN_TOAST_AUMID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

function winToastScript(title, body) {
  const xmlTitle = escapeXml(title);
  const xmlBody = escapeXml(body);
  return [
    '$ErrorActionPreference = "Stop"',
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] > $null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${xmlTitle}</text><text>${xmlBody}</text></binding></visual></toast>')`,
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${WIN_TOAST_AUMID}').Show($toast)`
  ].join('; ');
}

// Last-resort only, for the rare machine where the WinRT toast API itself
// isn't available — still spawned detached so an undismissed dialog can
// never hold up the agent's hook pipeline the way the old always-MessageBox
// implementation did.
function winMessageBoxScript(title, body) {
  return `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show(${JSON.stringify(body)}, ${JSON.stringify(title)})`;
}

function show(title, body, opts = {}) {
  return new Promise((resolve) => {
    const platform = process.platform;
    if (platform === 'darwin') {
      if (opts.clickable && hasTerminalNotifier()) {
        fireAndForget('terminal-notifier', ['-title', title, '-message', body]);
      } else {
        const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
        fireAndForget('osascript', ['-e', script]);
      }
      resolve();
    } else if (platform === 'win32') {
      // Bounded, not user-driven: the toast call itself returns almost
      // instantly (success or throw) — it's only the *old* MessageBox that
      // blocked on a user click. We wait for just this quick call so we can
      // detect an unsupported-toast-API machine and fall back, then resolve.
      execFile('powershell', ['-NoProfile', '-Command', winToastScript(title, body)], (err) => {
        if (err) fireAndForget('powershell', ['-NoProfile', '-Command', winMessageBoxScript(title, body)]);
        resolve();
      });
    } else {
      fireAndForget('notify-send', [title, body], linuxDesktopEnv());
      resolve();
    }
  });
}

module.exports = { show };
