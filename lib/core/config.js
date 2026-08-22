const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const DIR = path.join(HOME, '.notifier');
const CONFIG_PATH = path.join(DIR, 'config.json');
const STATE_PATH = path.join(DIR, 'state.json');
const LOG_PATH = path.join(DIR, 'log.jsonl');
const MUTE_PATH = path.join(DIR, 'muted');

const DEFAULT_CONFIG = {
  events: {
    permission: { level: 'sound+popup', sound: 'Ping', label: '🔐 Needs approval' },
    question: { level: 'sound+popup', sound: 'Glass', label: '❓ Question' },
    idle: { level: 'popup', sound: 'Pop', label: '💤 Idle' },
    task_complete: { level: 'sound+popup', sound: 'Hero', label: '✅ Done' },
    subagent_complete: { level: 'off', sound: 'Pop', label: '🤖 Subagent done' },
    error: { level: 'sound+popup', sound: 'Basso', label: '⚠️ Error' }
  },
  minTaskDurationThreshold: 0,
  autoMuteWhenFocused: false,
  suppressSubagentInteractions: true,
  showChatTitle: true,
  showDetail: true,
  agents: { claude: true, codex: true, antigravity: true },
  remoteAudio: { enabled: false, host: null, port: 47623 },
  volume: 1
};

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  ensureDir();
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function deepMerge(base, override) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(override || {})) {
    const ov = override[k];
    if (ov && typeof ov === 'object' && !Array.isArray(ov) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], ov);
    } else {
      out[k] = ov;
    }
  }
  return out;
}

function findUp(startDir, filename) {
  let dir = startDir;
  for (;;) {
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Global config (~/.notifier/config.json), optionally overridden by a per-repo
// .notifier.json found by walking up from cwd (nearest wins).
function loadConfig(cwd) {
  ensureDir();
  let cfg = deepMerge(DEFAULT_CONFIG, readJson(CONFIG_PATH, {}));
  if (cwd) {
    const repoCfgPath = findUp(cwd, '.notifier.json');
    if (repoCfgPath) cfg = deepMerge(cfg, readJson(repoCfgPath, {}));
  }
  return cfg;
}

function saveConfig(cfg) {
  writeJson(CONFIG_PATH, cfg);
}

module.exports = {
  DIR,
  CONFIG_PATH,
  STATE_PATH,
  LOG_PATH,
  MUTE_PATH,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  ensureDir,
  readJson,
  writeJson
};
