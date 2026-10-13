// Prop models: generators, hooks, pallets, lockers, gates, hatch, totems,
// chests, bear traps, trees, rocks, vehicles and campfire pieces.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat } from './models.js';
import * as TX from './textures.js';

function m(geo, material, x = 0, y = 0, z = 0, cast = true) {
  const o = new THREE.Mesh(geo, material);
  o.position.set(x, y, z);
  o.castShadow = cast;
  o.receiveShadow = true;
  return o;
}
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const cyl = (a, b, h, s = 10) => new THREE.CylinderGeometry(a, b, h, s);

// Merge all meshes of a group into one mesh per material (for static props).
export function mergeGroup(g) {
  g.updateMatrixWorld(true);
  const byMat = new Map();
  g.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    const key = o.material.uuid;
    if (!byMat.has(key)) byMat.set(key, { mat: o.material, geos: [], cast: o.castShadow });
    const nonIdx = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(nonIdx.attributes)) if (!['position', 'normal', 'uv'].includes(k)) nonIdx.deleteAttribute(k);
    if (!nonIdx.attributes.uv) nonIdx.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nonIdx.attributes.position.count * 2), 2));
    byMat.get(key).geos.push(nonIdx);
  });
  const out = new THREE.Group();
  for (const { mat: mt, geos, cast } of byMat.values()) {
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, mt);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

// ------------------------------------------------------------- generator --
export function createGenerator() {
  const g = new THREE.Group();
  const body = mat('#6d6a60', { map: TX.rustMetalTexture('#7a776c'), r: 0.6, m: 0.4 });
  const dark = mat('#2c2b28', { r: 0.7, m: 0.4 });
  const steel = mat('#8e8f8c', { r: 0.35, m: 0.85 });
  g.add(m(box(1.6, 0.25, 0.95), dark, 0, 0.125, 0));
  g.add(m(box(1.45, 0.75, 0.85), body, 0, 0.62, 0));
  g.add(m(cyl(0.28, 0.28, 0.9, 14), body, 0.2, 1.1, 0).rotateZ(Math.PI / 2));
  g.add(m(box(0.5, 0.35, 0.6), dark, -0.45, 1.15, 0));
  // pistons
  const pistons = [];
  for (let i = 0; i < 4; i++) {
    const p = m(cyl(0.05, 0.05, 0.35, 8), steel, -0.05 + i * 0.16, 1.35, 0.15);
    g.add(p);
    pistons.push(p);
  }
  // panel bulbs (progress)
  const bulbs = [];
  for (let i = 0; i < 4; i++) {
    const bm = new THREE.MeshStandardMaterial({ color: '#3a3020', emissive: '#ffb347', emissiveIntensity: 0, roughness: 0.4 });
    const b = m(new THREE.SphereGeometry(0.04, 8, 6), bm, -0.48 + i * 0.13, 0.85, 0.44, false);
    g.add(b);
    bulbs.push(b);
  }
  // lamp post
  g.add(m(cyl(0.035, 0.04, 1.6, 8), dark, -0.6, 1.6, -0.3));
  g.add(m(box(0.5, 0.05, 0.05), dark, -0.42, 2.38, -0.3));
  const lampMat = new THREE.MeshStandardMaterial({ color: '#4a4030', emissive: '#ffd27a', emissiveIntensity: 0, roughness: 0.3 });
  const lamp = m(new THREE.SphereGeometry(0.11, 12, 8), lampMat, -0.2, 2.3, -0.3, false);
  g.add(lamp);
  g.add(m(new THREE.ConeGeometry(0.2, 0.14, 12, 1, true), mat('#2c2b28', { side: THREE.DoubleSide }), -0.2, 2.4, -0.3));
  // cables
  g.add(m(new THREE.TorusGeometry(0.25, 0.02, 6, 16, Math.PI), dark, 0.75, 0.35, 0.2).rotateY(Math.PI / 2));
  return { group: g, pistons, bulbs, lamp, lampMat };
}

