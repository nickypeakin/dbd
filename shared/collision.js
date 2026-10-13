// 2D collision world (top-down XZ plane) shared by the server simulation, the
// bots and the client's own-player movement. Colliders are axis-aligned boxes
// or circles with a height used for line-of-sight tests.

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export function distToBox(px, pz, b) {
  const cx = clamp(px, b.x - b.hw, b.x + b.hw);
  const cz = clamp(pz, b.z - b.hd, b.z + b.hd);
  return Math.hypot(px - cx, pz - cz);
}

export class CollisionWorld {
  constructor(half = 64, cell = 4) {
    this.half = half;
    this.cell = cell;
    this.n = Math.ceil((half * 2) / cell);
    this.cells = Array.from({ length: this.n * this.n }, () => []);
    this.stamp = 1;
    this.all = new Set();
  }

  _ix(v) { return clamp(Math.floor((v + this.half) / this.cell), 0, this.n - 1); }

  _bounds(c) {
    if (c.r !== undefined) return [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r];
    return [c.x - c.hw, c.z - c.hd, c.x + c.hw, c.z + c.hd];
  }

  add(c) {
    if (c._cells) return c;
    const [x0, z0, x1, z1] = this._bounds(c);
    c._cells = [];
    c._q = 0;
    for (let ix = this._ix(x0); ix <= this._ix(x1); ix++) {
      for (let iz = this._ix(z0); iz <= this._ix(z1); iz++) {
        const idx = ix * this.n + iz;
        this.cells[idx].push(c);
        c._cells.push(idx);
      }
    }
    this.all.add(c);
    return c;
  }

  remove(c) {
    if (!c || !c._cells) return;
    for (const idx of c._cells) {
      const arr = this.cells[idx];
      const i = arr.indexOf(c);
      if (i >= 0) arr.splice(i, 1);
    }
    c._cells = null;
    this.all.delete(c);
  }

  // Calls fn(collider) once for each collider overlapping the rectangle.
  query(x0, z0, x1, z1, fn) {
    const s = ++this.stamp;
    const ax = this._ix(x0), bx = this._ix(x1), az = this._ix(z0), bz = this._ix(z1);
    for (let ix = ax; ix <= bx; ix++) {
      for (let iz = az; iz <= bz; iz++) {
        const arr = this.cells[ix * this.n + iz];
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (c._q === s) continue;
          c._q = s;
          if (fn(c) === false) return;
        }
      }
    }
  }

  // Pushes a circle out of all overlapping colliders. Returns true if it touched something.
  resolve(pos, r, filter, extra) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const fn = (c) => {
        if (filter && !filter(c)) return;
        if (c.r !== undefined) {
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const rr = r + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) return;
          const d = Math.sqrt(d2);
          if (d > 1e-6) {
            pos.x = c.x + (dx / d) * rr;
            pos.z = c.z + (dz / d) * rr;
          } else {
            pos.x = c.x + rr;
          }
          moved = hit = true;
        } else {
          const minX = c.x - c.hw, maxX = c.x + c.hw, minZ = c.z - c.hd, maxZ = c.z + c.hd;
          const cx = clamp(pos.x, minX, maxX), cz = clamp(pos.z, minZ, maxZ);
          const dx = pos.x - cx, dz = pos.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) return;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            pos.x = cx + (dx / d) * r;
            pos.z = cz + (dz / d) * r;
          } else {
            // centre inside the box: push out along the axis of least penetration
            const l = pos.x - minX, rgt = maxX - pos.x, b = pos.z - minZ, t = maxZ - pos.z;
            const m = Math.min(l, rgt, b, t);
            if (m === l) pos.x = minX - r;
            else if (m === rgt) pos.x = maxX + r;
            else if (m === b) pos.z = minZ - r;
            else pos.z = maxZ + r;
          }
          moved = hit = true;
        }
      };
      this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, fn);
      if (extra) for (const c of extra) fn(c);
      if (!moved) break;
    }
    return hit;
  }

  // Moves a circle by (dx, dz) with sliding. Returns {x, z, hit}.
  move(x, z, r, dx, dz, filter, extra) {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
    const pos = { x, z, hit: false };
    for (let i = 0; i < steps; i++) {
      pos.x += dx / steps;
      pos.z += dz / steps;
      if (this.resolve(pos, r, filter, extra)) pos.hit = true;
    }
    return pos;
  }

  // Maximum penetration depth of a circle into colliders (0 if free).
  penetration(x, z, r, filter) {
    let worst = 0;
    this.query(x - r, z - r, x + r, z + r, (c) => {
      if (filter && !filter(c)) return;
      let d;
      if (c.r !== undefined) d = c.r + r - Math.hypot(x - c.x, z - c.z);
      else {
        const inside = x > c.x - c.hw && x < c.x + c.hw && z > c.z - c.hd && z < c.z + c.hd;
        d = inside ? r + Math.min(x - (c.x - c.hw), c.x + c.hw - x, z - (c.z - c.hd), c.z + c.hd - z) : r - distToBox(x, z, c);
      }
      if (d > worst) worst = d;
    });
    return worst;
  }

  free(x, z, r, filter) { return this.penetration(x, z, r, filter) <= 0.001; }

  // Returns fraction [0,1] along the segment of the first hit (1 if clear).
  // Colliders lower than minH are ignored. pad inflates colliders.
  raycast(x1, z1, x2, z2, minH = 0, pad = 0, filter) {
    const dx = x2 - x1, dz = z2 - z1;
    let best = 1;
    this.query(Math.min(x1, x2) - pad, Math.min(z1, z2) - pad, Math.max(x1, x2) + pad, Math.max(z1, z2) + pad, (c) => {
      if (c.h < minH) return;
      if (filter && !filter(c)) return;
      let t;
      if (c.r !== undefined) t = segCircle(x1, z1, dx, dz, c.x, c.z, c.r + pad);
      else t = segBox(x1, z1, dx, dz, c.x - c.hw - pad, c.z - c.hd - pad, c.x + c.hw + pad, c.z + c.hd + pad);
      if (t !== null && t < best) best = t;
    });
    return best;
  }

  clearLine(x1, z1, x2, z2, minH = 0, pad = 0, filter) {
    return this.raycast(x1, z1, x2, z2, minH, pad, filter) >= 1;
  }
}

