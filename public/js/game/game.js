// In-match client: renders the world, predicts the local player's movement,
// interpolates everyone else, handles controls, killer powers, auras,
// scratch marks, sounds and the HUD.

import * as THREE from 'three';
import { renderer } from '../gfx/renderer.js';
import { World, setLayerDeep } from '../gfx/world.js';
import { createSurvivor, createKiller, survivorPose, killerPose, createWeapon, createChainsaw, createHatchet, createBell, createKillerArm } from '../gfx/models.js';
import { Particles } from '../gfx/particles.js';
import { scratchTexture, bloodTexture, glowTexture } from '../gfx/textures.js';
import { HUD } from '../ui/hud.js';
import { Input } from './input.js';
import { Decals, AuraRenderer, AURA } from './effects.js';
import { audio } from '../audio.js';
import { profile } from '../store.js';
import { buildCollision } from '../../shared/collision.js';
import { survivorOptions, killerOptions, vaultPath, vaultType, attackCandidate, angDiff, relTo } from '../../shared/interact.js';
import { stepMove, playerBlockers, turnToward } from '../../shared/motor.js';
import { KILL, SURV, TIMES, HOOK } from '../../shared/constants.js';
import { KILLERS } from '../../shared/data.js';

const INTERP_DELAY = 0.1;
const SEND_RATE = 1 / 30;
const PALLET_STATE = { u: 'up', f: 'falling', d: 'down', b: 'broken' };
const TRAP_STATE = { a: 'armed', s: 'snapped', g: 'ground' };

function lerpAngle(a, b, t) { return a + angDiff(a, b) * t; }

export class Game {
  constructor(app, info) {
    this.app = app;
    this.info = info;
    this.map = info.map;
    this.net = app.net;
    this.myId = info.you;
    this.myInfo = info.players.find((p) => p.id === this.myId) || info.players[0];
    this.role = this.myInfo.role;
    this.started = false;
    this.snaps = [];
    this.latest = null;
    this.offset = null;
    this.time = 0;
    this.sendAcc = 0;
    this.self = { x: 0, z: 0, rot: 0, seq: -1, spd: 0, lastX: 0, lastZ: 0 };
    this.yaw = 0;
    this.pitch = 0.15;
    this.localLock = null;
    this.pendingLock = null;
    this.holding = null;
    this.local = {
      atk: { s: null, t: 0, hit: false },
      saw: { s: null, t: 0 },
      wind: null,
      windPower: () => (this.local.wind ? Math.min(1, Math.max(0, (performance.now() / 1000 - this.local.wind - 0.25) / 1.0)) : 0),
    };
    this.reveals = new Map();
    this.spectating = false;
    this.spectateTarget = null;
    this.paused = false;
    this.camShake = 0;
    this.gruntT = new Map();
    this.scratchAcc = new Map();
    this.loops = {};
    this.genLoops = new Map();
    this.prevPallets = '';
  }

