// Lobbies: up to 5 humans pick roles and loadouts; empty slots are filled
// with bots. When everyone is ready a countdown starts the match.

import { Match } from './match.js';
import {
  SURVIVORS, KILLERS, REALMS, SURVIVOR_PERK_IDS, KILLER_PERK_IDS, DIFFICULTIES,
  sanitizeLoadout, defaultLoadout,
} from '../shared/data.js';
import { TICK_RATE } from '../shared/constants.js';
import { randomSeed } from '../shared/rng.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COUNTDOWN = 5;
const LOAD_TIMEOUT = 25;

function pickN(arr, n) { return arr.slice().sort(() => Math.random() - 0.5).slice(0, n); }
function cleanName(n) {
  n = String(n || '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 18);
  return n || 'Survivor' + Math.floor(Math.random() * 900 + 100);
}

function botSurvivorLoadout(taken) {
  const free = Object.keys(SURVIVORS).filter((c) => !taken.includes(c));
  const character = free[Math.floor(Math.random() * free.length)] || 'dwight';
  const item = Math.random() < 0.6 ? ['medkit', 'toolbox', 'flashlight'][Math.floor(Math.random() * 3)] : null;
  return { character, perks: pickN(SURVIVOR_PERK_IDS, 4), item, name: SURVIVORS[character].short };
}
function botKillerLoadout() {
  const ks = Object.keys(KILLERS);
  const character = ks[Math.floor(Math.random() * ks.length)];
  return { character, perks: pickN(KILLER_PERK_IDS, 4), item: null, name: KILLERS[character].name };
}

class Lobby {
  constructor(mgr, host, opts = {}) {
    this.mgr = mgr;
    this.code = mgr.newCode();
    this.hostId = host.id;
    this.members = new Map();
    this.settings = {
      difficulty: DIFFICULTIES.includes(opts.difficulty) ? opts.difficulty : 'normal',
      realm: opts.realm && (REALMS[opts.realm] || opts.realm === 'random') ? opts.realm : 'random',
      public: !!opts.public,
      name: cleanName(opts.name || `${host.name}'s Lobby`).slice(0, 28),
    };
    this.state = 'lobby';
    this.countdownEnd = null;
    this.match = null;
    this.matchPlayers = new Set();
    this.chat = [];
    this.bots = { killer: botKillerLoadout(), survivors: [] };
    for (let i = 0; i < 4; i++) this.bots.survivors.push(botSurvivorLoadout(this.bots.survivors.map((b) => b.character)));
    this.slots = { killer: null, survivors: [null, null, null, null] };
    this.lastResults = null;
  }

  // ------------------------------------------------------------ members --
  add(client, role) {
    const m = {
      id: client.id, name: client.name, ready: false, role: null, wantRole: role === 'killer' ? 'killer' : 'survivor',
      loadouts: { survivor: sanitizeLoadout('survivor', client.loadouts && client.loadouts.survivor), killer: sanitizeLoadout('killer', client.loadouts && client.loadouts.killer) },
      waiting: this.state !== 'lobby' && this.state !== 'countdown',
    };
    this.members.set(client.id, m);
    client.lobby = this;
    this.assignSlots();
    this.system(`${m.name} joined the lobby`);
    if (this.state === 'countdown') this.cancelCountdown();
    this.broadcastState();
  }

  remove(id) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    if (this.match && this.matchPlayers.has(id)) {
      this.match.onDisconnect(id);
      this.matchPlayers.delete(id);
    }
    if (this.hostId === id) {
      const next = this.members.keys().next().value;
      this.hostId = next || null;
      if (next) this.system(`${this.members.get(next).name} is now the host`);
    }
    if (!this.members.size) {
      this.destroy();
      return;
    }
    this.system(`${m.name} left the lobby`);
    if (this.state === 'lobby' || this.state === 'countdown') {
      this.assignSlots();
      this.checkReady();
    }
    this.broadcastState();
  }

  assignSlots() {
    if (this.state !== 'lobby' && this.state !== 'countdown') return;
    const ids = [...this.members.keys()];
    this.slots = { killer: null, survivors: [null, null, null, null] };
    // killer: host first, then join order
    const order = [this.hostId, ...ids.filter((i) => i !== this.hostId)].filter((i) => this.members.has(i));
    for (const id of order) {
      const m = this.members.get(id);
      if (m.wantRole === 'killer' && this.slots.killer == null) { this.slots.killer = id; m.role = 'killer'; }
    }
    let si = 0;
    for (const id of order) {
      const m = this.members.get(id);
      if (this.slots.killer === id) continue;
      if (si < 4) { this.slots.survivors[si++] = id; m.role = 'survivor'; }
      else m.role = null;
    }
    // bots must not duplicate human survivor characters
    const human = this.slots.survivors.filter(Boolean).map((id) => this.members.get(id).loadouts.survivor.character);
    for (let i = 0; i < 4; i++) {
      const b = this.bots.survivors[i];
      if (human.includes(b.character)) {
        const others = this.bots.survivors.filter((x, j) => j !== i).map((x) => x.character);
        this.bots.survivors[i] = botSurvivorLoadout([...human, ...others]);
      }
    }
  }

  setRole(id, role) {
    const m = this.members.get(id);
    if (!m || (this.state !== 'lobby' && this.state !== 'countdown')) return;
    if (role !== 'killer' && role !== 'survivor') return;
    if (role === 'killer' && this.slots.killer && this.slots.killer !== id) {
      this.mgr.send(id, { t: 'toast', text: 'Another player is already the Killer.' });
      return;
    }
    m.wantRole = role;
    m.ready = false;
    this.cancelCountdown();
    this.assignSlots();
    this.broadcastState();
  }

  setLoadout(id, role, lo) {
    const m = this.members.get(id);
    if (!m || (role !== 'killer' && role !== 'survivor')) return;
    m.loadouts[role] = sanitizeLoadout(role, lo);
    if (this.state === 'lobby' || this.state === 'countdown') this.assignSlots();
    this.broadcastState();
  }

  setReady(id, ready) {
    const m = this.members.get(id);
    if (!m || (this.state !== 'lobby' && this.state !== 'countdown')) return;
    if (m.role == null) { this.mgr.send(id, { t: 'toast', text: 'The lobby is full — you will play next match.' }); return; }
    m.ready = !!ready;
    this.checkReady();
    this.broadcastState();
  }

  setSettings(id, s) {
    if (id !== this.hostId || !s) return;
    if (DIFFICULTIES.includes(s.difficulty)) this.settings.difficulty = s.difficulty;
    if (s.realm && (REALMS[s.realm] || s.realm === 'random')) this.settings.realm = s.realm;
    if (typeof s.public === 'boolean') this.settings.public = s.public;
    if (typeof s.name === 'string') this.settings.name = cleanName(s.name).slice(0, 28);
    if (s.rerollBots && (this.state === 'lobby' || this.state === 'countdown')) {
      this.bots.killer = botKillerLoadout();
      this.bots.survivors = [];
      for (let i = 0; i < 4; i++) this.bots.survivors.push(botSurvivorLoadout(this.bots.survivors.map((b) => b.character)));
      this.assignSlots();
    }
    if (this.state === 'countdown') this.cancelCountdown();
    for (const m of this.members.values()) m.ready = false;
    this.broadcastState();
  }

  kick(id, target) {
    if (id !== this.hostId || target === id || !this.members.has(target)) return;
    const c = this.mgr.clients.get(target);
    this.remove(target);
    if (c) { c.lobby = null; this.mgr.send(target, { t: 'kicked' }); }
  }

  say(id, text) {
    const m = this.members.get(id);
    if (!m) return;
    const c = this.mgr.clients.get(id);
    const now = Date.now();
    if (c && now - (c.lastChat || 0) < 400) return;
    if (c) c.lastChat = now;
    text = String(text || '').slice(0, 200).trim();
    if (!text) return;
    const msg = { from: m.name, id, text, at: now };
    this.chat.push(msg);
    if (this.chat.length > 60) this.chat.shift();
    for (const mid of this.members.keys()) this.mgr.send(mid, { t: 'chat', msg });
  }

  system(text) {
    const msg = { from: null, text, at: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > 60) this.chat.shift();
    for (const mid of this.members.keys()) this.mgr.send(mid, { t: 'chat', msg });
  }

  // ---------------------------------------------------------- countdown --
  checkReady() {
    if (this.state !== 'lobby' && this.state !== 'countdown') return;
    const active = [...this.members.values()].filter((m) => m.role != null);
    const all = active.length > 0 && active.every((m) => m.ready);
    if (all && this.state === 'lobby') {
      this.state = 'countdown';
      this.countdownEnd = Date.now() + COUNTDOWN * 1000;
      clearTimeout(this.cdTimer);
      this.cdTimer = setTimeout(() => this.startMatch(), COUNTDOWN * 1000);
    } else if (!all && this.state === 'countdown') this.cancelCountdown();
  }

  cancelCountdown() {
    if (this.state !== 'countdown') return;
    clearTimeout(this.cdTimer);
    this.state = 'lobby';
    this.countdownEnd = null;
  }

  // -------------------------------------------------------------- match --
  startMatch() {
    if (this.state !== 'countdown') return;
    this.state = 'loading';
    this.countdownEnd = null;
    const players = [];
    const kid = this.slots.killer;
    if (kid) {
      const m = this.members.get(kid);
      players.push({ id: kid, name: m.name, isBot: false, role: 'killer', loadout: m.loadouts.killer });
    } else {
      const b = this.bots.killer;
      players.push({ id: 'bot-k', name: b.name, isBot: true, role: 'killer', loadout: b });
    }
    this.slots.survivors.forEach((sid, i) => {
      if (sid) {
        const m = this.members.get(sid);
        players.push({ id: sid, name: m.name, isBot: false, role: 'survivor', loadout: m.loadouts.survivor });
      } else {
        const b = this.bots.survivors[i];
        players.push({ id: 'bot-s' + i, name: b.name + ' (Bot)', isBot: true, role: 'survivor', loadout: b });
      }
    });
    const realmKeys = Object.keys(REALMS);
    const realm = this.settings.realm === 'random' ? realmKeys[Math.floor(Math.random() * realmKeys.length)] : this.settings.realm;
    this.matchPlayers = new Set(players.filter((p) => !p.isBot).map((p) => p.id));
    this.loaded = new Set();
    try {
      this.match = new Match({
        seed: randomSeed(), realm, difficulty: this.settings.difficulty, players,
        send: (id, msg) => this.mgr.send(id, msg),
        broadcast: (msg) => {
          const s = JSON.stringify(msg);
          for (const id of this.matchPlayers) this.mgr.sendRaw(id, s);
        },
        onEnd: (results) => this.onMatchEnd(results),
      });
    } catch (e) {
      console.error('Failed to create match', e);
      this.state = 'lobby';
      this.system('Failed to start the match.');
      this.broadcastState();
      return;
    }
    for (const m of this.members.values()) { m.ready = false; m.waiting = !this.matchPlayers.has(m.id); }
    for (const id of this.matchPlayers) this.mgr.send(id, { t: 'match', info: this.match.initInfo(id) });
    this.loadTimer = setTimeout(() => this.beginMatch(), LOAD_TIMEOUT * 1000);
    this.broadcastState();
  }

  onLoaded(id) {
    if (this.state !== 'loading') return;
    this.loaded.add(id);
    if ([...this.matchPlayers].every((p) => this.loaded.has(p) || !this.members.has(p))) this.beginMatch();
  }

  beginMatch() {
    if (this.state !== 'loading' || !this.match) return;
    clearTimeout(this.loadTimer);
    this.state = 'match';
    this.match.start();
    for (const id of this.matchPlayers) this.mgr.send(id, { t: 'go' });
    this.interval = setInterval(() => {
      try { this.match && this.match.tick(); } catch (e) { console.error('match tick error', e); }
    }, 1000 / TICK_RATE);
    this.broadcastState();
  }

  onMatchEnd(results) {
    clearInterval(this.interval);
    this.interval = null;
    this.lastResults = results;
    for (const id of this.matchPlayers) this.mgr.send(id, { t: 'results', results });
    this.match = null;
    this.matchPlayers = new Set();
    this.state = 'lobby';
    for (const m of this.members.values()) { m.ready = false; m.waiting = false; }
    this.assignSlots();
    this.broadcastState();
  }

  leaveMatch(id) {
    if (!this.match || !this.matchPlayers.has(id)) return;
    this.match.onDisconnect(id);
    this.matchPlayers.delete(id);
    const m = this.members.get(id);
    if (m) m.waiting = true;
    this.broadcastState();
    if (!this.matchPlayers.size) {
      // nobody is watching: finish quickly
      clearInterval(this.interval);
      this.interval = null;
      this.match = null;
      this.state = 'lobby';
      for (const mm of this.members.values()) { mm.ready = false; mm.waiting = false; }
      this.assignSlots();
      this.broadcastState();
    }
  }

  destroy() {
    clearTimeout(this.cdTimer);
    clearTimeout(this.loadTimer);
    clearInterval(this.interval);
    this.match = null;
    this.mgr.lobbies.delete(this.code);
  }

  // ------------------------------------------------------------- state --
  publicState() {
    const members = [...this.members.values()].map((m) => ({
      id: m.id, name: m.name, ready: m.ready, role: m.role, wantRole: m.wantRole, waiting: m.waiting,
      host: m.id === this.hostId,
      loadout: m.role === 'killer' ? m.loadouts.killer : m.loadouts.survivor,
      loadouts: m.loadouts,
    }));
    return {
      code: this.code, hostId: this.hostId, state: this.state, settings: this.settings,
      countdown: this.countdownEnd ? Math.max(0, (this.countdownEnd - Date.now()) / 1000) : null,
      members, slots: this.slots, bots: this.bots,
      inMatch: this.state === 'match' || this.state === 'loading',
    };
  }

  broadcastState() {
    const st = this.publicState();
    for (const id of this.members.keys()) this.mgr.send(id, { t: 'lobby', lobby: st });
  }
}

