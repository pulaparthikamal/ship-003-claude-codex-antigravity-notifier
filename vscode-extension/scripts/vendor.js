// Copies the root bin/ and lib/ into vscode-extension/, so the packaged VSIX
// is self-contained (extensions install as standalone folders — there is no
// "parent repo" to reach up into once shipped). Runs as vscode:prepublish.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEST = path.join(__dirname, '..');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

copyDir(path.join(ROOT, 'bin'), path.join(DEST, 'bin'));
copyDir(path.join(ROOT, 'lib'), path.join(DEST, 'lib'));
// Root resources/ (e.g. the bundled fallback-tone.wav sound.js falls back to)
// merges into vscode-extension/resources/ without touching the extension's
// own icon.png / icon-variants already living there.
copyDir(path.join(ROOT, 'resources'), path.join(DEST, 'resources'));
console.log('vendored bin/, lib/, and resources/ into vscode-extension/');
