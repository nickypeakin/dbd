// Serverless multiplayer for the static build (GitHub Pages). The lobby and
// match server runs in a Web Worker in this tab, so solo games with bots
// need no network at all. When you host a lobby, this tab also registers the
// lobby code with the free PeerJS matchmaking service; friends who enter the
// code connect straight to your browser over a WebRTC data channel and your
// tab acts as their game server.

import { Net } from './net.js';

const PEER_PREFIX = 'dbd-fan-remake-';
const CHUNK = 15000;          // stay well under every browser's data channel message limit
const MAX_GUEST_MSG = 64 * 1024;
const JOIN_TIMEOUT = 20000;
const SILENCE_TIMEOUT = 15000; // pings flow every 2s, so this means the other side is gone

let peerLib = null;
function loadPeer() {
  if (!peerLib) {
    peerLib = new Promise((resolve, reject) => {
      if (window.Peer) { resolve(window.Peer); return; }
      const s = document.createElement('script');
      s.src = new URL('../vendor/peerjs/peerjs.min.js', import.meta.url).href;
      s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS missing')));
      s.onerror = () => { peerLib = null; reject(new Error('Could not load PeerJS')); };
      document.head.appendChild(s);
    });
  }
  return peerLib;
}

// ?peer=host:port points at a self-hosted PeerJS server (used by tests).
function peerOptions() {
  const v = new URLSearchParams(location.search).get('peer');
  const opts = { debug: 1 };
  if (v) {
    const [host, port] = v.split(':');
    Object.assign(opts, { host, port: Number(port) || 9000, path: '/', secure: false });
  }
  return opts;
}

function sendChunked(conn, str) {
  if (str.length <= CHUNK) { conn.send(str); return; }
  const id = Math.random().toString(36).slice(2, 8);
  const n = Math.ceil(str.length / CHUNK);
  for (let i = 0; i < n; i++) conn.send(`\u0001${id}|${i}|${n}|${str.slice(i * CHUNK, (i + 1) * CHUNK)}`);
}

// Returns the complete message, or null while chunks are still arriving.
function assemble(parts, data, max = Infinity) {
  if (typeof data !== 'string') return null;
  if (data.charCodeAt(0) !== 1) return data.length <= max ? data : null;
  const a = data.indexOf('|'), b = data.indexOf('|', a + 1), c = data.indexOf('|', b + 1);
  const id = data.slice(1, a), i = Number(data.slice(a + 1, b)), n = Number(data.slice(b + 1, c));
  if (!(n > 0) || n * CHUNK > max || !(i >= 0 && i < n)) return null;
  let e = parts.get(id);
  if (!e) { e = { got: 0, list: new Array(n) }; parts.set(id, e); }
  if (e.list[i] == null) { e.list[i] = data.slice(c + 1); e.got++; }
  if (e.got < n) return null;
  parts.delete(id);
  return e.list.join('');
}

export class P2PNet extends Net {
  constructor() {
    super();
    this.p2p = true;
    this.localId = null;
    this.localLobby = null;   // code of the lobby our own worker is running for us
    this.remote = null;       // connection to a friend's lobby while we are their guest
    this.host = null;         // PeerJS endpoint accepting friends while we host
    this.hostStatus = null;   // 'connecting' | 'online' | 'offline'
    this.guests = new Map();
    this.nextGuest = 1;
    this.lastHello = null;
    this.peerOpts = peerOptions();
  }

