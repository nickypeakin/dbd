// Integration test: connects to a running server as a scripted "human"
// player and exercises movement, generator repair with skill checks, and
// (as killer) attacking. Usage: node test/human-client.js [port] [role]

import WebSocket from 'ws';
import { NavGrid } from '../server/nav.js';
import { buildCollision, genBox } from '../shared/collision.js';
import { stepMove } from '../shared/motor.js';
import { survivorOptions, killerOptions } from '../shared/interact.js';

const PORT = Number(process.argv[2] || 3000);
const ROLE = process.argv[3] || 'survivor';
const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
const send = (m) => ws.send(JSON.stringify(m));
const log = (...a) => console.log(`[${ROLE}]`, ...a);
let info, col, nav, myId, latest = null, seq = 1;
const me = { x: 0, z: 0, rot: 0 };
const results = { moved: false, rejected: 0, skillChecks: 0, repairProgress: 0, hits: 0, swings: 0, events: {} };
let phase = 'walk';
let path = null, target = null, t = 0;

function S() {
  const s = latest;
  const pl = [...s.p].map((p) => {
    const inf = info.players.find((q) => q.id === p.i);
    return { id: p.i, role: inf.role, char: inf.char, perks: inf.perks, x: p.x, z: p.z, rot: p.r, health: inf.role === 'killer' ? 'healthy' : p.h, lk: p.lk || null, locker: p.lc ?? null, trap: p.tp ?? null, carriedBy: p.cb ?? null, carrying: p.cy ?? null, hookCount: p.hc || 0 };
  });
  return {
    players: pl,
    gens: info.map.gens.map((g, i) => ({ ...g, progress: s.g[i][0] / 90, done: !!s.g[i][1], blocked: !!s.g[i][2], regressing: !!s.g[i][3] })),
    pallets: info.map.pallets.map((p, i) => ({ ...p, state: { u: 'up', f: 'falling', d: 'down', b: 'broken' }[s.pl[i]] })),
    windows: info.map.windows.map((w) => ({ ...w })),
    hooks: info.map.hooks.map((h) => ({ ...h, occupant: null })), lockers: info.map.lockers, chests: info.map.chests.map((c) => ({ ...c })),
    totems: info.map.totems.map((x) => ({ ...x, state: 'dull' })), gates: info.map.gates.map((g) => ({ ...g })), hatch: { ...info.map.hatch, state: 'closed' },
    traps: [], gatesPowered: !!s.gp,
  };
}

function stepToward(tx, tz, dt) {
  const p = { id: myId, role: ROLE, health: 'healthy', perks: [], char: info.players.find((q) => q.id === myId).char, x: me.x, z: me.z, rot: me.rot, sm: 1 };
  const dx = tx - me.x, dz = tz - me.z, d = Math.hypot(dx, dz);
  if (d < 0.1) return true;
  stepMove(p, { mx: dx / d, mz: dz / d, sprint: true }, dt, col.world, []);
  me.x = p.x; me.z = p.z; me.rot = ROLE === 'killer' ? Math.atan2(dx, dz) : p.rot;
  return false;
}

ws.on('open', () => {
  send({ t: 'hello', name: 'Scripted ' + ROLE });
  send({ t: 'create', role: ROLE, settings: { difficulty: 'easy' } });
});

ws.on('message', (data) => {
  const m = JSON.parse(data.toString());
  if (m.t === 'welcome') myId = m.id;
  if (m.t === 'lobby' && m.lobby.state === 'lobby' && !m.lobby.members[0].ready) send({ t: 'ready', ready: true });
  if (m.t === 'match') {
    info = m.info;
    col = buildCollision(info.map);
    nav = new NavGrid(info.map, col.world);
    log('match on', info.map.name, 'players', info.players.map((p) => p.name).join(', '));
    send({ t: 'loaded' });
  }
  if (m.t === 'ev') for (const e of m.e) onEvent(e);
  if (m.t === 's') {
    latest = m;
    // keep dropped pallets in our collision world like the real client does
    info.map.pallets.forEach((pl, i) => col.setPalletDown(pl, m.pl[i] === 'd'));
    if (m.e) for (const e of m.e) onEvent(e);
    const p = m.p.find((q) => q.i === myId);
    if (p.sq !== seq) { if (seq !== 1 || p.sq !== 1) results.rejected++; seq = p.sq; me.x = p.x; me.z = p.z; }
    if (!t) { me.x = p.x; me.z = p.z; }
    tick(1 / 30, p);
  }
  if (m.t === 'results') {
    log('results received:', m.results.players.map((p) => `${p.name}=${p.result}`).join(', '));
    finish();
  }
});

