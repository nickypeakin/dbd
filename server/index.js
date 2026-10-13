// HTTP server for the game client plus the WebSocket endpoint for lobbies
// and matches. Run with `npm start`, then open http://localhost:3000.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { LobbyManager } from './lobby.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const MOUNTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/vendor/fonts/', path.join(ROOT, 'node_modules', '@fontsource')],
  ['/', path.join(ROOT, 'public')],
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

function resolveFile(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  for (const [prefix, dir] of MOUNTS) {
    if (!p.startsWith(prefix)) continue;
    let rel = p.slice(prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const full = path.resolve(dir, rel);
    if (!full.startsWith(dir + path.sep) && full !== dir) return null;
    return full;
  }
  return null;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, lobbies: mgr.lobbies.size, players: mgr.clients.size }));
    return;
  }
  const file = resolveFile(req.url || '/');
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': TYPES[ext] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': file.includes(`${path.sep}node_modules${path.sep}`) ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

const mgr = new LobbyManager();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  const client = mgr.connect(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    try { mgr.handle(client, msg); } catch (e) { console.error('message error', e); }
  });
  ws.on('close', () => mgr.disconnect(client));
  ws.on('error', () => {});
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 15000);

server.listen(PORT, HOST, () => {
  console.log('\n  DEAD BY DAYLIGHT — fan remake server');
  console.log(`  Local:    http://localhost:${PORT}`);
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  Network:  http://${i.address}:${PORT}   <- friends on your Wi-Fi use this`);
    }
  }
  console.log('');
});
