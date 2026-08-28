const fs = require('fs');
const path = require('path');
const os = require('os');

function projectName(cwd) {
  return cwd ? path.basename(cwd) : 'unknown';
}

// Maps Codex CLI's hook payload (see AGENT_INTEGRATIONS.md#codex-cli) to a CanonicalEvent.
// PermissionRequest — not PreToolUse — is Codex's real approval-gate event:
// confirmed (learn.chatgpt.com/docs/hooks) it "runs when Codex is about to
// ask for approval... doesn't run for commands that don't need approval,"
// unlike PreToolUse, which fires for every tool call regardless of whether a
// human is involved. We don't register PreToolUse at all (see install()), so
// it's listed here only as documentation of what we deliberately don't map.
function normalize(raw) {
  let kind = 'question';
  if (raw.hook_event_name === 'PermissionRequest') kind = 'permission';
  else if (raw.hook_event_name === 'Stop') kind = 'task_complete';
  else if (raw.hook_event_name === 'SubagentStop') kind = 'subagent_complete';

  return {
    agent: 'codex',
    kind,
    sessionId: raw.session_id || 'unknown',
    cwd: raw.cwd || process.cwd(),
    projectName: projectName(raw.cwd),
    detail: raw.model,
    toolName: raw.tool_name,
    fromSubagent: raw.hook_event_name === 'SubagentStop',
    timestamp: Date.now()
  };
}

// Stop and SubagentStop are the two Codex hook events whose response is
// actually read back, not just its exit code — confirmed (same docs page):
// "Stop expects JSON on stdout when it exits 0. Plain text output is invalid
// for this event." Every other event treats "exit 0, no output" as success,
// so this is deliberately narrower than a blanket print-JSON-always rule.
function respondsWithJson(hookEventName) {
  return hookEventName === 'Stop' || hookEventName === 'SubagentStop';
}

function hooksPath() {
  return path.join(os.homedir(), '.codex', 'hooks.json');
}

function install(cliBin) {
  const p = hooksPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cfg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  // Migrate away from a previous version's flat, wrapper-less write (PreToolUse/
  // Stop keys at the document root, no "hooks" wrapper). Confirmed against
  // learn.chatgpt.com/docs/hooks that Codex requires the same top-level
  // "hooks" wrapper Claude Code uses — the flat shape this adapter used to
  // write was never recognized as a hook registration at all, so Codex
  // notifications silently never fired for anyone who installed that version.
  delete cfg.PreToolUse;
  delete cfg.Stop;
  cfg.hooks = cfg.hooks || {};
  const cmd = `${cliBin} dispatch codex`;
  // commandWindows is an explicit, documented sibling field for a Windows-only
  // command override; our cmd string (JSON-quoted absolute paths) is valid
  // cmd.exe syntax too, so the same string covers both.
  const hook = () => ({ hooks: [{ type: 'command', command: cmd, commandWindows: cmd, timeout: 10 }] });
  cfg.hooks.PermissionRequest = [hook()];
  cfg.hooks.Stop = [hook()];
  cfg.hooks.SubagentStop = [hook()];
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

function uninstall() {
  const p = hooksPath();
  if (!fs.existsSync(p)) return;
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete cfg.PreToolUse; // stale flat-schema keys from a previous version, if present
  delete cfg.Stop;
  if (cfg.hooks) {
    delete cfg.hooks.PermissionRequest;
    delete cfg.hooks.Stop;
    delete cfg.hooks.SubagentStop;
  }
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

module.exports = { normalize, install, uninstall, respondsWithJson };
