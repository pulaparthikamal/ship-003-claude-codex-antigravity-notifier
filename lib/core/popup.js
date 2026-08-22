const { execFile, execFileSync } = require('child_process');

function hasTerminalNotifier() {
  try {
    execFileSync('which', ['terminal-notifier'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function show(title, body, opts = {}) {
  return new Promise((resolve) => {
    const platform = process.platform;
    if (platform === 'darwin') {
      if (opts.clickable && hasTerminalNotifier()) {
        execFile('terminal-notifier', ['-title', title, '-message', body], () => resolve());
      } else {
        const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
        execFile('osascript', ['-e', script], () => resolve());
      }
    } else if (platform === 'win32') {
      // Simple, dependency-free popup. TODO: swap for a native toast (e.g. BurntToast) for a less intrusive UX.
      const ps = `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show(${JSON.stringify(
        body
      )}, ${JSON.stringify(title)})`;
      execFile('powershell', ['-NoProfile', '-Command', ps], () => resolve());
    } else {
      execFile('notify-send', [title, body], () => resolve());
    }
  });
}

module.exports = { show };
