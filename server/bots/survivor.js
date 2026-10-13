// Survivor bot: repairs generators, loops the killer around pallets and
// windows, rescues and heals teammates, and escapes through the gates.

import { Mover, dist, vegBlocks } from './common.js';
import { survivorOptions, relTo, isUp, angDiff } from '../../shared/interact.js';
import { genBox } from '../../shared/collision.js';
import { HEAL } from '../../shared/constants.js';

const DIFF = {
  easy: { react: 0.8, dropRange: 3.2, vaultRange: 4.0, loopSkill: 0.45, noticeTrap: 0.4, sneak: 0.3 },
  normal: { react: 0.45, dropRange: 4.4, vaultRange: 5.0, loopSkill: 0.8, noticeTrap: 0.7, sneak: 0.6 },
  hard: { react: 0.2, dropRange: 4.8, vaultRange: 5.5, loopSkill: 0.95, noticeTrap: 0.95, sneak: 0.9 },
};

export class SurvivorBot {
  constructor(m, p, diff) {
    this.m = m;
    this.p = p;
    this.cfg = DIFF[diff] || DIFF.normal;
    this.mv = new Mover(m, p);
    this.thinkT = Math.random() * 0.4;
    this.task = null;
    this.kk = null;
    this.kDist = Infinity;
    this.kVis = false;
    this.prevKD = Infinity;
    this.approach = 0;
    this.dangerSince = null;
    this.lastHitT = -99;
    this.loop = null;
    this.black = new Map();
    this.knownTraps = new Set();
    this.seenTraps = new Set();
    this.lockerT = 0;
    this.flee = null;
    this.fleeT = 0;
    this.waitFor = null;
    this.altruism = 0.65 + Math.random() * 0.35;
    this.recoverWait = 0;
  }

  get now() { return this.m.time; }
  onHit() { this.lastHitT = this.now; }
  onStunned() {}

  // ------------------------------------------------------------ perception --
  perceive(dt) {
    const p = this.p, m = this.m, k = m.killer;
    if (!k) return;
    const d = dist(p, k);
    const cloaked = k.pw === 'cloaked' || k.pw === 'cloaking';
    const los = d < 42 && m.world.clearLine(p.x, p.z, k.x, k.z, 1.5) && !vegBlocks(m.map, p, k);
    const visible = los && (!cloaked || d < 5);
    this.kVis = visible;
    if (visible) {
      this.kk = { x: k.x, z: k.z, t: this.now, seen: true };
      this.kDist = d;
    } else if (k.tr > 0 && d < k.tr) {
      if (!this.kk || this.now - this.kk.t > 1.2 || this.kk.seen) {
        this.kk = { x: k.x + (Math.random() - 0.5) * 6, z: k.z + (Math.random() - 0.5) * 6, t: this.now, seen: false };
      } else this.kk.t = this.now;
      this.kDist = d;
    } else if (!this.kk || this.now - this.kk.t > 4) {
      this.kDist = Infinity;
    }
    const delta = this.prevKD - this.kDist;
    this.prevKD = this.kDist;
    if (Number.isFinite(delta)) this.approach = this.approach * 0.85 + (delta / dt) * 0.15;
    // traps
    if (k.char === 'trapper') {
      for (const t of m.S.traps) {
        if (t.state !== 'armed' || this.seenTraps.has(t.id)) continue;
        if (Math.hypot(t.x - p.x, t.z - p.z) < 5.5) {
          this.seenTraps.add(t.id);
          if (Math.random() < this.cfg.noticeTrap) this.knownTraps.add(t.id);
        }
      }
    }
  }

  danger() {
    const p = this.p, m = this.m, k = m.killer;
    if (!k) return 0;
    if (this.now - this.lastHitT < 5) return 3;
    if (p.chase && this.kDist < 30) return 3;
    if (!this.kk || this.now - this.kk.t > 3) return 0;
    const d = this.kDist;
    if (k.carrying != null && d > 8) return d < 20 ? 1 : 0;
    if (d < 6) return 2;
    if (this.kVis && d < 11) return 2;
    if (this.kVis && d < 22 && this.approach > 1.5) return 2;
    if (d < 24) return 1;
    return 0;
  }

