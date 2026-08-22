const path = require('path');

// Generic adapter contract for any agent that can invoke a shell command with
// a JSON payload but isn't one of the first-class adapters. `mapping` is a
// small user-supplied config (see AGENT_INTEGRATIONS.md#other-agents--editors)
// telling us which payload fields carry what.
function normalize(raw, mapping = {}) {
  const kindValue = raw[mapping.kindField || 'event'];
  const kind = (mapping.kindMap && mapping.kindMap[kindValue]) || 'task_complete';
  const cwd = raw[mapping.cwdField || 'cwd'] || process.cwd();

  return {
    agent: mapping.agentName || 'generic',
    kind,
    sessionId: raw[mapping.sessionField || 'session_id'] || 'unknown',
    cwd,
    projectName: path.basename(cwd),
    detail: raw[mapping.detailField || 'detail'],
    fromSubagent: false,
    timestamp: Date.now()
  };
}

module.exports = { normalize };
