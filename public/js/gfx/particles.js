// Lightweight CPU-simulated point particles (fire, sparks, smoke, blood).

import * as THREE from 'three';
import { glowTexture, smokeTexture } from './textures.js';
import { renderer } from './renderer.js';

const VERT = `
attribute float size;
attribute vec4 pcolor;
varying vec4 vColor;
uniform float scale;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
}`;

export class Particles {
  constructor(max = 600, opts = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.base = new Float32Array(max * 5); // r g b a size
    this.grav = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.n = 0;
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, max);
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: opts.smoke ? smokeTexture() : glowTexture() }, scale: { value: 600 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    for (let i = 0; i < max; i++) this.life[i] = 0;
  }

  // h is the viewport height in CSS pixels; point sizes are in drawing-buffer
  // pixels, which change with the render resolution
  setScale(h) { this.material.uniforms.scale.value = h * 0.9 * renderer.getPixelRatio(); }

  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a = 1, o = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.age[i] = 0;
    this.base[i * 5] = r; this.base[i * 5 + 1] = g; this.base[i * 5 + 2] = b; this.base[i * 5 + 3] = a; this.base[i * 5 + 4] = size;
    this.grav[i] = o.grav ?? 0;
    this.grow[i] = o.grow ?? 0;
    this.drag[i] = o.drag ?? 0;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) { this.life[i] = 0; this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] = 0; this.vel[i * 3] *= 0.5; this.vel[i * 3 + 2] *= 0.5; }
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.col[i * 4] = this.base[i * 5];
      this.col[i * 4 + 1] = this.base[i * 5 + 1];
      this.col[i * 4 + 2] = this.base[i * 5 + 2];
      this.col[i * 4 + 3] = this.base[i * 5 + 3] * fade;
      this.size[i] = this.base[i * 5 + 4] * (1 + this.grow[i] * t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }
}
