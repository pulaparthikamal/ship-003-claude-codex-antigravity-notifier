const fs = require('fs');
const { LOG_PATH, ensureDir } = require('./config');

const MAX_LINES = 500;

function append(entry) {
  ensureDir();
  fs.appendFileSync(LOG_PATH, JSON.stringify({ ...entry, at: Date.now() }) + '\n');
  // Cheap rotation: trim to the last MAX_LINES once in a while.
  if (Math.random() < 0.05) {
    try {
      const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);
      if (lines.length > MAX_LINES) {
        fs.writeFileSync(LOG_PATH, lines.slice(-MAX_LINES).join('\n') + '\n');
      }
    } catch {
      /* best-effort */
    }
  }
}

module.exports = { append };
