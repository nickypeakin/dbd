// Procedural map generator. Maps are built from 14x14m "tiles" (jungle gyms,
// long walls, shacks...) on a 6x6 grid, like Dead by Daylight's procedural
// tiles, then generators, hooks, lockers, totems, chests and exit gates are
// placed with spacing rules. The server generates the map and sends the JSON
// to clients.

import { RNG } from './rng.js';
import { REALMS } from './data.js';
import { CollisionWorld, genBox, lockerBox, chestBox, gateBox, switchBox } from './collision.js';
import { MAP_HALF } from './constants.js';

const T = 0.4; // wall thickness
const TILE = 14;
const N = 6;
const B = MAP_HALF + 0.6; // boundary wall centre line

class TileBuilder {
  constructor(gen, cx, cz, k, mirror) {
    this.g = gen;
    this.M = gen.M;
    this.cx = cx;
    this.cz = cz;
    this.k = k;
    this.mirror = mirror;
    const th = (k * Math.PI) / 2;
    this.c = Math.round(Math.cos(th));
    this.s = Math.round(Math.sin(th));
  }
  v(x, z) {
    if (this.mirror) x = -x;
    return [x * this.c + z * this.s, -x * this.s + z * this.c];
  }
  p(x, z) {
    const [rx, rz] = this.v(x, z);
    return [this.cx + rx, this.cz + rz];
  }
  size(w, d) { return this.k % 2 ? [d, w] : [w, d]; }
  angle(rot) { return (this.mirror ? -rot : rot) + (this.k * Math.PI) / 2; }

