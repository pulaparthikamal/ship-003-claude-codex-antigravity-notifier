const net = require('net');
const sound = require('../core/sound');

// Runs on the user's LOCAL machine; the remote agent's dispatcher connects to
// it (via an SSH reverse forward) instead of trying to play audio headlessly.
function start(port = 47623) {
  const server = net.createServer((socket) => {
    let data = '';
    socket.on('data', (c) => (data += c));
    socket.on('end', () => {
      try {
        const { soundName, volume } = JSON.parse(data);
        sound.play(soundName, volume);
      } catch {
        /* ignore malformed payloads */
      }
    });
  });
  server.listen(port, '127.0.0.1', () => console.log(`notifier relay listening on 127.0.0.1:${port}`));
  return server;
}

module.exports = { start };