  connect() {
    this.worker = new Worker(new URL('./host-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev) => this.fromWorker(ev.data);
    this.worker.onerror = (e) => console.error('host worker error', e.message || e);
    this.worker.postMessage({ op: 'open', cid: 'local' });
    this.open = true;
    this.emit('open');
    this.pingTimer = setInterval(() => { this.send({ t: 'ping', c: performance.now() }); this.watchdog(); }, 2000);
    addEventListener('pagehide', () => this.shutdown());
  }

  // A closed tab or dropped connection doesn't always close the data channel
  // promptly, so treat a long silence as a disconnect.
  watchdog() {
    const now = performance.now();
    const r = this.remote;
    if (r && r.ready && now - r.lastRecv > SILENCE_TIMEOUT) this.remoteClosed(r);
    for (const g of [...this.guests.values()]) if (now - g.last > SILENCE_TIMEOUT) g.close();
  }

  shutdown() {
    this.dropRemote();
    this.stopHosting();
  }

  // ------------------------------------------------------------ outgoing --
  send(msg) {
    if (msg.t === 'hello') this.lastHello = msg;
    if (msg.t === 'name' && this.lastHello) this.lastHello = { ...this.lastHello, name: msg.name };
    if (msg.t === 'list') { this.emit('list', { t: 'list', lobbies: [] }); return; }
    if (msg.t === 'join') {
      const code = String(msg.code || '').toUpperCase().trim();
      if (code !== this.localLobby) { this.joinRemote(code, { ...msg, code }); return; }
    }
    if (msg.t === 'create' && this.remote) this.leaveRemote(false);
    if (this.remote) {
      if (msg.t === 'leave') { this.leaveRemote(true); return; }
      if (this.remote.ready) sendChunked(this.remote.conn, JSON.stringify(msg));
      else if (msg.t !== 'ping') this.remote.queue.push(msg);
      return;
    }
    this.toWorker('local', JSON.stringify(msg));
  }

  toWorker(cid, data) {
    this.worker.postMessage({ op: 'msg', cid, data });
  }

  // ------------------------------------------------------------ incoming --
  deliver(m) {
    if (m.t === 'welcome') this.id = m.id;
    if (m.t === 'pong') this.rtt = this.rtt * 0.7 + (performance.now() - m.c) * 0.3;
    this.emit(m.t, m);
    this.emit('*', m);
  }

  fromWorker({ cid, data }) {
    if (cid !== 'local') {
      const g = this.guests.get(cid);
      const conn = g && g.conn;
      if (!conn || !conn.open) return;
      // drop snapshots for a friend whose connection is backed up; the next one supersedes it
      if (data.startsWith('{"t":"s"') && conn.dataChannel && conn.dataChannel.bufferedAmount > 256 * 1024) return;
      try { sendChunked(conn, data); } catch (e) { console.warn('send to guest failed', e); }
      return;
    }
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'welcome') this.localId = m.id;
    if (m.t === 'lobby') { this.localLobby = m.lobby.code; this.startHosting(m.lobby.code); }
    if (m.t === 'left' || m.t === 'kicked') { this.localLobby = null; this.stopHosting(); }
    if (this.remote) return; // our own worker is idle while we play in a friend's lobby
    this.deliver(m);
  }

  // ----------------------------------------------------- guest (joining) --
  async joinRemote(code, joinMsg) {
    this.dropRemote();
    if (this.localLobby) this.toWorker('local', JSON.stringify({ t: 'leave' }));
    const r = (this.remote = { code, conn: null, peer: null, ready: false, inLobby: false, queue: [], parts: new Map() });
    const fail = (text) => {
      if (this.remote !== r) return;
      this.dropRemote();
      this.deliver({ t: 'error', text });
    };
    r.timer = setTimeout(() => fail(`Couldn't reach lobby ${code}. Check the code and make sure the host still has the game open.`), JOIN_TIMEOUT);
    this.emit('toast', { t: 'toast', text: `Connecting to lobby ${code}...` });
    let Peer;
    try { Peer = await loadPeer(); } catch { fail('Could not load the multiplayer library. Check your internet connection.'); return; }
    if (this.remote !== r) return;
    const peer = (r.peer = new Peer(this.peerOpts));
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') fail(`No lobby with code ${code}. The host may have left or closed the game.`);
      else if (!r.ready) fail(`Couldn't connect to lobby ${code} (${e.type}).`);
    });
    peer.on('open', () => {
      if (this.remote !== r) return;
      const conn = (r.conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'raw' }));
      conn.on('open', () => {
        if (this.remote !== r) return;
        clearTimeout(r.timer);
        r.ready = true;
        r.lastRecv = performance.now();
        if (this.lastHello) sendChunked(conn, JSON.stringify(this.lastHello));
        sendChunked(conn, JSON.stringify(joinMsg));
        for (const m of r.queue) sendChunked(conn, JSON.stringify(m));
        r.queue = [];
      });
      conn.on('data', (d) => this.fromRemote(r, d));
      conn.on('close', () => this.remoteClosed(r));
      conn.on('error', () => this.remoteClosed(r));
    });
  }

  fromRemote(r, d) {
    if (this.remote !== r) return;
    r.lastRecv = performance.now();
    const s = assemble(r.parts, d);
    if (s == null) return;
    let m;
    try { m = JSON.parse(s); } catch { return; }
    if (m.t === 'lobby') r.inLobby = true;
    // the host turned us away (full, wrong code) before we got in
    if (m.t === 'error' && !r.inLobby) { this.dropRemote(); this.deliver(m); return; }
    this.deliver(m);
    if (m.t === 'left' || m.t === 'kicked') this.dropRemote();
  }

  remoteClosed(r) {
    if (this.remote !== r) return;
    const wasIn = r.inLobby;
    this.dropRemote();
    if (wasIn) this.deliver({ t: 'hostLost' });
    else this.deliver({ t: 'error', text: 'Lost connection to the lobby.' });
  }

  leaveRemote(notify) {
    const r = this.remote;
    if (r && r.ready) { try { r.conn.send(JSON.stringify({ t: 'leave' })); } catch { /* closing anyway */ } }
    // give the leave message a moment to go out before closing the channel
    const { conn, peer } = r || {};
    this.remote = null;
    if (r) clearTimeout(r.timer);
    setTimeout(() => { try { conn && conn.close(); } catch {} try { peer && peer.destroy(); } catch {} }, 300);
    this.id = this.localId;
    if (notify) this.deliver({ t: 'left' });
  }

  dropRemote() {
    const r = this.remote;
    if (!r) return;
    this.remote = null;
    clearTimeout(r.timer);
    try { r.conn && r.conn.close(); } catch {}
    try { r.peer && r.peer.destroy(); } catch {}
    this.id = this.localId;
  }

  // ----------------------------------------------------- host (friends) --
  setHostStatus(s) {
    if (this.hostStatus === s) return;
    this.hostStatus = s;
    this.emit('hostStatus', s);
  }

  async startHosting(code) {
    if (this.host && this.host.code === code) return;
    this.stopHosting();
    const h = (this.host = { code, peer: null });
    this.setHostStatus('connecting');
    let Peer;
    try { Peer = await loadPeer(); } catch { if (this.host === h) this.setHostStatus('offline'); return; }
    if (this.host !== h) return;
    const peer = (h.peer = new Peer(PEER_PREFIX + code, this.peerOpts));
    peer.on('open', () => { if (this.host === h) this.setHostStatus('online'); });
    peer.on('connection', (conn) => this.acceptGuest(conn));
    peer.on('disconnected', () => {
      // lost the matchmaking server; friends already connected keep playing
      if (this.host !== h || peer.destroyed) return;
      this.setHostStatus('connecting');
      setTimeout(() => { if (this.host === h && !peer.destroyed) peer.reconnect(); }, 2000);
    });
    peer.on('error', (e) => {
      if (this.host !== h) return;
      console.warn('host peer error', e.type, e.message);
      if (e.type === 'unavailable-id') {
        this.setHostStatus('offline');
        this.deliver({ t: 'toast', text: 'This lobby code is already taken online. Leave and host again to get a new one.' });
      } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(e.type)) {
        this.setHostStatus('offline');
      }
    });
  }

  acceptGuest(conn) {
    const cid = 'g' + this.nextGuest++;
    const parts = new Map();
    let joined = false;
    const g = { conn, last: performance.now(), close: null };
    const close = (g.close = () => {
      if (!joined) return;
      joined = false;
      this.guests.delete(cid);
      this.worker.postMessage({ op: 'close', cid });
      try { conn.close(); } catch {}
    });
    conn.on('open', () => {
      joined = true;
      g.last = performance.now();
      this.guests.set(cid, g);
      this.worker.postMessage({ op: 'open', cid });
    });
    conn.on('data', (d) => {
      if (!joined) return;
      g.last = performance.now();
      const s = assemble(parts, d, MAX_GUEST_MSG);
      if (s != null) this.toWorker(cid, s);
    });
    conn.on('close', close);
    conn.on('error', close);
  }

  stopHosting() {
    const h = this.host;
    if (!h) return;
    this.host = null;
    for (const g of [...this.guests.values()]) g.close();
    try { h.peer && h.peer.destroy(); } catch {}
    this.setHostStatus(null);
  }
}