  // ------------------------------------------------------------- setup --
  async build() {
    const scene = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 900);
    scene.add(this.camera);
    this.world = new World(this.map, scene);
    this.world.build();
    await new Promise((r) => setTimeout(r, 0));
    this.col = buildCollision(this.map);
    this.initState();
    // characters
    this.players = new Map();
    for (const p of this.info.players) {
      const rig = p.role === 'killer' ? createKiller(p.char) : createSurvivor(p.char);
      scene.add(rig.root);
      const entry = { info: p, rig, x: 0, z: 0, rot: 0, last: null, cloak: 0 };
      if (p.role === 'killer') {
        // own materials so the Wraith can fade
        rig.root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; } });
        if (this.role !== 'killer') {
          const stain = new THREE.SpotLight('#ff1a0a', 7, 11, 0.42, 0.7, 1.4);
          stain.position.set(0, 0.05, 0.12);
          const tgt = new THREE.Object3D();
          tgt.position.set(0, -1.6, 3.2);
          rig.j.head.add(stain, tgt);
          stain.target = tgt;
          entry.stain = stain;
        }
        this.killerEntry = entry;
      }
      this.players.set(p.id, entry);
    }
    // own killer is first person
    if (this.role === 'killer') {
      this.players.get(this.myId).rig.root.visible = false;
      this.buildViewmodel();
    }
    const spawn = this.role === 'killer' ? this.map.spawns.killer : this.map.spawns.survivors[this.info.players.filter((p) => p.role === 'survivor').findIndex((p) => p.id === this.myId)] || this.map.spawns.survivors[0];
    this.self.x = spawn.x;
    this.self.z = spawn.z;
    this.self.rot = spawn.rot || 0;
    this.yaw = this.self.rot;
    // effects
    this.particles = new Particles(500, { additive: true });
    this.smoke = new Particles(200, { smoke: true });
    this.dark = new Particles(300, { smoke: true });
    scene.add(this.particles.points, this.smoke.points, this.dark.points);
    if (this.role === 'killer') {
      this.scratches = new Decals(scene, scratchTexture(), 260, '#ff6a3a', true);
      this.blood = new Decals(scene, bloodTexture(), 160, '#7a0606', false);
    }
    this.aura = new AuraRenderer();
    // flashlight pool
    this.flash = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.SpotLight('#fff6e0', 0, 16, 0.32, 0.45, 1.2);
      const t = new THREE.Object3D();
      scene.add(l, t);
      l.target = t;
      this.flash.push({ light: l, target: t });
    }
    // HUD and input
    this.hud = new HUD(this);
    this.hud.mount();
    this.input = new Input(renderer.domElement);
    // warm up shaders
    renderer.compile(scene, this.camera);
    this.updateCamera(0);
    renderer.render(scene, this.camera);
  }

  buildViewmodel() {
    const vm = (this.vm = new THREE.Group());
    const char = this.myInfo.char;
    const k = KILLERS[char];
    const arm = createKillerArm(char);
    const weapon = createWeapon(char, 1.0);
    weapon.rotation.set(1.75, 0.15, 0);
    weapon.position.set(0, 0.02, -0.12);
    arm.add(weapon);
    arm.position.set(0.3, -0.27, -0.48);
    vm.add(arm);
    this.vmArm = arm;
    if (char === 'hillbilly') {
      const saw = createChainsaw(1.0);
      saw.position.set(-0.22, -0.42, -0.5);
      saw.rotation.set(0, 0.1, 0);
      vm.add(saw);
      this.vmSaw = saw;
    }
    if (char === 'huntress') {
      const hat = createHatchet(1.0);
      hat.position.set(-0.3, -0.35, -0.4);
      hat.visible = false;
      vm.add(hat);
      this.vmHatchet = hat;
    }
    if (char === 'wraith') {
      const bell = createBell(1.0);
      bell.position.set(-0.3, -0.3, -0.5);
      vm.add(bell);
      this.vmBell = bell;
    }
    vm.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 10; } });
    this.camera.add(vm);
    this.vmCarry = new THREE.Group();
    this.vmCarry.position.set(-0.55, -0.85, 0.1);
    this.camera.add(this.vmCarry);
    void k;
  }

  initState() {
    const M = this.map;
    this.S = {
      players: [],
      gens: M.gens.map((g) => ({ ...g, progress: 0, charges: 0, done: false, blocked: false, regressing: false, n: 0 })),
      pallets: M.pallets.map((p) => ({ ...p, state: 'up' })),
      windows: M.windows.map((w) => ({ ...w, blocked: false })),
      hooks: M.hooks.map((h) => ({ ...h, occupant: null })),
      lockers: M.lockers.map((l) => ({ ...l })),
      chests: M.chests.map((c) => ({ ...c, opened: false })),
      totems: M.totems.map((t) => ({ ...t, state: 'dull' })),
      gates: M.gates.map((g) => ({ ...g, progress: 0, open: false })),
      hatch: { x: M.hatch.x, z: M.hatch.z, state: 'closed' },
      traps: [],
      gatesPowered: false,
      egc: null,
      gensDone: 0,
    };
  }

  go() {
    this.started = true;
    this.app.onGameStarted();
    this.loops.wind = audio.loop('wind', { vol: 0.12, fade: 2 });
    this.hud.big('THE TRIAL BEGINS', `${this.world.realm.name} — ${this.map.name}`, 4200);
    audio.play('bigUi');
    this.input.requestLock();
  }

  resume() {
    this.paused = false;
    this.hud.showPause(false);
    this.input.requestLock();
  }

  dispose() {
    this.input.dispose();
    this.hud.dispose();
    for (const l of Object.values(this.loops)) l && l.stop();
    for (const l of this.genLoops.values()) l.stop();
    audio.setHeartbeat(0);
    audio.setChase(false);
    this.scene.traverse((o) => { if (o.geometry && !o.isInstancedMesh) o.geometry.dispose?.(); });
    renderer.renderLists.dispose();
  }

  // ----------------------------------------------------------- network --
  act(m) { this.net.send({ t: 'act', ...m }); }
  sendSkill(id, r) { this.act({ a: 'sc', id, r }); }

  onSnapshot(s) {
    const now = performance.now() / 1000;
    const off = s.tm - now;
    if (this.offset == null || Math.abs(off - this.offset) > 1) this.offset = off;
    else this.offset += (off - this.offset) * 0.05;
    const map = new Map();
    for (const p of s.p) map.set(p.i, p);
    this.snaps.push({ tm: s.tm, players: map });
    if (this.snaps.length > 40) this.snaps.shift();
    this.latest = s;
    this.meSnap = map.get(this.myId) || this.meSnap;
    this.applyState(s);
    if (s.e) for (const e of s.e) this.onEvent(e);
  }

  snapPlayer(id) { return this.latest ? this.snaps[this.snaps.length - 1].players.get(id) : null; }

  applyState(s) {
    const S = this.S;
    s.g.forEach((g, i) => {
      const o = S.gens[i];
      o.charges = g[0]; o.progress = g[0] / 90; o.done = !!g[1]; o.blocked = !!g[2]; o.regressing = !!g[3]; o.n = g[4];
    });
    for (let i = 0; i < S.pallets.length; i++) {
      const st = PALLET_STATE[s.pl[i]] || 'up';
      const p = S.pallets[i];
      if (st !== p.state) {
        if (st === 'down') this.col.setPalletDown(p, true);
        else if (p.state === 'down') this.col.setPalletDown(p, false);
        p.state = st;
      }
    }
    const wb = new Set(s.wb || []);
    S.windows.forEach((w) => { w.blocked = wb.has(w.id); });
    s.gt.forEach((g, i) => {
      const o = S.gates[i];
      o.progress = g[0];
      if (!!g[1] !== o.open) { o.open = !!g[1]; this.col.setGateOpen(o, o.open); }
    });
    S.gatesPowered = !!s.gp;
    S.hatch.state = s.hc === 'o' ? 'open' : s.hc === 's' ? 'shut' : 'closed';
    for (let i = 0; i < S.totems.length; i++) S.totems[i].state = { d: 'dull', h: 'hex', n: 'noed', c: 'cleansed' }[s.tt[i]] || 'dull';
    for (let i = 0; i < S.chests.length; i++) S.chests[i].opened = s.cs[i] === '1';
    S.traps = (s.tr || []).map(([id, x, z, st]) => ({ id, x, z, state: TRAP_STATE[st] || 'ground' }));
    S.egc = s.egc ?? null;
    S.gensDone = s.gd;
    // players in the shape the interaction rules expect
    S.players = s.p.map((p) => {
      const inf = this.players.get(p.i)?.info || {};
      return {
        id: p.i, role: inf.role, char: inf.char, perks: inf.perks || [], x: p.x, z: p.z, rot: p.r,
        health: inf.role === 'killer' ? 'healthy' : p.h, lk: p.lk || null, locker: p.lc ?? null, trap: p.tp ?? null,
        carriedBy: p.cb ?? null, carrying: p.cy ?? null, hookId: p.hk ?? null, hookCount: p.hc || 0, unhookTries: p.ut || 0,
        healP: p.hp || 0, ammo: p.am, item: p.it ? { type: p.it.t, charges: p.it.c * 10 } : null, exh: p.ex || 0,
        fx: { dh: (p.fx || '').includes('D') ? 1 : 0 }, usedUnbreakable: !!p.ub, crouch: !!p.cr, sprint: !!p.sr, chase: !!p.ch,
      };
    });
    for (const h of S.hooks) h.occupant = null;
    for (const p of S.players) if (p.health === 'hooked' && p.hookId != null && S.hooks[p.hookId]) S.hooks[p.hookId].occupant = p.id;
  }

  // ------------------------------------------------------------- events --
  pos3(x, z, y = 1.2) { return { x, y, z }; }
  nameOf(id) { const p = this.players.get(id); return p ? p.info.name : '?'; }

  onEvent(e) {
    const P = (id) => this.players.get(id);
    const posOf = (id) => { const p = P(id); return p ? this.pos3(p.x, p.z) : null; };
    const me = this.myId;
    switch (e.k) {
      case 'msg': this.hud.note(e.text, e.sub); break;
      case 'sc': this.hud.startSkill(e); break;
      case 'scCancel': this.hud.cancelSkill(e.id); break;
      case 'score': this.hud.scorePop(e.label, e.pts); break;
      case 'aura': for (const id of e.ids) this.reveals.set(id, this.time + e.dur); break;
      case 'noise': if (this.role === 'killer') { this.hud.ping(e.x, 1.2, e.z); audio.play('noisePing'); } break;
      case 'swing': if (e.id !== me) audio.play('swing', { pos: posOf(e.id) }); break;
      case 'hit': {
        const pos = this.pos3(e.x, e.z);
        audio.play('hit', { pos });
        audio.play('scream', { pos, vol: 0.55, pitch: this.screamPitch(e.id) });
        for (let i = 0; i < 18; i++) this.smoke.emit(e.x, 1.1, e.z, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.6, 0.25, 0.5, 0.02, 0.02, 0.9, { grav: 6, grow: 0.5 });
        if (e.id === me) { this.hud.flash('hit'); this.camShake = 0.35; }
        if (this.blood) for (let i = 0; i < 4; i++) this.blood.add(e.x + (Math.random() - 0.5), e.z + (Math.random() - 0.5), Math.random() * 6, 0.5 + Math.random() * 0.4, 14);
        break;
      }
      case 'down': if (e.id === me) this.hud.big('YOU ARE DYING', 'Crawl away or wait for help', 3000); break;
      case 'pickup': audio.play('grunt', { pos: posOf(e.id), vol: 0.5 }); break;
      case 'hooked': {
        const h = this.S.hooks[e.hook];
        const pos = h ? this.pos3(h.x, h.z, 2) : null;
        audio.play('hook', { pos });
        audio.play('scream', { pos, vol: 0.7, dur: 1.6, pitch: this.screamPitch(e.id) });
        if (e.id === me) this.hud.big('HOOKED', e.count >= 2 ? 'Struggle! Hit the skill checks' : 'Wait for a teammate to unhook you', 3500);
        else if (this.role === 'survivor') this.hud.note(`${this.nameOf(e.id)} has been hooked`, null, true);
        break;
      }
      case 'unhook': audio.play('grunt', { pos: posOf(e.id) }); if (e.id === me) this.hud.note('Unhooked — run!'); break;
      case 'unhookFail': audio.play('grunt', { pos: posOf(e.id), vol: 0.4 }); break;
      case 'struggle': audio.play('entity', { pos: posOf(e.id) }); if (e.id === me) this.hud.big('STRUGGLE', 'Hit the skill checks with SPACE', 2500); break;
      case 'dead': {
        const p = P(e.id);
        if (e.how === 'sacrificed') {
          audio.play('sacrifice', { pos: posOf(e.id) });
          if (p) for (let i = 0; i < 60; i++) this.dark.emit(p.x + (Math.random() - 0.5) * 1.5, Math.random() * 3, p.z + (Math.random() - 0.5) * 1.5, 0, 1 + Math.random() * 2, 0, 2.5, 1.2, 0.02, 0.0, 0.0, 0.8, { grow: 1 });
        } else audio.play('entity', { pos: posOf(e.id) });
        if (e.id === me) this.hud.big(e.how === 'sacrificed' ? 'SACRIFICED' : 'KILLED', 'The Entity has claimed you', 4000);
        else this.hud.note(`${this.nameOf(e.id)} ${e.how === 'sacrificed' ? 'was sacrificed' : 'was killed'}`, null, true);
        break;
      }
      case 'escape':
        if (e.id === me) { this.hud.big('YOU ESCAPED', e.via === 'hatch' ? 'Through the hatch' : 'Through the exit gate', 4000); audio.play('escape'); }
        else this.hud.note(`${this.nameOf(e.id)} escaped`);
        break;
      case 'genDone': {
        const g = this.S.gens[e.id];
        audio.play('genDone', { pos: this.pos3(g.x, g.z, 1.5) });
        for (let i = 0; i < 40; i++) this.particles.emit(g.x, 2.3, g.z, (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3, 0.8, 0.12, 1, 0.8, 0.4, 1, { grav: 5 });
        if (e.left > 0) this.hud.note(`${e.left} generator${e.left > 1 ? 's' : ''} left`);
        break;
      }
      case 'genExplode': {
        const g = this.S.gens[e.id];
        audio.play('genExplode', { pos: this.pos3(g.x, g.z, 1) });
        for (let i = 0; i < 60; i++) this.particles.emit(g.x, 1.2, g.z, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0.6 + Math.random() * 0.4, 0.1, 1, 0.75, 0.3, 1, { grav: 9 });
        for (let i = 0; i < 12; i++) this.smoke.emit(g.x, 1.4, g.z, (Math.random() - 0.5), 1 + Math.random(), (Math.random() - 0.5), 2, 1.2, 0.15, 0.15, 0.15, 0.6, { grow: 2 });
        break;
      }
      case 'genKick': { const g = this.S.gens[e.id]; audio.play('thunk', { pos: this.pos3(g.x, g.z, 1) }); audio.play('genExplode', { pos: this.pos3(g.x, g.z, 1) }); break; }
      case 'gatesPowered':
        audio.play('gatesPowered');
        this.hud.big('THE EXIT GATES ARE POWERED', this.role === 'killer' ? 'Stop them from escaping' : 'Open a gate and escape', 4000);
        break;
      case 'gateOpen': { const g = this.S.gates[e.id]; audio.play('gateOpen', { pos: this.pos3(g.x, g.z, 2) }); this.hud.note('An exit gate is open'); break; }
      case 'egc': audio.play('egc'); this.hud.big('ENDGAME COLLAPSE', 'The Entity\'s grasp tightens', 3500); break;
      case 'hatchOpen': audio.play('hatch', { pos: this.pos3(this.S.hatch.x, this.S.hatch.z, 0.5) }); if (this.role === 'survivor') this.hud.note('The hatch has opened'); break;
      case 'hatchShut': audio.play('locker', { pos: this.pos3(this.S.hatch.x, this.S.hatch.z, 0.5), rush: true }); this.hud.note('The hatch was closed', null, true); break;
      case 'palletDrop': { const p = this.S.pallets[e.id]; audio.play('palletDrop', { pos: this.pos3(p.x, p.z, 0.5) }); break; }
      case 'palletBreak': {
        const p = this.S.pallets[e.id];
        audio.play('palletBreak', { pos: this.pos3(p.x, p.z, 0.5) });
        for (let i = 0; i < 26; i++) this.smoke.emit(p.x + (Math.random() - 0.5) * 1.6, 0.4, p.z + (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 1.2, 0.5, 0.35, 0.28, 0.2, 0.7, { grav: 3, grow: 1 });
        break;
      }
      case 'stun': audio.play('stun', { pos: this.pos3(e.x, e.z) }); if (e.id === me) this.camShake = 0.6; break;
      case 'vault': audio.play('vault', { pos: posOf(e.id), fast: e.fast }); break;
      case 'entityBlock': if (this.role === 'survivor') this.hud.note('The Entity blocks this window'); break;
      case 'locker': { const l = this.world.lockers[e.id]; if (l) { l.openT = 0.5; audio.play('locker', { pos: this.pos3(l.data.x, l.data.z), rush: e.rush }); } break; }
      case 'grab': audio.play('scream', { pos: posOf(e.id), vol: 0.6, pitch: this.screamPitch(e.id) }); break;
      case 'bell': audio.play('bell', { pos: this.pos3(e.x, e.z, 2) }); break;
      case 'saw':
        if (e.s === 'rev') audio.play('chainsawRev', { pos: posOf(e.id) });
        if (e.s === 'bump') { audio.play('chainsawBump', { pos: this.pos3(e.x, e.z) }); if (e.id === me) this.camShake = 0.7; }
        break;
      case 'throw': audio.play('throw', { pos: this.pos3(e.x, e.z, 1.8) }); break;
      case 'hatchetLand': audio.play('thunk', { pos: this.pos3(e.x, e.z, 1) }); break;
      case 'trapSnap': audio.play('trapSnap', { pos: this.pos3(e.x, e.z, 0.2) }); audio.play('scream', { pos: this.pos3(e.x, e.z), vol: 0.6, pitch: this.screamPitch(e.id) }); if (e.id === me) this.hud.big('CAUGHT IN A TRAP', 'Hold M1 to try to escape', 2500); break;
      case 'trapSet': audio.play('trapSet', { pos: this.pos3(e.x, e.z, 0.3) }); break;
      case 'trapFree': case 'trapDisarm': audio.play('trapSet', { pos: posOf(e.id) }); break;
      case 'blind':
        if (e.id === me) { this.hud.flash('blind', TIMES.BLIND); audio.play('scream', { vol: 0.25, pitch: 0.4, dur: 0.6 }); }
        break;
      case 'freed': this.hud.note(`${this.nameOf(e.id)} broke free`); break;
      case 'wiggleFree': audio.play('grunt', { pos: posOf(e.id) }); if (e.id === me) this.hud.note('You wiggled free!'); break;
      case 'ds': audio.play('hit', { pos: posOf(e.id) }); this.hud.note('Decisive Strike!'); break;
      case 'deadhard': audio.play('swing', { pos: posOf(e.id) }); break;
      case 'dodge': this.hud.note('Dodged!'); break;
      case 'endurance': audio.play('grunt', { pos: posOf(e.id) }); break;
      case 'totem':
        if (e.hex) this.hud.note(e.hex === 'ruin' ? 'Hex: Ruin has been cleansed' : 'Hex: No One Escapes Death has been cleansed');
        audio.play('entity', { vol: 0.25 });
        break;
      case 'chest': if (e.by === me) this.hud.note(`Found: ${({ medkit: 'First Aid Kit', toolbox: 'Toolbox', flashlight: 'Flashlight' })[e.item]}`); break;
      case 'healed': if (e.id === me) this.hud.note(e.h === 'healthy' ? 'You are healthy' : 'You were picked up'); break;
      case 'healMiss': audio.play('grunt', { pos: posOf(e.id) }); break;
      case 'drop': break;
    }
  }

  screamPitch(id) {
    const p = this.players.get(id);
    const c = p ? p.info.char : 'dwight';
    return ['meg', 'claudette', 'nea', 'feng'].includes(c) ? 1.25 : 0.85;
  }

  // ------------------------------------------------------- interpolation --
  renderTime() {
    if (this.offset == null) return 0;
    return performance.now() / 1000 + this.offset - INTERP_DELAY;
  }

  interp(id) {
    const snaps = this.snaps;
    if (!snaps.length) return null;
    const rt = this.renderTime();
    let a = null, b = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].tm <= rt) { a = snaps[i]; b = snaps[i + 1] || snaps[i]; break; }
    }
    if (!a) { a = b = snaps[0]; }
    const pa = a.players.get(id), pb = b.players.get(id);
    if (!pa || !pb) return pb || pa || null;
    const span = b.tm - a.tm;
    const f = span > 0 ? Math.min(1, Math.max(0, (rt - a.tm) / span)) : 1;
    return { ...pb, x: pa.x + (pb.x - pa.x) * f, z: pa.z + (pb.z - pa.z) * f, r: lerpAngle(pa.r, pb.r, f), lt: pa.lt != null && pb.lt != null ? pa.lt + (pb.lt - pa.lt) * f : pb.lt };
  }

  // --------------------------------------------------------------- frame --
  frame(dt) {
    this.time += dt;
    if (!this.latest) { renderer.render(this.scene, this.camera); return; }
    this.handleInput(dt);
    this.updateSelf(dt);
    this.updateKillerLocal(dt);
    this.updatePlayers(dt);
    this.updateWorld(dt);
    this.updateCamera(dt);
    this.updateAudio(dt);
    this.updateAuras();
    this.hud.update(dt);
    this.hud.endMarks();
    if (this.app.noRender && !window.__renderOnce) return;
    window.__renderOnce = false;
    renderer.render(this.scene, this.camera);
    this.aura.render(renderer, this.scene, this.camera, this.time);
  }

  // my current state in the "interaction" shape, with predicted position
  meState() {
    const p = this.S.players.find((q) => q.id === this.myId);
    if (!p) return null;
    return { ...p, x: this.self.x, z: this.self.z, rot: this.self.rot, lk: this.localLock ? this.localLock.kind : p.lk };
  }

  handleInput(dt) {
    const inp = this.input;
    const [mx, my] = inp.takeMouse();
    const sens = 0.0022 * profile.settings.sensitivity;
    const inLocker = this.meSnap && this.meSnap.lc != null;
    if (!this.paused) {
      this.yaw -= mx * sens;
      this.pitch += my * sens * (profile.settings.invertY ? -1 : 1);
      const maxP = this.role === 'killer' ? 1.35 : 1.0;
      this.pitch = Math.max(this.role === 'killer' ? -1.35 : -0.5, Math.min(maxP, this.pitch));
      if (inLocker) {
        const l = this.S.lockers[this.meSnap.lc];
        if (l) {
          const d = angDiff(l.rot, this.yaw);
          if (Math.abs(d) > 0.6) this.yaw = l.rot + Math.sign(d) * 0.6;
        }
      }
    }
    const me = this.meState();
    const sp = this.meSnap;
    const isK = this.role === 'killer';
    this.currentOptions = !me || this.spectating ? {} : isK ? killerOptions(me, this.S, this.yaw) : survivorOptions(me, this.S, this.yaw);
    for (const ev of inp.takeEvents()) {
      if (ev.type === 'unlock') {
        if (this.started && !this.paused && !this.app.resultsEl) { this.paused = true; this.hud.showPause(true); }
        continue;
      }
      if (ev.type === 'lock') { this.paused = false; this.hud.showPause(false); continue; }
      if (ev.code === 'Tab') { this.hud.showBoard(ev.type === 'down'); continue; }
      if (this.paused || !this.started || !sp) continue;
      if (this.spectating) {
        if (ev.type === 'down' && (ev.code === 'Mouse0' || ev.code === 'Space')) this.cycleSpectate();
        continue;
      }
      if (ev.type === 'down') this.onPress(ev.code, me, sp);
      else this.onRelease(ev.code, me, sp);
    }
  }

  onPress(code, me, sp) {
    const isK = this.role === 'killer';
    const o = this.currentOptions;
    // skill checks take space first
    if (code === 'Space' && this.hud.skillPress()) return;
    if (!isK && sp.h === 'carried') {
      if (code === 'KeyA') this.act({ a: 'wig', d: -1 });
      if (code === 'KeyD') this.act({ a: 'wig', d: 1 });
      return;
    }
    if (code === 'Space') {
      const sopt = o.space;
      if (!sopt) return;
      if (isK) {
        if (sopt.kind === 'kvault') {
          const w = this.S.windows[sopt.id];
          const path = vaultPath(this.self, w, true);
          const dur = TIMES.KILLER_VAULT * (this.myInfo.perks.includes('bamboozle') ? 0.85 : 1);
          this.localLock = { kind: 'kvault', t: 0, dur, from: path.from, to: path.to };
        } else this.pendingLock = { until: this.time + 0.5 };
        this.act({ a: 'space', kind: sopt.kind, id: sopt.id });
        this.local.saw.s = null;
        this.local.wind = null;
        return;
      }
      if (sopt.kind === 'vault' || sopt.kind === 'vaultp') {
        const obj = sopt.kind === 'vault' ? this.S.windows[sopt.id] : this.S.pallets[sopt.id];
        const path = vaultPath(this.self, obj, false);
        const sprinting = this.input.keys.has('ShiftLeft') || this.input.keys.has('ShiftRight');
        const vt = vaultType(this.self, obj, this.self.spd, sprinting, this.self.rot);
        let dur = vt === 'fast' ? TIMES.VAULT_FAST : vt === 'med' ? TIMES.VAULT_MED : TIMES.VAULT_SLOW;
        if (this.myInfo.perks.includes('resilience') && sp.h === 'injured') dur *= 0.91;
        this.localLock = { kind: 'vault', t: 0, dur, from: path.from, to: path.to, vt };
        this.self.rot = Math.atan2(path.to.x - path.from.x, path.to.z - path.from.z);
        this.act({ a: 'space', kind: sopt.kind, id: sopt.id, vt });
      } else if (sopt.kind === 'drop') {
        this.localLock = { kind: 'drop', t: 0, dur: TIMES.PALLET_DROP };
        this.act({ a: 'space', kind: 'drop', id: sopt.id });
      } else {
        this.pendingLock = { until: this.time + 0.5 };
        this.act({ a: 'space', kind: sopt.kind, id: sopt.id });
      }
      this.holding = null;
      return;
    }
    if (code === 'Mouse0') {
      if (isK) { this.startLunge(sp); return; }
      if (o.m1) {
        this.act({ a: 'm1', kind: o.m1.kind, id: o.m1.id });
        if (o.m1.kind === 'unhook') this.pendingLock = { until: this.time + 0.5 };
        else this.holding = { key: 'm1', kind: o.m1.kind, since: this.time };
      }
      return;
    }
    if (code === 'Mouse2') {
      if (isK) { this.powerDown(sp); return; }
      if (o.m2) {
        this.act({ a: 'm2', kind: o.m2.kind });
        if (o.m2.kind === 'medkit') this.holding = { key: 'm2', kind: 'medkit', since: this.time };
        if (o.m2.kind === 'flashlight') this.flashHeld = true;
      }
      return;
    }
    if (code === 'KeyE') {
      if (isK) { if (sp.cy != null) this.act({ a: 'e', kind: 'dropsurv' }); return; }
      if (o.e) {
        this.act({ a: 'e', kind: o.e.kind });
        if (o.e.kind === 'selfcare') this.holding = { key: 'e', kind: 'selfcare', since: this.time };
      }
    }
  }

  onRelease(code, me, sp) {
    const isK = this.role === 'killer';
    if (code === 'Mouse0') {
      if (isK) { this.m1Released = true; return; }
      this.act({ a: 'm1up' });
      if (this.holding && this.holding.key === 'm1') this.holding = null;
    } else if (code === 'Mouse2') {
      if (isK) { this.powerUp(sp); return; }
      this.act({ a: 'm2up' });
      this.flashHeld = false;
      if (this.holding && this.holding.key === 'm2') this.holding = null;
    } else if (code === 'KeyE' && !isK) {
      this.act({ a: 'eup' });
      if (this.holding && this.holding.key === 'e') this.holding = null;
    }
  }

  // ---------------------------------------------------- killer specifics --
  canAttack(sp) {
    const L = this.local;
    if (L.atk.s || sp.cy != null || sp.lk || this.localLock) return false;
    if (sp.pw && sp.pw !== 'unc_boost') return false;
    if (L.saw.s || L.wind) return false;
    return true;
  }

  startLunge(sp) {
    if (!this.canAttack(sp)) return;
    this.local.atk = { s: 'lunge', t: 0, hit: false };
    this.m1Released = false;
    this.act({ a: 'm1' });
    audio.play('swing');
  }

  powerDown(sp) {
    const c = this.myInfo.char;
    if (sp.lk || this.localLock || sp.cy != null || this.local.atk.s) return;
    if (c === 'hillbilly') {
      if (this.local.saw.s) return;
      this.local.saw = { s: 'rev', t: 0 };
      this.act({ a: 'saw', s: 'rev' });
      this.loops.saw = audio.loop('chainsaw', { vol: 0.25 });
    } else if (c === 'huntress') {
      if ((sp.am ?? 0) <= 0) { this.hud.note('Out of hatchets — reload at a locker'); return; }
      this.local.wind = performance.now() / 1000;
      this.act({ a: 'm2' });
    } else {
      this.act({ a: 'm2' });
    }
  }

  powerUp(sp) {
    const c = this.myInfo.char;
    if (c === 'hillbilly') {
      const s = this.local.saw;
      if (s.s === 'rev') { this.act({ a: 'saw', s: 'cancel' }); this.endSaw(); }
      else if (s.s === 'go') { this.act({ a: 'saw', s: 'end' }); this.endSaw(); }
    } else if (c === 'huntress') {
      if (!this.local.wind) { this.act({ a: 'm2up' }); return; }
      const power = this.local.windPower();
      const tWind = performance.now() / 1000 - this.local.wind;
      this.local.wind = null;
      this.act({ a: 'm2up', yaw: this.yaw, pitch: -this.pitch + 0.05, power });
      if (tWind >= 0.25 && (sp.am ?? 0) > 0) audio.play('throw');
    } else {
      this.act({ a: 'm2up' });
    }
  }

  endSaw() {
    this.local.saw = { s: null, t: 0 };
    if (this.loops.saw) { this.loops.saw.stop(); this.loops.saw = null; }
  }

  // positions of other players as currently rendered (used for client-side hit detection)
  renderedPlayers() {
    const out = [];
    for (const [id, e] of this.players) {
      if (id === this.myId) continue;
      const s = this.snapPlayer(id);
      if (!s) continue;
      out.push({ id, role: e.info.role, x: e.x, z: e.z, health: s.h, locker: s.lc ?? null, carriedBy: s.cb ?? null, lk: s.lk || null, fx: { dh: (s.fx || '').includes('D') ? 1 : 0 } });
    }
    return out;
  }

  updateKillerLocal(dt) {
    if (this.role !== 'killer') return;
    const sp = this.meSnap;
    if (!sp) return;
    const L = this.local;
    const a = L.atk;
    const unrel = this.myInfo.perks.includes('unrelenting') ? 0.7 : 1;
    if (a.s === 'lunge') {
      a.t += dt;
      const me = { x: this.self.x, z: this.self.z, rot: this.self.rot };
      const tgt = attackCandidate(me, this.renderedPlayers(), this.col.world);
      if (tgt) {
        this.act({ a: 'hit', id: tgt.id });
        L.atk = { s: 'cd', t: 0, hit: true };
        this.camShake = 0.2;
      } else if ((this.m1Released && a.t >= KILL.LUNGE_MIN) || a.t >= KILL.LUNGE_MAX) {
        this.act({ a: 'miss' });
        L.atk = { s: 'cd', t: 0, hit: false };
      }
    } else if (a.s === 'cd') {
      a.t += dt;
      if (a.t >= (a.hit ? KILL.HIT_COOLDOWN : KILL.MISS_COOLDOWN * unrel)) L.atk = { s: null, t: 0, hit: false };
    }
    if (sp.lk === 'stun' || sp.bl > 0) { if (L.atk.s === 'lunge') L.atk = { s: 'cd', t: 0, hit: false }; }
    // chainsaw
    const s = L.saw;
    if (s.s === 'rev') {
      s.t += dt;
      if (this.loops.saw) this.loops.saw.set(0.25 + Math.min(1, s.t / 2) * 0.25, 0.05);
      if (sp.lk || sp.cy != null) { this.act({ a: 'saw', s: 'cancel' }); this.endSaw(); }
      else if (s.t >= 2.0) { L.saw = { s: 'go', t: 0 }; this.act({ a: 'saw', s: 'go' }); }
    } else if (s.s === 'go') {
      s.t += dt;
      const me = { x: this.self.x, z: this.self.z, rot: this.self.rot };
      const tgt = attackCandidate(me, this.renderedPlayers(), this.col.world, 1.6, 0.7);
      if (tgt) { this.act({ a: 'hit', id: tgt.id, w: 'saw' }); this.endSaw(); this.camShake = 0.4; }
      else if (s.t > 4.2 || sp.lk) { this.act({ a: 'saw', s: 'end' }); this.endSaw(); }
    }
    if (L.wind && (sp.lk || sp.cy != null)) L.wind = null;
  }

  // ------------------------------------------------------- local player --
  localPw() {
    const sp = this.meSnap;
    const L = this.local;
    if (this.role !== 'killer') return null;
    if (L.saw.s === 'rev') return 'rev';
    if (L.saw.s === 'go') return 'saw';
    if (L.wind) return 'wind';
    return sp.pw === 'saw' || sp.pw === 'rev' || sp.pw === 'wind' ? null : sp.pw;
  }

  updateSelf(dt) {
    const sp = this.meSnap;
    const P = this.self;
    if (!sp) return;
    const isK = this.role === 'killer';
    if (sp.sq !== P.seq) {
      P.seq = sp.sq;
      P.x = sp.x; P.z = sp.z;
      if (!isK) P.rot = sp.r;
      this.localLock = null;
    }
    // spectate when out of the match
    this.spectating = !isK && (sp.h === 'dead' || sp.h === 'escaped');
    if (this.spectating) {
      if (!this.spectateTarget || !this.isSpectatable(this.spectateTarget)) this.cycleSpectate();
      return;
    }
    const serverDriven = (sp.lk && !this.localLock) || ['carried', 'hooked'].includes(sp.h) || sp.lc != null || sp.tp != null;
    let moveX = 0, moveZ = 0, sprint = false, crouch = false;
    if (this.localLock) {
      const L = this.localLock;
      L.t += dt;
      if (L.from) {
        const f = Math.min(1, L.t / L.dur);
        const e = f * f * (3 - 2 * f);
        P.x = L.from.x + (L.to.x - L.from.x) * e;
        P.z = L.from.z + (L.to.z - L.from.z) * e;
      }
      if (L.t >= L.dur + (L.from ? 0 : 0.05)) this.localLock = null;
    } else if (serverDriven) {
      const ip = this.interp(this.myId);
      if (ip) { P.x = ip.x; P.z = ip.z; if (!isK) P.rot = ip.r; }
      this.holding = null;
    } else if (this.pendingLock && this.time < this.pendingLock.until) {
      // waiting for the server to start an action
    } else {
      this.pendingLock = null;
      if (this.holding && (this.time - this.holding.since > 0.5 && !sp.hd)) this.holding = null;
      const k = this.input.keys;
      const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
      const right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
      moveX = fx * fwd + rx * right;
      moveZ = fz * fwd + rz * right;
      const len = Math.hypot(moveX, moveZ);
      if (len > 0) { moveX /= len; moveZ /= len; }
      sprint = !isK && (k.has('ShiftLeft') || k.has('ShiftRight')) && len > 0;
      crouch = !isK && k.has('KeyC');
      const blocked = (!isK && this.holding) || this.paused || (isK && sp.bl > 0 && false);
      if (blocked) { moveX = 0; moveZ = 0; sprint = false; }
      const mp = {
        id: this.myId, role: this.role, health: sp.h, perks: this.myInfo.perks, char: this.myInfo.char,
        carrying: sp.cy ?? null, atk: this.local.atk.s, pw: this.localPw(), sm: sp.sm || 1,
        x: P.x, z: P.z, rot: P.rot,
      };
      if (isK) {
        if (this.local.saw.s === 'go') {
          mp.rot = turnToward(P.rot, this.yaw, dt * 1.5);
          this.yaw = mp.rot + angDiff(mp.rot, this.yaw) * 0.0;
        } else mp.rot = this.yaw;
      }
      const blockers = playerBlockers(this.S.players.map((q) => (q.id === this.myId ? q : { ...q, x: this.players.get(q.id)?.x ?? q.x, z: this.players.get(q.id)?.z ?? q.z })), mp);
      const res = stepMove(mp, { mx: moveX, mz: moveZ, sprint, crouch }, dt, this.col.world, blockers);
      if (isK && this.local.saw.s === 'go' && res.ratio < 0.5 && this.local.saw.t > 0.15) {
        this.act({ a: 'saw', s: 'bump' });
        this.endSaw();
        this.camShake = 0.7;
      }
      P.x = mp.x; P.z = mp.z; P.rot = mp.rot;
      if (!isK && this.flashHeld && sp.fl) P.rot = this.yaw;
    }
    this.moving = Math.hypot(moveX, moveZ) > 0;
    this.sprinting = sprint;
    this.crouching = crouch;
    const moved = Math.hypot(P.x - P.lastX, P.z - P.lastZ);
    P.lastX = P.x; P.lastZ = P.z;
    P.spd = P.spd * 0.7 + (moved / Math.max(dt, 1e-3)) * 0.3;
    // send input
    this.sendAcc += dt;
    if (this.sendAcc >= SEND_RATE) {
      this.sendAcc = 0;
      this.net.send({
        t: 'in', seq: P.seq, x: Math.round(P.x * 1000) / 1000, z: Math.round(P.z * 1000) / 1000,
        r: Math.round(P.rot * 1000) / 1000, pt: Math.round(-this.pitch * 1000) / 1000, sp: sprint, cr: crouch,
      });
    }
  }

  isSpectatable(id) {
    const s = this.snapPlayer(id);
    return s && s.h !== 'dead' && s.h !== 'escaped' && this.players.get(id).info.role === 'survivor';
  }

  cycleSpectate() {
    const ids = this.info.players.filter((p) => p.role === 'survivor' && p.id !== this.myId && this.isSpectatable(p.id)).map((p) => p.id);
    if (!ids.length) { this.spectateTarget = this.killerEntry ? this.killerEntry.info.id : null; return; }
    const i = ids.indexOf(this.spectateTarget);
    this.spectateTarget = ids[(i + 1) % ids.length];
  }

  // ------------------------------------------------------------- players --
  survivorAnim(s, isMe) {
    if (s.lk === 'sacrifice') return 'sacrifice';
    if (s.h === 'hooked') return s.hs === 2 ? 'struggle' : 'hooked';
    if (s.h === 'carried' || s.lk === 'hooking') return 'carried';
    const lk = isMe && this.localLock ? this.localLock.kind : s.lk;
    if (lk === 'vault' || lk === 'hatch') return 'vault';
    if (lk === 'drop') return 'drop';
    if (lk === 'unhooking') return 'unhook';
    if (lk === 'pickedup') return 'dying';
    if (s.tp != null) return 'trapped';
    if (s.h === 'dying') return (isMe ? this.self.spd : s.sp) > 0.15 ? 'crawl' : 'dying';
    if (s.hd) {
      const k = s.hd.k;
      if (k === 'repair' || k === 'freetrap' || k === 'disarm') return 'repair';
      if (k === 'heal') return 'heal';
      if (k === 'cleanse') return 'cleanse';
      if (k === 'chest') return 'chest';
      if (k === 'gate') return 'gate';
      if (k === 'selfcare' || k === 'medkit') return 'selfheal';
      if (k === 'escapetrap') return 'trapped';
    }
    const spd = isMe ? this.self.spd : s.sp;
    const crouch = isMe ? this.crouching : s.cr;
    if (spd > 0.25) return crouch ? 'crouchwalk' : spd > 3.0 ? 'run' : 'walk';
    return crouch ? 'crouch' : 'idle';
  }

  killerAnim(s, isMe) {
    const lk = isMe && this.localLock ? this.localLock.kind : s.lk;
    const map = { kvault: 'vault', break: 'break', kick: 'kick', pickup: 'pickup', hook: 'hookput', search: 'search', reload: 'reload', stun: 'stun', sawhit: 'stun', settrap: 'settrap', closehatch: 'kick', taketrap: 'pickup' };
    if (lk && map[lk]) return map[lk];
    const pw = s.pw;
    if (pw === 'rev') return 'rev';
    if (pw === 'saw') return 'saw';
    if (pw === 'wind') return 'wind';
    if (pw === 'cloaking' || pw === 'uncloaking') return 'bell';
    return 'idle';
  }

  updatePlayers(dt) {
    let flashI = 0;
    for (const f of this.flash) f.light.intensity = 0;
    for (const [id, e] of this.players) {
      const isMe = id === this.myId;
      const s = isMe ? this.meSnap : this.interp(id);
      if (!s) continue;
      const rig = e.rig;
      const role = e.info.role;
      if (isMe) { e.x = this.self.x; e.z = this.self.z; e.rot = this.self.rot; }
      else { e.x = s.x; e.z = s.z; e.rot = s.r; }
      e.snap = s;
      const gone = s.h === 'dead' || s.h === 'escaped';
      if (role === 'survivor') {
        const hidden = gone || (s.lc != null && s.lk !== 'locker_out');
        rig.root.visible = !hidden;
        if (hidden) continue;
        // carried: attach to the killer's shoulder
        const carrier = s.cb != null ? this.players.get(s.cb) : null;
        if (carrier && (s.h === 'carried' || s.lk === 'hooking')) {
          const anchor = carrier.info.id === this.myId && this.role === 'killer' ? this.vmCarry : carrier.rig.carry;
          if (rig.root.parent !== anchor) { anchor.add(rig.root); }
          rig.root.position.set(0, 0, 0);
          // the camera looks down -z while the killer's chest faces +z
          rig.root.rotation.set(-Math.PI / 2 - 0.25, anchor === this.vmCarry ? 0 : Math.PI, 0);
        } else {
          if (rig.root.parent !== this.scene) this.scene.add(rig.root);
          let rot = e.rot;
          let y = 0;
          if (s.h === 'hooked' && s.hk != null) {
            const hk = this.S.hooks[s.hk];
            if (hk) { rot = hk.rot; e.x = hk.x + Math.sin(hk.rot) * 0.3; e.z = hk.z + Math.cos(hk.rot) * 0.3; }
          }
          rig.root.position.set(e.x, y, e.z);
          rig.root.rotation.set(0, rot, 0);
        }
        const anim = this.survivorAnim(s, isMe);
        survivorPose(rig, {
          anim, speed: isMe ? this.self.spd : s.sp, injured: s.h === 'injured', lt: isMe && this.localLock ? this.localLock.t / this.localLock.dur : s.lt,
          vt: isMe && this.localLock ? this.localLock.vt : s.vt, wiggle: s.h === 'carried' && s.wg > 0, flash: !!s.fl, pitch: s.pt || 0,
        }, dt);
        // flashlight beams
        if (s.fl && flashI < this.flash.length) {
          const f = this.flash[flashI++];
          const hand = new THREE.Vector3();
          rig.j.handR.getWorldPosition(hand);
          const rr = isMe ? this.yaw : e.rot;
          const pt = isMe ? -this.pitch : (s.pt || 0);
          f.light.position.copy(hand);
          f.target.position.set(hand.x + Math.sin(rr) * Math.cos(pt) * 5, hand.y + Math.sin(pt) * 5, hand.z + Math.cos(rr) * Math.cos(pt) * 5);
          f.light.intensity = 30;
        }
        // grunts of pain and scratch marks / blood for the killer
        if (s.h === 'injured' && !e.info.perks.includes('iron_will')) {
          const t = this.gruntT.get(id) || 0;
          if (this.time > t) { this.gruntT.set(id, this.time + 3 + Math.random() * 4); audio.play('grunt', { pos: this.pos3(e.x, e.z), vol: 0.22, pitch: this.screamPitch(id) }); }
        }
        if (this.scratches && !isMe) {
          const acc = (this.scratchAcc.get(id) || 0) + dt;
          this.scratchAcc.set(id, acc);
          if (acc > 0.22) {
            this.scratchAcc.set(id, 0);
            if (s.sr && s.sp > 2.8 && (s.h === 'healthy' || s.h === 'injured')) {
              for (let i = 0; i < 2; i++) this.scratches.add(e.x + (Math.random() - 0.5) * 1.6, e.z + (Math.random() - 0.5) * 1.6, Math.random() * 6, 0.7 + Math.random() * 0.4, 7);
            }
            if ((s.h === 'injured' || s.h === 'dying') && Math.random() < ((s.fx || '').includes('M') ? 0.8 : 0.35)) {
              this.blood.add(e.x + (Math.random() - 0.5) * 0.6, e.z + (Math.random() - 0.5) * 0.6, Math.random() * 6, 0.25 + Math.random() * 0.25, 10);
            }
          }
        }
      } else {
        rig.root.position.set(e.x, 0, e.z);
        rig.root.rotation.set(0, e.rot, 0);
        if (!isMe) rig.root.visible = true;
        const local = isMe ? this.local : null;
        killerPose(rig, {
          anim: this.killerAnim(s, isMe), speed: isMe ? this.self.spd : s.sp,
          atk: local ? local.atk.s : s.atk, ah: local ? local.atk.hit : s.ah, carrying: s.cy != null, lt: s.lt,
        }, dt);
        // wraith cloak
        const cloakTarget = s.pw === 'cloaked' ? 1 : s.pw === 'cloaking' ? 0.6 : s.pw === 'uncloaking' ? 0.4 : 0;
        e.cloak += (cloakTarget - e.cloak) * Math.min(1, dt * 3);
        if (!isMe && this.killerEntry === e) {
          const op = 1 - e.cloak * 0.93;
          rig.root.traverse((o) => { if (o.isMesh) { o.material.opacity = op; o.material.depthWrite = op > 0.5; } });
          if (e.stain) e.stain.intensity = s.pw === 'cloaked' || s.pw === 'cloaking' ? 0 : 7;
        }
      }
    }
  }

  // ------------------------------------------------------------- world --
  updateWorld(dt) {
    const W = this.world;
    const S = this.S;
    S.pallets.forEach((p, i) => W.updatePallet(i, p.state === 'up' ? 'u' : p.state === 'falling' ? 'f' : p.state === 'down' ? 'd' : 'b', dt));
    S.gens.forEach((g, i) => W.updateGen(i, g.charges, g.done, g.blocked, g.regressing, g.n, dt));
    // exhaust smoke from generators being repaired
    if (Math.random() < dt * 6) {
      for (const g of S.gens) if (g.n > 0 && Math.random() < 0.4) this.smoke.emit(g.x + 0.2, 1.6, g.z, 0.1, 0.8, 0.1, 2.5, 0.5, 0.2, 0.2, 0.2, 0.35, { grow: 2 });
    }
    // gates
    S.gates.forEach((g, i) => {
      const o = W.gates[i];
      o.lights.forEach((l) => { l.material.emissiveIntensity = S.gatesPowered ? 3 : 0; });
      o.light.i = S.gatesPowered ? 4 : 0;
      o.sw.lights.forEach((l, k) => { l.material.emissiveIntensity = g.progress > (k + 1) / 3 - 0.01 ? 4 : S.gatesPowered ? 0.4 : 0; });
      o.sw.lever.rotation.x = -g.progress * 1.4;
      const target = g.open ? 2.3 : 0;
      o.doors.forEach((d, k) => { const sx = k === 0 ? -1 : 1; d.position.x += ((sx * 1.1 + sx * target) - d.position.x) * Math.min(1, dt * 0.8); });
    });
    // hatch
    const hatchOpen = S.hatch.state === 'open';
    W.hatch.door.rotation.z += ((hatchOpen ? 1.9 : 0) - W.hatch.door.rotation.z) * Math.min(1, dt * 3);
    W.hatch.light.i = hatchOpen ? 3 : 0;
    // totems
    S.totems.forEach((t, i) => {
      const o = W.totems[i];
      const hex = t.state === 'hex' || t.state === 'noed';
      o.candles.visible = hex;
      o.group.visible = t.state !== 'cleansed';
      o.light.i = hex ? 2.2 : 0;
      o.light.flicker = true;
      if (hex && Math.random() < dt * 8) this.particles.emit(t.x + (Math.random() - 0.5) * 0.6, 0.25, t.z + (Math.random() - 0.5) * 0.6, 0, 0.4, 0, 0.5, 0.08, 1, 0.6, 0.2, 0.9, {});
    });
    // chests
    S.chests.forEach((c, i) => { const o = W.chests[i]; o.lid.rotation.x += ((c.opened ? -1.6 : 0) - o.lid.rotation.x) * Math.min(1, dt * 3); });
    // lockers being entered/searched
    for (const p of S.players) {
      if (p.lk === 'locker_in' || p.lk === 'locker_out' || p.lk === 'search' || p.lk === 'reload') {
        const e = this.players.get(p.id);
        let best = null, bd = 2.5;
        for (const l of W.lockers) { const d = Math.hypot(l.data.x - e.x, l.data.z - e.z); if (d < bd) { bd = d; best = l; } }
        if (best) best.openT = 0.3;
      }
    }
    // entity legs on hooked survivors in struggle
    let legs = null;
    for (const p of this.latest.p) if (p.h === 'hooked' && (p.hs === 2 || p.lk === 'sacrifice') && p.hk != null) legs = this.S.hooks[p.hk];
    W.entityLegs.visible = !!legs;
    if (legs) {
      W.entityLegs.position.set(legs.x + Math.sin(legs.rot) * 0.3, 0, legs.z + Math.cos(legs.rot) * 0.3);
      W.entityLegs.rotation.y += dt * 0.3;
      if (Math.random() < dt * 20) this.dark.emit(legs.x + (Math.random() - 0.5) * 2, Math.random() * 3, legs.z + (Math.random() - 0.5) * 2, 0, 0.6, 0, 1.6, 0.8, 0.05, 0.0, 0.0, 0.6, { grow: 1 });
    }
    W.syncTraps(this.latest.tr);
    W.syncHatchets(this.latest.hx, Math.max(0, performance.now() / 1000 + this.offset - this.latest.tm));
    W.update(dt, this.camera.position);
    W.updateLights(this.camera.position.x, this.camera.position.z);
    W.updateShadowCenter(this.self.x, this.self.z);
    const h = window.innerHeight;
    this.particles.setScale(h); this.smoke.setScale(h); this.dark.setScale(h);
    this.particles.update(dt); this.smoke.update(dt); this.dark.update(dt);
    if (this.scratches) { this.scratches.update(dt); this.blood.update(dt); }
  }

  // ------------------------------------------------------------ camera --
  updateCamera(dt) {
    const cam = this.camera;
    const aspect = window.innerWidth / window.innerHeight;
    const hfov = (profile.settings.fov || 87) * Math.PI / 180;
    cam.fov = (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const shake = this.camShake > 0 ? this.camShake : 0;
    this.camShake = Math.max(0, this.camShake - dt);
    const sx = (Math.random() - 0.5) * shake * 0.15, sy = (Math.random() - 0.5) * shake * 0.15;
    if (this.role === 'killer') {
      const k = KILLERS[this.myInfo.char];
      const bob = this.self.spd > 0.5 ? Math.sin(this.time * 7.5) * 0.04 : 0;
      cam.position.set(this.self.x + sx, k.height - 0.12 + bob + sy, this.self.z);
      cam.rotation.set(0, 0, 0);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = this.yaw + Math.PI;
      cam.rotation.x = -this.pitch;
      this.updateViewmodel(dt);
      return;
    }
    // survivor / spectator third person
    let tx = this.self.x, tz = this.self.z, th = 1.45;
    const sp = this.meSnap;
    let yaw = this.yaw;
    if (this.spectating && this.spectateTarget) {
      const e = this.players.get(this.spectateTarget);
      if (e) { tx = e.x; tz = e.z; th = e.info.role === 'killer' ? 2.0 : 1.45; }
    } else if (sp) {
      if (sp.lc != null) {
        const l = this.S.lockers[sp.lc];
        if (l) {
          cam.position.set(l.x + Math.sin(l.rot) * 0.12, 1.62, l.z + Math.cos(l.rot) * 0.12);
          cam.rotation.order = 'YXZ';
          cam.rotation.set(-this.pitch * 0.5, this.yaw + Math.PI, 0, 'YXZ');
          return;
        }
      }
      if (sp.h === 'dying') th = 0.6;
      else if (sp.h === 'carried' || sp.h === 'hooked') th = 1.9;
      else if (this.crouching) th = 1.0;
      const e = this.players.get(this.myId);
      if (sp.h === 'carried' && e) { const v = new THREE.Vector3(); e.rig.j.hips.getWorldPosition(v); tx = v.x; tz = v.z; }
      if (sp.h === 'hooked' && e) { tx = e.x; tz = e.z; }
    }
    if (!this.camTarget) this.camTarget = new THREE.Vector3(tx, th, tz);
    this.camTarget.lerp(new THREE.Vector3(tx, th, tz), Math.min(1, dt * 14));
    const T = this.camTarget;
    const pitch = this.pitch;
    const dirX = Math.sin(yaw) * Math.cos(pitch), dirY = -Math.sin(pitch), dirZ = Math.cos(yaw) * Math.cos(pitch);
    const rightX = -Math.cos(yaw), rightZ = Math.sin(yaw);
    let dist = sp && sp.h === 'dying' ? 2.4 : 3.1;
    const shoulder = 0.42;
    const ox = T.x + rightX * shoulder, oz = T.z + rightZ * shoulder;
    // collide the camera boom against tall geometry
    const want = { x: ox - dirX * dist, z: oz - dirZ * dist };
    const f = this.col.world.raycast(T.x, T.z, want.x, want.z, 1.7, 0.2);
    if (f < 1) dist = Math.max(0.5, dist * f - 0.15);
    let cx = ox - dirX * dist, cy = T.y - dirY * dist + 0.15, cz = oz - dirZ * dist;
    const ceil = this.world.ceilingAt(T.x, T.z);
    if (cy > ceil - 0.35) cy = ceil - 0.35;
    if (cy < 0.25) cy = 0.25;
    cam.position.set(cx + sx, cy + sy, cz);
    cam.lookAt(cx + dirX * 10, cy + dirY * 10, cz + dirZ * 10);
  }

  updateViewmodel(dt) {
    const vm = this.vm;
    if (!vm) return;
    const sp = this.meSnap || {};
    const L = this.local;
    const t = this.time;
    const moving = this.self.spd > 0.5;
    let rx = 0, ry = 0, rz = 0, px = 0.3, py = -0.27, pz = -0.48;
    if (moving) { py += Math.sin(t * 7.5) * 0.015; px += Math.cos(t * 3.75) * 0.01; }
    if (L.atk.s === 'lunge') { rx = 1.2; ry = 0.4; py = -0.1; pz = -0.35; }
    else if (L.atk.s === 'cd') {
      const k = Math.min(1, L.atk.t / 0.18);
      if (L.atk.hit && L.atk.t > 0.3) { rx = -0.2; ry = -1.0; px = 0.05; py = -0.35; rz = 0.6; }
      else { rx = 1.2 - 2.0 * k; ry = 0.4 - 1.0 * k; px = 0.3 - 0.25 * k; py = -0.1 - 0.25 * k; }
    }
    if (sp.cy != null) { py -= 0.05; }
    if (sp.lk === 'stun' || sp.bl > 0) { rx = -0.6; py = -0.2; px = 0.15; rz = Math.sin(t * 10) * 0.1; }
    if (sp.lk === 'break' || sp.lk === 'kick') { py = -0.45 + Math.sin(t * 9) * 0.05; }
    const a = this.vmArm;
    const k = Math.min(1, dt * 16);
    a.rotation.x += (rx - a.rotation.x) * k;
    a.rotation.y += (ry - a.rotation.y) * k;
    a.rotation.z += (rz - a.rotation.z) * k;
    a.position.x += (px - a.position.x) * k;
    a.position.y += (py - a.position.y) * k;
    a.position.z += (pz - a.position.z) * k;
    if (this.vmSaw) {
      const active = L.saw.s;
      this.vmSaw.position.set(active ? -0.12 : -0.25, active ? -0.32 : -0.5, active ? -0.55 : -0.45);
      this.vmSaw.rotation.set(active ? 0 : -0.6, 0.1, 0);
      if (active) this.vmSaw.position.x += (Math.random() - 0.5) * 0.01;
    }
    if (this.vmHatchet) {
      this.vmHatchet.visible = !!L.wind;
      if (L.wind) { const p = L.windPower(); this.vmHatchet.position.set(-0.3, -0.15 + p * 0.08, -0.35 + p * 0.15); this.vmHatchet.rotation.set(0.8 + p, 0, 0.3); }
    }
    if (this.vmBell) this.vmBell.position.y = sp.pw === 'cloaking' || sp.pw === 'uncloaking' ? -0.15 + Math.sin(t * 20) * 0.02 : -0.4;
    vm.visible = sp.lk !== 'pickup';
  }

  // ------------------------------------------------------------ audio --
  updateAudio(dt) {
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, dir.x, dir.z);
    const sp = this.meSnap;
    // heartbeat / terror radius
    const k = this.killerEntry;
    let hb = 0;
    if (this.role === 'survivor' && k && sp && !this.spectating && k.snap) {
      const tr = k.snap.tr ?? KILLERS[k.info.char].terror;
      const d = Math.hypot(k.x - this.self.x, k.z - this.self.z);
      if (tr > 0 && d < tr) hb = Math.min(1, (1 - d / tr) * 1.15);
    }
    audio.setHeartbeat(hb);
    const chase = sp && (this.role === 'killer' ? this.latest.p.some((p) => p.ch) : !!sp.ch);
    audio.setChase(!!chase);
    // generator hum
    this.S.gens.forEach((g) => {
      const want = g.n > 0 ? 0.5 : g.done ? 0.08 : 0;
      let l = this.genLoops.get(g.id);
      if (want > 0 && !l) {
        const d = Math.hypot(g.x - cam.position.x, g.z - cam.position.z);
        if (d < 45) { l = audio.loop('gen', { vol: want, pos: { x: g.x, y: 1, z: g.z }, ref: 3 }); if (l) this.genLoops.set(g.id, l); }
      } else if (l) {
        const d = Math.hypot(g.x - cam.position.x, g.z - cam.position.z);
        if (want === 0 || d > 55) { l.stop(); this.genLoops.delete(g.id); } else if (Math.abs(l.vol - want) > 0.01) l.set(want, 0.5);
      }
    });
    // hatch wind
    const hatchOpen = this.S.hatch.state === 'open';
    if (hatchOpen && !this.loops.hatch) this.loops.hatch = audio.loop('hatchWind', { vol: 0.5, pos: { x: this.S.hatch.x, y: 0.3, z: this.S.hatch.z }, ref: 2 });
    else if (!hatchOpen && this.loops.hatch) { this.loops.hatch.stop(); this.loops.hatch = null; }
    // remote chainsaw
    if (k && k.info.id !== this.myId && k.snap) {
      const sawOn = k.snap.pw === 'rev' || k.snap.pw === 'saw';
      if (sawOn && !this.loops.rsaw) this.loops.rsaw = audio.loop('chainsaw', { vol: 0.5, pos: { x: k.x, y: 1, z: k.z }, ref: 5 });
      if (this.loops.rsaw) {
        this.loops.rsaw.pos(k.x, 1, k.z);
        if (!sawOn) { this.loops.rsaw.stop(); this.loops.rsaw = null; }
      }
    }
    if (this.loops.saw && this.local.saw.s === 'go') this.loops.saw.set(0.55, 0.05);
    // crows
    if (Math.random() < dt * 0.05) {
      const a = Math.random() * Math.PI * 2;
      audio.play('crow', { pos: { x: cam.position.x + Math.cos(a) * 15, y: 6, z: cam.position.z + Math.sin(a) * 15 } });
    }
  }

  // ------------------------------------------------------------- auras --
  updateAuras() {
    const want = new Map(); // object -> layer
    const sp = this.meSnap;
    const S = this.S;
    const isK = this.role === 'killer';
    const me = this.players.get(this.myId);
    const mePerks = this.myInfo.perks;
    const now = this.time;
    if (!this.latest) return;
    if (!isK) {
      for (const p of this.latest.p) {
        const e = this.players.get(p.i);
        if (!e || p.i === this.myId || e.info.role !== 'survivor') continue;
        if (p.h === 'hooked') want.set(e.rig.root, AURA.RED);
        else if (p.h === 'dead' || p.h === 'escaped' || p.lc != null) continue;
        else if (mePerks.includes('bond') && Math.hypot(e.x - me.x, e.z - me.z) < 36) want.set(e.rig.root, AURA.YELLOW);
        else if (p.h === 'dying' && Math.hypot(e.x - me.x, e.z - me.z) < 64) want.set(e.rig.root, AURA.YELLOW);
      }
      // kindred
      const kindredHook = this.latest.p.find((p) => p.h === 'hooked' && this.players.get(p.i)?.info.perks.includes('kindred'));
      if (kindredHook) {
        for (const p of this.latest.p) {
          const e = this.players.get(p.i);
          if (!e || p.i === this.myId || p.h === 'dead' || p.h === 'escaped' || p.lc != null) continue;
          if (e.info.role === 'survivor') want.set(e.rig.root, want.get(e.rig.root) || AURA.YELLOW);
          else if (Math.hypot(e.x - kindredHook.x, e.z - kindredHook.z) < 16) want.set(e.rig.root, AURA.RED);
        }
      }
      if (S.gatesPowered) this.world.gates.forEach((g, i) => { if (!S.gates[i].open) want.set(g.sw.group, AURA.WHITE); });
    } else {
      if (sp && sp.cy != null) for (let i = 0; i < S.hooks.length; i++) if (S.hooks[i].occupant == null) want.set(this.world.hooks[i].group, AURA.WHITE);
      for (const p of this.latest.p) {
        const e = this.players.get(p.i);
        if (!e || e.info.role !== 'survivor' || p.h === 'dead' || p.h === 'escaped' || p.h === 'carried') continue;
        const rev = (this.reveals.get(p.i) || 0) > now;
        const healing = p.hd && ['heal', 'selfcare', 'medkit'].includes(p.hd.k);
        const beingHealed = this.latest.p.some((q) => q.hd && q.hd.k === 'heal' && q.hd.id === p.i);
        const nurse = mePerks.includes('nurses_calling') && (healing || beingHealed) && Math.hypot(e.x - this.self.x, e.z - this.self.z) < 28;
        if (rev || nurse) want.set(e.rig.root, AURA.RED);
      }
      if (mePerks.includes('discordance')) S.gens.forEach((g, i) => { if (g.n >= 2 && !g.done) want.set(this.world.gens[i].group, AURA.YELLOW); });
    }
    // spine chill / whispers indicators
    if (!isK && this.killerEntry && me) {
      const k = this.killerEntry;
      const d = Math.hypot(k.x - me.x, k.z - me.z);
      this.spineChill = mePerks.includes('spine_chill') && d < 36 && Math.abs(angDiff(k.rot, Math.atan2(me.x - k.x, me.z - k.z))) < 0.5 && this.col.world.clearLine(k.x, k.z, me.x, me.z, 1.5);
    }
    if (isK) this.whispers = mePerks.includes('whispers') && this.latest.p.some((p) => { const e = this.players.get(p.i); return e && e.info.role === 'survivor' && p.h !== 'dead' && p.h !== 'escaped' && Math.hypot(e.x - this.self.x, e.z - this.self.z) < 32; });
    // apply layer changes
    if (!this.auraObjs) this.auraObjs = new Map();
    for (const [obj, L] of this.auraObjs) {
      if (want.get(obj) !== L) { setLayerDeep(obj, L, false); this.auraObjs.delete(obj); }
    }
    for (const [obj, L] of want) {
      if (this.auraObjs.get(obj) !== L) { setLayerDeep(obj, L, true); this.auraObjs.set(obj, L); }
    }
    for (const L of [1, 2, 3]) this.aura.active[L] = [...this.auraObjs.values()].includes(L);
  }
}
