// Post-match scoreboard with bloodpoints per category.

import { h, ui, esc, $ } from './dom.js';
import { STATUS_ICONS } from './icons.js';
import { SURVIVORS, KILLERS, SURV_CATS_LABELS } from './labels.js';
import { audio } from '../audio.js';

export function showResults(app, results, myId, info, onContinue) {
  const mine = results.players.find((p) => p.id === myId);
  let title = 'TRIAL OVER';
  if (mine) {
    if (mine.role === 'killer') title = results.emblem;
    else if (mine.result === 'escaped') title = 'YOU ESCAPED';
    else if (mine.result === 'sacrificed') title = 'SACRIFICED';
    else if (mine.result === 'killed') title = 'KILLED';
  }
  const killerFirst = results.players.slice().sort((a, b) => (a.role === 'killer' ? 1 : 0) - (b.role === 'killer' ? 1 : 0));
  const rows = killerFirst.map((p) => {
    const portrait = app.portraits[p.char] || '';
    const ch = p.role === 'killer' ? KILLERS[p.char]?.name : SURVIVORS[p.char]?.name;
    const cats = Object.entries(p.score).map(([c, v]) => `<div class="cat">${esc(SURV_CATS_LABELS[c] || c)} ${v}<div class="bar"><div class="f" style="width:${Math.min(100, (v / 8000) * 100)}%"></div></div></div>`).join('');
    const st = p.role === 'killer' ? `${results.kills} KILL${results.kills === 1 ? '' : 'S'}` : p.result;
    return `<div class="rrow ${p.id === myId ? 'me' : ''}">
      <div class="rp" style="background-image:url('${portrait}')"></div>
      <div class="rn">${esc(p.name)}<small>${esc(ch || '')}${p.isBot ? ' &bull; BOT' : ''}</small></div>
      <div class="rs ${esc(p.result)}">${esc(st)}</div>
      <div class="cats">${cats}</div>
      <div class="bp">${p.total.toLocaleString()} BP</div>
    </div>`;
  }).join('');
  const el = h(`
    <div class="screen results">
      <h1>${esc(title)}</h1>
      <div class="sub">${esc(results.map)} &bull; ${Math.floor(results.duration / 60)}:${String(results.duration % 60).padStart(2, '0')}</div>
      <div class="table">${rows}</div>
      <div class="actions"><button class="btn cont">Continue</button></div>
    </div>`);
  ui().appendChild(el);
  audio.play(mine && (mine.result === 'escaped' || (mine.role === 'killer' && results.kills >= 3)) ? 'escape' : 'bigUi');
  $('.cont', el).addEventListener('click', () => { audio.play('click'); onContinue(); });
  void STATUS_ICONS; void info;
  return el;
}
