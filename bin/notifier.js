#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const engine = require('../lib/core/engine');
const config = require('../lib/core/config');
const stateMod = require('../lib/core/state');
const sound = require('../lib/core/sound');
const claude = require('../lib/adapters/claude');
const codex = require('../lib/adapters/codex');
const antigravity = require('../lib/adapters/antigravity');
const generic = require('../lib/adapters/generic');

const ADAPTERS = { claude, codex, antigravity };

function cliBinCommand() {
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve(__dirname, 'notifier.js'))}`;
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
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const bin = cliBinCommand();
  const cliJsPath = path.resolve(__dirname, 'notifier.js');

  switch (cmd) {
    case 'install': {
      const target = args[0];
      const names = target && target !== 'all' ? [target] : Object.keys(ADAPTERS);
      for (const name of names) {
        if (!ADAPTERS[name]) {
          console.error(`Unknown agent "${name}". Known: ${Object.keys(ADAPTERS).join(', ')}`);
          continue;
        }
        const p = ADAPTERS[name].install(bin, process.cwd());
        console.log(`Installed ${name} hooks -> ${p}`);
      }
      break;
    }
    case 'uninstall': {
      const target = args[0];
      const names = target && target !== 'all' ? [target] : Object.keys(ADAPTERS);
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
      await engine.dispatch(evt);
      if (agent === 'antigravity' && raw.hook_event_name === 'PostToolUse') {
        antigravity.scheduleIdleCheck(evt.sessionId, evt.cwd, cliJsPath);
      }
      break;
    }
    case 'idle-check': {
      const [sessionId, cwd, marker] = args;
      const before = readMarker(marker);
      setTimeout(async () => {
        const after = readMarker(marker);
        if (before && after && before.ts === after.ts) {
          try {
            fs.unlinkSync(marker);
          } catch {
            /* already gone */
          }
          await engine.dispatch(antigravity.normalize({ hook_event_name: 'Idle', session_id: sessionId, cwd }));
        }
      }, antigravity.IDLE_MS);
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
    case 'doctor':
      runDoctor();
      break;
    default:
      console.log('Usage: notifier <install|uninstall|dispatch|mute|unmute|status|focus|relay|doctor> [args]');
  }
}

main();
