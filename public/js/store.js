// Player profile and settings persisted in localStorage (best effort).

import { defaultLoadout, sanitizeLoadout } from '../shared/data.js';

const KEY = 'dbd-fan-profile-v1';

const DEFAULTS = {
  name: '',
  loadouts: { survivor: defaultLoadout('survivor'), killer: defaultLoadout('killer') },
  role: 'survivor',
  settings: {
    master: 0.8, music: 0.6, sfx: 0.9,
    sensitivity: 1.0, invertY: false,
    quality: 'auto', shadows: true, fov: 87, showFps: true,
    seenSplash: false,
  },
  settingsVersion: 2,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const d = JSON.parse(raw);
    const out = {
      name: typeof d.name === 'string' ? d.name : '',
      role: d.role === 'killer' ? 'killer' : 'survivor',
      loadouts: {
        survivor: sanitizeLoadout('survivor', d.loadouts && d.loadouts.survivor),
        killer: sanitizeLoadout('killer', d.loadouts && d.loadouts.killer),
      },
      settings: { ...DEFAULTS.settings, ...(d.settings || {}) },
      settingsVersion: DEFAULTS.settingsVersion,
    };
    // version 2 added Auto quality as the new default: move saves that were
    // still on the old default over to it
    if (!(d.settingsVersion >= 2) && out.settings.quality === 'high') out.settings.quality = 'auto';
    return out;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const profile = load();

export function saveProfile() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* storage unavailable */ }
}
