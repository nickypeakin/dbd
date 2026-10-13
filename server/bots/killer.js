// Killer bot: patrols generators, investigates noises, chases and hits
// survivors, breaks pallets, uses its power, and hooks downed survivors.

import { Mover, dist, vegBlocks } from './common.js';
import { killerOptions, relTo, isUp, angDiff } from '../../shared/interact.js';
import { genBox } from '../../shared/collision.js';
import { KILL, RANGE } from '../../shared/constants.js';
import { turnToward } from '../../shared/motor.js';

const DIFF = {
  easy: { memory: 3.5, react: 1.0, fov: 0.85, sight: 22, lungeAt: 2.0, hesitate: 0.25, power: 0.35, hear: 7, aimErr: 0.12, genHear: 14, whiff: 0.45 },
  normal: { memory: 5, react: 0.6, fov: 0.95, sight: 27, lungeAt: 2.4, hesitate: 0.45, power: 0.7, hear: 10, aimErr: 0.06, genHear: 20, whiff: 0.3 },
  hard: { memory: 7, react: 0.3, fov: 1.15, sight: 34, lungeAt: 2.65, hesitate: 0.6, power: 0.95, hear: 13, aimErr: 0.025, genHear: 28, whiff: 0.12 },
};

export class KillerBot {
  constructor(m, p, diff) {
    this.m = m;
    this.p = p;
    this.cfg = DIFF[diff] || DIFF.normal;
    this.mv = new Mover(m, p);
    this.target = null;
    this.mem = new Map(); // survivor id -> {x, z, t, vx, vz}
    this.noises = [];
    this.patrol = null;
    this.visited = new Map();
    this.seenSince = new Map();
    this.hesitateT = 0;
    this.powerT = 0;
    this.thinkT = 0;
    this.searchLocker = null;
    this.trapCd = 10 + Math.random() * 10;
    this.revStart = 0;
  }

  get now() { return this.m.time; }

  onNoise(x, z, why) { this.noises.push({ x, z, t: this.now, why }); if (this.noises.length > 6) this.noises.shift(); }
  onReveal(ids) {
    for (const id of ids) {
      const s = this.m.byId(id);
      if (s) this.mem.set(id, { x: s.x, z: s.z, t: this.now, vx: 0, vz: 0, revealed: true });
    }
  }
  onGenDone(g) { this.onNoise(g.x, g.z, 'gendone'); }

  // ------------------------------------------------------------ perception --
  canSee(s) {
    const p = this.p, m = this.m;
    if (!m.inPlay(s) || s.locker != null || s.carriedBy != null || s.health === 'hooked') return false;
    const d = dist(p, s);
    if (d > this.cfg.sight) return false;
    const eye = s.health === 'dying' ? 0.5 : s.crouch ? 0.85 : 1.3;
    if (!m.world.clearLine(p.x, p.z, s.x, s.z, eye)) return false;
    if (vegBlocks(m.map, p, s)) return false;
    const a = Math.abs(angDiff(p.rot, Math.atan2(s.x - p.x, s.z - p.z)));
    if (a > this.cfg.fov && d > 4) return false;
    if (s.crouch && !s.moving && d > 14) return false;
    return true;
  }

