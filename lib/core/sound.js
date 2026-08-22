const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function bell() {
  process.stdout.write('\x07');
}

// Bundled last-resort tone — always present regardless of OS config/locale,
// so a notification is audible even when no system sound assets are found.
const FALLBACK_WAV = path.join(__dirname, '..', '..', 'resources', 'fallback-tone.wav');

// Windows' System.Media.SystemSounds are compiled into .NET itself (no file
// on disk to go missing, unlike C:\Windows\Media\*.wav which varies by
// locale/edition) — map our cross-platform preset names onto the closest one
// so sound works out of the box with zero user setup.
const WIN_SYSTEM_SOUND = {
  Basso: 'Hand',
  Glass: 'Asterisk',
  Hero: 'Exclamation',
  Ping: 'Beep',
  Pop: 'Beep',
  default: 'Asterisk'
};

function playFile(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, (err) => resolve(!err)));
}

async function playLinuxFallbackTone() {
  // speaker-test ships with alsa-utils, present on the vast majority of
  // Ubuntu/Debian desktop and server installs by default.
  const ok = await new Promise((resolve) => {
    const p = execFile('speaker-test', ['-t', 'sine', '-f', '880', '-l', '1']);
    const timer = setTimeout(() => {
      p.kill();
      resolve(true);
    }, 200);
    p.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  if (ok) return true;
  if (fs.existsSync(FALLBACK_WAV)) {
    if (await playFile('aplay', [FALLBACK_WAV])) return true;
    if (await playFile('paplay', [FALLBACK_WAV])) return true;
  }
  return false;
}

// Best-effort cross-platform sound playback: tries OS-native players and
// system sound assets first (so an installed preset's real tone plays when
// available), then falls back through progressively more universal options,
// ending in a bundled WAV / terminal bell so *something* is always audible
// without requiring the user to install or configure anything extra.
async function play(preset, volume = 1) {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      const file = `/System/Library/Sounds/${preset || 'Ping'}.aiff`;
      if (fs.existsSync(file) && (await playFile('afplay', ['-v', String(volume), file]))) return;
      if (fs.existsSync(FALLBACK_WAV) && (await playFile('afplay', [FALLBACK_WAV]))) return;
      bell();
    } else if (platform === 'win32') {
      const soundName = WIN_SYSTEM_SOUND[preset] || WIN_SYSTEM_SOUND.default;
      const ps = `[System.Media.SystemSounds]::${soundName}.Play(); Start-Sleep -Milliseconds 400`;
      const ok = await new Promise((resolve) => execFile('powershell', ['-NoProfile', '-Command', ps], (err) => resolve(!err)));
      if (ok) return;
      if (fs.existsSync(FALLBACK_WAV)) {
        const wavPs = `(New-Object Media.SoundPlayer '${FALLBACK_WAV}').PlaySync();`;
        if (await new Promise((resolve) => execFile('powershell', ['-NoProfile', '-Command', wavPs], (err) => resolve(!err)))) return;
      }
      bell();
    } else {
      if (await playFile('canberra-gtk-play', ['-i', 'dialog-information'])) return;
      if (await playFile('paplay', ['/usr/share/sounds/freedesktop/stereo/dialog-information.oga'])) return;
      if (await playFile('paplay', ['/usr/share/sounds/freedesktop/stereo/complete.oga'])) return;
      if (await playFile('aplay', ['/usr/share/sounds/alsa/Front_Center.wav'])) return;
      if (await playLinuxFallbackTone()) return;
      bell();
    }
  } catch {
    bell();
  }
}

module.exports = { play };
