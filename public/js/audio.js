// Procedural audio: every sound is synthesized with the Web Audio API so the
// game ships without audio files. Includes positional one-shots, loops,
// the terror-radius heartbeat and a generative chase theme.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.loops = new Set();
    this.hb = { intensity: 0, next: 0 };
    this.chase = { level: 0, target: 0, next: 0, step: 0 };
    this.listener = { x: 0, y: 0, z: 0 };
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master = c.createGain();
    this.master.connect(this.comp);
    this.comp.connect(c.destination);
    this.musicBus = c.createGain();
    this.sfxBus = c.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    // shared noise buffer
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // reverb impulse
    this.reverb = c.createConvolver();
    const ir = c.createBuffer(2, c.sampleRate * 2.4, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.6);
    }
    this.reverb.buffer = ir;
    this.reverbGain = c.createGain();
    this.reverbGain.gain.value = 0.28;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);
    this.ready = true;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  setVolumes(master, music, sfx) {
    if (!this.ctx) return;
    this.master.gain.value = master;
    this.musicBus.gain.value = music;
    this.sfxBus.gain.value = sfx;
  }

  setListener(x, y, z, fx, fz) {
    if (!this.ctx) return;
    this.listener = { x, y, z };
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z;
      L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(x, y, z);
      L.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  // ------------------------------------------------------------ helpers --
  out(opts = {}) {
    // returns the node sounds should connect to (gain -> optional panner -> bus)
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = opts.vol ?? 1;
    let node = g;
    if (opts.pos) {
      const p = c.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = opts.ref ?? 3;
      p.maxDistance = 80;
      p.rolloffFactor = opts.rolloff ?? 1.3;
      if (p.positionX) { p.positionX.value = opts.pos.x; p.positionY.value = opts.pos.y ?? 1; p.positionZ.value = opts.pos.z; }
      else p.setPosition(opts.pos.x, opts.pos.y ?? 1, opts.pos.z);
      g.connect(p);
      node = p;
      g._panner = p;
    }
    node.connect(opts.music ? this.musicBus : this.sfxBus);
    if (opts.verb) {
      const s = c.createGain();
      s.gain.value = opts.verb;
      node.connect(s);
      s.connect(this.reverb);
    }
    return g;
  }

  noise(dur, dest, t0 = this.now) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.loopStart = Math.random();
    s.connect(dest);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.05);
    return s;
  }

  osc(type, freq, dur, dest, t0 = this.now) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  env(g, t0, a, peak, d, sustain = 0) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t0 + a + d);
  }

  filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // ----------------------------------------------------------- one-shots --
  play(name, opts = {}) {
    if (!this.ready) return;
    const fn = this['s_' + name];
    if (fn) {
      try { fn.call(this, opts); } catch (e) { /* ignore audio errors */ }
    }
  }

  s_hover() {
    const t = this.now, o = this.out({ vol: 0.06 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.003, 1, 0.05);
    this.osc('sine', 1800, 0.06, g, t);
  }

  s_click() {
    const t = this.now, o = this.out({ vol: 0.25 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.002, 1, 0.12);
    const f = this.filter('lowpass', 900); f.connect(g);
    this.osc('triangle', 140, 0.15, f, t).frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const g2 = this.ctx.createGain(); g2.connect(o);
    this.env(g2, t, 0.001, 0.4, 0.03);
    this.noise(0.04, g2, t);
  }

  s_boom(opts) {
    const t = this.now, o = this.out({ vol: opts.vol ?? 0.55, verb: 0.6 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.005, 1, 2.2);
    const f = this.filter('lowpass', 400); f.connect(g);
    const osc = this.osc('sawtooth', 70, 2.4, f, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 2);
    const g2 = this.ctx.createGain(); g2.connect(o);
    this.env(g2, t, 0.002, 0.6, 0.5);
    const f2 = this.filter('lowpass', 600); f2.connect(g2);
    this.noise(0.6, f2, t);
  }

  s_skillWarn() {
    const t = this.now, o = this.out({ vol: 0.32, verb: 0.2 });
    for (const [f, v] of [[1318, 1], [2637, 0.35], [3951, 0.12]]) {
      const g = this.ctx.createGain(); g.connect(o);
      this.env(g, t, 0.004, v, 0.9);
      this.osc('sine', f, 1, g, t);
    }
  }

  s_skillGood() {
    const t = this.now, o = this.out({ vol: 0.22 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.002, 1, 0.12);
    this.osc('square', 660, 0.14, this.lp(g, 2000), t);
  }

  s_skillGreat() {
    const t = this.now, o = this.out({ vol: 0.22, verb: 0.3 });
    [880, 1320].forEach((f, i) => {
      const g = this.ctx.createGain(); g.connect(o);
      this.env(g, t + i * 0.08, 0.003, 1, 0.35);
      this.osc('triangle', f, 0.45, g, t + i * 0.08);
    });
  }

  lp(dest, f) { const fl = this.filter('lowpass', f); fl.connect(dest); return fl; }

  s_genExplode(opts) {
    const t = this.now, o = this.out({ vol: 0.9, pos: opts.pos, ref: 6, verb: 0.3 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.003, 1, 0.9);
    const f = this.filter('lowpass', 3000); f.connect(g);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.8);
    this.noise(1, f, t);
    // sparks
    for (let i = 0; i < 14; i++) {
      const tt = t + Math.random() * 0.8;
      const g2 = this.ctx.createGain(); g2.connect(o);
      this.env(g2, tt, 0.001, 0.25, 0.03);
      this.noise(0.04, this.hp(g2, 5000), tt);
    }
    const g3 = this.ctx.createGain(); g3.connect(o);
    this.env(g3, t, 0.002, 0.8, 0.4);
    this.osc('sine', 90, 0.5, g3, t).frequency.exponentialRampToValueAtTime(40, t + 0.4);
  }

  hp(dest, f) { const fl = this.filter('highpass', f); fl.connect(dest); return fl; }

  s_genDone(opts) {
    const t = this.now, o = this.out({ vol: 0.7, pos: opts.pos, ref: 14, rolloff: 0.6, verb: 0.5 });
    // electric swell
    const g = this.ctx.createGain(); g.connect(o);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    const f = this.filter('lowpass', 300, 4); f.connect(g);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.3);
    f.frequency.exponentialRampToValueAtTime(400, t + 2.5);
    for (const fr of [55, 82.4, 110, 164.8]) this.osc('sawtooth', fr, 3, f, t);
    const g2 = this.ctx.createGain(); g2.connect(o);
    this.env(g2, t, 0.002, 1, 0.25);
    this.osc('sine', 120, 0.3, g2, t).frequency.exponentialRampToValueAtTime(45, t + 0.25);
  }

  s_heartbeat(opts) {
    const t = this.now, o = this.out({ vol: opts.vol ?? 0.6 });
    for (const [dt, v] of [[0, 1], [0.24, 0.7]]) {
      const g = this.ctx.createGain(); g.connect(o);
      this.env(g, t + dt, 0.006, v, 0.22);
      const osc = this.osc('sine', 72, 0.28, g, t + dt);
      osc.frequency.exponentialRampToValueAtTime(38, t + dt + 0.2);
      const g2 = this.ctx.createGain(); g2.connect(o);
      this.env(g2, t + dt, 0.002, v * 0.3, 0.04);
      this.noise(0.05, this.lp(g2, 300), t + dt);
    }
  }

  s_hit(opts) {
    const t = this.now, o = this.out({ vol: 0.9, pos: opts.pos, verb: 0.15 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.002, 1, 0.22);
    this.noise(0.25, this.lp(g, 700), t);
    const g2 = this.ctx.createGain(); g2.connect(o);
    this.env(g2, t, 0.002, 0.9, 0.18);
    this.osc('sine', 110, 0.2, g2, t).frequency.exponentialRampToValueAtTime(45, t + 0.15);
  }

  s_scream(opts) {
    const t = this.now, dur = opts.dur ?? 1.1;
    const o = this.out({ vol: opts.vol ?? 0.5, pos: opts.pos, ref: 8, rolloff: 0.8, verb: 0.35 });
    const base = (opts.pitch ?? 1) * (520 + Math.random() * 160);
    const g = this.ctx.createGain(); g.connect(o);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.05);
    g.gain.setValueAtTime(0.8, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f1 = this.filter('bandpass', 900, 3), f2 = this.filter('bandpass', 1500, 4), f3 = this.filter('bandpass', 2700, 5);
    for (const f of [f1, f2, f3]) f.connect(g);
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base * 0.8, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.25, t + 0.12);
    osc.frequency.exponentialRampToValueAtTime(base * 0.75, t + dur);
    const vib = this.ctx.createOscillator(); vib.frequency.value = 7 + Math.random() * 3;
    const vg = this.ctx.createGain(); vg.gain.value = base * 0.04;
    vib.connect(vg); vg.connect(osc.frequency);
    osc.connect(f1); osc.connect(f2); osc.connect(f3);
    osc.start(t); osc.stop(t + dur + 0.05); vib.start(t); vib.stop(t + dur + 0.05);
    const gn = this.ctx.createGain(); gn.connect(o);
    this.env(gn, t, 0.02, 0.25, dur);
    this.noise(dur, this.filter2('bandpass', 2500, 1, gn), t);
  }

  filter2(type, f, q, dest) { const fl = this.filter(type, f, q); fl.connect(dest); return fl; }

  s_grunt(opts) {
    this.s_scream({ ...opts, dur: 0.35, vol: (opts.vol ?? 0.25), pitch: 0.55 });
  }

  s_swing(opts) {
    const t = this.now, o = this.out({ vol: 0.45, pos: opts.pos });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.05, 1, 0.2);
    const f = this.filter('bandpass', 400, 2); f.connect(g);
    f.frequency.exponentialRampToValueAtTime(2500, t + 0.15);
    this.noise(0.3, f, t);
  }

  s_palletDrop(opts) {
    const t = this.now, o = this.out({ vol: 1.0, pos: opts.pos, ref: 6, verb: 0.3 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t + 0.25, 0.003, 1, 0.5);
    this.noise(0.6, this.lp(g, 900), t + 0.25);
    const g2 = this.ctx.createGain(); g2.connect(o);
    this.env(g2, t + 0.25, 0.002, 1, 0.3);
    this.osc('sine', 85, 0.35, g2, t + 0.25).frequency.exponentialRampToValueAtTime(40, t + 0.55);
    for (let i = 0; i < 6; i++) {
      const tt = t + 0.28 + Math.random() * 0.25;
      const g3 = this.ctx.createGain(); g3.connect(o);
      this.env(g3, tt, 0.001, 0.4, 0.05);
      this.noise(0.06, this.filter2('bandpass', 1200 + Math.random() * 800, 4, g3), tt);
    }
  }

  s_palletBreak(opts) {
    const t = this.now, o = this.out({ vol: 0.9, pos: opts.pos, ref: 6, verb: 0.3 });
    for (let i = 0; i < 10; i++) {
      const tt = t + Math.random() * 0.35;
      const g = this.ctx.createGain(); g.connect(o);
      this.env(g, tt, 0.001, 0.7, 0.08);
      this.noise(0.1, this.filter2('bandpass', 600 + Math.random() * 2400, 3, g), tt);
    }
    const g2 = this.ctx.createGain(); g2.connect(o);
    this.env(g2, t, 0.003, 0.8, 0.3);
    this.noise(0.35, this.lp(g2, 500), t);
  }

  s_stun(opts) {
    this.s_hit(opts);
    const t = this.now, o = this.out({ vol: 0.5, pos: opts.pos, verb: 0.3 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t + 0.05, 0.02, 0.7, 0.6);
    const f = this.filter('lowpass', 700); f.connect(g);
    const osc = this.osc('sawtooth', 110, 0.7, f, t + 0.05);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.6);
  }

  s_vault(opts) {
    const t = this.now, o = this.out({ vol: opts.fast ? 0.7 : 0.35, pos: opts.pos });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.04, 1, 0.25);
    this.noise(0.3, this.filter2('bandpass', 1000, 1.2, g), t);
    const g2 = this.ctx.createGain(); g2.connect(o);
    this.env(g2, t + (opts.fast ? 0.35 : 0.6), 0.002, 0.8, 0.15);
    this.noise(0.15, this.lp(g2, 400), t + (opts.fast ? 0.35 : 0.6));
  }

  metal(o, t, base, decay, vol) {
    for (const r of [1, 2.32, 4.25, 6.63, 9.38]) {
      const g = this.ctx.createGain(); g.connect(o);
      this.env(g, t, 0.002, vol / r, decay / Math.sqrt(r));
      this.osc('sine', base * r, decay, g, t);
    }
  }

  s_locker(opts) {
    const t = this.now, o = this.out({ vol: opts.rush ? 0.9 : 0.45, pos: opts.pos, verb: 0.2 });
    this.metal(o, t, 180, 0.6, 0.6);
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.002, 0.7, 0.12);
    this.noise(0.14, this.lp(g, 1500), t);
  }

  s_hook(opts) {
    const t = this.now, o = this.out({ vol: 0.8, pos: opts.pos, ref: 8, verb: 0.5 });
    this.metal(o, t, 140, 1.4, 0.9);
    this.s_entity({ pos: opts.pos, vol: 0.4 });
  }

  s_entity(opts) {
    const t = this.now, o = this.out({ vol: opts.vol ?? 0.5, pos: opts.pos, ref: 10, rolloff: 0.7, verb: 0.6 });
    const g = this.ctx.createGain(); g.connect(o);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    const f = this.filter('lowpass', 260, 6); f.connect(g);
    for (const fr of [41, 43.6, 61.7]) this.osc('sawtooth', fr, 3.6, f, t);
    const g2 = this.ctx.createGain(); g2.connect(o);
    this.env(g2, t + 0.3, 0.3, 0.25, 2.4);
    const f2 = this.filter('bandpass', 3000, 6); f2.connect(g2);
    f2.frequency.exponentialRampToValueAtTime(900, t + 2.5);
    this.noise(2.8, f2, t + 0.3);
  }

  s_gatesPowered() {
    const t = this.now, o = this.out({ vol: 0.42, verb: 0.6 });
    for (let i = 0; i < 4; i++) {
      const tt = t + i * 1.1;
      const g = this.ctx.createGain(); g.connect(o);
      this.env(g, tt, 0.15, 1, 0.9);
      const f = this.filter('bandpass', 900, 1.5); f.connect(g);
      const osc = this.osc('sawtooth', 420, 1.1, f, tt);
      osc.frequency.linearRampToValueAtTime(760, tt + 0.5);
      osc.frequency.linearRampToValueAtTime(420, tt + 1.0);
    }
  }

  s_gateOpen(opts) {
    const t = this.now, o = this.out({ vol: 0.8, pos: opts.pos, ref: 10, verb: 0.4 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.3, 1, 2.5);
    this.noise(2.8, this.lp(g, 350), t);
    this.metal(o, t + 2.4, 90, 1.2, 0.6);
  }

  s_hatch(opts) {
    const t = this.now, o = this.out({ vol: 0.6, pos: opts.pos, ref: 6, verb: 0.4 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.2, 1, 1.6);
    const f = this.filter('bandpass', 500, 2); f.connect(g);
    f.frequency.exponentialRampToValueAtTime(1600, t + 1.2);
    this.noise(1.8, f, t);
    this.metal(o, t, 220, 0.8, 0.4);
  }

  s_bell(opts) {
    const t = this.now, o = this.out({ vol: 0.75, pos: opts.pos, ref: 12, rolloff: 0.5, verb: 0.7 });
    const base = 196;
    for (const [r, v] of [[1, 1], [2.76, 0.6], [5.4, 0.4], [8.93, 0.25], [13.34, 0.15]]) {
      const g = this.ctx.createGain(); g.connect(o);
      this.env(g, t, 0.003, v * 0.5, 3.2 / Math.sqrt(r));
      this.osc('sine', base * r, 3.4, g, t);
    }
  }

  s_trapSnap(opts) {
    const t = this.now, o = this.out({ vol: 1.0, pos: opts.pos, ref: 6, verb: 0.3 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.001, 1, 0.06);
    this.noise(0.08, this.hp(g, 2000), t);
    this.metal(o, t, 520, 0.5, 0.6);
  }

  s_trapSet(opts) {
    const t = this.now, o = this.out({ vol: 0.5, pos: opts.pos });
    for (let i = 0; i < 3; i++) {
      const g = this.ctx.createGain(); g.connect(o);
      this.env(g, t + i * 0.12, 0.001, 0.6, 0.05);
      this.noise(0.06, this.hp(g, 3000), t + i * 0.12);
    }
  }

  s_throw(opts) {
    const t = this.now, o = this.out({ vol: 0.6, pos: opts.pos });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.02, 1, 0.4);
    const f = this.filter('bandpass', 1800, 3); f.connect(g);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.4);
    this.noise(0.45, f, t);
  }

  s_thunk(opts) {
    const t = this.now, o = this.out({ vol: 0.5, pos: opts.pos });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.001, 1, 0.12);
    this.noise(0.14, this.lp(g, 1200), t);
  }

  s_noisePing() {
    const t = this.now, o = this.out({ vol: 0.18 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.003, 1, 0.2);
    this.osc('triangle', 1040, 0.22, g, t);
  }

  s_score() {
    const t = this.now, o = this.out({ vol: 0.06 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.002, 1, 0.1);
    this.osc('sine', 1560, 0.12, g, t);
  }

  s_escape() {
    const t = this.now, o = this.out({ vol: 0.4, verb: 0.7, music: true });
    [261.6, 329.6, 392, 523.3].forEach((f, i) => {
      const g = this.ctx.createGain(); g.connect(o);
      this.env(g, t + i * 0.06, 0.4, 0.5, 3);
      this.osc('triangle', f, 3.6, g, t + i * 0.06);
    });
  }

  s_sacrifice(opts) {
    this.s_entity({ pos: opts.pos, vol: 0.9 });
    const t = this.now, o = this.out({ vol: 0.35, verb: 0.8, music: true });
    [55, 58.3, 82.4].forEach((f) => {
      const g = this.ctx.createGain(); g.connect(o);
      this.env(g, t, 0.8, 0.6, 4);
      this.osc('sawtooth', f, 4.8, this.lp(g, 500), t);
    });
  }

  s_egc() {
    this.s_entity({ vol: 0.9 });
    this.s_boom({ vol: 0.5 });
  }

  s_crow(opts) {
    const t = this.now, o = this.out({ vol: 0.25, pos: opts.pos, ref: 10, rolloff: 0.6, verb: 0.5 });
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      const tt = t + i * 0.32;
      const g = this.ctx.createGain(); g.connect(o);
      this.env(g, tt, 0.01, 0.8, 0.22);
      const f = this.filter('bandpass', 1400, 4); f.connect(g);
      const osc = this.osc('sawtooth', 620, 0.26, f, tt);
      osc.frequency.exponentialRampToValueAtTime(420, tt + 0.22);
      const am = this.ctx.createOscillator(); am.frequency.value = 55;
      const ag = this.ctx.createGain(); ag.gain.value = 0.5;
      am.connect(ag); ag.connect(g.gain);
      am.start(tt); am.stop(tt + 0.27);
    }
  }

  s_chainsawRev(opts) {
    const t = this.now, o = this.out({ vol: 0.55, pos: opts.pos, ref: 8 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.05, 1, 2.2, 0.3);
    const ws = this.distortion();
    ws.connect(this.lp(g, 2200));
    const osc = this.osc('sawtooth', 55, 2.3, ws, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 2);
  }

  s_chainsawBump(opts) {
    this.s_hit(opts);
    this.metal(this.out({ vol: 0.5, pos: opts.pos }), this.now, 300, 0.4, 0.5);
  }

  distortion() {
    const ws = this.ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; curve[i] = Math.tanh(x * 4); }
    ws.curve = curve;
    return ws;
  }

  s_bigUi() {
    const t = this.now, o = this.out({ vol: 0.35, verb: 0.5 });
    const g = this.ctx.createGain(); g.connect(o);
    this.env(g, t, 0.01, 1, 1.4);
    this.osc('sawtooth', 55, 1.5, this.lp(g, 300), t);
    this.osc('sawtooth', 82.4, 1.5, this.lp(g, 300), t);
  }

  // --------------------------------------------------------------- loops --
  loop(kind, opts = {}) {
    if (!this.ready) return null;
    const c = this.ctx;
    const out = this.out({ vol: 0, pos: opts.pos, ref: opts.ref ?? 4, music: opts.music, verb: opts.verb });
    const nodes = [];
    const start = (n) => { n.start(); nodes.push(n); return n; };
    if (kind === 'gen') {
      const f = this.filter('lowpass', 380, 2); f.connect(out);
      const o1 = start(c.createOscillator()); o1.type = 'sawtooth'; o1.frequency.value = 48; o1.connect(f);
      const o2 = start(c.createOscillator()); o2.type = 'square'; o2.frequency.value = 96.5; const g2 = c.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(f);
      const lfo = start(c.createOscillator()); lfo.frequency.value = 9; const lg = c.createGain(); lg.gain.value = 0.35; lfo.connect(lg); lg.connect(out.gain);
      const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true; const ng = c.createGain(); ng.gain.value = 0.25; n.connect(ng); ng.connect(this.filter2('bandpass', 2400, 2, out)); start(n);
    } else if (kind === 'wind') {
      const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const f = this.filter('bandpass', 500, 0.7); n.connect(f); f.connect(out); start(n);
      const lfo = start(c.createOscillator()); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 300; lfo.connect(lg); lg.connect(f.frequency);
    } else if (kind === 'fire') {
      const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const f = this.filter('lowpass', 500, 0.5); n.connect(f); f.connect(out); start(n);
      out._crackle = true;
    } else if (kind === 'pad') {
      const f = this.filter('lowpass', 420, 1.5); f.connect(out);
      for (const fr of [55, 55.4, 82.4, 110.3, 130.8]) {
        const o = start(c.createOscillator()); o.type = 'sawtooth'; o.frequency.value = fr; const g = c.createGain(); g.gain.value = 0.16; o.connect(g); g.connect(f);
      }
      const lfo = start(c.createOscillator()); lfo.frequency.value = 0.05; const lg = c.createGain(); lg.gain.value = 220; lfo.connect(lg); lg.connect(f.frequency);
    } else if (kind === 'chainsaw') {
      const ws = this.distortion(); ws.connect(this.lp(out, 2600));
      const o = start(c.createOscillator()); o.type = 'sawtooth'; o.frequency.value = 120; o.connect(ws);
      const lfo = start(c.createOscillator()); lfo.frequency.value = 23; const lg = c.createGain(); lg.gain.value = 18; lfo.connect(lg); lg.connect(o.frequency);
      out._osc = o;
    } else if (kind === 'hatchWind') {
      const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const f = this.filter('bandpass', 900, 3); n.connect(f); f.connect(out); start(n);
    } else if (kind === 'entity') {
      const f = this.filter('lowpass', 200, 4); f.connect(out);
      for (const fr of [36.7, 38.9, 55]) { const o = start(c.createOscillator()); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); }
    }
    const h = {
      kind, out, nodes, vol: 0,
      set: (v, ramp = 0.15) => {
        h.vol = v;
        out.gain.cancelScheduledValues(this.now);
        out.gain.setTargetAtTime(v, this.now, ramp);
      },
      pos: (x, y, z) => {
        const p = out._panner;
        if (!p) return;
        if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
      },
      stop: () => {
        out.gain.setTargetAtTime(0, this.now, 0.1);
        setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch {} } out.disconnect(); }, 600);
        this.loops.delete(h);
      },
    };
    h.set(opts.vol ?? 0.5, opts.fade ?? 0.5);
    this.loops.add(h);
    return h;
  }

  // ------------------------------------------------- heartbeat & chase --
  setHeartbeat(intensity) { this.hb.intensity = intensity; }
  setChase(on) { this.chase.target = on ? 1 : 0; }

  update(dt) {
    if (!this.ready) return;
    const t = this.now;
    // fire crackles
    for (const h of this.loops) {
      if (h.out._crackle && h.vol > 0.01 && Math.random() < dt * 14) {
        const g = this.ctx.createGain(); g.connect(h.out);
        this.env(g, t, 0.001, 0.8 + Math.random(), 0.02 + Math.random() * 0.04);
        this.noise(0.08, this.hp(g, 1500 + Math.random() * 3000), t);
      }
    }
    // heartbeat
    const hi = this.hb.intensity;
    if (hi > 0.02) {
      if (t >= this.hb.next) {
        this.s_heartbeat({ vol: 0.25 + hi * 0.75 });
        const interval = 1.25 - hi * 0.8;
        this.hb.next = t + interval;
      }
    } else this.hb.next = t + 0.3;
    // chase music
    const ch = this.chase;
    ch.level += (ch.target - ch.level) * Math.min(1, dt * (ch.target ? 1.5 : 0.5));
    if (ch.level > 0.03) {
      if (!this.chaseOut) {
        this.chaseOut = this.ctx.createGain();
        this.chaseOut.connect(this.musicBus);
        this.chaseDrone = this.loop('entity', { vol: 0, music: true });
        ch.next = t + 0.05;
        ch.step = 0;
      }
      this.chaseOut.gain.value = ch.level * 0.6;
      if (this.chaseDrone) this.chaseDrone.set(ch.level * 0.5, 0.3);
      const beat = 60 / 168 / 2;
      while (ch.next < t + 0.15) {
        this.chaseStep(ch.step, ch.next);
        ch.step = (ch.step + 1) % 32;
        ch.next += beat;
      }
    } else if (this.chaseOut) {
      this.chaseOut.disconnect();
      this.chaseOut = null;
      if (this.chaseDrone) { this.chaseDrone.stop(); this.chaseDrone = null; }
    }
  }

  chaseStep(step, t) {
    const o = this.chaseOut;
    const c = this.ctx;
    // pounding drum on beats
    if (step % 4 === 0 || step % 16 === 10) {
      const g = c.createGain(); g.connect(o);
      this.env(g, t, 0.003, 1, 0.25);
      this.osc('sine', 62, 0.3, g, t).frequency.exponentialRampToValueAtTime(34, t + 0.22);
      const g2 = c.createGain(); g2.connect(o);
      this.env(g2, t, 0.001, 0.35, 0.06);
      this.noise(0.08, this.lp(g2, 900), t);
    }
    // staccato low strings
    const notes = [73.4, 73.4, 77.8, 73.4, 87.3, 73.4, 77.8, 69.3];
    if (step % 2 === 0) {
      const f = notes[(step >> 1) % notes.length];
      const g = c.createGain(); g.connect(o);
      this.env(g, t, 0.01, 0.35, 0.16);
      const fl = this.filter('lowpass', 900, 2); fl.connect(g);
      this.osc('sawtooth', f, 0.2, fl, t);
      this.osc('sawtooth', f * 2.003, 0.2, fl, t);
    }
    // screeching high violin every bar
    if (step === 0 || step === 16) {
      const g = c.createGain(); g.connect(o);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      const fl = this.filter('bandpass', 2400, 3); fl.connect(g);
      const osc = this.osc('sawtooth', step === 0 ? 1174 : 1244, 2.7, fl, t);
      const vib = c.createOscillator(); vib.frequency.value = 6.5; const vg = c.createGain(); vg.gain.value = 14;
      vib.connect(vg); vg.connect(osc.frequency); vib.start(t); vib.stop(t + 2.7);
    }
  }

  stopAllLoops() {
    for (const h of [...this.loops]) h.stop();
    this.hb.intensity = 0;
    this.chase.target = 0;
  }
}

export const audio = new AudioEngine();
