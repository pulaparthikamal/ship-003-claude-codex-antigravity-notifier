#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const engine = require('../lib/core/engine');
const config = require('../lib/core/config');
const stateMod = require('../lib/core/state');
const sound = require('../lib/core/sound');
const claude = require('../lib/adapters/claude');
const codex = require('../lib/adapters/codex');
const antigravity = require('../lib/adapters/antigravity');
const cursor = require('../lib/adapters/cursor');
const copilot = require('../lib/adapters/copilot');
const generic = require('../lib/adapters/generic');

const ADAPTERS = { claude, codex, antigravity, cursor, copilot };
// copilot is excluded from the bare "all" target: unlike the hook-based
// adapters, it writes an MCP server entry into the *workspace's own*
// .vscode/mcp.json and (optionally) proposes edits to
// .github/copilot-instructions.md — and it's a best-effort, instruction-
// compliance mechanism, not a real hook (see lib/adapters/copilot.js). That
// needs explicit, informed consent (the "Set up GitHub Copilot Chat…"
// command's caveat dialog), not a silent write on every activation.
const ALL_TARGET_ADAPTERS = Object.keys(ADAPTERS).filter((n) => n !== 'copilot');
// agent name -> { scheduleIdleCheck(sessionId, cwd, cliJsPath), shouldSchedule(raw) }
// for agents with no native idle/notification event, keyed off whichever raw
// hook fires most often per turn (so a heuristic timer can synthesize one).
// Each predicate is agent-specific because the payload shapes aren't
// uniform: Cursor's real payload does carry a `hook_event_name` field, but
// Antigravity's doesn't (confirmed live) — a single shared
// `raw.hook_event_name === X` check silently never matched for Antigravity,
// so its idle heuristic was never actually scheduled for a single real
// event despite the feature existing in code.
const IDLE_HEURISTIC_AGENTS = {
  antigravity: { module: antigravity, shouldSchedule: antigravity.isPostToolUse },
  cursor: { module: cursor, shouldSchedule: (raw) => raw.hook_event_name === 'afterAgentResponse' }
};

// process.execPath, when this CLI runs as a child spawned by a VS Code/
// Antigravity/Cursor extension host, is that editor's own Electron helper
// binary (e.g. macOS's "Code Helper (Plugin)", or Antigravity's
// "Antigravity IDE Helper (Plugin)", or Cursor's own equivalent — every fork
// names it differently), NOT a standalone node — it only behaves like node
// because the extension host's own env carries ELECTRON_RUN_AS_NODE=1. That
// variable does not survive into whatever unrelated process later reads the
// hooks.json/settings.json we write here (the agent's own hook runner) and
// re-invokes the exact same command string — confirmed by reproducing it
// directly: without that env var, the Electron helper crashes instantly
// ("Unable to find helper app") and the hook never dispatches.
//
// An earlier version tried to detect "is this an Electron helper" by
// string-matching known app names (e.g. "code helper") before deciding
// whether to look for a real node — that missed Antigravity's differently
// named helper entirely (and would have missed Cursor's own too), silently
// baking the broken path into every hook file written that way. Fixed by
// dropping the name-guessing: ALWAYS resolve a real node via which/where
// first (an absolute path, so the agent's own hook-invocation PATH doesn't
// matter later) — process.execPath is only ever a fallback when no system
// node exists on PATH at all, never a name-matching decision.
function findRealNode() {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(finder, ['node'], { encoding: 'utf8' });
    const first = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    if (first) return first;
  } catch {
    /* no system node on PATH — fall through to the (likely broken) Electron path */
  }
  return process.execPath;
}

// Name-agnostic check for the doctor warning: a real node binary is always
// named exactly this, regardless of which editor's Electron helper we might
// have fallen back to (whose name we can't enumerate in advance).
function looksLikeStandaloneNode(p) {
  const base = path.basename(p).toLowerCase();
  return base === 'node' || base === 'node.exe' || base === 'nodejs';
}

function cliBinCommand() {
  return `${JSON.stringify(findRealNode())} ${JSON.stringify(path.resolve(__dirname, 'notifier.js'))}`;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('{}');
    let data = '';
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data || '{}'));
    setTimeout(() => resolve(data || '{}'), 2000);
  });
}

