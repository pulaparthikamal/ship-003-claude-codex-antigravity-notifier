const fs = require('fs');
const path = require('path');

// Whether cwd is a git working tree root — we only ever touch .gitignore
// inside one, since outside a repo there's no diff/status view to pollute in
// the first place.
function isGitRepo(cwd) {
  return fs.existsSync(path.join(cwd, '.git'));
}

// Adds `pattern` to <cwd>/.gitignore if it isn't already covered, so a hook
// config file this tool writes directly into a project workspace (Cursor's
// .cursor/hooks.json, Antigravity's .agents/hooks.json — see their install()
// callers) never shows up as an untracked/modified file in the user's source
// control diff. No-op outside a git repo, and idempotent: safe to call on
// every install() run without growing the file.
function ensureIgnored(cwd, pattern) {
  if (!cwd || !isGitRepo(cwd)) return;
  const p = path.join(cwd, '.gitignore');
  const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  if (existing.split('\n').some((line) => line.trim() === pattern)) return;
  const sep = existing.length && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(p, `${existing}${sep}${pattern}\n`);
}

module.exports = { ensureIgnored };