  // costs for path planning: avoid the killer and known traps
  costFn() {
    const kk = this.kk && this.now - this.kk.t < 5 ? this.kk : null;
    const traps = [...this.knownTraps].map((id) => this.m.S.traps.find((t) => t.id === id)).filter((t) => t && t.state === 'armed');
    if (!kk && !traps.length) return undefined;
    return (x, z) => {
      let c = 0;
      if (kk) {
        const d = Math.hypot(x - kk.x, z - kk.z);
        if (d < 12) c += (12 - d) * 1.2;
      }
      for (const t of traps) if (Math.hypot(x - t.x, z - t.z) < 0.9) c += 60;
      return c;
    };
  }

  go(x, z, run, opts = {}) {
    const p = this.p;
    this.mv.setGoal(x, z, { tol: opts.tol ?? 0.6, replan: opts.replan ?? 1.5, cost: this.costFn() });
    const st = this.mv.update(this.dt, opts.arrive ?? 0.35);
    if (st.link) {
      const kind = st.link.kind === 'window' ? 'vault' : 'vaultp';
      this.m.doSpace(p, kind, st.link.id);
      return false;
    }
    p.input.mx = st.mx;
    p.input.mz = st.mz;
    p.input.sprint = run;
    if (st.arrived || Math.hypot(p.x - x, p.z - z) < (opts.arrive ?? 0.35)) {
      p.input.mx = p.input.mz = 0;
      return true;
    }
    return false;
  }

  // ----------------------------------------------------------------- update --
  update(dt) {
    const p = this.p, m = this.m;
    this.dt = dt;
    p.input = { mx: 0, mz: 0, sprint: false, crouch: false };
    if (p.health === 'dead' || p.health === 'escaped' || p.carriedBy != null) return;
    this.perceive(dt);
    if (p.lock) return;
    if (p.health === 'hooked') return this.onHook(dt);
    if (p.trap != null) { if (!p.hold) m.startHold(p, 'escapetrap', null); return; }
    if (p.locker != null) return this.inLocker(dt);
    if (p.health === 'dying') return this.dying(dt);
    if (!isUp(p)) return;

    let dl = this.danger();
    if (dl >= 2) {
      if (this.dangerSince == null) this.dangerSince = this.now;
      if (this.now - this.dangerSince < this.cfg.react && dl < 3) dl = 1;
    } else this.dangerSince = null;

    if (dl >= 2) {
      this.task = null;
      this.doFlee(dt);
      return;
    }
    this.loop = null;
    this.flee = null;

    // cautious: killer approaching while we work
    if (dl === 1 && this.kk && this.approach > 0.6 && this.kDist < 18 && !(this.task && (this.task.kind === 'escape' || this.task.kind === 'hatch'))) {
      if (p.hold) m.stopHold(p);
      this.sneakAway(dt);
      return;
    }

    this.thinkT -= dt;
    if (this.thinkT <= 0 || !this.task) {
      this.thinkT = 0.5 + Math.random() * 0.3;
      this.chooseTask(dl);
    }
    this.doTask(dt, dl);
  }

  onHook() {
    const p = this.p, m = this.m;
    if (p.hookStage !== 1 || p.unhookTries >= 3 || p.hold) return;
    const others = m.survivors().filter((s) => s !== p && isUp(s) && s.trap == null);
    if (!others.length && Math.random() < this.dt * 0.25) m.startHold(p, 'selfunhook', null);
  }

  inLocker(dt) {
    this.lockerT += dt;
    const safe = this.kDist > 18 || !this.kk || this.now - this.kk.t > 4;
    if ((safe && this.lockerT > 3) || this.lockerT > 25) {
      this.lockerT = 0;
      this.m.doSpace(this.p, 'exitlocker', this.p.locker);
    }
  }