  perceive(dt) {
    const p = this.p, m = this.m;
    for (const s of m.survivors()) {
      if (!m.inPlay(s)) { this.mem.delete(s.id); continue; }
      let known = false;
      if (this.canSee(s)) {
        const since = this.seenSince.get(s.id) ?? this.now;
        this.seenSince.set(s.id, since);
        known = this.now - since >= this.cfg.react || (this.target === s.id);
      } else this.seenSince.delete(s.id);
      const d = dist(p, s);
      // hearing: injured grunts, running footsteps nearby, generator repairs
      if (!known && s.locker == null && s.health !== 'hooked' && s.carriedBy == null) {
        if (s.health === 'injured' && !s.perks.includes('iron_will') && d < this.cfg.hear) known = true;
        if (s.sprint && s.moving && d < this.cfg.hear * 0.8) known = true;
        if (s.health === 'dying' && d < 10) known = true;
      }
      if (known) {
        const prev = this.mem.get(s.id);
        let vx = 0, vz = 0;
        if (prev && this.now - prev.t < 0.5) {
          const dtt = Math.max(0.03, this.now - prev.t);
          vx = (s.x - prev.x) / dtt; vz = (s.z - prev.z) / dtt;
          vx = prev.vx * 0.6 + vx * 0.4; vz = prev.vz * 0.6 + vz * 0.4;
        }
        this.mem.set(s.id, { x: s.x, z: s.z, t: this.now, vx, vz });
      }
    }
  }

  setInput(st, run = true) {
    const p = this.p;
    p.input.mx = st.mx;
    p.input.mz = st.mz;
    if (st.mx || st.mz) {
      const want = Math.atan2(st.mx, st.mz);
      p.rot = turnToward(p.rot, want, this.dt * 7);
    }
  }

  go(x, z, opts = {}) {
    const p = this.p;
    this.mv.setGoal(x, z, { tol: opts.tol ?? 1.0, replan: opts.replan ?? 1.2, goalRadius: opts.goalRadius });
    const st = this.mv.update(this.dt, opts.arrive ?? 0.6);
    if (st.link) {
      if (st.link.kind === 'window') this.m.doSpace(p, 'kvault', st.link.id);
      else this.m.doSpace(p, 'break', st.link.id);
      return false;
    }
    this.setInput(st);
    return st.arrived || Math.hypot(p.x - x, p.z - z) < (opts.arrive ?? 0.6);
  }

  // ----------------------------------------------------------------- update --
  update(dt) {
    const p = this.p, m = this.m;
    this.dt = dt;
    p.input = { mx: 0, mz: 0, sprint: false, crouch: false };
    this.perceive(dt);
    if (p.lock) return;
    if (p.blindT > 0) {
      // stumble forward
      p.input.mx = Math.sin(p.rot) * 0.4;
      p.input.mz = Math.cos(p.rot) * 0.4;
      return;
    }

    // Carrying: go hook
    if (p.carrying != null) return this.carry();

    // Hillbilly mid-saw: steer at target
    if (p.pw === 'saw') return this.sawSteer();
    if (p.pw === 'wind') return this.windUp();

    // Close the hatch
    if (m.S.hatch.state === 'open' && dist(p, m.S.hatch) < 30 && !this.chaseTarget()) {
      if (dist(p, m.S.hatch) < 1.1) { m.doSpace(p, 'closehatch'); return; }
      this.go(m.S.hatch.x, m.S.hatch.z, { arrive: 0.6 });
      return;
    }

    // Downed or trapped survivors: pick them up
    const down = this.downedTarget();
    const chase = this.chaseTarget();
    if (down && (!chase || dist(p, down) < 8 || chase.health === 'dying')) return this.pickUp(down);
    if (chase) return this.chase(chase);
    this.hesitateT = 0;
    if (this.p.pw === 'rev') m.powerRelease(p, {});

    // Wraith: cloak while patrolling
    if (p.char === 'wraith' && !p.pw && Math.random() < dt * this.cfg.power) m.powerPress(p, {});

    // Trapper: collect and set traps
    if (p.char === 'trapper' && this.trapper()) return;

    // Locker search near where we lost someone
    if (this.searchLocker) {
      const l = m.S.lockers[this.searchLocker.id];
      if (!l || this.now > this.searchLocker.until) this.searchLocker = null;
      else {
        const fx = l.x + Math.sin(l.rot) * 1.0, fz = l.z + Math.cos(l.rot) * 1.0;
        if (Math.hypot(p.x - fx, p.z - fz) < 0.6) {
          p.rot = Math.atan2(l.x - p.x, l.z - p.z);
          m.doSpace(p, p.char === 'huntress' && p.ammo < 5 ? 'reload' : 'search', l.id);
          this.searchLocker = null;
          return;
        }
        this.go(fx, fz, { arrive: 0.4 });
        return;
      }
    }

    // Huntress reload
    if (p.char === 'huntress' && p.ammo <= 1) {
      const l = m.S.lockers.slice().sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (l && dist(l, p) < 30) { this.searchLocker = { id: l.id, until: this.now + 20 }; return; }
    }

    // Investigate noises
    const n = this.noises.filter((q) => this.now - q.t < 12 && Math.hypot(q.x - p.x, q.z - p.z) < 60).pop();
    if (n) {
      if (this.go(n.x, n.z, { arrive: 2.0 })) this.noises = this.noises.filter((q) => q !== n);
      this.kickNearby();
      return;
    }

    this.doPatrol();
  }

