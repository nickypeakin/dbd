// Shared helpers for bot movement: path following with stuck recovery.

export class Mover {
  constructor(match, p) {
    this.m = match;
    this.p = p;
    this.path = null;
    this.idx = 0;
    this.goal = null;
    this.replanT = 0;
    this.stuckT = 0;
    this.stuckN = 0;
    this.lastX = p.x;
    this.lastZ = p.z;
    this.jiggle = 0;
    this.jx = 0;
    this.jz = 0;
  }

  clear() {
    this.path = null;
    this.goal = null;
  }

  // opts: {tol, replan, cost, force, goalRadius, blockedLink}
  setGoal(x, z, opts = {}) {
    const p = this.p;
    const need = !this.goal || !this.path || opts.force || this.replanT <= 0 ||
      Math.hypot(this.goal.x - x, this.goal.z - z) > (opts.tol ?? 1.0);
    if (!need) return !!this.path;
    this.goal = { x, z };
    this.replanT = opts.replan ?? 1.2;
    this.path = this.m.nav.findPath(p.x, p.z, x, z, {
      role: p.role, cost: opts.cost, goalRadius: opts.goalRadius, blockedLink: opts.blockedLink,
      maxNodes: opts.maxNodes || 25000,
    });
    this.idx = 0;
    return !!this.path;
  }

  remaining() {
    if (!this.path) return Infinity;
    let L = 0, x = this.p.x, z = this.p.z;
    for (let i = this.idx; i < this.path.length; i++) {
      const w = this.path[i];
      L += Math.hypot(w.x - x, w.z - z);
      x = w.x; z = w.z;
    }
    return L;
  }

  // Returns {mx, mz, link, arrived}
  update(dt, arriveDist = 0.45) {
    const p = this.p;
    this.replanT -= dt;
    const out = { mx: 0, mz: 0, link: null, arrived: false };
    if (!this.path || !this.goal) { out.arrived = true; return out; }
    // stuck detection
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x; this.lastZ = p.z;
    if (this.jiggle > 0) {
      this.jiggle -= dt;
      out.mx = this.jx; out.mz = this.jz;
      return out;
    }
    let guard = 0;
    while (this.idx < this.path.length && guard++ < 8) {
      const w = this.path[this.idx];
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      const last = this.idx === this.path.length - 1;
      if (w.link) {
        if (d < 0.75) { out.link = w.link; this.idx++; return out; }
        break;
      }
      if (d < (last ? arriveDist : 0.5)) { this.idx++; continue; }
      // look-ahead shortcut
      const nxt = this.path[this.idx + 1];
      if (nxt && !nxt.link && this.m.nav.lineFree(p.x, p.z, nxt.x, nxt.z) && d < 2.5) { this.idx++; continue; }
      break;
    }
    if (this.idx >= this.path.length) { out.arrived = true; return out; }
    const w = this.path[this.idx];
    const dx = w.x - p.x, dz = w.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) { out.mx = dx / d; out.mz = dz / d; }
    if (moved < 0.02 && d > 0.3) {
      this.stuckT += dt;
      if (this.stuckT > 0.7) {
        this.stuckT = 0;
        this.stuckN++;
        if (this.stuckN >= 2) {
          const a = Math.random() * Math.PI * 2;
          this.jx = Math.cos(a); this.jz = Math.sin(a);
          this.jiggle = 0.35;
          this.stuckN = 0;
        }
        if (this.goal) this.setGoal(this.goal.x, this.goal.z, { force: true });
      }
    } else {
      this.stuckT = Math.max(0, this.stuckT - dt);
    }
    return out;
  }
}

export function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

export function segRectHit(x1, z1, x2, z2, r) {
  // slab test against an axis-aligned rect {x,z,w,d}
  const minX = r.x - r.w / 2, maxX = r.x + r.w / 2, minZ = r.z - r.d / 2, maxZ = r.z + r.d / 2;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dz = z2 - z1;
  for (const [p, d, mn, mx] of [[x1, dx, minX, maxX], [z1, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) { if (p < mn || p > mx) return false; continue; }
    let a = (mn - p) / d, b = (mx - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

// Does vegetation (corn) hide b from a?
export function vegBlocks(map, a, b) {
  if (!map.veg.length) return false;
  if (Math.hypot(a.x - b.x, a.z - b.z) < 3) return false;
  for (const v of map.veg) {
    if (segRectHit(a.x, a.z, b.x, b.z, v)) {
      // only blocks if the target is inside or behind the patch
      return true;
    }
  }
  return false;
}