function readMarker(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function runDoctor() {
  console.log('notifier doctor');
  console.log('- platform:', process.platform);
  console.log('- config dir:', config.DIR, fs.existsSync(config.DIR) ? '(exists)' : '(will be created on first use)');
  console.log('- muted:', fs.existsSync(config.MUTE_PATH));
  console.log('- claude settings:', path.join(os.homedir(), '.claude', 'settings.json'), fs.existsSync(path.join(os.homedir(), '.claude', 'settings.json')) ? 'found' : 'missing');
  console.log('- codex hooks:', path.join(os.homedir(), '.codex', 'hooks.json'), fs.existsSync(path.join(os.homedir(), '.codex', 'hooks.json')) ? 'found' : 'missing');
  console.log('- antigravity workspace hooks:', path.join(process.cwd(), '.agents', 'hooks.json'), fs.existsSync(path.join(process.cwd(), '.agents', 'hooks.json')) ? 'found' : 'missing');
  console.log('- cursor workspace hooks:', path.join(process.cwd(), '.cursor', 'hooks.json'), fs.existsSync(path.join(process.cwd(), '.cursor', 'hooks.json')) ? 'found' : 'missing');
  const node = findRealNode();
  console.log(
    '- node binary hooks will invoke:',
    node,
    looksLikeStandaloneNode(node) ? '' : '(WARNING: no standalone node found on PATH — this Electron helper only works from a hook invoked by the same editor process tree; re-run "notifier install all" from a plain terminal with node on PATH, or install Node.js system-wide)'
  );
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const bin = cliBinCommand();
  const cliJsPath = path.resolve(__dirname, 'notifier.js');

  switch (cmd) {
    case 'install': {
      const target = args[0];
      const names = target && target !== 'all' ? [target] : ALL_TARGET_ADAPTERS;
      for (const name of names) {
        if (!ADAPTERS[name]) {
          console.error(`Unknown agent "${name}". Known: ${Object.keys(ADAPTERS).join(', ')}`);
          continue;
        }
        const p = ADAPTERS[name].install(bin, process.cwd());
        console.log(p ? `Installed ${name} hooks -> ${p}` : `Skipped ${name} hooks (no real workspace folder open)`);
      }
      break;
    }
    case 'uninstall': {
      const target = args[0];
      const names = target && target !== 'all' ? [target] : ALL_TARGET_ADAPTERS;
      for (const name of names) {
        if (!ADAPTERS[name]) continue;
        ADAPTERS[name].uninstall(process.cwd());
        console.log(`Removed ${name} hooks`);
      }
      break;
    }
    case 'dispatch': {
      const agent = args[0];
      const raw = JSON.parse(await readStdin());
      const adapter = ADAPTERS[agent] || generic;
      const evt = adapter.normalize(raw);
      if (evt) await engine.dispatch(evt);
      const heuristic = IDLE_HEURISTIC_AGENTS[agent];
      if (heuristic && heuristic.shouldSchedule(raw)) {
        const sessionId = raw.session_id || raw.conversation_id || raw.conversationId || 'unknown';
        const cwd = evt ? evt.cwd : raw.cwd || (Array.isArray(raw.workspacePaths) && raw.workspacePaths[0]) || process.cwd();
        heuristic.module.scheduleIdleCheck(sessionId, cwd, cliJsPath);
      }
      break;
    }
    case 'idle-check': {
      const [agent, sessionId, cwd, marker] = args;
      const before = readMarker(marker);
      const idleMs = (IDLE_HEURISTIC_AGENTS[agent] && IDLE_HEURISTIC_AGENTS[agent].module.IDLE_MS) || 60000;
      setTimeout(async () => {
        const after = readMarker(marker);
        if (before && after && before.ts === after.ts) {
          try {
            fs.unlinkSync(marker);
          } catch {
            /* already gone */
          }
          await engine.dispatch({
            agent,
            kind: 'idle',
            sessionId,
            cwd,
            projectName: cwd ? path.basename(cwd) : 'unknown',
            fromSubagent: false,
            timestamp: Date.now()
          });
        }
      }, idleMs);
      return; // keep the event loop alive for the timer; parent already unref'd us
    }
    case 'mute':
      config.ensureDir();
      fs.writeFileSync(config.MUTE_PATH, '');
      console.log('Muted.');
      break;
    case 'unmute':
      try {
        fs.unlinkSync(config.MUTE_PATH);
      } catch {
        /* already unmuted */
      }
      console.log('Unmuted.');
      break;
    case 'status': {
      const cfg = config.loadConfig(process.cwd());
      const state = stateMod.loadState();
      console.log(JSON.stringify({ muted: fs.existsSync(config.MUTE_PATH), config: cfg, recentHistory: (state.history || []).slice(0, 10) }, null, 2));
      break;
    }
    case 'config-set': {
      const [key, value] = args;
      const cfg = config.loadConfig();
      const parsed = value === 'true' ? true : value === 'false' ? false : isNaN(Number(value)) ? value : Number(value);
      // Supports dot paths (e.g. "events.task_complete.sound") so per-event
      // fields can be set without a bespoke command per nested field.
      const parts = key.split('.');
      let node = cfg;
      for (let i = 0; i < parts.length - 1; i++) {
        node[parts[i]] = node[parts[i]] || {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = parsed;
      config.saveConfig(cfg);
      break;
    }
    case 'test-sound': {
      const [name, volume] = args;
      await sound.play(name, volume ? Number(volume) : 1);
      break;
    }
    case 'focus': {
      const [cwd, val] = args;
      const state = stateMod.loadState();
      stateMod.setFocus(state, cwd, val === 'true');
      stateMod.saveState(state);
      break;
    }
    case 'relay':
      require('../lib/relay/daemon').start(args[0] ? Number(args[0]) : undefined);
      return; // server keeps the process alive
    case 'mcp-server':
      require('../lib/mcp/server').start();
      return; // stdio server keeps the process alive
    case 'doctor':
      runDoctor();
      break;
    default:
      console.log('Usage: notifier <install|uninstall|dispatch|mute|unmute|status|focus|relay|mcp-server|doctor> [args]');
  }
}

main().catch((err) => {
  // An uncaught throw here (confirmed in practice: install() crashing on a
  // bad cwd) previously failed completely silently from the invoking
  // agent's perspective, with nothing written anywhere — this is the only
  // reason that specific crash was ever found. Cheap enough to keep
  // permanently rather than strip out now that it's proven useful.
  try {
    config.ensureDir();
    fs.appendFileSync(path.join(config.DIR, 'debug-errors.log'), `${new Date().toISOString()} ${process.argv.slice(2).join(' ')}\n${err && err.stack}\n\n`);
  } catch {
    /* best effort */
  }
});