  chaseTarget() {
    const m = this.m;
    let best = null, bs = -1e9;
    for (const [id, mem] of this.mem) {
      const s = m.byId(id);
      if (!s || !m.inPlay(s) || !isUp(s) || s.locker != null || s.trap != null) continue;
      const age = this.now - mem.t;
      if (age > (id === this.target ? this.cfg.memory : 2.5)) continue;
      let sc = -dist(this.p, mem) - age * 3;
      if (s.health === 'injured') sc += 6;
      if (id === this.target) sc += 12;
      if (sc > bs) { bs = sc; best = s; }
    }
    this.target = best ? best.id : null;
    return best;
  }

  downedTarget() {
    const m = this.m, p = this.p;
    let best = null, bd = 1e9;
    for (const s of m.survivors()) {
      if (!m.inPlay(s) || s.carriedBy != null || s.lk) continue;
      if (s.health !== 'dying' && s.trap == null) continue;
      const mem = this.mem.get(s.id);
      const d = dist(p, s);
      if ((!mem || this.now - mem.t > 15) && d > 12) continue;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  pickUp(s) {
    const p = this.p, m = this.m;
    if (p.pw === 'cloaked') { m.powerPress(p, {}); }
    const d = dist(p, s);
    if (d < RANGE.PICKUP * 0.9) {
      p.rot = Math.atan2(s.x - p.x, s.z - p.z);
      if (p.pw === 'cloaking' || p.pw === 'uncloaking' || p.pw === 'cloaked') return;
      m.doSpace(p, 'pickup', s.id);
      return;
    }
    this.go(s.x, s.z, { arrive: 1.0, tol: 0.8, replan: 0.6 });
  }

  carry() {
    const p = this.p, m = this.m;
    if (!this.hook || m.S.hooks[this.hook].occupant != null || this.now > this.hookReplan) {
      this.hookReplan = this.now + 3;
      const cands = m.S.hooks.filter((h) => h.occupant == null).sort((a, b) => dist(a, p) - dist(b, p)).slice(0, 4);
      let best = null, bl = Infinity;
      for (const h of cands) {
        const path = m.nav.findPath(p.x, p.z, h.x, h.z, { role: 'killer', goalRadius: 1.5, maxNodes: 15000 });
        const L = m.nav.pathLength(path, p.x, p.z);
        if (L < bl) { bl = L; best = h; }
      }
      this.hook = best ? best.id : null;
      this.mv.clear();
    }
    if (this.hook == null) {
      m.dropSurvivor(p, false);
      return;
    }
    const h = m.S.hooks[this.hook];
    if (dist(p, h) < RANGE.HOOK * 0.85) {
      m.doSpace(p, 'hook', h.id);
      this.hook = null;
      return;
    }
    this.go(h.x, h.z, { arrive: 1.2, goalRadius: 2 });
  }

  chase(s) {
    const p = this.p, m = this.m;
    const mem = this.mem.get(s.id);
    const age = this.now - mem.t;
    const d = dist(p, s);
    const visible = age < 0.2;
    // Wraith uncloaks when close
    if (p.char === 'wraith' && p.pw === 'cloaked' && d < 9) m.powerPress(p, {});
    // predicted position
    const lead = Math.min(0.6, d / 8);
    let tx = mem.x + mem.vx * lead, tz = mem.z + mem.vz * lead;
    if (!visible) { tx = mem.x + mem.vx * Math.min(age, 2); tz = mem.z + mem.vz * Math.min(age, 2); }

    // lost the target: maybe search lockers
    if (age > 3 && Math.hypot(p.x - tx, p.z - tz) < 3) {
      const l = m.S.lockers.find((q) => Math.hypot(q.x - mem.x, q.z - mem.z) < 6 && q.occ != null);
      const any = m.S.lockers.find((q) => Math.hypot(q.x - mem.x, q.z - mem.z) < 6);
      if ((l && Math.random() < 0.6) || (any && Math.random() < 0.15)) this.searchLocker = { id: (l || any).id, until: this.now + 10 };
      this.mem.delete(s.id);
      return;
    }

    // powers
    if (visible && this.usePower(s, d)) return;

    // pallet respect: survivor waiting at a standing pallet on the other side
    if (visible && d < 4.5 && this.hesitateT <= 0) {
      for (const pl of m.S.pallets) {
        if (pl.state !== 'up' || dist(pl, s) > 1.6) continue;
        const rs = relTo(s, pl), rk = relTo(p, pl);
        if (Math.sign(rs.perp) !== Math.sign(rk.perp) && Math.abs(rk.perp) < 3.2 && Math.random() < this.cfg.hesitate) {
          this.hesitateT = 0.8 + Math.random() * 0.6;
          this.hesitateUntil = this.now + this.hesitateT;
        }
      }
    }
    if (this.hesitateUntil && this.now < this.hesitateUntil) {
      // walk sideways around the loop instead of through the pallet
      const a = Math.atan2(s.x - p.x, s.z - p.z) + Math.PI / 2;
      p.input.mx = Math.sin(a) * 0.6;
      p.input.mz = Math.cos(a) * 0.6;
      p.rot = turnToward(p.rot, Math.atan2(s.x - p.x, s.z - p.z), this.dt * 8);
      return;
    }
    this.hesitateT = Math.max(0, this.hesitateT - this.dt);

    // attack
    if (visible && !p.atk && this.m.powerAllowsAttack(p)) {
      const want = Math.atan2(tx - p.x, tz - p.z);
      if (this.lungeAt == null) this.lungeAt = this.cfg.lungeAt + (Math.random() - 0.35) * 1.0;
      if (d < this.lungeAt + (s.moving ? 0.0 : 0.6) && Math.abs(angDiff(p.rot, want)) < 0.6 &&
          m.world.clearLine(p.x, p.z, s.x, s.z, 1.0)) {
        p.rot = want;
        m.startAttack(p, Math.min(KILL.LUNGE_MAX, 0.2 + d * 0.15));
        // imperfect aim: some swings whiff (the survivor "juked")
        p.whiff = Math.random() < this.cfg.whiff;
        this.lungeAt = null;
      }
    }
    if (p.atk === 'lunge' || (visible && d < 4)) {
      // run straight at the target when close
      const want = Math.atan2(tx - p.x, tz - p.z);
      p.rot = turnToward(p.rot, want, this.dt * 9);
      if (m.nav.lineFree(p.x, p.z, tx, tz) || p.atk === 'lunge') {
        p.input.mx = Math.sin(p.rot);
        p.input.mz = Math.cos(p.rot);
        return;
      }
    }
    // dropped pallet right in front: break it
    const opts = killerOptions(p, m.S, p.rot, 1);
    if (opts.space && opts.space.kind === 'break') {
      const pl = m.S.pallets[opts.space.id];
      const rs = relTo(s, pl), rk = relTo(p, pl);
      if (Math.sign(rs.perp) !== Math.sign(rk.perp) || Math.random() < 0.02) { m.doSpace(p, 'break', pl.id); return; }
    }
    this.go(tx, tz, { tol: 0.7, replan: visible ? 0.3 : 0.8, arrive: 0.3 });
  }

  usePower(s, d) {
    const p = this.p, m = this.m;
    if (Math.random() > this.cfg.power * 0.25 && p.pw !== 'rev') return false;
    if (p.char === 'hillbilly') {
      const clear = m.world.clearLine(p.x, p.z, s.x, s.z, 0.5, 0.45) && m.nav.lineFree(p.x, p.z, s.x, s.z);
      if (p.pw === 'rev') {
        if (!clear || d < 3) { m.powerRelease(p, {}); return false; }
        p.rot = turnToward(p.rot, Math.atan2(s.x - p.x, s.z - p.z), this.dt * 4);
        p.input.mx = Math.sin(p.rot) * 0.5;
        p.input.mz = Math.cos(p.rot) * 0.5;
        return true;
      }
      if (!p.pw && !p.atk && clear && d > 7 && d < 24 && this.now > this.powerT) {
        this.powerT = this.now + 4;
        m.powerPress(p, {});
        return true;
      }
    } else if (p.char === 'huntress') {
      if (!p.pw && !p.atk && p.ammo > 0 && d > 5 && d < 28 && this.now > this.powerT &&
          m.world.clearLine(p.x, p.z, s.x, s.z, 1.0, 0.1)) {
        this.powerT = this.now + 2.5;
        this.windTarget = s.id;
        this.windFor = 0.35 + Math.min(0.9, d / 30);
        m.powerPress(p, {});
        return true;
      }
    }
    return false;
  }

  windUp() {
    const p = this.p, m = this.m;
    const s = m.byId(this.windTarget);
    if (!s || !m.inPlay(s) || !isUp(s)) { m.powerRelease(p, { power: 0 }); p.pw = null; return; }
    const d = dist(p, s);
    const power = Math.min(1, Math.max(0, (p.pwT - 0.25) / 1.0));
    const speed = 20 + 20 * power;
    const tFlight = d / speed;
    const mem = this.mem.get(s.id) || { vx: 0, vz: 0 };
    const tx = s.x + mem.vx * tFlight, tz = s.z + mem.vz * tFlight;
    const yaw = Math.atan2(tx - p.x, tz - p.z) + (Math.random() - 0.5) * this.cfg.aimErr;
    p.rot = turnToward(p.rot, yaw, this.dt * 6);
    // keep following slowly
    p.input.mx = Math.sin(p.rot) * 0.6;
    p.input.mz = Math.cos(p.rot) * 0.6;
    if (p.pwT >= this.windFor) {
      const dd = Math.hypot(tx - p.x, tz - p.z);
      const g = 9.8;
      const v = speed;
      const dy = 1.0 - (KILL.EYE - 0.25);
      // solve for launch pitch (low arc)
      const v2 = v * v;
      const root = v2 * v2 - g * (g * dd * dd + 2 * dy * v2);
      let pitch = root >= 0 ? Math.atan((v2 - Math.sqrt(root)) / (g * dd)) : 0.2;
      pitch -= 1.0 / v; // compensate the small upward kick on release
      m.powerRelease(p, { yaw, pitch: pitch + (Math.random() - 0.5) * this.cfg.aimErr, power });
    }
  }

  sawSteer() {
    const p = this.p, m = this.m;
    const s = this.target ? m.byId(this.target) : null;
    if (s && m.inPlay(s) && isUp(s)) {
      const want = Math.atan2(s.x - p.x, s.z - p.z);
      p.rot = turnToward(p.rot, want, this.dt * 1.6);
      const ahead = Math.cos(angDiff(p.rot, want));
      if (ahead < 0 || dist(p, s) > 30) m.powerRelease(p, {});
    } else m.powerRelease(p, {});
    p.input.mx = Math.sin(p.rot);
    p.input.mz = Math.cos(p.rot);
  }

  trapper() {
    const p = this.p, m = this.m;
    // pick up traps lying around
    if (p.ammo < 2) {
      const t = m.S.traps.filter((q) => q.state === 'ground').sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (t && dist(t, p) < 14) {
        if (dist(t, p) < 1.0) { m.doSpace(p, 'taketrap', t.id); return true; }
        this.go(t.x, t.z, { arrive: 0.7 });
        return true;
      }
    }
    this.trapCd -= this.dt;
    if (p.ammo > 0 && this.trapCd <= 0) {
      if (!this.trapSpot) {
        const spots = m.map.trapSpots.filter((q) => !m.S.traps.some((t) => Math.hypot(t.x - q.x, t.z - q.z) < 3) && Math.hypot(q.x - p.x, q.z - p.z) < 25);
        this.trapSpot = spots[Math.floor(Math.random() * spots.length)] || null;
        if (!this.trapSpot) { this.trapCd = 8; return false; }
      }
      const q = this.trapSpot;
      if (Math.hypot(q.x - p.x, q.z - p.z) < 0.6) {
        m.powerPress(p, {});
        this.trapSpot = null;
        this.trapCd = 20 + Math.random() * 20;
        return true;
      }
      this.go(q.x, q.z, { arrive: 0.4 });
      return true;
    }
    return false;
  }

  kickNearby() {
    const p = this.p, m = this.m;
    const opts = killerOptions(p, m.S, p.rot, 1);
    if (opts.space && opts.space.kind === 'kick') {
      const g = m.S.gens[opts.space.id];
      if (g.progress > 0.12) {
        p.rot = Math.atan2(g.x - p.x, g.z - p.z);
        m.doSpace(p, 'kick', g.id);
        return true;
      }
    }
    return false;
  }

  doPatrol() {
    const p = this.p, m = this.m, S = m.S;
    if (this.kickNearby()) return;
    if (!this.patrol || this.now > this.patrol.until) {
      let best = null, bs = -1e9;
      if (S.gatesPowered) {
        for (const g of S.gates) {
          const s = -dist(g, p) * 0.2 + g.progress * 60 + Math.random() * 15 - ((this.visited.get('g' + g.id) || -99) > this.now - 20 ? 10 : 0);
          if (s > bs) { bs = s; best = { x: g.sx - g.nx * 1.5, z: g.sz - g.nz * 1.5, key: 'g' + g.id }; }
        }
      } else {
        for (const g of S.gens) {
          if (g.done) continue;
          const d = dist(g, p);
          const repaired = m.survivors().some((s) => s.hold && s.hold.kind === 'repair' && s.hold.id === g.id) && d < this.cfg.genHear;
          const recent = (this.visited.get('n' + g.id) || -99) > this.now - 25;
          const s = g.progress * 40 + (repaired ? 35 : 0) - d * 0.45 + Math.random() * 12 - (recent ? 30 : 0);
          if (s > bs) {
            bs = s;
            const b = genBox(g);
            best = { x: g.x + (p.x > g.x ? b.hw + 0.8 : -b.hw - 0.8), z: g.z, key: 'n' + g.id };
          }
        }
      }
      if (!best) {
        const q = m.nav.randomFree(Math.random, -35, 35);
        best = { x: q.x, z: q.z, key: 'r' };
      }
      this.patrol = { ...best, until: this.now + 25 };
    }
    if (this.go(this.patrol.x, this.patrol.z, { arrive: 1.0, replan: 2 })) {
      this.visited.set(this.patrol.key, this.now);
      this.patrol.until = Math.min(this.patrol.until, this.now + 1.5);
      p.rot += this.dt * 2.0;
    }
  }
}
