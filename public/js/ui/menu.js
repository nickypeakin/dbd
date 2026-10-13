// Main menu: play as survivor/killer with bots, host or join a lobby with
// friends, settings and how-to-play.

import { h, ui, esc, $ } from './dom.js';
import { logoHTML } from './splash.js';
import { STATUS_ICONS } from './icons.js';
import { profile, saveProfile } from '../store.js';
import { audio } from '../audio.js';
import { openSettings } from './settings.js';

export class MainMenu {
  constructor(app) {
    this.app = app;
  }

  show() {
    const el = (this.el = h(`
      <div class="screen menu">
        <div class="side">
          ${logoHTML()}
          <nav>
            <button class="mbtn" data-a="play">Play</button>
            <button class="mbtn" data-a="friends">Play with Friends</button>
            <button class="mbtn small" data-a="howto">How to Play</button>
            <button class="mbtn small" data-a="settings">Settings</button>
            <button class="mbtn small" data-a="quit">Quit</button>
          </nav>
          <div class="version">FAN REMAKE &bull; v1.0 &bull; ${navigator.onLine ? 'ONLINE' : 'OFFLINE'}</div>
        </div>
        <div class="profile">
          <div class="avatar"><span>${esc((profile.name || '?')[0].toUpperCase())}</span></div>
          <div>
            <div class="hint">PLAYER NAME</div>
            <input class="pname" maxlength="18" value="${esc(profile.name)}" placeholder="Enter your name">
          </div>
        </div>
        <div class="sub-host"></div>
      </div>`));
    ui().appendChild(el);
    const input = $('.pname', el);
    input.addEventListener('change', () => {
      profile.name = input.value.trim().slice(0, 18);
      saveProfile();
      this.app.net.send({ t: 'name', name: profile.name });
      $('.avatar span', el).textContent = (profile.name || '?')[0].toUpperCase();
    });
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
    for (const b of el.querySelectorAll('.mbtn')) {
      b.addEventListener('mouseenter', () => audio.play('hover'));
      b.addEventListener('click', () => {
        audio.play('click');
        el.querySelectorAll('.mbtn').forEach((x) => x.classList.toggle('active', x === b));
        this.action(b.dataset.a);
      });
    }
    this.app.campfire.setView('menu');
  }

  hide() {
    if (this.el) this.el.remove();
    this.el = null;
    clearInterval(this.listTimer);
  }

  ensureName() {
    if (!profile.name) {
      const n = 'Survivor' + Math.floor(100 + Math.random() * 900);
      profile.name = n;
      saveProfile();
      const input = $('.pname', this.el);
      if (input) input.value = n;
      this.app.net.send({ t: 'name', name: n });
    }
  }

  sub(html) {
    clearInterval(this.listTimer);
    const host = $('.sub-host', this.el);
    host.innerHTML = '';
    if (!html) return null;
    const p = h(`<div class="subpanel panel">${html}</div>`);
    host.appendChild(p);
    return p;
  }

  action(a) {
    if (a === 'play') {
      const p = this.sub(`
        <h2>Choose your side</h2>
        <p>Jump into a match right away. Empty slots are filled with bots &mdash; friends can still join with your lobby code.</p>
        <div class="role-cards">
          <button class="role-card" data-r="survivor"><div class="ico">${STATUS_ICONS.survivor}</div><div class="name">SURVIVOR</div><div class="desc">Repair generators, help your team and escape through the exit gates.</div></button>
          <button class="role-card" data-r="killer"><div class="ico">${STATUS_ICONS.killer}</div><div class="name">KILLER</div><div class="desc">Hunt the survivors, hook them and sacrifice them to the Entity.</div></button>
        </div>`);
      for (const b of p.querySelectorAll('.role-card')) {
        b.addEventListener('mouseenter', () => audio.play('hover'));
        b.addEventListener('click', () => {
          audio.play('boom', { vol: 0.35 });
          this.ensureName();
          profile.role = b.dataset.r;
          saveProfile();
          this.app.createLobby(b.dataset.r, { public: false });
        });
      }
    } else if (a === 'friends') {
      const p = this.sub(`
        <h2>Play with friends</h2>
        <p>Host a lobby and share the code or invite link. Up to 5 players &mdash; bots fill any empty slot.</p>
        <div class="field"><span class="label">Lobby name</span><input class="input lname" maxlength="28" value="${esc((profile.name || 'My') + "'s Lobby")}"></div>
        <div class="row" style="margin-bottom:16px">
          <label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" class="check pub" checked> <span>Show in public lobby list</span></label>
        </div>
        <div class="row" style="gap:10px;margin-bottom:22px">
          <button class="btn host-s">Host as Survivor</button>
          <button class="btn ghost host-k">Host as Killer</button>
        </div>
        <span class="label">Join with a code</span>
        <div class="row" style="margin-top:6px">
          <input class="input code" maxlength="5" placeholder="CODE">
          <button class="btn join">Join</button>
        </div>
        <div style="margin-top:18px" class="row"><span class="label" style="flex:1">Public lobbies</span><button class="btn ghost small refresh">Refresh</button></div>
        <div class="lobby-list"><div class="empty">Searching...</div></div>`);
      const host = (role) => {
        this.ensureName();
        audio.play('boom', { vol: 0.35 });
        profile.role = role;
        saveProfile();
        this.app.createLobby(role, { public: $('.pub', p).checked, name: $('.lname', p).value });
      };
      $('.host-s', p).addEventListener('click', () => host('survivor'));
      $('.host-k', p).addEventListener('click', () => host('killer'));
      const code = $('.code', p);
      code.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') join(); });
      $('.lname', p).addEventListener('keydown', (e) => e.stopPropagation());
      const join = () => {
        const c = code.value.trim().toUpperCase();
        if (c.length < 4) return;
        this.ensureName();
        audio.play('click');
        this.app.joinLobby(c);
      };
      $('.join', p).addEventListener('click', join);
      const refresh = () => this.app.net.send({ t: 'list' });
      $('.refresh', p).addEventListener('click', refresh);
      refresh();
      this.listTimer = setInterval(refresh, 4000);
      this.listPanel = p;
    } else if (a === 'settings') {
      this.sub(null);
      openSettings(this.app);
    } else if (a === 'howto') {
      this.sub(null);
      openHowTo();
    } else if (a === 'quit') {
      const p = this.sub(`<h2>Leaving so soon?</h2><p>The Entity will be waiting. You can simply close this tab &mdash; thanks for playing!</p><button class="btn ghost back">Stay</button>`);
      $('.back', p).addEventListener('click', () => this.sub(null));
    }
  }

