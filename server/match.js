// Authoritative match simulation. One Match per lobby game. Humans send
// their own positions (validated) and action requests; bots are simulated
// here. Every tick a snapshot is broadcast to all clients.

import { TICK_RATE, SURV, KILL, GEN, HEAL, HOOK, TIMES, SKILL, CAT_CAP, SURV_CATS, KILLER_CATS } from '../shared/constants.js';
import { KILLERS, ITEMS } from '../shared/data.js';
import { generateMap, checkConnectivity } from '../shared/mapgen.js';
import { buildCollision, palletBox, distToBox } from '../shared/collision.js';
import { survivorOptions, killerOptions, vaultPath, vaultType, relTo, isUp, attackCandidate, hittable, angDiff } from '../shared/interact.js';
import { stepMove, survivorSpeed, killerSpeed, playerBlockers, SAW_SPEED, radiusOf } from '../shared/motor.js';
import { NavGrid } from './nav.js';
import { SurvivorBot } from './bots/survivor.js';
import { KillerBot } from './bots/killer.js';

const DT = 1 / TICK_RATE;
const HOLD_SKILL = new Set(['repair', 'heal', 'selfcare', 'medkit']);
const SKILL_ODDS = {
  easy: { great: 0.08, good: 0.62 },
  normal: { great: 0.22, good: 0.68 },
  hard: { great: 0.45, good: 0.52 },
};

