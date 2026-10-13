// Settings modal: audio, controls and graphics.

import { h, ui, $ } from './dom.js';
import { profile, saveProfile } from '../store.js';
import { audio } from '../audio.js';
import { applyQuality } from '../gfx/renderer.js';

export function applyAudioSettings() {
  const s = profile.settings;
  audio.setVolumes(s.master, s.music, s.sfx);
}

export function openSettings(app, onClose) {
  const s = profile.settings;
  const back = h(`
    <div class="modal-back">
      <div class="modal panel">
        <h2>Settings</h2>
        <div class="setting"><span>Master volume</span><input type="range" class="slider" data-k="master" min="0" max="1" step="0.05" value="${s.master}"><span class="v"></span></div>
        <div class="setting"><span>Music volume</span><input type="range" class="slider" data-k="music" min="0" max="1" step="0.05" value="${s.music}"><span class="v"></span></div>
        <div class="setting"><span>Effects volume</span><input type="range" class="slider" data-k="sfx" min="0" max="1" step="0.05" value="${s.sfx}"><span class="v"></span></div>
        <div class="setting"><span>Mouse sensitivity</span><input type="range" class="slider" data-k="sensitivity" min="0.2" max="3" step="0.05" value="${s.sensitivity}"><span class="v"></span></div>
        <div class="setting"><span>Survivor field of view</span><input type="range" class="slider" data-k="fov" min="70" max="103" step="1" value="${s.fov}"><span class="v"></span></div>
        <div class="setting"><span>Invert mouse Y</span><span><input type="checkbox" class="check" data-k="invertY" ${s.invertY ? 'checked' : ''}></span><span></span></div>
        <div class="setting"><span>Graphics quality</span>
          <select class="select" data-k="quality">
            ${['low', 'medium', 'high'].map((q) => `<option value="${q}" ${s.quality === q ? 'selected' : ''}>${q[0].toUpperCase() + q.slice(1)}</option>`).join('')}
          </select><span></span></div>
        <div class="setting"><span>Shadows</span><span><input type="checkbox" class="check" data-k="shadows" ${s.shadows ? 'checked' : ''}></span><span></span></div>
        <div style="text-align:right;margin-top:18px"><button class="btn close">Done</button></div>
      </div>
    </div>`);
  ui().appendChild(back);
  const fmt = (k, v) => (k === 'fov' ? `${v}°` : k === 'sensitivity' ? Number(v).toFixed(2) : `${Math.round(v * 100)}%`);
  for (const inp of back.querySelectorAll('input, select')) {
    const k = inp.dataset.k;
    const label = inp.parentElement.querySelector('.v') || inp.closest('.setting').querySelector('.v');
    const upd = () => {
      if (inp.type === 'checkbox') s[k] = inp.checked;
      else if (inp.tagName === 'SELECT') s[k] = inp.value;
      else s[k] = Number(inp.value);
      if (label && inp.type === 'range') label.textContent = fmt(k, s[k]);
      applyAudioSettings();
      if (k === 'quality' || k === 'shadows') applyQuality();
      saveProfile();
    };
    if (inp.type === 'range' && label) label.textContent = fmt(k, s[k]);
    inp.addEventListener('input', upd);
    inp.addEventListener('change', upd);
  }
  const close = () => { back.remove(); if (onClose) onClose(); };
  $('.close', back).addEventListener('click', close);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  void app;
  return back;
}
