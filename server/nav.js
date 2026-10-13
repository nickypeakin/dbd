// Grid navigation (A*) for bots, with links for vaulting windows and pallets.

import { MAP_HALF } from '../shared/constants.js';
import { palletBox, gateBox } from '../shared/collision.js';

const CELL = 0.5;
const HALF = MAP_HALF + 11;
const N = Math.ceil((HALF * 2) / CELL);
const AGENT_R = 0.4;
const SQ2 = Math.SQRT2;

class Heap {
  constructor() { this.items = []; this.keys = []; }
  get size() { return this.items.length; }
  push(item, key) {
    const a = this.items, k = this.keys;
    a.push(item); k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      a[i] = a[p]; k[i] = k[p];
      i = p;
    }
    a[i] = item; k[i] = key;
  }
  pop() {
    const a = this.items, k = this.keys;
    const top = a[0];
    const lastI = a.pop(), lastK = k.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        a[i] = a[c]; k[i] = k[c];
        i = c;
      }
      a[i] = lastI; k[i] = lastK;
    }
    return top;
  }
}

export class NavGrid {
  constructor(map, world) {
    this.map = map;
    this.world = world;
    this.n = N;
    this.static = new Uint8Array(N * N);
    this.dyn = new Uint8Array(N * N);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = -HALF + (i + 0.5) * CELL, z = -HALF + (j + 0.5) * CELL;
        this.static[i * N + j] = world.free(x, z, AGENT_R, (c) => c.k !== 'gatedoor' && c.k !== 'pallet') ? 0 : 1;
      }
    }
    this.links = new Map(); // cell -> [{to, kind, id, x, z, tx, tz}]
    for (const w of map.windows) this._addLink('window', w.id, w, 1.0);
    this.palletLinks = new Map();
    this.g = new Float32Array(N * N);
    this.came = new Int32Array(N * N);
    this.stamp = new Uint32Array(N * N);
    this.closed = new Uint32Array(N * N);
    this.searchId = 0;
    for (const g of map.gates) this.setGate(g, false);
  }

  idx(x, z) {
    const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return i * N + j;
  }
  cx(c) { return -HALF + (Math.floor(c / N) + 0.5) * CELL; }
  cz(c) { return -HALF + ((c % N) + 0.5) * CELL; }
  blocked(c) { return c < 0 || this.static[c] || this.dyn[c]; }
  walkable(x, z) { return !this.blocked(this.idx(x, z)); }

  _addLink(kind, id, o, d) {
    const a = this.nearestFree(o.x + o.nx * d, o.z + o.nz * d, 1.2);
    const b = this.nearestFree(o.x - o.nx * d, o.z - o.nz * d, 1.2);
    if (a < 0 || b < 0) return null;
    const la = { to: b, kind, id, x: this.cx(a), z: this.cz(a) };
    const lb = { to: a, kind, id, x: this.cx(b), z: this.cz(b) };
    if (!this.links.has(a)) this.links.set(a, []);
    if (!this.links.has(b)) this.links.set(b, []);
    this.links.get(a).push(la);
    this.links.get(b).push(lb);
    return [a, la, b, lb];
  }
  _removeLink(rec) {
    if (!rec) return;
    const [a, la, b, lb] = rec;
    const ra = this.links.get(a); if (ra) ra.splice(ra.indexOf(la), 1);
    const rb = this.links.get(b); if (rb) rb.splice(rb.indexOf(lb), 1);
  }

  _markBox(box, delta) {
    const x0 = box.x - box.hw - AGENT_R, x1 = box.x + box.hw + AGENT_R;
    const z0 = box.z - box.hd - AGENT_R, z1 = box.z + box.hd + AGENT_R;
    for (let x = x0; x <= x1 + CELL; x += CELL) {
      for (let z = z0; z <= z1 + CELL; z += CELL) {
        const c = this.idx(Math.min(x, x1), Math.min(z, z1));
        if (c < 0) continue;
        const px = this.cx(c), pz = this.cz(c);
        const dx = Math.max(0, Math.abs(px - box.x) - box.hw), dz = Math.max(0, Math.abs(pz - box.z) - box.hd);
        if (dx * dx + dz * dz < AGENT_R * AGENT_R) this.dyn[c] = Math.max(0, this.dyn[c] + delta);
      }
    }
  }

  setPallet(p, state) {
    const cur = this.palletLinks.get(p.id);
    if (state === 'down' && !cur) {
      this._markBox(palletBox(p), 1);
      this.palletLinks.set(p.id, this._addLink('pallet', p.id, p, 1.0) || true);
    } else if (state !== 'down' && cur) {
      this._markBox(palletBox(p), -1);
      if (cur !== true) this._removeLink(cur);
      this.palletLinks.delete(p.id);
    }
  }

  setGate(g, open) {
    const key = 'gate' + g.id;
    if (!open && !this[key]) { this._markBox(gateBox(g), 1); this[key] = true; }
    if (open && this[key]) { this._markBox(gateBox(g), -1); this[key] = false; }
  }

  nearestFree(x, z, maxR = 3) {
    let c = this.idx(x, z);
    if (c >= 0 && !this.blocked(c)) return c;
    let best = -1, bd = 1e9;
    for (let r = CELL; r <= maxR; r += CELL) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
        c = this.idx(px, pz);
        if (c >= 0 && !this.blocked(c)) {
          const d = Math.hypot(this.cx(c) - x, this.cz(c) - z);
          if (d < bd) { bd = d; best = c; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // Straight-line walkability on the grid.
  lineFree(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(d / (CELL * 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(1, steps);
      if (this.blocked(this.idx(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t))) return false;
    }
    return true;
  }

  // opts: { role, maxNodes, cost(x,z) -> extra, noLinks }
  findPath(sx, sz, tx, tz, opts = {}) {
    const role = opts.role || 'survivor';
    let start = this.nearestFree(sx, sz, 2);
    let goal = this.nearestFree(tx, tz, opts.goalRadius || 3);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: tx, z: tz }];
    const id = ++this.searchId;
    const heap = new Heap();
    const g = this.g, came = this.came, stamp = this.stamp, closed = this.closed;
    const gx = this.cx(goal), gz = this.cz(goal);
    const h = (c) => {
      const dx = Math.abs(this.cx(c) - gx), dz = Math.abs(this.cz(c) - gz);
      return Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz);
    };
    stamp[start] = id; g[start] = 0; came[start] = -1;
    heap.push(start, h(start));
    const maxNodes = opts.maxNodes || 30000;
    let expanded = 0;
    const costFn = opts.cost;
    const linkCost = {
      window: role === 'killer' ? 14 : 2.0,
      pallet: role === 'killer' ? 13 : 2.0,
    };
    let found = false;
    while (heap.size) {
      const c = heap.pop();
      if (closed[c] === id) continue;
      closed[c] = id;
      if (c === goal) { found = true; break; }
      if (++expanded > maxNodes) break;
      const ci = Math.floor(c / N), cj = c % N;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nc = ni * N + nj;
          if (this.static[nc] || this.dyn[nc]) continue;
          if (di && dj && (this.blocked(ci * N + nj) || this.blocked(ni * N + cj))) continue;
          let cost = (di && dj ? SQ2 : 1) * CELL;
          if (costFn) cost += costFn(this.cx(nc), this.cz(nc)) * CELL;
          const ng = g[c] + cost;
          if (stamp[nc] !== id || ng < g[nc]) {
            stamp[nc] = id; g[nc] = ng; came[nc] = c;
            heap.push(nc, ng + h(nc));
          }
        }
      }
      if (!opts.noLinks) {
        const ls = this.links.get(c);
        if (ls) {
          for (const l of ls) {
            if (opts.blockedLink && opts.blockedLink(l)) continue;
            const ng = g[c] + linkCost[l.kind];
            if (stamp[l.to] !== id || ng < g[l.to]) {
              stamp[l.to] = id; g[l.to] = ng; came[l.to] = -2 - c; // negative => via link
              heap.push(l.to, ng + h(l.to));
            }
          }
        }
      }
    }
    if (!found) return null;
    // reconstruct
    const cells = [];
    let c = goal;
    while (c !== start && c >= 0) {
      const prev = came[c];
      if (prev <= -2) {
        const from = -2 - prev;
        const l = (this.links.get(from) || []).find((q) => q.to === c);
        cells.push({ c, link: l || null });
        c = from;
      } else {
        cells.push({ c, link: null });
        c = prev;
      }
    }
    cells.reverse();
    // waypoints with link markers: a link step is "from previous waypoint, perform link to reach this"
    const pts = [];
    let px = sx, pz = sz;
    let anchorX = sx, anchorZ = sz;
    let lastFreeX = sx, lastFreeZ = sz;
    for (let i = 0; i < cells.length; i++) {
      const { c: cell, link } = cells[i];
      const x = this.cx(cell), z = this.cz(cell);
      if (link) {
        // make sure we stand at the link start
        const fx = link.x, fz = link.z;
        if (lastFreeX !== anchorX || lastFreeZ !== anchorZ) pts.push({ x: lastFreeX, z: lastFreeZ });
        pts.push({ x: fx, z: fz, link: { kind: link.kind, id: link.id } });
        anchorX = x; anchorZ = z;
        lastFreeX = x; lastFreeZ = z;
        pts.push({ x, z });
        continue;
      }
      if (!this.lineFree(anchorX, anchorZ, x, z)) {
        pts.push({ x: lastFreeX, z: lastFreeZ });
        anchorX = lastFreeX; anchorZ = lastFreeZ;
      }
      lastFreeX = x; lastFreeZ = z;
      px = x; pz = z;
    }
    pts.push({ x: tx, z: tz });
    // collapse duplicates
    const out = [];
    for (const p of pts) {
      const l = out[out.length - 1];
      if (l && Math.hypot(l.x - p.x, l.z - p.z) < 0.05 && !p.link) continue;
      out.push(p);
    }
    if (!this.walkable(tx, tz) && out.length > 1) {
      const last = out[out.length - 1];
      last.x = gx; last.z = gz;
    }
    return out;
  }

  pathLength(path, sx, sz) {
    if (!path) return Infinity;
    let L = 0, x = sx, z = sz;
    for (const p of path) { L += Math.hypot(p.x - x, p.z - z); x = p.x; z = p.z; }
    return L;
  }

  randomFree(rng, x0 = -MAP_HALF + 3, x1 = MAP_HALF - 3) {
    for (let i = 0; i < 50; i++) {
      const x = x0 + rng() * (x1 - x0), z = x0 + rng() * (x1 - x0);
      if (this.walkable(x, z)) return { x, z };
    }
    return { x: 0, z: 0 };
  }
}
