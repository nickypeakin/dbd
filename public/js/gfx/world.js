// Builds the 3D world for a match from the map JSON and keeps dynamic props
// (pallets, generators, gates, hatch, totems, chests, lockers, traps) in sync
// with the game state.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { REALMS } from '/shared/data.js';
import { MAP_HALF } from '/shared/constants.js';
import { createSky } from './renderer.js';
import * as TX from './textures.js';
import {
  createGenerator, createHook, createPalletMesh, createLocker, createChest, createTotem, createGate, createSwitch,
  createHatch, createBearTrap, createHatchetProjectile, deadTreeGeometry, pineGeometry, rockGeometry, createCar, mulberry,
  createEntityLegs, mergeGroup,
} from './props.js';
import { mat } from './models.js';

// Box geometry whose UVs are scaled to world size (texture tiles every `tile` metres).
function worldBox(w, h, d, tile = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // faces: px, nx, py, ny, pz, nz (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  return g;
}

function setLayerDeep(obj, layer, on) {
  obj.traverse((o) => { if (o.isMesh) { if (on) o.layers.enable(layer); else o.layers.disable(layer); } });
}
export { setLayerDeep };

export class World {
  constructor(map, scene) {
    this.map = map;
    this.scene = scene;
    this.realm = REALMS[map.realm] || REALMS.macmillan;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.rnd = mulberry(map.seed ^ 0x5bd1e995);
    this.t = 0;
  }