  box(x, z, w, d, h, k) {
    const [wx, wz] = this.p(x, z);
    const [sw, sd] = this.size(w, d);
    const b = { x: r2(wx), z: r2(wz), w: r2(sw), d: r2(sd), h, k };
    this.M.walls.push(b);
    return b;
  }
  lintel(x, z, w, d, y0, y1, k) {
    const [wx, wz] = this.p(x, z);
    const [sw, sd] = this.size(w, d);
    this.M.lintels.push({ x: r2(wx), z: r2(wz), w: r2(sw), d: r2(sd), y0, y1, k });
  }
  // Axis-aligned wall from (x1,z1) to (x2,z2) with optional openings
  // [{at, w, type: 'window'|'pallet'|'door'}] measured along the wall.
  seg(x1, z1, x2, z2, h, k, ops = []) {
    const horiz = Math.abs(z1 - z2) < 1e-6;
    const a = horiz ? Math.min(x1, x2) : Math.min(z1, z2);
    const b = horiz ? Math.max(x1, x2) : Math.max(z1, z2);
    const c = horiz ? z1 : x1;
    const solid = (s0, s1, hh, kk) => {
      if (s1 - s0 < 0.05) return;
      if (horiz) this.box((s0 + s1) / 2, c, s1 - s0, T, hh, kk);
      else this.box(c, (s0 + s1) / 2, T, s1 - s0, hh, kk);
    };
    let cur = a - T / 2;
    const sorted = ops.slice().sort((p, q) => p.at - q.at);
    for (const op of sorted) {
      const o0 = op.at - op.w / 2, o1 = op.at + op.w / 2;
      solid(cur, o0, h, k);
      const lx = horiz ? op.at : c, lz = horiz ? c : op.at;
      const [nx, nz] = this.v(horiz ? 0 : 1, horiz ? 1 : 0);
      const [wx, wz] = this.p(lx, lz);
      if (op.type === 'window') {
        solid(o0, o1, 0.9, 'sill');
        this.M.windows.push({ id: this.M.windows.length, x: r2(wx), z: r2(wz), nx, nz, w: op.w, h, k });
        if (h > 2.1) {
          if (horiz) this.lintel(op.at, c, op.w, T, 2.05, h, k);
          else this.lintel(c, op.at, T, op.w, 2.05, h, k);
        }
        this.g.reserve(wx, wz, 1.4);
        this.g.reserve(wx + nx * 1.4, wz + nz * 1.4, 1.0);
        this.g.reserve(wx - nx * 1.4, wz - nz * 1.4, 1.0);
        this.g.addSpot('trap', wx + nx * 1.1, wz + nz * 1.1, 0);
        this.g.addSpot('trap', wx - nx * 1.1, wz - nz * 1.1, 0);
      } else if (op.type === 'pallet') {
        this.M.pallets.push({ id: this.M.pallets.length, x: r2(wx), z: r2(wz), nx, nz, len: op.w, lean: this.g.rng.chance(0.5) ? 1 : -1 });
        this.g.reserve(wx, wz, 1.5);
        this.g.reserve(wx + nx * 1.5, wz + nz * 1.5, 1.0);
        this.g.reserve(wx - nx * 1.5, wz - nz * 1.5, 1.0);
        this.g.addSpot('trap', wx + nx * 1.2, wz + nz * 1.2, 0);
        this.g.addSpot('trap', wx - nx * 1.2, wz - nz * 1.2, 0);
      } else if (op.type === 'door') {
        if (h > 2.6) {
          if (horiz) this.lintel(op.at, c, op.w, T, 2.4, h, k);
          else this.lintel(c, op.at, T, op.w, 2.4, h, k);
        }
        this.g.reserve(wx, wz, 1.2);
      }
      cur = o1;
    }
    solid(cur, b + T / 2, h, k);
  }
  // Pallet between two obstacles; normal is the crossing direction (local).
  pallet(x, z, nx, nz, len) {
    const [wx, wz] = this.p(x, z);
    const [wnx, wnz] = this.v(nx, nz);
    this.M.pallets.push({ id: this.M.pallets.length, x: r2(wx), z: r2(wz), nx: wnx, nz: wnz, len, lean: this.g.rng.chance(0.5) ? 1 : -1 });
    this.g.reserve(wx, wz, 1.5);
    this.g.reserve(wx + wnx * 1.5, wz + wnz * 1.5, 1.0);
    this.g.reserve(wx - wnx * 1.5, wz - wnz * 1.5, 1.0);
    this.g.addSpot('trap', wx + wnx * 1.2, wz + wnz * 1.2, 0);
    this.g.addSpot('trap', wx - wnx * 1.2, wz - wnz * 1.2, 0);
  }
  roof(x, z, w, d, y, k) {
    const [wx, wz] = this.p(x, z);
    const [sw, sd] = this.size(w, d);
    this.M.roofs.push({ x: r2(wx), z: r2(wz), w: r2(sw), d: r2(sd), y, k });
  }
  floor(x, z, w, d, k) {
    const [wx, wz] = this.p(x, z);
    const [sw, sd] = this.size(w, d);
    this.M.floors.push({ x: r2(wx), z: r2(wz), w: r2(sw), d: r2(sd), k });
  }
  veg(x, z, w, d, k) {
    const [wx, wz] = this.p(x, z);
    const [sw, sd] = this.size(w, d);
    this.M.veg.push({ x: r2(wx), z: r2(wz), w: r2(sw), d: r2(sd), k });
  }
  tree(x, z, r = 0.35) {
    const [wx, wz] = this.p(x, z);
    this.M.circles.push({ x: r2(wx), z: r2(wz), r, h: 8, k: 'tree' });
  }
  rock(x, z, r, h = 2.0) {
    const [wx, wz] = this.p(x, z);
    this.M.circles.push({ x: r2(wx), z: r2(wz), r, h, k: 'rock' });
  }
  spot(type, x, z, rot = 0) {
    const [wx, wz] = this.p(x, z);
    this.g.addSpot(type, wx, wz, this.angle(rot));
  }
  fixed(type, x, z, rot = 0) {
    const [wx, wz] = this.p(x, z);
    this.g.fixed.push({ type, x: r2(wx), z: r2(wz), rot: this.angle(rot) });
  }
}

function r2(v) { return Math.round(v * 100) / 100; }

// ---------------------------------------------------------------- tiles ----

