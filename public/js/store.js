// Player profile and settings persisted in localStorage (best effort).

import { defaultLoadout, sanitizeLoadout } from '/shared/data.js';

const KEY = 'dbd-fan-profile-v1';

const DEFAULTS = {
  name: '',
  loadouts: { survivor: defaultLoadout('survivor'), killer: defaultLoadout('killer') },
  role: 'survivor',
  settings: {
    master: 0.8, music: 0.6, sfx: 0.9,
    sensitivity: 1.0, invertY: false,
    quality: 'high', shadows: true, fov: 87,
    seenSplash: false,
  },
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const d = JSON.parse(raw);
    return {
      name: typeof d.name === 'string' ? d.name : '',
      role: d.role === 'killer' ? 'killer' : 'survivor',
      loadouts: {
        survivor: sanitizeLoadout('survivor', d.loadouts && d.loadouts.survivor),
        killer: sanitizeLoadout('killer', d.loadouts && d.loadouts.killer),
      },
      settings: { ...DEFAULTS.settings, ...(d.settings || {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const profile = load();

export function saveProfile() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* storage unavailable */ }
}
