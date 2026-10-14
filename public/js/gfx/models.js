// Procedural characters with a joint hierarchy and a pose-based animation
// system. Survivors and killers share the same rig: tapered limbs whose ends
// are spheres centred on the joints (so knees and elbows never open a gap),
// sculpted heads with faces and hair, and an outfit per character. Once a
// character is built, the static parts on each joint are merged per material
// to keep draw calls low.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURVIVORS, KILLERS } from '../../shared/data.js';
import {
  fabricTexture, rustMetalTexture, hairTexture, denimTexture, skinTexture, leatherTexture,
  furTexture, knitTexture, floralTexture, bloodyTexture,
} from './textures.js';

const mats = new Map();
export function mat(color, o = {}) {
  const key = [color, o.r, o.m, o.map ? o.map.uuid : '', o.e, o.ei, o.t, o.o, o.side].join('|');
  if (mats.has(key)) return mats.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, roughness: o.r ?? 0.85, metalness: o.m ?? 0, map: o.map || null,
    emissive: o.e || 0x000000, emissiveIntensity: o.ei ?? 1, transparent: !!o.t, opacity: o.o ?? 1,
    side: o.side || THREE.FrontSide,
  });
  mats.set(key, m);
  return m;
}

// Skin: a faint glow of its own stands in for light scattering through skin,
// so faces stay readable when they tilt away from the light.
function skinMat(color, r = 0.62, map = skinTexture()) {
  return mat(color, { r, map, e: color, ei: 0.06 });
}

// Darken/lighten and blend hex colours for derived materials (lips, stubble).
function shade(hex, k, toward = null, t = 0) {
  const c = new THREE.Color(hex);
  if (toward) c.lerp(new THREE.Color(toward), t);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}

// ------------------------------------------------------------ geometry --
const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const f4 = (v) => v.toFixed(4);
const sph = (r, w = 12, h = 8) => cached(`s${f4(r)}_${w}_${h}`, () => new THREE.SphereGeometry(r, w, h));
const box = (x, y, z) => cached(`b${f4(x)}_${f4(y)}_${f4(z)}`, () => new THREE.BoxGeometry(x, y, z));
const rbox = (x, y, z, r = 0.01, sg = 2) => cached(`r${f4(x)}_${f4(y)}_${f4(z)}_${f4(r)}_${sg}`, () => new RoundedBoxGeometry(x, y, z, sg, Math.min(r, Math.min(x, y, z) / 2 - 1e-4)));
const cyl = (rt, rb, h, s = 12) => cached(`y${f4(rt)}_${f4(rb)}_${f4(h)}_${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const tor = (r, t, rs = 6, ts = 18, arc = Math.PI * 2) => cached(`t${f4(r)}_${f4(t)}_${rs}_${ts}_${f4(arc)}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
const cone = (r, h, s = 6) => cached(`k${f4(r)}_${f4(h)}_${s}`, () => new THREE.ConeGeometry(r, h, s));

// Tapered capsule hanging from the origin down to (0, -len, 0). Both ends are
// spheres centred on those points (radius r0 and r1), so a limb can rotate
// about either end without opening a seam. `bulge` swells the middle (calf,
// biceps) at `at` (0 = bottom, 1 = top).
function seg(r0, r1, len, bulge = 0, at = 0.5, rs = 12) {
  const thin = Math.max(r0, r1) < 0.022;
  if (thin) rs = Math.min(rs, 7);
  return cached(`g${f4(r0)}_${f4(r1)}_${f4(len)}_${f4(bulge)}_${at}_${rs}`, () => {
    const pts = [];
    const sinT = Math.max(-0.9, Math.min(0.9, (r0 - r1) / len));
    const tt = Math.asin(sinT);
    const N = thin ? 2 : 4;
    for (let i = 0; i <= N; i++) {
      const a = -Math.PI / 2 + (tt + Math.PI / 2) * (i / N);
      pts.push(new THREE.Vector2(Math.max(1e-5, r1 * Math.cos(a)), -len + r1 * Math.sin(a)));
    }
    const x1 = r1 * Math.cos(tt), y1 = -len + r1 * sinT, x0 = r0 * Math.cos(tt), y0 = r0 * sinT;
    const M = thin && !bulge ? 1 : 6;
    for (let i = 1; i < M; i++) {
      const f = i / M;
      pts.push(new THREE.Vector2(x1 + (x0 - x1) * f + bulge * Math.exp(-(((f - at) / 0.3) ** 2)), y1 + (y0 - y1) * f));
    }
    for (let i = 0; i <= N; i++) {
      const a = tt + (Math.PI / 2 - tt) * (i / N);
      pts.push(new THREE.Vector2(Math.max(1e-5, r0 * Math.cos(a)), r0 * Math.sin(a)));
    }
    return new THREE.LatheGeometry(pts, rs);
  });
}

// Solid of revolution from [radius, y] pairs (bottom to top).
function lathe(profile, s, rs = 18) {
  return cached(`l${s}_${rs}_${profile.join(',')}`, () => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-5, r * s), y * s)), rs));
}

// radius of a lathe profile at height y
function profileR(profile, y) {
  if (y <= profile[0][1]) return profile[0][0];
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1], [r1, y1] = profile[i];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
  }
  return 0;
}

function put(parent, geo, material, p = null, r = null, s = null) {
  const m = new THREE.Mesh(geo, material);
  if (p) m.position.set(p[0], p[1], p[2]);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  if (s != null) { if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(s[0], s[1], s[2]); }
  m.castShadow = true;
  parent.add(m);
  return m;
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);

// A tapered capsule from point a to point b.
function link(parent, a, b, r0, r1, material, bulge = 0, squash = null) {
  const d = V().subVectors(b, a);
  const len = Math.max(1e-4, d.length());
  const m = put(parent, seg(r0, r1, len, bulge, 0.5, 10), material, [a.x, a.y, a.z]);
  m.quaternion.setFromUnitVectors(DOWN, d.normalize());
  if (squash) m.scale.set(squash[0], 1, squash[1]);
  return m;
}

// A chain of links through a list of points with radii.
function chain(parent, pts, radii, material) {
  for (let i = 0; i + 1 < pts.length; i++) link(parent, pts[i], pts[i + 1], radii[i], radii[i + 1], material);
}

const gauss = (v, w) => Math.exp(-(v * v) / (w * w));
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const az = (n) => n.z / Math.max(1e-4, Math.hypot(n.x, n.z)); // 1 toward the face, -1 toward the back
const wobble = (n, f, seed = 0) => Math.sin(n.x * f + 1.3 + seed) * Math.sin(n.y * f * 0.9 + 0.4 + seed * 2) * Math.sin(n.z * f * 1.1 + 2.1 + seed * 3);

// Average the normals of coincident vertices (UV seams, poles).
function smoothNormals(geo) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
    let e = map.get(k);
    if (!e) map.set(k, (e = { n: V(), ids: [] }));
    e.n.x += nor.getX(i); e.n.y += nor.getY(i); e.n.z += nor.getZ(i);
    e.ids.push(i);
  }
  for (const e of map.values()) {
    if (e.ids.length < 2) continue;
    e.n.normalize();
    for (const i of e.ids) nor.setXYZ(i, e.n.x, e.n.y, e.n.z);
  }
  nor.needsUpdate = true;
}

// --------------------------------------------------------------- heads --
// The head is a sphere sculpted into a skull: an ellipsoid with a narrower
// jaw, a chin, a brow ridge and a rounder back, plus optional lumps.
// H = { R, jaw, chin, brow, cheek, lumps: [{ dir, amt, w }] }
function headPoint(n, H, out) {
  let x = n.x * 0.86, y = n.y * 1.1, z = n.z * 0.98;
  if (n.y < 0) {
    const k = n.y * n.y;
    x *= 1 - H.jaw * k;
    if (n.z > 0) z += (H.chin ?? 0.12) * Math.max(0, -n.y - 0.5) * n.z;
    else z *= 1 - 0.32 * k;
  } else if (n.z < 0) z *= 1 + 0.08 * n.y;
  if (n.z > 0) {
    z -= 0.07 * n.z * n.z * Math.max(0, 1 - Math.abs(n.y + 0.1) * 1.6);
    z += (H.brow ?? 0.04) * gauss(n.y - 0.24, 0.1) * gauss(n.x, 0.5) * n.z;
    x *= 1 + (H.cheek ?? 0.03) * gauss(n.y + 0.12, 0.2) * n.z;
  }
  let k = 1;
  for (const L of H.lumps || []) k += L.amt * gauss(1 - (n.x * L.dir.x + n.y * L.dir.y + n.z * L.dir.z), L.w);
  out.set(x * H.R * k, y * H.R * k, z * H.R * k);
  return out;
}

