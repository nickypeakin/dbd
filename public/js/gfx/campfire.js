// The campfire scene used behind the title screen, main menu and lobby.

import * as THREE from 'three';
import { renderer, createSky } from './renderer.js';
import { groundTexture, barkTexture, rockTexture, glowTexture, grassTuftTexture } from './textures.js';
import { createCampfire, createLog, deadTreeGeometry, rockGeometry, mulberry } from './props.js';
import { createSurvivor, createKiller, survivorPose, killerPose, mat, disposeRig } from './models.js';
import { Particles } from './particles.js';
import { audio } from '../audio.js';

const SEATS = [
  { a: -2.25, r: 2.25, pose: 'sit' },
  { a: -2.75, r: 2.35, pose: 'stand' },
  { a: 2.75, r: 2.35, pose: 'sit' },
  { a: 2.25, r: 2.25, pose: 'stand' },
];

const VIEWS = {
  title: { pos: new THREE.Vector3(0.6, 2.3, 9.5), look: new THREE.Vector3(0, 1.0, -1.2) },
  menu: { pos: new THREE.Vector3(3.6, 1.7, 5.4), look: new THREE.Vector3(-0.8, 0.9, -1.4) },
  lobby: { pos: new THREE.Vector3(0, 1.75, 4.6), look: new THREE.Vector3(0, 0.95, -1.4) },
  killer: { pos: new THREE.Vector3(-2.6, 2.0, -2.2), look: new THREE.Vector3(-5.2, 1.6, -7.2) },
};

export class CampfireScene {
  constructor() {
    const s = (this.scene = new THREE.Scene());
    s.background = new THREE.Color('#05070a');
    s.fog = new THREE.FogExp2('#06080b', 0.055);
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 800);
    this.camera.position.copy(VIEWS.title.pos);
    this.camLook = VIEWS.title.look.clone();
    this.view = 'title';
    this.sky = createSky('#020306', '#141a24', '#c8d4ff');
    s.add(this.sky);

    s.add(new THREE.HemisphereLight('#4a5a7a', '#120c08', 0.35));
    const moon = new THREE.DirectionalLight('#8fa6d8', 0.55);
    moon.position.set(-8, 14, -6);
    s.add(moon);
    this.fireLight = new THREE.PointLight('#ff8a3a', 30, 18, 1.6);
    this.fireLight.position.set(0, 1.0, 0);
    this.fireLight.castShadow = true;
    this.fireLight.shadow.mapSize.set(512, 512);
    this.fireLight.shadow.bias = -0.002;
    s.add(this.fireLight);
    this.killerLight = new THREE.PointLight('#ff2010', 0, 7, 2);
    s.add(this.killerLight);