  dying(dt) {
    const p = this.p, m = this.m, k = m.killer;
    const healer = m.S.players.find((o) => o.hold && o.hold.kind === 'heal' && o.hold.id === p.id);
    if (healer) { if (p.hold) m.stopHold(p); return; }
    const kd = k ? dist(p, k) : 99;
    const killerBusy = k && k.carrying != null;
    if (kd > 16 || killerBusy) {
      const cap = p.perks.includes('unbreakable') && !p.usedUnbreakable ? 1 : HEAL.RECOVER_MAX;
      if (p.healP < cap - 0.01) { if (!p.hold) m.startHold(p, 'recover', null); return; }
      // crawl towards the nearest healthy teammate
      const mate = m.survivors().filter((s) => s !== p && isUp(s)).sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (mate && dist(mate, p) > 2) this.go(mate.x, mate.z, false, { replan: 2 });
      return;
    }
    if (p.hold) m.stopHold(p);
    // crawl away
    const kx = k.x, kz = k.z;
    if (!this.flee || this.now > this.fleeT) {
      this.flee = this.fleePoint(kx, kz, 6);
      this.fleeT = this.now + 1.5;
    }
    if (this.flee) this.go(this.flee.x, this.flee.z, false, { replan: 1.5 });
  }

  sneakAway(dt) {
    const p = this.p, k = this.m.killer;
    const kx = this.kk.x, kz = this.kk.z;
    const facingUs = Math.abs(angDiff(k.rot, Math.atan2(p.x - k.x, p.z - k.z))) < 0.7;
    const a = this.fleeDir(kx, kz);
    p.input.mx = Math.sin(a);
    p.input.mz = Math.cos(a);
    if (facingUs && this.kDist < 16) p.input.sprint = true;
    else if (!this.kVis && Math.random() < this.cfg.sneak) p.input.crouch = this.kDist > 8;
  }

