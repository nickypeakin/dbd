// Procedural low-poly characters with a joint hierarchy and a pose-based
// animation system. Survivors and killers share the same rig.

import * as THREE from 'three';
import { SURVIVORS, KILLERS } from '../../shared/data.js';
import { fabricTexture, rustMetalTexture } from './textures.js';

const mats = new Map();
export function mat(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (mats.has(key)) return mats.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, roughness: o.r ?? 0.85, metalness: o.m ?? 0, map: o.map || null,
    emissive: o.e || 0x000000, emissiveIntensity: o.ei ?? 1, transparent: !!o.t, opacity: o.o ?? 1,
    side: o.side || THREE.FrontSide,
  });
  mats.set(key, m);
  return m;
}

const geoCache = new Map();
function capGeo(r, len) {
  const k = `c${r.toFixed(3)}_${len.toFixed(3)}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CapsuleGeometry(r, len, 4, 10));
  return geoCache.get(k);
}
function sphGeo(r, w = 14, h = 10) {
  const k = `s${r}_${w}_${h}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r, w, h));
  return geoCache.get(k);
}
function boxGeo(x, y, z) {
  const k = `b${x}_${y}_${z}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(x, y, z));
  return geoCache.get(k);
}
function cylGeo(rt, rb, h, s = 10) {
  const k = `y${rt}_${rb}_${h}_${s}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, s));
  return geoCache.get(k);
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

// limb segment hanging down from a joint
function limb(parent, r, len, material, sx = 1, sz = 1) {
  const m = mesh(capGeo(r, len), material, 0, -(len / 2 + r * 0.6), 0);
  m.scale.set(sx, 1, sz);
  parent.add(m);
  return m;
}

function group(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}