// ------------------------------------------------------------------ hook --
export function createHook() {
  const g = new THREE.Group();
  const metal = mat('#55504a', { map: TX.rustMetalTexture('#5a554e'), r: 0.6, m: 0.6 });
  g.add(m(cyl(0.09, 0.11, 2.75, 10), mat('#4a3b2c', { map: TX.woodTexture('#4d3a28') }), 0, 1.375, 0));
  g.add(m(box(0.12, 0.12, 0.62), metal, 0, 2.7, 0.22));
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 2.68, 0.45), new THREE.Vector3(0, 2.45, 0.48), new THREE.Vector3(0, 2.18, 0.42),
    new THREE.Vector3(0, 2.05, 0.3), new THREE.Vector3(0, 2.12, 0.2), new THREE.Vector3(0, 2.24, 0.22),
  ]);
  g.add(m(new THREE.TubeGeometry(curve, 20, 0.028, 6), metal));
  g.add(m(new THREE.ConeGeometry(0.035, 0.1, 6), metal, 0, 2.28, 0.24));
  // base stones
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    g.add(m(new THREE.DodecahedronGeometry(0.14, 0), mat('#4c4a45'), Math.cos(a) * 0.2, 0.06, Math.sin(a) * 0.2));
  }
  return g;
}

// Spider legs of the Entity around a hooked survivor (stage 2 / sacrifice)
export function createEntityLegs() {
  const g = new THREE.Group();
  const mt = new THREE.MeshStandardMaterial({ color: '#0d0705', emissive: '#3a0000', emissiveIntensity: 0.6, roughness: 0.6 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(a) * 1.6, -0.2, Math.sin(a) * 1.6),
      new THREE.Vector3(Math.cos(a) * 1.4, 2.6, Math.sin(a) * 1.4),
      new THREE.Vector3(Math.cos(a) * 0.7, 3.5, Math.sin(a) * 0.7),
      new THREE.Vector3(Math.cos(a) * 0.15, 2.4, Math.sin(a) * 0.15),
    ]);
    const leg = m(new THREE.TubeGeometry(curve, 16, 0.045, 5), mt);
    leg.castShadow = false;
    g.add(leg);
  }
  return g;
}

// ---------------------------------------------------------------- pallet --
export function createPalletMesh() {
  const g = new THREE.Group();
  const wood = mat('#7a6145', { map: TX.woodTexture('#7b6146', true) });
  // long axis along Y (standing), width along X
  for (const x of [-0.36, 0, 0.36]) g.add(m(box(0.1, 1.85, 0.06), wood, x, 0.925, 0.0));
  for (let i = 0; i < 6; i++) g.add(m(box(0.85, 0.12, 0.04), wood, 0, 0.1 + i * 0.33, 0.05));
  return mergeGroup(g);
}

// ---------------------------------------------------------------- locker --
export function createLocker() {
  const g = new THREE.Group();
  const body = mat('#46504a', { map: TX.rustMetalTexture('#4c5850'), r: 0.6, m: 0.5 });
  const front = mat('#56635a', { map: TX.lockerTexture(), r: 0.6, m: 0.4 });
  g.add(m(box(1.1, 2.2, 0.62), body, 0, 1.1, -0.01));
  const doorL = new THREE.Group(); doorL.position.set(-0.54, 0, 0.31);
  const dl = m(box(0.54, 2.1, 0.03), front, 0.27, 1.07, 0);
  doorL.add(dl);
  const doorR = new THREE.Group(); doorR.position.set(0.54, 0, 0.31);
  const dr = m(box(0.54, 2.1, 0.03), front, -0.27, 1.07, 0);
  doorR.add(dr);
  g.add(doorL, doorR);
  return { group: g, doorL, doorR };
}

// ----------------------------------------------------------------- chest --
export function createChest() {
  const g = new THREE.Group();
  const wood = mat('#5d4430', { map: TX.woodTexture('#5f4530', false) });
  const band = mat('#3a3631', { r: 0.5, m: 0.7 });
  g.add(m(box(1.0, 0.45, 0.6), wood, 0, 0.225, 0));
  const lid = new THREE.Group();
  lid.position.set(0, 0.45, -0.3);
  lid.add(m(box(1.02, 0.16, 0.62), wood, 0, 0.08, 0.3));
  lid.add(m(box(1.04, 0.04, 0.1), band, 0, 0.12, 0.58));
  g.add(lid);
  for (const x of [-0.35, 0.35]) g.add(m(box(0.06, 0.47, 0.62), band, x, 0.23, 0));
  return { group: g, lid };
}

