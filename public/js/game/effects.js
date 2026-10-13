// Ground decals (scratch marks, blood) and aura rendering.

import * as THREE from 'three';

export class Decals {
  constructor(scene, texture, max, color, additive) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
      map: texture, color, transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -2,
    }), max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.items = [];
    this.cursor = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    for (let i = 0; i < max; i++) { this.items.push({ life: 0, age: 0 }); this.hide(i); }
    scene.add(this.mesh);
  }

  hide(i) {
    this.m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, this.m);
  }

  add(x, z, rot, size, life) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    Object.assign(this.items[i], { x, z, rot, size, life, age: 0 });
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i];
      if (it.life <= 0) continue;
      it.age += dt;
      if (it.age >= it.life) { it.life = 0; this.hide(i); continue; }
      const k = 1 - it.age / it.life;
      const sc = it.size * (0.35 + 0.65 * Math.min(1, k * 1.6));
      this.e.set(0, it.rot, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(it.x, 0.03, it.z), this.q, this.s.set(sc, 1, sc));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(scene) { scene.remove(this.mesh); }
}

// Aura layers: 1 = red, 2 = yellow, 3 = white
export const AURA = { RED: 1, YELLOW: 2, WHITE: 3 };

function auraMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color; uniform float time; varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = 0.18 + pow(rim, 2.2) * 0.95;
        a *= 0.85 + 0.15 * sin(time * 3.0);
        gl_FragColor = vec4(color * (0.6 + rim), a);
      }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

export class AuraRenderer {
  constructor() {
    this.mats = { 1: auraMaterial('#ff2a1a'), 2: auraMaterial('#ffd84a'), 3: auraMaterial('#e8eeff') };
    this.active = { 1: false, 2: false, 3: false };
  }

  render(renderer, scene, camera, t) {
    const prevAuto = renderer.autoClear;
    const prevMask = camera.layers.mask;
    const prevBg = scene.background;
    const prevFog = scene.fog;
    renderer.autoClear = false;
    scene.background = null;
    scene.fog = null;
    for (const L of [1, 2, 3]) {
      if (!this.active[L]) continue;
      this.mats[L].uniforms.time.value = t;
      camera.layers.set(L);
      scene.overrideMaterial = this.mats[L];
      renderer.render(scene, camera);
    }
    scene.overrideMaterial = null;
    scene.background = prevBg;
    scene.fog = prevFog;
    camera.layers.mask = prevMask;
    renderer.autoClear = prevAuto;
  }
}
