const net = require('net');

// Fire-and-forget: tell the relay daemon (local machine, reached through an
// SSH reverse forward when the agent runs remotely) to play a sound.
function sendPlay(remoteCfg, soundName, volume) {
  try {
    const socket = net.connect(remoteCfg.port || 47623, remoteCfg.host || '127.0.0.1');
    socket.on('connect', () => socket.end(JSON.stringify({ soundName, volume })));
    socket.on('error', () => {});
  } catch {
    /* best-effort */
  }
}

module.exports = { sendPlay };