function onEvent(e) {
  results.events[e.k] = (results.events[e.k] || 0) + 1;
  if (e.k === 'sc') {
    results.skillChecks++;
    setTimeout(() => send({ t: 'act', a: 'sc', id: e.id, r: 'great' }), (e.warn + e.rot * (e.start + 0.01)) * 1000);
  }
  if (e.k === 'hit' && ROLE === 'killer') results.hits++;
}

function tick(dt, p) {
  t += dt;
  if (ROLE === 'survivor') {
    if (phase === 'walk') {
      if (!target) {
        const g = info.map.gens.slice().sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
        const b = genBox(g);
        target = { gen: g, x: b.x + b.hw + 0.45, z: b.z };
        path = nav.findPath(me.x, me.z, target.x, target.z, { role: 'survivor' });
        log('walking to gen', g.id, 'path pts', path && path.length);
      }
      const wp = path && path[0];
      if (wp) {
        if (stepToward(wp.x, wp.z, dt)) path.shift();
        results.moved = true;
      } else {
        const opts = survivorOptions({ ...S().players.find((q) => q.id === myId), x: me.x, z: me.z }, S(), null);
        log('arrived; options', JSON.stringify(opts.m1));
        if (opts.m1 && opts.m1.kind === 'repair') { send({ t: 'act', a: 'm1', kind: 'repair', id: opts.m1.id }); phase = 'repair'; }
        else phase = 'done';
      }
    } else if (phase === 'repair') {
      if (p.hd) results.repairProgress = Math.max(results.repairProgress, p.hd.p);
      if (t > 60 || (p.h !== 'healthy' && p.h !== 'injured')) phase = 'done';
    }
  } else {
    // killer: chase the nearest survivor and swing
    const sv = latest.p.filter((q) => q.i !== myId && (q.h === 'healthy' || q.h === 'injured') && q.lc == null).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
    if (sv) {
      if (!path || t - (path.t || 0) > 0.5) { path = nav.findPath(me.x, me.z, sv.x, sv.z, { role: 'killer' }) || []; path.t = t; }
      const wp = path[0];
      if (!p.lk && wp && stepToward(wp.x, wp.z, dt)) path.shift();
      if (!p.lk && wp) results.moved = true;
      const d = Math.hypot(sv.x - me.x, sv.z - me.z);
      if (d < 2.4 && !this_atk.on && t - this_atk.last > 2.8) {
        me.rot = Math.atan2(sv.x - me.x, sv.z - me.z);
        send({ t: 'act', a: 'm1' });
        results.swings++;
        this_atk.on = true;
        this_atk.last = t;
        setTimeout(() => { send({ t: 'act', a: 'hit', id: sv.i }); this_atk.on = false; }, 150);
      }
      if (p.cy == null && results.hits > 0) {
        const opts = killerOptions({ ...S().players.find((q) => q.id === myId), x: me.x, z: me.z }, S(), null);
        if (opts.space && opts.space.kind === 'pickup') { send({ t: 'act', a: 'space', kind: 'pickup', id: opts.space.id }); log('picking up', opts.space.id); }
      }
    }
    if (t > 90) finish();
  }
  send({ t: 'in', seq, x: me.x, z: me.z, r: me.rot, pt: 0, sp: true, cr: false });
  if (phase === 'done' && ROLE === 'survivor') finish();
}
const this_atk = { on: false, last: -10 };

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  log('RESULTS', JSON.stringify(results));
  const ok = ROLE === 'survivor' ? results.moved && results.repairProgress > 0.05 && results.rejected <= 2 : results.swings > 0 && results.moved && results.rejected < 20;
  log(ok ? 'PASS' : 'FAIL');
  ws.close();
  process.exit(ok ? 0 : 1);
}
setTimeout(() => { log('timeout'); finish(); }, 150000);