function num(v, d = 0) { v = Number(v); return Number.isFinite(v) ? v : d; }
function r2(v) { return Math.round(v * 100) / 100; }
function r3(v) { return Math.round(v * 1000) / 1000; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function has(p, perk) { return p.perks && p.perks.includes(perk); }

export class Match {
  constructor(opts) {
    this.opts = opts;
    this.difficulty = opts.difficulty || 'normal';
    const validate = (m) => checkConnectivity(m, buildCollision(m).world);
    this.map = generateMap(opts.seed >>> 0, opts.realm, validate);
    this.col = buildCollision(this.map);
    this.world = this.col.world;
    this.nav = new NavGrid(this.map, this.world);
    this.time = 0;
    this.started = false;
    this.ended = false;
    this.endAt = null;
    this.skillId = 1;
    this.trapId = 1;
    this.hatchetId = 1;
    this.eventsOut = [];
    const M = this.map;
    this.S = {
      players: [],
      gens: M.gens.map((g) => ({ ...g, charges: 0, progress: 0, done: false, blocked: false, entityBlocked: false, blockedUntil: 0, regressing: false, n: 0 })),
      pallets: M.pallets.map((p) => ({ ...p, state: 'up', t: 0 })),
      windows: M.windows.map((w) => ({ ...w, blocked: false, blockedUntil: 0 })),
      hooks: M.hooks.map((h) => ({ ...h, occupant: null })),
      lockers: M.lockers.map((l) => ({ ...l, occ: null })),
      chests: M.chests.map((c) => ({ ...c, opened: false })),
      totems: M.totems.map((t) => ({ ...t, state: 'dull' })),
      gates: M.gates.map((g) => ({ ...g, progress: 0, open: false })),
      hatch: { x: M.hatch.x, z: M.hatch.z, state: 'closed' },
      traps: [],
      hatchets: [],
      gatesPowered: false,
      egc: null,
      gensDone: 0,
    };
    let si = 0;
    for (const def of opts.players) {
      const spawn = def.role === 'killer' ? M.spawns.killer : M.spawns.survivors[si++ % 4];
      this.S.players.push(this.makePlayer(def, spawn));
    }
    this.killer = this.S.players.find((p) => p.role === 'killer');
    for (const p of this.S.players) if (p.isBot) this.attachBot(p);
    this.setupPerks();
  }

  // ------------------------------------------------------------ players --
  makePlayer(def, spawn) {
    const lo = def.loadout || {};
    const p = {
      id: def.id, name: def.name, isBot: !!def.isBot, role: def.role,
      char: lo.character, perks: (lo.perks || []).slice(0, 4),
      x: spawn.x, z: spawn.z, rot: spawn.rot || 0, pitch: 0,
      seq: 1, input: { mx: 0, mz: 0, sprint: false, crouch: false },
      spd: 0, moving: false, sprint: false, crouch: false, budget: 3,
      lastX: spawn.x, lastZ: spawn.z,
      lock: null, lk: null, hold: null, sm: 1, health: 'healthy',
      score: {}, result: null, connected: true,
      chase: false, chaseT: 0, lostT: 0,
    };
    const cats = def.role === 'killer' ? KILLER_CATS : SURV_CATS;
    for (const c of cats) p.score[c] = 0;
    if (def.role === 'survivor') {
      Object.assign(p, {
        healP: 0, bleed: HEAL.BLEEDOUT, hookCount: 0, hookTime: 0, hookStage: 0, hookId: null, unhookTries: 0,
        wiggle: 0, lastWig: 0, lastWigT: 0, carriedBy: null, locker: null, trap: null, trapTries: 0,
        item: lo.item && ITEMS[lo.item] ? { type: lo.item, charges: ITEMS[lo.item].charges } : null,
        exh: 0, fx: { haste: [], endurance: 0, hitBoost: 0, dh: 0, ds: 0, wmi: 0 },
        usedUnbreakable: false, dsUsed: false, skill: null, flashOn: false, flashT: 0, mangled: false, wasRunning: false,
      });
    } else {
      const k = KILLERS[p.char] ? p.char : 'trapper';
      p.char = k;
      Object.assign(p, {
        carrying: null, atk: null, atkT: 0, atkHit: false, lungeDur: KILL.LUNGE_MAX,
        pw: null, pwT: 0, pwC: 0, ammo: k === 'trapper' ? 2 : k === 'huntress' ? 5 : 0,
        blindT: 0, blindImm: 0, popT: 0, tr: KILLERS[k].terror, sawEnd: -10, fx: {},
      });
    }
    return p;
  }

  attachBot(p) {
    p.isBot = true;
    // bot killers get a small speed handicap on lower difficulties to make up for weaker bot survivors
    if (p.role === 'killer') p.botSm = { easy: 0.85, normal: 0.91, hard: 0.94 }[this.difficulty] || 0.91;
    p.brain = p.role === 'killer' ? new KillerBot(this, p, this.difficulty) : new SurvivorBot(this, p, this.difficulty);
  }

  setupPerks() {
    const k = this.killer;
    if (!k) return;
    if (has(k, 'ruin') && this.S.totems.length) {
      const t = this.S.totems[Math.floor(Math.random() * this.S.totems.length)];
      t.state = 'hex';
      t.hex = 'ruin';
    }
    if (has(k, 'corrupt')) {
      const sorted = this.S.gens.slice().sort((a, b) => dist(b, k) - dist(a, k));
      for (const g of sorted.slice(0, 3)) g.blockedUntil = 120;
      this.corruptActive = true;
    }
    if (k.char === 'trapper') {
      const spots = this.map.trapSpots.slice().sort(() => Math.random() - 0.5).slice(0, 6);
      for (const s of spots) this.S.traps.push({ id: this.trapId++, x: s.x, z: s.z, state: 'ground', victim: null, rot: Math.random() * 6 });
    }
  }

  byId(id) { return this.S.players.find((p) => p.id === id); }
  survivors() { return this.S.players.filter((p) => p.role === 'survivor'); }
  inPlay(p) { return p.role === 'survivor' && p.health !== 'dead' && p.health !== 'escaped'; }

  start() {
    this.started = true;
    this.time = 0;
    this.event({ k: 'msg', text: 'The trial has begun', sub: this.map.name });
  }

  // -------------------------------------------------------- networking --
  send(id, msg) { const p = this.byId(id); if (p && !p.isBot) this.opts.send(id, msg); }
  event(ev, to) {
    if (to) {
      const p = this.byId(to);
      if (p && !p.isBot) this.opts.send(to, { t: 'ev', e: [ev] });
      return;
    }
    this.eventsOut.push(ev);
  }
  toKiller(ev) { if (this.killer) this.event(ev, this.killer.id); }
  noise(x, z, reason) {
    this.toKiller({ k: 'noise', x: r2(x), z: r2(z), why: reason });
    if (this.killer && this.killer.brain) this.killer.brain.onNoise(x, z, reason);
  }
  addScore(p, cat, pts, label) {
    if (!p || p.score[cat] === undefined) return;
    p.score[cat] += pts;
    if (label && !p.isBot) this.event({ k: 'score', label, pts: Math.round(pts), cat }, p.id);
  }

  onDisconnect(id) {
    const p = this.byId(id);
    if (!p || p.isBot) return;
    p.connected = false;
    p.name = p.name + ' (Bot)';
    this.attachBot(p);
    if (p.hold) this.stopHold(p);
    this.event({ k: 'msg', text: `${p.name.replace(' (Bot)', '')} disconnected — a bot took over` });
  }

  // ------------------------------------------------------------- input --
  onMessage(id, m) {
    const p = this.byId(id);
    if (!p || p.isBot || this.ended) return;
    if (m.t === 'in') return this.handleInput(p, m);
    if (m.t === 'act') return this.handleAct(p, m);
  }

  canMove(p) {
    if (p.lock) return false;
    if (p.role === 'killer') return true;
    if (p.locker != null || p.trap != null || p.carriedBy != null) return false;
    return isUp(p) || p.health === 'dying';
  }

  handleInput(p, m) {
    if (m.seq !== p.seq) return;
    p.rot = num(m.r, p.rot);
    if (p.role === 'killer' || p.flashOn) p.pitch = Math.max(-1.4, Math.min(1.4, num(m.pt, 0)));
    p.sprint = !!m.sp;
    p.crouch = !!m.cr;
    if (!this.canMove(p)) return;
    const nx = num(m.x, p.x), nz = num(m.z, p.z);
    const d = Math.hypot(nx - p.x, nz - p.z);
    if (d < 1e-4) return;
    if (d > p.budget + 0.05) { p.seq++; return; }
    if (this.world.penetration(nx, nz, radiusOf(p) * 0.75) > 0.1) { p.seq++; return; }
    p.budget -= d;
    p.x = nx;
    p.z = nz;
    if (p.hold && p.hold.kind !== 'escapetrap' && Math.hypot(p.x - p.hold.x, p.z - p.hold.z) > 0.3) this.stopHold(p);
  }

  handleAct(p, m) {
    const a = m.a;
    if (a === 'space') return this.doSpace(p, m.kind, m.id, m);
    if (a === 'm1') {
      if (p.role === 'killer') return this.startAttack(p);
      return this.startHold(p, m.kind, m.id);
    }
    if (a === 'm1up' || a === 'm2up' || a === 'eup') {
      if (p.role === 'survivor') {
        if (a === 'm2up' && p.flashOn) { p.flashOn = false; return; }
        if (p.hold) {
          const k = p.hold.kind;
          const isM2 = k === 'medkit', isE = k === 'selfcare';
          if ((a === 'm2up' && isM2) || (a === 'eup' && isE) || (a === 'm1up' && !isM2 && !isE)) this.stopHold(p);
        }
      } else if (a === 'm2up') this.powerRelease(p, m);
      return;
    }
    if (a === 'm2') {
      if (p.role === 'killer') return this.powerPress(p, m);
      if (m.kind === 'flashlight') { if (p.item && p.item.type === 'flashlight' && p.item.charges > 0 && isUp(p) && !p.lock && !p.hold) p.flashOn = true; return; }
      return this.startHold(p, m.kind, null);
    }
    if (a === 'e') {
      if (p.role === 'killer') { if (m.kind === 'dropsurv') this.dropSurvivor(p, false); return; }
      if (m.kind === 'deadhard') return this.deadHard(p);
      return this.startHold(p, 'selfcare', null);
    }
    if (a === 'hit' && p.role === 'killer') return this.humanHit(p, m);
    if (a === 'miss' && p.role === 'killer') {
      if (p.atk === 'lunge') { p.atk = 'cd'; p.atkT = 0; p.atkHit = false; }
      return;
    }
    if (a === 'saw' && p.role === 'killer') return this.sawMsg(p, m);
    if (a === 'wig') return this.wiggle(p, m.d);
    if (a === 'sc') return this.resolveSkill(p, m.id, m.r);
  }

  // ------------------------------------------------------------ actions --
  doSpace(p, kind, id, m = {}) {
    if (this.ended) return false;
    if (p.role === 'survivor') {
      const opts = survivorOptions(p, this.S, null, 1.35);
      if (!opts.all.some((o) => o.kind === kind && (o.id === undefined || o.id === id))) return false;
      if (p.hold) this.stopHold(p);
      p.flashOn = false;
      switch (kind) {
        case 'vault': return this.survivorVault(p, this.S.windows[id], m.vt);
        case 'vaultp': return this.survivorVault(p, this.S.pallets[id], m.vt);
        case 'drop': return this.dropPallet(p, this.S.pallets[id]);
        case 'locker': return this.enterLocker(p, this.S.lockers[id]);
        case 'exitlocker': return this.exitLocker(p);
        case 'hatch': return this.lock(p, 'hatch', TIMES.HATCH_JUMP, { from: { x: p.x, z: p.z }, to: { x: this.S.hatch.x, z: this.S.hatch.z } });
      }
      return false;
    }
    // killer
    const opts = killerOptions(p, this.S, null, 1.35);
    if (!opts.all.some((o) => o.kind === kind && (o.id === undefined || o.id === id))) return false;
    if (p.pw === 'rev' || p.pw === 'wind') { p.pw = null; }
    const brutal = has(p, 'brutal_strength') ? 0.8 : 1;
    switch (kind) {
      case 'pickup': {
        const v = this.byId(id);
        if (!v) return false;
        p.rot = Math.atan2(v.x - p.x, v.z - p.z);
        if (v.hold) this.stopHold(v);
        this.lock(p, 'pickup', HOOK.PICKUP_TIME, { data: { vid: v.id } });
        this.lock(v, 'pickedup', HOOK.PICKUP_TIME);
        return true;
      }
      case 'hook': {
        const h = this.S.hooks[id];
        const v = this.byId(p.carrying);
        if (!v || !h || h.occupant != null) return false;
        h.occupant = v.id;
        p.rot = Math.atan2(h.x - p.x, h.z - p.z);
        this.lock(p, 'hook', HOOK.HOOK_TIME, { data: { hook: h.id, vid: v.id } });
        this.lock(v, 'hooking', HOOK.HOOK_TIME);
        return true;
      }
      case 'break': return this.lock(p, 'break', TIMES.PALLET_BREAK * brutal, { data: { pallet: id } });
      case 'kvault': {
        const w = this.S.windows[id];
        const path = vaultPath(p, w, true);
        const dur = TIMES.KILLER_VAULT * (has(p, 'bamboozle') ? 0.85 : 1);
        this.event({ k: 'vault', id: p.id, w: id, fast: false });
        return this.lock(p, 'kvault', dur, { from: path.from, to: path.to, data: { window: id }, predicted: true });
      }
      case 'kick': return this.lock(p, 'kick', GEN.KICK_TIME * brutal, { data: { gen: id } });
      case 'search': return this.lock(p, 'search', TIMES.LOCKER_SEARCH, { data: { locker: id } });
      case 'reload': return this.lock(p, 'reload', TIMES.RELOAD, { data: { locker: id } });
      case 'closehatch': return this.lock(p, 'closehatch', TIMES.HATCH_CLOSE);
      case 'taketrap': {
        const t = this.S.traps.find((q) => q.id === id);
        if (!t || t.state !== 'ground' || p.ammo >= 2) return false;
        return this.lock(p, 'taketrap', 0.6, { data: { trap: id } });
      }
    }
    return false;
  }

  lock(p, kind, dur, o = {}) {
    p.lock = { kind, t: 0, dur, from: o.from, to: o.to, data: o.data || {}, predicted: !!o.predicted };
    p.lk = kind;
    if (p.hold) this.stopHold(p);
    if (p.role === 'killer' && p.atk === 'lunge') { p.atk = null; }
    return true;
  }

  cancelLock(p) {
    p.lock = null;
    p.lk = null;
  }

  survivorVault(p, o, vt) {
    if (!o) return false;
    let type = vaultType(p, o, p.spd, p.sprint, p.rot);
    if (!p.isBot && (vt === 'fast' || vt === 'med' || vt === 'slow')) {
      if (vt === 'fast' && !p.sprint) type = 'med';
      else type = vt;
    }
    let dur = type === 'fast' ? TIMES.VAULT_FAST : type === 'med' ? TIMES.VAULT_MED : TIMES.VAULT_SLOW;
    if (has(p, 'resilience') && p.health === 'injured') dur *= 0.91;
    const path = vaultPath(p, o, false);
    this.lock(p, 'vault', dur, { from: path.from, to: path.to, data: { type }, predicted: true });
    if (o.w) {
      // the Entity blocks a window after it is vaulted 3 times in quick succession
      if (!p.vaults) p.vaults = [];
      p.vaults = p.vaults.filter((v) => this.time - v.t < 45);
      p.vaults.push({ id: o.id, t: this.time });
      if (p.vaults.filter((v) => v.id === o.id).length >= 3 && p.chase) {
        o.blocked = true;
        o.blockedUntil = this.time + 15;
        p.vaults = p.vaults.filter((v) => v.id !== o.id);
        this.event({ k: 'entityBlock', w: o.id });
      }
    }
    this.event({ k: 'vault', id: p.id, fast: type === 'fast' });
    if (type === 'fast') {
      if (!has(p, 'quick_quiet') || (p.qqT || 0) > this.time) this.noise(o.x, o.z, 'vault');
      else p.qqT = this.time + 30;
      if (has(p, 'lithe') && p.exh <= 0) {
        p.fx.haste.push({ mul: 1.5, t: 3 });
        p.exh = TIMES.EXHAUSTION;
      }
      if (p.chase) this.addScore(p, 'boldness', 100, 'Fast vault');
    }
    return true;
  }

  dropPallet(p, pl) {
    if (!pl || pl.state !== 'up') return false;
    pl.state = 'falling';
    pl.t = 0;
    pl.by = p.id;
    pl.side = relTo(p, pl).perp >= 0 ? 1 : -1;
    this.lock(p, 'drop', TIMES.PALLET_DROP, { predicted: true });
    p.rot = Math.atan2(-pl.nx * pl.side, -pl.nz * pl.side);
    this.event({ k: 'palletDrop', id: pl.id });
    this.addScore(p, 'boldness', 100);
    return true;
  }

  enterLocker(p, l) {
    if (!l || l.occ != null) return false;
    const rush = p.sprint && p.spd > 2.8;
    l.occ = p.id;
    this.lock(p, 'locker_in', rush ? TIMES.LOCKER_RUSH : TIMES.LOCKER_ENTER, { from: { x: p.x, z: p.z }, to: { x: l.x, z: l.z }, data: { locker: l.id } });
    p.rot = l.rot;
    this.event({ k: 'locker', id: l.id, rush });
    if (rush && (!has(p, 'quick_quiet') || (p.qqT || 0) > this.time)) this.noise(l.x, l.z, 'locker');
    else if (rush) p.qqT = this.time + 30;
    return true;
  }

  exitLocker(p) {
    const l = this.S.lockers[p.locker];
    if (!l) return false;
    const fx = l.x + Math.sin(l.rot) * 0.95, fz = l.z + Math.cos(l.rot) * 0.95;
    this.lock(p, 'locker_out', TIMES.LOCKER_EXIT, { from: { x: l.x, z: l.z }, to: { x: fx, z: fz }, data: { locker: l.id } });
    this.event({ k: 'locker', id: l.id, rush: false });
    return true;
  }

  startHold(p, kind, id) {
    if (p.role !== 'survivor' || this.ended) return false;
    const opts = survivorOptions(p, this.S, null, 1.35);
    const ok = opts.all.some((o) => o.kind === kind && (o.id === undefined || o.id === id || id == null));
    if (!ok) return false;
    if (kind === 'unhook') return this.startUnhook(p, this.S.hooks[id]);
    if (p.hold && p.hold.kind === kind && p.hold.id === id) return true;
    if (p.hold) this.stopHold(p);
    p.flashOn = false;
    p.hold = { kind, id, t: 0, x: p.x, z: p.z, p: 0 };
    if (kind === 'repair' || kind === 'heal' || kind === 'gate' || kind === 'cleanse' || kind === 'chest' || kind === 'freetrap' || kind === 'disarm') {
      const tgt = this.holdTarget(p.hold);
      if (tgt) p.rot = Math.atan2(tgt.x - p.x, tgt.z - p.z);
    }
    return true;
  }

  holdTarget(h) {
    switch (h.kind) {
      case 'repair': return this.S.gens[h.id];
      case 'heal': case 'freetrap': return this.byId(h.id);
      case 'gate': { const g = this.S.gates[h.id]; return g && { x: g.sx, z: g.sz }; }
      case 'cleanse': return this.S.totems[h.id];
      case 'chest': return this.S.chests[h.id];
      case 'disarm': return this.S.traps.find((t) => t.id === h.id);
    }
    return null;
  }

  stopHold(p) {
    p.hold = null;
    if (p.skill && p.skill.kind !== 'struggle' && p.skill.kind !== 'ds') {
      if (!p.isBot) this.event({ k: 'scCancel', id: p.skill.id }, p.id);
      p.skill = null;
    }
  }

  startUnhook(p, h) {
    if (!h || h.occupant == null) return false;
    const v = this.byId(h.occupant);
    if (!v || v.health !== 'hooked' || v.lock) return false;
    p.rot = Math.atan2(h.x - p.x, h.z - p.z);
    this.lock(p, 'unhooking', HOOK.UNHOOK_TIME, { data: { vid: v.id, hook: h.id } });
    this.lock(v, 'beingunhooked', HOOK.UNHOOK_TIME);
    return true;
  }

  deadHard(p) {
    if (!has(p, 'dead_hard') || p.health !== 'injured' || p.exh > 0 || p.lock || !p.sprint) return;
    p.fx.dh = 0.5;
    p.fx.haste.push({ mul: 1.6, t: 0.4 });
    p.exh = TIMES.EXHAUSTION;
    this.event({ k: 'deadhard', id: p.id });
  }

  wiggle(p, d) {
    if (p.health !== 'carried') return;
    if (d !== -1 && d !== 1) return;
    if (d === p.lastWig) return;
    const dtW = this.time - p.lastWigT;
    p.lastWig = d;
    p.lastWigT = this.time;
    if (dtW < 0.06) return;
    const k = this.byId(p.carriedBy);
    const total = HOOK.WIGGLE_TIME * (k && has(k, 'iron_grasp') ? 1.75 : 1);
    p.wiggle += Math.min(dtW, 0.4) / total;
    p.wigDir = d;
  }

  // --------------------------------------------------------- killer combat --
  powerAllowsAttack(p) {
    return !p.pw || p.pw === 'unc_boost';
  }

  startAttack(p, lungeDur) {
    if (p.role !== 'killer' || p.lock || p.carrying != null || !this.powerAllowsAttack(p)) return false;
    if (p.atk === 'cd' && !p.isBot) {
      // tolerate the client's cooldown finishing a little before ours (latency)
      const cd = p.atkHit ? KILL.HIT_COOLDOWN : KILL.MISS_COOLDOWN * (has(p, 'unrelenting') ? 0.7 : 1);
      if (cd - p.atkT > 0.35) return false;
    } else if (p.atk) return false;
    p.atk = 'lunge';
    p.atkT = 0;
    p.lungeDur = lungeDur || KILL.LUNGE_MAX;
    this.event({ k: 'swing', id: p.id });
    return true;
  }

  humanHit(p, m) {
    const v = this.byId(m.id);
    if (!v || v.role !== 'survivor' || !hittable(v)) return;
    if (m.w === 'saw') {
      if (p.char !== 'hillbilly' || (p.pw !== 'saw' && this.time - p.sawEnd > 0.4)) return;
      if (dist(p, v) > 3.4) return;
      this.sawHit(p, v);
      return;
    }
    const lunging = p.atk === 'lunge' || (p.atk === 'cd' && !p.atkHit && p.atkT < 0.35);
    if (!lunging) return;
    if (dist(p, v) > KILL.ATTACK_RANGE + 1.6) return;
    if (!this.world.clearLine(p.x, p.z, v.x, v.z, 1.0, 0)) return;
    this.applyHit(p, v, 'basic');
    p.atk = 'cd';
    p.atkT = 0;
    p.atkHit = true;
  }

  applyHit(k, v, w) {
    if (v.fx.dh > 0) {
      this.event({ k: 'dodge', id: v.id });
      return false;
    }
    const exposed = this.noedActive() || w === 'saw';
    if (v.hold) this.stopHold(v);
    v.flashOn = false;
    if (v.lock && (v.lk === 'drop' || v.lk === 'unhooking')) {
      if (v.lk === 'unhooking') {
        const vic = this.byId(v.lock.data.vid);
        if (vic && vic.lk === 'beingunhooked') this.cancelLock(vic);
      }
      this.cancelLock(v);
    }
    let downed = false;
    if (v.health === 'healthy' && !exposed) {
      v.health = 'injured';
      v.healP = 0;
    } else if (v.fx.endurance > 0 && !exposed) {
      v.fx.endurance = 0;
      v.health = 'injured';
      this.event({ k: 'endurance', id: v.id });
    } else {
      this.down(v, k);
      downed = true;
    }
    if (!downed) v.fx.hitBoost = SURV.HIT_BOOST_TIME;
    if (has(k, 'sloppy_butcher')) v.mangled = true;
    this.addScore(k, 'brutality', 300, 'Hit');
    this.event({ k: 'hit', id: v.id, by: k.id, w, x: r2(v.x), z: r2(v.z), down: downed });
    if (v.brain) v.brain.onHit();
    return true;
  }

  down(v, k) {
    if (v.lock && v.lock.to) {
      // finish the movement so the survivor doesn't end up inside geometry
      const t = Math.min(1, v.lock.t / v.lock.dur);
      if (t > 0.5) { v.x = v.lock.to.x; v.z = v.lock.to.z; } else { v.x = v.lock.from.x; v.z = v.lock.from.z; }
      v.seq++;
    }
    this.cancelLock(v);
    v.health = 'dying';
    v.healP = 0;
    v.fx.hitBoost = 0;
    if (k) this.addScore(k, 'brutality', 400, 'Down');
    if (this.corruptActive) {
      this.corruptActive = false;
      for (const g of this.S.gens) g.blockedUntil = 0;
    }
    this.event({ k: 'down', id: v.id });
  }

  sawHit(k, v) {
    this.applyHit(k, v, 'saw');
    k.pw = null;
    k.sawEnd = this.time;
    this.lock(k, 'sawhit', 1.5);
    this.addScore(k, 'deviousness', 300, 'Chainsaw hit');
  }

  noedActive() {
    return this.S.totems.some((t) => t.state === 'noed');
  }

  // ----------------------------------------------------------- powers ----
  powerPress(p, m) {
    if (p.lock || this.ended) return;
    const c = p.char;
    if (c === 'wraith') {
      if (p.carrying != null || p.atk) return;
      if (!p.pw) { p.pw = 'cloaking'; p.pwT = 0; this.event({ k: 'bell', id: p.id, x: r2(p.x), z: r2(p.z) }); }
      else if (p.pw === 'cloaked') { p.pw = 'uncloaking'; p.pwT = 0; this.event({ k: 'bell', id: p.id, x: r2(p.x), z: r2(p.z) }); }
    } else if (c === 'huntress') {
      if (p.carrying != null || p.atk || p.pw || p.ammo <= 0) return;
      p.pw = 'wind';
      p.pwT = 0;
    } else if (c === 'trapper') {
      if (p.carrying != null || p.atk || p.pw || p.ammo <= 0) return;
      this.lock(p, 'settrap', TIMES.SET_TRAP);
    } else if (c === 'hillbilly' && p.isBot) {
      if (p.carrying != null || p.atk || p.pw) return;
      p.pw = 'rev';
      p.pwT = 0;
      p.pwC = 0;
      this.event({ k: 'saw', s: 'rev', id: p.id });
    }
  }

  powerRelease(p, m = {}) {
    const c = p.char;
    if (c === 'huntress' && p.pw === 'wind') {
      const t = p.pwT;
      p.pw = null;
      if (t < 0.25) return;
      const power = Math.min(1, (t - 0.25) / 1.0);
      const yaw = m.yaw !== undefined ? num(m.yaw, p.rot) : p.rot;
      const pitch = m.pitch !== undefined ? num(m.pitch, 0) : p.pitch;
      this.throwHatchet(p, yaw, pitch, m.power !== undefined ? Math.max(0, Math.min(1, num(m.power))) : power);
    } else if (c === 'trapper' && p.lk === 'settrap') {
      this.cancelLock(p);
    } else if (c === 'hillbilly' && p.isBot) {
      if (p.pw === 'rev') { p.pw = null; this.event({ k: 'saw', s: 'stop', id: p.id }); }
      else if (p.pw === 'saw') { p.pw = null; p.sawEnd = this.time; this.event({ k: 'saw', s: 'stop', id: p.id }); }
    }
  }

  // Human Hillbilly drives the chainsaw client-side and reports state changes.
  sawMsg(p, m) {
    if (p.char !== 'hillbilly') return;
    const s = m.s;
    if (s === 'rev') {
      if (p.lock || p.carrying != null || p.atk || p.pw) return;
      p.pw = 'rev'; p.pwT = 0; p.pwC = 0;
      this.event({ k: 'saw', s: 'rev', id: p.id });
    } else if (s === 'cancel') {
      if (p.pw === 'rev') { p.pw = null; this.event({ k: 'saw', s: 'stop', id: p.id }); }
    } else if (s === 'go') {
      if (p.pw === 'rev' && p.pwT > 1.6) { p.pw = 'saw'; p.pwT = 0; this.event({ k: 'saw', s: 'go', id: p.id }); }
    } else if (s === 'end') {
      if (p.pw === 'saw') { p.pw = null; p.sawEnd = this.time; this.event({ k: 'saw', s: 'stop', id: p.id }); }
    } else if (s === 'bump') {
      if (p.pw === 'saw' || this.time - p.sawEnd < 0.3) {
        p.pw = null;
        p.sawEnd = this.time;
        this.lock(p, 'stun', TIMES.STUN_BUMP);
        this.event({ k: 'saw', s: 'bump', id: p.id, x: r2(p.x), z: r2(p.z) });
      }
    }
  }

  throwHatchet(p, yaw, pitch, power) {
    if (p.ammo <= 0) return;
    p.ammo--;
    const speed = 20 + 20 * power;
    const cp = Math.cos(pitch);
    const h = {
      id: this.hatchetId++, owner: p.id,
      x: p.x + Math.sin(yaw) * 0.5, y: KILL.EYE - 0.25, z: p.z + Math.cos(yaw) * 0.5,
      vx: Math.sin(yaw) * cp * speed, vy: Math.sin(pitch) * speed + 1.0, vz: Math.cos(yaw) * cp * speed, t: 0,
    };
    this.S.hatchets.push(h);
    this.event({ k: 'throw', id: p.id, x: r2(h.x), z: r2(h.z) });
  }

  updateHatchets(dt) {
    const H = this.S.hatchets;
    for (let i = H.length - 1; i >= 0; i--) {
      const h = H[i];
      h.t += dt;
      let dead = h.t > 3;
      const steps = 4;
      for (let s = 0; s < steps && !dead; s++) {
        const sdt = dt / steps;
        const nx = h.x + h.vx * sdt, ny = h.y + h.vy * sdt - 4.9 * sdt * sdt, nz = h.z + h.vz * sdt;
        h.vy -= 9.8 * sdt;
        // survivors
        for (const v of this.S.players) {
          if (v.role !== 'survivor' || !hittable(v)) continue;
          const top = v.crouch ? 1.15 : 1.8;
          if (ny < 0 || ny > top) continue;
          const d = Math.hypot(v.x - nx, v.z - nz);
          if (d < 0.5) {
            const k = this.byId(h.owner);
            if (k) {
              this.applyHit(k, v, 'hatchet');
              this.addScore(k, 'deviousness', 300, 'Hatchet hit');
            }
            dead = true;
            break;
          }
        }
        if (dead) break;
        if (ny <= 0.05) { dead = true; this.event({ k: 'hatchetLand', x: r2(nx), z: r2(nz) }); break; }
        const f = this.world.raycast(h.x, h.z, nx, nz, ny, 0.05);
        if (f < 1) { dead = true; this.event({ k: 'hatchetLand', x: r2(h.x + (nx - h.x) * f), z: r2(h.z + (nz - h.z) * f) }); break; }
        h.x = nx; h.y = ny; h.z = nz;
      }
      if (dead) H.splice(i, 1);
    }
  }

  // ------------------------------------------------------------ carrying --
  dropSurvivor(k, free) {
    const v = this.byId(k.carrying);
    k.carrying = null;
    if (!v) return;
    v.carriedBy = null;
    const side = Math.random() < 0.5 ? 1 : -1;
    const ox = Math.cos(k.rot) * 0.9 * side, oz = -Math.sin(k.rot) * 0.9 * side;
    const pos = this.world.move(k.x, k.z, SURV.RADIUS, ox, oz);
    v.x = pos.x; v.z = pos.z;
    v.seq++;
    v.wiggle = 0;
    if (free) {
      v.health = 'injured';
      v.healP = 0;
      v.fx.hitBoost = 1.0;
    } else {
      v.health = 'dying';
      this.event({ k: 'drop', id: v.id });
    }
    if (v.lk) this.cancelLock(v);
  }

  stunKiller(k, dur, reason) {
    if (k.lock && k.lock.kind === 'hook') {
      const h = this.S.hooks[k.lock.data.hook];
      if (h && h.occupant === k.lock.data.vid) h.occupant = null;
    }
    if (k.carrying != null) {
      const vid = k.carrying;
      this.dropSurvivor(k, true);
      this.event({ k: 'freed', id: vid, how: reason });
    }
    k.pw = k.char === 'wraith' && (k.pw === 'cloaked' || k.pw === 'cloaking') ? null : (k.pw === 'saw' || k.pw === 'rev' || k.pw === 'wind' ? null : k.pw);
    k.atk = null;
    this.lock(k, 'stun', dur);
    this.event({ k: 'stun', id: k.id, how: reason, x: r2(k.x), z: r2(k.z) });
  }

  // ----------------------------------------------------------- lock end --
  finishLock(p) {
    const L = p.lock;
    p.lock = null;
    p.lk = null;
    if (L.to) {
      p.x = L.to.x;
      p.z = L.to.z;
      if (!L.predicted) p.seq++;
    }
    const d = L.data || {};
    switch (L.kind) {
      case 'locker_in': p.locker = d.locker; break;
      case 'locker_out': {
        const l = this.S.lockers[d.locker];
        if (l && l.occ === p.id) l.occ = null;
        p.locker = null;
        break;
      }
      case 'hatch': this.escape(p, 'hatch'); break;
      case 'unhooking': {
        const v = this.byId(d.vid);
        if (v && v.health === 'hooked') this.unhook(v, p);
        break;
      }
      case 'sacrifice': this.kill(p, 'sacrificed'); break;
      // killer
      case 'pickup': {
        const v = this.byId(d.vid);
        if (v && v.lk === 'pickedup') this.cancelLock(v);
        if (v && (v.health === 'dying' || v.trap != null) && v.carriedBy == null) this.carry(p, v);
        break;
      }
      case 'hook': {
        const v = this.byId(d.vid);
        const h = this.S.hooks[d.hook];
        if (v && v.carriedBy === p.id) this.hookSurvivor(v, h, p);
        else if (h && h.occupant === d.vid) h.occupant = null;
        break;
      }
      case 'break': {
        const pl = this.S.pallets[d.pallet];
        if (pl && pl.state === 'down') {
          pl.state = 'broken';
          this.col.setPalletDown(pl, false);
          this.nav.setPallet(pl, 'broken');
          this.event({ k: 'palletBreak', id: pl.id });
          this.addScore(p, 'brutality', 100, 'Break');
        }
        break;
      }
      case 'kvault': {
        const w = this.S.windows[d.window];
        if (w && has(p, 'bamboozle')) { w.blocked = true; w.blockedUntil = this.time + 16; }
        break;
      }
      case 'kick': {
        const g = this.S.gens[d.gen];
        if (g && !g.done) {
          const loss = p.popT > 0 ? 0.25 * GEN.CHARGES : GEN.KICK_LOSS * GEN.CHARGES;
          g.charges = Math.max(0, g.charges - loss);
          if (g.charges > 0) g.regressing = true;
          if (p.popT > 0) this.event({ k: 'msg', text: 'Pop Goes the Weasel', to: 'killer' }, p.id);
          p.popT = 0;
          this.event({ k: 'genKick', id: g.id });
          this.addScore(p, 'brutality', 100, 'Damage generator');
        }
        break;
      }
      case 'search':
      case 'reload': {
        const l = this.S.lockers[d.locker];
        const v = l && l.occ != null ? this.byId(l.occ) : null;
        if (v && (v.locker === l.id || v.lk === 'locker_in')) {
          this.cancelLock(v);
          l.occ = null;
          v.locker = null;
          v.x = l.x; v.z = l.z;
          this.carry(p, v);
          this.event({ k: 'grab', id: v.id, by: p.id });
          this.addScore(p, 'hunter', 500, 'Locker grab');
        } else if (L.kind === 'reload') {
          p.ammo = 5;
        }
        break;
      }
      case 'closehatch': {
        if (this.S.hatch.state === 'open') {
          this.S.hatch.state = 'shut';
          this.event({ k: 'hatchShut' });
          if (!this.S.gatesPowered) this.powerGates();
          this.startEGC();
          this.addScore(p, 'deviousness', 500, 'Hatch closed');
        }
        break;
      }
      case 'settrap': {
        if (p.ammo > 0) {
          p.ammo--;
          const tx = p.x + Math.sin(p.rot) * 0.9, tz = p.z + Math.cos(p.rot) * 0.9;
          const ok = this.world.free(tx, tz, 0.2);
          this.S.traps.push({ id: this.trapId++, x: ok ? tx : p.x, z: ok ? tz : p.z, state: 'armed', victim: null, rot: p.rot });
          this.event({ k: 'trapSet', x: r2(tx), z: r2(tz) });
          this.addScore(p, 'deviousness', 100, 'Trap set');
        }
        break;
      }
      case 'taketrap': {
        const t = this.S.traps.find((q) => q.id === d.trap);
        if (t && t.state === 'ground' && p.ammo < 2) {
          this.S.traps.splice(this.S.traps.indexOf(t), 1);
          p.ammo++;
        }
        break;
      }
    }
  }

  carry(k, v) {
    if (v.trap != null) {
      const t = this.S.traps.find((q) => q.id === v.trap);
      if (t) { t.state = 'ground'; t.victim = null; }
      v.trap = null;
    }
    if (v.hold) this.stopHold(v);
    v.health = 'carried';
    v.carriedBy = k.id;
    v.wiggle = 0;
    v.lastWig = 0;
    k.carrying = v.id;
    k.atk = null;
    k.pw = null;
    this.event({ k: 'pickup', id: v.id, by: k.id });
    if (has(v, 'decisive_strike') && v.fx.ds > 0 && !v.dsUsed) {
      v.dsPending = this.time + 0.8;
    }
  }

  hookSurvivor(v, h, k) {
    k.carrying = null;
    v.carriedBy = null;
    h.occupant = v.id;
    v.hookId = h.id;
    v.health = 'hooked';
    v.x = h.x + Math.sin(h.rot) * 0.35;
    v.z = h.z + Math.cos(h.rot) * 0.35;
    v.rot = h.rot + Math.PI;
    v.seq++;
    v.hookCount++;
    v.unhookTries = 0;
    this.addScore(k, 'sacrifice', 500, 'Hook');
    this.event({ k: 'hooked', id: v.id, hook: h.id, count: v.hookCount });
    if (v.hookCount >= 3) {
      this.lock(v, 'sacrifice', 2.5);
    } else {
      v.hookStage = v.hookCount;
      v.hookTime = HOOK.STAGE_TIME;
    }
    if (has(k, 'pop')) k.popT = 45;
    if (has(k, 'bbq')) {
      const ids = this.survivors().filter((s) => this.inPlay(s) && s !== v && dist(s, h) > 40 && s.health !== 'hooked').map((s) => s.id);
      if (ids.length) this.revealToKiller(ids, 4);
    }
  }

  revealToKiller(ids, dur) {
    this.toKiller({ k: 'aura', ids, dur, c: 'red' });
    if (this.killer && this.killer.brain) this.killer.brain.onReveal(ids);
  }

  unhook(v, rescuer) {
    const h = this.S.hooks[v.hookId];
    if (h) {
      h.occupant = null;
      const fx = h.x + Math.sin(h.rot) * 1.1, fz = h.z + Math.cos(h.rot) * 1.1;
      const pos = this.world.move(h.x + Math.sin(h.rot) * 0.5, h.z + Math.cos(h.rot) * 0.5, SURV.RADIUS, fx - h.x - Math.sin(h.rot) * 0.5, fz - h.z - Math.cos(h.rot) * 0.5);
      v.x = pos.x; v.z = pos.z;
    }
    v.hookId = null;
    v.health = 'injured';
    v.healP = 0;
    v.seq++;
    v.fx.endurance = Math.max(v.fx.endurance, rescuer && has(rescuer, 'borrowed_time') ? 15 : 5);
    v.fx.haste.push({ mul: 1.07, t: 10 });
    if (has(v, 'decisive_strike') && !v.dsUsed) v.fx.ds = 60;
    this.lock(v, 'unhooked', 0.5);
    if (rescuer) {
      if (has(rescuer, 'we_make_it')) rescuer.fx.wmi = 90;
      this.addScore(rescuer, 'altruism', 1500, 'Unhook');
    } else {
      this.addScore(v, 'survival', 1500, 'Escaped hook');
    }
    this.event({ k: 'unhook', id: v.id, by: rescuer ? rescuer.id : v.id });
  }

  kill(v, result) {
    if (v.health === 'dead' || v.health === 'escaped') return;
    if (v.hookId != null) {
      const h = this.S.hooks[v.hookId];
      if (h && h.occupant === v.id) h.occupant = null;
      v.hookId = null;
    }
    if (v.carriedBy != null) {
      const k = this.byId(v.carriedBy);
      if (k) k.carrying = null;
      v.carriedBy = null;
    }
    if (v.locker != null) {
      const l = this.S.lockers[v.locker];
      if (l) l.occ = null;
      v.locker = null;
    }
    if (v.trap != null) {
      const t = this.S.traps.find((q) => q.id === v.trap);
      if (t) { t.state = 'ground'; t.victim = null; }
      v.trap = null;
    }
    v.hold = null;
    v.lock = null;
    v.lk = null;
    v.flashOn = false;
    v.health = 'dead';
    v.result = result;
    if (this.killer) this.addScore(this.killer, 'sacrifice', 1000, result === 'sacrificed' ? 'Sacrifice' : 'Kill');
    this.event({ k: 'dead', id: v.id, how: result });
  }

  escape(v, via) {
    if (v.health === 'dead' || v.health === 'escaped') return;
    v.health = 'escaped';
    v.result = 'escaped';
    v.hold = null;
    v.flashOn = false;
    this.addScore(v, 'survival', via === 'hatch' ? 7000 : 5000, via === 'hatch' ? 'Hatch escape' : 'Escaped');
    this.event({ k: 'escape', id: v.id, via });
  }

  powerGates() {
    if (this.S.gatesPowered) return;
    this.S.gatesPowered = true;
    for (const g of this.S.gens) if (!g.done) { g.entityBlocked = true; g.regressing = false; }
    for (const p of this.survivors()) if (p.hold && p.hold.kind === 'repair') this.stopHold(p);
    this.event({ k: 'gatesPowered' });
    for (const p of this.survivors()) {
      if (!this.inPlay(p) || !has(p, 'adrenaline')) continue;
      if (p.health === 'injured') { p.health = 'healthy'; p.healP = 0; p.mangled = false; }
      else if (p.health === 'dying') { p.health = 'injured'; p.healP = 0; }
      if (isUp(p)) { p.fx.haste.push({ mul: 1.5, t: 5 }); p.exh = TIMES.EXHAUSTION; }
      this.event({ k: 'msg', text: 'Adrenaline' }, p.id);
    }
    const k = this.killer;
    if (k && has(k, 'noed')) {
      const dull = this.S.totems.filter((t) => t.state === 'dull');
      if (dull.length) {
        const t = dull[Math.floor(Math.random() * dull.length)];
        t.state = 'noed';
        t.hex = 'noed';
        this.event({ k: 'msg', text: 'Hex: No One Escapes Death' });
      }
    }
    if (k && has(k, 'bitter_murmur')) this.revealToKiller(this.survivors().filter((s) => this.inPlay(s)).map((s) => s.id), 10);
  }

  startEGC() {
    if (this.S.egc != null) return;
    this.S.egc = TIMES.EGC;
    this.event({ k: 'egc' });
  }

  // ------------------------------------------------------- skill checks --
  issueSkill(p, kind) {
    const id = this.skillId++;
    const zoneW = kind === 'ds' ? 0.07 : kind === 'struggle' ? 0.1 : SKILL.GOOD;
    const start = 0.38 + Math.random() * 0.42;
    p.skill = { id, kind, start, good: zoneW, great: kind === 'ds' || kind === 'struggle' ? 0 : SKILL.GREAT, deadline: this.time + SKILL.WARN + SKILL.ROTATION + 1.0 };
    if (p.isBot) {
      p.skill.botAt = this.time + SKILL.WARN + start * SKILL.ROTATION + 0.05;
    } else {
      this.event({ k: 'sc', id, kind, start: r3(start), good: zoneW, great: p.skill.great, warn: SKILL.WARN, rot: SKILL.ROTATION }, p.id);
    }
  }

  botSkillResult(kind) {
    const o = SKILL_ODDS[this.difficulty] || SKILL_ODDS.normal;
    const r = Math.random();
    if (kind === 'ds' || kind === 'struggle') return r < o.great + o.good ? 'good' : 'miss';
    if (r < o.great) return 'great';
    if (r < o.great + o.good) return 'good';
    return 'miss';
  }

  resolveSkill(p, id, res) {
    if (!p.skill || p.skill.id !== id) return;
    if (res !== 'great' && res !== 'good') res = 'miss';
    const kind = p.skill.kind;
    p.skill = null;
    if (kind === 'struggle') {
      if (res === 'miss' && p.health === 'hooked') p.hookTime -= HOOK.STRUGGLE_MISS;
      return;
    }
    if (kind === 'ds') {
      const k = this.byId(p.carriedBy);
      if (res !== 'miss' && k && p.health === 'carried') {
        p.dsUsed = true;
        this.stunKiller(k, 5, 'ds');
        this.event({ k: 'ds', id: p.id });
        this.addScore(p, 'boldness', 1500, 'Decisive Strike');
      } else p.dsUsed = true;
      return;
    }
    if (!p.hold) return;
    const h = p.hold;
    if (kind === 'repair') {
      const g = this.S.gens[h.id];
      if (!g) return;
      if (res === 'great') {
        g.charges = Math.min(GEN.CHARGES, g.charges + GEN.GREAT_BONUS * GEN.CHARGES);
        this.addScore(p, 'objectives', 300, 'Great skill check');
      } else if (res === 'good') {
        this.addScore(p, 'objectives', 50, 'Good skill check');
      } else {
        if (!has(p, 'technician')) {
          g.charges = Math.max(0, g.charges - GEN.SKILL_MISS_LOSS * GEN.CHARGES);
          this.event({ k: 'genExplode', id: g.id });
          this.noise(g.x, g.z, 'gen');
        } else {
          g.charges = Math.max(0, g.charges - 0.05 * GEN.CHARGES);
        }
        this.stopHold(p);
      }
    } else {
      const t = h.kind === 'heal' ? this.byId(h.id) : p;
      if (!t) return;
      if (res === 'great') {
        t.healP = Math.min(1, t.healP + 0.01);
        this.addScore(p, 'altruism', 150, 'Great skill check');
      } else if (res === 'good') {
        this.addScore(p, 'altruism', 30);
      } else {
        t.healP = Math.max(0, t.healP - HEAL.MISS_LOSS);
        this.event({ k: 'healMiss', id: t.id });
        this.noise(t.x, t.z, 'heal');
        this.stopHold(p);
      }
    }
  }

  // --------------------------------------------------------------- tick --
  tick() {
    if (!this.started || this.ended) return;
    const dt = DT;
    this.time += dt;
    const S = this.S;

    for (const p of S.players) this.updateEffects(p, dt);

    // bots think and move
    for (const p of S.players) {
      if (!p.brain) continue;
      try { p.brain.update(dt); } catch (e) { console.error('bot error', e); }
      if (this.canMove(p) && !p.hold) {
        const res = stepMove(p, p.input, dt, this.world, playerBlockers(S.players, p));
        p.sprint = !!p.input.sprint;
        p.crouch = !!p.input.crouch;
        if (p.role === 'killer' && p.pw === 'saw' && p.isBot && res.ratio < 0.5 && res.moved < 0.1) {
          p.pw = null;
          p.sawEnd = this.time;
          this.lock(p, 'stun', TIMES.STUN_BUMP);
          this.event({ k: 'saw', s: 'bump', id: p.id, x: r2(p.x), z: r2(p.z) });
        }
      }
    }

    // locks
    for (const p of S.players) {
      if (!p.lock) continue;
      const L = p.lock;
      L.t += dt;
      if (L.from && L.to) {
        const f = Math.min(1, L.t / L.dur);
        const e = f * f * (3 - 2 * f);
        p.x = L.from.x + (L.to.x - L.from.x) * e;
        p.z = L.from.z + (L.to.z - L.from.z) * e;
      }
      if (L.t >= L.dur) this.finishLock(p);
    }

    // carried survivors follow the killer
    for (const p of S.players) {
      if (p.role === 'survivor' && p.carriedBy != null) {
        const k = this.byId(p.carriedBy);
        if (k) { p.x = k.x; p.z = k.z; p.rot = k.rot; }
      }
    }

    // speed estimates & movement budgets
    for (const p of S.players) {
      const moved = Math.hypot(p.x - p.lastX, p.z - p.lastZ);
      p.lastX = p.x; p.lastZ = p.z;
      p.spd = p.spd * 0.6 + (moved / dt) * 0.4;
      if (p.spd < 0.05) p.spd = 0;
      p.moving = p.spd > 0.3;
      let max;
      if (p.role === 'survivor') max = p.health === 'dying' ? SURV.CRAWL * 1.3 : Math.max(survivorSpeed(p, true, false), survivorSpeed(p, false, true)) * 1.0;
      else max = Math.max(killerSpeed(p), (KILLERS[p.char].speed) * KILL.LUNGE_MUL, p.char === 'hillbilly' ? SAW_SPEED : 0, p.char === 'wraith' ? 6.1 : 0);
      p.budget = Math.min(p.budget + max * 1.35 * dt + 0.01, 3);
    }

    for (const p of S.players) if (p.role === 'killer') this.updateKiller(p, dt);
    for (const p of S.players) if (p.role === 'survivor') this.updateSurvivor(p, dt);

    this.updateObjects(dt);
    this.updateHatchets(dt);
    this.updateChase(dt);
    this.updateEndgame(dt);
    this.broadcastSnapshot();
  }

  updateEffects(p, dt) {
    if (p.role === 'killer') {
      p.blindT = Math.max(0, p.blindT - dt);
      p.blindImm = Math.max(0, p.blindImm - dt);
      p.popT = Math.max(0, p.popT - dt);
      // the bot killer's handicap only applies while it hunts bot survivors;
      // human survivors always face a full-speed killer
      let hand = 1;
      if (p.botSm && p.brain) {
        const t = p.brain.target ? this.byId(p.brain.target) : null;
        if (!t || t.isBot) hand = p.botSm;
      }
      p.sm = (this.noedActive() ? 1.04 : 1) * hand;
      return;
    }
    const fx = p.fx;
    const running = p.sprint && p.moving;
    if (p.exh > 0 && !running) p.exh = Math.max(0, p.exh - dt);
    fx.haste = fx.haste.filter((h) => (h.t -= dt) > 0);
    fx.hitBoost = Math.max(0, fx.hitBoost - dt);
    fx.endurance = Math.max(0, fx.endurance - dt);
    fx.dh = Math.max(0, fx.dh - dt);
    fx.ds = Math.max(0, fx.ds - dt);
    fx.wmi = Math.max(0, fx.wmi - dt);
    if (has(p, 'sprint_burst') && running && !p.wasRunning && p.exh <= 0 && isUp(p) && !p.lock) {
      fx.haste.push({ mul: 1.5, t: 3 });
      p.exh = TIMES.EXHAUSTION;
    }
    p.wasRunning = running;
    let m = 1;
    if (fx.hitBoost > 0) m = Math.max(m, SURV.HIT_BOOST_MUL);
    for (const h of fx.haste) m = Math.max(m, h.mul);
    p.sm = m;
  }

  updateKiller(k, dt) {
    // attack state
    if (k.atk === 'lunge') {
      k.atkT += dt;
      if (k.isBot) {
        const t = k.whiff ? null : attackCandidate(k, this.S.players, this.world);
        if (t) {
          this.applyHit(k, t, 'basic');
          k.atk = 'cd'; k.atkT = 0; k.atkHit = true;
        } else if (k.atkT >= k.lungeDur) {
          k.atk = 'cd'; k.atkT = 0; k.atkHit = false;
        }
      } else if (k.atkT > KILL.LUNGE_MAX + 0.8) {
        k.atk = 'cd'; k.atkT = 0; k.atkHit = false;
      }
    } else if (k.atk === 'cd') {
      k.atkT += dt;
      const cd = k.atkHit ? KILL.HIT_COOLDOWN : KILL.MISS_COOLDOWN * (has(k, 'unrelenting') ? 0.7 : 1);
      if (k.atkT >= cd) k.atk = null;
    }
    // powers
    k.pwT += dt;
    if (k.pw === 'cloaking' && k.pwT >= 1.5) { k.pw = 'cloaked'; k.pwT = 0; }
    else if (k.pw === 'uncloaking' && k.pwT >= 2.0) { k.pw = 'unc_boost'; k.pwT = 0; }
    else if (k.pw === 'unc_boost' && k.pwT >= 1.5) { k.pw = null; }
    if (k.pw === 'wind' && k.ammo <= 0) k.pw = null;
    if (k.isBot && k.char === 'hillbilly') {
      if (k.pw === 'rev') {
        k.pwC = Math.min(1, k.pwT / 2.0);
        if (k.pwC >= 1) { k.pw = 'saw'; k.pwT = 0; this.event({ k: 'saw', s: 'go', id: k.id }); }
      } else if (k.pw === 'saw') {
        const t = attackCandidate(k, this.S.players, this.world, 1.6, 0.7);
        if (t) this.sawHit(k, t);
        else if (k.pwT > 3) { k.pw = null; k.sawEnd = this.time; this.event({ k: 'saw', s: 'stop', id: k.id }); }
      }
    } else if (!k.isBot && k.pw === 'saw' && k.pwT > 4.5) {
      k.pw = null; k.sawEnd = this.time;
    }
    // carried survivor wiggling, DS
    if (k.carrying != null) {
      const v = this.byId(k.carrying);
      if (!v) { k.carrying = null; return; }
      if (v.isBot && !v.lock) {
        const eff = { easy: 0.45, normal: 0.7, hard: 0.9 }[this.difficulty] || 0.7;
        v.wiggle += (dt * eff) / (HOOK.WIGGLE_TIME * (has(k, 'iron_grasp') ? 1.75 : 1));
      }
      if (v.dsPending && this.time >= v.dsPending) {
        v.dsPending = null;
        this.issueSkill(v, 'ds');
      }
      if (v.wiggle >= 1) {
        this.dropSurvivor(k, true);
        this.lock(k, 'stun', HOOK.WIGGLE_STUN);
        this.event({ k: 'wiggleFree', id: v.id });
        this.addScore(v, 'survival', 1000, 'Wiggle free');
      }
    }
  }

  updateSurvivor(p, dt) {
    if (p.health === 'dead' || p.health === 'escaped') return;
    // skill checks
    if (p.skill) {
      if (p.isBot && p.skill.botAt && this.time >= p.skill.botAt) this.resolveSkill(p, p.skill.id, this.botSkillResult(p.skill.kind));
      else if (p.skill && this.time > p.skill.deadline) this.resolveSkill(p, p.skill.id, 'miss');
    } else if (p.hold && HOLD_SKILL.has(p.hold.kind) && Math.random() < SKILL.CHANCE_PER_SEC * dt) {
      this.issueSkill(p, p.hold.kind);
    } else if (p.health === 'hooked' && p.hookStage === 2 && !p.isBot && !p.lock && Math.random() < dt / 3.2) {
      this.issueSkill(p, 'struggle');
    }

    if (p.hold) this.updateHold(p, dt);

    // hooks
    if (p.health === 'hooked' && p.lk !== 'beingunhooked' && p.lk !== 'sacrifice') {
      p.hookTime -= dt;
      if (p.hookTime <= 0) {
        if (p.hookStage === 1) {
          p.hookStage = 2;
          p.hookTime = HOOK.STAGE_TIME;
          this.event({ k: 'struggle', id: p.id });
        } else {
          this.lock(p, 'sacrifice', 2.5);
        }
      }
    }
    // bleed out
    if (p.health === 'dying' && p.carriedBy == null && !p.lock) {
      const beingHealed = this.S.players.some((o) => o.hold && o.hold.kind === 'heal' && o.hold.id === p.id);
      if (!beingHealed) {
        p.bleed -= dt;
        if (p.bleed <= 0) this.kill(p, 'killed');
      }
    }
    // flashlight
    if (p.flashOn) {
      if (!p.item || p.item.type !== 'flashlight' || p.item.charges <= 0 || !isUp(p) || p.lock || p.hold) p.flashOn = false;
      else {
        p.item.charges = Math.max(0, p.item.charges - dt);
        const k = this.killer;
        if (k && k.blindImm <= 0 && this.flashHits(p, k)) {
          p.flashT += dt;
          if (p.flashT >= 0.9) {
            p.flashT = 0;
            k.blindT = TIMES.BLIND;
            k.blindImm = 6;
            this.event({ k: 'blind', id: k.id, by: p.id });
            this.addScore(p, 'boldness', 1000, 'Blind');
            if (k.carrying != null) {
              const vid = k.carrying;
              this.dropSurvivor(k, true);
              this.event({ k: 'freed', id: vid, how: 'flashlight' });
              this.addScore(p, 'altruism', 1500, 'Flashlight save');
              this.lock(k, 'stun', 1.5);
            }
          }
        } else p.flashT = Math.max(0, p.flashT - dt * 0.5);
      }
    }
    // traps
    if (isUp(p) && p.trap == null && p.locker == null && (!p.lock || p.lk === 'vault')) {
      for (const t of this.S.traps) {
        if (t.state !== 'armed') continue;
        if (Math.hypot(p.x - t.x, p.z - t.z) < 0.5) { this.trapSurvivor(p, t); break; }
      }
    }
    // escape through an open gate
    if (isUp(p) && !p.lock) {
      for (const g of this.S.gates) {
        if (!g.open) continue;
        const out = (p.x - g.x) * g.nx + (p.z - g.z) * g.nz;
        if (out > 4.2) { this.escape(p, 'gate'); break; }
      }
    }
  }

  flashHits(p, k) {
    const d = dist(p, k);
    if (d > 8 || d < 0.8) return false;
    const pitch = p.pitch || 0;
    const dx = Math.sin(p.rot) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(p.rot) * Math.cos(pitch);
    const tx = k.x - p.x, ty = KILL.EYE - 1.3, tz = k.z - p.z;
    const tl = Math.hypot(tx, ty, tz);
    const c = (dx * tx + dy * ty + dz * tz) / tl;
    if (c < Math.cos(0.22)) return false;
    // the killer must be looking towards the survivor
    const back = Math.atan2(p.x - k.x, p.z - k.z);
    if (Math.abs(angDiff(k.rot, back)) > 1.0) return false;
    return this.world.clearLine(p.x, p.z, k.x, k.z, 1.4);
  }

  trapSurvivor(p, t) {
    t.state = 'snapped';
    t.victim = p.id;
    p.trap = t.id;
    p.trapTries = 0;
    p.x = t.x; p.z = t.z;
    p.seq++;
    if (p.hold) this.stopHold(p);
    if (p.lock) this.cancelLock(p);
    if (p.health === 'healthy') { p.health = 'injured'; p.healP = 0; }
    this.event({ k: 'trapSnap', id: p.id, trap: t.id, x: r2(t.x), z: r2(t.z) });
    this.noise(t.x, t.z, 'trap');
    if (this.killer) this.addScore(this.killer, 'deviousness', 500, 'Trapped');
  }

  freeFromTrap(p) {
    const t = this.S.traps.find((q) => q.id === p.trap);
    if (t) { t.state = 'ground'; t.victim = null; }
    p.trap = null;
    p.hold = null;
    this.event({ k: 'trapFree', id: p.id });
  }

  holdRate(p, base) {
    return base * (has(p, 'resilience') && p.health === 'injured' ? 1.09 : 1);
  }

  updateHold(p, dt) {
    const h = p.hold;
    const opts = survivorOptions(p, this.S, null, 1.45);
    if (!opts.all.some((o) => o.kind === h.kind && (o.id === undefined || o.id === h.id))) { this.stopHold(p); return; }
    h.t += dt;
    switch (h.kind) {
      case 'repair': {
        const g = this.S.gens[h.id];
        let rate = this.holdRate(p, 1) * (GEN.COOP[Math.min(4, g.n)] || 1);
        if (has(p, 'prove_thyself')) rate *= 1 + 0.15 * Math.max(0, g.n - 1);
        if (p.item && p.item.type === 'toolbox' && p.item.charges > 0) {
          rate *= 1.5;
          p.item.charges = Math.max(0, p.item.charges - dt);
        }
        g.charges += rate * dt;
        p.score.objectives += (rate * dt * 1250) / GEN.CHARGES;
        g.regressing = false;
        h.p = g.charges / GEN.CHARGES;
        if (g.charges >= GEN.CHARGES) this.completeGen(g);
        break;
      }
      case 'heal': {
        const t = this.byId(h.id);
        const healers = this.S.players.filter((o) => o.hold && o.hold.kind === 'heal' && o.hold.id === t.id).length;
        let rate = this.holdRate(p, 1) * (HEAL.COOP[Math.min(4, healers)] || 1);
        if (has(p, 'botany')) rate *= 1.33;
        if (p.fx.wmi > 0) rate *= 2;
        if (t.mangled) rate *= 0.75;
        t.healP += (rate * dt) / HEAL.CHARGES;
        h.p = t.healP;
        if (t.healP >= 1) {
          this.healed(t);
          this.addScore(p, 'altruism', t.health === 'healthy' ? 600 : 800, 'Heal');
        }
        break;
      }
      case 'selfcare':
      case 'medkit': {
        let rate = h.kind === 'selfcare' ? HEAL.SELF_CARE_RATE : 1;
        if (has(p, 'botany')) rate *= 1.33;
        if (p.mangled) rate *= 0.75;
        if (h.kind === 'medkit') {
          if (!p.item || p.item.charges <= 0) { this.stopHold(p); return; }
          p.item.charges = Math.max(0, p.item.charges - dt);
        }
        p.healP += (this.holdRate(p, rate) * dt) / HEAL.CHARGES;
        h.p = p.healP;
        if (p.healP >= 1) { this.healed(p); this.addScore(p, 'survival', 300, 'Self heal'); }
        break;
      }
      case 'recover': {
        const cap = has(p, 'unbreakable') && !p.usedUnbreakable ? 1 : HEAL.RECOVER_MAX;
        p.healP = Math.min(cap, p.healP + (HEAL.RECOVER_RATE * dt) / HEAL.CHARGES);
        h.p = p.healP;
        if (p.healP >= 1) { p.usedUnbreakable = true; this.healed(p); this.addScore(p, 'survival', 1000, 'Unbreakable'); }
        else if (p.healP >= cap) this.stopHold(p);
        break;
      }
      case 'gate': {
        const g = this.S.gates[h.id];
        g.progress += this.holdRate(p, dt) / TIMES.GATE;
        h.p = g.progress;
        if (g.progress >= 1) {
          g.progress = 1;
          g.open = true;
          this.col.setGateOpen(g, true);
          this.nav.setGate(g, true);
          this.event({ k: 'gateOpen', id: g.id });
          this.addScore(p, 'objectives', 1250, 'Exit gate opened');
          this.startEGC();
          for (const o of this.S.players) if (o.hold && o.hold.kind === 'gate' && o.hold.id === g.id) this.stopHold(o);
        }
        break;
      }
      case 'cleanse': {
        const t = this.S.totems[h.id];
        t.progress = (t.progress || 0) + this.holdRate(p, dt) / TIMES.CLEANSE;
        h.p = t.progress;
        if (t.progress >= 1) {
          const wasHex = t.state === 'hex' || t.state === 'noed';
          this.event({ k: 'totem', id: t.id, hex: wasHex ? t.hex : null });
          t.state = 'cleansed';
          this.addScore(p, 'boldness', wasHex ? 1500 : 1000, wasHex ? 'Hex cleansed' : 'Totem cleansed');
          for (const o of this.S.players) if (o.hold && o.hold.kind === 'cleanse' && o.hold.id === t.id) this.stopHold(o);
        }
        break;
      }
      case 'chest': {
        const c = this.S.chests[h.id];
        c.progress = (c.progress || 0) + dt / TIMES.CHEST;
        h.p = c.progress;
        if (c.progress >= 1) {
          c.opened = true;
          const type = ['medkit', 'toolbox', 'flashlight'][Math.floor(Math.random() * 3)];
          const full = has(p, 'ace_in_hole');
          p.item = { type, charges: ITEMS[type].charges * (full ? 1 : 0.5 + Math.random() * 0.5) };
          this.event({ k: 'chest', id: c.id, by: p.id, item: type });
          this.addScore(p, 'objectives', 250, 'Chest searched');
          this.stopHold(p);
          for (const o of this.S.players) if (o.hold && o.hold.kind === 'chest' && o.hold.id === c.id) this.stopHold(o);
        }
        break;
      }
      case 'freetrap': {
        const t = this.byId(h.id);
        h.p = h.t / TIMES.FREE_TRAP;
        if (h.t >= TIMES.FREE_TRAP) {
          this.freeFromTrap(t);
          this.addScore(p, 'altruism', 500, 'Rescue from trap');
          this.stopHold(p);
        }
        break;
      }
      case 'disarm': {
        const t = this.S.traps.find((q) => q.id === h.id);
        h.p = h.t / TIMES.DISARM_TRAP;
        if (t && h.t >= TIMES.DISARM_TRAP) {
          t.state = 'ground';
          this.event({ k: 'trapDisarm', id: t.id });
          this.addScore(p, 'boldness', 250, 'Trap disarmed');
          this.stopHold(p);
        }
        break;
      }
      case 'escapetrap': {
        h.p = (h.t % TIMES.ESCAPE_TRAP_ATTEMPT) / TIMES.ESCAPE_TRAP_ATTEMPT;
        if (h.t >= TIMES.ESCAPE_TRAP_ATTEMPT) {
          h.t = 0;
          p.trapTries++;
          if (Math.random() < 0.12 + p.trapTries * 0.07 || p.trapTries >= 8) {
            this.freeFromTrap(p);
            this.addScore(p, 'survival', 500, 'Escaped trap');
          }
        }
        break;
      }
      case 'selfunhook': {
        h.p = h.t / HOOK.SELF_UNHOOK_TIME;
        if (h.t >= HOOK.SELF_UNHOOK_TIME) {
          this.stopHold(p);
          p.unhookTries++;
          if (Math.random() < HOOK.SELF_UNHOOK_CHANCE) this.unhook(p, null);
          else {
            this.event({ k: 'unhookFail', id: p.id });
            if (p.unhookTries >= HOOK.SELF_UNHOOK_ATTEMPTS && p.hookStage === 1) {
              p.hookStage = 2;
              p.hookTime = HOOK.STAGE_TIME;
              this.event({ k: 'struggle', id: p.id });
            }
          }
        }
        break;
      }
    }
  }

  healed(t) {
    if (t.health === 'injured') { t.health = 'healthy'; t.mangled = false; }
    else if (t.health === 'dying') t.health = 'injured';
    t.healP = 0;
    this.event({ k: 'healed', id: t.id, h: t.health });
    for (const o of this.S.players) {
      if (o.hold && ((o.hold.kind === 'heal' && o.hold.id === t.id) || (o === t && (o.hold.kind === 'selfcare' || o.hold.kind === 'medkit' || o.hold.kind === 'recover')))) this.stopHold(o);
    }
  }

  completeGen(g) {
    g.charges = GEN.CHARGES;
    g.done = true;
    g.regressing = false;
    this.S.gensDone++;
    for (const o of this.S.players) if (o.hold && o.hold.kind === 'repair' && o.hold.id === g.id) this.stopHold(o);
    this.event({ k: 'genDone', id: g.id, left: Math.max(0, GEN.REQUIRED - this.S.gensDone) });
    const k = this.killer;
    if (k && has(k, 'bitter_murmur') && this.S.gensDone < GEN.REQUIRED) {
      const ids = this.survivors().filter((s) => this.inPlay(s) && dist(s, g) < 16).map((s) => s.id);
      if (ids.length) this.revealToKiller(ids, 5);
    }
    if (k && k.brain) k.brain.onGenDone(g);
    if (this.S.gensDone >= GEN.REQUIRED) this.powerGates();
  }

  updateObjects(dt) {
    const S = this.S;
    // generators
    const ruin = S.totems.some((t) => t.state === 'hex' && t.hex === 'ruin');
    for (const g of S.gens) g.n = 0;
    for (const p of S.players) if (p.hold && p.hold.kind === 'repair') S.gens[p.hold.id].n++;
    for (const g of S.gens) {
      g.blocked = g.entityBlocked || this.time < g.blockedUntil;
      if (g.done || g.blocked) continue;
      if (g.n > 0) { g.regressing = false; continue; }
      if (g.charges > 0 && (g.regressing || ruin)) {
        g.charges = Math.max(0, g.charges - GEN.REGRESS * dt);
        if (g.charges <= 0) g.regressing = false;
      }
      g.progress = g.charges / GEN.CHARGES;
    }
    for (const g of S.gens) g.progress = g.charges / GEN.CHARGES;
    // pallets
    for (const pl of S.pallets) {
      if (pl.state !== 'falling') continue;
      pl.t += dt;
      if (pl.t >= TIMES.PALLET_DROP) this.palletLands(pl);
    }
    // windows
    for (const w of S.windows) if (w.blocked && this.time > w.blockedUntil) w.blocked = false;
    // hatch
    if (S.hatch.state === 'closed') {
      const left = this.survivors().filter((p) => this.inPlay(p));
      if (left.length === 1 && this.survivors().length > 1) {
        S.hatch.state = 'open';
        this.event({ k: 'hatchOpen' });
      }
    }
  }

  palletLands(pl) {
    pl.state = 'down';
    this.col.setPalletDown(pl, true);
    this.nav.setPallet(pl, 'down');
    const box = palletBox(pl);
    const dropper = this.byId(pl.by);
    for (const p of this.S.players) {
      if (p.health === 'dead' || p.health === 'escaped' || p.carriedBy != null || p.locker != null || p.health === 'hooked') continue;
      const r = radiusOf(p);
      const d = distToBox(p.x, p.z, box);
      if (d >= r - 0.02 && !(p.role === 'killer' && d < r + 0.45 && !p.lk && p.carrying == null)) continue;
      const rel = relTo(p, pl);
      let side = Math.sign(rel.perp) || -(pl.side || 1);
      if (p.role === 'killer' && d < r + 0.45) {
        if (Math.abs(rel.perp) < 0.15) side = -(pl.side || 1);
        const dur = TIMES.PALLET_STUN * (has(p, 'enduring') ? 0.5 : 1);
        this.stunKiller(p, dur, 'pallet');
        if (dropper) this.addScore(dropper, 'boldness', 1000, 'Pallet stun');
        if (dropper && dropper.brain) dropper.brain.onStunned();
      }
      const off = 0.28 + r + 0.05;
      p.x = pl.x + pl.nx * side * off + -pl.nz * rel.lat;
      p.z = pl.z + pl.nz * side * off + pl.nx * rel.lat;
      p.seq++;
    }
    // killer standing right at the edge also gets stunned
    const k = this.killer;
    if (k && !k.lk && k.carrying == null) {
      const d = distToBox(k.x, k.z, box);
      if (d < KILL.RADIUS + 0.45 && d >= KILL.RADIUS - 0.02) {
        const dur = TIMES.PALLET_STUN * (has(k, 'enduring') ? 0.5 : 1);
        this.stunKiller(k, dur, 'pallet');
        if (dropper) this.addScore(dropper, 'boldness', 1000, 'Pallet stun');
      }
    }
  }

  // The killer chases at most one survivor at a time: the one it is pursuing
  // (visible, close, in front). Chase drives music and bloodpoints.
  updateChase(dt) {
    const k = this.killer;
    const S = this.S;
    let target = null;
    if (k && k.carrying == null && !k.lk) {
      const cur = S.players.find((p) => p.chase);
      let best = null, bs = 1e9;
      for (const p of S.players) {
        if (p.role !== 'survivor' || !isUp(p) || p.locker != null) continue;
        const d = dist(p, k);
        const lim = p === cur ? 32 : 18;
        if (d > lim) continue;
        const ang = Math.abs(angDiff(k.rot, Math.atan2(p.x - k.x, p.z - k.z)));
        if (p !== cur && ang > 0.9) continue;
        if (!this.world.clearLine(k.x, k.z, p.x, p.z, 1.6)) continue;
        const sc = d + ang * 6 - (p === cur ? 8 : 0) - (k.brain && k.brain.target === p.id ? 20 : 0);
        if (sc < bs) { bs = sc; best = p; }
      }
      target = best;
    }
    for (const p of S.players) {
      if (p.role !== 'survivor') continue;
      if (!k || !isUp(p) || p.locker != null || (k && k.carrying != null)) { p.chase = false; p.chaseT = 0; p.lostT = 0; continue; }
      if (p === target) {
        p.lostT = 0;
        if (!p.chase) {
          p.chaseT += dt;
          if (p.chaseT > 1.0 && k.moving) { for (const o of S.players) if (o !== p) o.chase = false; p.chase = true; }
        }
      } else if (p.chase) {
        p.lostT += dt;
        if (p.lostT > 6 || dist(p, k) > 40) { p.chase = false; p.chaseT = 0; }
      } else p.chaseT = Math.max(0, p.chaseT - dt);
    }
    let any = false;
    for (const p of S.players) {
      if (p.role === 'survivor' && p.chase) {
        any = true;
        p.score.boldness += 12 * dt;
        if (k) k.score.hunter += 10 * dt;
      }
    }
    if (k) k.chase = any;
  }

  updateEndgame(dt) {
    const S = this.S;
    if (S.egc != null) {
      const slow = this.survivors().some((p) => p.health === 'dying' || p.health === 'hooked');
      S.egc -= dt * (slow ? 0.5 : 1);
      if (S.egc <= 0) {
        S.egc = 0;
        for (const p of this.survivors()) if (this.inPlay(p)) this.kill(p, p.health === 'hooked' ? 'sacrificed' : 'killed');
      }
    }
    if (this.time > 60 * 40 && S.egc == null) { this.powerGates(); this.startEGC(); }
    const left = this.survivors().filter((p) => this.inPlay(p));
    if (!left.length && this.endAt == null) this.endAt = this.time + 4;
    if (this.endAt != null && this.time >= this.endAt) this.end();
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    const kills = this.survivors().filter((p) => p.result === 'sacrificed' || p.result === 'killed').length;
    const emblem = kills >= 4 ? 'Merciless Killer' : kills === 3 ? 'Ruthless Killer' : kills === 2 ? 'Brutal Killer' : 'Entity Displeased';
    const players = this.S.players.map((p) => {
      const score = {};
      let total = 0;
      for (const [c, v] of Object.entries(p.score)) { score[c] = Math.min(CAT_CAP, Math.round(v)); total += score[c]; }
      return {
        id: p.id, name: p.name, role: p.role, char: p.char, isBot: p.isBot, perks: p.perks,
        result: p.role === 'killer' ? emblem : (p.result || 'escaped'), score, total,
      };
    });
    const results = { kills, emblem, players, map: this.map.name, realm: this.map.realm, duration: Math.round(this.time) };
    this.opts.onEnd(results);
  }

  // ----------------------------------------------------------- snapshot --
  snapPlayer(p) {
    const o = {
      i: p.id, x: r2(p.x), z: r2(p.z), r: r2(p.rot), h: p.health, sp: r2(p.spd), sq: p.seq,
    };
    if (p.lk) { o.lk = p.lk; if (p.lock) o.lt = r2(p.lock.t / p.lock.dur); if (p.lock && p.lock.data && p.lock.data.type) o.vt = p.lock.data.type; }
    if (p.crouch) o.cr = 1;
    if (p.sprint) o.sr = 1;
    if (p.chase) o.ch = 1;
    if (p.sm !== 1) o.sm = r2(p.sm);
    if (p.role === 'killer') {
      o.pt = r2(p.pitch);
      if (p.carrying != null) o.cy = p.carrying;
      if (p.atk) { o.atk = p.atk; o.ah = p.atkHit ? 1 : 0; }
      if (p.pw) o.pw = p.pw;
      if (p.pw === 'rev') o.pc = r2(p.pwT);
      o.am = p.ammo;
      o.tr = p.pw === 'cloaked' || p.pw === 'cloaking' ? 0 : p.tr;
      if (p.blindT > 0) o.bl = r2(p.blindT);
      if (p.popT > 0) o.pop = 1;
    } else {
      if (p.hold) o.hd = { k: p.hold.kind, id: p.hold.id, p: r3(p.hold.p || 0) };
      if (p.healP > 0) o.hp = r3(p.healP);
      if (p.carriedBy != null) { o.cb = p.carriedBy; o.wg = r3(p.wiggle); if (p.wigDir) o.wd = p.wigDir; }
      if (p.locker != null) o.lc = p.locker;
      if (p.trap != null) o.tp = p.trap;
      if (p.hookCount) o.hc = p.hookCount;
      if (p.health === 'hooked') { o.hk = p.hookId; o.ht = r2(p.hookTime); o.hs = p.hookStage; o.ut = p.unhookTries; }
      if (p.health === 'dying') o.bo = r2(p.bleed);
      if (p.exh > 0) o.ex = r2(p.exh);
      const fx = [];
      if (p.fx.endurance > 0) fx.push('E');
      if (p.fx.hitBoost > 0 || p.fx.haste.length) fx.push('H');
      if (p.mangled) fx.push('M');
      if (p.fx.dh > 0) fx.push('D');
      if (p.fx.ds > 0 && !p.dsUsed) fx.push('S');
      if (p.fx.wmi > 0) fx.push('W');
      if (fx.length) o.fx = fx.join('');
      if (p.item) o.it = { t: p.item.type, c: r2(p.item.charges / ITEMS[p.item.type].charges) };
      if (p.flashOn) { o.fl = 1; o.pt = r2(p.pitch || 0); }
      if (p.result) o.res = p.result;
      if (p.usedUnbreakable) o.ub = 1;
    }
    return o;
  }

  broadcastSnapshot() {
    const S = this.S;
    const snap = {
      t: 's',
      tm: r3(this.time),
      p: S.players.map((p) => this.snapPlayer(p)),
      g: S.gens.map((g) => [r2(g.charges), g.done ? 1 : 0, g.blocked ? 1 : 0, g.regressing ? 1 : 0, g.n]),
      pl: S.pallets.map((p) => (p.state === 'up' ? 'u' : p.state === 'falling' ? 'f' : p.state === 'down' ? 'd' : 'b')).join(''),
      gt: S.gates.map((g) => [r3(g.progress), g.open ? 1 : 0]),
      gp: S.gatesPowered ? 1 : 0,
      hc: S.hatch.state[0],
      tt: S.totems.map((t) => (t.state === 'dull' ? 'd' : t.state === 'hex' ? 'h' : t.state === 'noed' ? 'n' : 'c')).join(''),
      cs: S.chests.map((c) => (c.opened ? '1' : '0')).join(''),
      gd: S.gensDone,
    };
    if (S.windows.some((w) => w.blocked)) snap.wb = S.windows.filter((w) => w.blocked).map((w) => w.id);
    if (S.traps.length) snap.tr = S.traps.map((t) => [t.id, r2(t.x), r2(t.z), t.state[0], r2(t.rot || 0)]);
    if (S.hatchets.length) snap.hx = S.hatchets.map((h) => [h.id, r2(h.x), r2(h.y), r2(h.z), r2(h.vx), r2(h.vy), r2(h.vz)]);
    if (S.egc != null) snap.egc = r2(S.egc);
    if (this.eventsOut.length) { snap.e = this.eventsOut; this.eventsOut = []; }
    this.opts.broadcast(snap);
  }

  // Data needed by clients to build the match.
  initInfo(forId) {
    return {
      map: this.map,
      you: forId,
      difficulty: this.difficulty,
      players: this.S.players.map((p) => ({ id: p.id, name: p.name, role: p.role, char: p.char, perks: p.perks, isBot: p.isBot, item: p.item ? p.item.type : null })),
    };
  }
}
