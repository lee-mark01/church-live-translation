/**
 * Combined production server: Next.js + WebSocket on a single port.
 * Used for Railway/Docker deployment.
 *
 * - HTTP requests → Next.js handler
 * - Upgrade on /ws → WebSocket server
 */
import next from 'next';
import { createServer } from 'http';
import { createNoServerWss } from './ws/server';

const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev: false });
const handle = app.getRequestHandler();
const wss = createNoServerWss();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      // Let Next.js handle non-WS upgrades (e.g. HMR in dev)
      socket.destroy();
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`> Combined server ready on http://0.0.0.0:${port}`);
  });
});
