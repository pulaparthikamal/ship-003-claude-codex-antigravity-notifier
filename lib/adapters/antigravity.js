const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const IDLE_MS = Number(process.env.NOTIFIER_ANTIGRAVITY_IDLE_MS) || 60000;

function projectName(cwd) {
  return cwd ? path.basename(cwd) : 'unknown';
}

// The AGENT_INTEGRATIONS.md/original design assumed Antigravity's payload
// carried a Claude-Code-style `hook_event_name` / `session_id` / `cwd` /
// `requires_approval` shape. It does not. Confirmed by capturing a real,
// live payload on 2026-08-24 — the actual shape is:
//   { conversationId, workspacePaths: [...], toolCall: { name, args: {...,
//     Cwd, ...} }, artifactDirectoryPath, transcriptPath, error? }
// `error` (even as an empty string) is present only on the post-execution
// call, absent on the pre-execution one — the only way we've observed to
// tell PreToolUse and PostToolUse apart, since there's no explicit event
// name field. There is NO field anywhere indicating "this tool call needs
// human approval" — permission prompts are not observable from this payload
// at all; that's a real Antigravity-side gap, not something normalize() can
// work around.
function cwdFromRaw(raw) {
  return (raw.toolCall && raw.toolCall.args && raw.toolCall.args.Cwd) || (Array.isArray(raw.workspacePaths) && raw.workspacePaths[0]) || process.cwd();
}

function toEvent(raw, kind) {
  const cwd = cwdFromRaw(raw);
  return {
    agent: 'antigravity',
    kind,
    sessionId: raw.conversationId || 'unknown',
    cwd,
    projectName: projectName(cwd),
    detail: raw.toolCall && raw.toolCall.name,
    toolName: raw.toolCall && raw.toolCall.name,
    fromSubagent: false,
    timestamp: Date.now()
  };
}

// Maps Antigravity's hook payload to a CanonicalEvent, or null when the raw
// event isn't notification-worthy. Antigravity has no native "waiting on
// input" event, so 'idle' is synthesized locally via scheduleIdleCheck()
// below, not this map — and, per the note above, no 'permission' event is
// derivable from this payload at all right now.
//
// A `toolCall` key means this is PreToolUse or PostToolUse (a per-tool-call
// event, not the turn finishing) — never dispatch-worthy, since there's no
// approval signal to map to 'permission' and it isn't task completion
// either. An earlier version keyed off a `hook_event_name` field that
// doesn't exist in the real payload, so this branch never matched at all —
// meaning PreToolUse/PostToolUse always fell through; that part was
// accidentally correct in effect (both do return null) but for the wrong
// reason, and the same wrong field broke Stop detection too (see below).
//
// The only other shape these three registered hooks (PreToolUse/
// PostToolUse/Stop) can produce is the Stop payload, which has no
// `toolCall` — treated as the turn finishing.
function normalize(raw) {
  if (raw.toolCall) return null;
  return toEvent(raw, 'task_complete');
}

// Antigravity's real PostToolUse payload has no `hook_event_name` field
// either — bin/notifier.js used to gate scheduleIdleCheck() on
// `raw.hook_event_name === 'PostToolUse'`, which never matched, so the idle
// heuristic was never actually scheduled for a single real Antigravity
// event. `error !== undefined` is the same presence check normalize() would
// use to recognize a post-execution call, if it needed to distinguish one
// (it doesn't, since normalize() itself doesn't need Pre vs Post — this
// export exists solely for bin/notifier.js's idle-scheduling trigger).
function isPostToolUse(raw) {
  return !!raw.toolCall && raw.error !== undefined;
}