  build(progress = () => {}) {
    const R = this.realm;
    const scene = this.scene;
    scene.background = new THREE.Color(R.fog);
    scene.fog = new THREE.FogExp2(R.fog, R.fogDensity);
    this.sky = createSky(R.skyTop, R.skyHorizon, R.moon);
    scene.add(this.sky);
    // lights
    this.hemi = new THREE.HemisphereLight(R.hemiSky, R.hemiGround, 1.35);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight('#4a5466', 0.45);
    scene.add(this.ambient);
    const moon = (this.moon = new THREE.DirectionalLight(R.moon, 1.9 * R.moonIntensity));
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 140;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.04;
    this.moonDir = this.sky.userData.moonDir.clone();
    scene.add(moon, moon.target);
    // pooled point lights for gens, gates, totems, hatch
    this.pool = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight('#ffcc88', 0, 12, 1.8);
      scene.add(l);
      this.pool.push(l);
    }
    this.lightSources = [];
    progress(0.1);
    this.buildGround();
    progress(0.2);
    this.buildWalls();
    progress(0.4);
    this.buildProps();
    progress(0.6);
    this.buildVegetation();
    progress(0.85);
    this.buildBoundary();
    progress(1);
  }

  // --------------------------------------------------------------- ground --
  buildGround() {
    const R = this.realm;
    const tex = TX.groundTexture(R.ground, R.ground2);
    tex.repeat.set(36, 36);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, color: '#ffffff' }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
    // building floors
    const floorMat = mat('#6b5a45', { map: TX.woodTexture('#5a4a38', false) });
    for (const f of this.map.floors) {
      const g = worldBox(f.w, 0.06, f.d, 1.5);
      const m = new THREE.Mesh(g, floorMat);
      m.position.set(f.x, 0.03, f.z);
      m.receiveShadow = true;
      this.root.add(m);
    }
  }

  // ---------------------------------------------------------------- walls --
  wallMaterial(k) {
    const R = this.realm;
    switch (k) {
      case 'brick': return mat('#8a6a5c', { map: TX.brickTexture('#6e3a2a') });
      case 'stone': return mat('#9a968c', { map: TX.stoneTexture('#77746c') });
      case 'wood': case 'woodplank': return mat('#8a7560', { map: TX.woodTexture('#6a5440', true) });
      case 'woodhouse': return mat('#8c8478', { map: TX.woodTexture('#7a7468', false) });
      case 'corrugated': return mat('#9a8c80', { map: TX.corrugatedTexture('#6a6058'), m: 0.3, r: 0.6 });
      case 'sill': return mat('#6a5644', { map: TX.woodTexture('#5a4636', false) });
      case 'gatewall': return mat('#8a877f', { map: TX.concreteTexture('#7a776f') });
      case 'hay': return mat('#a08a48', { map: TX.hayTexture() });
      case 'junk': return mat('#7a6a5c', { map: TX.corrugatedTexture('#5a4a40'), m: 0.4, r: 0.6 });
      case 'log': return mat('#6a5644', { map: TX.barkTexture() });
      case 'boundary_rockwall': return mat('#8a867c', { map: TX.stoneTexture('#605d56') });
      case 'boundary_fence': return mat('#8a7c70', { map: TX.corrugatedTexture('#5d5047'), m: 0.3 });
      case 'boundary_corn': return mat('#6a6232');
      default: return mat('#888', { map: TX.concreteTexture() });
    }
    void R;
  }

  buildWalls() {
    const groups = new Map();
    const add = (k, geo) => {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(geo);
    };
    const rockGeos = [rockGeometry(3), rockGeometry(8), rockGeometry(13)];
    const rockMat = new THREE.MeshStandardMaterial({ map: TX.rockTexture(), roughness: 1, color: '#b0aca2' });
    const rocks = [];
    for (const w of this.map.walls) {
      if (w.k === 'boundary_corn') continue;
      if (w.k === 'rockblock') {
        rocks.push(w);
        continue;
      }
      if (w.k === 'car' || w.k === 'carstack') {
        const along = w.d > w.w;
        const colors = ['#6b2f24', '#3a4a5a', '#5a5a3a', '#4a3a2a', '#6a6a6a'];
        const levels = w.k === 'carstack' ? 2 : 1;
        for (let l = 0; l < levels; l++) {
          const car = createCar(colors[Math.floor(this.rnd() * colors.length)]);
          car.position.set(w.x, l * 1.45, w.z);
          car.rotation.y = (along ? 0 : Math.PI / 2) + (this.rnd() - 0.5) * 0.15 + (l ? 0.2 : 0);
          this.root.add(car);
        }
        continue;
      }
      if (w.k === 'log') {
        const along = w.d > w.w;
        const len = Math.max(w.w, w.d);
        const g = new THREE.CylinderGeometry(w.h / 2, w.h / 2 + 0.05, len, 10);
        g.rotateZ(Math.PI / 2);
        if (along) g.rotateY(Math.PI / 2);
        g.translate(w.x, w.h / 2, w.z);
        add('log', g);
        continue;
      }
      const tile = w.k === 'brick' || w.k === 'stone' || w.k === 'boundary_rockwall' ? 2.6 : 2;
      const g = worldBox(w.w, w.h, w.d, tile);
      g.translate(w.x, w.h / 2, w.z);
      add(w.k, g);
    }
    // lintels
    for (const l of this.map.lintels) {
      const g = worldBox(l.w, l.y1 - l.y0, l.d, 2);
      g.translate(l.x, (l.y0 + l.y1) / 2, l.z);
      add(l.k, g);
    }
    // window frames
    for (const w of this.map.windows) {
      const alongX = Math.abs(w.nz) > 0.5;
      const fw = w.w + 0.12;
      const top = Math.min(2.05, w.h);
      for (const s of [-1, 1]) {
        const g = worldBox(alongX ? 0.08 : 0.46, top - 0.9, alongX ? 0.46 : 0.08);
        g.translate(w.x + (alongX ? s * fw / 2 : 0), (0.9 + top) / 2, w.z + (alongX ? 0 : s * fw / 2));
        add('sill', g);
      }
      const g = worldBox(alongX ? w.w : 0.48, 0.06, alongX ? 0.48 : w.w);
      g.translate(w.x, 0.92, w.z);
      add('sill', g);
    }
    for (const [k, geos] of groups) {
      const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      const mesh = new THREE.Mesh(merged, this.wallMaterial(k));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    // rock blocks as boulders
    for (const w of rocks) {
      const m = new THREE.Mesh(rockGeos[Math.floor(this.rnd() * 3)], rockMat);
      m.position.set(w.x, w.h * 0.42, w.z);
      m.scale.set(w.w * 0.62, w.h * 0.62, w.d * 0.62);
      m.rotation.y = this.rnd() * 6;
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
    }
    // roofs
    const roofMat = mat('#6a5a50', { map: TX.roofTexture() });
    for (const r of this.map.roofs) {
      const g = worldBox(r.w, 0.25, r.d, 2);
      const m = new THREE.Mesh(g, roofMat);
      m.position.set(r.x, r.y + 0.125, r.z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
      this.roofs = this.roofs || [];
      this.roofs.push({ mesh: m, x: r.x, z: r.z, w: r.w, d: r.d });
    }
  }

  // ---------------------------------------------------------------- props --
  buildProps() {
    const M = this.map;
    // generators
    this.gens = M.gens.map((g) => {
      const o = createGenerator();
      o.group.position.set(g.x, 0, g.z);
      o.group.rotation.y = g.rot;
      this.root.add(o.group);
      o.light = { x: g.x + Math.sin(g.rot) * -0.3, y: 2.4, z: g.z, color: '#ffd27a', i: 0, dist: 14 };
      this.lightSources.push(o.light);
      o.data = g;
      o.phase = this.rnd() * 6;
      return o;
    });
    // hooks
    this.hooks = M.hooks.map((h) => {
      const g = mergeGroup(createHook());
      g.position.set(h.x, 0, h.z);
      g.rotation.y = h.rot;
      this.root.add(g);
      return { group: g, data: h, legs: null };
    });
    // pallets
    const palletGeo = createPalletMesh();
    this.pallets = M.pallets.map((p) => {
      const pivot = new THREE.Group();
      const tx = -p.nz, tz = p.nx;
      const end = p.lean * (p.len / 2 + 0.05);
      pivot.position.set(p.x + tx * end, 0, p.z + tz * end);
      const mesh = palletGeo.clone();
      mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      pivot.add(mesh);
      this.root.add(pivot);
      // orientations: standing (long axis up) and dropped (long axis across the gap)
      const n = new THREE.Vector3(p.nx, 0, p.nz);
      const t = new THREE.Vector3(tx, 0, tz);
      const basis = new THREE.Matrix4().makeBasis(n.clone().cross(new THREE.Vector3(0, 1, 0)).negate(), new THREE.Vector3(0, 1, 0), n);
      const qStand = new THREE.Quaternion().setFromRotationMatrix(basis);
      const lean = new THREE.Quaternion().setFromAxisAngle(n, -p.lean * 0.12);
      qStand.premultiply(lean);
      // dropping rotates around the normal so "up" points along -lean * tangent
      const target = t.clone().multiplyScalar(-p.lean);
      const qFall = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), target);
      const qDrop = qFall.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(basis));
      pivot.quaternion.copy(qStand);
      return { pivot, mesh, data: p, qStand, qDrop, state: 'u', f: 0 };
    });
    // lockers
    this.lockers = M.lockers.map((l) => {
      const o = createLocker();
      o.group.position.set(l.x, 0, l.z);
      o.group.rotation.y = l.rot;
      this.root.add(o.group);
      o.data = l;
      o.open = 0;
      o.openT = 0;
      return o;
    });
    // chests
    this.chests = M.chests.map((c) => {
      const o = createChest();
      o.group.position.set(c.x, 0, c.z);
      o.group.rotation.y = c.rot;
      this.root.add(o.group);
      o.data = c;
      return o;
    });
    // totems
    this.totems = M.totems.map((t) => {
      const o = createTotem();
      o.group.position.set(t.x, 0, t.z);
      o.group.rotation.y = t.rot;
      this.root.add(o.group);
      o.data = t;
      o.candles.visible = false;
      o.light = { x: t.x, y: 0.5, z: t.z, color: '#ff7a2a', i: 0, dist: 6 };
      this.lightSources.push(o.light);
      return o;
    });
    // gates
    this.gates = M.gates.map((g) => {
      const o = createGate();
      o.group.position.set(g.x, 0, g.z);
      o.group.rotation.y = Math.atan2(g.nx, g.nz);
      this.root.add(o.group);
      const sw = createSwitch();
      sw.group.position.set(g.sx, 0, g.sz);
      sw.group.rotation.y = Math.atan2(-g.nx, -g.nz);
      this.root.add(sw.group);
      o.sw = sw;
      o.data = g;
      o.light = { x: g.x - g.nx * 0.6, y: 4.6, z: g.z - g.nz * 0.6, color: '#ff3a2a', i: 0, dist: 16 };
      this.lightSources.push(o.light);
      // corridor floor
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 9), mat('#4a4844', { map: TX.concreteTexture('#55524d') }));
      floor.rotation.x = -Math.PI / 2;
      floor.rotation.z = Math.atan2(g.nx, g.nz);
      floor.position.set(g.x + g.nx * 5, 0.02, g.z + g.nz * 5);
      floor.receiveShadow = true;
      this.root.add(floor);
      return o;
    });
    // hatch
    const hatch = createHatch();
    hatch.group.position.set(M.hatch.x, 0, M.hatch.z);
    this.root.add(hatch.group);
    this.hatch = hatch;
    hatch.light = { x: M.hatch.x, y: 0.8, z: M.hatch.z, color: '#aab8ff', i: 0, dist: 8 };
    this.lightSources.push(hatch.light);
    // trap and hatchet pools
    this.traps = new Map();
    this.hatchets = new Map();
    this.entityLegs = createEntityLegs();
    this.entityLegs.visible = false;
    this.root.add(this.entityLegs);
  }

  // ------------------------------------------------------------ vegetation --
  buildVegetation() {
    const R = this.realm;
    const rnd = this.rnd;
    // trees from colliders
    const treeVariants = [deadTreeGeometry(101), deadTreeGeometry(202), deadTreeGeometry(303)];
    const bark = new THREE.MeshStandardMaterial({ map: TX.barkTexture(), color: '#a8988a', roughness: 1 });
    const treeMats = [[], [], []];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    for (const c of this.map.circles) {
      if (c.k !== 'tree') continue;
      const k = Math.floor(rnd() * 3);
      e.set((rnd() - 0.5) * 0.06, rnd() * 6.28, (rnd() - 0.5) * 0.06);
      q.setFromEuler(e);
      const sc = c.r / 0.32;
      m4.compose(v.set(c.x, 0, c.z), q, s.set(sc, 0.9 + rnd() * 0.4, sc));
      treeMats[k].push(m4.clone());
    }
    // forest beyond the boundary
    const B = MAP_HALF + 2;
    for (let i = 0; i < 240; i++) {
      const side = Math.floor(rnd() * 4);
      const u = (rnd() * 2 - 1) * (B + 16);
      const d = B + 1 + rnd() * 22;
      const [x, z] = side === 0 ? [u, d] : side === 1 ? [u, -d] : side === 2 ? [d, u] : [-d, u];
      if (this.map.gates.some((g) => Math.hypot(g.x + g.nx * 6 - x, g.z + g.nz * 6 - z) < 9)) continue;
      const k = Math.floor(rnd() * 3);
      e.set(0, rnd() * 6.28, 0);
      q.setFromEuler(e);
      const sc = 0.8 + rnd() * 0.9;
      m4.compose(v.set(x, 0, z), q, s.set(sc, 0.9 + rnd() * 0.6, sc));
      treeMats[k].push(m4.clone());
    }
    treeVariants.forEach((g, k) => {
      const im = new THREE.InstancedMesh(g, bark, treeMats[k].length);
      treeMats[k].forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      im.receiveShadow = true;
      this.root.add(im);
    });
    // a few pines in the far forest
    const pineG = pineGeometry(7);
    const pineM = new THREE.MeshStandardMaterial({ color: '#1f2a1e', roughness: 1 });
    const pines = [];
    for (let i = 0; i < 160; i++) {
      const side = Math.floor(rnd() * 4);
      const u = (rnd() * 2 - 1) * (B + 30);
      const d = B + 10 + rnd() * 30;
      const [x, z] = side === 0 ? [u, d] : side === 1 ? [u, -d] : side === 2 ? [d, u] : [-d, u];
      e.set(0, rnd() * 6, 0); q.setFromEuler(e);
      const sc = 0.9 + rnd() * 0.8;
      m4.compose(v.set(x, 0, z), q, s.set(sc, sc, sc));
      pines.push(m4.clone());
    }
    const pim = new THREE.InstancedMesh(pineG, pineM, pines.length);
    pines.forEach((mm, i) => pim.setMatrixAt(i, mm));
    this.root.add(pim);
    // rocks
    const rockG = [rockGeometry(21), rockGeometry(34), rockGeometry(55)];
    const rockMat = new THREE.MeshStandardMaterial({ map: TX.rockTexture(), roughness: 1, color: '#b0aca2' });
    const rockMats = [[], [], []];
    for (const c of this.map.circles) {
      if (c.k !== 'rock') continue;
      const k = Math.floor(rnd() * 3);
      e.set(0, rnd() * 6.28, 0); q.setFromEuler(e);
      m4.compose(v.set(c.x, c.h * 0.3, c.z), q, s.set(c.r * 1.1, c.h * 0.6, c.r * 1.1));
      rockMats[k].push(m4.clone());
    }
    rockG.forEach((g, k) => {
      if (!rockMats[k].length) return;
      const im = new THREE.InstancedMesh(g, rockMat, rockMats[k].length);
      rockMats[k].forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      im.receiveShadow = true;
      this.root.add(im);
    });
    // grass tufts
    const grassGeo = new THREE.PlaneGeometry(0.7, 0.5);
    grassGeo.translate(0, 0.25, 0);
    const g2 = grassGeo.clone().rotateY(Math.PI / 2);
    const tuft = mergeGeometries([grassGeo, g2]);
    const grassMat = new THREE.MeshStandardMaterial({ map: TX.grassTuftTexture(), alphaTest: 0.45, side: THREE.DoubleSide, color: R === REALMS.coldwind ? '#b0a070' : '#9a9a78' });
    const N = 5200;
    const grass = new THREE.InstancedMesh(tuft, grassMat, N);
    let n = 0;
    for (let i = 0; i < N * 2 && n < N; i++) {
      const x = (rnd() * 2 - 1) * (MAP_HALF + 6), z = (rnd() * 2 - 1) * (MAP_HALF + 6);
      if (this.map.floors.some((f) => Math.abs(x - f.x) < f.w / 2 && Math.abs(z - f.z) < f.d / 2)) continue;
      e.set(0, rnd() * 6.28, 0); q.setFromEuler(e);
      const sc = 0.6 + rnd() * 0.9;
      m4.compose(v.set(x, 0, z), q, s.set(sc, sc * (0.7 + rnd() * 0.6), sc));
      grass.setMatrixAt(n++, m4);
    }
    grass.count = n;
    grass.receiveShadow = true;
    this.root.add(grass);
    // corn patches (block line of sight) and corn boundary
    const cornPatches = this.map.veg.filter((p) => p.k === 'corn');
    const cornBoundary = this.realm.boundary === 'corn';
    if (cornPatches.length || cornBoundary) {
      const cg = new THREE.PlaneGeometry(0.9, 2.6);
      cg.translate(0, 1.3, 0);
      const cross = mergeGeometries([cg, cg.clone().rotateY(Math.PI / 2)]);
      const cm = new THREE.MeshStandardMaterial({ map: TX.cornTexture(), alphaTest: 0.4, side: THREE.DoubleSide, color: '#c8b88a' });
      const pts = [];
      for (const p of cornPatches) {
        for (let x = -p.w / 2 + 0.3; x < p.w / 2; x += 0.55) {
          for (let z = -p.d / 2 + 0.3; z < p.d / 2; z += 0.55) pts.push([p.x + x + (rnd() - 0.5) * 0.3, p.z + z + (rnd() - 0.5) * 0.3]);
        }
      }
      if (cornBoundary) {
        for (let i = 0; i < 5200; i++) {
          const side = Math.floor(rnd() * 4);
          const u = (rnd() * 2 - 1) * (MAP_HALF + 8);
          const d = MAP_HALF + 0.2 + rnd() * 8;
          const [x, z] = side === 0 ? [u, d] : side === 1 ? [u, -d] : side === 2 ? [d, u] : [-d, u];
          if (this.map.gates.some((g) => Math.hypot(g.x + g.nx * 4 - x, g.z + g.nz * 4 - z) < 6)) continue;
          pts.push([x, z]);
        }
      }
      const im = new THREE.InstancedMesh(cross, cm, pts.length);
      pts.forEach(([x, z], i) => {
        e.set((rnd() - 0.5) * 0.1, rnd() * 6.28, (rnd() - 0.5) * 0.1); q.setFromEuler(e);
        m4.compose(v.set(x, 0, z), q, s.set(1, 0.8 + rnd() * 0.45, 1));
        im.setMatrixAt(i, m4);
      });
      im.castShadow = true;
      this.root.add(im);
    }
  }

  buildBoundary() {
    const R = this.realm;
    const rnd = this.rnd;
    if (R.boundary === 'rockwall') {
      // big boulders along the wall
      const geos = [rockGeometry(71), rockGeometry(72)];
      const mtl = new THREE.MeshStandardMaterial({ map: TX.rockTexture(), roughness: 1, color: '#9a968c' });
      for (const w of this.map.walls) {
        if (w.k !== 'boundary_rockwall') continue;
        const len = Math.max(w.w, w.d);
        const alongX = w.w > w.d;
        for (let u = -len / 2; u < len / 2; u += 3 + rnd() * 2) {
          const m = new THREE.Mesh(geos[Math.floor(rnd() * 2)], mtl);
          const sc = 1.8 + rnd() * 1.6;
          m.scale.set(sc, sc * (0.9 + rnd() * 0.6), sc);
          m.position.set(w.x + (alongX ? u : (rnd() - 0.5) * 1.2), sc * 0.6, w.z + (alongX ? (rnd() - 0.5) * 1.2 : u));
          m.rotation.y = rnd() * 6;
          m.castShadow = true;
          m.receiveShadow = true;
          this.root.add(m);
        }
      }
    } else if (R.boundary === 'fence') {
      for (const w of this.map.walls) {
        if (w.k !== 'boundary_fence') continue;
        const len = Math.max(w.w, w.d);
        const alongX = w.w > w.d;
        for (let u = -len / 2 + 3; u < len / 2 - 3; u += 9 + rnd() * 8) {
          const car = createCar(['#5a3a2a', '#3a3a3a', '#4a4a3a'][Math.floor(rnd() * 3)]);
          const off = (w.x > 0 || w.z > 0 ? 1 : -1) * 2.2;
          car.position.set(w.x + (alongX ? u : off), 0, w.z + (alongX ? off : u));
          car.rotation.y = (alongX ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.4;
          this.root.add(car);
        }
      }
    }
  }

  // ----------------------------------------------------------- dynamic --
  updatePallet(i, state, dt) {
    const p = this.pallets[i];
    if (!p) return;
    if (state === 'b') { p.pivot.visible = false; p.state = 'b'; return; }
    p.pivot.visible = true;
    const target = state === 'u' ? 0 : 1;
    if (p.state !== state) p.state = state;
    const sp = state === 'f' || state === 'd' ? 5 : 3;
    p.f += Math.sign(target - p.f) * Math.min(Math.abs(target - p.f), dt * sp);
    const e = p.f * p.f;
    p.pivot.quaternion.slerpQuaternions(p.qStand, p.qDrop, e);
    p.pivot.position.y = p.f * 0.12;
  }

  updateGen(i, charges, done, blocked, regressing, n, dt) {
    const g = this.gens[i];
    if (!g) return;
    const prog = charges / 90;
    g.phase += dt * (n > 0 ? 14 : done ? 4 : 0);
    g.pistons.forEach((p, k) => { p.position.y = 1.35 + (n > 0 || done ? Math.sin(g.phase + k * 1.6) * 0.06 : 0); });
    g.bulbs.forEach((b, k) => { b.material.emissiveIntensity = prog > (k + 1) / 4 - 0.001 ? 2.2 : (prog > k / 4 ? 0.5 : 0); });
    g.lampMat.emissiveIntensity = done ? 4 : 0;
    g.light.i = done ? 5 : 0;
    g.light.color = '#ffd27a';
    g.regressing = regressing;
    g.blocked = blocked;
  }

  // assign pooled lights to the nearest active sources
  updateLights(cx, cz) {
    const act = this.lightSources.filter((s) => s.i > 0);
    act.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
    this.pool.forEach((l, i) => {
      const s = act[i];
      if (!s) { l.intensity = 0; return; }
      l.position.set(s.x, s.y, s.z);
      l.color.set(s.color);
      l.intensity = s.i * (s.flicker ? 0.8 + Math.random() * 0.3 : 1);
      l.distance = s.dist;
    });
  }

  updateShadowCenter(x, z) {
    const d = this.moonDir;
    this.moon.position.set(x + d.x * 60, d.y * 60, z + d.z * 60);
    this.moon.target.position.set(x, 0, z);
    this.moon.target.updateMatrixWorld();
  }

  syncTraps(traps) {
    const seen = new Set();
    for (const [id, x, z, st, rot] of traps || []) {
      seen.add(id);
      let o = this.traps.get(id);
      if (!o) {
        o = createBearTrap();
        o.group.rotation.y = rot;
        this.root.add(o.group);
        this.traps.set(id, o);
      }
      o.group.position.set(x, 0, z);
      const closed = st === 's' || st === 'g';
      o.jaws[0].rotation.x = closed ? -1.35 : 0;
      o.jaws[1].rotation.x = closed ? 1.35 : 0;
      o.group.visible = st !== 'c';
    }
    for (const [id, o] of this.traps) if (!seen.has(id)) { this.root.remove(o.group); this.traps.delete(id); }
  }

  syncHatchets(list, extrapolate) {
    const seen = new Set();
    for (const h of list || []) {
      const [id, x, y, z, vx, vy, vz] = h;
      seen.add(id);
      let o = this.hatchets.get(id);
      if (!o) {
        o = createHatchetProjectile();
        this.root.add(o);
        this.hatchets.set(id, o);
        o.userData.spin = 0;
      }
      const t = extrapolate || 0;
      o.position.set(x + vx * t, y + vy * t - 4.9 * t * t, z + vz * t);
      o.userData.spin += 0.5;
      o.rotation.set(o.userData.spin, Math.atan2(vx, vz), 0);
    }
    for (const [id, o] of this.hatchets) if (!seen.has(id)) { this.root.remove(o); this.hatchets.delete(id); }
  }

  update(dt, camPos) {
    this.t += dt;
    this.sky.position.copy(camPos);
    this.sky.userData.material.uniforms.time.value = this.t;
    // lockers: animate doors back closed
    for (const l of this.lockers) {
      l.openT = Math.max(0, l.openT - dt);
      const target = l.openT > 0 ? 1.4 : 0;
      l.open += (target - l.open) * Math.min(1, dt * 10);
      l.doorL.rotation.y = -l.open;
      l.doorR.rotation.y = l.open;
    }
  }

  // height of the roof above a point (or Infinity)
  ceilingAt(x, z) {
    for (const r of this.roofs || []) {
      if (Math.abs(x - r.x) < r.w / 2 && Math.abs(z - r.z) < r.d / 2) return r.mesh.position.y - 0.125;
    }
    return Infinity;
  }
}
