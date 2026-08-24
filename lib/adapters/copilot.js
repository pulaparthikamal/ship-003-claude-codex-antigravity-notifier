const fs = require('fs');
const path = require('path');

// GitHub Copilot Chat has NO documented API for a third-party extension to
// observe its lifecycle (message sent/received, tool approval, response
// complete) — confirmed against microsoft/vscode#310951, a feature request
// asking for exactly this, closed "not planned". The only real, working
// integration pattern (also used by prior art like
// github.com/davidkelley/agent-notifier) is exposing an MCP tool the model
// can choose to call from its own agent-mode tool loop — see lib/mcp/server.js.
//
// This is instruction-compliance, NOT a lifecycle guarantee: the model can
// simply not call the tool, and it can never fire for anything that happens
// before the model's next turn (e.g. a permission dialog Copilot itself
// raises outside the tool loop). ALWAYS disclose this caveat to the user —
// never present Copilot "support" as equivalent to the real hooks the other
// adapters use.
function normalize() {
  return null; // never invoked as a hook dispatch target — the MCP server calls the engine directly
}

function mcpConfigPath(cwd) {
  return path.join(cwd || process.cwd(), '.vscode', 'mcp.json');
}

// cliBin is `"<node>" "<notifier.js path>"` (see bin/notifier.js's
// cliBinCommand()) — split back into command+args since VS Code's mcp.json
// wants them as separate array entries, not one shell string like the other
// adapters' hook "command" fields.
function splitCliBin(cliBin) {
  const parts = (cliBin.match(/"([^"]*)"/g) || []).map((s) => s.slice(1, -1));
  return { command: parts[0], args: parts.slice(1) };
}

function install(cliBin, cwd) {
  const p = mcpConfigPath(cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cfg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  cfg.servers = cfg.servers || {};
  const { command, args } = splitCliBin(cliBin);
  cfg.servers.notifier = { type: 'stdio', command, args: [...args, 'mcp-server'] };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

function uninstall(cwd) {
  const p = mcpConfigPath(cwd);
  if (!fs.existsSync(p)) return;
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (cfg.servers) delete cfg.servers.notifier;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

const RECOMMENDED_INSTRUCTION =
  "When you finish a task, need my approval for something, or are about to ask me a question, call the `notify` tool from the `notifier` MCP server with an appropriate `kind`. This is the only way I get notified — Copilot Chat has no other lifecycle hook — so please don't skip it.";

module.exports = { normalize, install, uninstall, RECOMMENDED_INSTRUCTION };
