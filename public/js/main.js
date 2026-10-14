// App entry: splash -> title -> menu <-> lobby -> match -> results.

import * as THREE from 'three';
import { Net } from './net.js';
import { P2PNet } from './p2p.js';
import { profile, saveProfile } from './store.js';
import { audio } from './audio.js';
import { initRenderer, renderer } from './gfx/renderer.js';
import { CampfireScene, startCampfireAudio } from './gfx/campfire.js';
import { createSurvivor, createKiller, renderPortrait } from './gfx/models.js';
import * as TX from './gfx/textures.js';
import { runSplash, showTitle } from './ui/splash.js';
import { MainMenu } from './ui/menu.js';
import { LobbyUI } from './ui/lobby.js';
import { toast, ui, h } from './ui/dom.js';
import { applyAudioSettings } from './ui/settings.js';
import { SURVIVORS, KILLERS } from '../shared/data.js';

const DISTRESS_FILTER = `
<svg width="0" height="0" style="position:absolute">
  <filter id="distress" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</svg>`;

class App {
  constructor() {
    const params = new URLSearchParams(location.search);
    this.noRender = params.has('norender');
    // The Node server build talks to /ws; the static build (GitHub Pages) hosts
    // games in the browser and connects friends peer-to-peer.
    const netMode = document.querySelector('meta[name="dbd-net"]');
    this.net = netMode && netMode.content === 'p2p' ? new P2PNet() : new Net();
    this.mode = 'splash';
    this.portraits = {};
    this.game = null;
    this.clock = new THREE.Clock();
    this.menu = new MainMenu(this);
    this.lobbyUI = new LobbyUI(this);
    this.screen = null;
    this.inLobby = false;
  }

  async start() {
    document.body.insertAdjacentHTML('beforeend', DISTRESS_FILTER);
    initRenderer();
    this.campfire = new CampfireScene();
    this.loop();
    this.net.connect();
    this.bindNet();
    await runSplash((progress) => this.prepare(progress));
    this.mode = 'campfire';
    await showTitle();
    audio.init();
    applyAudioSettings();
    this.ambience = startCampfireAudio();
    this.net.send({ t: 'hello', name: profile.name, loadouts: profile.loadouts });
    const params = new URLSearchParams(location.search);
    const code = params.get('join');
    if (code) {
      history.replaceState(null, '', location.pathname);
      if (!profile.name) { profile.name = 'Survivor' + Math.floor(100 + Math.random() * 900); saveProfile(); this.net.send({ t: 'name', name: profile.name }); }
      this.joinLobby(code.toUpperCase());
    }
    this.showMenu();
  }