// ----------------------------------------------------------------- totem --
export function createTotem() {
  const g = new THREE.Group();
  const bone = mat('#d9cfb8', { r: 0.8 });
  const stick = mat('#4a3a2a');
  const stone = mat('#4a4844');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(m(new THREE.DodecahedronGeometry(0.12, 0), stone, Math.cos(a) * 0.25, 0.05, Math.sin(a) * 0.25));
  }
  for (let i = 0; i < 3; i++) {
    const s = m(cyl(0.02, 0.025, 0.9, 5), stick, (i - 1) * 0.08, 0.4, 0);
    s.rotation.z = (i - 1) * 0.3;
    g.add(s);
  }
  const skull = m(new THREE.SphereGeometry(0.1, 10, 8), bone, 0, 0.82, 0.02);
  skull.scale.set(0.9, 1.0, 1.1);
  g.add(skull);
  g.add(m(new THREE.SphereGeometry(0.08, 8, 6), bone, 0.12, 0.2, 0.05));
  g.add(m(new THREE.SphereGeometry(0.075, 8, 6), bone, -0.1, 0.15, -0.05));
  for (const x of [-0.035, 0.035]) g.add(m(new THREE.SphereGeometry(0.022, 6, 5), mat('#120c08'), x, 0.84, 0.11));
  const candles = new THREE.Group();
  const wax = mat('#e8dcc0');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    candles.add(m(cyl(0.025, 0.025, 0.14 + (i % 2) * 0.06, 6), wax, Math.cos(a) * 0.32, 0.08, Math.sin(a) * 0.32));
  }
  g.add(candles);
  return { group: g, candles };
}

// ------------------------------------------------------------------ gate --
export function createGate() {
  // local frame: opening along X (width 4.4), outward = +Z
  const g = new THREE.Group();
  const conc = mat('#7a776f', { map: TX.concreteTexture('#7b7870') });
  const metal = mat('#55524c', { map: TX.rustMetalTexture('#5b5750'), r: 0.5, m: 0.6 });
  for (const x of [-2.75, 2.75]) g.add(m(box(1.1, 4.8, 1.4), conc, x, 2.4, 0));
  g.add(m(box(6.6, 0.8, 1.4), conc, 0, 4.6, 0));
  const doors = [];
  for (const sx of [-1, 1]) {
    const d = new THREE.Group();
    d.position.set(sx * 1.1, 0, 0);
    d.add(m(box(2.2, 4.1, 0.18), metal, 0, 2.05, 0));
    for (let i = 0; i < 5; i++) d.add(m(box(2.2, 0.08, 0.22), mat('#3a3833', { r: 0.5, m: 0.7 }), 0, 0.4 + i * 0.85, 0));
    g.add(d);
    doors.push(d);
  }
  const lights = [];
  for (let i = 0; i < 3; i++) {
    const lm = new THREE.MeshStandardMaterial({ color: '#301010', emissive: '#ff2a1a', emissiveIntensity: 0, roughness: 0.3 });
    const l = m(new THREE.SphereGeometry(0.12, 10, 8), lm, -1.2 + i * 1.2, 5.05, -0.55, false);
    g.add(l);
    lights.push(l);
  }
  return { group: g, doors, lights };
}