// Idle heuristic: on every PostToolUse we write a marker with the current
// timestamp and spawn a short-lived detached process that sleeps IDLE_MS then
// checks whether the marker changed (i.e. newer activity happened). If not,
// it dispatches a synthetic 'idle' event. Any newer activity simply lets an
// older check's marker comparison fail and it no-ops — no daemon needed.
//
// The spawned argv must be ['idle-check', <agent>, sessionId, cwd, marker] —
// bin/notifier.js's `idle-check` case destructures exactly that shape (see
// its own comment). This function used to omit the 'antigravity' element
// entirely, so every arg after it silently shifted left one position: `agent`
// bound to the real sessionId, `marker` ended up undefined, readMarker(undefined)
// always returned null, and the before/after comparison's `before && after`
// guard was always false — the idle-check timer fired every time but its
// dispatch was unreachable, so Antigravity's 'idle' notification never once
// fired in practice. Confirmed by tracing a real scheduleIdleCheck call
// through to bin/notifier.js's idle-check case; cursor.js's otherwise-identical
// copy already includes its own agent-name element and doesn't have this bug.
function scheduleIdleCheck(sessionId, cwd, cliJsPath) {
  const marker = path.join(os.tmpdir(), `notifier-idle-${sessionId}.json`);
  fs.writeFileSync(marker, JSON.stringify({ ts: Date.now() }));
  spawn(process.execPath, [cliJsPath, 'idle-check', 'antigravity', sessionId, cwd, marker], {
    detached: true,
    stdio: 'ignore'
  }).unref();
}

// A workspace-scoped hook file only makes sense inside a real project
// folder. When the extension activates with no workspace folder open,
// `workspaceCwd()` in extension.js returns undefined, and the spawned CLI
// child then inherits whatever OS-level cwd its own parent process happens
// to have — observed in practice to be `/` (filesystem root) for a
// GUI-launched editor. `path.join('/', '.agents', 'hooks.json')` is
// `/.agents/hooks.json`, and `mkdirSync('/.agents')` throws (ENOENT/EACCES,
// not creatable) — an *uncaught* crash that used to abort the entire
// `install all` loop partway through (breaking every adapter after
// antigravity in iteration order), confirmed via a live crash capture.
function isRealProjectDir(cwd) {
  return !!cwd && path.resolve(cwd) !== path.parse(cwd || '/').root;
}

function workspaceHooksPath(cwd) {
  return path.join(cwd || process.cwd(), '.agents', 'hooks.json');
}

function globalHooksPath() {
  return path.join(os.homedir(), '.gemini', 'config', 'hooks.json');
}

// Antigravity's hooks.json wraps every event under an arbitrary hook-name key
// at the document root — NOT flat event keys the way Claude Code's/Codex's
// files are. A previous version wrote flat `{ PreToolUse: [...], Stop: [...] }`
// at the root, which Antigravity doesn't recognize as a hook registration at
// all, so nothing ever fired. Confirmed against antigravity.google/docs/hooks.
const HOOK_NAME = 'notifier';

function install(cliBin, cwd) {
  if (cwd && !isRealProjectDir(cwd)) return null; // no real workspace folder open — nothing sensible to write
  const p = cwd ? workspaceHooksPath(cwd) : globalHooksPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cfg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  // Migrate away from a previous version's flat, wrapper-less write (which
  // Antigravity silently ignored — see HOOK_NAME comment above).
  delete cfg.PreToolUse;
  delete cfg.PostToolUse;
  delete cfg.Stop;
  const cmd = `${cliBin} dispatch antigravity`;
  cfg[HOOK_NAME] = {
    PreToolUse: [{ hooks: [{ type: 'command', command: cmd, timeout: 10 }] }],
    PostToolUse: [{ hooks: [{ type: 'command', command: cmd, timeout: 10 }] }],
    Stop: [{ hooks: [{ type: 'command', command: cmd, timeout: 10 }] }]
  };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

function uninstall(cwd) {
  const p = cwd ? workspaceHooksPath(cwd) : globalHooksPath();
  if (!fs.existsSync(p)) return;
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete cfg[HOOK_NAME];
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

module.exports = { normalize, install, uninstall, scheduleIdleCheck, isPostToolUse, IDLE_MS };
