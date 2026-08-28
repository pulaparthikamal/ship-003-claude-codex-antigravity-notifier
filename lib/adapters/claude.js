const fs = require('fs');
const path = require('path');
const os = require('os');

function projectName(cwd) {
  return cwd ? path.basename(cwd) : 'unknown';
}

// Maps Claude Code's hook payload (see AGENT_INTEGRATIONS.md#claude-code) to a CanonicalEvent.
function normalize(raw) {
  let kind = 'question';
  if (raw.hook_event_name === 'Notification') {
    kind = raw.notification_type === 'permission_prompt' ? 'permission' : raw.notification_type === 'idle_prompt' ? 'idle' : 'question';
  } else if (raw.hook_event_name === 'PermissionRequest') {
    kind = 'permission';
  } else if (raw.hook_event_name === 'Stop') {
    kind = 'task_complete';
  } else if (raw.hook_event_name === 'SubagentStop') {
    kind = 'subagent_complete';
  } else if (raw.hook_event_name === 'StopFailure' || raw.hook_event_name === 'PostToolUseFailure') {
    // Dedicated failure-only events (confirmed: code.claude.com/docs/en/hooks) —
    // StopFailure fires instead of Stop when the turn ends via an API error
    // (rate_limit/overloaded/authentication_failed/etc.), PostToolUseFailure
    // fires instead of PostToolUse when a tool call itself fails. Each is a
    // separate event *name*, not a flag on the event that already fires
    // unconditionally, so mapping both to 'error' can't double-notify or turn
    // into per-tool-call noise the way a blanket PostToolUse mapping would.
    kind = 'error';
  }

  return {
    agent: 'claude',
    kind,
    sessionId: raw.session_id || 'unknown',
    cwd: raw.cwd || process.cwd(),
    projectName: projectName(raw.cwd),
    detail: raw.notification_type,
    toolName: raw.tool_name,
    fromSubagent: raw.hook_event_name === 'SubagentStop',
    timestamp: Date.now()
  };
}

function settingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function install(cliBin) {
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cfg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  cfg.hooks = cfg.hooks || {};
  const cmdHook = (matcher) => (matcher ? { matcher, hooks: [{ type: 'command', command: `${cliBin} dispatch claude`, timeout: 5 }] } : { hooks: [{ type: 'command', command: `${cliBin} dispatch claude`, timeout: 5 }] });

  cfg.hooks.Notification = [cmdHook('permission_prompt'), cmdHook('idle_prompt')];
  cfg.hooks.PermissionRequest = [cmdHook()];
  cfg.hooks.Stop = [cmdHook()];
  cfg.hooks.StopFailure = [cmdHook()];
  cfg.hooks.SubagentStop = [cmdHook()];
  cfg.hooks.PostToolUseFailure = [cmdHook()];

  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

function uninstall() {
  const p = settingsPath();
  if (!fs.existsSync(p)) return;
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (cfg.hooks) {
    delete cfg.hooks.Notification;
    delete cfg.hooks.PermissionRequest;
    delete cfg.hooks.Stop;
    delete cfg.hooks.StopFailure;
    delete cfg.hooks.SubagentStop;
    delete cfg.hooks.PostToolUseFailure;
  }
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

module.exports = { normalize, install, uninstall };