export class LobbyManager {
  constructor() {
    this.lobbies = new Map();
    this.clients = new Map();
    this.nextId = 1;
  }

  newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.lobbies.has(c)) return c;
    }
  }

  connect(ws) {
    const id = 'p' + (this.nextId++).toString(36) + Math.random().toString(36).slice(2, 6);
    const client = { id, ws, name: 'Survivor', lobby: null, loadouts: null };
    this.clients.set(id, client);
    this.send(id, { t: 'welcome', id });
    return client;
  }

  disconnect(client) {
    if (client.lobby) client.lobby.remove(client.id);
    client.lobby = null;
    this.clients.delete(client.id);
  }

  send(id, msg) {
    const c = this.clients.get(id);
    if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }
  sendRaw(id, str) {
    const c = this.clients.get(id);
    if (c && c.ws.readyState === 1 && c.ws.bufferedAmount < 2e6) c.ws.send(str);
  }

  listPublic() {
    return [...this.lobbies.values()].filter((l) => l.settings.public).map((l) => ({
      code: l.code, name: l.settings.name, players: l.members.size, state: l.state,
      killer: !!l.slots.killer, difficulty: l.settings.difficulty,
    }));
  }

  handle(client, msg) {
    if (!msg || typeof msg.t !== 'string') return;
    const L = client.lobby;
    switch (msg.t) {
      case 'hello':
        client.name = cleanName(msg.name);
        if (msg.loadouts && typeof msg.loadouts === 'object') client.loadouts = msg.loadouts;
        return;
      case 'name':
        client.name = cleanName(msg.name);
        if (L && L.members.has(client.id)) { L.members.get(client.id).name = client.name; L.broadcastState(); }
        return;
      case 'list':
        this.send(client.id, { t: 'list', lobbies: this.listPublic() });
        return;
      case 'ping':
        this.send(client.id, { t: 'pong', c: msg.c });
        return;
      case 'create': {
        if (L) L.remove(client.id);
        const lobby = new Lobby(this, client, msg.settings || {});
        this.lobbies.set(lobby.code, lobby);
        lobby.add(client, msg.role);
        return;
      }
      case 'join': {
        const code = String(msg.code || '').toUpperCase().trim();
        const lobby = this.lobbies.get(code);
        if (!lobby) { this.send(client.id, { t: 'error', text: `No lobby with code ${code}.` }); return; }
        if (lobby === L) { lobby.broadcastState(); return; }
        if (lobby.members.size >= 5) { this.send(client.id, { t: 'error', text: 'That lobby is full (5 players).' }); return; }
        if (L) L.remove(client.id);
        lobby.add(client, msg.role);
        return;
      }
      case 'leave':
        if (L) L.remove(client.id);
        client.lobby = null;
        this.send(client.id, { t: 'left' });
        return;
    }
    if (!L) return;
    switch (msg.t) {
      case 'role': return L.setRole(client.id, msg.role);
      case 'loadout': return L.setLoadout(client.id, msg.role, msg.loadout);
      case 'ready': return L.setReady(client.id, msg.ready);
      case 'settings': return L.setSettings(client.id, msg.settings);
      case 'kick': return L.kick(client.id, msg.id);
      case 'chat': return L.say(client.id, msg.text);
      case 'loaded': return L.onLoaded(client.id);
      case 'leaveMatch': return L.leaveMatch(client.id);
      case 'in':
      case 'act':
        if (L.match && L.state === 'match' && L.matchPlayers.has(client.id)) L.match.onMessage(client.id, msg);
        return;
    }
  }
}

export { defaultLoadout };
