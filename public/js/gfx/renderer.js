// Shared WebGL renderer, resizing, sky dome and quality settings.

import * as THREE from 'three';
import { profile } from '../store.js';
import { moonTexture, glowTexture } from './textures.js';

export let renderer;

export function initRenderer() {
  const canvas = document.getElementById('gl');
  // multisampling costs a lot on high-DPI screens, where edges are already fine
  const antialias = (window.devicePixelRatio || 1) < 1.5;
  renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  applyQuality();
  window.addEventListener('resize', () => applyQuality());
  return renderer;
}

// ------------------------------------------------------------ frame rate --
// The game renders at most 60 frames a second. On "Auto" quality the render
// resolution drops when frames take too long and creeps back up when there is
// headroom, so the frame rate holds at 60 instead of the picture getting
// sharper and slower.
const TARGET_FPS = 60;
export const perf = { fps: 0, ms: 0, scale: 1 };

const dynamic = { scale: 1, frames: 0, time: 0, durations: [], good: 0, cooldown: 0, ceiling: Infinity, ceilingT: 0 };

function maxRatio() {
  const q = profile.settings.quality;
  const dpr = window.devicePixelRatio || 1;
  return q === 'low' ? 0.75 : q === 'medium' ? 1 : q === 'high' ? Math.min(dpr, 1.75) : Math.min(dpr, 1.5);
}

export function applyQuality() {
  const q = profile.settings.quality;
  const top = maxRatio();
  if (q !== 'auto') dynamic.scale = top;
  dynamic.scale = Math.min(dynamic.scale, top);
  renderer.setPixelRatio(dynamic.scale);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = !!profile.settings.shadows && q !== 'low';
  perf.scale = dynamic.scale;
}

// Frame limiter: call once per animation frame with its timestamp; returns
// true when a frame should be drawn now.
let nextFrame = 0;
export function frameDue(now) {
  const step = 1000 / TARGET_FPS;
  if (now < nextFrame - 1.5) return false;
  nextFrame = Math.max(nextFrame + step, now - step);
  return true;
}

// Called after every drawn frame with its duration in seconds. `adapt` is
// false while loading, when long frames say nothing about the GPU.
export function trackFrame(dt, adapt = true) {
  const d = dynamic;
  d.frames++;
  d.time += dt;
  d.durations.push(dt);
  if (d.time < 0.5) return;
  perf.fps = d.frames / d.time;
  perf.ms = (d.time / d.frames) * 1000;
  // judge by the median frame so a single hitch (a match loading, a shader
  // compiling) doesn't lower the resolution
  d.durations.sort((a, b) => a - b);
  const typical = 1 / d.durations[d.durations.length >> 1];
  d.frames = 0;
  d.time = 0;
  d.durations.length = 0;
  if (profile.settings.quality !== 'auto' || document.hidden || !adapt) return;
  d.cooldown = Math.max(0, d.cooldown - 0.5);
  d.ceilingT = Math.max(0, d.ceilingT - 0.5);
  if (d.ceilingT === 0) d.ceiling = Infinity;
  const top = Math.min(maxRatio(), d.ceiling);
  let next = d.scale;
  if (typical < TARGET_FPS - 5 && d.scale > 0.6) {
    // GPU time grows with pixel count, so scale by the square root
    next = Math.max(0.6, d.scale * Math.min(0.92, Math.sqrt(typical / (TARGET_FPS - 2))));
    // if raising the resolution just caused this, don't try it again soon
    if (d.good < 0) { d.ceiling = d.scale * 0.97; d.ceilingT = 30; }
    d.good = 0;
    d.cooldown = 1.5;
  } else if (typical >= TARGET_FPS - 1.5) {
    d.good = Math.max(0, d.good) + 1;
    if (d.good >= 6 && d.cooldown === 0 && d.scale < top) {
      next = Math.min(top, d.scale * 1.08);
      d.good = -1;
      d.cooldown = 1;
    }
  }
  if (Math.abs(next - d.scale) > 0.01) {
    d.scale = next;
    renderer.setPixelRatio(next);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    perf.scale = next;
  }
}

// Gradient sky with stars, clouds and a moon.
export function createSky(top, horizon, moonColor) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) }, time: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform float time; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.55));
        float st = step(0.9965, hash(floor(vDir*420.0))) * smoothstep(0.05, 0.4, h);
        col += vec3(st) * 0.7;
        vec3 q = vDir*3.0 + vec3(time*0.004, 0.0, time*0.002);
        float c = noise(q)*0.55 + noise(q*2.1)*0.3 + noise(q*4.3)*0.15;
        c = smoothstep(0.45, 0.85, c) * smoothstep(0.0, 0.35, h);
        col = mix(col, horizon*0.55, c*0.75);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, m);
  sky.renderOrder = -10;
  g.add(sky);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), color: moonColor, fog: false, depthWrite: false, transparent: true }));
  moon.scale.set(38, 38, 1);
  moon.position.set(-120, 150, -260);
  g.add(moon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: moonColor, fog: false, depthWrite: false, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
  halo.scale.set(150, 150, 1);
  halo.position.copy(moon.position);
  g.add(halo);
  g.userData.material = m;
  g.userData.moonDir = moon.position.clone().normalize();
  return g;
}