function segCircle(x, z, dx, dz, cx, cz, r) {
  const fx = x - cx, fz = z - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return fx * fx + fz * fz <= r * r ? 0 : null;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

function segBox(x, z, dx, dz, minX, minZ, maxX, maxZ) {
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-12) {
    if (x < minX || x > maxX) return null;
  } else {
    let a = (minX - x) / dx, b = (maxX - x) / dx;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  if (Math.abs(dz) < 1e-12) {
    if (z < minZ || z > maxZ) return null;
  } else {
    let a = (minZ - z) / dz, b = (maxZ - z) / dz;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

// ---- Footprints of map objects (identical on client and server) ----

export function rotSwap(rot) { return Math.abs(Math.sin(rot)) > 0.5; }

export function genBox(g) {
  const s = rotSwap(g.rot);
  return { x: g.x, z: g.z, hw: s ? 0.5 : 0.85, hd: s ? 0.85 : 0.5, h: 1.3, k: 'gen' };
}
export function lockerBox(l) {
  const s = rotSwap(l.rot);
  return { x: l.x, z: l.z, hw: s ? 0.32 : 0.55, hd: s ? 0.55 : 0.32, h: 2.2, k: 'locker' };
}
export function chestBox(c) {
  const s = rotSwap(c.rot);
  return { x: c.x, z: c.z, hw: s ? 0.3 : 0.5, hd: s ? 0.5 : 0.3, h: 0.65, k: 'chest' };
}
export function palletBox(p) {
  // dropped pallet lies across the gap, perpendicular to its normal
  const alongX = Math.abs(p.nz) > 0.5; // normal along z => pallet spans x
  const half = p.len / 2 + 0.15;
  return { x: p.x, z: p.z, hw: alongX ? half : 0.28, hd: alongX ? 0.28 : half, h: 0.8, k: 'pallet', id: p.id };
}
export function gateBox(g) {
  const alongX = Math.abs(g.nz) > 0.5;
  return { x: g.x, z: g.z, hw: alongX ? 2.4 : 0.3, hd: alongX ? 0.3 : 2.4, h: 4.5, k: 'gatedoor', id: g.id };
}
export function switchBox(g) {
  return { x: g.sx, z: g.sz, hw: 0.32, hd: 0.32, h: 1.4, k: 'switch' };
}

// Builds the collision world for a generated map.
export function buildCollision(map) {
  const w = new CollisionWorld(64, 4);
  for (const b of map.walls) w.add({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, h: b.h, k: b.k });
  for (const c of map.circles) w.add({ x: c.x, z: c.z, r: c.r, h: c.h, k: c.k });
  for (const g of map.gens) w.add(genBox(g));
  for (const l of map.lockers) w.add(lockerBox(l));
  for (const c of map.chests) w.add(chestBox(c));
  for (const h of map.hooks) w.add({ x: h.x, z: h.z, r: 0.22, h: 2.6, k: 'hook' });
  const gateDoors = new Map();
  for (const g of map.gates) {
    gateDoors.set(g.id, w.add(gateBox(g)));
    w.add(switchBox(g));
  }
  const palletColliders = new Map();
  return {
    world: w,
    setPalletDown(p, down) {
      const cur = palletColliders.get(p.id);
      if (down && !cur) palletColliders.set(p.id, w.add(palletBox(p)));
      if (!down && cur) {
        w.remove(cur);
        palletColliders.delete(p.id);
      }
    },
    setGateOpen(g, open) {
      const door = gateDoors.get(g.id);
      if (open && door && door._cells) w.remove(door);
      if (!open && door && !door._cells) w.add(door);
    },
  };
}
