// Inline SVG icons for perks, items, statuses and roles.

const S = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="#f3eee6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

const PERK_ICONS = {
  run: S('<circle cx="15" cy="4.5" r="2" fill="#f3eee6"/><path d="M13 8l-4 3 3 3-2 6M13 8l3 4h4M9 11l-4 1M12 14l4 2 1 5"/>'),
  bolt: S('<path d="M13 2L5 13h6l-1 9 8-12h-6z" fill="#f3eee6" stroke="none"/>'),
  vault: S('<path d="M3 20h18M7 20v-6h10v6"/><circle cx="8" cy="5" r="1.8" fill="#f3eee6"/><path d="M9 8l5 2 5-3M10 9l-3 4"/>'),
  shield: S('<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M8 12l3 3 5-6"/>'),
  cross: S('<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="#f3eee6" stroke="none"/>'),
  leaf: S('<path d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15z"/><path d="M5 19l9-9"/>'),
  mute: S('<path d="M4 9h4l5-4v14l-5-4H4z" fill="#f3eee6"/><path d="M16 9l5 6M21 9l-5 6"/>'),
  crouch: S('<circle cx="12" cy="5" r="2" fill="#f3eee6"/><path d="M12 8l-3 5 4 2-2 6M9 13l-4 1M13 15l5 0 1 5"/>'),
  eye: S('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3" fill="#f3eee6"/>'),
  gear: S('<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  alert: S('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>'),
  link: S('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>'),
  heart: S('<path d="M12 21s-8-5-8-11a4.5 4.5 0 018-3 4.5 4.5 0 018 3c0 6-8 11-8 11z" fill="#f3eee6" stroke="none"/>'),
  clock: S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
  hands: S('<path d="M4 14l4-4 3 3M20 14l-4-4-3 3M8 10l2-4M16 10l-2-4M6 16l6 5 6-5"/>'),
  foot: S('<path d="M8 21c-2 0-3-2-2-5l2-6c1-3 4-3 5 0l1 5c1 3-2 6-6 6z" fill="#f3eee6" stroke="none"/><circle cx="16" cy="5" r="1.4" fill="#f3eee6"/><circle cx="18.5" cy="8" r="1.2" fill="#f3eee6"/>'),
  wrench: S('<path d="M14.5 5.5a4 4 0 005 5L12 18a2.1 2.1 0 01-3-3l7.5-7.5a4 4 0 01-2-2z"/>'),
  fist: S('<path d="M6 10V7a2 2 0 014 0v1a2 2 0 014 0 2 2 0 014 0v6c0 4-3 7-7 7s-6-3-6-6v-2a2 2 0 012-2z" fill="#f3eee6" stroke="none"/>'),
  blade: S('<path d="M4 20L16 8l3-5 2 2-5 3L4 20z" fill="#f3eee6"/><path d="M6 15l3 3"/>'),
  card: S('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 8l3 4-3 4-3-4z" fill="#f3eee6"/>'),
  flame: S('<path d="M12 22c-4 0-7-3-7-7 0-5 5-6 5-12 3 2 5 5 5 8 1-1 2-2 2-4 2 2 2 5 2 8 0 4-3 7-7 7z" fill="#f3eee6" stroke="none"/>'),
  skull: S('<path d="M12 3c-5 0-8 3.5-8 8 0 3 1.5 5 3 6v3h10v-3c1.5-1 3-3 3-6 0-4.5-3-8-8-8z"/><circle cx="9" cy="11" r="1.8" fill="#f3eee6"/><circle cx="15" cy="11" r="1.8" fill="#f3eee6"/><path d="M11 16h2"/>'),
  skull2: S('<path d="M12 3c-5 0-8 3.5-8 8 0 3 1.5 5 3 6v3h10v-3c1.5-1 3-3 3-6 0-4.5-3-8-8-8z" fill="#f3eee6" stroke="none"/><circle cx="9" cy="11" r="1.8" fill="#222"/><circle cx="15" cy="11" r="1.8" fill="#222"/>'),
  pop: S('<circle cx="12" cy="12" r="4" fill="#f3eee6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/>'),
  blood: S('<path d="M12 3s-6 7-6 11a6 6 0 0012 0c0-4-6-11-6-11z" fill="#f3eee6" stroke="none"/>'),
  ear: S('<path d="M7 9a5 5 0 0110 0c0 3-3 4-3 7a3 3 0 01-6 0"/><path d="M10 9a2 2 0 014 0"/>'),
  block: S('<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>'),
};

export function perkIcon(name) { return PERK_ICONS[name] || PERK_ICONS.alert; }

export const ITEM_ICONS = {
  medkit: S('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M12 10v7M8.5 13.5h7"/>'),
  toolbox: S('<rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M8 9V6h8v3M3 13h18"/>'),
  flashlight: S('<path d="M4 9h9l4-3v12l-4-3H4z"/><path d="M19 9l2-1M19 12h3M19 15l2 1"/>'),
  none: S('<path d="M8 8l8 8M16 8l-8 8" stroke="#666"/>'),
};

export const STATUS_ICONS = {
  healthy: S('<circle cx="12" cy="7" r="3.2" fill="#f3eee6"/><path d="M6 21v-4a6 6 0 0112 0v4z" fill="#f3eee6" stroke="none"/>'),
  injured: S('<circle cx="12" cy="7" r="3.2" fill="#f3eee6"/><path d="M6 21v-4a6 6 0 0112 0v4z" fill="#f3eee6" stroke="none"/><path d="M14 13l-3 4 3 1-2 3" stroke="#d11" stroke-width="2.2"/>'),
  dying: S('<path d="M3 19h18" /><circle cx="6" cy="16" r="2.4" fill="#f3eee6"/><path d="M9 17h11v2H9z" fill="#f3eee6" stroke="none"/>'),
  hooked: S('<path d="M12 2v6a3 3 0 01-3 3 3 3 0 01-3-3" stroke-width="2.4"/><path d="M12 2h4" stroke-width="2.4"/><circle cx="11" cy="15" r="2.4" fill="#f3eee6"/><path d="M8 22v-2a3 3 0 016 0v2" fill="#f3eee6"/>'),
  carried: S('<circle cx="15" cy="6" r="2.5" fill="#f3eee6"/><path d="M12 10h8v4H4v-3z" fill="#f3eee6" stroke="none"/><path d="M8 14v7M14 14v7"/>'),
  dead: S('<path d="M12 3c-5 0-8 3.5-8 8 0 3 1.5 5 3 6v3h10v-3c1.5-1 3-3 3-6 0-4.5-3-8-8-8z" fill="#c00" stroke="none"/><circle cx="9" cy="11" r="1.8" fill="#000"/><circle cx="15" cy="11" r="1.8" fill="#000"/>'),
  escaped: S('<path d="M4 20V4h9v16" /><path d="M10 12h10M16 8l4 4-4 4" stroke="#7bd36b"/>'),
  trapped: S('<path d="M4 16a8 8 0 0116 0" stroke-width="2.2"/><path d="M6 16l1-3M9 16l.5-3M12 16v-3M15 16l-.5-3M18 16l-1-3"/>'),
  locker: S('<rect x="6" y="3" width="12" height="18"/><path d="M12 3v18M9 7h1M14 7h1"/>'),
  killer: S('<path d="M5 20L17 4M15 4l4-1-1 4" stroke-width="2.4"/><path d="M8 13l3 3"/>'),
  survivor: S('<circle cx="12" cy="7" r="3.2" fill="#f3eee6"/><path d="M6 21v-4a6 6 0 0112 0v4z" fill="#f3eee6" stroke="none"/>'),
  bot: S('<rect x="5" y="8" width="14" height="11" rx="2"/><circle cx="9.5" cy="13" r="1.4" fill="#f3eee6"/><circle cx="14.5" cy="13" r="1.4" fill="#f3eee6"/><path d="M12 4v4M10 4h4"/>'),
  check: S('<path d="M4 12l5 5L20 6" stroke="#7bd36b" stroke-width="3"/>'),
  waiting: S('<circle cx="12" cy="12" r="8" stroke="#666"/><path d="M12 7v5l3 2" stroke="#666"/>'),
  crown: S('<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z" fill="#d9b45b" stroke="none"/>'),
  gen: S('<rect x="3" y="9" width="18" height="11" rx="1"/><path d="M7 9V6h4v3M15 5l-2 4h3l-2 4" /><circle cx="8" cy="15" r="1.5" fill="#f3eee6"/>'),
  gate: S('<path d="M3 21V5h18v16M7 21V9M11 21V9M15 21V9M19 21V9"/>'),
  hatch: S('<rect x="4" y="9" width="16" height="9"/><path d="M4 9l3-4h10l3 4"/>'),
};
