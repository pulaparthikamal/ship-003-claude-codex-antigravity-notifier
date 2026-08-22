const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const IDLE_MS = Number(process.env.NOTIFIER_ANTIGRAVITY_IDLE_MS) || 60000;

function projectName(cwd) {
  return cwd ? path.basename(cwd) : 'unknown';
}

// Maps Antigravity's hook payload (see AGENT_INTEGRATIONS.md#antigravity) to a
// CanonicalEvent. Antigravity has no native "waiting on input" event yet, so
// 'idle' is synthesized locally via scheduleIdleCheck() below, not this map.
function normalize(raw) {
  let kind = 'task_complete';
  if (raw.hook_event_name === 'Idle') kind = 'idle';
  else if (raw.hook_event_name === 'Stop') kind = 'task_complete';
  else if (raw.hook_event_name === 'PreToolUse') kind = raw.requires_approval ? 'permission' : 'task_complete';

  return {
    agent: 'antigravity',
    kind,
    sessionId: raw.session_id || 'unknown',
    cwd: raw.cwd || process.cwd(),
    projectName: projectName(raw.cwd),
    detail: raw.hook_event_name,
    toolName: raw.tool_name,
    fromSubagent: false,
    timestamp: Date.now()
  };
}

// Idle heuristic: on every PostToolUse we write a marker with the current
// timestamp and spawn a short-lived detached process that sleeps IDLE_MS then
// checks whether the marker changed (i.e. newer activity happened). If not,
// it dispatches a synthetic 'idle' event. Any newer activity simply lets an
// older check's marker comparison fail and it no-ops — no daemon needed.
function scheduleIdleCheck(sessionId, cwd, cliJsPath) {
  const marker = path.join(os.tmpdir(), `notifier-idle-${sessionId}.json`);
  fs.writeFileSync(marker, JSON.stringify({ ts: Date.now() }));
  spawn(process.execPath, [cliJsPath, 'idle-check', sessionId, cwd, marker], {
    detached: true,
    stdio: 'ignore'
  }).unref();
}

function workspaceHooksPath(cwd) {
  return path.join(cwd || process.cwd(), '.agents', 'hooks.json');
}

function globalHooksPath() {
  return path.join(os.homedir(), '.gemini', 'config', 'hooks.json');
}

function install(cliBin, cwd) {
  const p = cwd ? workspaceHooksPath(cwd) : globalHooksPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cfg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  const cmd = `${cliBin} dispatch antigravity`;
  cfg.PreToolUse = [{ hooks: [{ type: 'command', command: cmd, timeout: 10 }] }];
  cfg.PostToolUse = [{ hooks: [{ type: 'command', command: cmd, timeout: 10 }] }];
  cfg.Stop = [{ hooks: [{ type: 'command', command: cmd, timeout: 10 }] }];
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

function uninstall(cwd) {
  const p = cwd ? workspaceHooksPath(cwd) : globalHooksPath();
  if (!fs.existsSync(p)) return;
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete cfg.PreToolUse;
  delete cfg.PostToolUse;
  delete cfg.Stop;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

module.exports = { normalize, install, uninstall, scheduleIdleCheck, IDLE_MS };