const TILES = {
  jg(t, rng, realm) {
    const k = realm.wall;
    t.seg(-4, 3, 4, 3, 2.6, k, [{ at: 1.2, w: 1.8, type: 'pallet' }]);
    t.seg(4, -0.5, 4, 3, 2.6, k);
    t.seg(-4, -3, -4, 3, 2.6, k, [{ at: 0, w: 1.3, type: 'window' }]);
    t.seg(-4, -3, 0.5, -3, 2.6, k);
    t.spot('gen', 0.5, -5.6, 0);
    t.spot('gen', 5.9, 5.3, Math.PI / 2);
    t.spot('hook', -6, 5.6);
    t.spot('hook', 5.9, -5.4);
    t.spot('totem', -4.7, -3.7);
    t.spot('totem', 3.3, 2.3);
    t.spot('locker', -3.45, -2.0, Math.PI / 2);
    t.spot('chest', 2.2, -1.6, 0);
    t.spot('hatch', 5.7, 0.6);
    t.spot('spawn', -5.6, -5.4);
  },
  longwall(t, rng, realm) {
    const k = realm.wall;
    t.seg(-5.5, 0, 5.5, 0, 2.6, k, [{ at: -1.5, w: 1.3, type: 'window' }]);
    t.seg(2.5, 0, 2.5, -4.6, 2.6, k, [{ at: -3.0, w: 1.8, type: 'pallet' }]);
    t.spot('gen', -3.6, 3.6, 0);
    t.spot('gen', -4.4, -4.4, Math.PI / 2);
    t.spot('hook', 5.6, 3.6);
    t.spot('hook', -5.9, -1.8);
    t.spot('totem', -5.95, 0.6);
    t.spot('locker', 3.8, 0.55, 0);
    t.spot('chest', -1.0, -3.8, 0);
    t.spot('hatch', 5.4, -4.6);
    t.spot('spawn', 0.5, 4.8);
  },
  tl(t, rng, realm) {
    const k = realm.wall;
    t.seg(-4, 2, 2, 2, 2.6, k, [{ at: -2.0, w: 1.3, type: 'window' }]);
    t.seg(-0.5, 2, -0.5, -2, 2.6, k);
    t.seg(0.5, -4, 4.5, -4, 2.6, k, [{ at: 2.0, w: 1.8, type: 'pallet' }]);
    t.seg(4.5, -4, 4.5, 0.5, 2.6, k);
    t.spot('gen', -4.4, -3.4, Math.PI / 2);
    t.spot('gen', 2.4, 5.0, 0);
    t.spot('hook', 5.7, 4.4);
    t.spot('hook', -5.6, 5.4);
    t.spot('totem', -4.65, 2.6);
    t.spot('totem', 3.9, -3.4);
    t.spot('hatch', 2.2, -1.6);
    t.spot('chest', -2.2, -1.2, Math.PI / 2);
    t.spot('spawn', 0, 5.6);
  },
  rockpallet(t, rng, realm, id) {
    const kind = id === 'coldwind' ? 'hay' : id === 'autohaven' ? 'junk' : 'rockblock';
    t.box(-1.8, 0, 1.8, 2.4, kind === 'hay' ? 1.9 : 2.4, kind);
    t.box(1.8, 0, 1.8, 2.4, kind === 'hay' ? 1.9 : 2.2, kind);
    t.pallet(0, 0, 0, 1, 1.8);
    if (rng.chance(0.6)) t.box(-3.6, -3.2, 2.6, 1.2, 2.2, kind);
    else t.rock(-3.8, -3.4, 1.0, 2.2);
    t.spot('gen', 0.4, 4.6, 0);
    t.spot('hook', -5.4, -5.0);
    t.spot('hook', 5.4, 4.8);
    t.spot('totem', 3.2, -1.8);
    t.spot('chest', -4.8, 3.4, Math.PI / 2);
    t.spot('hatch', 4.6, -4.6);
    t.spot('spawn', -4.4, 5.6);
  },
  carloop(t, rng) {
    t.box(-1.95, 0, 2.0, 4.4, 1.5, 'car');
    t.box(1.95, 0, 2.0, 4.4, 1.5, 'car');
    t.pallet(0, 0, 0, 1, 1.9);
    t.box(0, 4.4, 5.6, 1.8, 3.0, 'junk');
    if (rng.chance(0.5)) t.box(-4.6, -3.2, 2.0, 4.0, 2.9, 'carstack');
    t.spot('gen', 4.9, -4.4, Math.PI / 2);
    t.spot('hook', 5.4, 4.4);
    t.spot('hook', -5.6, 4.4);
    t.spot('totem', 3.6, 5.6);
    t.spot('chest', 0, -4.6, 0);
    t.spot('hatch', -4.5, 1.6);
    t.spot('spawn', 0, -5.8);
  },
  corn(t, rng) {
    t.veg(0, 0, 9, 9, 'corn');
    t.spot('gen', 5.7, -5.4, 0);
    t.spot('hook', -5.8, 5.8);
    t.spot('hook', 2.0, -2.0);
    t.spot('totem', -1.0, 1.5);
    t.spot('chest', 5.7, 2.5, Math.PI / 2);
    t.spot('hatch', 0, 0);
    if (rng.chance(0.5)) t.box(-5.8, -3.2, 1.2, 2.4, 1.9, 'hay');
  },
  filler(t, rng, realm) {
    t.spot('gen', rng.range(-2, 2), rng.range(-2, 2), rng.pick([0, Math.PI / 2]));
    t.spot('hook', rng.range(-5, -3), rng.range(3, 5));
    t.spot('hook', rng.range(3, 5), rng.range(-5, -3));
    t.spot('totem', rng.range(-5, 5), rng.range(-5, 5));
    t.spot('chest', rng.range(-4, 4), rng.range(-4, 4), rng.pick([0, Math.PI / 2]));
    t.spot('hatch', rng.range(-4, 4), rng.range(-4, 4));
    t.spot('spawn', rng.range(-4, 4), rng.range(-4, 4));
    t.g.fillTile.push({ cx: t.cx, cz: t.cz, n: rng.int(7, 11) });
    if (rng.chance(0.5)) {
      const kind = realm === REALMS.coldwind ? 'log' : 'rockblock';
      t.box(rng.range(-3, 3), rng.range(-3, 3), kind === 'log' ? 3.2 : 1.6, kind === 'log' ? 0.8 : 1.6, kind === 'log' ? 0.8 : 1.8, kind);
    }
  },
  open(t, rng) {
    t.spot('gen', 0, 0, rng.pick([0, Math.PI / 2]));
    t.spot('hook', 4.2, 4.2);
    t.spot('hook', -4.2, -4.2);
    t.spot('totem', -4.5, 4.0);
    t.spot('hatch', 3.5, -3.5);
    t.spot('spawn', -3.5, 3.5);
    t.spot('spawn', 3.5, -3.5);
    t.g.fillTile.push({ cx: t.cx, cz: t.cz, n: rng.int(3, 5) });
  },
  shack(t, rng, realm) {
    const k = realm.house === 'brick' ? 'brick' : 'woodplank';
    const h = 3.0;
    t.seg(-3.6, -3, 3.6, -3, h, k, [{ at: 0, w: 1.8, type: 'pallet' }]);
    t.seg(-3.6, 3, 3.6, 3, h, k, [{ at: 1.8, w: 1.6, type: 'door' }]);
    t.seg(-3.6, -3, -3.6, 3, h, k, [{ at: 0.3, w: 1.3, type: 'window' }]);
    t.seg(3.6, -3, 3.6, 3, h, k);
    t.roof(0, 0, 8.2, 7.0, h, 'roof');
    t.floor(0, 0, 7.2, 6.0, 'wood');
    t.fixed('locker', 3.07, 1.2, -Math.PI / 2);
    t.fixed('chest', -2.4, -2.2, 0);
    t.spot('hook', 0, 5.7);
    t.spot('hook', 5.8, -4.6);
    t.spot('gen', -5.7, 4.9, Math.PI / 2);
    t.spot('totem', 5.4, 5.4);
    t.spot('hatch', -5.4, -5.0);
  },
  main(t, rng, realm) {
    const k = realm.house;
    const h = 3.4;
    t.seg(-8, -6, 8, -6, h, k, [{ at: -5, w: 1.3, type: 'window' }, { at: 0, w: 2.0, type: 'door' }, { at: 5, w: 1.3, type: 'window' }]);
    t.seg(-8, 6, 8, 6, h, k, [{ at: -4.4, w: 1.3, type: 'window' }, { at: 4, w: 1.8, type: 'pallet' }]);
    t.seg(-8, -6, -8, 6, h, k, [{ at: 0, w: 2.0, type: 'door' }]);
    t.seg(8, -6, 8, 6, h, k, [{ at: 0, w: 1.3, type: 'window' }]);
    t.seg(-2.5, -6, -2.5, 3, h, k, [{ at: -2, w: 2.0, type: 'door' }]);
    t.seg(-8, 3, -4.5, 3, h, k);
    t.seg(2.5, 6, 2.5, -1.5, h, k, [{ at: 2.5, w: 1.8, type: 'pallet' }]);
    t.roof(0, 0, 17.2, 13.2, h, 'roof');
    t.floor(0, 0, 16, 12, 'wood');
    t.fixed('gen', 5.3, -3.2, 0);
    t.fixed('locker', -7.47, 4.6, Math.PI / 2);
    t.fixed('locker', -4.0, -5.47, 0);
    t.fixed('locker', 7.47, 4.2, -Math.PI / 2);
    t.fixed('chest', -6.4, -4.4, Math.PI / 2);
    t.spot('hook', -11.5, -10);
    t.spot('hook', 11.5, 10);
    t.spot('hook', -11.5, 10);
    t.spot('hook', 11.5, -10);
    t.spot('gen', 0, 10.6, 0);
    t.spot('gen', 0, -10.6, 0);
    t.spot('gen', -11.6, 0, Math.PI / 2);
    t.spot('gen', 11.6, 0, Math.PI / 2);
    t.spot('totem', -9.2, -7.4);
    t.spot('totem', 9.2, 7.4);
    t.spot('hatch', 10.6, -4.5);
    t.spot('spawn', -10.5, 11.5);
    t.spot('spawn', 10.5, -11.5);
    t.g.fillTile.push({ cx: t.cx + 11, cz: t.cz + 11, n: 3, rad: 3 });
    t.g.fillTile.push({ cx: t.cx - 11, cz: t.cz - 11, n: 3, rad: 3 });
    t.g.fillTile.push({ cx: t.cx - 11, cz: t.cz + 11, n: 2, rad: 3 });
    t.g.fillTile.push({ cx: t.cx + 11, cz: t.cz - 11, n: 2, rad: 3 });
  },
};