  showLobbyList(list) {
    if (!this.listPanel || !this.el) return;
    const box = $('.lobby-list', this.listPanel);
    if (!box) return;
    if (!list.length) { box.innerHTML = '<div class="empty">No public lobbies right now. Host one!</div>'; return; }
    box.innerHTML = '';
    for (const l of list) {
      const row = h(`<div class="lobby-row"><div><div class="n">${esc(l.name)}</div><div class="m">${l.players}/5 players &bull; ${l.killer ? 'killer taken' : 'killer open'} &bull; ${esc(l.difficulty)} bots${l.state !== 'lobby' && l.state !== 'countdown' ? ' &bull; in match' : ''}</div></div><button class="btn small">Join</button></div>`);
      row.addEventListener('click', () => { this.ensureName(); audio.play('click'); this.app.joinLobby(l.code); });
      box.appendChild(row);
    }
  }
}

export function openHowTo() {
  const back = h(`
    <div class="modal-back">
      <div class="modal panel">
        <h2>How to play</h2>
        <div class="controls">
          <div>
            <h3>SURVIVOR</h3>
            <div class="kv"><span>Move / Run</span><span><span class="kbd">WASD</span> + <span class="kbd">SHIFT</span></span></div>
            <div class="kv"><span>Crouch</span><span class="kbd">C</span></div>
            <div class="kv"><span>Repair, heal, unhook, open</span><span class="kbd">M1</span> hold</div>
            <div class="kv"><span>Vault, pallet, locker, hatch</span><span class="kbd">SPACE</span></div>
            <div class="kv"><span>Skill check</span><span class="kbd">SPACE</span></div>
            <div class="kv"><span>Use item</span><span class="kbd">M2</span></div>
            <div class="kv"><span>Active perk (Dead Hard, Self-Care)</span><span class="kbd">E</span></div>
            <div class="kv"><span>Wiggle when carried</span><span><span class="kbd">A</span> <span class="kbd">D</span></span></div>
          </div>
          <div>
            <h3>KILLER</h3>
            <div class="kv"><span>Move</span><span class="kbd">WASD</span></div>
            <div class="kv"><span>Attack (hold to lunge)</span><span class="kbd">M1</span></div>
            <div class="kv"><span>Power</span><span class="kbd">M2</span></div>
            <div class="kv"><span>Pick up, hook, break, kick, vault</span><span class="kbd">SPACE</span></div>
            <div class="kv"><span>Search locker / reload</span><span class="kbd">SPACE</span></div>
            <div class="kv"><span>Drop carried survivor</span><span class="kbd">E</span></div>
            <h3 style="margin-top:14px">GENERAL</h3>
            <div class="kv"><span>Pause / free mouse</span><span class="kbd">ESC</span></div>
            <div class="kv"><span>Scoreboard</span><span class="kbd">TAB</span></div>
          </div>
        </div>
        <div class="tips">
          <b>Survivors</b> repair <b>5 generators</b> to power the exit gates, open a gate (20s) and escape. Two hits put you in the dying state;
          the killer can hook you. Three hooks and you are sacrificed. Hit <b>skill checks</b> with SPACE when the needle is in the white zone.<br><br>
          <b>The Killer</b> must sacrifice everyone. Break pallets, kick generators, follow scratch marks and listen for injured survivors.
          When one survivor remains, the <b>hatch</b> opens.
        </div>
        <div style="text-align:right;margin-top:18px"><button class="btn ghost close">Close</button></div>
      </div>
    </div>`);
  ui().appendChild(back);
  const close = () => back.remove();
  back.querySelector('.close').addEventListener('click', close);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
}
