// Procedurally generated canvas textures (no image assets needed).

import * as THREE from 'three';

const cache = new Map();

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// tileable value noise
function makeNoise(size, cells, seed) {
  const r = rng(seed);
  const g = [];
  for (let i = 0; i < cells * cells; i++) g.push(r());
  const at = (x, y) => g[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
  return (u, v) => {
    const x = u * cells, y = v * cells;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbm(size, seed, octaves = 4, base = 4) {
  const ns = [];
  for (let o = 0; o < octaves; o++) ns.push(makeNoise(size, base << o, seed + o * 31));
  return (u, v) => {
    let s = 0, a = 0.5, n = 0;
    for (const f of ns) { s += f(u, v) * a; n += a; a *= 0.5; }
    return s / n;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function finish(c, opts = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.needsUpdate = true;
  return t;
}

function pixelTexture(size, seed, fn, opts) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a ?? 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { c, ctx };
}

function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

export function groundTexture(c1, c2) {
  const key = 'ground' + c1 + c2;
  if (cache.has(key)) return cache.get(key);
  const n = fbm(512, 7, 5, 4), m = fbm(512, 99, 3, 8);
  const A = hexToRgb(c1), B = hexToRgb(c2), dirt = [72, 58, 42];
  const { c } = pixelTexture(512, 1, (u, v) => {
    const a = n(u, v), b = m(u, v);
    let col = mix(B, A, Math.min(1, a * 1.4));
    col = mix(col, dirt, Math.max(0, (b - 0.6) * 1.8));
    const speck = (Math.sin(u * 900 + v * 1300) * Math.sin(u * 1700 - v * 600)) * 10;
    return [col[0] + speck, col[1] + speck, col[2] + speck * 0.6];
  });
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function brickTexture(base = '#6b3a2c', mortar = '#3a3632') {
  const key = 'brick' + base;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(512, 512), ctx = c.getContext('2d');
  ctx.fillStyle = mortar; ctx.fillRect(0, 0, 512, 512);
  const r = rng(3), B = hexToRgb(base);
  const bh = 32, bw = 64;
  for (let row = 0; row < 512 / bh; row++) {
    for (let col = -1; col < 512 / bw + 1; col++) {
      const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
      const k = 0.75 + r() * 0.4;
      ctx.fillStyle = `rgb(${B[0] * k},${B[1] * k},${B[2] * k})`;
      ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    }
  }
  grime(ctx, 512, 11, 0.35);
  const t = finish(c);
  cache.set(key, t);
  return t;
}

function grime(ctx, size, seed, strength) {
  const n = fbm(size, seed, 4, 4);
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const g = 1 - n(x / size, y / size) * strength - (y / size) * 0.12;
      const s = (Math.random() - 0.5) * 18;
      img.data[i] = img.data[i] * g + s; img.data[i + 1] = img.data[i + 1] * g + s; img.data[i + 2] = img.data[i + 2] * g + s;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function woodTexture(base = '#5a4430', vertical = true) {
  const key = 'wood' + base + vertical;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(256, 256), ctx = c.getContext('2d');
  const B = hexToRgb(base), r = rng(5);
  const pw = 32;
  for (let i = 0; i < 256 / pw; i++) {
    const k = 0.7 + r() * 0.45;
    ctx.fillStyle = `rgb(${B[0] * k},${B[1] * k},${B[2] * k})`;
    if (vertical) ctx.fillRect(i * pw, 0, pw, 256); else ctx.fillRect(0, i * pw, 256, pw);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    if (vertical) ctx.fillRect(i * pw, 0, 2, 256); else ctx.fillRect(0, i * pw, 256, 2);
    for (let g = 0; g < 14; g++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
      ctx.beginPath();
      const o = i * pw + r() * pw;
      if (vertical) { ctx.moveTo(o, 0); ctx.bezierCurveTo(o + 3, 80, o - 3, 170, o + 2, 256); }
      else { ctx.moveTo(0, o); ctx.bezierCurveTo(80, o + 3, 170, o - 3, 256, o + 2); }
      ctx.stroke();
    }
  }
  grime(ctx, 256, 13, 0.3);
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function stoneTexture(base = '#6e6b64') {
  const key = 'stone' + base;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(512, 512), ctx = c.getContext('2d');
  const B = hexToRgb(base), r = rng(9);
  ctx.fillStyle = '#2b2a27'; ctx.fillRect(0, 0, 512, 512);
  let y = 0;
  while (y < 512) {
    const h = 40 + r() * 40;
    let x = -r() * 60;
    while (x < 512) {
      const w = 60 + r() * 90, k = 0.65 + r() * 0.45;
      ctx.fillStyle = `rgb(${B[0] * k},${B[1] * k},${B[2] * k})`;
      ctx.beginPath();
      const rr = 8;
      ctx.roundRect(x + 3, y + 3, w - 6, h - 6, rr);
      ctx.fill();
      x += w;
    }
    y += h;
  }
  grime(ctx, 512, 17, 0.45);
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function concreteTexture(base = '#77756f') {
  const key = 'concrete' + base;
  if (cache.has(key)) return cache.get(key);
  const n = fbm(256, 21, 5, 4), B = hexToRgb(base);
  const { c, ctx } = pixelTexture(256, 1, (u, v) => {
    const k = 0.75 + n(u, v) * 0.4;
    return [B[0] * k, B[1] * k, B[2] * k];
  });
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(Math.random() * 256, 0); ctx.lineTo(Math.random() * 256, 256); ctx.stroke(); }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function corrugatedTexture(base = '#6a5f55') {
  const key = 'corr' + base;
  if (cache.has(key)) return cache.get(key);
  const B = hexToRgb(base), n = fbm(256, 33, 4, 4), rust = [120, 62, 28];
  const { c } = pixelTexture(256, 1, (u, v) => {
    const ridge = 0.75 + Math.sin(u * Math.PI * 2 * 16) * 0.25;
    const rr = Math.max(0, n(u, v) - 0.45) * 2.2;
    const col = mix(B, rust, Math.min(1, rr));
    return [col[0] * ridge, col[1] * ridge, col[2] * ridge];
  });
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function rustMetalTexture(base = '#5d5a52') {
  const key = 'rust' + base;
  if (cache.has(key)) return cache.get(key);
  const B = hexToRgb(base), n = fbm(256, 41, 5, 4), rust = [128, 64, 30];
  const { c } = pixelTexture(256, 1, (u, v) => {
    const k = n(u, v);
    const col = mix(B, rust, Math.max(0, (k - 0.42) * 2.4));
    const s = (Math.random() - 0.5) * 14;
    return [col[0] + s, col[1] + s, col[2] + s];
  });
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function barkTexture() {
  if (cache.has('bark')) return cache.get('bark');
  const n = fbm(256, 51, 4, 4);
  const { c } = pixelTexture(256, 1, (u, v) => {
    const s = Math.sin(u * Math.PI * 2 * 10 + n(u, v) * 6) * 0.5 + 0.5;
    const k = 0.45 + s * 0.35 + n(u * 3 % 1, v) * 0.2;
    return [70 * k, 58 * k, 48 * k];
  });
  const t = finish(c);
  cache.set('bark', t);
  return t;
}

export function rockTexture() {
  if (cache.has('rock')) return cache.get('rock');
  const n = fbm(256, 61, 5, 4), m = fbm(256, 62, 3, 8);
  const { c } = pixelTexture(256, 1, (u, v) => {
    const k = 0.5 + n(u, v) * 0.6;
    const moss = Math.max(0, m(u, v) - 0.62) * 2;
    const col = mix([110 * k, 106 * k, 98 * k], [58, 70, 40], moss);
    return col;
  });
  const t = finish(c);
  cache.set('rock', t);
  return t;
}

export function roofTexture() {
  if (cache.has('roof')) return cache.get('roof');
  const c = canvas(256, 256), ctx = c.getContext('2d');
  ctx.fillStyle = '#2a2523'; ctx.fillRect(0, 0, 256, 256);
  const r = rng(71);
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 9; col++) {
      const k = 0.6 + r() * 0.5;
      ctx.fillStyle = `rgb(${62 * k},${50 * k},${44 * k})`;
      ctx.fillRect(col * 32 + (row % 2) * 16, row * 16, 30, 14);
    }
  }
  const t = finish(c);
  cache.set('roof', t);
  return t;
}

export function hayTexture() {
  if (cache.has('hay')) return cache.get('hay');
  const c = canvas(256, 256), ctx = c.getContext('2d');
  ctx.fillStyle = '#8a7334'; ctx.fillRect(0, 0, 256, 256);
  const r = rng(81);
  for (let i = 0; i < 1400; i++) {
    const k = 0.6 + r() * 0.7;
    ctx.strokeStyle = `rgba(${170 * k},${140 * k},${70 * k},0.7)`;
    ctx.beginPath();
    const x = r() * 256, y = r() * 256, a = (r() - 0.5) * 0.8;
    ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20); ctx.stroke();
  }
  const t = finish(c);
  cache.set('hay', t);
  return t;
}

// grass blades / corn leaves with alpha
export function grassTuftTexture() {
  if (cache.has('grass')) return cache.get('grass');
  const c = canvas(128, 128), ctx = c.getContext('2d');
  const r = rng(91);
  for (let i = 0; i < 26; i++) {
    const x = 20 + r() * 88, h = 50 + r() * 70, lean = (r() - 0.5) * 40;
    const k = 0.6 + r() * 0.6;
    ctx.strokeStyle = `rgb(${92 * k},${100 * k},${52 * k})`;
    ctx.lineWidth = 2 + r() * 2;
    ctx.beginPath(); ctx.moveTo(x, 128); ctx.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); ctx.stroke();
  }
  const t = finish(c, { clamp: true });
  cache.set('grass', t);
  return t;
}

export function cornTexture() {
  if (cache.has('corn')) return cache.get('corn');
  const c = canvas(128, 256), ctx = c.getContext('2d');
  const r = rng(95);
  for (let s = 0; s < 3; s++) {
    const x = 30 + s * 34 + r() * 10;
    ctx.strokeStyle = '#6b6232'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x, 256); ctx.lineTo(x + (r() - 0.5) * 8, 10); ctx.stroke();
    for (let l = 0; l < 9; l++) {
      const y = 230 - l * 24 - r() * 8, dir = l % 2 ? 1 : -1, len = 30 + r() * 30;
      const k = 0.6 + r() * 0.5;
      ctx.strokeStyle = `rgb(${130 * k},${120 * k},${60 * k})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + dir * len * 0.6, y - 20, x + dir * len, y + 14); ctx.stroke();
    }
  }
  const t = finish(c, { clamp: true });
  cache.set('corn', t);
  return t;
}

export function glowTexture() {
  if (cache.has('glow')) return cache.get('glow');
  const c = canvas(128, 128), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = finish(c, { clamp: true });
  cache.set('glow', t);
  return t;
}

export function smokeTexture() {
  if (cache.has('smoke')) return cache.get('smoke');
  const n = fbm(128, 101, 4, 3);
  const { c } = pixelTexture(128, 1, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const a = Math.max(0, 1 - d) * (0.5 + n(u, v) * 0.7);
    return [255, 255, 255, a * 255];
  });
  const t = finish(c, { clamp: true });
  cache.set('smoke', t);
  return t;
}

export function scratchTexture() {
  if (cache.has('scratch')) return cache.get('scratch');
  const c = canvas(128, 128), ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    ctx.lineWidth = 5 - i;
    ctx.beginPath();
    ctx.moveTo(20 + i * 24, 10 + i * 6);
    ctx.lineTo(40 + i * 22, 118 - i * 4);
    ctx.stroke();
  }
  const t = finish(c, { clamp: true });
  cache.set('scratch', t);
  return t;
}

export function bloodTexture() {
  if (cache.has('blood')) return cache.get('blood');
  const c = canvas(128, 128), ctx = c.getContext('2d');
  const r = rng(111);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.arc(64 + (r() - 0.5) * 60, 64 + (r() - 0.5) * 60, 4 + r() * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = finish(c, { clamp: true });
  cache.set('blood', t);
  return t;
}

export function moonTexture() {
  if (cache.has('moon')) return cache.get('moon');
  const n = fbm(256, 121, 5, 4);
  const { c } = pixelTexture(256, 1, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    if (d > 1) {
      const a = Math.max(0, 1 - (d - 1) * 3) * 0.0;
      return [255, 255, 255, a * 255];
    }
    const k = 0.75 + n(u, v) * 0.35;
    const edge = Math.min(1, (1 - d) * 8);
    return [235 * k, 238 * k, 245 * k, 255 * edge];
  });
  const t = finish(c, { clamp: true });
  cache.set('moon', t);
  return t;
}

export function noiseDataTexture() {
  if (cache.has('noisedata')) return cache.get('noisedata');
  const n = fbm(256, 131, 5, 4);
  const { c } = pixelTexture(256, 1, (u, v) => {
    const k = n(u, v) * 255;
    return [k, k, k];
  });
  const t = finish(c, { data: true });
  cache.set('noisedata', t);
  return t;
}

export function fabricTexture() {
  if (cache.has('fabric')) return cache.get('fabric');
  const n = fbm(128, 141, 3, 8);
  const { c } = pixelTexture(128, 1, (u, v, x, y) => {
    const w = ((x + y) % 4 < 2 ? 0.94 : 1.0) * (0.85 + n(u, v) * 0.3);
    const k = 255 * w;
    return [k, k, k];
  });
  const t = finish(c);
  cache.set('fabric', t);
  return t;
}

export function lockerTexture() {
  if (cache.has('locker')) return cache.get('locker');
  const c = canvas(128, 256), ctx = c.getContext('2d');
  ctx.fillStyle = '#4f5a50'; ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(62, 0, 4, 256);
  for (let i = 0; i < 6; i++) { ctx.fillRect(18, 20 + i * 8, 30, 3); ctx.fillRect(80, 20 + i * 8, 30, 3); }
  ctx.fillStyle = '#222'; ctx.fillRect(50, 120, 6, 24); ctx.fillRect(72, 120, 6, 24);
  grime(ctx, 128, 151, 0.55);
  const t = finish(c);
  cache.set('locker', t);
  return t;
}

// ------------------------------------------------------------ characters --
// Grayscale detail maps, tinted by each material's colour.

// Hair: fine strands running from the crown down (along v).
export function hairTexture() {
  if (cache.has('hair')) return cache.get('hair');
  const r = rng(173), n = fbm(128, 171, 3, 4);
  const strand = [];
  for (let i = 0; i < 128; i++) strand.push(0.62 + r() * 0.38);
  const { c } = pixelTexture(128, 1, (u, v, x) => {
    const s = (strand[x] * 2 + strand[(x + 1) % 128] + strand[(x + 127) % 128]) / 4;
    const k = 255 * Math.min(1, s * (0.86 + n(u, v) * 0.28));
    return [k, k, k];
  });
  const t = finish(c);
  cache.set('hair', t);
  return t;
}

// Denim twill with a worn, faded look.
export function denimTexture() {
  if (cache.has('denim')) return cache.get('denim');
  const n = fbm(128, 181, 3, 8);
  const { c } = pixelTexture(128, 1, (u, v, x, y) => {
    const twill = (x + y) % 4 < 2 ? 0.88 : 1.0;
    const fade = 0.82 + n(u, v) * 0.36;
    const fleck = (x * 7 + y * 13) % 23 === 0 ? 1.15 : 1;
    const k = Math.min(255, 255 * twill * fade * fleck);
    return [k, k, k];
  });
  const t = finish(c);
  cache.set('denim', t);
  return t;
}

// Skin: very soft blotches so faces don't look like plastic.
export function skinTexture() {
  if (cache.has('skin')) return cache.get('skin');
  const n = fbm(128, 191, 4, 4);
  const { c } = pixelTexture(128, 1, (u, v) => {
    const k = 0.93 + n(u, v) * 0.07;
    return [255 * k, 250 * k, 248 * k];
  });
  const t = finish(c);
  cache.set('skin', t);
  return t;
}

// Leather: creases and scuffs.
export function leatherTexture() {
  if (cache.has('leather')) return cache.get('leather');
  const n = fbm(128, 201, 4, 4), m = fbm(128, 202, 3, 8);
  const { c } = pixelTexture(128, 1, (u, v) => {
    const crease = 1 - Math.max(0, 0.06 - Math.abs(m(u, v) - 0.5)) * 6;
    const k = 255 * (0.72 + n(u, v) * 0.32) * crease;
    return [k, k, k];
  });
  const t = finish(c);
  cache.set('leather', t);
  return t;
}

// Fur: dense streaks with dark roots.
export function furTexture() {
  if (cache.has('fur')) return cache.get('fur');
  const r = rng(211), n = fbm(128, 212, 3, 4);
  const strand = [];
  for (let i = 0; i < 128; i++) strand.push(r());
  const { c } = pixelTexture(128, 1, (u, v, x, y) => {
    const s = strand[(x + Math.floor(n(u, v) * 9)) % 128];
    const tip = ((y + Math.floor(s * 128)) % 32) / 32;
    const k = 255 * (0.45 + s * 0.35 + tip * 0.25) * (0.8 + n(u, v) * 0.3);
    return [Math.min(255, k), Math.min(255, k), Math.min(255, k)];
  });
  const t = finish(c);
  cache.set('fur', t);
  return t;
}

// Knitted wool (beanies, scarves): vertical rows of stitches.
export function knitTexture(rx = 1, ry = 1) {
  const key = `knit${rx}_${ry}`;
  if (cache.has(key)) return cache.get(key);
  if (!cache.has('knitCanvas')) {
    const n = fbm(64, 221, 2, 4);
    const { c } = pixelTexture(64, 1, (u, v, x, y) => {
      const sx = (x % 8) / 8, sy = ((y + (x % 16 < 8 ? 0 : 4)) % 8) / 8;
      const st = Math.max(0, 1 - Math.abs(sx - 0.5 + (sy - 0.5) * 0.6) * 3);
      const k = 255 * (0.66 + st * 0.34) * (0.9 + n(u, v) * 0.15);
      return [k, k, k];
    });
    cache.set('knitCanvas', c);
  }
  const t = finish(cache.get('knitCanvas'), { repeat: [rx, ry] });
  cache.set(key, t);
  return t;
}

// Loud patterned shirt: flowers and leaves on a base colour.
export function floralTexture(base = '#8e2b2b', a = '#e8d6a0', b = '#2f5a3a') {
  const key = 'floral' + base + a + b;
  if (cache.has(key)) return cache.get(key);
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  const r = rng(231);
  const wrap = (fn, x, y) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(x + dx, y + dy); };
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S, rot = r() * Math.PI;
    wrap((px, py) => {
      ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
      ctx.fillStyle = b;
      ctx.beginPath(); ctx.ellipse(0, 0, 22, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }, x, y);
  }
  for (let i = 0; i < 18; i++) {
    const x = r() * S, y = r() * S, size = 9 + r() * 7;
    wrap((px, py) => {
      ctx.fillStyle = a;
      for (let p = 0; p < 5; p++) {
        const ang = (p / 5) * Math.PI * 2;
        ctx.beginPath(); ctx.ellipse(px + Math.cos(ang) * size * 0.7, py + Math.sin(ang) * size * 0.7, size * 0.55, size * 0.35, ang, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.arc(px, py, size * 0.28, 0, Math.PI * 2); ctx.fill();
    }, x, y);
  }
  grime(ctx, S, 233, 0.2);
  const t = finish(c);
  cache.set(key, t);
  return t;
}

// Dried blood splatter over a grayscale base (aprons, masks, weapons).
export function bloodyTexture(seed = 241) {
  const key = 'bloody' + seed;
  if (cache.has(key)) return cache.get(key);
  const n = fbm(128, seed, 4, 4), m = fbm(128, seed + 1, 3, 8);
  const { c } = pixelTexture(128, 1, (u, v) => {
    const base = 0.78 + m(u, v) * 0.22;
    const b = Math.max(0, Math.min(1, (n(u, v) - 0.52) * 5));
    return [255 * base * (1 - b * 0.35), 255 * base * (1 - b * 0.85), 255 * base * (1 - b * 0.85)];
  });
  const t = finish(c);
  cache.set(key, t);
  return t;
}
