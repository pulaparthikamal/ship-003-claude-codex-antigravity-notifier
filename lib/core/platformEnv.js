// Hook subprocesses (spawned by Claude Code / Codex / Antigravity, often from
// a non-interactive or detached session) frequently don't inherit the
// desktop session env vars a GUI notifier needs on Linux: DISPLAY,
// DBUS_SESSION_BUS_ADDRESS, XDG_RUNTIME_DIR. When they're missing, notify-send
// and PulseAudio/canberra calls fail silently instead of erroring loudly, so
// this fills in the same defaults the desktop session itself would set, keyed
// off the real uid (not assumed to be 1000).
function linuxDesktopEnv() {
  const env = { ...process.env };
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  if (!env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
  if (!env.DBUS_SESSION_BUS_ADDRESS) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
  if (!env.DISPLAY) env.DISPLAY = ':0';
  return env;
}

module.exports = { linuxDesktopEnv };