const JOINTS = ['hips', 'spine', 'chest', 'head', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR'];

// ------------------------------------------------------------------ rig --
export class Rig {
  constructor(spec) {
    this.spec = spec;
    const s = spec.scale || 1;
    const w = spec.girth || 1;
    this.s = s;
    this.root = new THREE.Group();
    this.body = group(this.root);
    const J = (this.j = {});
    const C = spec.colors;
    const fab = fabricTexture();
    const skin = mat(C.skin, { r: 0.7 });
    const top = mat(C.top, { map: fab });
    const bottom = mat(C.bottom, { map: fab });
    const shoes = mat(C.shoes, { r: 0.6 });
    const sleeveUpper = spec.sleeves === 'none' ? skin : top;
    const sleeveLower = spec.sleeves === 'long' ? top : skin;

    J.hips = group(this.body, 0, 0.95 * s, 0);
    const pelvis = mesh(capGeo(0.13 * s * w, 0.12 * s), bottom, 0, 0, 0);
    pelvis.scale.set(1, 1.15, 0.8);
    pelvis.rotation.z = Math.PI / 2;
    J.hips.add(pelvis);
    J.spine = group(J.hips, 0, 0.06 * s, 0);
    const torso = mesh(capGeo(0.17 * s * w, 0.3 * s), top, 0, 0.22 * s, 0);
    torso.scale.set(1.12, 1, 0.72);
    J.spine.add(torso);
    J.chest = group(J.spine, 0, 0.4 * s, 0);
    J.chest.add(mesh(cylGeo(0.055 * s, 0.065 * s, 0.12 * s), skin, 0, 0.06 * s, 0));
    J.head = group(J.chest, 0, 0.14 * s, 0);
    const head = mesh(sphGeo(0.115 * s, 16, 12), skin, 0, 0.1 * s, 0.005);
    head.scale.set(0.92, 1.12, 1.0);
    J.head.add(head);
    this.headMesh = head;
    // arms
    const sw = 0.2 * s * w;
    J.shL = group(J.chest, sw, -0.02 * s, 0);
    limb(J.shL, 0.052 * s * w, 0.2 * s, sleeveUpper);
    J.elL = group(J.shL, 0, -0.29 * s, 0);
    limb(J.elL, 0.046 * s * w, 0.18 * s, sleeveLower);
    J.handL = group(J.elL, 0, -0.27 * s, 0);
    J.handL.add(mesh(sphGeo(0.048 * s, 10, 8), skin, 0, -0.01, 0));
    J.shR = group(J.chest, -sw, -0.02 * s, 0);
    limb(J.shR, 0.052 * s * w, 0.2 * s, sleeveUpper);
    J.elR = group(J.shR, 0, -0.29 * s, 0);
    limb(J.elR, 0.046 * s * w, 0.18 * s, sleeveLower);
    J.handR = group(J.elR, 0, -0.27 * s, 0);
    J.handR.add(mesh(sphGeo(0.048 * s, 10, 8), skin, 0, -0.01, 0));
    // legs
    J.hipL = group(J.hips, 0.095 * s * w, -0.04 * s, 0);
    limb(J.hipL, 0.075 * s * w, 0.3 * s, bottom);
    J.knL = group(J.hipL, 0, -0.44 * s, 0);
    limb(J.knL, 0.062 * s * w, 0.3 * s, bottom);
    J.knL.add(mesh(boxGeo(0.11 * s, 0.08 * s, 0.24 * s), shoes, 0, -0.42 * s, 0.05 * s));
    J.hipR = group(J.hips, -0.095 * s * w, -0.04 * s, 0);
    limb(J.hipR, 0.075 * s * w, 0.3 * s, bottom);
    J.knR = group(J.hipR, 0, -0.44 * s, 0);
    limb(J.knR, 0.062 * s * w, 0.3 * s, bottom);
    J.knR.add(mesh(boxGeo(0.11 * s, 0.08 * s, 0.24 * s), shoes, 0, -0.42 * s, 0.05 * s));

    // face
    const eyeM = mat('#141010', { r: 0.4 });
    for (const sx of [-1, 1]) J.head.add(mesh(sphGeo(0.016 * s, 6, 5), eyeM, sx * 0.04 * s, 0.12 * s, 0.1 * s));

    this.pose = {};
    for (const k of JOINTS) this.pose[k] = { x: 0, y: 0, z: 0 };
    this.pose.body = { x: 0, y: 0, z: 0, py: 0, pz: 0 };
    this.phase = 0;
    this.t = Math.random() * 10;
    this.meshes = [];
    this.collectMeshes();
  }

  collectMeshes() {
    this.meshes = [];
    this.root.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
  }

  setLayer(layer, on) {
    for (const m of this.meshes) { if (on) m.layers.enable(layer); else m.layers.disable(layer); }
  }

  setVisible(v) { this.root.visible = v; }

  // Blend current joint angles toward the target pose
  apply(target, dt, speed = 12) {
    const k = Math.min(1, dt * speed);
    for (const name of JOINTS) {
      const cur = this.pose[name], tg = target[name] || {};
      cur.x += ((tg.x || 0) - cur.x) * k;
      cur.y += ((tg.y || 0) - cur.y) * k;
      cur.z += ((tg.z || 0) - cur.z) * k;
      const j = this.j[name];
      j.rotation.set(cur.x, cur.y, cur.z);
    }
    const b = this.pose.body, tb = target.body || {};
    for (const key of ['x', 'y', 'z', 'py', 'pz']) b[key] += ((tb[key] || 0) - b[key]) * k;
    this.body.rotation.set(b.x, b.y, b.z);
    this.body.position.set(0, b.py, b.pz);
  }
}

// -------------------------------------------------------------- survivors --
export function createSurvivor(charId) {
  const c = SURVIVORS[charId] || SURVIVORS.dwight;
  const sleeves = c.topStyle === 'tank' ? 'none' : c.topStyle === 'shirt' || c.topStyle === 'sport' ? 'short' : 'long';
  const rig = new Rig({
    scale: 1, girth: c.build || 1, sleeves,
    colors: { skin: c.skin, top: c.top, bottom: c.bottom, shoes: c.shoes },
  });
  rig.kind = 'survivor';
  rig.charId = charId;
  const J = rig.j;
  const hair = mat(c.hair, { r: 0.75 });
  const accent = mat(c.accent, { r: 0.7 });
  // hair
  const cap = mesh(new THREE.SphereGeometry(0.124, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.115, -0.005);
  cap.scale.set(0.95, 1.08, 1.05);
  J.head.add(cap);
  if (c.hairStyle === 'ponytail') {
    const pt = mesh(capGeo(0.04, 0.16), hair, 0, 0.06, -0.12);
    pt.rotation.x = 0.4;
    J.head.add(pt);
  } else if (c.hairStyle === 'bob') {
    const b = mesh(new THREE.SphereGeometry(0.13, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.72), hair, 0, 0.1, -0.01);
    b.scale.set(1.0, 1.05, 1.05);
    J.head.add(b);
  } else if (c.hairStyle === 'messy') {
    for (let i = 0; i < 6; i++) J.head.add(mesh(sphGeo(0.04, 6, 5), hair, (Math.random() - 0.5) * 0.16, 0.19 + Math.random() * 0.03, (Math.random() - 0.5) * 0.16));
  } else if (c.hairStyle === 'beanie') {
    const b = mesh(new THREE.SphereGeometry(0.13, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), accent, 0, 0.13, -0.005);
    J.head.add(b);
    J.head.add(mesh(cylGeo(0.132, 0.132, 0.04, 14), mat('#e8e2d0'), 0, 0.135, -0.005));
  } else if (c.hairStyle === 'slick') {
    cap.material = mat(c.hair, { r: 0.35 });
  }
  if (c.hat) {
    J.head.add(mesh(cylGeo(0.2, 0.2, 0.015, 18), mat('#2c2620'), 0, 0.2, 0));
    J.head.add(mesh(cylGeo(0.1, 0.12, 0.12, 14), mat('#2c2620'), 0, 0.26, 0));
    J.head.add(mesh(cylGeo(0.121, 0.121, 0.025, 14), accent, 0, 0.215, 0));
  }
  if (c.glasses) {
    const gm = mat('#1a1a1a', { r: 0.3, m: 0.5 });
    for (const sx of [-1, 1]) {
      const ring = mesh(new THREE.TorusGeometry(0.03, 0.005, 6, 14), gm, sx * 0.042, 0.12, 0.112);
      J.head.add(ring);
    }
    J.head.add(mesh(boxGeo(0.025, 0.006, 0.006), gm, 0, 0.12, 0.114));
  }
  // clothing details
  if (charId === 'dwight') {
    const tie = mesh(boxGeo(0.04, 0.26, 0.02), accent, 0, 0.26, 0.125);
    J.spine.add(tie);
  }
  if (c.topStyle === 'hoodie') {
    const hood = mesh(sphGeo(0.11, 10, 8), mat(c.top, { map: fabricTexture() }), 0, 0.02, -0.12);
    hood.scale.set(1.3, 0.7, 0.9);
    J.chest.add(hood);
  }
  if (c.topStyle === 'jacket') {
    const collar = mesh(cylGeo(0.09, 0.12, 0.06, 12), mat(c.top), 0, 0.02, 0);
    J.chest.add(collar);
  }
  if (c.topStyle === 'sport') {
    const stripe = mesh(boxGeo(0.36, 0.04, 0.27), accent, 0, 0.32, 0);
    J.spine.add(stripe);
  }
  rig.collectMeshes();
  return rig;
}

// ---------------------------------------------------------------- killers --
export function createKiller(killerId) {
  const k = KILLERS[killerId] || KILLERS.trapper;
  const scale = k.height / 1.75;
  let spec;
  if (killerId === 'trapper') spec = { girth: 1.25, sleeves: 'long', colors: { skin: '#c9b29a', top: '#4b3b2b', bottom: '#3c3125', shoes: '#1f1813' } };
  else if (killerId === 'wraith') spec = { girth: 0.85, sleeves: 'long', colors: { skin: '#5a564d', top: '#3a3731', bottom: '#2f2c27', shoes: '#26231f' } };
  else if (killerId === 'hillbilly') spec = { girth: 1.2, sleeves: 'long', colors: { skin: '#b5876a', top: '#3e5070', bottom: '#33445f', shoes: '#2a1f17' } };
  else spec = { girth: 1.38, sleeves: 'none', colors: { skin: '#d6bfa8', top: '#5a4535', bottom: '#4a3829', shoes: '#2a2018' } };
  const rig = new Rig({ ...spec, scale });
  rig.kind = 'killer';
  rig.charId = killerId;
  const J = rig.j;
  const s = scale;
  if (killerId === 'trapper') {
    const mask = mesh(sphGeo(0.12 * s, 16, 12), mat('#e9e2d4', { r: 0.5 }), 0, 0.105 * s, 0.03 * s);
    mask.scale.set(0.95, 1.15, 0.85);
    J.head.add(mask);
    const teeth = mesh(boxGeo(0.12 * s, 0.035 * s, 0.02 * s), mat('#2a1f18'), 0, 0.05 * s, 0.125 * s);
    J.head.add(teeth);
    for (const sx of [-1, 1]) J.head.add(mesh(sphGeo(0.022 * s, 8, 6), mat('#050505'), sx * 0.045 * s, 0.13 * s, 0.115 * s));
    // apron + traps on belt
    const apron = mesh(boxGeo(0.34 * s, 0.5 * s, 0.03 * s), mat('#5b4a35', { map: fabricTexture() }), 0, -0.1 * s, 0.13 * s);
    J.hips.add(apron);
    const tm = mat('#6b6158', { r: 0.4, m: 0.7 });
    for (const sx of [-1, 1]) {
      const tr = mesh(new THREE.TorusGeometry(0.08 * s, 0.012 * s, 6, 16), tm, sx * 0.2 * s, 0.0, 0.02);
      tr.rotation.y = Math.PI / 2;
      J.hips.add(tr);
    }
    rig.weapon = createWeapon('trapper', s);
    J.handR.add(rig.weapon);
  } else if (killerId === 'wraith') {
    // bandage strips
    const strip = mat('#5b574e', { map: fabricTexture() });
    for (let i = 0; i < 5; i++) {
      const b = mesh(cylGeo(0.155 * s, 0.155 * s, 0.03 * s, 12), strip, 0, 0.06 * s + i * 0.09 * s, 0);
      b.scale.set(1.05, 1, 0.75);
      b.rotation.z = (i % 2 ? 0.12 : -0.12);
      J.spine.add(b);
    }
    const smile = mesh(new THREE.TorusGeometry(0.05 * s, 0.01 * s, 6, 14, Math.PI), mat('#e6e1d6', { e: '#444', ei: 0.3 }), 0, 0.07 * s, 0.1 * s);
    smile.rotation.z = Math.PI;
    J.head.add(smile);
    for (const sx of [-1, 1]) J.head.add(mesh(sphGeo(0.02 * s, 8, 6), mat('#d8d0c0', { e: '#555' }), sx * 0.045 * s, 0.13 * s, 0.1 * s));
    rig.weapon = createWeapon('wraith', s);
    J.handR.add(rig.weapon);
    rig.bell = createBell(s);
    J.handL.add(rig.bell);
  } else if (killerId === 'hillbilly') {
    rig.headMesh.scale.set(1.05, 1.0, 1.15);
    J.head.add(mesh(sphGeo(0.06 * s, 8, 6), mat('#a77a5e'), 0.06 * s, 0.17 * s, 0.03 * s));
    for (const sx of [-1, 1]) J.head.add(mesh(sphGeo(0.018 * s, 8, 6), mat('#e8d8b0', { e: '#332', ei: 0.4 }), sx * 0.05 * s, 0.12 * s, 0.11 * s));
    const straps = mat('#33445f');
    for (const sx of [-1, 1]) J.spine.add(mesh(boxGeo(0.05 * s, 0.42 * s, 0.03 * s), straps, sx * 0.1 * s, 0.25 * s, 0.13 * s));
    rig.weapon = createWeapon('hillbilly', s);
    J.handR.add(rig.weapon);
    rig.saw = createChainsaw(s);
    J.handL.add(rig.saw);
  } else if (killerId === 'huntress') {
    const mask = mesh(sphGeo(0.12 * s, 16, 12), mat('#e2dbcf', { r: 0.6 }), 0, 0.11 * s, 0.035 * s);
    mask.scale.set(0.95, 1.1, 0.95);
    J.head.add(mask);
    for (const sx of [-1, 1]) {
      const ear = mesh(capGeo(0.03 * s, 0.22 * s), mat('#e2dbcf', { r: 0.6 }), sx * 0.06 * s, 0.33 * s, -0.01);
      ear.rotation.z = -sx * 0.18;
      J.head.add(ear);
      J.head.add(mesh(sphGeo(0.022 * s, 8, 6), mat('#0a0a0a'), sx * 0.045 * s, 0.13 * s, 0.13 * s));
    }
    const fur = mesh(sphGeo(0.23 * s, 12, 8), mat('#6d5641', { map: fabricTexture() }), 0, 0.02, -0.03);
    fur.scale.set(1.25, 0.55, 1.0);
    J.chest.add(fur);
    const skirt = mesh(cylGeo(0.2 * s, 0.3 * s, 0.4 * s, 12), mat('#4a3829', { map: fabricTexture() }), 0, -0.2 * s, 0);
    J.hips.add(skirt);
    rig.weapon = createWeapon('huntress', s);
    J.handR.add(rig.weapon);
    rig.hatchet = createHatchet(s);
    rig.hatchet.visible = false;
    J.handL.add(rig.hatchet);
  }
  // carry anchor on the left shoulder
  rig.carry = group(J.chest, 0.24 * s, 0.1 * s, -0.02 * s);
  rig.collectMeshes();
  return rig;
}

export function createWeapon(id, s = 1) {
  const g = new THREE.Group();
  const steel = mat('#8a8c8e', { r: 0.35, m: 0.8 });
  const dark = mat('#2a221c', { r: 0.8 });
  if (id === 'trapper') {
    g.add(mesh(cylGeo(0.02 * s, 0.022 * s, 0.22 * s, 8), dark, 0, -0.06 * s, 0));
    const blade = mesh(boxGeo(0.02 * s, 0.5 * s, 0.11 * s), mat('#9a9690', { r: 0.4, m: 0.7, map: rustMetalTexture('#8a8a86') }), 0, -0.4 * s, 0.03 * s);
    g.add(blade);
    g.rotation.x = -1.3;
  } else if (id === 'wraith') {
    g.add(mesh(cylGeo(0.025 * s, 0.03 * s, 0.6 * s, 8), mat('#cfc6b2', { r: 0.7 }), 0, -0.25 * s, 0));
    for (let i = 0; i < 5; i++) g.add(mesh(sphGeo(0.035 * s, 8, 6), mat('#d6ccb6', { r: 0.7 }), 0, -0.1 * s - i * 0.09 * s, 0));
    const skull = mesh(sphGeo(0.08 * s, 10, 8), mat('#ddd3bf', { r: 0.7 }), 0, -0.6 * s, 0);
    g.add(skull);
    g.rotation.x = -1.2;
  } else if (id === 'hillbilly') {
    g.add(mesh(cylGeo(0.02 * s, 0.022 * s, 0.5 * s, 8), mat('#5a4330'), 0, -0.2 * s, 0));
    g.add(mesh(boxGeo(0.07 * s, 0.07 * s, 0.18 * s), steel, 0, -0.45 * s, 0.03 * s));
    g.rotation.x = -1.2;
  } else if (id === 'huntress') {
    g.add(mesh(cylGeo(0.025 * s, 0.028 * s, 0.75 * s, 8), mat('#4d3a28'), 0, -0.3 * s, 0));
    const blade = mesh(new THREE.CylinderGeometry(0.2 * s, 0.2 * s, 0.025 * s, 16, 1, false, 0, Math.PI * 0.75), mat('#8f8b83', { r: 0.4, m: 0.7 }), 0.0, -0.62 * s, 0.05 * s);
    blade.rotation.z = Math.PI / 2;
    blade.rotation.y = Math.PI / 2;
    g.add(blade);
    g.rotation.x = -1.3;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function createHatchet(s = 1) {
  const g = new THREE.Group();
  g.add(mesh(cylGeo(0.015 * s, 0.017 * s, 0.38 * s, 6), mat('#5a4330'), 0, -0.14 * s, 0));
  const b = mesh(boxGeo(0.015 * s, 0.1 * s, 0.13 * s), mat('#8f8b83', { r: 0.4, m: 0.7 }), 0, -0.3 * s, 0.06 * s);
  g.add(b);
  g.rotation.x = -1.2;
  return g;
}

export function createChainsaw(s = 1) {
  const g = new THREE.Group();
  const body = mesh(boxGeo(0.16 * s, 0.22 * s, 0.38 * s), mat('#8a1d14', { r: 0.6, m: 0.3 }), 0, -0.05 * s, 0.05 * s);
  g.add(body);
  g.add(mesh(boxGeo(0.04 * s, 0.1 * s, 0.75 * s), mat('#9a9a9a', { r: 0.3, m: 0.9 }), 0, -0.05 * s, 0.6 * s));
  g.add(mesh(cylGeo(0.02 * s, 0.02 * s, 0.2 * s, 8), mat('#222'), 0, 0.12 * s, 0.0));
  g.position.set(0, -0.05, 0.1);
  return g;
}

export function createBell(s = 1) {
  const g = new THREE.Group();
  g.add(mesh(cylGeo(0.012 * s, 0.012 * s, 0.25 * s, 6), mat('#4a3a2a'), 0, -0.05 * s, 0));
  const bell = mesh(new THREE.CylinderGeometry(0.05 * s, 0.11 * s, 0.16 * s, 12, 1, true), mat('#6e5a3a', { r: 0.4, m: 0.7, side: THREE.DoubleSide }), 0, -0.24 * s, 0);
  g.add(bell);
  return g;
}

// ------------------------------------------------------------- animation --
const sin = Math.sin, cos = Math.cos;

// Survivor poses. st: {anim, speed, lt, injured, crouch, t, flash}
export function survivorPose(rig, st, dt) {
  const t = (rig.t += dt);
  const P = {};
  const inj = st.injured;
  const a = st.anim;
  const breath = sin(t * 1.8) * 0.02;
  const idleArms = () => {
    P.shL = { x: 0.05, z: 0.1 }; P.shR = { x: 0.05, z: -0.1 };
    P.elL = { x: -0.18 }; P.elR = { x: -0.18 };
  };
  const walkCycle = (amp, lean, armAmp, elbow) => {
    const s = sin(rig.phase), c = cos(rig.phase);
    P.hipL = { x: -s * amp }; P.hipR = { x: s * amp };
    P.knL = { x: Math.max(0, c) * amp * 1.5 + 0.12 }; P.knR = { x: Math.max(0, -c) * amp * 1.5 + 0.12 };
    P.shL = { x: s * armAmp, z: 0.08 }; P.shR = { x: -s * armAmp, z: -0.08 };
    P.elL = { x: elbow }; P.elR = { x: elbow };
    P.spine = { x: lean, y: s * 0.08 };
    P.body = { py: -Math.abs(c) * 0.05 };
    P.head = { x: -lean * 0.6 };
  };
  if (a === 'idle' || a === 'unhooked') {
    idleArms();
    P.spine = { x: 0.02 + breath + (inj ? 0.22 : 0) };
    P.head = { x: inj ? 0.1 : 0, y: sin(t * 0.35) * 0.3 };
    P.knL = { x: 0.05 }; P.knR = { x: 0.05 };
    if (inj) { P.shL = { x: -0.3, z: 0.35 }; P.elL = { x: -1.7 }; }
  } else if (a === 'walk' || a === 'run') {
    const run = a === 'run';
    const stride = run ? 2.4 : 1.5;
    rig.phase += (st.speed * dt * Math.PI * 2) / stride;
    walkCycle(run ? 0.8 : 0.42, run ? 0.28 : 0.05, run ? 0.9 : 0.35, run ? -1.25 : -0.3);
    if (inj) {
      P.spine.x += 0.18;
      P.shL = { x: -0.3, z: 0.35 }; P.elL = { x: -1.7 };
    }
  } else if (a === 'crouch' || a === 'crouchwalk') {
    rig.phase += (st.speed * dt * Math.PI * 2) / 1.0;
    const s = a === 'crouchwalk' ? sin(rig.phase) : 0;
    P.body = { py: -0.42 };
    P.hipL = { x: -1.45 - s * 0.3 }; P.hipR = { x: -1.45 + s * 0.3 };
    P.knL = { x: 2.1 + s * 0.2 }; P.knR = { x: 2.1 - s * 0.2 };
    P.spine = { x: 0.6 }; P.head = { x: -0.45 };
    P.shL = { x: -0.5 + s * 0.2, z: 0.15 }; P.shR = { x: -0.5 - s * 0.2, z: -0.15 };
    P.elL = { x: -0.9 }; P.elR = { x: -0.9 };
  } else if (a === 'crawl' || a === 'dying') {
    rig.phase += (st.speed * dt * Math.PI * 2) / 0.8;
    const s = a === 'crawl' ? sin(rig.phase) : sin(t * 0.8) * 0.15;
    P.body = { x: 1.42, py: 0.08, pz: -0.95 };
    P.shL = { x: -2.7 + s * 0.5, z: 0.2 }; P.shR = { x: -2.7 - s * 0.5, z: -0.2 };
    P.elL = { x: -0.4 - Math.max(0, s) * 0.6 }; P.elR = { x: -0.4 - Math.max(0, -s) * 0.6 };
    P.hipL = { x: 0.1 + s * 0.15 }; P.hipR = { x: 0.1 - s * 0.15 };
    P.knL = { x: 0.4 }; P.knR = { x: 0.2 };
    P.head = { x: -0.9 };
  } else if (a === 'repair' || a === 'heal' || a === 'cleanse' || a === 'chest' || a === 'kneel') {
    P.body = { py: -0.45 };
    P.hipL = { x: -1.5 }; P.knL = { x: 1.55 };
    P.hipR = { x: -0.2 }; P.knR = { x: 2.3 };
    P.spine = { x: 0.35 };
    const w = a === 'repair' ? sin(t * 9) * 0.18 : a === 'chest' ? sin(t * 6) * 0.2 : sin(t * 4) * 0.08;
    const low = a === 'heal' ? 0.3 : a === 'cleanse' || a === 'chest' ? 0.5 : 0;
    P.shL = { x: -1.25 + low + w, z: 0.1 }; P.shR = { x: -1.25 + low - w, z: -0.1 };
    P.elL = { x: -0.6 }; P.elR = { x: -0.6 };
    P.head = { x: 0.2 };
  } else if (a === 'selfheal') {
    P.spine = { x: 0.3 };
    P.shL = { x: -0.6, z: 0.3 }; P.elL = { x: -1.2 };
    P.shR = { x: -0.9, z: -0.5 + sin(t * 5) * 0.08 }; P.elR = { x: -1.4 };
    P.head = { x: 0.4, y: 0.3 };
    P.knL = { x: 0.2 }; P.knR = { x: 0.2 }; P.body = { py: -0.04 };
  } else if (a === 'unhook') {
    P.shL = { x: -2.6, z: 0.2 }; P.shR = { x: -2.6, z: -0.2 };
    P.elL = { x: -0.4 }; P.elR = { x: -0.4 };
    P.spine = { x: -0.1 }; P.head = { x: -0.4 };
  } else if (a === 'gate') {
    P.shR = { x: -1.5 + sin(t * 0.8) * 0.15, z: -0.1 }; P.elR = { x: -0.5 };
    P.shL = { x: -0.4, z: 0.2 }; P.elL = { x: -0.6 };
    P.spine = { x: 0.1 };
  } else if (a === 'vault') {
    const p = st.lt || 0;
    const sp = st.vt === 'fast' ? 1 : st.vt === 'med' ? 0.85 : 0.6;
    P.spine = { x: 0.7 * sp }; P.head = { x: -0.5 };
    P.hipL = { x: -1.4 }; P.knL = { x: 1.8 };
    P.hipR = { x: -0.6 + p }; P.knR = { x: 1.0 };
    P.shL = { x: -1.6, z: 0.2 }; P.shR = { x: -1.6, z: -0.2 };
    P.elL = { x: -0.3 }; P.elR = { x: -0.3 };
    P.body = { py: sin(Math.min(1, p) * Math.PI) * (st.vt === 'slow' ? 0.7 : 0.5) };
  } else if (a === 'drop') {
    P.shL = { x: -1.9, z: 0.1 }; P.shR = { x: -1.9, z: -0.1 };
    P.elL = { x: -0.2 }; P.elR = { x: -0.2 };
    P.spine = { x: 0.5 };
  } else if (a === 'carried') {
    const w = st.wiggle ? sin(t * 12) * 0.35 : sin(t * 1.5) * 0.05;
    P.body = { py: -0.95 };
    P.spine = { x: 0.3, z: w * 0.4 };
    P.shL = { x: 0.3 + w, z: 0.3 }; P.shR = { x: 0.3 - w, z: -0.3 };
    P.elL = { x: -0.3 }; P.elR = { x: -0.3 };
    P.hipL = { x: -0.8 - w * 0.5 }; P.hipR = { x: -0.8 + w * 0.5 };
    P.knL = { x: 1.2 }; P.knR = { x: 1.0 };
    P.head = { x: 0.5 };
  } else if (a === 'hooked' || a === 'struggle') {
    const str = a === 'struggle';
    const f = str ? sin(t * 7) : sin(t * 1.2) * 0.2;
    P.body = { py: 0.42, z: 0.12 };
    P.shL = { x: -2.9, z: 0.35 }; P.elL = { x: -0.5 };
    P.shR = str ? { x: -2.4 + f * 0.6, z: -0.4 } : { x: 0.15 + f * 0.1, z: -0.15 };
    P.elR = { x: str ? -0.8 : -0.15 };
    P.hipL = { x: f * (str ? 0.6 : 0.1) }; P.hipR = { x: -f * (str ? 0.6 : 0.1) };
    P.knL = { x: 0.3 + Math.max(0, f) * 0.6 }; P.knR = { x: 0.3 };
    P.head = { x: str ? -0.5 : 0.6, z: 0.2 };
    P.spine = { x: 0.08, z: -0.12 };
  } else if (a === 'trapped') {
    P.body = { py: -0.25 };
    P.hipL = { x: -0.9 }; P.knL = { x: 1.2 };
    P.hipR = { x: 0.1 }; P.knR = { x: 0.6 };
    P.spine = { x: 0.7 + sin(t * 6) * 0.05 };
    P.shL = { x: -1.0, z: 0.1 }; P.shR = { x: -1.0, z: -0.1 };
    P.elL = { x: -0.2 }; P.elR = { x: -0.2 };
  } else if (a === 'sit') {
    P.body = { py: -0.5 };
    P.hipL = { x: -1.5 }; P.hipR = { x: -1.5 };
    P.knL = { x: 1.55 }; P.knR = { x: 1.45 };
    P.spine = { x: 0.25 + breath };
    P.shL = { x: -0.8, z: 0.1 }; P.shR = { x: -0.8, z: -0.1 };
    P.elL = { x: -0.7 }; P.elR = { x: -0.7 };
    P.head = { x: 0.15, y: sin(t * 0.3 + rig.s) * 0.25 };
  } else if (a === 'stand') {
    idleArms();
    P.spine = { x: breath };
    P.head = { y: sin(t * 0.4) * 0.3 };
    P.shL = { x: 0.1, z: 0.3 }; P.elL = { x: -1.8 }; P.shR = { x: 0.1, z: -0.3 }; P.elR = { x: -1.8 };
  } else if (a === 'sacrifice') {
    P.body = { py: 0.42 + (st.lt || 0) * 1.5 };
    P.shL = { x: -2.8, z: 0.8 }; P.shR = { x: -2.8, z: -0.8 };
    P.spine = { x: -0.3 }; P.head = { x: -0.7 };
  } else {
    idleArms();
  }
  if (st.flash && (a === 'idle' || a === 'walk' || a === 'run' || a === 'crouch' || a === 'crouchwalk')) {
    P.shR = { x: -1.45 - (st.pitch || 0), z: -0.05 }; P.elR = { x: -0.1 };
  }
  rig.apply(P, dt, a === 'vault' ? 18 : 10);
}

// Killer poses. st: {anim, speed, t, atk, ah, pw, carrying, lt}
export function killerPose(rig, st, dt) {
  const t = (rig.t += dt);
  const P = {};
  const a = st.anim;
  const s = sin(rig.phase), c = cos(rig.phase);
  const moving = st.speed > 0.3;
  if (moving) rig.phase += (st.speed * dt * Math.PI * 2) / 2.6;
  const amp = moving ? Math.min(0.55, 0.2 + st.speed * 0.08) : 0;
  P.hipL = { x: -s * amp }; P.hipR = { x: s * amp };
  P.knL = { x: Math.max(0, c) * amp * 1.4 + 0.1 }; P.knR = { x: Math.max(0, -c) * amp * 1.4 + 0.1 };
  P.spine = { x: 0.12 + sin(t * 1.5) * 0.02, y: moving ? s * 0.06 : 0 };
  P.body = { py: moving ? -Math.abs(c) * 0.06 : 0 };
  P.shL = { x: moving ? s * 0.35 : 0.1, z: 0.15 }; P.elL = { x: -0.35 };
  P.shR = { x: -0.5 - (moving ? s * 0.2 : 0), z: -0.12 }; P.elR = { x: -0.9 };
  P.head = { x: -0.05 };
  if (st.carrying) { P.shL = { x: -2.25, z: 0.25 }; P.elL = { x: -1.7 }; }
  if (st.atk === 'lunge') {
    P.shR = { x: -2.9, z: -0.45 }; P.elR = { x: -0.6 }; P.spine = { x: 0.35, y: -0.45 };
  } else if (st.atk === 'cd') {
    if (st.ah) { P.shR = { x: -0.6, z: 0.6 }; P.elR = { x: -1.5 }; P.shL = { x: -0.9, z: -0.4 }; P.elL = { x: -1.3 }; P.spine = { x: 0.3, y: 0.25 }; P.head = { x: 0.3 }; }
    else { P.shR = { x: 0.5, z: 0.35 }; P.elR = { x: -0.3 }; P.spine = { x: 0.45, y: 0.5 }; }
  }
  switch (a) {
    case 'pickup': P.spine = { x: 1.0 }; P.shL = { x: -1.2 }; P.shR = { x: -1.2 }; P.knL = { x: 0.6 }; P.knR = { x: 0.6 }; P.body = { py: -0.15 }; break;
    case 'hookput': P.shL = { x: -2.6, z: 0.2 }; P.shR = { x: -2.4, z: -0.2 }; P.elL = { x: -0.5 }; P.elR = { x: -0.5 }; P.spine = { x: -0.15 }; break;
    case 'break': {
      const k = sin(t * 9);
      P.hipR = { x: -1.2 + k * 0.4 }; P.knR = { x: 1.2 - k * 0.5 }; P.spine = { x: 0.35 }; P.shL = { x: -0.5, z: 0.4 }; P.shR = { x: -0.5, z: -0.4 };
      break;
    }
    case 'kick': {
      const k = sin(t * 7);
      P.hipR = { x: -0.9 - k * 0.4 }; P.knR = { x: 0.4 + Math.max(0, k) * 0.6 }; P.spine = { x: 0.25 }; break;
    }
    case 'vault': P.spine = { x: 0.6 }; P.hipL = { x: -1.0 }; P.knL = { x: 1.2 }; P.shL = { x: -1.3 }; P.shR = { x: -1.3 }; P.body = { py: sin(Math.min(1, st.lt || 0) * Math.PI) * 0.45 }; break;
    case 'stun': P.shL = { x: -2.1, z: 0.5 }; P.shR = { x: -2.1, z: -0.5 }; P.elL = { x: -2.2 }; P.elR = { x: -2.2 }; P.spine = { x: -0.2 + sin(t * 4) * 0.1, z: sin(t * 3) * 0.1 }; P.head = { x: -0.4 }; break;
    case 'search': P.shL = { x: -1.6, z: 0.5 }; P.shR = { x: -1.6, z: -0.5 }; P.elL = { x: -0.3 }; P.elR = { x: -0.3 }; P.spine = { x: 0.15 }; break;
    case 'settrap': P.body = { py: -0.5 }; P.hipL = { x: -1.5 }; P.knL = { x: 1.6 }; P.hipR = { x: -0.2 }; P.knR = { x: 2.2 }; P.spine = { x: 0.6 }; P.shL = { x: -1.0 }; P.shR = { x: -1.0 }; break;
    case 'reload': P.shL = { x: -1.4, z: 0.4 }; P.shR = { x: -1.4, z: -0.4 }; P.elL = { x: -0.6 }; P.elR = { x: -0.6 }; break;
    case 'bell': P.shL = { x: -2.4 + sin(t * 10) * 0.15, z: 0.2 }; P.elL = { x: -0.6 }; break;
    case 'rev': P.shL = { x: -1.0, z: -0.2 }; P.elL = { x: -0.5 }; P.shR = { x: -0.9, z: 0.15 }; P.elR = { x: -0.6 }; P.spine = { x: 0.2, z: sin(t * 40) * 0.02 }; break;
    case 'saw': P.shL = { x: -1.1, z: -0.2 }; P.elL = { x: -0.4 }; P.shR = { x: -1.0, z: 0.2 }; P.elR = { x: -0.5 }; P.spine = { x: 0.4 }; break;
    case 'wind': P.shL = { x: -2.5, z: 0.5 }; P.elL = { x: -1.0 }; P.spine = { x: 0.1, y: 0.4 }; break;
    case 'sawhit': P.shL = { x: -0.8 }; P.shR = { x: -0.8 }; P.spine = { x: 0.5 }; break;
  }
  rig.apply(P, dt, st.atk === 'lunge' || st.atk === 'cd' ? 16 : 9);
  if (rig.saw) rig.saw.rotation.x = a === 'rev' || a === 'saw' ? -0.2 : -1.2;
  if (rig.hatchet) rig.hatchet.visible = a === 'wind';
}

// Render a portrait image of a character (data URL) with the given renderer.
export function renderPortrait(renderer, rig, w = 132, h = 164) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#c8d0e0', '#2a2018', 1.4));
  const dl = new THREE.DirectionalLight('#ffd8b0', 2.4);
  dl.position.set(1.5, 3, 3);
  scene.add(dl);
  const rim = new THREE.DirectionalLight('#ff6040', 1.6);
  rim.position.set(-2, 2, -2);
  scene.add(rim);
  scene.add(rig.root);
  const st = rig.kind === 'killer' ? { anim: 'idle', speed: 0 } : { anim: 'stand', speed: 0 };
  for (let i = 0; i < 30; i++) (rig.kind === 'killer' ? killerPose : survivorPose)(rig, st, 0.1);
  const H = rig.kind === 'killer' ? rig.s * 1.75 : 1.75;
  const cam = new THREE.PerspectiveCamera(24, w / h, 0.1, 50);
  cam.position.set(0.5, H * 0.86, 3.6 * (H / 1.75));
  cam.lookAt(0, H * 0.78, 0);
  rig.root.rotation.y = 0.35;
  const rt = new THREE.WebGLRenderTarget(w, h);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    img.data.set(buf.subarray(src, src + w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  scene.remove(rig.root);
  return cv.toDataURL();
}
