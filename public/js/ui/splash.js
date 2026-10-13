// Fake Unity WebGL loader + "Made with Unity" splash, a disclaimer card,
// and the "press any key" title screen.

import { h, ui } from './dom.js';

export const UNITY_CUBE = `
<svg viewBox="0 0 100 100" width="SIZE" height="SIZE" aria-label="Unity">
  <g fill="#fff">
    <polygon points="50,6 88,28 50,50 12,28"/>
    <polygon points="10,33 47,54 47,96 10,74"/>
    <polygon points="90,33 53,54 53,96 90,74"/>
  </g>
  <g fill="CUT">
    <polygon points="50,20 66,29 50,38 34,29"/>
    <polygon points="22,46 36,54 36,72 22,64"/>
    <polygon points="78,46 64,54 64,72 78,64"/>
  </g>
</svg>`;

function cube(size, cut) {
  return UNITY_CUBE.replaceAll('SIZE', size).replaceAll('CUT', cut);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runSplash(prepare) {
  const root = ui();
  // 1. Unity WebGL loader
  const loader = h(`
    <div class="screen unity">
      <div class="unity-loader-logo">${cube(64, '#000')}<span class="wordmark">unity</span></div>
      <div class="unity-bar"><div class="fill"></div></div>
    </div>`);
  root.appendChild(loader);
  const fill = loader.querySelector('.fill');
  let shown = 0;
  await prepare((p) => {
    shown = Math.max(shown, p);
    fill.style.width = `${Math.round(shown * 100)}%`;
  });
  fill.style.width = '100%';
  await wait(350);
  loader.remove();

  // 2. Made with Unity
  let skip = false;
  const onSkip = () => { skip = true; };
  window.addEventListener('keydown', onSkip);
  window.addEventListener('mousedown', onSkip);
  const made = h(`
    <div class="screen unity made">
      <div class="unity-made-wrap">
        <div class="made">Made with</div>
        <div class="row">${cube(86, '#232323')}<span class="wordmark">unity</span></div>
      </div>
    </div>`);
  root.appendChild(made);
  const wrap = made.querySelector('.unity-made-wrap');
  await wait(250);
  wrap.classList.add('show');
  for (let i = 0; i < 22 && !skip; i++) await wait(100);
  wrap.classList.remove('show');
  await wait(skip ? 150 : 700);
  made.remove();

  // 3. Disclaimer
  skip = false;
  const disc = h(`
    <div class="screen disclaimer">
      <div class="box">
        <h2>A FAN-MADE TRIBUTE</h2>
        <p>This is an unofficial, non-commercial fan recreation inspired by <i>Dead by Daylight</i>.
        It is not affiliated with, endorsed by, or connected to Behaviour Interactive.</p>
        <p>This game contains horror themes, violence and flashing lights.</p>
      </div>
    </div>`);
  root.appendChild(disc);
  await wait(60);
  disc.classList.add('show');
  for (let i = 0; i < 26 && !skip; i++) await wait(100);
  disc.classList.remove('show');
  await wait(skip ? 150 : 800);
  disc.remove();
  window.removeEventListener('keydown', onSkip);
  window.removeEventListener('mousedown', onSkip);
}

export function logoHTML() {
  return `<div class="logo"><span class="dead">Dead</span><span class="by">by</span><span class="day">Daylight</span></div>`;
}

export function showTitle() {
  return new Promise((resolve) => {
    const el = h(`
      <div class="screen title">
        ${logoHTML()}
        <div class="slash"></div>
        <div class="press">PRESS ANY KEY TO CONTINUE</div>
        <div class="sub">Fan remake &bull; play with friends or bots</div>
        <div class="foot">Unofficial fan project &mdash; not affiliated with Behaviour Interactive</div>
      </div>`);
    ui().appendChild(el);
    const go = (e) => {
      if (e && e.type === 'keydown' && (e.key === 'F12' || e.metaKey)) return;
      window.removeEventListener('keydown', go);
      el.removeEventListener('mousedown', go);
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => { el.remove(); resolve(); }, 450);
    };
    setTimeout(() => {
      window.addEventListener('keydown', go);
      el.addEventListener('mousedown', go);
    }, 300);
  });
}
