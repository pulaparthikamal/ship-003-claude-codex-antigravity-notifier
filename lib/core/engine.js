const fs = require('fs');
const config = require('./config');
const stateMod = require('./state');
const sound = require('./sound');
const popup = require('./popup');
const log = require('./log');

// Single entry point every adapter's normalized CanonicalEvent flows through.
async function dispatch(evt) {
  if (fs.existsSync(config.MUTE_PATH)) return log.append({ evt, dispatched: false, reason: 'muted' });
  if (process.env.CLAUDE_NOTIFIER_DISABLE) return log.append({ evt, dispatched: false, reason: 'env-disabled' });

  const cfg = config.loadConfig(evt.cwd);
  if (cfg.agents && cfg.agents[evt.agent] === false) {
    return log.append({ evt, dispatched: false, reason: 'agent-disabled' });
  }

  const state = stateMod.loadState();
  const decision = stateMod.shouldNotify(state, evt, cfg);

  const eventCfg = (cfg.events && cfg.events[evt.kind]) || { level: 'sound+popup', sound: 'Ping', label: evt.kind };
  const willDispatch = decision.shouldNotify && eventCfg.level !== 'off';

  stateMod.recordHistory(state, evt, willDispatch);
  stateMod.saveState(state);

  if (!decision.shouldNotify) return log.append({ evt, dispatched: false, reason: decision.reason });
  if (eventCfg.level === 'off') return log.append({ evt, dispatched: false, reason: 'level-off' });

  const title = `${eventCfg.label || evt.kind}${cfg.showChatTitle ? ` — ${evt.projectName}` : ''}`;
  const body = cfg.showDetail && evt.detail ? String(evt.detail) : evt.toolName ? `Tool: ${evt.toolName}` : evt.kind;

  const wantsSound = eventCfg.level === 'sound+popup' || eventCfg.level === 'sound';
  const wantsPopup = eventCfg.level === 'sound+popup' || eventCfg.level === 'popup';

  if (wantsSound) {
    if (cfg.remoteAudio && cfg.remoteAudio.enabled) {
      require('../relay/client').sendPlay(cfg.remoteAudio, eventCfg.sound, cfg.volume);
    } else {
      await sound.play(eventCfg.sound, cfg.volume);
    }
  }
  if (wantsPopup) await popup.show(title, body, { clickable: true });

  return log.append({ evt, dispatched: true });
}

module.exports = { dispatch };