  // Warm up textures, fonts and portraits while the Unity loader runs.
  async prepare(progress) {
    const steps = [];
    steps.push(() => document.fonts && document.fonts.ready);
    steps.push(() => { TX.groundTexture('#38382c', '#2a2b22'); TX.barkTexture(); TX.rockTexture(); });
    steps.push(() => { TX.brickTexture(); TX.stoneTexture(); TX.woodTexture(); TX.fabricTexture(); });
    steps.push(() => { TX.rustMetalTexture(); TX.concreteTexture(); TX.corrugatedTexture(); TX.lockerTexture(); });
    for (const id of Object.keys(SURVIVORS)) steps.push(() => { this.portraits[id] = renderPortrait(renderer, createSurvivor(id)); });
    for (const id of Object.keys(KILLERS)) steps.push(() => { this.portraits[id] = renderPortrait(renderer, createKiller(id)); });
    steps.push(() => { this.campfire.update(0.016); this.campfire.render(); });
    for (let i = 0; i < steps.length; i++) {
      try { await steps[i](); } catch (e) { console.warn('prepare step failed', e); }
      progress((i + 1) / steps.length);
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  bindNet() {
    const n = this.net;
    n.on('close', () => {
      toast('Disconnected from the server. Reload the page to reconnect.', 8000);
      if (this.game) this.endGame();
      this.inLobby = false;
      if (this.screen === 'lobby') this.showMenu();
    });
    n.on('error', (m) => toast(m.text));
    n.on('toast', (m) => toast(m.text));
    n.on('list', (m) => this.menu.showLobbyList(m.lobbies));
    n.on('lobby', (m) => {
      this.inLobby = true;
      this.lobbyUI.update(m.lobby);
      if (this.screen !== 'lobby' && this.screen !== 'game' && this.screen !== 'results' && this.screen !== 'loading') this.showLobby();
    });
    n.on('chat', (m) => this.lobbyUI.addChat(m.msg));
    n.on('left', () => { this.inLobby = false; this.showMenu(); });
    n.on('kicked', () => { this.inLobby = false; toast('You were removed from the lobby.'); this.showMenu(); });
    n.on('hostLost', () => {
      toast('Lost connection to the host. The lobby has closed.', 6000);
      if (this.game) this.endGame();
      this.inLobby = false;
      this.showMenu();
    });
    n.on('hostStatus', () => { if (this.screen === 'lobby') this.lobbyUI.renderInfo(); });
    n.on('match', (m) => this.startGame(m.info));
    n.on('go', () => {
      if (this.game && this.game.built) this.game.go();
      else if (this.game) this.game.pendingGo = true;
    });
    n.on('results', (m) => this.showResults(m.results));
    n.on('s', (m) => { if (this.game && this.game.built) this.game.onSnapshot(m); });
    n.on('ev', (m) => { if (this.game && this.game.built) for (const e of m.e) this.game.onEvent(e); });
  }

  // ------------------------------------------------------------ screens --
  clearScreen() {
    this.menu.hide();
    this.lobbyUI.hide();
    if (this.resultsEl) { this.resultsEl.remove(); this.resultsEl = null; }
    if (this.loadingEl) { this.loadingEl.remove(); this.loadingEl = null; }
  }

  showMenu() {
    this.clearScreen();
    this.screen = 'menu';
    this.mode = 'campfire';
    this.menu.show();
  }

  showLobby() {
    this.clearScreen();
    this.screen = 'lobby';
    this.mode = 'campfire';
    this.lobbyUI.show();
    if (!this.ambience && audio.ready) this.ambience = startCampfireAudio();
  }

  createLobby(role, settings) {
    this.net.send({ t: 'hello', name: profile.name, loadouts: profile.loadouts });
    this.net.send({ t: 'create', role, settings: { ...settings, difficulty: settings.difficulty || 'normal' } });
  }

  joinLobby(code) {
    this.net.send({ t: 'hello', name: profile.name, loadouts: profile.loadouts });
    this.net.send({ t: 'join', code, role: profile.role });
  }

  leaveLobby() {
    this.net.send({ t: 'leave' });
    this.inLobby = false;
    this.showMenu();
  }

  async startGame(info) {
    this.clearScreen();
    this.screen = 'loading';
    const { REALMS } = await import('../shared/data.js');
    const realm = REALMS[info.map.realm];
    const tips = [
      'Hit great skill checks for bonus progress. Missing one makes the generator explode and alerts the killer.',
      'Pallets stun the killer if they are underneath when you drop them.',
      'The killer can see your scratch marks when you run. Walk or crouch to stay hidden.',
      'Injured survivors grunt in pain and leave a trail of blood.',
      'When only one survivor remains, the hatch opens. The killer can close it.',
      'Three hooks and you are sacrificed to the Entity. Rescue your friends!',
      'As the killer, listen for generators and noise notifications.',
      'Vault windows while running for a fast vault — but it makes noise.',
    ];
    const el = (this.loadingEl = h(`
      <div class="screen loading">
        <div class="bg"></div>
        <div class="realm">${realm.name}</div>
        <div class="mapname">${info.map.name}</div>
        <div class="tip">${tips[Math.floor(Math.random() * tips.length)]}</div>
        <div class="ltext">LOADING</div>
        <div class="spinner"></div>
      </div>`));
    ui().appendChild(el);
    if (this.ambience) { for (const l of Object.values(this.ambience)) l && l.stop(); this.ambience = null; }
    await new Promise((r) => setTimeout(r, 60));
    try {
      const { Game } = await import('./game/game.js');
      const game = new Game(this, info);
      this.game = game;
      await game.build();
      if (this.game !== game) return;
      game.built = true;
      this.mode = 'game';
      this.net.send({ t: 'loaded' });
      if (game.pendingGo) game.go();
    } catch (e) {
      console.error(e);
      toast('Failed to load the match: ' + e.message, 8000);
      this.net.send({ t: 'leaveMatch' });
      this.endGame();
      this.showLobby();
    }
  }

  onGameStarted() {
    if (this.loadingEl) {
      const el = this.loadingEl;
      el.style.transition = 'opacity 1.2s';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      setTimeout(() => el.remove(), 1300);
      this.loadingEl = null;
    }
    this.screen = 'game';
  }

  endGame() {
    if (this.game) { this.game.dispose(); this.game = null; }
    this.mode = 'campfire';
    audio.stopAllLoops();
  }

  leaveMatch() {
    this.net.send({ t: 'leaveMatch' });
    this.endGame();
    this.showLobby();
  }

  async showResults(results) {
    const game = this.game;
    const myId = this.net.id;
    this.endGame();
    this.clearScreen();
    this.screen = 'results';
    const { showResults } = await import('./ui/results.js');
    this.resultsEl = showResults(this, results, myId, game ? game.info : null, () => {
      this.resultsEl.remove();
      this.resultsEl = null;
      if (this.inLobby) this.showLobby(); else this.showMenu();
    });
    if (!this.ambience && audio.ready) this.ambience = startCampfireAudio();
  }

  // ------------------------------------------------------------- loop --
  loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      const dt = Math.min(0.05, this.clock.getDelta());
      audio.update(dt);
      if (this.mode === 'splash') return;
      if (this.mode === 'game' && this.game) {
        this.game.frame(dt);
      } else {
        this.campfire.update(dt);
        if (!this.noRender) this.campfire.render();
        if (this.screen === 'lobby') this.lobbyUI.frame();
      }
    };
    requestAnimationFrame(tick);
  }
}

const app = new App();
window.__app = app;
app.start().catch((e) => {
  console.error(e);
  ui().innerHTML = `<div style="padding:40px;color:#f88">Failed to start: ${e.message}</div>`;
});