  fleePoint(kx, kz, R) {
    const p = this.p, nav = this.m.nav;
    let best = null, bs = -1e9;
    const away = Math.atan2(p.x - kx, p.z - kz);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      for (const r of [R, R * 0.6]) {
        const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
        if (Math.abs(x) > 44 || Math.abs(z) > 44) continue;
        if (!nav.walkable(x, z) || !nav.lineFree(p.x, p.z, x, z)) continue;
        let da = Math.abs(a - away) % (Math.PI * 2);
        if (da > Math.PI) da = Math.PI * 2 - da;
        const s = Math.hypot(x - kx, z - kz) - da * 2 + Math.random() + r * 0.2;
        if (s > bs) { bs = s; best = { x, z }; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------- chase ----
  doFlee(dt) {
    const p = this.p, m = this.m, k = m.killer;
    if (p.hold) m.stopHold(p);
    const seenRecently = this.kk && this.now - this.kk.t < 1.5;
    const kx = this.kVis || !seenRecently ? k.x : this.kk.x;
    const kz = this.kVis || !seenRecently ? k.z : this.kk.z;
    const dk = Math.hypot(p.x - kx, p.z - kz);
    p.input.sprint = true;
    if (!this.lastVault) this.lastVault = new Map();

    if (p.health === 'injured' && p.perks.includes('dead_hard') && p.exh <= 0 && k.atk === 'lunge' && dk < 2.8) m.deadHard(p);

    const opts = survivorOptions(p, m.S, null, 1);
    const kBusy = k.lk === 'break' || k.lk === 'kvault' || k.lk === 'stun';
    for (const o of opts.all) {
      if (o.kind === 'drop') {
        const pl = m.S.pallets[o.id];
        const rp = relTo(p, pl), rk = relTo({ x: kx, z: kz }, pl);
        const sideP = Math.sign(rp.perp) || 1;
        // killer is not clearly on our side of the pallet
        const other = rk.perp * sideP < 0.4;
        // usually pre-drop to block; sometimes go for the stun
        if (this.dropAt == null) this.dropAt = Math.random() < 0.25 ? 2.4 : this.cfg.dropRange + (Math.random() - 0.5) * 0.8;
        if (other && Math.abs(rp.perp) >= 0.35 && dk < this.dropAt + 0.6 && Math.abs(rk.lat) < 3.5 && k.carrying == null && !kBusy) {
          if (m.doSpace(p, 'drop', o.id)) {
            this.dropAt = null;
            this.loop = { type: 'pallet', id: o.id, t0: this.now };
            return;
          }
        }
        // killer about to hit us right at the pallet: drop as a last resort
        if (!other && dk < 1.6 && Math.random() < this.cfg.loopSkill * 0.1) {
          if (m.doSpace(p, 'drop', o.id)) return;
        }
      } else if (o.kind === 'vault' || o.kind === 'vaultp') {
        const obj = o.kind === 'vault' ? m.S.windows[o.id] : m.S.pallets[o.id];
        const rp = relTo(p, obj), rk = relTo({ x: kx, z: kz }, obj);
        const same = Math.sign(rp.perp) === Math.sign(rk.perp) && Math.abs(rk.perp) > 0.5;
        const key = o.kind + o.id;
        const recent = this.now - (this.lastVault.get(key) || -99) < 1.4;
        if (same && dk < this.cfg.vaultRange && !kBusy && (!recent || dk < 2.2)) {
          const side = Math.sign(rp.perp) || 1;
          p.rot = Math.atan2(-obj.nx * side, -obj.nz * side);
          if (m.doSpace(p, o.kind, o.id, {})) { this.lastVault.set(key, this.now); return; }
        }
      } else if (o.kind === 'locker' && dk > 12 && !this.kVis && !p.chase && Math.random() < 0.02) {
        if (m.doSpace(p, 'locker', o.id)) return;
      }
    }

    // lost the killer's line of sight with a lead: sneak away to break the chase
    if (!this.kVis && this.kk && this.now - this.kk.t > 1.0 && dk > 9) {
      const a = this.fleeDir(kx, kz);
      p.input.mx = Math.sin(a);
      p.input.mz = Math.cos(a);
      p.input.sprint = dk < 14;
      p.input.crouch = dk >= 14 && Math.random() < this.cfg.sneak;
      return;
    }
    // killer close: cross a nearby pallet or window to put it between us
    if (dk < 7.5 && this.useLoop(kx, kz, dk)) return;
    this.loop = null;
    const a = this.fleeDir(kx, kz);
    p.input.mx = Math.sin(a);
    p.input.mz = Math.cos(a);
  }

  // Pick a pallet/window within reach that we can get across before the killer.
  useLoop(kx, kz, dk) {
    const p = this.p, m = this.m, k = m.killer;
    if (Math.random() > this.cfg.loopSkill && !this.loop) return false;
    let best = null, bs = -1e9;
    const consider = (type, o) => {
      if ((this.black.get(type + o.id) || 0) > this.now) return;
      const dp = dist(p, o);
      if (dp > 6.5) return;
      const rp = relTo(p, o), rk = relTo({ x: kx, z: kz }, o);
      // only useful if the killer is on our side (we cross, he has to follow)
      if (Math.sign(rp.perp) !== Math.sign(rk.perp) && Math.abs(rp.perp) > 0.6) return;
      const dko = Math.hypot(o.x - kx, o.z - kz);
      if (dko < dp + 1.2) return;
      const ax = o.x - p.x, az = o.z - p.z, bx = kx - p.x, bz = kz - p.z;
      const cos = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) + 1e-6);
      if (cos > 0.35 && dp > 1.5) return;
      let sc = -dp + (dko - dp) * 0.5;
      if (type === 'pallet' && o.state === 'up') sc += 3;
      if (type === 'window') sc += 1.5;
      if (this.loop && this.loop.type === type && this.loop.id === o.id) sc += 2;
      if (sc > bs) { bs = sc; best = { type, id: o.id, o }; }
    };
    for (const pl of m.S.pallets) if (pl.state === 'up' || pl.state === 'down') consider('pallet', pl);
    for (const w of m.S.windows) if (!w.blocked) consider('window', w);
    if (!best) return false;
    if (!this.loop || this.loop.type !== best.type || this.loop.id !== best.id) this.loop = { type: best.type, id: best.id, t0: this.now };
    const o = best.o;
    const rk = relTo({ x: kx, z: kz }, o);
    const s = -(Math.sign(rk.perp) || 1);
    const gx = o.x + o.nx * s * 1.3, gz = o.z + o.nz * s * 1.3;
    // pallets up: run straight through the gap
    if (best.type === 'pallet' && o.state === 'up') {
      const rp = relTo(p, o);
      const tx = -o.nz, tz = o.nx;
      const ex = o.x - o.nx * (Math.sign(rp.perp) || 1) * 1.2 + tx * 0, ez = o.z - o.nz * (Math.sign(rp.perp) || 1) * 1.2;
      const dx = ex - p.x, dz = ez - p.z, d = Math.hypot(dx, dz);
      // line up with the gap first if we are off to the side
      if (Math.abs(rp.lat) > 0.5 && Math.abs(rp.perp) > 0.4) {
        const ax2 = o.x + o.nx * Math.sign(rp.perp) * 0.9 - p.x, az2 = o.z + o.nz * Math.sign(rp.perp) * 0.9 - p.z;
        const d2 = Math.hypot(ax2, az2) || 1;
        p.input.mx = ax2 / d2; p.input.mz = az2 / d2;
        void tx; void tz;
        return true;
      }
      p.input.mx = dx / (d || 1);
      p.input.mz = dz / (d || 1);
      return true;
    }
    this.go(gx, gz, true, { replan: 0.4, tol: 0.4, arrive: 0.2 });
    return true;
  }

  // Best running direction away from the killer, sampled locally every tick.
  fleeDir(kx, kz) {
    const p = this.p, nav = this.m.nav;
    const away = Math.atan2(p.x - kx, p.z - kz);
    const cur = this.fleeHeading ?? away;
    let best = null, bs = -1e9;
    for (let i = 0; i < 24; i++) {
      const a = away + (i / 24) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      let clear = 0;
      for (const r of [1.2, 2.5, 4, 6, 9]) {
        const x = p.x + dx * r, z = p.z + dz * r;
        if (nav.walkable(x, z) && nav.lineFree(p.x, p.z, x, z)) clear = r; else break;
      }
      if (clear < 1.2) continue;
      const fd = Math.hypot(p.x + dx * clear - kx, p.z + dz * clear - kz);
      const s = fd * 0.7 + clear * 0.6 - Math.abs(angDiff(away, a)) * 2.2 - Math.abs(angDiff(cur, a)) * 1.0;
      if (s > bs) { bs = s; best = a; }
    }
    if (best == null) best = away;
    this.fleeHeading = best;
    return best;
  }

  // -------------------------------------------------------------- tasks ----
  chooseTask(dl) {
    const prev = this.task;
    this.pickTask(dl);
    const low = (t) => t && (t.kind === 'repair' || t.kind === 'cleanse' || t.kind === 'chest' || t.kind === 'idle');
    const p = this.p;
    if (prev && p.hold && low(this.task) && low(prev) && p.hold.kind === (prev.kind === 'repair' ? 'repair' : prev.kind) && (this.task.kind !== prev.kind || this.task.id !== prev.id)) {
      this.task = prev;
    }
  }

  pickTask(dl) {
    const p = this.p, m = this.m, S = m.S;
    const k = m.killer;
    const kd = (x, z) => (this.kk && this.now - this.kk.t < 6 ? Math.hypot(this.kk.x - x, this.kk.z - z) : 99);
    const mates = m.survivors().filter((s) => s !== p && m.inPlay(s));
    const myTask = (kind, id) => mates.some((s) => s.brain && s.brain.task && s.brain.task.kind === kind && s.brain.task.id === id && dist(s, p) < 99);

    // being waited on for healing
    if (this.waitFor && this.now < this.waitFor.until) {
      const healer = m.byId(this.waitFor.by);
      if (healer && isUp(healer) && p.health === 'injured' && dl === 0) { this.task = { kind: 'wait' }; return; }
    }
    this.waitFor = null;

    // escape
    const openGate = S.gates.find((g) => g.open);
    if (openGate) {
      const hooked = mates.find((s) => s.health === 'hooked');
      if (!(hooked && this.altruism > 0.85 && kd(hooked.x, hooked.z) > 25)) {
        const g = S.gates.filter((q) => q.open).sort((a, b) => dist(a, p) - dist(b, p))[0];
        this.task = { kind: 'escape', id: g.id };
        return;
      }
    }
    if (S.hatch.state === 'open' && mates.length === 0) { this.task = { kind: 'hatch' }; return; }

    // rescue hooked teammates
    for (const s of mates) {
      if (s.health !== 'hooked' || s.lk) continue;
      const h = S.hooks[s.hookId];
      if (!h) continue;
      const others = mates.filter((o) => o !== s && isUp(o) && o.brain && o.brain.task && o.brain.task.kind === 'unhook' && o.brain.task.id === h.id);
      const humansNear = mates.filter((o) => o !== s && !o.isBot && isUp(o) && dist(o, h) < dist(p, h));
      if (others.length || humansNear.length) continue;
      // only the closest free survivor goes for the save
      const closer = mates.some((o) => o !== s && o.brain && isUp(o) && !o.chase && o.trap == null && o.locker == null && dist(o, h) < dist(p, h) - 2);
      if (closer) continue;
      const safe = kd(h.x, h.z) > 16 || (k && k.carrying != null && kd(h.x, h.z) > 8);
      const travel = dist(p, h) / 3.8;
      const urgent = s.hookStage === 2 || s.hookTime - travel < 32;
      const busyGen = p.hold && p.hold.kind === 'repair' && S.gens[p.hold.id].progress > 0.85 && s.hookTime - travel > 12;
      if (safe && urgent && !busyGen && Math.random() < this.altruism + 0.3) {
        this.task = { kind: 'unhook', id: h.id };
        return;
      }
    }

    // flashlight save
    if (p.item && p.item.type === 'flashlight' && p.item.charges > 2 && k && k.carrying != null && dist(p, k) < 14) {
      this.task = { kind: 'flash' };
      return;
    }

    // pick up dying teammates
    for (const s of mates) {
      if (s.health !== 'dying' || s.carriedBy != null || s.lk) continue;
      if (kd(s.x, s.z) < 16 && !(k && k.carrying != null)) continue;
      if (myTask('heal', s.id)) continue;
      if (dist(p, s) < 40) { this.task = { kind: 'heal', id: s.id }; return; }
    }

    // trapped teammates
    for (const s of mates) {
      if (s.trap == null || !isUp(s)) continue;
      if (kd(s.x, s.z) < 12 || myTask('freetrap', s.id)) continue;
      if (dist(p, s) < 35) { this.task = { kind: 'freetrap', id: s.id }; return; }
    }

    // open the gates
    if (S.gatesPowered) {
      const gates = S.gates.slice().sort((a, b) => Math.hypot(a.sx - p.x, a.sz - p.z) - Math.hypot(b.sx - p.x, b.sz - p.z));
      const g = gates.find((q) => !myTask('gate', q.id)) || gates[0];
      this.task = { kind: 'gate', id: g.id };
      return;
    }

    // healing
    if (p.health === 'injured' && dl === 0) {
      if (p.item && p.item.type === 'medkit' && p.item.charges > 1) { this.task = { kind: 'selfheal', how: 'medkit' }; return; }
      if (p.perks.includes('self_care') && Math.random() < 0.6) { this.task = { kind: 'selfheal', how: 'selfcare' }; return; }
    }
    if (dl === 0) {
      for (const s of mates) {
        if (s.health !== 'injured' || s.chase || s.carriedBy != null || s.trap != null || s.locker != null) continue;
        if (dist(p, s) > 18 || myTask('heal', s.id)) continue;
        if (Math.random() > this.altruism) continue;
        this.task = { kind: 'heal', id: s.id };
        if (s.brain) s.brain.waitFor = { by: p.id, until: this.now + 12 };
        return;
      }
    }

    // hex totems
    const hex = S.totems.find((t) => t.state === 'hex' || t.state === 'noed');
    const hexHunter = hex && !mates.some((o) => o.brain && o.brain.task && o.brain.task.kind === 'cleanse' && o.brain.task.id === hex.id && dist(o, hex) < dist(p, hex));
    if (hex && hexHunter && kd(hex.x, hex.z) > 12 && (dist(p, hex) < 30 || m.time > 60)) {
      this.task = { kind: 'cleanse', id: hex.id };
      return;
    }
    // chests early on
    if (!p.item && m.time < 240) {
      const c = S.chests.find((q) => !q.opened && dist(p, q) < 16 && !myTask('chest', q.id));
      if (c) { this.task = { kind: 'chest', id: c.id }; return; }
    }
    // dull totems nearby
    const dull = S.totems.find((t) => t.state === 'dull' && dist(p, t) < 9 && !myTask('cleanse', t.id));
    if (dull && dl === 0 && Math.random() < 0.15) { this.task = { kind: 'cleanse', id: dull.id }; return; }

    // generators
    let best = null, bs = -1e9;
    for (const g of S.gens) {
      if (g.done || g.blocked) continue;
      const d = dist(p, g);
      const workers = mates.filter((s) => s.hold && s.hold.kind === 'repair' && s.hold.id === g.id).length +
        mates.filter((s) => s.brain && s.brain.task && s.brain.task.kind === 'repair' && s.brain.task.id === g.id && !(s.hold && s.hold.kind === 'repair')).length;
      let s = -d * 0.7 + g.progress * 35;
      if (workers >= 2) s -= 25;
      else if (workers === 1) s += 4;
      if (kd(g.x, g.z) < 18) s -= 40;
      if (this.task && this.task.kind === 'repair' && this.task.id === g.id) s += 12;
      if (s > bs) { bs = s; best = g; }
    }
    if (best) {
      if (!(this.task && this.task.kind === 'repair' && this.task.id === best.id)) this.task = { kind: 'repair', id: best.id, slot: null };
      return;
    }
    this.task = { kind: 'idle' };
  }

  genSlot(g) {
    const p = this.p, m = this.m;
    const b = genBox(g);
    const pts = [
      { x: b.x - b.hw - 0.42, z: b.z }, { x: b.x + b.hw + 0.42, z: b.z },
      { x: b.x, z: b.z - b.hd - 0.42 }, { x: b.x, z: b.z + b.hd + 0.42 },
    ];
    const others = m.survivors().filter((s) => s !== p);
    let best = null, bd = 1e9;
    for (const q of pts) {
      if (!m.world.free(q.x, q.z, 0.3)) continue;
      if (others.some((s) => Math.hypot(s.x - q.x, s.z - q.z) < 0.7 || (s.brain && s.brain.task && s.brain.task.slot && Math.hypot(s.brain.task.slot.x - q.x, s.brain.task.slot.z - q.z) < 0.3))) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  doTask(dt, dl) {
    const p = this.p, m = this.m, S = m.S;
    const t = this.task;
    if (!t) return;
    const runFar = (x, z) => Math.hypot(x - p.x, z - p.z) > 14;
    switch (t.kind) {
      case 'repair': {
        const g = S.gens[t.id];
        if (!g || g.done || g.blocked) { this.task = null; if (p.hold) m.stopHold(p); return; }
        if (p.hold && p.hold.kind === 'repair' && p.hold.id === g.id) return;
        if (!t.slot) t.slot = this.genSlot(g);
        if (!t.slot) { this.task = null; return; }
        if (this.go(t.slot.x, t.slot.z, runFar(t.slot.x, t.slot.z))) {
          if (!m.startHold(p, 'repair', g.id)) t.slot = null;
        }
        return;
      }
      case 'heal': {
        const s = m.byId(t.id);
        if (!s || !(s.health === 'injured' || s.health === 'dying') || s.carriedBy != null || s.health === 'hooked') { this.task = null; if (p.hold) m.stopHold(p); return; }
        if (p.hold && p.hold.kind === 'heal' && p.hold.id === s.id) return;
        const d = dist(p, s);
        if (d < 1.15) { m.startHold(p, 'heal', s.id); return; }
        const ox = (p.x - s.x) / (d || 1), oz = (p.z - s.z) / (d || 1);
        this.go(s.x + ox * 0.8, s.z + oz * 0.8, s.health === 'dying' || runFar(s.x, s.z), { tol: 0.8, replan: 0.8 });
        return;
      }
      case 'freetrap': {
        const s = m.byId(t.id);
        if (!s || s.trap == null) { this.task = null; if (p.hold) m.stopHold(p); return; }
        if (p.hold && p.hold.kind === 'freetrap') return;
        if (dist(p, s) < 1.15) { m.startHold(p, 'freetrap', s.id); return; }
        this.go(s.x, s.z, true, { arrive: 1.0 });
        return;
      }
      case 'unhook': {
        const h = S.hooks[t.id];
        const v = h && h.occupant != null ? m.byId(h.occupant) : null;
        if (!v || v.health !== 'hooked' || v.lk) { this.task = null; return; }
        const fx = h.x + Math.sin(h.rot) * 1.1, fz = h.z + Math.cos(h.rot) * 1.1;
        if (Math.hypot(p.x - h.x, p.z - h.z) < 1.4) { m.startHold(p, 'unhook', h.id); return; }
        this.go(fx, fz, true, { arrive: 0.4 });
        return;
      }
      case 'flash': {
        const k = m.killer;
        if (!k || k.carrying == null || !p.item || p.item.charges <= 0) { p.flashOn = false; this.task = null; return; }
        const d = dist(p, k);
        if (d > 6.5) { p.flashOn = false; this.go(k.x, k.z, true, { tol: 1.5, replan: 0.5 }); return; }
        p.rot = Math.atan2(k.x - p.x, k.z - p.z);
        p.pitch = Math.atan2(0.7, d);
        if (!p.flashOn) m.handleAct(p, { a: 'm2', kind: 'flashlight' });
        return;
      }
      case 'gate': {
        const g = S.gates[t.id];
        if (!g || g.open) { this.task = null; if (p.hold) m.stopHold(p); return; }
        if (p.hold && p.hold.kind === 'gate') return;
        if (Math.hypot(p.x - g.sx, p.z - g.sz) < 1.05) { m.startHold(p, 'gate', g.id); return; }
        // stand on the inside of the switch
        const ix = g.sx - g.nx * 0.75, iz = g.sz - g.nz * 0.75;
        this.go(ix, iz, true, { arrive: 0.3 });
        return;
      }
      case 'escape': {
        const g = S.gates[t.id];
        if (!g || !g.open) { this.task = null; return; }
        this.go(g.x + g.nx * 6.5, g.z + g.nz * 6.5, true, { arrive: 0.6, replan: 2 });
        return;
      }
      case 'hatch': {
        if (S.hatch.state !== 'open') { this.task = null; return; }
        if (Math.hypot(p.x - S.hatch.x, p.z - S.hatch.z) < 1.1) { m.doSpace(p, 'hatch'); return; }
        this.go(S.hatch.x, S.hatch.z, true, { arrive: 0.6 });
        return;
      }
      case 'cleanse': {
        const tt = S.totems[t.id];
        if (!tt || tt.state === 'cleansed') { this.task = null; if (p.hold) m.stopHold(p); return; }
        if (p.hold && p.hold.kind === 'cleanse') return;
        if (dist(p, tt) < 1.1) { m.startHold(p, 'cleanse', tt.id); return; }
        this.go(tt.x, tt.z, runFar(tt.x, tt.z), { arrive: 0.8 });
        return;
      }
      case 'chest': {
        const c = S.chests[t.id];
        if (!c || c.opened) { this.task = null; if (p.hold) m.stopHold(p); return; }
        if (p.hold && p.hold.kind === 'chest') return;
        const fx = c.x + Math.sin(c.rot) * 0.75, fz = c.z + Math.cos(c.rot) * 0.75;
        if (this.go(fx, fz, false, { arrive: 0.3 })) { if (!m.startHold(p, 'chest', c.id)) this.task = null; }
        return;
      }
      case 'selfheal': {
        if (p.health !== 'injured') { this.task = null; if (p.hold) m.stopHold(p); return; }
        if (p.hold) return;
        if (t.how === 'medkit') m.startHold(p, 'medkit', null);
        else m.startHold(p, 'selfcare', null);
        return;
      }
      case 'wait':
        if (p.hold) m.stopHold(p);
        return;
      case 'idle': {
        if (!t.x || Math.hypot(t.x - p.x, t.z - p.z) < 1) {
          const q = m.nav.randomFree(Math.random, -30, 30);
          t.x = q.x; t.z = q.z;
        }
        this.go(t.x, t.z, false);
        return;
      }
    }
  }
}