function headGeo(H) {
  const g = new THREE.SphereGeometry(1, 28, 20);
  const pos = g.attributes.position, n = V(), p = V();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    headPoint(n, H, p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  smoothNormals(g);
  g.userData.owned = true;
  return g;
}

// A layer over the head: cover(n) in 0..1 says where it is (vertices with no
// cover sink under the skin, which makes soft hairlines and mask edges) and
// thick(n) is its height above the skin, both in units of the head radius.
function shellGeo(H, cover, thick, w = 34, h = 24) {
  const g = new THREE.SphereGeometry(1, w, h);
  const pos = g.attributes.position, n = V(), p = V();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    headPoint(n, H, p);
    const c = Math.max(0, Math.min(1, cover(n)));
    const lift = c > 0 ? -0.12 * (1 - c) + thick(n) * c : -0.12;
    p.addScaledVector(n, lift * H.R);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  smoothNormals(g);
  g.userData.owned = true;
  return g;
}

// Hairline as a height on the head that varies from the face to the back.
function hairline(n, yFace, ySide, yBack, soft = 0.07) {
  const f = az(n);
  const yt = f > 0 ? ySide + (yFace - ySide) * f * f : ySide + (yBack - ySide) * f * f;
  return sstep(yt - soft, yt + soft, n.y);
}
// 0 around the ears, 1 elsewhere
const earGap = (n, w = 0.36) => 1 - gauss(Math.hypot(Math.abs(n.x) - 0.95, n.y + 0.1, n.z + 0.08), w);

// Builds a face on a head joint and finds points on its surface.
class Head {
  constructor(rig, H, skin) {
    this.rig = rig;
    this.H = H;
    this.j = rig.j.head;
    this.o = V(0, 0.1 * rig.s, 0.005 * rig.s);
    this.geo = headGeo(H);
    this.mesh = put(this.j, this.geo, skin, [this.o.x, this.o.y, this.o.z]);
    this.skin = skin;
    this.probe = new THREE.Mesh(this.geo);
    this.ray = new THREE.Raycaster();
  }

  // Point on the front of the head at (x, y) in head radii from its centre,
  // in head-joint space, plus the surface normal there. `out` pushes it off
  // the surface (in head radii).
  front(x, y, out = 0) {
    const R = this.H.R;
    this.ray.set(V(x * R, y * R, 4 * R), V(0, 0, -1));
    const hit = this.ray.intersectObject(this.probe)[0];
    const n = hit ? hit.face.normal.clone() : V(0, 0, 1);
    const p = hit ? hit.point.clone() : V(x * R, y * R, R);
    return { p: p.addScaledVector(n, out * R).add(this.o), n };
  }

  side(sx, y, z, out = 0) {
    const R = this.H.R;
    this.ray.set(V(sx * 4 * R, y * R, z * R), V(-sx, 0, 0));
    const hit = this.ray.intersectObject(this.probe)[0];
    const n = hit ? hit.face.normal.clone() : V(sx, 0, 0);
    const p = hit ? hit.point.clone() : V(sx * R, y * R, z * R);
    return { p: p.addScaledVector(n, out * R).add(this.o), n };
  }

  shell(cover, thick, material, w, h) {
    return put(this.j, shellGeo(this.H, cover, thick, w, h), material, [this.o.x, this.o.y, this.o.z]);
  }

  eyes(iris = '#4a3a2a', o = {}) {
    const R = this.H.R;
    const white = mat('#e9e4da', { r: 0.35 });
    const irisM = mat(iris, { r: 0.3 });
    const pupil = mat('#060606', { r: 0.2 });
    const lidGeo = cached(`lid${f4(R)}`, () => new THREE.SphereGeometry(0.15 * R, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.5));
    const sizes = o.sizes || [1, 1];
    const ys = o.ys || [0.02, 0.02];
    [-1, 1].forEach((sx, i) => {
      const k = sizes[i];
      const { p, n } = this.front(sx * 0.31, ys[i]);
      const c = p.clone().addScaledVector(n, -0.07 * R * k);
      const fwd = n.clone().add(V(0, 0, 1.5)).normalize();
      const er = 0.135 * R * k;
      put(this.j, sph(er, 12, 8), white, [c.x, c.y, c.z]);
      const ic = c.clone().addScaledVector(fwd, er - 0.035 * R * k);
      put(this.j, sph(0.07 * R * k, 10, 6), irisM, [ic.x, ic.y, ic.z]);
      const pc = c.clone().addScaledVector(fwd, er - 0.004 * R * k);
      put(this.j, sph(0.034 * R * k, 8, 6), pupil, [pc.x, pc.y, pc.z]);
      // upper lid: a cap over the eyeball that rolls down to blink
      const lid = put(this.j, lidGeo, this.skin, [c.x, c.y, c.z], [o.lid ?? -0.55, sx * 0.15, 0], k);
      lid.userData.keep = true;
      this.rig.lids.push({ m: lid, open: o.lid ?? -0.55, closed: 0.75 });
    });
  }

  brows(color, o = {}) {
    const R = this.H.R;
    const m = mat(color, { r: 0.9 });
    const t = o.thick ?? 1;
    for (const sx of [-1, 1]) {
      const a = this.front(sx * 0.14, 0.27 + (o.inner ?? 0), 0.03).p;
      const b = this.front(sx * 0.46, 0.27 + (o.outer ?? 0.02), 0.02).p;
      link(this.j, a, b, 0.045 * R * t, 0.03 * R * t, m, 0, [1, 0.6]);
    }
  }

  nose(o = {}) {
    const R = this.H.R;
    const len = o.len ?? 1, w = o.w ?? 1;
    const top = this.front(0, -0.02, -0.02).p;
    const tip = this.front(0, -0.28 * len, 0.1 * len).p;
    link(this.j, top, tip, 0.05 * R * w, 0.075 * R * w, this.skin);
    for (const sx of [-1, 1]) {
      const al = this.front(sx * 0.09 * w, -0.3 * len, 0.02).p;
      put(this.j, sph(0.055 * R * w, 8, 6), this.skin, [al.x, al.y, al.z]);
    }
  }

  mouth(lip, o = {}) {
    const R = this.H.R;
    const lipM = mat(lip, { r: 0.55 });
    const y = o.y ?? -0.5, w = o.w ?? 1;
    link(this.j, this.front(-0.15 * w, y, 0.0).p, this.front(0.15 * w, y, 0.0).p, 0.035 * R, 0.035 * R, lipM, 0.008 * R);
    link(this.j, this.front(-0.12 * w, y - 0.08, 0.0).p, this.front(0.12 * w, y - 0.08, 0.0).p, 0.045 * R, 0.045 * R, lipM, 0.008 * R);
    link(this.j, this.front(-0.14 * w, y - 0.04, 0.025).p, this.front(0.14 * w, y - 0.04, 0.025).p, 0.012 * R, 0.012 * R, mat('#3a1c18', { r: 0.8 }));
  }

  ears() {
    const R = this.H.R;
    for (const sx of [-1, 1]) {
      const { p } = this.side(sx, -0.08, -0.05, -0.02);
      put(this.j, sph(0.17 * R, 10, 8), this.skin, [p.x, p.y, p.z], [0, sx * 0.35, 0], [0.38, 1.05, 0.7]);
    }
  }

  glasses(shape = 'round') {
    const R = this.H.R;
    const frame = mat('#18181a', { r: 0.3, m: 0.6 });
    const glass = mat('#c8d8e0', { r: 0.05, m: 0.2, t: true, o: 0.18 });
    const inner = [], outer = [];
    for (const sx of [-1, 1]) {
      const { p } = this.front(sx * 0.31, 0.02, 0.2);
      if (shape === 'rect') put(this.j, tor(0.21 * R, 0.022 * R, 5, 4), frame, [p.x, p.y, p.z], [0, 0, Math.PI / 4], [1.25, 0.8, 1]);
      else put(this.j, tor(0.2 * R, 0.02 * R, 5, 18), frame, [p.x, p.y, p.z]);
      const lens = put(this.j, cyl(0.19 * R, 0.19 * R, 0.01 * R, 16), glass, [p.x, p.y, p.z], [Math.PI / 2, 0, 0], shape === 'rect' ? [1.2, 1, 0.75] : 1);
      lens.castShadow = false;
      inner.push(p.clone().add(V(-sx * 0.2 * R, 0.02 * R, 0)));
      outer.push(p.clone().add(V(sx * 0.22 * R, 0.02 * R, 0)));
    }
    link(this.j, inner[0], inner[1], 0.018 * R, 0.018 * R, frame);
    for (let i = 0; i < 2; i++) {
      const sx = i ? 1 : -1;
      const ear = this.side(sx, 0.05, -0.1, 0.05).p;
      link(this.j, outer[i], ear, 0.018 * R, 0.018 * R, frame);
    }
  }
}

// --------------------------------------------------------------- hair --
// Each style is cover(n) and thick(n) for a shell over the head, plus extras.
const HAIR = {
  // short, side-parted with a little volume on top
  side: {
    cover: (n) => hairline(n, 0.52 + n.x * 0.12, 0.08, -0.5) * earGap(n),
    thick: (n) => 0.07 + 0.08 * Math.max(0, n.y) + 0.05 * gauss(n.x - 0.25, 0.3) * Math.max(0, n.z + 0.3),
  },
  // slicked back, sideburns
  slick: {
    cover: (n) => Math.max(hairline(n, 0.6, 0.12, -0.55) * earGap(n), gauss(az(n) - 0.12, 0.13) * sstep(-0.48, -0.36, n.y) * (1 - sstep(0.05, 0.2, n.y)) * sstep(0.7, 0.85, Math.abs(n.x))),
    thick: (n) => 0.045 + 0.06 * Math.max(0, n.y) * Math.max(0, 1 - Math.max(0, n.z)),
    gloss: true,
  },
  // pulled back into a ponytail
  ponytail: {
    cover: (n) => hairline(n, 0.5, 0.12, -0.55) * earGap(n, 0.42),
    thick: (n) => 0.06 + 0.04 * Math.max(0, n.y),
  },
  // jaw-length bob that frames the face
  bob: {
    cover: (n) => hairline(n, 0.48, -0.62, -0.72, 0.09),
    thick: (n) => 0.08 + 0.13 * sstep(0.25, -0.55, n.y) + 0.05 * Math.max(0, n.y),
  },
  // bob with a full fringe
  bangs: {
    cover: (n) => hairline(n, 0.22, -0.62, -0.72, 0.06),
    thick: (n) => 0.08 + 0.12 * sstep(0.25, -0.55, n.y) + 0.05 * Math.max(0, n.y) + 0.05 * Math.max(0, n.z) * sstep(0.1, 0.4, n.y),
  },
  // big curly bob
  curly: {
    cover: (n) => hairline(n, 0.46, -0.55, -0.7, 0.08),
    thick: (n) => 0.16 + 0.14 * Math.max(0, n.y) + 0.1 * sstep(0.2, -0.5, n.y) + 0.05 * wobble(n, 18),
  },
  // short and spiky
  messy: {
    cover: (n) => hairline(n, 0.5, -0.02, -0.5) * earGap(n),
    thick: (n) => 0.08 + 0.05 * Math.max(0, n.y) + 0.11 * Math.max(0, wobble(n, 11)) * sstep(-0.2, 0.4, n.y),
  },
  // shoulder-length hair under a beanie
  long: {
    cover: (n) => hairline(n, 0.36, -0.75, -0.95, 0.08),
    thick: (n) => 0.07 + 0.15 * sstep(0.1, -0.8, n.y) * (1 - 0.6 * Math.max(0, az(n))),
  },
  // matted mop (Trapper)
  matted: {
    cover: (n) => hairline(n, 0.62, -0.25, -0.85) * earGap(n, 0.3),
    thick: (n) => 0.1 + 0.08 * Math.max(0, wobble(n, 9)) + 0.06 * sstep(0, -0.7, n.y),
  },
  // a few tufts on a bald scalp (Hillbilly)
  patchy: {
    cover: (n) => hairline(n, 0.3, -0.15, -0.4) * sstep(0.05, 0.4, wobble(n, 13, 2) + 0.2),
    thick: () => 0.04,
  },
  // tied back under a mask (Huntress)
  tied: {
    cover: (n) => hairline(n, 0.62, -0.35, -0.6) * earGap(n, 0.3),
    thick: (n) => 0.07 + 0.04 * Math.max(0, n.y),
  },
};

function addHair(head, style, color) {
  const def = HAIR[style];
  if (!def) return null;
  const m = mat(color, { r: def.gloss ? 0.32 : 0.62, map: hairTexture() });
  return head.shell(def.cover, def.thick, m);
}

// Stubble or a beard over the jaw.
function addBeard(head, color, skin, full = false) {
  const m = mat(shade(skin, 1, color, full ? 0.85 : 0.6), { r: 1, map: hairTexture() });
  const cover = (n) => {
    const jaw = sstep(-0.12, -0.3, n.y) * sstep(-0.35, 0.05, az(n));
    const lipGap = 1 - gauss(Math.hypot(n.x * 1.4, n.y + 0.47), 0.15) * (full ? 0 : 1);
    return jaw * lipGap;
  };
  head.shell(cover, () => (full ? 0.06 : 0.025), m, 30, 22);
}

// ----------------------------------------------------------------- rig --
const JOINTS = ['hips', 'spine', 'chest', 'head', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR'];

export class Rig {
  constructor(spec) {
    const s = (this.s = spec.scale || 1);
    const w = (this.w = spec.girth || 1);
    this.root = new THREE.Group();
    this.body = group(this.root);
    const J = (this.j = {});
    J.hips = group(this.body, 0, 0.95 * s, 0);
    J.spine = group(J.hips, 0, 0.06 * s, 0);
    J.chest = group(J.spine, 0, 0.4 * s, 0);
    J.head = group(J.chest, 0, 0.14 * s, 0);
    const sw = (spec.fem ? 0.188 : 0.2) * s * w;
    J.shL = group(J.chest, sw, -0.02 * s, 0);
    J.elL = group(J.shL, 0, -0.29 * s, 0);
    J.handL = group(J.elL, 0, -0.27 * s, 0);
    J.shR = group(J.chest, -sw, -0.02 * s, 0);
    J.elR = group(J.shR, 0, -0.29 * s, 0);
    J.handR = group(J.elR, 0, -0.27 * s, 0);
    J.hipL = group(J.hips, 0.095 * s * w, -0.04 * s, 0);
    J.knL = group(J.hipL, 0, -0.44 * s, 0);
    J.hipR = group(J.hips, -0.095 * s * w, -0.04 * s, 0);
    J.knR = group(J.hipR, 0, -0.44 * s, 0);
    this.lids = [];
    this.blinkT = 1 + Math.random() * 3;
    this.blinkK = 0;
    this.pose = {};
    for (const k of JOINTS) this.pose[k] = { x: 0, y: 0, z: 0 };
    this.pose.body = { x: 0, y: 0, z: 0, py: 0, pz: 0 };
    this.phase = 0;
    this.t = Math.random() * 10;
    this.meshes = [];
  }

  // Merge the static parts on each joint per material, then index meshes.
  finish() {
    for (const g of [this.body, ...Object.values(this.j)]) {
      const byMat = new Map();
      for (const c of g.children) {
        if (!c.isMesh || c.userData.keep) continue;
        if (!byMat.has(c.material)) byMat.set(c.material, []);
        byMat.get(c.material).push(c);
      }
      for (const [m, list] of byMat) {
        if (list.length < 2) continue;
        const geos = list.map((c) => {
          c.updateMatrix();
          const geo = c.geometry.clone();
          for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
          if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
          geo.applyMatrix4(c.matrix);
          return geo;
        });
        const merged = mergeGeometries(geos, false);
        for (const geo of geos) geo.dispose();
        if (!merged) continue;
        merged.userData.owned = true;
        for (const c of list) g.remove(c);
        const mesh = new THREE.Mesh(merged, m);
        mesh.castShadow = true;
        g.add(mesh);
      }
    }
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
    // blink every few seconds
    if (this.lids.length) {
      this.blinkT -= dt;
      if (this.blinkT < 0) { this.blinkT = 2 + Math.random() * 4; this.blinkK = 0.15; }
      const shut = this.blinkK > 0 ? Math.sin((this.blinkK / 0.15) * Math.PI) : 0;
      this.blinkK = Math.max(0, this.blinkK - dt);
      for (const l of this.lids) l.m.rotation.x = l.open + (l.closed - l.open) * shut;
    }
  }
}

function group(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}

// Free the geometry built just for this character.
export function disposeRig(rig) {
  rig.root.traverse((o) => { if (o.isMesh && o.geometry.userData.owned) o.geometry.dispose(); });
}

// ---------------------------------------------------------------- body --
const PELVIS = [[0, -0.1], [0.08, -0.098], [0.13, -0.08], [0.158, -0.045], [0.162, 0.0], [0.153, 0.06], [0.145, 0.12], [0.11, 0.14], [0, 0.145]];
const PELVIS_F = [[0, -0.1], [0.08, -0.098], [0.135, -0.078], [0.172, -0.04], [0.172, 0.0], [0.152, 0.06], [0.135, 0.12], [0.1, 0.14], [0, 0.145]];
const TORSO = [[0, -0.07], [0.142, -0.06], [0.145, 0.04], [0.153, 0.15], [0.17, 0.26], [0.176, 0.33], [0.164, 0.39], [0.12, 0.435], [0.06, 0.455], [0, 0.46]];
const TORSO_F = [[0, -0.07], [0.13, -0.06], [0.124, 0.05], [0.138, 0.15], [0.158, 0.26], [0.16, 0.33], [0.15, 0.39], [0.11, 0.432], [0.055, 0.452], [0, 0.458]];

// Builds the anatomy and base clothes. B:
//   skin, top, legs, hands (materials), sleeves 'long'|'rolled'|'short'|'none',
//   shoes 'sneaker'|'boot'|'dress'|'wrap' + shoe/sole materials, fem, belly,
//   muscle, cuffs (sleeve cuff material), hem (pant hem), neckSkin.
// Returns helpers for placing details on the torso.
function buildBody(rig, B) {
  const J = rig.j, s = rig.s, w = rig.w;
  const fem = !!B.fem;
  const pelvisP = fem ? PELVIS_F : PELVIS;
  const torsoP = fem ? TORSO_F : TORSO;
  const tsx = 1.12 * w, tsz = (fem ? 0.66 : 0.68) * w * (1 + (B.belly || 0) * 0.15);
  put(J.hips, lathe(pelvisP, s), B.legs, [0, 0, 0], null, [w, 1, 0.72 * w]);
  const nl = B.neckline;
  if (nl) {
    // clothes end at the neckline; bare skin above (tank tops, overalls)
    const r = profileR(torsoP, nl);
    const lower = torsoP.filter(([, y]) => y < nl).map(([rr, y]) => [rr * 1.015, y]).concat([[r * 1.015, nl], [r * 0.96, nl + 0.004]]);
    const upper = [[profileR(torsoP, nl - 0.03), nl - 0.03]].concat(torsoP.filter(([, y]) => y > nl - 0.03));
    put(J.spine, lathe(lower, s), B.top, [0, 0, 0], null, [tsx, 1, tsz]);
    put(J.spine, lathe(upper, s), B.skin, [0, 0, 0], null, [tsx, 1, tsz]);
  } else put(J.spine, lathe(torsoP, s), B.top, [0, 0, 0], null, [tsx, 1, tsz]);
  if (B.belly) put(J.spine, sph(0.15 * s * w, 16, 12), B.top, [0, 0.1 * s, 0.045 * s * w], null, [1.05, 0.95, 0.8 + B.belly * 0.2]);
  // shoulders slope from the neck to the arms
  const shM = nl || B.sleeves === 'none' ? B.skin : B.top;
  for (const sx of [-1, 1]) link(J.spine, V(sx * 0.05 * s * w, 0.43 * s, -0.005 * s), V(sx * (fem ? 0.17 : 0.18) * s * w, 0.385 * s, 0), 0.045 * s * w, 0.055 * s * w, nl ? B.skin : shM);
  // neck
  const neckR = 0.047 * s * Math.sqrt(w) * (fem ? 0.93 : 1);
  // split at the head's pivot: a sphere centred there looks the same however
  // the head turns, so the neck never pokes through the chin
  put(J.chest, seg(neckR, neckR * 1.08, 0.14 * s), B.skin, [0, 0.14 * s, 0]);
  put(J.head, seg(neckR * 0.95, neckR, 0.07 * s), B.skin, [0, 0.07 * s, 0]);
  // arms
  const mu = B.muscle || 0;
  const upperSleeve = B.sleeves === 'none' || B.sleeves === 'short' ? B.skin : B.top;
  const lowerSleeve = B.sleeves === 'long' ? B.top : B.skin;
  for (const [sh, el, hand, side] of [[J.shL, J.elL, J.handL, 1], [J.shR, J.elR, J.handR, -1]]) {
    put(sh, seg(0.057 * s * w, 0.046 * s * w, 0.29 * s, (0.006 + mu * 0.012) * s * w, 0.65), upperSleeve);
    if (B.sleeves === 'short') {
      put(sh, seg(0.069 * s * w, 0.063 * s * w, 0.12 * s), B.top);
      put(sh, tor(0.062 * s * w, 0.008 * s, 6, 16), B.cuffs || B.top, [0, -0.12 * s, 0], [Math.PI / 2, 0, 0]);
    }
    put(el, seg(0.047 * s * w, 0.034 * s * w, 0.27 * s, (0.005 + mu * 0.008) * s * w, 0.72), lowerSleeve);
    if (B.sleeves === 'rolled') put(el, tor(0.052 * s * w, 0.016 * s, 6, 16), B.top, [0, -0.045 * s, 0], [Math.PI / 2, 0, 0], [1, 1, 1.4]);
    if (B.sleeves === 'long') put(el, tor(0.038 * s * w, 0.009 * s, 6, 14), B.cuffs || B.top, [0, -0.25 * s, 0], [Math.PI / 2, 0, 0]);
    buildHand(hand, B.hands, s, w, side);
  }
  // legs
  for (const [hip, kn] of [[J.hipL, J.knL], [J.hipR, J.knR]]) {
    put(hip, seg(0.085 * s * w, 0.062 * s * w, 0.44 * s, 0.006 * s * w, 0.7), B.legs);
    const shin = B.shorts ? B.skin : B.legs;
    put(kn, seg(0.062 * s * w, 0.043 * s * w, 0.385 * s, (0.012 + mu * 0.004) * s * w, 0.68), shin);
    if (B.shorts) put(hip, seg(0.09 * s * w, 0.075 * s * w, 0.3 * s), B.legs);
    else if (B.hem !== false) put(kn, seg(0.05 * s * w, 0.058 * s * w, 0.06 * s), B.hem || B.legs, [0, -0.3 * s, 0]);
    buildShoe(kn, B.shoes, B.shoe, B.sole, s, w);
  }
  if (B.belt) {
    put(J.hips, tor(0.149 * s, 0.017 * s, 5, 26), B.belt, [0, 0.105 * s, 0], [Math.PI / 2, 0, 0], [w * 1.0, 0.72 * w, 1]);
    put(J.hips, rbox(0.045 * s, 0.032 * s, 0.012 * s, 0.003 * s), mat('#a49a82', { r: 0.3, m: 0.8 }), [0, 0.105 * s, 0.11 * s * w]);
  }
  // torso surface: front(x, y) gives a point on the chest/back in spine space
  const surf = (x, y, back = false, out = 0) => {
    const r = profileR(torsoP, y);
    const ex = r * tsx;
    const zz = Math.abs(x * s) >= ex * s ? 0 : tsz * r * Math.sqrt(1 - ((x * s) / (ex * s)) ** 2);
    return V(x * s, y * s, (back ? -1 : 1) * (zz + out) * s);
  };
  const hipSurf = (x, y, back = false, out = 0) => {
    const r = profileR(pelvisP, y);
    const ex = r * w;
    const zz = Math.abs(x) >= ex ? 0 : 0.72 * w * r * Math.sqrt(1 - (x / ex) ** 2);
    return V(x * s, y * s, (back ? -1 : 1) * (zz + out) * s);
  };
  return { front: (x, y, out = 0.004) => surf(x, y, false, out), back: (x, y, out = 0.004) => surf(x, y, true, out), hip: (x, y, out = 0.004) => hipSurf(x, y, false, out), hipBack: (x, y, out = 0.004) => hipSurf(x, y, true, out), tsx, tsz };
}

// Relaxed hand hanging along -y; the palm faces the body.
function buildHand(hand, m, s, w, side) {
  const k = s * (0.85 + 0.15 * w);
  put(hand, sph(0.034 * k, 10, 8), m, [0, 0, 0]);
  put(hand, rbox(0.034 * k, 0.085 * k, 0.074 * k, 0.014 * k, 1), m, [0, -0.05 * k, 0.004 * k]);
  put(hand, rbox(0.028 * k, 0.07 * k, 0.07 * k, 0.012 * k, 1), m, [-side * 0.008 * k, -0.115 * k, 0.003 * k], [0, 0, -side * 0.28]);
  const th = put(hand, seg(0.014 * k, 0.012 * k, 0.048 * k), m, [-side * 0.008 * k, -0.03 * k, 0.034 * k]);
  th.rotation.set(-0.38, 0, -side * 0.3);
}

function buildShoe(kn, style, upper, sole, s, w) {
  const g = -0.47 * s;
  const k = s * (0.7 + 0.3 * w);
  if (style === 'wrap') {
    put(kn, rbox(0.09 * k, 0.07 * k, 0.24 * k, 0.03 * k), upper, [0, g + 0.035 * s, 0.04 * s]);
    for (let i = 0; i < 3; i++) put(kn, tor(0.05 * k, 0.008 * k, 4, 14), upper, [0, g + (0.06 + i * 0.05) * s, 0.0], [Math.PI / 2 + 0.3, 0, 0], [1, 1.3, 1]);
    return;
  }
  const boot = style === 'boot';
  const solH = boot ? 0.04 : style === 'dress' ? 0.022 : 0.034;
  put(kn, rbox(0.104 * k, solH * s, 0.28 * k, 0.012 * s, 1), sole, [0, g + (solH / 2) * s, 0.045 * s]);
  put(kn, rbox(0.094 * k, (boot ? 0.1 : 0.08) * s, 0.245 * k, 0.035 * k), upper, [0, g + (solH + (boot ? 0.045 : 0.035)) * s, 0.035 * s]);
  if (boot) put(kn, cyl(0.056 * k, 0.06 * k, 0.12 * s, 12), upper, [0, g + 0.15 * s, 0.0]);
  if (style === 'sneaker') {
    put(kn, rbox(0.05 * k, 0.018 * s, 0.1 * k, 0.006 * s), sole, [0, g + 0.105 * s, 0.085 * s], [-0.38, 0, 0]);
    put(kn, rbox(0.098 * k, 0.03 * s, 0.07 * k, 0.012 * s), sole, [0, g + 0.06 * s, -0.06 * s]);
  }
}

// --------------------------------------------------------- survivors --
// Outfit and face details per survivor, on top of the colours in data.js.
const LOOKS = {
  dwight: {
    eyes: '#5b4632', hair: 'side', glasses: 'rect', sleeves: 'rolled', shoes: 'dress', sole: '#1a120c', belt: '#2a1d14', legsMap: 'fabric',
    brows: { inner: 0.03 },
    extra(r, c, M, T) {
      const J = r.j;
      collar(J, M.top, T, 0.95);
      // red tie down the chest
      const tie = mat(c.accent, { r: 0.6, map: fabricTexture() });
      const knot = T.front(0, 0.42, 0.012);
      put(J.spine, rbox(0.04, 0.036, 0.022, 0.008), tie, [knot.x, knot.y, knot.z], [-0.3, 0, 0]);
      chain(J.spine, [T.front(0, 0.405, 0.01), T.front(0, 0.3, 0.008), T.front(0, 0.19, 0.008), T.front(0, 0.12, 0.012)], [0.016, 0.024, 0.03, 0.026], tie);
      for (const m of J.spine.children.slice(-3)) m.scale.set(1, 1, 0.3);
      // name badge on a lanyard pocket
      const badge = T.front(0.09, 0.29, 0.004);
      put(J.spine, rbox(0.06, 0.07, 0.006, 0.004), mat('#4a5560', { r: 0.8 }), [badge.x, badge.y, badge.z]);
      put(J.spine, rbox(0.044, 0.026, 0.004, 0.002), mat('#ecebe4', { r: 0.6 }), [badge.x, badge.y + 0.016, badge.z + 0.004]);
      put(J.spine, rbox(0.03, 0.006, 0.003, 0.001), mat('#2a5aa8'), [badge.x, badge.y + 0.016, badge.z + 0.007]);
    },
  },
  meg: {
    eyes: '#3f6b48', hair: 'ponytail', fem: true, sleeves: 'long', shoes: 'sneaker', sole: '#f2f2f2', legsMap: 'fabric',
    brows: { thick: 0.85, outer: 0.04 },
    extra(r, c, M, T, head) {
      const J = r.j, s = r.s;
      const white = mat(c.accent, { r: 0.6, map: fabricTexture() });
      // track jacket: white stripes down the sleeves and sides, zip, collar
      for (const [sh, el, sx] of [[J.shL, J.elL, 1], [J.shR, J.elR, -1]]) {
        put(sh, rbox(0.012, 0.27, 0.018, 0.005), white, [sx * 0.046, -0.15, 0], [0, 0, -sx * 0.035]);
        put(el, rbox(0.01, 0.24, 0.016, 0.004), white, [sx * 0.038, -0.13, 0], [0, 0, -sx * 0.045]);
      }
      chain(J.spine, [T.front(0, 0.44, 0.002), T.front(0, 0.0, 0.004)], [0.005, 0.005], white);
      put(J.chest, tor(0.056, 0.014, 6, 18), white, [0, 0.025, 0.004], [Math.PI / 2 - 0.25, 0, 0], [1.05, 1, 1]);
      // ponytail with a hair tie
      const hairM = mat(c.hair, { r: 0.6, map: hairTexture() });
      const R = head.H.R;
      const root = V(0, head.o.y + 0.32 * R, -0.98 * R);
      put(J.head, tor(0.15 * R, 0.06 * R, 6, 12), mat('#1a1a1a'), [root.x, root.y, root.z - 0.08 * R], [0.5, 0, 0]);
      chain(J.head, [root, root.clone().add(V(0, -0.2 * R, -0.45 * R)), root.clone().add(V(0, -0.8 * R, -0.6 * R)), root.clone().add(V(0, -1.5 * R, -0.5 * R)), root.clone().add(V(0, -2.0 * R, -0.36 * R))], [0.17 * R, 0.22 * R, 0.2 * R, 0.13 * R, 0.03 * R], hairM);
      // wristbands
      for (const el of [J.elL, J.elR]) put(el, cyl(0.04, 0.04, 0.035, 12), mat('#c02a2a', { map: fabricTexture() }), [0, -0.235, 0]);
      void s;
    },
  },
  claudette: {
    eyes: '#2a1c12', hair: 'curly', glasses: 'round', fem: true, sleeves: 'long', shoes: 'boot', sole: '#17110b', belt: '#3a2a1c', legsMap: 'fabric',
    brows: { thick: 0.9 },
    extra(r, c, M, T) {
      const J = r.j;
      // cardigan over a shirt: inner V, collar, buttons
      const inner = mat(c.accent, { r: 0.8, map: fabricTexture() });
      chain(J.spine, [T.front(0, 0.445, -0.01), T.front(0, 0.34, 0.0)], [0.045, 0.008], inner);
      J.spine.children[J.spine.children.length - 1].scale.set(1, 1, 0.25);
      collar(J, inner, T, 0.85);
      for (let i = 0; i < 4; i++) {
        const p = T.front(0.012, 0.29 - i * 0.075, 0.004);
        put(J.spine, sph(0.0075, 8, 6), mat('#3a2a18', { r: 0.4 }), [p.x, p.y, p.z]);
      }
      chain(J.spine, [T.front(0, 0.32, 0.002), T.front(0, -0.04, 0.002)], [0.004, 0.004], mat(shade(c.top, 0.6)));
    },
  },
  jake: {
    eyes: '#241a12', hair: 'messy', sleeves: 'long', shoes: 'boot', sole: '#151210', belt: '#1e1a16', legsMap: 'fabric', stubble: true,
    hands: '#2a2622',
    extra(r, c, M, T) {
      const J = r.j;
      // open parka over a shirt, hood, scarf and gloves
      const shirt = mat('#6b6458', { map: fabricTexture() });
      for (let i = 0; i < 4; i++) {
        const y0 = 0.4 - i * 0.1, y1 = y0 - 0.1;
        const a = T.front(0, y0, 0.001), b = T.front(0, y1, 0.001);
        const m = put(J.spine, rbox(0.09, 0.104, 0.008, 0.003), shirt, [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2]);
        m.rotation.x = Math.atan2(a.z - b.z, a.y - b.y);
      }
      for (const sx of [-1, 1]) chain(J.spine, [T.front(sx * 0.05, 0.42, 0.006), T.front(sx * 0.052, 0.2, 0.008), T.front(sx * 0.055, 0.0, 0.008)], [0.012, 0.012, 0.012], M.top);
      put(J.chest, tor(0.085, 0.035, 8, 18), M.top, [0, 0.0, -0.04], [Math.PI / 2 - 0.5, 0, 0], [1.15, 1.05, 1]);
      const scarf = mat(c.accent, { r: 0.9, map: knitTexture() });
      put(J.chest, tor(0.058, 0.024, 8, 18), scarf, [0, 0.04, 0.006], [Math.PI / 2 - 0.15, 0, 0]);
      chain(J.spine, [T.front(0.03, 0.43, 0.02), T.front(0.04, 0.34, 0.016), T.front(0.045, 0.26, 0.012)], [0.02, 0.018, 0.016], scarf);
      for (const m of J.spine.children.slice(-2)) m.scale.set(1.3, 1, 0.45);
      for (const p of [[0.12, 0.08], [-0.12, 0.08]]) { const q = T.front(p[0], p[1], 0.006); put(J.spine, rbox(0.075, 0.06, 0.016, 0.006), M.top, [q.x, q.y, q.z]); }
    },
  },
  nea: {
    eyes: '#4a6c8c', hair: 'long', fem: true, sleeves: 'long', shoes: 'sneaker', sole: '#f4f4f4', legsMap: 'denim',
    brows: { thick: 0.75 },
    extra(r, c, M, T, head) {
      const J = r.j;
      hoodie(J, M.top, T, mat('#e8e8e8', { r: 0.6 }));
      // spray-paint patch on the hoodie
      const tag = T.front(-0.02, 0.27, 0.004);
      put(J.spine, rbox(0.13, 0.06, 0.004, 0.002), mat(c.accent, { r: 0.7 }), [tag.x, tag.y, tag.z], [0, 0, 0.12]);
      put(J.spine, rbox(0.08, 0.02, 0.003, 0.002), mat('#f2d84a', { r: 0.7 }), [tag.x + 0.02, tag.y - 0.012, tag.z + 0.003], [0, 0, -0.1]);
      // beanie with a folded brim
      const knit = mat(c.accent, { r: 0.95, map: knitTexture(8, 3) });
      head.shell((n) => hairline(n, 0.5, 0.16, 0.05, 0.035), (n) => 0.2 + 0.08 * Math.max(0, n.y) + 0.06 * Math.max(0, -n.z) * Math.max(0, n.y), knit);
      head.shell((n) => hairline(n, 0.5, 0.16, 0.05, 0.03) * (1 - hairline(n, 0.68, 0.36, 0.25, 0.03)), () => 0.26, knit);
    },
  },
  david: {
    eyes: '#3c5c6e', hair: 'slick', sleeves: 'none', shoes: 'boot', sole: '#110e0c', legsMap: 'denim', muscle: 1, beard: true, neckline: 0.37,
    brows: { thick: 1.25, inner: -0.02 },
    extra(r, c, M, T) {
      const J = r.j;
      // tank top straps over the shoulders
      for (const sx of [-1, 1]) {
        chain(J.spine, [T.front(sx * 0.1, 0.36, 0.004), V(sx * 0.105, 0.47, 0.03), V(sx * 0.105, 0.47, -0.03), T.back(sx * 0.1, 0.36, 0.004)], [0.012, 0.012, 0.012, 0.012], M.top);
        for (const m of J.spine.children.slice(-3)) m.scale.set(2.4, 1, 0.7);
      }
      // red suspenders hanging off the hips
      const sus = mat(c.accent, { r: 0.7 });
      for (const sx of [-1, 1]) {
        const a = r.j.hips;
        const p0 = V(sx * 0.13, 0.09, 0.03), p1 = V(sx * 0.18, -0.12, 0.0);
        link(a, p0, p1, 0.012, 0.012, sus, 0, [1.6, 0.5]);
      }
      // dog tags
      const steel = mat('#9a9c9e', { r: 0.3, m: 0.9 });
      chain(J.spine, [T.front(-0.055, 0.43, 0.004), T.front(0, 0.37, 0.006), T.front(0.055, 0.43, 0.004)], [0.003, 0.003, 0.003], steel);
      const tg = T.front(0, 0.355, 0.008);
      put(J.spine, rbox(0.022, 0.034, 0.004, 0.003), steel, [tg.x, tg.y, tg.z]);
    },
  },
  ace: {
    eyes: '#3a2a1a', hair: 'slick', sleeves: 'short', shoes: 'dress', sole: '#0a0a0a', belt: '#141414', legsMap: 'fabric', mustache: true,
    topMap: 'floral',
    extra(r, c, M, T, head) {
      const J = r.j;
      // open collar with a gold chain
      const v = T.front(0, 0.41, -0.012);
      put(J.spine, sph(0.06, 12, 8), M.skin, [v.x, v.y, v.z], [-0.4, 0, 0], [0.75, 1.1, 0.3]);
      collar(J, M.top, T, 1.1, true);
      const gold = mat('#d8b45a', { r: 0.25, m: 0.9 });
      put(J.chest, tor(0.06, 0.004, 4, 20), gold, [0, -0.01, 0.025], [Math.PI / 2 - 0.55, 0, 0], [1.1, 1, 1]);
      // fedora with a band
      const R = head.H.R, hatM = mat('#2c2620', { r: 0.8, map: fabricTexture() });
      const top = V(0, head.o.y + 0.82 * R, -0.03 * R);
      put(J.head, cyl(1.45 * R, 1.45 * R, 0.08 * R, 24), hatM, [top.x, top.y, top.z], [-0.08, 0, 0], [1, 1, 1.12]);
      put(J.head, tor(1.43 * R, 0.06 * R, 4, 24), hatM, [top.x, top.y + 0.03 * R, top.z], [Math.PI / 2 - 0.08, 0, 0], [1, 1.12, 1]);
      put(J.head, cyl(0.86 * R, 0.98 * R, 0.62 * R, 18), hatM, [top.x, top.y + 0.32 * R, top.z - 0.02 * R], [-0.08, 0, 0], [1, 1, 1.15]);
      put(J.head, cyl(0.99 * R, 0.99 * R, 0.16 * R, 18), mat(c.accent, { r: 0.5 }), [top.x, top.y + 0.1 * R, top.z], [-0.08, 0, 0], [1, 1, 1.15]);
      put(J.head, sph(0.6 * R, 14, 8), hatM, [top.x, top.y + 0.62 * R, top.z - 0.02 * R], null, [1.3, 0.35, 1.5]);
    },
  },
  feng: {
    eyes: '#2a1c12', hair: 'bangs', fem: true, sleeves: 'long', shoes: 'sneaker', sole: '#f6f6f6', legsMap: 'fabric',
    brows: { thick: 0.75, outer: 0.04 },
    extra(r, c, M, T, head) {
      const J = r.j;
      const pink = mat(c.accent, { r: 0.6 });
      hoodie(J, M.top, T, pink);
      for (const el of [J.elL, J.elR]) put(el, tor(0.039, 0.011, 6, 14), pink, [0, -0.24, 0], [Math.PI / 2, 0, 0]);
      // gaming headphones around the neck
      const dark = mat('#202024', { r: 0.4, m: 0.3 });
      put(J.chest, tor(0.072, 0.01, 6, 20, Math.PI * 1.25), dark, [0, 0.08, -0.01], [Math.PI / 2 - 0.25, 0, -Math.PI * 0.125 + Math.PI], [1.15, 1, 1]);
      for (const sx of [-1, 1]) {
        put(J.chest, cyl(0.038, 0.038, 0.024, 16), dark, [sx * 0.08, 0.06, 0.04], [0, 0, Math.PI / 2 - sx * 0.35]);
        put(J.chest, cyl(0.026, 0.026, 0.026, 14), pink, [sx * 0.092, 0.064, 0.044], [0, 0, Math.PI / 2 - sx * 0.35]);
      }
      // a pink streak in the fringe
      const R = head.H.R;
      chain(J.head, [head.front(0.3, 0.62, 0.12).p, head.front(0.36, 0.4, 0.2).p, head.front(0.4, 0.22, 0.18).p], [0.07 * R, 0.06 * R, 0.03 * R], mat(c.accent, { r: 0.6, map: hairTexture() }));
    },
  },
};

// shirt collar around the neck
function collar(J, m, T, size = 1, open = false) {
  const p = T.front(0, 0.45, 0);
  for (const sx of [-1, 1]) {
    put(J.spine, rbox(0.075 * size, 0.05 * size, 0.01, 0.004), m, [sx * 0.045 * size, 0.445, p.z * 0.6 + 0.02], [0.45, -sx * (open ? 0.8 : 0.55), -sx * (open ? 0.9 : 0.55)]);
  }
  put(J.chest, tor(0.056, 0.011, 6, 18), m, [0, 0.02, -0.004], [Math.PI / 2 - 0.2, 0, 0]);
}

// hood bunched behind the neck, drawstrings and front pocket
function hoodie(J, m, T, strings) {
  put(J.chest, tor(0.08, 0.04, 8, 18), m, [0, 0.0, -0.035], [Math.PI / 2 - 0.55, 0, 0], [1.2, 1.1, 1]);
  put(J.spine, sph(0.1, 12, 8), m, [0, 0.4, -0.1], null, [1.1, 0.65, 0.7]);
  for (const sx of [-1, 1]) chain(J.spine, [T.front(sx * 0.03, 0.43, 0.01), T.front(sx * 0.034, 0.3, 0.008)], [0.005, 0.005], strings);
  const pk = T.front(0, 0.08, 0.008);
  put(J.spine, rbox(0.21, 0.1, 0.02, 0.008), m, [pk.x, pk.y, pk.z]);
}

function legsMaterial(color, kind) {
  if (kind === 'denim') return mat(color, { r: 0.9, map: denimTexture() });
  return mat(color, { map: fabricTexture() });
}

export function createSurvivor(charId) {
  const c = SURVIVORS[charId] || SURVIVORS.dwight;
  const L = LOOKS[charId] || LOOKS.dwight;
  const rig = new Rig({ scale: 1, girth: c.build || 1, fem: L.fem });
  rig.kind = 'survivor';
  rig.charId = charId;
  const skin = skinMat(c.skin);
  const M = {
    skin,
    top: L.topMap === 'floral' ? mat('#ffffff', { map: floralTexture(c.top, c.accent, shade(c.top, 0.55, '#1f4a2a', 0.6)) }) : mat(c.top, { map: fabricTexture() }),
    legs: legsMaterial(c.bottom, L.legsMap),
    shoe: mat(c.shoes, { r: L.shoes === 'dress' ? 0.35 : 0.7, map: L.shoes === 'sneaker' ? fabricTexture() : leatherTexture() }),
    sole: mat(L.sole || '#222', { r: 0.8 }),
  };
  const T = buildBody(rig, {
    skin, top: M.top, legs: M.legs, hands: L.hands ? mat(L.hands, { r: 0.75, map: leatherTexture() }) : skin,
    sleeves: L.sleeves, shoes: L.shoes, shoe: M.shoe, sole: M.sole, fem: L.fem, muscle: L.muscle, neckline: L.neckline,
    belt: L.belt ? mat(L.belt, { r: 0.5, map: leatherTexture() }) : null,
  });
  // head and face
  const head = new Head(rig, { R: 0.115, jaw: L.fem ? 0.3 : 0.22, chin: L.fem ? 0.1 : 0.14, brow: L.fem ? 0.03 : 0.05 }, skin);
  rig.headMesh = head.mesh;
  head.eyes(L.eyes);
  head.brows(shade(c.hair, 0.8, '#1a120c', 0.3), L.brows);
  head.nose(L.fem ? { len: 0.9, w: 0.9 } : {});
  head.mouth(shade(c.skin, 0.82, '#b0504a', 0.35), L.fem ? { w: 0.95 } : {});
  head.ears();
  addHair(head, L.hair, c.hair);
  if (L.beard) addBeard(head, c.hair, c.skin, false);
  if (L.stubble) addBeard(head, c.hair, c.skin, false);
  if (L.glasses) head.glasses(L.glasses);
  if (L.mustache) {
    const R = head.H.R, m = mat(c.hair, { r: 0.7, map: hairTexture() });
    for (const sx of [-1, 1]) chain(rig.j.head, [head.front(0, -0.4, 0.04).p, head.front(sx * 0.17, -0.42, 0.05).p, head.front(sx * 0.24, -0.52, 0.03).p], [0.05 * R, 0.05 * R, 0.025 * R], m);
  }
  L.extra(rig, c, M, T, head);
  rig.finish();
  return rig;
}

// ------------------------------------------------------------ killers --
const KLOOKS = {
  trapper: { girth: 1.25 },
  wraith: { girth: 0.85 },
  hillbilly: { girth: 1.2, belly: 1 },
  huntress: { girth: 1.38, fem: true },
};

export function createKiller(killerId) {
  const k = KILLERS[killerId] || KILLERS.trapper;
  const K = KLOOKS[killerId] || KLOOKS.trapper;
  const s = k.height / 1.75;
  const rig = new Rig({ scale: s, girth: K.girth, fem: K.fem });
  rig.kind = 'killer';
  rig.charId = killerId;
  const J = rig.j;
  if (killerId === 'trapper') buildTrapper(rig, s);
  else if (killerId === 'wraith') buildWraith(rig, s);
  else if (killerId === 'hillbilly') buildHillbilly(rig, s);
  else buildHuntress(rig, s);
  // carry anchor on the left shoulder
  rig.carry = group(J.chest, 0.24 * s, 0.1 * s, -0.02 * s);
  rig.finish();
  return rig;
}

// Face-covering mask over the head: features are placed on its surface.
function maskShell(head, m, lo = -0.85, hi = 0.62, edge = 0.1) {
  return head.shell((n) => sstep(-0.12, 0.12, az(n)) * sstep(lo - 0.05, lo + 0.05, n.y) * (1 - sstep(hi - 0.05, hi + 0.05, n.y)), () => edge, m, 34, 26);
}

function buildTrapper(rig, s) {
  const J = rig.j;
  const skin = skinMat('#b9a08a', 0.7);
  const shirt = mat('#4e4337', { map: bloodyTexture(251) });
  const pants = mat('#3a3026', { map: fabricTexture() });
  const leather = mat('#5b4a35', { r: 0.6, map: bloodyTexture(261) });
  const glove = mat('#2c241c', { r: 0.7, map: leatherTexture() });
  const T = buildBody(rig, {
    skin, top: shirt, legs: pants, hands: glove, sleeves: 'rolled', shoes: 'boot', shoe: mat('#1f1813', { r: 0.7, map: leatherTexture() }), sole: mat('#100c09'),
    muscle: 1, belt: mat('#2a2018', { r: 0.6, map: leatherTexture() }),
  });
  // leather apron: bib on the chest, skirt down to the knees
  for (let i = 0; i < 4; i++) {
    const y0 = 0.42 - i * 0.11, y1 = y0 - 0.11;
    const a = T.front(0, y0, 0.012), b = T.front(0, y1, 0.012);
    const m = put(J.spine, rbox((0.26 + i * 0.015) * s, 0.12 * s, 0.014 * s, 0.005 * s), leather, [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2]);
    m.rotation.x = Math.atan2(a.z - b.z, a.y - b.y);
  }
  put(J.hips, rbox(0.32 * s, 0.62 * s, 0.016 * s, 0.006 * s), leather, [0, -0.2 * s, 0.15 * s * rig.w], [-0.1, 0, 0]);
  for (const sx of [-1, 1]) link(J.chest, V(sx * 0.1 * s, -0.04 * s, 0.1 * s), V(sx * 0.06 * s, 0.04 * s, -0.06 * s), 0.012 * s, 0.012 * s, leather);
  // rusty rods pierce his shoulders and back
  const rust = mat('#6b4a32', { r: 0.6, m: 0.5, map: rustMetalTexture('#6a4a38') });
  link(J.chest, V(0.12 * s, -0.12 * s, -0.12 * s), V(0.24 * s, 0.18 * s, -0.22 * s), 0.013 * s, 0.01 * s, rust);
  link(J.chest, V(-0.08 * s, -0.2 * s, -0.12 * s), V(-0.26 * s, 0.1 * s, -0.25 * s), 0.013 * s, 0.01 * s, rust);
  link(J.shL, V(0, -0.02 * s, 0), V(0.08 * s, 0.14 * s, 0.03 * s), 0.011 * s, 0.009 * s, rust);
  // bear traps hanging from the belt
  for (const sx of [-1, 1]) {
    const t = beltTrap(s * 0.75);
    t.position.set(sx * 0.2 * s * rig.w, -0.02 * s, -0.02 * s);
    t.rotation.set(0, sx * Math.PI / 2, 0.2 * sx);
    J.hips.add(t);
  }
  // head: matted hair and the grinning white mask
  const head = new Head(rig, { R: 0.115 * s, jaw: 0.1, chin: 0.16, brow: 0.06 }, skin);
  rig.headMesh = head.mesh;
  head.ears();
  addHair(head, 'matted', '#1e1a16');
  const maskM = mat('#e3dccd', { r: 0.55, map: bloodyTexture(271) });
  const mask = maskShell(head, maskM, -0.95, 0.66, 0.12);
  void mask;
  const R = head.H.R, black = mat('#050404', { r: 1 });
  for (const sx of [-1, 1]) {
    const e = head.front(sx * 0.32, 0.06, 0.08).p;
    put(J.head, sph(0.13 * R, 10, 8), black, [e.x, e.y, e.z], null, [1.1, 0.8, 0.5]);
  }
  // the grin: a dark slot full of crooked teeth
  const slot = [head.front(-0.5, -0.34, 0.1).p, head.front(-0.25, -0.5, 0.11).p, head.front(0.25, -0.5, 0.11).p, head.front(0.5, -0.34, 0.1).p];
  chain(J.head, slot, [0.06 * R, 0.1 * R, 0.1 * R, 0.06 * R], black);
  const tooth = mat('#d8cfb0', { r: 0.5 });
  for (let i = 0; i < 9; i++) {
    const x = -0.4 + i * 0.1;
    const y = -0.36 - 0.14 * (1 - (x / 0.5) ** 2);
    const p = head.front(x, y, 0.17).p;
    put(J.head, rbox(0.075 * R, (0.15 + (i % 3) * 0.03) * R, 0.05 * R, 0.015 * R), tooth, [p.x, p.y, p.z], [0, 0, (i % 2 ? 0.12 : -0.1)]);
  }
  rig.weapon = createWeapon('trapper', s);
  J.handR.add(rig.weapon);
}

function beltTrap(k) {
  const g = new THREE.Group();
  const metal = mat('#5c5650', { r: 0.45, m: 0.8, map: rustMetalTexture('#6a625a') });
  put(g, cyl(0.07 * k, 0.07 * k, 0.025 * k, 12), metal, [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (const sx of [-1, 1]) {
    put(g, tor(0.16 * k, 0.013 * k, 5, 12, Math.PI), metal, [0, 0, sx * 0.01 * k], [0, 0, sx > 0 ? 0 : Math.PI]);
    for (let i = 1; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      put(g, cone(0.012 * k, 0.045 * k, 4), metal, [Math.cos(a) * 0.15 * k * sx, Math.sin(a) * 0.15 * k * sx, 0], [0, 0, a + (sx > 0 ? -Math.PI / 2 : Math.PI / 2)]);
    }
  }
  return g;
}

function buildWraith(rig, s) {
  const J = rig.j;
  const skin = skinMat('#55524a', 0.8);
  const rag = mat('#6b665a', { r: 0.95, map: fabricTexture() });
  const dark = mat('#2f2c27', { r: 0.95, map: fabricTexture() });
  const T = buildBody(rig, {
    skin, top: skin, legs: dark, hands: skin, sleeves: 'none', shoes: 'wrap', shoe: rag, sole: rag, hem: false,
  });
  // bandages wound around the body and limbs
  for (let i = 0; i < 6; i++) {
    const y = 0.02 + i * 0.075;
    const r0 = profileR(TORSO, y);
    put(J.spine, tor(r0 * s * 1.02, 0.012 * s, 4, 20), rag, [0, y * s, 0], [Math.PI / 2 + (i % 2 ? 0.16 : -0.16), 0, 0], [T.tsx, T.tsz, 1]);
  }
  for (const j of [J.shL, J.shR, J.elL, J.elR]) for (let i = 0; i < 3; i++) put(j, tor(0.05 * s * rig.w, 0.009 * s, 4, 14), rag, [0, -(0.06 + i * 0.08) * s, 0], [Math.PI / 2 + (i % 2 ? 0.25 : -0.25), 0, 0]);
  for (const j of [J.knL, J.knR]) for (let i = 0; i < 3; i++) put(j, tor(0.056 * s * rig.w, 0.009 * s, 4, 14), rag, [0, -(0.06 + i * 0.1) * s, 0], [Math.PI / 2 + (i % 2 ? 0.25 : -0.25), 0, 0]);
  // tattered strips hanging from the hips and arms
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const len = (0.28 + ((i * 37) % 10) / 40) * s;
    const strip = put(J.hips, rbox(0.06 * s, len, 0.006 * s, 0.003 * s), i % 2 ? rag : dark, [Math.sin(a) * 0.16 * s * rig.w, 0.06 * s - len / 2, Math.cos(a) * 0.12 * s * rig.w]);
    strip.rotation.set(Math.cos(a) * 0.12, a, -Math.sin(a) * 0.12);
  }
  for (const [el, sx] of [[J.elL, 1], [J.elR, -1]]) put(el, rbox(0.03 * s, 0.22 * s, 0.004 * s, 0.002 * s), rag, [sx * 0.04 * s, -0.12 * s, -0.02 * s], [0, 0, sx * 0.15]);
  // gaunt head, sunken eyes and the painted smile
  const head = new Head(rig, { R: 0.11 * s, jaw: 0.36, chin: 0.18, brow: 0.08, cheek: -0.05 }, skin);
  rig.headMesh = head.mesh;
  head.ears();
  const R = head.H.R;
  for (let i = 0; i < 3; i++) head.shell((n) => gauss(n.y - (0.55 - i * 0.32) - n.x * (i % 2 ? 0.25 : -0.2), 0.07) * sstep(-0.2, 0.0, az(n) + 0.9), () => 0.04, rag, 32, 24);
  for (const sx of [-1, 1]) {
    const e = head.front(sx * 0.3, 0.05, -0.02).p;
    put(J.head, sph(0.14 * R, 10, 8), mat('#0a0908', { r: 1 }), [e.x, e.y, e.z], null, [1.2, 0.85, 0.5]);
    const g = head.front(sx * 0.3, 0.05, 0.03).p;
    put(J.head, sph(0.035 * R, 8, 6), mat('#e8e2d0', { e: '#fff2c0', ei: 0.4 }), [g.x, g.y, g.z]);
  }
  const white = mat('#e6e1d6', { r: 0.6, e: '#444', ei: 0.3 });
  const smile = [];
  for (let i = 0; i <= 6; i++) { const x = -0.55 + i * (1.1 / 6); smile.push(head.front(x, -0.38 - 0.2 * (1 - (x / 0.55) ** 2), 0.02).p); }
  chain(J.head, smile, [0.03, 0.05, 0.06, 0.06, 0.06, 0.05, 0.03].map((v) => v * R), white);
  rig.weapon = createWeapon('wraith', s);
  J.handR.add(rig.weapon);
  rig.bell = createBell(s);
  J.handL.add(rig.bell);
}

function buildHillbilly(rig, s) {
  const J = rig.j;
  const skin = skinMat('#c08a70', 0.6);
  const denim = mat('#3e5070', { r: 0.9, map: denimTexture() });
  const T = buildBody(rig, {
    skin, top: denim, legs: denim, hands: skin, sleeves: 'none', shoes: 'boot', shoe: mat('#2a1f17', { r: 0.7, map: leatherTexture() }), sole: mat('#120d09'),
    belly: 1, muscle: 0.6, neckline: 0.3,
  });
  // overalls: straps with buckles over bare shoulders, bib pocket
  const brass = mat('#a08850', { r: 0.35, m: 0.8 });
  for (const sx of [-1, 1]) {
    chain(J.spine, [T.front(sx * 0.09, 0.29, 0.004), V(sx * 0.11 * s * rig.w, 0.47 * s, 0.035 * s), V(sx * 0.11 * s * rig.w, 0.47 * s, -0.035 * s), T.back(sx * 0.08, 0.29, 0.004)], [0.013 * s, 0.013 * s, 0.013 * s, 0.013 * s], denim);
    for (const m of J.spine.children.slice(-3)) m.scale.set(2.4, 1, 0.7);
    const b = T.front(sx * 0.09, 0.28, 0.016);
    put(J.spine, rbox(0.04 * s, 0.035 * s, 0.012 * s, 0.004 * s), brass, [b.x, b.y, b.z]);
  }
  const pk = T.front(0, 0.2, 0.012);
  put(J.spine, rbox(0.13 * s, 0.1 * s, 0.012 * s, 0.006 * s), denim, [pk.x, pk.y, pk.z]);
  // misshapen bald head with uneven eyes and crooked teeth
  const head = new Head(rig, {
    R: 0.115 * s, jaw: 0.05, chin: 0.1, brow: 0.1,
    lumps: [{ dir: V(0.5, 0.8, 0.2).normalize(), amt: 0.2, w: 0.45 }, { dir: V(-0.75, -0.2, 0.6).normalize(), amt: 0.12, w: 0.3 }, { dir: V(0.2, 0.3, -0.9).normalize(), amt: 0.08, w: 0.4 }],
  }, skin);
  rig.headMesh = head.mesh;
  head.ears();
  head.eyes('#c8b070', { sizes: [1.15, 0.8], ys: [-0.05, 0.08], lid: -0.3 });
  head.nose({ len: 1.1, w: 1.3 });
  head.brows('#3a2a1c', { thick: 1.3, inner: -0.04 });
  // scars and burns
  for (const [x, y, r0] of [[0.35, 0.55, 0.22], [-0.45, 0.2, 0.16], [0.1, 0.85, 0.18]]) {
    const p = head.front(x, y, -0.06).p;
    put(J.head, sph(r0 * head.H.R, 10, 8), mat('#9a5a4a', { r: 0.5, map: bloodyTexture(281) }), [p.x, p.y, p.z], null, [1, 1, 0.5]);
  }
  const R = head.H.R;
  const gum = mat('#5a2420', { r: 0.6 });
  chain(J.head, [head.front(-0.32, -0.5, 0.02).p, head.front(0, -0.56, 0.04).p, head.front(0.3, -0.48, 0.02).p], [0.06 * R, 0.09 * R, 0.06 * R], gum);
  const tooth = mat('#cfc49a', { r: 0.5 });
  for (let i = 0; i < 6; i++) {
    const x = -0.25 + i * 0.1;
    const p = head.front(x, -0.5 + (i % 2) * 0.03, 0.1).p;
    put(J.head, rbox(0.07 * R, 0.12 * R, 0.05 * R, 0.015 * R), tooth, [p.x, p.y, p.z], [0.2, 0, (i % 3 - 1) * 0.25]);
  }
  rig.weapon = createWeapon('hillbilly', s);
  J.handR.add(rig.weapon);
  rig.saw = createChainsaw(s);
  J.handL.add(rig.saw);
}

function buildHuntress(rig, s) {
  const J = rig.j;
  const skin = skinMat('#d8c0a8', 0.65);
  const dress = mat('#5a4535', { r: 0.9, map: fabricTexture() });
  const fur = mat('#6d5641', { r: 1, map: furTexture() });
  const T = buildBody(rig, {
    skin, top: dress, legs: mat('#4a3829', { map: fabricTexture() }), hands: skin, sleeves: 'none', shoes: 'boot', shoe: fur, sole: mat('#2a2018'), fem: true, muscle: 1, hem: false,
  });
  // patterned bands on the dress
  const red = mat('#8a2a1e', { r: 0.8, map: fabricTexture() });
  for (const y of [0.05, 0.12]) put(J.spine, tor(profileR(TORSO_F, y) * s * 1.02, 0.012 * s, 4, 22), red, [0, y * s, 0], [Math.PI / 2, 0, 0], [T.tsx, T.tsz, 1]);
  // long skirt
  put(J.hips, lathe([[0.16, 0.08], [0.2, -0.05], [0.27, -0.3], [0.31, -0.5], [0.3, -0.52], [0, -0.52]].reverse(), s, 20), dress, [0, 0, 0], null, [rig.w, 1, 0.85 * rig.w]);
  put(J.hips, tor(0.305 * s, 0.014 * s, 4, 24), red, [0, -0.47 * s, 0], [Math.PI / 2, 0, 0], [rig.w, 0.85 * rig.w, 1]);
  put(J.hips, tor(0.165 * s, 0.022 * s, 5, 22), mat('#3a2a1c', { r: 0.6, map: leatherTexture() }), [0, 0.08 * s, 0], [Math.PI / 2, 0, 0], [rig.w, 0.85 * rig.w, 1]);
  // fur mantle over the shoulders
  put(J.chest, sph(0.25 * s, 18, 12), fur, [0, 0.0, -0.02 * s], null, [1.3 * rig.w * 0.85, 0.55, 1.05 * rig.w * 0.75]);
  put(J.chest, tor(0.15 * s, 0.06 * s, 8, 20), fur, [0, 0.02 * s, -0.01 * s], [Math.PI / 2, 0, 0], [1.2, 0.95, 1]);
  // wraps on the forearms, hatchets at the hips
  for (const el of [J.elL, J.elR]) for (let i = 0; i < 3; i++) put(el, tor(0.046 * s * rig.w, 0.01 * s, 4, 14), mat('#7a6a55', { map: fabricTexture() }), [0, -(0.1 + i * 0.05) * s, 0], [Math.PI / 2 + (i % 2 ? 0.2 : -0.2), 0, 0]);
  for (const sx of [-1, 1]) {
    const h = createHatchet(s * 0.9);
    h.position.set(sx * 0.2 * s * rig.w, 0.06 * s, 0.04 * s);
    h.rotation.set(0.1, sx * 0.4, sx * 0.15);
    J.hips.add(h);
  }
  // head: braids behind and the rabbit mask
  const head = new Head(rig, { R: 0.115 * s, jaw: 0.25, chin: 0.1 }, skin);
  rig.headMesh = head.mesh;
  head.ears();
  addHair(head, 'tied', '#2a1e16');
  const R = head.H.R, hair = mat('#2a1e16', { r: 0.7, map: hairTexture() });
  for (const sx of [-1, 1]) {
    const pts = [], radii = [];
    for (let i = 0; i < 7; i++) {
      pts.push(V(sx * (0.35 - i * 0.03) * R, head.o.y + (-0.3 - i * 0.42) * R, (-0.75 - i * 0.05) * R));
      radii.push((i % 2 ? 0.12 : 0.16) * R * (1 - i * 0.06));
    }
    chain(J.head, pts, radii, hair);
  }
  const maskM = mat('#ddd5c6', { r: 0.6, map: bloodyTexture(291) });
  maskShell(head, maskM, -0.9, 0.75, 0.12);
  // rabbit snout, painted nose, eye holes and long ears
  const snout = head.front(0, -0.28, 0.12).p;
  put(J.head, sph(0.32 * R, 14, 10), maskM, [snout.x, snout.y, snout.z - 0.1 * R], null, [1.1, 0.75, 0.75]);
  const np = head.front(0, -0.16, 0.38).p;
  put(J.head, sph(0.08 * R, 8, 6), mat('#4a1e1a', { r: 0.7 }), [np.x, np.y, np.z], null, [1.3, 0.8, 0.6]);
  for (const sx of [-1, 1]) {
    const e = head.front(sx * 0.32, 0.12, 0.1).p;
    put(J.head, sph(0.12 * R, 10, 8), mat('#050404', { r: 1 }), [e.x, e.y, e.z], null, [1.1, 0.75, 0.5]);
    const base = V(sx * 0.32 * R, head.o.y + 0.95 * R, -0.05 * R);
    const mid = base.clone().add(V(sx * 0.18 * R, 1.6 * R, -0.15 * R));
    const tip = base.clone().add(V(sx * 0.3 * R, 2.7 * R, -0.05 * R));
    chain(J.head, [base, mid, tip], [0.2 * R, 0.24 * R, 0.08 * R], maskM);
    for (const m of J.head.children.slice(-2)) m.scale.set(1, 1, 0.45);
  }
  rig.weapon = createWeapon('huntress', s);
  J.handR.add(rig.weapon);
  rig.hatchet = createHatchet(s);
  rig.hatchet.visible = false;
  J.handL.add(rig.hatchet);
}

// ------------------------------------------------------------ weapons --
export function createWeapon(id, s = 1) {
  const g = new THREE.Group();
  const wood = mat('#4d3a28', { r: 0.8, map: fabricTexture() });
  const wrap = mat('#2a221c', { r: 0.9, map: leatherTexture() });
  if (id === 'trapper') {
    // butcher's cleaver
    put(g, cyl(0.02 * s, 0.022 * s, 0.22 * s, 8), wrap, [0, -0.06 * s, 0]);
    put(g, cyl(0.026 * s, 0.026 * s, 0.03 * s, 8), mat('#5a5048', { r: 0.4, m: 0.8 }), [0, -0.17 * s, 0]);
    const blade = mat('#8f8b84', { r: 0.4, m: 0.75, map: bloodyTexture(301) });
    put(g, rbox(0.016 * s, 0.5 * s, 0.13 * s, 0.006 * s), blade, [0, -0.43 * s, 0.035 * s]);
    put(g, rbox(0.02 * s, 0.06 * s, 0.15 * s, 0.006 * s), blade, [0, -0.66 * s, 0.025 * s], [0.25, 0, 0]);
    g.rotation.x = -1.3;
  } else if (id === 'wraith') {
    // Azarov's skull on a spine
    const bone = mat('#d6ccb6', { r: 0.7 });
    put(g, cyl(0.022 * s, 0.026 * s, 0.6 * s, 8), wrap, [0, -0.25 * s, 0]);
    for (let i = 0; i < 6; i++) {
      put(g, cyl(0.036 * s, 0.036 * s, 0.03 * s, 8), bone, [0, -0.08 * s - i * 0.075 * s, 0]);
      put(g, rbox(0.1 * s, 0.014 * s, 0.02 * s, 0.006 * s), bone, [0, -0.08 * s - i * 0.075 * s, -0.012 * s]);
    }
    put(g, sph(0.07 * s, 12, 10), bone, [0, -0.6 * s, 0], null, [0.9, 1.05, 1]);
    put(g, rbox(0.08 * s, 0.04 * s, 0.075 * s, 0.016 * s), bone, [0, -0.66 * s, 0.025 * s]);
    for (const sx of [-1, 1]) put(g, sph(0.02 * s, 8, 6), mat('#140f0c'), [sx * 0.027 * s, -0.61 * s, 0.058 * s]);
    g.rotation.x = -1.2;
  } else if (id === 'hillbilly') {
    // sledgehammer
    put(g, cyl(0.02 * s, 0.024 * s, 0.6 * s, 8), wood, [0, -0.22 * s, 0]);
    put(g, cyl(0.026 * s, 0.026 * s, 0.14 * s, 8), wrap, [0, -0.02 * s, 0]);
    const head = mat('#6d6a64', { r: 0.45, m: 0.8, map: rustMetalTexture('#6d6a64') });
    put(g, rbox(0.075 * s, 0.08 * s, 0.2 * s, 0.012 * s), head, [0, -0.5 * s, 0.02 * s]);
    g.rotation.x = -1.2;
  } else if (id === 'huntress') {
    // great hunting axe
    put(g, cyl(0.024 * s, 0.028 * s, 0.8 * s, 8), wood, [0, -0.32 * s, 0]);
    for (let i = 0; i < 3; i++) put(g, cyl(0.03 * s, 0.03 * s, 0.03 * s, 8), wrap, [0, -0.02 * s - i * 0.04 * s, 0]);
    const steel = mat('#8f8b83', { r: 0.4, m: 0.7, map: bloodyTexture(311) });
    const blade = put(g, new THREE.CylinderGeometry(0.21 * s, 0.21 * s, 0.022 * s, 18, 1, false, 0, Math.PI * 0.8), steel, [0, -0.64 * s, 0.03 * s]);
    blade.rotation.z = Math.PI / 2;
    blade.rotation.y = Math.PI / 2;
    put(g, rbox(0.03 * s, 0.1 * s, 0.07 * s, 0.01 * s), steel, [0, -0.64 * s, -0.01 * s]);
    g.rotation.x = -1.3;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function createHatchet(s = 1) {
  const g = new THREE.Group();
  put(g, cyl(0.015 * s, 0.017 * s, 0.38 * s, 6), mat('#5a4330', { map: fabricTexture() }), [0, -0.14 * s, 0]);
  put(g, cyl(0.019 * s, 0.019 * s, 0.07 * s, 6), mat('#2a221c', { map: leatherTexture() }), [0, -0.02 * s, 0]);
  put(g, rbox(0.014 * s, 0.1 * s, 0.13 * s, 0.004 * s), mat('#8f8b83', { r: 0.4, m: 0.7 }), [0, -0.3 * s, 0.06 * s]);
  g.rotation.x = -1.2;
  return g;
}

export function createChainsaw(s = 1) {
  const g = new THREE.Group();
  const red = mat('#8a1d14', { r: 0.55, m: 0.3, map: rustMetalTexture('#8a2a1e') });
  const steel = mat('#9a9a9a', { r: 0.3, m: 0.9 });
  const dark = mat('#1e1c1a', { r: 0.6, m: 0.4 });
  put(g, rbox(0.16 * s, 0.2 * s, 0.36 * s, 0.03 * s), red, [0, -0.05 * s, 0.05 * s]);
  put(g, cyl(0.07 * s, 0.07 * s, 0.17 * s, 14), dark, [0, -0.02 * s, -0.06 * s], [0, 0, Math.PI / 2]);
  put(g, tor(0.09 * s, 0.014 * s, 6, 16, Math.PI), dark, [0, 0.08 * s, 0.06 * s], [0, Math.PI / 2, 0]);
  put(g, cyl(0.02 * s, 0.02 * s, 0.2 * s, 8), dark, [0, 0.12 * s, 0.0]);
  put(g, rbox(0.035 * s, 0.11 * s, 0.78 * s, 0.03 * s), steel, [0, -0.05 * s, 0.6 * s]);
  for (let i = 0; i < 14; i++) put(g, rbox(0.042 * s, 0.018 * s, 0.03 * s, 0.004 * s), dark, [0, (i % 2 ? 0.01 : -0.11) * s, (0.26 + (i >> 1) * 0.1) * s]);
  put(g, cyl(0.016 * s, 0.016 * s, 0.07 * s, 8), dark, [0.07 * s, 0.04 * s, -0.08 * s], [0, 0, Math.PI / 2]);
  g.position.set(0, -0.05, 0.1);
  return g;
}

export function createBell(s = 1) {
  const g = new THREE.Group();
  put(g, cyl(0.012 * s, 0.012 * s, 0.25 * s, 6), mat('#4a3a2a', { map: leatherTexture() }), [0, -0.05 * s, 0]);
  const bronze = mat('#6e5a3a', { r: 0.4, m: 0.7, side: THREE.DoubleSide });
  put(g, new THREE.CylinderGeometry(0.05 * s, 0.11 * s, 0.16 * s, 14, 1, true), bronze, [0, -0.24 * s, 0]);
  put(g, sph(0.05 * s, 12, 6), bronze, [0, -0.16 * s, 0], null, [1, 0.5, 1]);
  put(g, tor(0.11 * s, 0.01 * s, 5, 16), bronze, [0, -0.32 * s, 0], [Math.PI / 2, 0, 0]);
  return g;
}

// First-person killer forearm and hand (pointing down -z, fist at the origin).
export function createKillerArm(id) {
  const g = new THREE.Group();
  const look = {
    trapper: [mat('#4e4337', { map: bloodyTexture(251) }), mat('#2c241c', { r: 0.7, map: leatherTexture() }), true],
    wraith: [skinMat('#55524a', 0.8), skinMat('#55524a', 0.8), false],
    hillbilly: [skinMat('#c08a70', 0.6), skinMat('#c08a70', 0.6), false],
    huntress: [skinMat('#d8c0a8', 0.65), skinMat('#d8c0a8', 0.65), false],
  }[id] || [mat('#4b3b2b'), mat('#c9a88a'), false];
  const [sleeve, hand, rolled] = look;
  const arm = put(g, seg(0.058, 0.044, 0.4, 0.008, 0.7), sleeve, [0, 0, 0.3]);
  arm.rotation.x = -Math.PI / 2;
  if (rolled) put(g, tor(0.06, 0.018, 6, 16), sleeve, [0, 0, 0.27], null, [1, 1, 1.3]);
  if (id === 'wraith' || id === 'huntress') {
    const wrapM = mat(id === 'wraith' ? '#6b665a' : '#7a6a55', { map: fabricTexture() });
    for (let i = 0; i < 3; i++) put(g, tor(0.05, 0.01, 4, 14), wrapM, [0, 0, 0.02 + i * 0.06], [0, i % 2 ? 0.2 : -0.2, 0]);
  }
  put(g, sph(0.042, 10, 8), hand, [0, 0, -0.06]);
  put(g, rbox(0.085, 0.095, 0.1, 0.03), hand, [0, 0.0, -0.11]);
  const th = put(g, seg(0.02, 0.016, 0.06), hand, [0.035, 0.03, -0.09]);
  th.rotation.set(-1.2, 0, -0.6);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; } });
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

// Render a head-and-shoulders portrait (data URL) with the given renderer.
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
  const st = rig.kind === 'killer' ? { anim: 'idle', speed: 0 } : { anim: 'idle', speed: 0 };
  for (let i = 0; i < 30; i++) (rig.kind === 'killer' ? killerPose : survivorPose)(rig, st, 0.1);
  for (const l of rig.lids) l.m.rotation.x = l.open;
  rig.root.rotation.y = 0.3;
  rig.root.updateMatrixWorld(true);
  const headPos = V();
  rig.j.head.getWorldPosition(headPos);
  const H = rig.kind === 'killer' ? rig.s * 1.75 : 1.75;
  const cam = new THREE.PerspectiveCamera(15, w / h, 0.1, 50);
  cam.position.set(0.45 * (H / 1.75), headPos.y + 0.02 * H, 3.4 * (H / 1.75));
  cam.lookAt(0, headPos.y - 0.09 * H, 0);
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
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
  disposeRig(rig);
  return cv.toDataURL();
}
