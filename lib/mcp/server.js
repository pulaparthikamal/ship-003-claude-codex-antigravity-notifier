const readline = require('readline');
const path = require('path');
const engine = require('../core/engine');

// Minimal hand-rolled MCP server (stdio transport: newline-delimited JSON-RPC
// 2.0, no Content-Length framing) exposing exactly one tool, `notify`. This
// exists ONLY because GitHub Copilot Chat has no lifecycle API a third-party
// extension can passively observe (confirmed: microsoft/vscode#310951, closed
// "not planned") — this is the sole documented workaround pattern (also used
// by prior art like davidkelley/agent-notifier): give the model a tool and
// rely on it choosing to call it. That makes this instruction-compliance, NOT
// an event guarantee — the model can simply not call it. See
// lib/adapters/copilot.js for the fuller caveat and setup.
const PROTOCOL_VERSION = '2024-11-05';
const SESSION_ID = `copilot-${process.pid}-${Date.now()}`;
const VALID_KINDS = ['task_complete', 'permission', 'question', 'error'];

const NOTIFY_TOOL = {
  name: 'notify',
  description:
    "Send a desktop notification (sound + popup) via the Notifier extension. Call this when you finish a task, need the user's approval for something, or are about to ask the user a question — this is the only way the user finds out, since Copilot Chat has no lifecycle event Notifier can observe on its own.",
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: VALID_KINDS, description: 'What kind of event this is.' },
      detail: { type: 'string', description: 'Short (one sentence) summary shown in the notification body.' }
    },
    required: ['kind']
  }
};

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function reply(id, result) {
  if (id === undefined || id === null) return; // was a notification, no response expected
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'notifier-mcp', version: '0.1.0' } });
    } else if (method === 'notifications/initialized' || method === 'ping') {
      reply(id, {});
    } else if (method === 'tools/list') {
      reply(id, { tools: [NOTIFY_TOOL] });
    } else if (method === 'tools/call') {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (name !== 'notify') {
        replyError(id, -32602, `Unknown tool "${name}"`);
        return;
      }
      const cwd = process.env.NOTIFIER_MCP_CWD || process.cwd();
      await engine.dispatch({
        agent: 'copilot',
        kind: VALID_KINDS.includes(args.kind) ? args.kind : 'task_complete',
        sessionId: SESSION_ID,
        cwd,
        projectName: path.basename(cwd),
        detail: args.detail,
        fromSubagent: false,
        timestamp: Date.now()
      });
      reply(id, { content: [{ type: 'text', text: 'Notified.' }] });
    } else if (id !== undefined && id !== null) {
      replyError(id, -32601, `Unknown method "${method}"`);
    }
  } catch (err) {
    replyError(id, -32603, String((err && err.message) || err));
  }
}

function start() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // not valid JSON-RPC — ignore rather than crash the server
    }
    handle(msg);
  });
}

module.exports = { start };