export function createSwitch() {
  const g = new THREE.Group();
  const metal = mat('#4f4c46', { map: TX.rustMetalTexture('#55524b'), r: 0.5, m: 0.6 });
  g.add(m(box(0.55, 0.75, 0.32), metal, 0, 1.15, 0));
  g.add(m(cyl(0.05, 0.05, 0.8, 8), mat('#2f2d29'), 0, 0.4, 0));
  const lever = new THREE.Group();
  lever.position.set(0.2, 1.2, 0.17);
  lever.add(m(box(0.05, 0.32, 0.05), mat('#2a2826', { m: 0.7, r: 0.4 }), 0, 0.15, 0.03));
  lever.add(m(new THREE.SphereGeometry(0.05, 8, 6), mat('#8a1a12'), 0, 0.32, 0.03));
  g.add(lever);
  const lights = [];
  for (let i = 0; i < 3; i++) {
    const lm = new THREE.MeshStandardMaterial({ color: '#301010', emissive: '#ff3a1a', emissiveIntensity: 0, roughness: 0.3 });
    const l = m(new THREE.SphereGeometry(0.04, 8, 6), lm, -0.15, 1.38 - i * 0.12, 0.17, false);
    g.add(l);
    lights.push(l);
  }
  return { group: g, lever, lights };
}

// ----------------------------------------------------------------- hatch --
export function createHatch() {
  const g = new THREE.Group();
  const metal = mat('#4d4a44', { map: TX.rustMetalTexture('#57534b'), r: 0.5, m: 0.6 });
  g.add(m(box(1.5, 0.08, 1.5), mat('#2d2b28', { r: 0.8 }), 0, 0.02, 0, false));
  const hole = m(box(1.2, 0.01, 1.2), new THREE.MeshBasicMaterial({ color: '#000' }), 0, 0.065, 0, false);
  g.add(hole);
  const door = new THREE.Group();
  door.position.set(-0.6, 0.07, 0);
  door.add(m(box(1.2, 0.06, 1.2), metal, 0.6, 0.0, 0));
  for (let i = 0; i < 3; i++) door.add(m(box(1.0, 0.03, 0.08), mat('#33302c', { m: 0.7, r: 0.5 }), 0.6, 0.045, -0.35 + i * 0.35));
  g.add(door);
  return { group: g, door, hole };
}

// ------------------------------------------------------------- bear trap --
export function createBearTrap() {
  const g = new THREE.Group();
  const metal = mat('#5c5650', { r: 0.4, m: 0.8 });
  g.add(m(cyl(0.1, 0.12, 0.04, 10), mat('#3b3631', { r: 0.5, m: 0.7 }), 0, 0.02, 0, false));
  const jaws = [];
  for (const sx of [-1, 1]) {
    const j = new THREE.Group();
    j.position.set(0, 0.04, 0);
    const half = m(new THREE.TorusGeometry(0.22, 0.018, 5, 14, Math.PI), metal, 0, 0, 0, false);
    half.rotation.x = -Math.PI / 2;
    half.rotation.z = sx > 0 ? 0 : Math.PI;
    j.add(half);
    for (let i = 0; i < 6; i++) {
      const a = (i / 5) * Math.PI;
      const tooth = m(new THREE.ConeGeometry(0.018, 0.06, 4), metal, Math.cos(a) * 0.22 * (sx > 0 ? 1 : -1), 0.03, Math.sin(a) * 0.22 * (sx > 0 ? 1 : -1), false);
      j.add(tooth);
    }
    g.add(j);
    jaws.push(j);
  }
  return { group: g, jaws };
}

export function createHatchetProjectile() {
  const g = new THREE.Group();
  g.add(m(cyl(0.015, 0.017, 0.4, 6), mat('#5a4330'), 0, 0, 0));
  g.add(m(box(0.015, 0.1, 0.14), mat('#8f8b83', { r: 0.4, m: 0.7 }), 0, 0.17, 0.06));
  return g;
}

