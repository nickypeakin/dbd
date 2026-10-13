// Lobby screen: player list with bots, loadout editor, chat, ready-up and
// host settings, over the 3D campfire scene.

import { h, ui, esc, $, toast, copyText } from './dom.js';
import { perkIcon, ITEM_ICONS, STATUS_ICONS } from './icons.js';
import { SURVIVORS, KILLERS, PERKS, ITEMS, REALMS, SURVIVOR_PERK_IDS, KILLER_PERK_IDS, DIFFICULTIES } from '/shared/data.js';
import { profile, saveProfile } from '../store.js';
import { audio } from '../audio.js';

export function perkHTML(id, big = false) {
  const p = PERKS[id];
  if (!p) return `<div class="perk empty${big ? ' big' : ''}"><div class="dia"></div></div>`;
  return `<div class="perk r${p.rarity}${big ? ' big' : ''}" title="${esc(p.name)}"><div class="dia"></div>${perkIcon(p.icon)}</div>`;
}

export class LobbyUI {
  constructor(app) {
    this.app = app;
    this.lobby = null;
    this.picker = null;
    this.tags = [];
  }

  get me() {
    return this.lobby && this.lobby.members.find((m) => m.id === this.app.net.id);
  }

  get role() {
    const me = this.me;
    return me ? me.role || me.wantRole : profile.role;
  }

