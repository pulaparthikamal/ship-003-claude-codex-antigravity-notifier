const { STATE_PATH, readJson, writeJson } = require('./config');

const COALESCE_MS = 3000;

function loadState() {
  return readJson(STATE_PATH, { sessions: {}, focused: {}, crossDedup: {}, history: [] });
}

function saveState(state) {
  writeJson(STATE_PATH, state);
}

// Decides whether a CanonicalEvent should actually be dispatched, applying
// (in order): per-session dedup, cross-agent same-project dedup, min-duration
// threshold, subagent suppression, and auto-mute-when-focused.
function shouldNotify(state, evt, cfg) {
  state.sessions = state.sessions || {};
  state.crossDedup = state.crossDedup || {};
  state.focused = state.focused || {};

  const key = `${evt.agent}:${evt.sessionId}`;
  const sess = state.sessions[key] || (state.sessions[key] = { lastKind: null, lastAt: 0, turnStartedAt: null });

  if (sess.lastKind === evt.kind && evt.timestamp - sess.lastAt < COALESCE_MS) {
    sess.lastAt = evt.timestamp;
    return { shouldNotify: false, reason: 'dedup' };
  }

  const crossKey = `${evt.cwd}:${evt.kind}`;
  const lastCross = state.crossDedup[crossKey] || 0;
  const isCrossDup = evt.timestamp - lastCross < COALESCE_MS;
  state.crossDedup[crossKey] = evt.timestamp;
  if (isCrossDup) {
    sess.lastKind = evt.kind;
    sess.lastAt = evt.timestamp;
    return { shouldNotify: false, reason: 'cross-agent-dedup' };
  }

  if (evt.kind === 'task_complete' && cfg.minTaskDurationThreshold > 0) {
    const started = sess.turnStartedAt;
    sess.turnStartedAt = evt.timestamp;
    if (started && (evt.timestamp - started) / 1000 < cfg.minTaskDurationThreshold) {
      sess.lastKind = evt.kind;
      sess.lastAt = evt.timestamp;
      return { shouldNotify: false, reason: 'below-min-duration' };
    }
  }

  if (cfg.suppressSubagentInteractions && evt.fromSubagent && (evt.kind === 'permission' || evt.kind === 'question')) {
    sess.lastKind = evt.kind;
    sess.lastAt = evt.timestamp;
    return { shouldNotify: false, reason: 'subagent-suppressed' };
  }

  if (cfg.autoMuteWhenFocused && state.focused[evt.cwd]) {
    sess.lastKind = evt.kind;
    sess.lastAt = evt.timestamp;
    return { shouldNotify: false, reason: 'auto-muted-focused' };
  }

  sess.lastKind = evt.kind;
  sess.lastAt = evt.timestamp;
  return { shouldNotify: true };
}

function recordHistory(state, evt, dispatched) {
  state.history = state.history || [];
  state.history.unshift({ ...evt, dispatched });
  state.history = state.history.slice(0, 100);
}

function setFocus(state, cwd, focused) {
  state.focused = state.focused || {};
  state.focused[cwd] = focused;
}

module.exports = { loadState, saveState, shouldNotify, recordHistory, setFocus };
