// Runs the lobby and match server inside the browser for the static build
// (GitHub Pages). The page relays messages here for its own player ("local")
// and for friends connected over WebRTC ("g1", "g2", ...). Running in a
// worker keeps the simulation ticking smoothly next to the renderer and
// when the tab is in the background.

import { LobbyManager } from '../server/lobby.js';

const mgr = new LobbyManager();
const clients = new Map();

function socketFor(cid) {
  return { readyState: 1, bufferedAmount: 0, send: (data) => postMessage({ cid, data }) };
}

onmessage = (ev) => {
  const { op, cid, data } = ev.data;
  if (op === 'open') {
    if (!clients.has(cid)) clients.set(cid, mgr.connect(socketFor(cid)));
    return;
  }
  const client = clients.get(cid);
  if (!client) return;
  if (op === 'close') {
    clients.delete(cid);
    client.ws.readyState = 3;
    mgr.disconnect(client);
    return;
  }
  if (op === 'msg') {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    // friends can only join the lobby this tab is hosting
    if (cid !== 'local' && msg && (msg.t === 'create' || msg.t === 'list')) return;
    try { mgr.handle(client, msg); } catch (e) { console.error('message error', e); }
  }
};