  show() {
    const el = (this.el = h(`
      <div class="screen lobby">
        <div class="nametags"></div>
        <header class="lobby-top">
          <div class="lobby-info panel"></div>
          <div class="players panel"></div>
        </header>
        <section class="loadout panel"></section>
        <section class="lobby-right">
          <div class="chat panel"><div class="log"></div><input maxlength="200" placeholder="Press Enter to chat..."></div>
          <button class="ready-btn">READY</button>
          <div class="lobby-actions"><button class="btn ghost small leave">Leave lobby</button><button class="btn ghost small howto">Controls</button></div>
        </section>
        <div class="countdown hidden"></div>
        <div class="banner panel hidden"></div>
      </div>`));
    ui().appendChild(el);
    const input = $('.chat input', el);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) {
        this.app.net.send({ t: 'chat', text: input.value.trim() });
        input.value = '';
      }
      if (e.key === 'Escape') input.blur();
    });
    this.keyHandler = (e) => {
      if (e.key === 'Enter' && document.activeElement !== input && !document.querySelector('.modal-back')) { input.focus(); e.preventDefault(); }
    };
    window.addEventListener('keydown', this.keyHandler);
    $('.ready-btn', el).addEventListener('click', () => {
      const me = this.me;
      if (!me) return;
      audio.play(me.ready ? 'click' : 'boom', { vol: 0.4 });
      this.app.net.send({ t: 'ready', ready: !me.ready });
    });
    $('.leave', el).addEventListener('click', () => { audio.play('click'); this.app.leaveLobby(); });
    $('.howto', el).addEventListener('click', () => import('./menu.js').then((m) => m.openHowTo()));
    this.renderChatHistory();
    if (this.lobby) this.update(this.lobby);
  }

  hide() {
    window.removeEventListener('keydown', this.keyHandler);
    if (this.el) this.el.remove();
    this.el = null;
    this.picker = null;
  }

  // ------------------------------------------------------------ updates --
  update(lobby) {
    this.lobby = lobby;
    if (!this.el) return;
    this.renderInfo();
    this.renderPlayers();
    this.renderLoadout();
    this.renderReady();
    this.syncScene();
  }

  addChat(msg) {
    if (!this.chatLog) this.chatLog = [];
    this.chatLog.push(msg);
    if (this.chatLog.length > 60) this.chatLog.shift();
    if (!this.el) return;
    const log = $('.chat .log', this.el);
    log.appendChild(this.chatLine(msg));
    log.scrollTop = log.scrollHeight;
    if (msg.from) audio.play('hover');
  }

  chatLine(msg) {
    return h(msg.from ? `<div><b>${esc(msg.from)}:</b> ${esc(msg.text)}</div>` : `<div class="sys">${esc(msg.text)}</div>`);
  }

  renderChatHistory() {
    const log = $('.chat .log', this.el);
    log.innerHTML = '';
    for (const m of this.chatLog || []) log.appendChild(this.chatLine(m));
    log.scrollTop = log.scrollHeight;
  }

  renderInfo() {
    const L = this.lobby;
    const me = this.me;
    const host = me && L.hostId === me.id;
    const box = $('.lobby-info', this.el);
    const realm = L.settings.realm === 'random' ? 'Random realm' : REALMS[L.settings.realm].name;
    box.innerHTML = `
      <div class="label">${L.settings.public ? 'Public' : 'Private'} lobby &bull; code</div>
      <div class="title-row"><span class="code">${esc(L.code)}</span></div>
      <div class="lname">${esc(L.settings.name)}</div>
      <div class="meta">${esc(realm)} &bull; ${esc(L.settings.difficulty)} bots</div>
      <div class="invite"><button class="btn ghost small cc">Copy code</button><button class="btn ghost small cl">Copy invite link</button></div>
      ${host ? `<div class="host-settings">
        <span class="label">Bots</span><select class="select diff">${DIFFICULTIES.map((d) => `<option ${d === L.settings.difficulty ? 'selected' : ''}>${d}</option>`).join('')}</select>
        <span class="label">Realm</span><select class="select realm"><option value="random">Random</option>${Object.entries(REALMS).map(([k, r]) => `<option value="${k}" ${k === L.settings.realm ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
        <span class="label">Public</span><span><input type="checkbox" class="check pub" ${L.settings.public ? 'checked' : ''}> <button class="btn ghost small reroll" style="margin-left:10px">Shuffle bots</button></span>
      </div>` : ''}`;
    $('.cc', box).addEventListener('click', () => copyText(L.code).then(() => toast('Lobby code copied')));
    $('.cl', box).addEventListener('click', () => copyText(`${location.origin}/?join=${L.code}`).then(() => toast('Invite link copied — send it to your friends!')));
    if (host) {
      $('.diff', box).addEventListener('change', (e) => this.app.net.send({ t: 'settings', settings: { difficulty: e.target.value } }));
      $('.realm', box).addEventListener('change', (e) => this.app.net.send({ t: 'settings', settings: { realm: e.target.value } }));
      $('.pub', box).addEventListener('change', (e) => this.app.net.send({ t: 'settings', settings: { public: e.target.checked } }));
      $('.reroll', box).addEventListener('click', () => this.app.net.send({ t: 'settings', settings: { rerollBots: true } }));
    }
  }

  slotInfo() {
    const L = this.lobby;
    const byId = new Map(L.members.map((m) => [m.id, m]));
    const killer = L.slots.killer ? { human: byId.get(L.slots.killer), lo: byId.get(L.slots.killer).loadouts.killer } : { bot: L.bots.killer, lo: L.bots.killer };
    const survivors = L.slots.survivors.map((id, i) => (id ? { human: byId.get(id), lo: byId.get(id).loadouts.survivor } : { bot: L.bots.survivors[i], lo: L.bots.survivors[i] }));
    return { killer, survivors };
  }

  renderPlayers() {
    const L = this.lobby;
    const me = this.me;
    const amHost = me && L.hostId === me.id;
    const box = $('.players', this.el);
    const { killer, survivors } = this.slotInfo();
    const row = (s, role) => {
      const hm = s.human;
      const name = hm ? hm.name : role === 'killer' ? KILLERS[s.bot.character].name : `${SURVIVORS[s.bot.character].short}`;
      const tags = [];
      if (hm && hm.host) tags.push('<span class="tag host">HOST</span>');
      if (hm && me && hm.id === me.id) tags.push('<span class="tag you">YOU</span>');
      if (!hm) tags.push('<span class="tag">BOT</span>');
      const ready = hm ? (hm.ready ? STATUS_ICONS.check : STATUS_ICONS.waiting) : STATUS_ICONS.bot;
      const kick = amHost && hm && hm.id !== me.id ? `<button class="kick" data-id="${esc(hm.id)}" title="Kick">✕</button>` : '';
      return `<div class="prow ${role}"><span class="slot-ico">${role === 'killer' ? STATUS_ICONS.killer : STATUS_ICONS.survivor}</span><span class="pname">${esc(name)}</span>${tags.join('')}<span class="rd">${ready}</span>${kick}</div>`;
    };
    const waiting = L.members.filter((m) => m.role == null || (L.inMatch && m.waiting));
    box.innerHTML = `<div class="ph label">Players ${L.members.length}/5</div>${row(killer, 'killer')}${survivors.map((s) => row(s, 'survivor')).join('')}
      ${waiting.length ? `<div class="ph label" style="padding-top:10px">Waiting for next match</div>${waiting.map((m) => `<div class="prow"><span class="pname">${esc(m.name)}</span></div>`).join('')}` : ''}`;
    for (const b of box.querySelectorAll('.kick')) b.addEventListener('click', () => this.app.net.send({ t: 'kick', id: b.dataset.id }));
  }

  renderLoadout() {
    const box = $('.loadout', this.el);
    const role = this.role;
    const lo = profile.loadouts[role];
    const me = this.me;
    const L = this.lobby;
    const killerTaken = L.slots.killer && (!me || L.slots.killer !== me.id);
    const chars = role === 'killer' ? KILLERS : SURVIVORS;
    const takenChars = role === 'survivor' ? L.members.filter((m) => me && m.id !== me.id && m.role === 'survivor').map((m) => m.loadouts.survivor.character) : [];
    const c = chars[lo.character];
    const portraits = this.app.portraits || {};
    box.innerHTML = `
      <div class="role-tabs">
        <button class="role-tab ${role === 'survivor' ? 'on' : ''}" data-r="survivor">SURVIVOR</button>
        <button class="role-tab ${role === 'killer' ? 'on' : ''}" data-r="killer" ${killerTaken ? 'disabled title="Another player is the killer"' : ''}>KILLER${killerTaken ? ' (TAKEN)' : ''}</button>
      </div>
      <div class="chars">${Object.entries(chars).map(([id, ch]) => `
        <div class="char ${id === lo.character ? 'on' : ''} ${takenChars.includes(id) ? 'taken' : ''}" data-c="${id}" title="${esc(ch.name)}">
          ${portraits[id] ? `<img class="portrait" src="${portraits[id]}" alt="">` : ''}
          <span class="cn">${esc(role === 'killer' ? ch.name.replace('The ', '') : ch.short)}</span>
        </div>`).join('')}</div>
      <div class="lo-title"><span class="cname">${esc(c.name)}</span><span class="cdesc">${esc(role === 'killer' ? c.realName : c.bio)}</span></div>
      <div class="lo-row">
        <div class="perkslots">${[0, 1, 2, 3].map((i) => `<div class="pslot" data-i="${i}">${perkHTML(lo.perks[i], true)}</div>`).join('')}</div>
        ${role === 'survivor'
    ? `<div class="item-slot ${lo.item ? '' : 'empty'}" title="${lo.item ? esc(ITEMS[lo.item].name) : 'No item'}">${lo.item ? ITEM_ICONS[lo.item] : ''}</div>`
    : `<div class="power-desc"><b>${esc(c.powerName)}</b><br>${esc(c.powerDesc)}</div>`}
      </div>`;
    for (const b of box.querySelectorAll('.role-tab')) {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        audio.play('click');
        profile.role = b.dataset.r;
        saveProfile();
        this.closePicker();
        this.app.net.send({ t: 'role', role: b.dataset.r });
      });
    }
    for (const cd of box.querySelectorAll('.char')) {
      cd.addEventListener('mouseenter', () => audio.play('hover'));
      cd.addEventListener('click', () => {
        if (cd.classList.contains('taken')) { toast('Another player is using that survivor.'); return; }
        audio.play('click');
        lo.character = cd.dataset.c;
        this.saveLoadout(role);
      });
    }
    for (const ps of box.querySelectorAll('.pslot')) ps.addEventListener('click', () => { audio.play('click'); this.openPerkPicker(role, Number(ps.dataset.i)); });
    const it = $('.item-slot', box);
    if (it) it.addEventListener('click', () => { audio.play('click'); this.openItemPicker(); });
  }

  saveLoadout(role) {
    saveProfile();
    this.app.net.send({ t: 'loadout', role, loadout: profile.loadouts[role] });
    this.renderLoadout();
  }

  closePicker() {
    if (this.picker) this.picker.remove();
    this.picker = null;
  }

  openPerkPicker(role, slot) {
    this.closePicker();
    const lo = profile.loadouts[role];
    const ids = role === 'killer' ? KILLER_PERK_IDS : SURVIVOR_PERK_IDS;
    const p = (this.picker = h(`
      <div class="picker panel">
        <div class="row" style="justify-content:space-between"><h3>Choose a perk for slot ${slot + 1}</h3><button class="btn ghost small x">Close</button></div>
        <div class="perk-grid">${ids.map((id) => `<div class="perk-cell ${lo.perks.includes(id) ? 'on' : ''}" data-p="${id}">${perkHTML(id)}<div class="pn">${esc(PERKS[id].name)}</div></div>`).join('')}
          <div class="perk-cell" data-p=""><div class="perk empty"><div class="dia"></div></div><div class="pn">Empty</div></div></div>
        <div class="perk-info"><div class="t">${esc(PERKS[lo.perks[slot]]?.name || 'Hover a perk')}</div><div class="d">${esc(PERKS[lo.perks[slot]]?.desc || 'Each slot holds one perk. Equipped perks are highlighted.')}</div></div>
      </div>`));
    this.el.appendChild(p);
    $('.x', p).addEventListener('click', () => this.closePicker());
    for (const cell of p.querySelectorAll('.perk-cell')) {
      const id = cell.dataset.p;
      cell.addEventListener('mouseenter', () => {
        if (!id) return;
        $('.perk-info .t', p).textContent = PERKS[id].name;
        $('.perk-info .d', p).textContent = PERKS[id].desc;
      });
      cell.addEventListener('click', () => {
        audio.play('click');
        const perks = lo.perks.slice();
        while (perks.length < 4) perks.push(null);
        const existing = perks.indexOf(id);
        if (id && existing >= 0) perks[existing] = perks[slot];
        perks[slot] = id || null;
        lo.perks = perks.filter(Boolean);
        this.saveLoadout(role);
        this.closePicker();
      });
    }
  }

  openItemPicker() {
    this.closePicker();
    const lo = profile.loadouts.survivor;
    const p = (this.picker = h(`
      <div class="picker panel">
        <div class="row" style="justify-content:space-between"><h3>Bring an item</h3><button class="btn ghost small x">Close</button></div>
        <div class="items-grid">
          <div class="item-cell ${!lo.item ? 'on' : ''}" data-i="">${ITEM_ICONS.none}<div class="pn">No item</div></div>
          ${Object.entries(ITEMS).map(([id, it]) => `<div class="item-cell ${lo.item === id ? 'on' : ''}" data-i="${id}">${ITEM_ICONS[id]}<div class="pn">${esc(it.name)}<br><span style="font-size:11px">${esc(it.desc)}</span></div></div>`).join('')}
        </div>
      </div>`));
    this.el.appendChild(p);
    $('.x', p).addEventListener('click', () => this.closePicker());
    for (const c of p.querySelectorAll('.item-cell')) {
      c.addEventListener('click', () => {
        audio.play('click');
        lo.item = c.dataset.i || null;
        this.saveLoadout('survivor');
        this.closePicker();
      });
    }
  }

  renderReady() {
    const L = this.lobby;
    const me = this.me;
    const btn = $('.ready-btn', this.el);
    const cd = $('.countdown', this.el);
    const banner = $('.banner', this.el);
    if (L.inMatch) {
      btn.disabled = true;
      btn.innerHTML = 'IN MATCH';
      banner.classList.remove('hidden');
      banner.textContent = 'A match is in progress — you will join the next one';
    } else {
      banner.classList.add('hidden');
      btn.disabled = !me || me.role == null;
      btn.classList.toggle('on', !!(me && me.ready));
      const humans = L.members.filter((m) => m.role != null);
      const readyN = humans.filter((m) => m.ready).length;
      btn.innerHTML = me && me.ready ? `UNREADY<div class="sub">${readyN}/${humans.length} READY</div>` : `READY<div class="sub">${humans.length > 1 ? `${readyN}/${humans.length} READY` : 'BOTS FILL EMPTY SLOTS'}</div>`;
    }
    if (L.state === 'countdown' && L.countdown != null) {
      cd.classList.remove('hidden');
      this.countdownEnd = performance.now() + L.countdown * 1000;
      this.tickCountdown();
    } else {
      cd.classList.add('hidden');
      this.countdownEnd = null;
    }
  }

  tickCountdown() {
    if (!this.el || this.countdownEnd == null) return;
    const left = Math.max(0, Math.ceil((this.countdownEnd - performance.now()) / 1000));
    const cd = $('.countdown', this.el);
    const html = `<div class="cl">MATCH STARTING</div>${left}`;
    if (cd.dataset.left !== String(left)) {
      cd.dataset.left = String(left);
      cd.innerHTML = html;
      if (left > 0) audio.play('heartbeat', { vol: 0.5 });
    }
  }

  syncScene() {
    const L = this.lobby;
    const { killer, survivors } = this.slotInfo();
    const me = this.me;
    this.app.campfire.setCharacters(
      survivors.map((s) => ({ character: s.lo.character, ready: s.human ? s.human.ready : true, name: s.human ? s.human.name : SURVIVORS[s.bot.character].short, isBot: !s.human, me: s.human && me && s.human.id === me.id })),
      { character: killer.lo.character, name: killer.human ? killer.human.name : KILLERS[killer.bot.character].name, isBot: !killer.human, ready: killer.human ? killer.human.ready : true, me: killer.human && me && killer.human.id === me.id },
    );
    this.app.campfire.setView(this.role === 'killer' ? 'killer' : 'lobby');
    // name tags
    const tags = $('.nametags', this.el);
    tags.innerHTML = '';
    this.tags = [];
    const all = [...survivors, killer];
    all.forEach((s, i) => {
      const isK = i === 4;
      const name = s.human ? s.human.name : isK ? KILLERS[s.bot.character].name : SURVIVORS[s.bot.character].short;
      const sub = s.human ? (isK ? KILLERS[s.lo.character].name : SURVIVORS[s.lo.character].short) : 'BOT';
      const ready = s.human ? s.human.ready : true;
      const el = h(`<div class="nametag ${s.human && me && s.human.id === me.id ? 'me' : ''}"><div class="nt-name">${esc(name)}</div><div class="nt-sub">${esc(sub)}</div><div class="nt-ready">${ready ? STATUS_ICONS.check : STATUS_ICONS.waiting}</div></div>`);
      tags.appendChild(el);
      this.tags.push(el);
    });
  }

  frame() {
    if (!this.el) return;
    this.tickCountdown();
    const pos = this.app.campfire.tagPositions();
    this.tags.forEach((el, i) => {
      const p = pos[i];
      const killerView = this.role === 'killer';
      if (!p || !p.vis || (i === 4) !== killerView) { el.style.opacity = '0'; return; }
      el.style.opacity = '1';
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    });
  }
}