// ----------------------------------------------------------- generator ----

class Generator {
  constructor(seed, realmId) {
    this.rng = new RNG(seed);
    this.realmId = REALMS[realmId] ? realmId : 'macmillan';
    this.realm = REALMS[this.realmId];
    this.M = {
      seed, realm: this.realmId, name: this.rng.pick(this.realm.maps), half: MAP_HALF,
      walls: [], circles: [], roofs: [], floors: [], lintels: [], windows: [], pallets: [],
      gens: [], hooks: [], lockers: [], chests: [], totems: [], gates: [], hatch: null,
      trapSpots: [], spawns: { killer: null, survivors: [] }, veg: [],
    };
    this.spots = { gen: [], hook: [], totem: [], chest: [], locker: [], hatch: [], trap: [], spawn: [] };
    this.fixed = [];
    this.reserved = [];
    this.fillTile = [];
  }
  addSpot(type, x, z, rot) { this.spots[type].push({ x: r2(x), z: r2(z), rot }); }
  reserve(x, z, r) { this.reserved.push({ x, z, r }); }
  isReserved(x, z, r) {
    for (const q of this.reserved) if (Math.hypot(q.x - x, q.z - z) < q.r + r) return true;
    return false;
  }

  build() {
    const { rng, realm, M } = this;
    // ---- tile layout
    const grid = Array.from({ length: N }, () => Array(N).fill(null));
    const pickC = () => rng.pick([1, 2, 2, 2, 3]);
    const mi = pickC(), mj = pickC();
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) grid[mi + a][mj + b] = 'main*';
    grid[mi][mj] = 'main';
    // shack: not touching the main building
    const shackCands = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (grid[i][j]) continue;
      if (i >= mi - 1 && i <= mi + 2 && j >= mj - 1 && j <= mj + 2) continue;
      shackCands.push([i, j]);
    }
    const [si, sj] = rng.pick(shackCands);
    grid[si][sj] = 'shack';
    const pool = [];
    for (const [type, n] of Object.entries(realm.tiles)) for (let i = 0; i < n; i++) pool.push(type);
    rng.shuffle(pool);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (!grid[i][j]) grid[i][j] = pool.pop() || 'filler';
    }
    const tc = (i) => -((N - 1) * TILE) / 2 + i * TILE;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const type = grid[i][j];
      if (type === 'main*') continue;
      let cx = tc(i), cz = tc(j);
      if (type === 'main') { cx += TILE / 2; cz += TILE / 2; }
      else { cx += rng.range(-0.8, 0.8); cz += rng.range(-0.8, 0.8); }
      const k = rng.int(0, 3);
      const mirror = rng.chance(0.5);
      const t = new TileBuilder(this, cx, cz, k, mirror);
      TILES[type](t, rng, realm, this.realmId);
    }

    // ---- boundary and exit gates
    this.buildBoundary();

    // collision world for clearance tests
    const W = new CollisionWorld(64, 4);
    this.W = W;
    for (const b of M.walls) W.add({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, h: b.h });
    for (const c of M.circles) W.add({ x: c.x, z: c.z, r: c.r, h: c.h });
    for (const g of M.gates) { W.add(gateBox(g)); W.add(switchBox(g)); }

    // fixed objects from buildings
    for (const f of this.fixed) {
      if (f.type === 'gen') this.placeGen(f, true);
      if (f.type === 'locker') this.placeLocker(f, true);
      if (f.type === 'chest') this.placeChest(f, true);
    }

    // generators
    this.sample(this.spots.gen, 7 - M.gens.length, 16, M.gens.map((g) => [g.x, g.z]), (s) => this.placeGen(s));
    if (M.gens.length < 7) this.sample(this.spots.gen, 7 - M.gens.length, 10, M.gens.map((g) => [g.x, g.z]), (s) => this.placeGen(s));
    // hooks
    this.sample(this.spots.hook, 13, 11, [], (s) => this.placeHook(s));
    if (M.hooks.length < 11) this.sample(this.spots.hook, 11 - M.hooks.length, 7, M.hooks.map((h) => [h.x, h.z]), (s) => this.placeHook(s));
    // lockers
    this.sample(this.spots.locker, 4, 10, M.lockers.map((l) => [l.x, l.z]), (s) => this.placeLocker(s));
    // totems
    this.sample(this.spots.totem, 5, 14, [], (s) => this.placeTotem(s));
    // chests
    this.sample(this.spots.chest, Math.max(0, 3 - M.chests.length), 18, M.chests.map((c) => [c.x, c.z]), (s) => this.placeChest(s));
    // hatch, far from gates
    const gatePts = M.gates.map((g) => [g.x, g.z]);
    this.sample(this.spots.hatch, 1, 26, gatePts, (s) => {
      if (!this.clear(s.x, s.z, 1.0)) return false;
      M.hatch = { x: s.x, z: s.z };
      this.reserve(s.x, s.z, 1.2);
      return true;
    }, true);
    if (!M.hatch) M.hatch = { x: 0, z: 0 };
    // bear trap spawns (for the Trapper)
    this.sample(this.spots.trap, 8, 9, [], (s) => {
      if (!W.free(s.x, s.z, 0.5)) return false;
      M.trapSpots.push({ x: s.x, z: s.z });
      return true;
    });

    // spawns
    this.chooseSpawns();

    // filler trees and rocks
    this.fill();
    return M;
  }

  clear(x, z, r) {
    return Math.abs(x) < MAP_HALF - 1.5 && Math.abs(z) < MAP_HALF - 1.5 && this.W.free(x, z, r) && !this.isReserved(x, z, r * 0.6);
  }

  // Farthest-point style sampling with minimum spacing.
  sample(cands, count, minDist, existing, place, skipShuffle) {
    const pts = existing.slice();
    const list = this.rng.shuffle(cands.slice());
    if (skipShuffle) this.rng.shuffle(list);
    let placed = 0;
    while (placed < count && list.length) {
      // pick the candidate farthest from everything placed so far
      let best = -1, bestD = -1;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        let d = 1e9;
        for (const [x, z] of pts) d = Math.min(d, Math.hypot(x - c.x, z - c.z));
        d += this.rng.range(0, 4);
        if (d > bestD) { bestD = d; best = i; }
      }
      const c = list.splice(best, 1)[0];
      if (bestD < minDist && pts.length) break;
      if (place(c) !== false) {
        pts.push([c.x, c.z]);
        placed++;
      }
    }
    return placed;
  }

  placeGen(s, force) {
    const g = { id: this.M.gens.length, x: r2(s.x), z: r2(s.z), rot: snapRot(s.rot) };
    const b = genBox(g);
    if (!force) {
      const sw = Math.abs(Math.sin(g.rot)) > 0.5;
      const ax = sw ? 0 : 0.45, az = sw ? 0.45 : 0;
      if (!this.W.free(g.x + ax, g.z + az, 0.95) || !this.W.free(g.x - ax, g.z - az, 0.95)) return false;
      if (this.isReserved(g.x, g.z, 1.0)) return false;
      if (Math.abs(g.x) > MAP_HALF - 3 || Math.abs(g.z) > MAP_HALF - 3) return false;
      for (const o of this.M.gens) if (Math.hypot(o.x - g.x, o.z - g.z) < 8) return false;
    }
    this.M.gens.push(g);
    this.W.add(b);
    this.reserve(g.x, g.z, 2.0);
    return true;
  }
  placeHook(s) {
    if (!this.clear(s.x, s.z, 1.0)) return false;
    const h = { id: this.M.hooks.length, x: r2(s.x), z: r2(s.z), rot: this.rng.range(-Math.PI, Math.PI) };
    this.M.hooks.push(h);
    this.W.add({ x: h.x, z: h.z, r: 0.25, h: 2.6 });
    this.reserve(h.x, h.z, 1.2);
    return true;
  }
  placeLocker(s, force) {
    const l = { id: this.M.lockers.length, x: r2(s.x), z: r2(s.z), rot: snapRot(s.rot) };
    const b = lockerBox(l);
    const fx = l.x + Math.sin(l.rot) * 0.9, fz = l.z + Math.cos(l.rot) * 0.9;
    if (!force) {
      if (this.W.penetration(l.x, l.z, 0.25) > 0) return false;
      if (!this.W.free(fx, fz, 0.4)) return false;
      if (this.isReserved(l.x, l.z, 0.5)) return false;
    }
    this.M.lockers.push(l);
    this.W.add(b);
    this.reserve(fx, fz, 0.8);
    return true;
  }
  placeChest(s, force) {
    const c = { id: this.M.chests.length, x: r2(s.x), z: r2(s.z), rot: snapRot(s.rot) };
    if (!force && !this.clear(c.x, c.z, 0.9)) return false;
    this.M.chests.push(c);
    this.W.add(chestBox(c));
    this.reserve(c.x, c.z, 1.2);
    return true;
  }
  placeTotem(s) {
    if (!this.W.free(s.x, s.z, 0.6) || this.isReserved(s.x, s.z, 0.3)) return false;
    if (Math.abs(s.x) > MAP_HALF - 2 || Math.abs(s.z) > MAP_HALF - 2) return false;
    const t = { id: this.M.totems.length, x: r2(s.x), z: r2(s.z), rot: this.rng.range(-Math.PI, Math.PI) };
    this.M.totems.push(t);
    this.reserve(t.x, t.z, 0.9);
    return true;
  }

  buildBoundary() {
    const { rng, M } = this;
    const kind = this.realm.boundary;
    const axis = rng.chance(0.5) ? 'z' : 'x';
    const sides = axis === 'z' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    const gates = [];
    for (const [nx, nz] of sides) {
      const u = r2(rng.range(-26, 26));
      gates.push({ nx, nz, u });
    }
    const L = B + 0.6;
    // each side: list of openings in tangent coordinate
    const allSides = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [nx, nz] of allSides) {
      const gate = gates.find((g) => g.nx === nx && g.nz === nz);
      const ranges = gate ? [[-L, gate.u - 2.2], [gate.u + 2.2, L]] : [[-L, L]];
      for (const [a, b] of ranges) {
        const mid = (a + b) / 2, len = b - a;
        if (nz !== 0) M.walls.push({ x: r2(mid), z: r2(nz * B), w: r2(len), d: 1.2, h: 4.5, k: 'boundary_' + kind });
        else M.walls.push({ x: r2(nx * B), z: r2(mid), w: 1.2, d: r2(len), h: 4.5, k: 'boundary_' + kind });
      }
    }
    for (const g of gates) {
      const tx = g.nz !== 0 ? 1 : 0, tz = g.nx !== 0 ? 1 : 0; // tangent
      const side = rng.chance(0.5) ? 1 : -1;
      const gx = g.nz !== 0 ? g.u : g.nx * B;
      const gz = g.nz !== 0 ? g.nz * B : g.u;
      const gate = {
        id: M.gates.length,
        x: r2(gx), z: r2(gz), nx: g.nx, nz: g.nz,
        sx: r2(gx + tx * 3.9 * side - g.nx * 1.25), sz: r2(gz + tz * 3.9 * side - g.nz * 1.25),
        ex: r2(gx + g.nx * 4.5), ez: r2(gz + g.nz * 4.5),
      };
      M.gates.push(gate);
      // corridor walls beyond the gate
      for (const s of [-1, 1]) {
        const cxw = gx + tx * 2.9 * s + g.nx * 5;
        const czw = gz + tz * 2.9 * s + g.nz * 5;
        M.walls.push({ x: r2(cxw), z: r2(czw), w: g.nz !== 0 ? 1.2 : 9, d: g.nz !== 0 ? 9 : 1.2, h: 4.5, k: 'gatewall' });
      }
      M.walls.push({ x: r2(gx + g.nx * 9.6), z: r2(gz + g.nz * 9.6), w: g.nz !== 0 ? 7 : 1.2, d: g.nz !== 0 ? 1.2 : 7, h: 4.5, k: 'gatewall' });
      this.reserve(gx - g.nx * 3, gz - g.nz * 3, 5.5);
      this.reserve(gate.sx, gate.sz, 1.5);
    }
  }

  chooseSpawns() {
    const { M, rng } = this;
    const cands = this.spots.spawn.concat(this.spots.hatch).filter((s) => this.W.free(s.x, s.z, 1.2));
    const ks = rng.pick(cands.length ? cands : [{ x: 0, z: 0 }]);
    M.spawns.killer = { x: ks.x, z: ks.z, rot: Math.atan2(-ks.x, -ks.z) };
    const far = cands.filter((c) => Math.hypot(c.x - ks.x, c.z - ks.z) > 34);
    rng.shuffle(far);
    const groups = (far.length >= 2 ? far : cands).slice(0, 2);
    for (let i = 0; i < 4; i++) {
      const g = groups[i % groups.length] || { x: 10, z: 10 };
      const ang = (i >> 1) * Math.PI + rng.range(-0.5, 0.5);
      let x = g.x + Math.cos(ang) * 1.1, z = g.z + Math.sin(ang) * 1.1;
      if (!this.W.free(x, z, 0.4)) { x = g.x; z = g.z; }
      M.spawns.survivors.push({ x: r2(x), z: r2(z), rot: Math.atan2(-x, -z) + rng.range(-0.6, 0.6) });
    }
  }

  fill() {
    const { rng, M, W } = this;
    const tryPlace = (x, z, kind) => {
      const r = kind === 'tree' ? rng.range(0.25, 0.45) : rng.range(0.6, 1.3);
      // keep >= 1.5m passages between obstacles
      if (!this.clear(x, z, r + 1.5)) return false;
      if (Math.abs(x) > MAP_HALF - 1.8 || Math.abs(z) > MAP_HALF - 1.8) return false;
      for (const v of M.veg) if (Math.abs(x - v.x) < v.w / 2 + 1 && Math.abs(z - v.z) < v.d / 2 + 1) return false;
      const c = { x: r2(x), z: r2(z), r: r2(r), h: kind === 'tree' ? 8 : r2(rng.range(1.2, 2.6)), k: kind };
      M.circles.push(c);
      W.add(c);
      return true;
    };
    for (const f of this.fillTile) {
      const rad = f.rad || 6;
      let n = 0;
      for (let a = 0; a < 40 && n < f.n; a++) {
        const x = f.cx + rng.range(-rad, rad), z = f.cz + rng.range(-rad, rad);
        if (tryPlace(x, z, rng.chance(0.7) ? 'tree' : 'rock')) n++;
      }
    }
    // sparse trees all over and along the boundary
    for (let a = 0; a < 220; a++) {
      const edge = rng.chance(0.5);
      let x, z;
      if (edge) {
        const s = rng.int(0, 3);
        const u = rng.range(-MAP_HALF + 2, MAP_HALF - 2);
        const v = MAP_HALF - rng.range(2.2, 3.4);
        [x, z] = s === 0 ? [u, v] : s === 1 ? [u, -v] : s === 2 ? [v, u] : [-v, u];
      } else {
        x = rng.range(-MAP_HALF + 3, MAP_HALF - 3);
        z = rng.range(-MAP_HALF + 3, MAP_HALF - 3);
      }
      tryPlace(x, z, rng.chance(0.75) ? 'tree' : 'rock');
    }
  }
}

