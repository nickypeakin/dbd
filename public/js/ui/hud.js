// In-match HUD: objectives, team status, perks, prompts, progress bars,
// skill checks, notifications, pause menu and scoreboard.

import * as THREE from 'three';
import { h, ui, esc, $ } from './dom.js';
import { perkIcon, ITEM_ICONS, STATUS_ICONS } from './icons.js';
import { PERKS, KILLERS, SURVIVORS } from '/shared/data.js';
import { GEN, HOOK, HEAL } from '/shared/constants.js';
import { audio } from '../audio.js';

const KEYNAME = { space: 'SPACE', m1: 'M1', m2: 'M2', e: 'E' };

function arcPath(a0, a1, r) {
  const p = (a) => [Math.sin(a * Math.PI * 2) * r, -Math.cos(a * Math.PI * 2) * r];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = a1 - a0 > 0.5 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export class HUD {
  constructor(game) {
    this.game = game;
    this.acc = 0;
    this.skill = null;
    this.vec = new THREE.Vector3();
  }

  mount() {
    const g = this.game;
    const el = (this.el = h(`
      <div class="hud">
        <div class="hud-hit"></div>
        <div class="hud-low"></div>
        <div class="hud-locker"></div>
        <div class="hud-flash"></div>
        <div class="hud-marks"></div>
        <div class="hud-gens"><span class="ico">${STATUS_ICONS.gen}</span><span class="num">5</span><div class="obj"></div></div>
        <div class="hud-egc hidden"><div class="bar"><div class="fill"></div></div><div class="lbl">ENDGAME COLLAPSE</div></div>
        <div class="hud-notes"></div>
        <div class="hud-score"></div>
        <div class="hud-team"></div>
        <div class="hud-status"></div>
        <div class="hud-power hidden"><div class="pn"></div><div class="pv"></div><div class="pbar"><div class="f"></div></div></div>
        <div class="hud-item hidden"><span class="ii"></span><div class="chg"><div class="f"></div></div></div>
        <div class="hud-perks">${[0, 1, 2, 3].map((i) => {
          const id = g.myInfo.perks[i];
          const p = PERKS[id];
          return p ? `<div class="perk r${p.rarity} p${i}" data-id="${id}"><div class="dia"></div>${perkIcon(p.icon)}<div class="cd"></div></div>` : `<div class="perk empty p${i}"><div class="dia"></div></div>`;
        }).join('')}</div>
        <div class="hud-prompts"></div>
        <div class="hud-progress hidden"><div class="lbl"></div><div class="bar"><div class="fill"></div></div></div>
        <div class="hud-wiggle hidden"><div class="lbl">WIGGLE</div><div class="keys"><span class="ka">A</span><span class="kd">D</span></div><div class="bar"><div class="f"></div></div></div>
        <div class="hud-skill hidden"><div class="res"></div><svg viewBox="-100 -100 200 200">
          <circle r="70" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="3"/>
          <path class="good" fill="none" stroke="#fff" stroke-width="12"/>
          <path class="great" fill="none" stroke="#fff" stroke-width="20"/>
          <line class="needle" x1="0" y1="0" x2="0" y2="-88" stroke="#e3221d" stroke-width="5" stroke-linecap="round"/>
        </svg><div class="key">SPACE</div></div>
        <div class="hud-cross ${g.role === 'killer' ? '' : 'hidden'}"></div>
        <div class="hud-big hidden"><div class="t1"></div><div class="t2"></div></div>
        <div class="hud-spec hidden"></div>
        <div class="hud-click hidden">CLICK TO CONTROL</div>
      </div>`));
    ui().appendChild(el);
    this.q = (s) => $(s, el);
    this.buildTeam();
    this.buildMarks();
  }

  dispose() {
    if (this.el) this.el.remove();
    if (this.pauseEl) this.pauseEl.remove();
    if (this.boardEl) this.boardEl.remove();
  }

  buildTeam() {
    const g = this.game;
    const box = this.q('.hud-team');
    box.innerHTML = '';
    this.teamRows = new Map();
    for (const p of g.info.players) {
      if (p.role !== 'survivor') continue;
      const portrait = g.app.portraits[p.char] || '';
      const row = h(`<div class="trow"><div class="tp"><div class="pf" style="background-image:url('${portrait}')"></div><div class="st"></div></div>
        <div class="tn">${esc(p.name)}<small>${esc(SURVIVORS[p.char]?.short || '')}</small></div>
        <div class="pips"><div class="pip"></div><div class="pip"></div></div><div class="tbar"><div class="f" style="width:0"></div></div></div>`);
      if (p.id === g.myId) row.classList.add('me');
      box.appendChild(row);
      this.teamRows.set(p.id, row);
    }
  }

  // floating labels over teammates / objects
  buildMarks() {
    this.marks = new Map();
  }

  mark(key, text, pos, color) {
    let m = this.marks.get(key);
    if (!m) {
      m = h('<div class="hud-mark"></div>');
      this.q('.hud-marks').appendChild(m);
      this.marks.set(key, m);
    }
    m.used = true;
    const v = this.vec.copy(pos).project(this.game.camera);
    if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) { m.style.display = 'none'; return; }
    m.style.display = '';
    m.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
    m.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    if (m.dataset.t !== text) { m.dataset.t = text; m.innerHTML = text; }
    m.style.color = color || '#fff';
  }

  endMarks() {
    for (const [k, m] of this.marks) {
      if (!m.used) { m.remove(); this.marks.delete(k); } else m.used = false;
    }
  }

  // ---------------------------------------------------------- messages --
  note(text, sub, red) {
    const n = h(`<div class="hud-note ${red ? 'red' : ''}">${esc(text)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`);
    this.q('.hud-notes').appendChild(n);
    setTimeout(() => n.remove(), 4300);
  }

  scorePop(label, pts) {
    const box = this.q('.hud-score');
    const n = h(`<div class="score-pop">${esc(label.toUpperCase())}<b>+${pts}</b></div>`);
    box.appendChild(n);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => n.remove(), 2700);
    audio.play('score');
  }

  big(t1, t2, ms = 3000) {
    const b = this.q('.hud-big');
    b.classList.remove('hidden');
    $('.t1', b).textContent = t1;
    $('.t2', b).textContent = t2 || '';
    clearTimeout(this.bigT);
    this.bigT = setTimeout(() => b.classList.add('hidden'), ms);
  }

  flash(kind, dur = 2.5) {
    if (kind === 'blind') {
      const f = this.q('.hud-flash');
      f.style.transition = 'opacity 0.08s';
      f.style.opacity = '0.95';
      setTimeout(() => { f.style.transition = `opacity ${dur}s`; f.style.opacity = '0'; }, 120);
    } else if (kind === 'hit') {
      const f = this.q('.hud-hit');
      f.style.transition = 'opacity 0.05s';
      f.style.opacity = '1';
      setTimeout(() => { f.style.transition = 'opacity 0.9s'; f.style.opacity = '0'; }, 120);
    }
  }

  ping(x, y, z) {
    const el = h('<div class="hud-ping"></div>');
    this.q('.hud-marks').appendChild(el);
    const pos = new THREE.Vector3(x, y, z);
    const upd = () => {
      if (!el.isConnected) return;
      const v = this.vec.copy(pos).project(this.game.camera);
      const behind = v.z > 1;
      let sx = (v.x * 0.5 + 0.5) * window.innerWidth, sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      if (behind) { sx = window.innerWidth - sx; sy = window.innerHeight - 40; }
      sx = Math.max(30, Math.min(window.innerWidth - 30, sx));
      sy = Math.max(30, Math.min(window.innerHeight - 30, sy));
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      requestAnimationFrame(upd);
    };
    upd();
    setTimeout(() => el.remove(), 3000);
  }

  // -------------------------------------------------------- skill check --
  startSkill(sc) {
    audio.play('skillWarn');
    this.skill = { ...sc, t0: performance.now() / 1000 + sc.warn, done: false };
    const svg = this.q('.hud-skill svg');
    $('.good', svg).setAttribute('d', arcPath(sc.start, sc.start + sc.good, 70));
    if (sc.great > 0) $('.great', svg).setAttribute('d', arcPath(sc.start, sc.start + sc.great, 70));
    else $('.great', svg).setAttribute('d', '');
    this.q('.hud-skill .res').textContent = '';
  }

  cancelSkill(id) {
    if (this.skill && (id == null || this.skill.id === id)) {
      this.skill = null;
      this.q('.hud-skill').classList.add('hidden');
    }
  }

  // returns true if a skill check consumed the key press
  skillPress() {
    const s = this.skill;
    if (!s || s.done) return false;
    const now = performance.now() / 1000;
    if (now < s.t0) return true; // too early: ignore but consume
    const f = (now - s.t0) / s.rot;
    let res = 'miss';
    if (f >= s.start && f <= s.start + s.great) res = 'great';
    else if (f >= s.start && f <= s.start + s.good) res = 'good';
    this.finishSkill(res);
    return true;
  }

  finishSkill(res) {
    const s = this.skill;
    if (!s || s.done) return;
    s.done = true;
    this.game.sendSkill(s.id, res);
    const r = this.q('.hud-skill .res');
    r.textContent = res === 'great' ? 'GREAT' : res === 'good' ? 'GOOD' : 'MISSED';
    r.style.color = res === 'miss' ? '#ff5a4a' : res === 'great' ? '#ffe58a' : '#fff';
    if (res === 'great') audio.play('skillGreat');
    else if (res === 'good') audio.play('skillGood');
    setTimeout(() => { if (this.skill === s) { this.skill = null; this.q('.hud-skill').classList.add('hidden'); } }, 450);
  }

  updateSkill() {
    const s = this.skill;
    const box = this.q('.hud-skill');
    if (!s) { box.classList.add('hidden'); return; }
    const now = performance.now() / 1000;
    if (now < s.t0) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (s.done) return;
    const f = (now - s.t0) / s.rot;
    if (f >= 1) { this.finishSkill('miss'); return; }
    this.q('.hud-skill .needle').setAttribute('transform', `rotate(${(f * 360).toFixed(1)})`);
  }

  // --------------------------------------------------------- per frame --
  update(dt) {
    this.updateSkill();
    this.updateProgress();
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    this.updateSlow();
  }

  updateProgress() {
    const g = this.game;
    const me = g.meSnap;
    const bar = this.q('.hud-progress');
    const wig = this.q('.hud-wiggle');
    let label = null, frac = 0, red = false;
    if (me) {
      if (me.hd) {
        const names = { repair: 'REPAIRING', heal: 'HEALING', selfcare: 'SELF-CARE', medkit: 'HEALING', recover: 'RECOVERING', gate: 'OPENING', cleanse: 'CLEANSING', chest: 'SEARCHING', freetrap: 'FREEING', disarm: 'DISARMING', escapetrap: 'ESCAPING TRAP', selfunhook: 'ATTEMPTING ESCAPE' };
        label = names[me.hd.k] || me.hd.k.toUpperCase();
        frac = me.hd.p;
      } else if (me.h === 'dying' && me.hp) {
        label = 'RECOVERY'; frac = me.hp; red = true;
      } else if (me.h === 'hooked') {
        label = me.hs === 2 ? 'STRUGGLE' : 'HOOKED';
        frac = (me.ht || 0) / HOOK.STAGE_TIME;
        red = true;
      } else if (me.lk && g.role === 'killer') {
        const names = { break: 'BREAKING', kick: 'DAMAGING', pickup: 'PICKING UP', hook: 'HOOKING', search: 'SEARCHING', settrap: 'SETTING TRAP', reload: 'RELOADING', closehatch: 'CLOSING HATCH' };
        if (names[me.lk]) { label = names[me.lk]; frac = me.lt || 0; }
      }
    }
    if (label) {
      bar.classList.remove('hidden');
      bar.classList.toggle('red', red);
      $('.lbl', bar).textContent = label;
      $('.fill', bar).style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    } else bar.classList.add('hidden');
    if (me && me.h === 'carried') {
      wig.classList.remove('hidden');
      $('.f', wig).style.width = `${(me.wg || 0) * 100}%`;
      $('.ka', wig).classList.toggle('on', g.input.keys.has('KeyA'));
      $('.kd', wig).classList.toggle('on', g.input.keys.has('KeyD'));
    } else wig.classList.add('hidden');
  }

  updateSlow() {
    const g = this.game;
    const S = g.S;
    const me = g.meSnap;
    // generators
    const left = Math.max(0, GEN.REQUIRED - (S.gensDone || 0));
    this.q('.hud-gens .num').textContent = S.gatesPowered ? '0' : String(left);
    let obj;
    if (g.role === 'killer') obj = S.gatesPowered ? 'STOP THEM ESCAPING' : 'SACRIFICE THE SURVIVORS';
    else if (S.hatch && S.hatch.state === 'open') obj = 'FIND THE HATCH';
    else if (S.gates.some((x) => x.open)) obj = 'ESCAPE!';
    else if (S.gatesPowered) obj = 'OPEN THE EXIT GATES';
    else obj = `REPAIR GENERATORS`;
    this.q('.hud-gens .obj').textContent = obj;
    // EGC
    const egc = this.q('.hud-egc');
    if (S.egc != null) {
      egc.classList.remove('hidden');
      $('.fill', egc).style.width = `${(S.egc / 120) * 100}%`;
    } else egc.classList.add('hidden');
    // team
    for (const [id, row] of this.teamRows) {
      const p = g.snapPlayer(id);
      if (!p) continue;
      let st = p.h;
      if (p.tp != null && (st === 'healthy' || st === 'injured')) st = 'trapped';
      row.querySelector('.st').innerHTML = STATUS_ICONS[st] || STATUS_ICONS.healthy;
      row.classList.toggle('hooked', p.h === 'hooked');
      row.classList.toggle('dead', p.h === 'dead' || p.h === 'escaped');
      row.classList.toggle('chase', !!p.ch);
      const pips = row.querySelectorAll('.pip');
      pips.forEach((pp, i) => pp.classList.toggle('on', (p.hc || 0) > i));
      let frac = 0;
      if (p.h === 'hooked') frac = (p.ht || 0) / HOOK.STAGE_TIME;
      else if (p.h === 'dying') frac = (p.bo ?? HEAL.BLEEDOUT) / HEAL.BLEEDOUT;
      row.querySelector('.tbar .f').style.width = `${frac * 100}%`;
      row.querySelector('.tbar').style.visibility = frac > 0 ? 'visible' : 'hidden';
    }
    // perks
    if (me) {
      for (const el of this.el.querySelectorAll('.hud-perks .perk[data-id]')) {
        const id = el.dataset.id;
        let off = false, lit = false, cd = '';
        if (['sprint_burst', 'lithe', 'dead_hard', 'adrenaline'].includes(id) && me.ex > 0) { off = true; cd = `${Math.ceil(me.ex)}s`; }
        if (id === 'spine_chill') lit = g.spineChill;
        if (id === 'whispers') lit = g.whispers;
        if (id === 'decisive_strike') lit = (me.fx || '').includes('S');
        if (id === 'borrowed_time' || id === 'we_make_it') lit = id === 'we_make_it' && (me.fx || '').includes('W');
        if (id === 'unbreakable') off = !!me.ub;
        if (id === 'pop') lit = !!me.pop;
        if (id === 'ruin') off = !S.totems.some((t) => t.state === 'hex');
        if (id === 'noed') lit = S.totems.some((t) => t.state === 'noed');
        el.classList.toggle('off', off);
        el.classList.toggle('lit', !!lit);
        el.querySelector('.cd').textContent = cd;
      }
      // statuses
      const pills = [];
      if (me.ex > 0) pills.push(['EXHAUSTED', 'bad']);
      const fx = me.fx || '';
      if (fx.includes('H')) pills.push(['HASTE', 'good']);
      if (fx.includes('E')) pills.push(['ENDURANCE', 'good']);
      if (fx.includes('M')) pills.push(['MANGLED', 'bad']);
      if (g.role === 'survivor' && S.totems.some((t) => t.state === 'noed') && (me.h === 'healthy' || me.h === 'injured')) pills.push(['EXPOSED', 'bad']);
      if (me.bl > 0) pills.push(['BLINDED', 'bad']);
      if (me.ch) pills.push(['CHASE', 'bad']);
      const html = pills.map(([t, c]) => `<span class="sfx-pill ${c}">${t}</span>`).join('');
      const sb = this.q('.hud-status');
      if (sb.dataset.h !== html) { sb.dataset.h = html; sb.innerHTML = html; }
      // item
      const it = this.q('.hud-item');
      if (me.it) {
        it.classList.remove('hidden');
        if (it.dataset.t !== me.it.t) { it.dataset.t = me.it.t; $('.ii', it).innerHTML = ITEM_ICONS[me.it.t]; }
        $('.chg .f', it).style.width = `${me.it.c * 100}%`;
      } else it.classList.add('hidden');
      // killer power
      const pw = this.q('.hud-power');
      if (g.role === 'killer') {
        pw.classList.remove('hidden');
        const k = KILLERS[g.myInfo.char];
        $('.pn', pw).textContent = k.powerName.toUpperCase();
        let v = '', f = null;
        if (g.myInfo.char === 'trapper') v = `${me.am ?? 0} / 2 TRAPS`;
        else if (g.myInfo.char === 'huntress') { v = `${me.am ?? 0} HATCHETS`; f = g.local.wind ? g.local.windPower() : null; }
        else if (g.myInfo.char === 'hillbilly') { v = g.local.saw.s === 'go' ? 'SPRINTING' : g.local.saw.s === 'rev' ? 'REVVING' : 'READY'; f = g.local.saw.s === 'rev' ? Math.min(1, g.local.saw.t / 2) : null; }
        else if (g.myInfo.char === 'wraith') v = me.pw === 'cloaked' ? 'CLOAKED' : me.pw === 'cloaking' ? 'CLOAKING...' : me.pw === 'uncloaking' ? 'UNCLOAKING...' : 'VISIBLE';
        $('.pv', pw).textContent = v;
        $('.pbar', pw).style.visibility = f == null ? 'hidden' : 'visible';
        if (f != null) $('.pbar .f', pw).style.width = `${f * 100}%`;
      }
    }
    // prompts
    const opts = g.currentOptions || {};
    const prompts = [];
    for (const key of ['m1', 'space', 'm2', 'e']) {
      const o = opts[key];
      if (o) prompts.push(`<div class="prompt"><span class="k">${KEYNAME[key]}</span>${esc(o.label)}</div>`);
    }
    if (g.role === 'killer' && me && !me.lk && me.cy == null && !g.local.atk.s) prompts.unshift('<div class="prompt"><span class="k">M1</span>ATTACK</div>');
    const html = prompts.join('');
    const pb = this.q('.hud-prompts');
    if (pb.dataset.h !== html) { pb.dataset.h = html; pb.innerHTML = html; }
    // locker overlay and low health tint
    this.q('.hud-locker').classList.toggle('on', !!(me && me.lc != null));
    this.q('.hud-low').style.opacity = me && (me.h === 'dying' || me.h === 'hooked') ? '1' : me && me.h === 'injured' ? '0.35' : '0';
    // spectating
    const spec = this.q('.hud-spec');
    if (g.spectating) {
      spec.classList.remove('hidden');
      const t = g.spectateTarget ? g.info.players.find((p) => p.id === g.spectateTarget) : null;
      spec.innerHTML = `SPECTATING ${esc(t ? t.name.toUpperCase() : '')}<small>Click to switch &bull; ESC for menu</small>`;
    } else spec.classList.add('hidden');
    this.q('.hud-click').classList.toggle('hidden', !!document.pointerLockElement || !!this.pauseEl || g.spectating || !g.started);
  }

  // ------------------------------------------------------------- menus --
  showPause(on) {
    if (on && !this.pauseEl) {
      const p = (this.pauseEl = h(`
        <div class="pause">
          <h2>PAUSED</h2>
          <button class="btn resume">Resume</button>
          <button class="btn ghost settings">Settings</button>
          <button class="btn ghost controls">Controls</button>
          <button class="btn ghost leave">Leave match</button>
          <div style="color:#888;margin-top:14px;font-family:var(--body);font-size:13px">The match keeps running while paused.</div>
        </div>`));
      ui().appendChild(p);
      $('.resume', p).addEventListener('click', () => this.game.resume());
      $('.settings', p).addEventListener('click', () => import('./settings.js').then((m) => m.openSettings(this.game.app)));
      $('.controls', p).addEventListener('click', () => import('./menu.js').then((m) => m.openHowTo()));
      $('.leave', p).addEventListener('click', () => this.game.app.leaveMatch());
    } else if (!on && this.pauseEl) {
      this.pauseEl.remove();
      this.pauseEl = null;
    }
  }

  showBoard(on) {
    if (on && !this.boardEl) {
      const g = this.game;
      const rows = g.info.players.map((p) => {
        const s = g.snapPlayer(p.id) || {};
        const st = p.role === 'killer' ? 'killer' : s.res || s.h || 'healthy';
        return `<div class="brow"><span>${p.role === 'killer' ? STATUS_ICONS.killer : STATUS_ICONS[s.h] || STATUS_ICONS.healthy}</span><span>${esc(p.name)}</span><span class="st">${esc(p.role === 'killer' ? KILLERS[p.char].name : SURVIVORS[p.char].short)}</span><span class="st">${esc(st)}</span></div>`;
      }).join('');
      this.boardEl = h(`<div class="board panel"><div class="label" style="margin-bottom:8px">${esc(g.map.name)} &mdash; ${esc(g.world.realm.name)}</div>${rows}</div>`);
      ui().appendChild(this.boardEl);
    } else if (!on && this.boardEl) {
      this.boardEl.remove();
      this.boardEl = null;
    }
  }
}
