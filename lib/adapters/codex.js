const fs = require('fs');
const path = require('path');
const os = require('os');

function projectName(cwd) {
  return cwd ? path.basename(cwd) : 'unknown';
}

// Maps Codex CLI's hook payload (see AGENT_INTEGRATIONS.md#codex-cli) to a CanonicalEvent.
function normalize(raw) {
  let kind = 'question';
  if (raw.hook_event_name === 'PreToolUse') kind = 'permission';
  else if (raw.hook_event_name === 'Stop') kind = 'task_complete';
  else if (raw.hook_event_name === 'PostToolUse') kind = 'question';

  return {
    agent: 'codex',
    kind,
    sessionId: raw.session_id || 'unknown',
    cwd: raw.cwd || process.cwd(),
    projectName: projectName(raw.cwd),
    detail: raw.model,
    toolName: raw.tool_name,
    fromSubagent: false,
    timestamp: Date.now()
  };
}

function hooksPath() {
  return path.join(os.homedir(), '.codex', 'hooks.json');
}

function install(cliBin) {
  const p = hooksPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cfg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  const cmd = `${cliBin} dispatch codex`;
  cfg.PreToolUse = [{ hooks: [{ type: 'command', command: cmd, timeout: 10 }] }];
  cfg.Stop = [{ hooks: [{ type: 'command', command: cmd, timeout: 10 }] }];
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

function uninstall() {
  const p = hooksPath();
  if (!fs.existsSync(p)) return;
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete cfg.PreToolUse;
  delete cfg.Stop;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

module.exports = { normalize, install, uninstall };