function snapRot(r) {
  const q = Math.round(r / (Math.PI / 2));
  return (((q % 4) + 4) % 4) * (Math.PI / 2);
}

// Flood fill on a 0.5m grid to verify everything important is reachable.
export function checkConnectivity(map, world) {
  const cell = 0.5, half = MAP_HALF + 10;
  const n = Math.ceil((half * 2) / cell);
  const idx = (x, z) => Math.floor((x + half) / cell) * n + Math.floor((z + half) / cell);
  const free = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
    free[i * n + j] = world.free(x, z, 0.36, (c) => c.k !== 'gatedoor') ? 1 : 0;
  }
  const seen = new Uint8Array(n * n);
  const s = map.spawns.survivors[0];
  const start = idx(s.x, s.z);
  if (!free[start]) return false;
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const c = q.pop();
    const i = Math.floor(c / n), j = c % n;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const k = a * n + b;
      if (free[k] && !seen[k]) { seen[k] = 1; q.push(k); }
    }
  }
  const reach = (x, z, r) => {
    for (let dx = -r; dx <= r; dx += cell) for (let dz = -r; dz <= r; dz += cell) {
      const k = idx(x + dx, z + dz);
      if (seen[k]) return true;
    }
    return false;
  };
  const pts = [
    ...map.gens.map((g) => [g.x, g.z, 1.6]),
    ...map.hooks.map((h) => [h.x, h.z, 1.2]),
    ...map.lockers.map((l) => [l.x + Math.sin(l.rot) * 0.8, l.z + Math.cos(l.rot) * 0.8, 0.5]),
    ...map.gates.map((g) => [g.sx, g.sz, 1.2]),
    ...map.gates.map((g) => [g.x - g.nx * 1.2, g.z - g.nz * 1.2, 0.8]),
    ...map.totems.map((t) => [t.x, t.z, 1.0]),
    ...map.chests.map((c) => [c.x, c.z, 1.0]),
    [map.hatch.x, map.hatch.z, 1.0],
    [map.spawns.killer.x, map.spawns.killer.z, 0.5],
    ...map.spawns.survivors.map((p) => [p.x, p.z, 0.5]),
  ];
  for (const [x, z, r] of pts) if (!reach(x, z, r)) return false;
  for (const w of map.windows) {
    if (!reach(w.x + w.nx * 1.0, w.z + w.nz * 1.0, 0.5) || !reach(w.x - w.nx * 1.0, w.z - w.nz * 1.0, 0.5)) return false;
  }
  return true;
}

export function generateMap(seed, realmId, validate) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const s = (seed + attempt * 7919) >>> 0;
    const m = new Generator(s, realmId).build();
    if (m.gens.length < 7 || m.hooks.length < 8) continue;
    if (!validate || validate(m)) return m;
  }
  return new Generator(seed, realmId).build();
}
