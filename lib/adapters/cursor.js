const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { ensureIgnored } = require('../core/gitignore');

// Cursor's own hooks feature (introduced v1.7, docs: cursor.com/docs/hooks),
// confirmed real and current — see AGENT_INTEGRATIONS.md#cursor. Distinct
// schema from Claude Code's and Antigravity's: `{version:1, hooks:{...}}` at
// the document root, config file `.cursor/hooks.json` (project) or
// `~/.cursor/hooks.json` (global; ignored by Cursor's cloud/background
// agents, which only read the project-level file).
const IDLE_MS = Number(process.env.NOTIFIER_CURSOR_IDLE_MS) || 60000;

function projectName(cwd) {
  return cwd ? path.basename(cwd) : 'unknown';
}

// Cursor's payload has no session_id/cwd fields — it's conversation_id and a
// workspace_roots array (multi-root aware), unlike every other adapter here.
function cwdFromRaw(raw) {
  if (Array.isArray(raw.workspace_roots) && raw.workspace_roots[0]) return raw.workspace_roots[0];
  return raw.cwd || process.cwd();
}

function toEvent(raw, kind) {
  const cwd = cwdFromRaw(raw);
  return {
    agent: 'cursor',
    kind,
    sessionId: raw.conversation_id || raw.session_id || 'unknown',
    cwd,
    projectName: projectName(cwd),
    detail: raw.model || raw.model_id || raw.hook_event_name,
    fromSubagent: raw.hook_event_name === 'subagentStop',
    timestamp: Date.now()
  };
}

// Maps Cursor's hook payload to a CanonicalEvent, or null when the raw event
// isn't notification-worthy. Cursor has no native idle event, same gap as
// Antigravity — handled by the same detached-timer heuristic below, not here.
//
// beforeShellExecution/beforeMCPExecution are Cursor's approval GATE points
// (a hook's stdout/exit code can allow/ask/deny the action) — not a passive
// "the human is now being asked" signal the way Claude Code's
// PermissionRequest is. We treat them as the closest available analog for a
// 'permission' notification, but deliberately never emit a decision
// ourselves (no stdout, exit 0) so we only observe — never gate — Cursor's
// own approval flow.
// `stop`/`subagentStop` each carry their own `status: "completed"|"aborted"|
// "error"` field (confirmed: cursor.com/docs/hooks) — previously ignored, so
// a turn that ended in an error looked identical to one that finished
// normally. `postToolUseFailure` is a separate, dedicated failure-only event
// (its `postToolUse` counterpart fires on success) — like Claude Code's
// PostToolUseFailure, mapping it to 'error' can't turn into per-tool-call
// noise, since it structurally only fires on an actual failure.
function normalize(raw) {
  if (raw.hook_event_name === 'stop') return toEvent(raw, raw.status === 'error' ? 'error' : 'task_complete');
  if (raw.hook_event_name === 'subagentStop') return toEvent(raw, raw.status === 'error' ? 'error' : 'subagent_complete');
  if (raw.hook_event_name === 'postToolUseFailure') return toEvent(raw, 'error');
  if (raw.hook_event_name === 'beforeShellExecution' || raw.hook_event_name === 'beforeMCPExecution') return toEvent(raw, 'permission');
  return null;
}

// Same self-canceling detached-process idle heuristic as Antigravity's (see
// lib/adapters/antigravity.js for the full rationale) — kept as a separate
// copy rather than a shared helper since the two are one small function each
// and genuinely agent-scoped (different marker namespace, different trigger
// event, different IDLE_MS env var).
function scheduleIdleCheck(sessionId, cwd, cliJsPath) {
  const marker = path.join(os.tmpdir(), `notifier-idle-cursor-${sessionId}.json`);
  fs.writeFileSync(marker, JSON.stringify({ ts: Date.now() }));
  spawn(process.execPath, [cliJsPath, 'idle-check', 'cursor', sessionId, cwd, marker], {
    detached: true,
    stdio: 'ignore'
  }).unref();
}

function projectHooksPath(cwd) {
  return path.join(cwd || process.cwd(), '.cursor', 'hooks.json');
}

function globalHooksPath() {
  return path.join(os.homedir(), '.cursor', 'hooks.json');
}

// See the identical guard + rationale in lib/adapters/antigravity.js's
// isRealProjectDir(): when no workspace folder is open, a spawned CLI child
// can inherit an OS-level cwd of `/`, and mkdirSync('/.cursor') throws
// uncaught — confirmed for antigravity's own equivalent path, fixed
// preemptively here since it's the same code shape.
function isRealProjectDir(cwd) {
  return !!cwd && path.resolve(cwd) !== path.parse(cwd || '/').root;
}

function install(cliBin, cwd) {
  if (cwd && !isRealProjectDir(cwd)) return null; // no real workspace folder open — nothing sensible to write
  const p = cwd ? projectHooksPath(cwd) : globalHooksPath();
  // This writes directly into the user's project folder (unlike Claude/Codex,
  // which only ever touch $HOME) — without this, .cursor/hooks.json shows up
  // as an untracked/modified file in the project's own source control diff on
  // every activation, even though the user never touched it.
  if (cwd) ensureIgnored(cwd, '.cursor/hooks.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cfg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { version: 1, hooks: {} };
  cfg.version = cfg.version || 1;
  cfg.hooks = cfg.hooks || {};
  const cmd = `${cliBin} dispatch cursor`;
  const hook = (timeout) => [{ type: 'command', command: cmd, timeout }];
  cfg.hooks.stop = hook(10);
  cfg.hooks.subagentStop = hook(10);
  cfg.hooks.postToolUseFailure = hook(10);
  cfg.hooks.beforeShellExecution = hook(10);
  cfg.hooks.beforeMCPExecution = hook(10);
  cfg.hooks.afterAgentResponse = hook(10); // idle-check trigger only, never notifies directly
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

function uninstall(cwd) {
  const p = cwd ? projectHooksPath(cwd) : globalHooksPath();
  if (!fs.existsSync(p)) return;
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (cfg.hooks) {
    delete cfg.hooks.stop;
    delete cfg.hooks.subagentStop;
    delete cfg.hooks.postToolUseFailure;
    delete cfg.hooks.beforeShellExecution;
    delete cfg.hooks.beforeMCPExecution;
    delete cfg.hooks.afterAgentResponse;
  }
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

module.exports = { normalize, install, uninstall, scheduleIdleCheck, IDLE_MS };
