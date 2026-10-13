// Runs full all-bot matches as fast as possible and prints a summary.
// Usage: node test/simulate.js [matches=3] [difficulty=normal]

import { Match } from '../server/match.js';
import { KILLERS, SURVIVORS, DEFAULT_SURVIVOR_PERKS, DEFAULT_KILLER_PERKS, SURVIVOR_PERK_IDS, KILLER_PERK_IDS } from '../shared/data.js';
import { TICK_RATE } from '../shared/constants.js';

const N = Number(process.argv[2] || 3);
const diff = process.argv[3] || 'normal';
const killers = Object.keys(KILLERS);
const realms = ['macmillan', 'coldwind', 'autohaven'];

function pick(arr, n) { return arr.slice().sort(() => Math.random() - 0.5).slice(0, n); }

let failures = 0;
const totals = { kills: 0, gens: 0, n: 0, dur: 0 };
for (let i = 0; i < N; i++) {
  const killer = killers[i % killers.length];
  const players = [
    { id: 'k', name: 'Killer', isBot: true, role: 'killer', loadout: { character: killer, perks: i % 2 ? pick(KILLER_PERK_IDS, 4) : DEFAULT_KILLER_PERKS } },
  ];
  const chars = Object.keys(SURVIVORS);
  for (let s = 0; s < 4; s++) {
    players.push({ id: 's' + s, name: chars[s], isBot: true, role: 'survivor', loadout: { character: chars[s], perks: i % 2 ? pick(SURVIVOR_PERK_IDS, 4) : DEFAULT_SURVIVOR_PERKS, item: ['toolbox', 'medkit', 'flashlight', null][s] } });
  }
  let results = null;
  const counts = {};
  const t0 = Date.now();
  const m = new Match({
    seed: 1000 + i * 77, realm: realms[i % 3], difficulty: diff, players,
    send: () => {},
    broadcast: (snap) => { if (snap.e) for (const e of snap.e) counts[e.k] = (counts[e.k] || 0) + 1; },
    onEnd: (r) => { results = r; },
  });
  m.start();
  const maxTicks = TICK_RATE * 60 * 30;
  let ticks = 0;
  let lastLog = 0;
  while (!results && ticks < maxTicks) {
    m.tick();
    ticks++;
    if (m.time - lastLog > 60) {
      lastLog = m.time;
      const st = m.survivors().map((p) => `${p.name}:${p.health}${p.hold ? '/' + p.hold.kind : ''}${p.brain && p.brain.task ? '[' + p.brain.task.kind + ']' : ''}`).join(' ');
      const k = m.killer;
      console.log(`  t=${Math.round(m.time)}s gens=${m.S.gensDone} killer@(${k.x.toFixed(0)},${k.z.toFixed(0)}) lk=${k.lk} carry=${k.carrying} | ${st}`);
    }
  }
  const ms = Date.now() - t0;
  if (!results) {
    failures++;
    console.log(`Match ${i} (${killer}, ${realms[i % 3]}) DID NOT FINISH in 30 game-minutes`);
  } else {
    console.log(`Match ${i} (${killer}, ${m.map.name}) finished in ${results.duration}s game time, gens ${m.S.gensDone}, kills ${results.kills} (${ms}ms real, ${(ms / ticks).toFixed(2)}ms/tick)`);
    totals.kills += results.kills; totals.gens += m.S.gensDone; totals.n++; totals.dur += results.duration;
    console.log('  ', results.players.map((p) => `${p.name}: ${p.result} ${p.total}bp`).join(' | '));
  }
  console.log('   events:', JSON.stringify(counts));
}
if (totals.n) console.log(`AVERAGE over ${totals.n}: kills ${(totals.kills / totals.n).toFixed(2)}, gens ${(totals.gens / totals.n).toFixed(2)}, duration ${(totals.dur / totals.n).toFixed(0)}s`);
process.exit(failures ? 1 : 0);