    // ground
    const gt = groundTexture('#2c2a20', '#1c1b15');
    gt.repeat.set(10, 10);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);

    const fire = createCampfire();
    s.add(fire);
    const ember = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff7a2a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    ember.scale.set(3.4, 2.6, 1);
    ember.position.set(0, 0.7, 0);
    s.add(ember);
    this.ember = ember;

    // logs to sit on
    for (const seat of SEATS) {
      if (seat.pose !== 'sit') continue;
      const log = createLog(1.6);
      const r = seat.r + 0.35;
      log.position.set(Math.sin(seat.a) * r, 0, Math.cos(seat.a) * r);
      log.rotation.y = seat.a + Math.PI / 2;
      log.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      s.add(log);
    }

    // forest
    const rnd = mulberry(77);
    const treeGeos = [deadTreeGeometry(11), deadTreeGeometry(23), deadTreeGeometry(37)];
    const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), color: '#8a7a6a', roughness: 1 });
    const counts = [0, 0, 0];
    const mats = [[], [], []];
    for (let i = 0; i < 120; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 7 + rnd() * 30;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (z > 3 && Math.abs(x) < 6) continue; // keep the view open
      const v = i % 3;
      const mm = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), new THREE.Vector3(1, 0.8 + rnd() * 0.5, 1));
      mats[v].push(mm);
      counts[v]++;
    }
    treeGeos.forEach((g, v) => {
      const im = new THREE.InstancedMesh(g, bark, counts[v]);
      mats[v].forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      s.add(im);
    });
    const rockGeo = rockGeometry(5);
    const rockMat = new THREE.MeshStandardMaterial({ map: rockTexture(), roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, r = 6 + rnd() * 14;
      const rk = new THREE.Mesh(rockGeo, rockMat);
      rk.position.set(Math.sin(a) * r, 0.2, Math.cos(a) * r);
      const sc = 0.5 + rnd() * 1.2;
      rk.scale.set(sc, sc * 0.8, sc);
      rk.rotation.y = rnd() * 6;
      rk.castShadow = true;
      if (rk.position.z > 3 && Math.abs(rk.position.x) < 4) continue;
      s.add(rk);
    }
    // grass tufts
    const grassGeo = new THREE.PlaneGeometry(0.6, 0.45);
    grassGeo.translate(0, 0.22, 0);
    const grassMat = new THREE.MeshStandardMaterial({ map: grassTuftTexture(), alphaTest: 0.4, side: THREE.DoubleSide, color: '#8a8c6a' });
    const grass = new THREE.InstancedMesh(grassGeo, grassMat, 500);
    const gm = new THREE.Matrix4();
    for (let i = 0; i < 500; i++) {
      const a = rnd() * Math.PI * 2, r = 1.6 + rnd() * 16;
      gm.compose(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), new THREE.Vector3(1, 0.7 + rnd() * 0.8, 1));
      grass.setMatrixAt(i, gm);
    }
    s.add(grass);

    // particles
    this.fireP = new Particles(260, { additive: true });
    this.smokeP = new Particles(90, { smoke: true });
    s.add(this.fireP.points, this.smokeP.points);
    this.emitAcc = 0;

    // characters
    this.slots = [null, null, null, null];
    this.killer = null;
    this.killerId = null;
    this.t = 0;
  }

  setView(v, instant) {
    this.view = v;
    if (instant) {
      this.camera.position.copy(VIEWS[v].pos);
      this.camLook.copy(VIEWS[v].look);
    }
  }

  // slots: array of 4 {character, ready, name, isBot} or null; killer: {character} or null
  setCharacters(slots, killer) {
    for (let i = 0; i < 4; i++) {
      const want = slots[i];
      const cur = this.slots[i];
      if (!want) {
        if (cur) { this.scene.remove(cur.rig.root); disposeRig(cur.rig); this.slots[i] = null; }
        continue;
      }
      if (!cur || cur.char !== want.character) {
        if (cur) { this.scene.remove(cur.rig.root); disposeRig(cur.rig); }
        const rig = createSurvivor(want.character);
        const seat = SEATS[i];
        rig.root.position.set(Math.sin(seat.a) * seat.r, 0, Math.cos(seat.a) * seat.r);
        rig.root.rotation.y = seat.a + Math.PI;
        this.scene.add(rig.root);
        this.slots[i] = { rig, char: want.character, info: want };
      }
      this.slots[i].info = want;
    }
    if (killer) {
      if (!this.killer || this.killerId !== killer.character) {
        if (this.killer) { this.scene.remove(this.killer.root); disposeRig(this.killer); }
        this.killer = createKiller(killer.character);
        this.killer.root.position.set(-5.4, 0, -7.6);
        this.killer.root.rotation.y = 0.55;
        this.scene.add(this.killer.root);
        this.killerId = killer.character;
      }
      this.killerInfo = killer;
    } else if (this.killer) {
      this.scene.remove(this.killer.root);
      disposeRig(this.killer);
      this.killer = null;
      this.killerId = null;
    }
  }

  // world positions above each character's head (for name tags)
  tagPositions() {
    const out = [];
    const v = new THREE.Vector3();
    const project = (rig, y) => {
      rig.j.head.getWorldPosition(v);
      v.y += y;
      v.project(this.camera);
      return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, vis: v.z < 1 };
    };
    for (let i = 0; i < 4; i++) out.push(this.slots[i] ? project(this.slots[i].rig, 0.45) : null);
    out.push(this.killer ? project(this.killer, 0.55 * this.killer.s) : null);
    return out;
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    // camera glide
    const V = VIEWS[this.view];
    const k = Math.min(1, dt * 1.6);
    const sway = new THREE.Vector3(Math.sin(t * 0.13) * 0.25, Math.sin(t * 0.21) * 0.08, 0);
    this.camera.position.lerp(V.pos.clone().add(sway), k);
    this.camLook.lerp(V.look, k);
    this.camera.lookAt(this.camLook);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.sky.position.copy(this.camera.position);
    this.sky.userData.material.uniforms.time.value = t;
    // fire flicker
    const fl = 0.8 + Math.sin(t * 13) * 0.07 + Math.sin(t * 7.3) * 0.08 + Math.random() * 0.06;
    this.fireLight.intensity = 26 * fl;
    this.fireLight.position.set(Math.sin(t * 5) * 0.05, 1.0 + Math.sin(t * 9) * 0.04, Math.cos(t * 4) * 0.05);
    this.ember.material.opacity = 0.45 + fl * 0.15;
    this.emitAcc += dt;
    while (this.emitAcc > 0.012) {
      this.emitAcc -= 0.012;
      const r = Math.random() * 0.25, a = Math.random() * 6.28;
      this.fireP.emit(Math.cos(a) * r, 0.25, Math.sin(a) * r, (Math.random() - 0.5) * 0.2, 0.9 + Math.random() * 0.9, (Math.random() - 0.5) * 0.2,
        0.5 + Math.random() * 0.4, 0.45 + Math.random() * 0.35, 1.0, 0.45 + Math.random() * 0.25, 0.12, 0.9, { grow: -0.6 });
      if (Math.random() < 0.08) this.fireP.emit(0, 0.5, 0, (Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6, 1.6, 0.05, 1, 0.6, 0.2, 1, {});
      if (Math.random() < 0.12) this.smokeP.emit((Math.random() - 0.5) * 0.3, 1.2, (Math.random() - 0.5) * 0.3, 0.1, 0.5, 0, 4, 1.2, 0.08, 0.08, 0.09, 0.35, { grow: 2.5 });
    }
    this.fireP.setScale(window.innerHeight);
    this.smokeP.setScale(window.innerHeight);
    this.fireP.update(dt);
    this.smokeP.update(dt);
    // characters
    for (let i = 0; i < 4; i++) {
      const s = this.slots[i];
      if (!s) continue;
      const pose = s.info.ready ? 'stand' : SEATS[i].pose;
      survivorPose(s.rig, { anim: pose, speed: 0 }, dt);
    }
    if (this.killer) {
      killerPose(this.killer, { anim: 'idle', speed: 0 }, dt);
      const hp = new THREE.Vector3();
      this.killer.j.head.getWorldPosition(hp);
      this.killerLight.position.copy(hp).add(new THREE.Vector3(0.6, -0.3, 0.9));
      this.killerLight.intensity = this.view === 'killer' ? 6 : 2.5 + Math.sin(t * 2) * 0.5;
    } else this.killerLight.intensity = 0;
  }

  render() {
    renderer.render(this.scene, this.camera);
  }
}

export function startCampfireAudio() {
  if (!audio.ready) return null;
  return {
    fire: audio.loop('fire', { vol: 0.35 }),
    pad: audio.loop('pad', { vol: 0.22, music: true, fade: 2 }),
    wind: audio.loop('wind', { vol: 0.15, fade: 2 }),
  };
}