// ---------------------------------------------------------- vegetation --
function bentCylinder(r0, r1, h, segs, bend, seed) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push(new THREE.Vector3(Math.sin(t * 2 + seed) * bend * t, t * h, Math.cos(t * 3 + seed) * bend * t * 0.6));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, segs * 2, 1, 7, false);
  // taper the radius along the tube
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const ring = Math.floor(i / 8);
    const t = ring / (segs * 2);
    const c = curve.getPointAt(Math.min(1, t));
    v.fromBufferAttribute(pos, i).sub(c);
    const r = r0 + (r1 - r0) * t;
    v.multiplyScalar(r).add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function deadTreeGeometry(seed) {
  const rnd = mulberry(seed);
  const geos = [];
  const h = 7 + rnd() * 5;
  geos.push(bentCylinder(0.32, 0.06, h, 6, 0.6 + rnd() * 0.8, seed));
  const nb = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < nb; i++) {
    const bh = h * (0.35 + rnd() * 0.55);
    const len = 1.5 + rnd() * 2.8;
    const b = bentCylinder(0.09, 0.02, len, 3, 0.4, seed + i * 7);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6 + rnd() * 0.7, rnd() * Math.PI * 2, 0, 'YXZ'));
    b.applyQuaternion(q);
    b.translate(0, bh, 0);
    geos.push(b);
  }
  for (const g of geos) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); }
  return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
}

export function pineGeometry(seed) {
  const rnd = mulberry(seed);
  const geos = [];
  const h = 9 + rnd() * 5;
  const trunk = new THREE.CylinderGeometry(0.12, 0.28, h, 7);
  trunk.translate(0, h / 2, 0);
  geos.push(trunk);
  for (let i = 0; i < 5; i++) {
    const r = 2.2 - i * 0.35 + rnd() * 0.3;
    const cone = new THREE.ConeGeometry(r, 2.6, 8);
    cone.translate(0, h * 0.35 + i * 1.5, 0);
    geos.push(cone);
  }
  return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
}

export function rockGeometry(seed) {
  const rnd = mulberry(seed);
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const offs = [];
  for (let i = 0; i < 6; i++) offs.push(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize());
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let k = 1;
    for (const o of offs) k += Math.max(0, v.dot(o)) * 0.18 * (0.5 + rnd() * 0.02);
    k += (rnd() - 0.5) * 0.06;
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y * 0.85, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function mulberry(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export { mulberry };

// -------------------------------------------------------------- vehicles --
export function createCar(color = '#6b2f24') {
  const g = new THREE.Group();
  const paint = mat(color, { map: TX.rustMetalTexture(color), r: 0.55, m: 0.5 });
  const dark = mat('#1d1c1b', { r: 0.8 });
  const glass = mat('#1c2328', { r: 0.2, m: 0.6 });
  g.add(m(box(1.9, 0.65, 4.3), paint, 0, 0.6, 0));
  g.add(m(box(1.7, 0.55, 2.1), paint, 0, 1.18, -0.2));
  g.add(m(box(1.72, 0.45, 2.0), glass, 0, 1.2, -0.2));
  for (const x of [-0.9, 0.9]) for (const z of [-1.4, 1.4]) {
    const w = m(cyl(0.34, 0.34, 0.25, 12), dark, x, 0.34, z);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  return mergeGroup(g);
}

export function createHayBale() {
  const g = new THREE.Group();
  const hay = mat('#8f7a3c', { map: TX.hayTexture() });
  const b = m(box(1, 1, 1), hay);
  g.add(b);
  return g;
}

// --------------------------------------------------------------- campfire --
export function createCampfire() {
  const g = new THREE.Group();
  const wood = mat('#3a2b1e', { map: TX.barkTexture() });
  const char = mat('#120c08', { e: '#ff5a10', ei: 0.35 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const l = m(cyl(0.07, 0.08, 1.0, 8), i % 2 ? wood : char, Math.cos(a) * 0.18, 0.25, Math.sin(a) * 0.18);
    l.rotation.z = Math.cos(a) * 0.9;
    l.rotation.x = -Math.sin(a) * 0.9;
    g.add(l);
  }
  const stone = mat('#3f3d3a', { map: TX.rockTexture() });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const s = m(new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.06, 0), stone, Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75);
    s.rotation.set(Math.random(), Math.random(), Math.random());
    g.add(s);
  }
  return g;
}

export function createLog(len = 2.4) {
  const g = new THREE.Group();
  const l = m(cyl(0.22, 0.24, len, 10), mat('#4a3826', { map: TX.barkTexture() }), 0, 0.22, 0);
  l.rotation.z = Math.PI / 2;
  g.add(l);
  return g;
}
