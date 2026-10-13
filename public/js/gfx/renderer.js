// Shared WebGL renderer, resizing, sky dome and quality settings.

import * as THREE from 'three';
import { profile } from '../store.js';
import { moonTexture, glowTexture } from './textures.js';

export let renderer;

export function initRenderer() {
  const canvas = document.getElementById('gl');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  applyQuality();
  window.addEventListener('resize', () => applyQuality());
  return renderer;
}

export function applyQuality() {
  const q = profile.settings.quality;
  const pr = q === 'low' ? 0.75 : q === 'medium' ? 1 : Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = !!profile.settings.shadows && q !== 'low';
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
