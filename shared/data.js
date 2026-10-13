// Static game data shared by server and client: characters, killers, perks,
// items and realms.

export const SURVIVORS = {
  dwight: {
    name: 'Dwight Fairfield', short: 'Dwight',
    skin: '#e2b994', hair: '#3a2716', hairStyle: 'short', top: '#8c9aa6', topStyle: 'shirt',
    accent: '#7a1f1f', bottom: '#3a3530', shoes: '#2b2118', glasses: true, build: 1.0,
    bio: 'A nervous office worker who keeps a cool head when it matters.',
  },
  meg: {
    name: 'Meg Thomas', short: 'Meg',
    skin: '#ecc7a2', hair: '#b5481d', hairStyle: 'ponytail', top: '#3e74b8', topStyle: 'sport',
    accent: '#f2f2f2', bottom: '#26282e', shoes: '#d8d8d8', build: 0.95,
    bio: 'An athlete who never stops running.',
  },
  claudette: {
    name: 'Claudette Morel', short: 'Claudette',
    skin: '#6e4b33', hair: '#17110c', hairStyle: 'bob', top: '#5e7046', topStyle: 'shirt',
    accent: '#9b8a5a', bottom: '#4b3a2c', shoes: '#2a2018', glasses: true, build: 0.92,
    bio: 'A botanist with a gift for healing.',
  },
  jake: {
    name: 'Jake Park', short: 'Jake',
    skin: '#d8b28a', hair: '#141414', hairStyle: 'messy', top: '#5c4630', topStyle: 'jacket',
    accent: '#2c3a2a', bottom: '#3f4651', shoes: '#26211c', build: 1.0,
    bio: 'A loner who knows how to sabotage the Entity.',
  },
  nea: {
    name: 'Nea Karlsson', short: 'Nea',
    skin: '#f1d3b8', hair: '#e8e0c8', hairStyle: 'beanie', top: '#2c2c33', topStyle: 'hoodie',
    accent: '#c43d3d', bottom: '#1f2b47', shoes: '#ececec', build: 0.94,
    bio: 'A street artist who slips through the shadows.',
  },
  david: {
    name: 'David King', short: 'David',
    skin: '#e3b190', hair: '#5a3a22', hairStyle: 'short', top: '#9a9a96', topStyle: 'tank',
    accent: '#6a1f1f', bottom: '#2f3a52', shoes: '#1f1a16', build: 1.12,
    bio: 'A brawler who takes hits for his friends.',
  },
  ace: {
    name: 'Ace Visconti', short: 'Ace',
    skin: '#d9a77e', hair: '#222', hairStyle: 'slick', top: '#8e2b2b', topStyle: 'shirt',
    accent: '#d8c27a', bottom: '#2a2a2a', shoes: '#151515', hat: true, build: 1.0,
    bio: 'A gambler who always finds an ace in the hole.',
  },
  feng: {
    name: 'Feng Min', short: 'Feng',
    skin: '#f2d4b9', hair: '#141414', hairStyle: 'bob', top: '#c9c9d6', topStyle: 'hoodie',
    accent: '#d8669a', bottom: '#2a2a33', shoes: '#f0f0f0', build: 0.9,
    bio: 'A pro gamer with lightning reflexes.',
  },
};

export const KILLERS = {
  trapper: {
    name: 'The Trapper', realName: 'Evan MacMillan', speed: 4.6, terror: 32, height: 2.15,
    power: 'bear_trap', powerName: 'Bear Trap',
    powerDesc: 'Hold M2 to set a Bear Trap. Survivors caught are stuck until they escape or you pick them up. Pick up traps with SPACE.',
    color: '#5a4a3a',
  },
  wraith: {
    name: 'The Wraith', realName: 'Philip Ojomo', speed: 4.6, terror: 32, height: 2.05,
    power: 'wailing_bell', powerName: 'Wailing Bell',
    powerDesc: 'Press M2 to ring the bell and cloak: invisible, faster, no Terror Radius. Press M2 again to uncloak before attacking.',
    color: '#3a3a36',
  },
  hillbilly: {
    name: 'The Hillbilly', realName: 'Max Thompson Jr.', speed: 4.6, terror: 32, height: 2.1,
    power: 'chainsaw', powerName: 'Chainsaw',
    powerDesc: 'Hold M2 to rev the chainsaw, then sprint at great speed. A chainsaw hit puts any Survivor into the dying state. Hitting walls stuns you.',
    color: '#4a5a3a',
  },
  huntress: {
    name: 'The Huntress', realName: 'Anna', speed: 4.4, terror: 40, height: 2.2,
    power: 'hatchets', powerName: 'Hunting Hatchets',
    powerDesc: 'Hold M2 to wind up a hatchet, release to throw. Hatchets deal one health state. Reload 5 hatchets at any locker with SPACE.',
    color: '#6a4a3a',
  },
};

// Perk icons map to glyphs drawn on the client (see public/js/ui/icons.js).
export const PERKS = {
  // ---- Survivor ----
  sprint_burst: { role: 'survivor', name: 'Sprint Burst', icon: 'run', owner: 'meg', rarity: 3,
    desc: 'When you start running, break into a sprint at 150% speed for 3 seconds. Causes Exhaustion for 40 seconds.' },
  adrenaline: { role: 'survivor', name: 'Adrenaline', icon: 'bolt', owner: 'meg', rarity: 4,
    desc: 'When the Exit Gates are powered, instantly heal one health state and sprint at 150% for 5 seconds. Ignores Exhaustion.' },
  lithe: { role: 'survivor', name: 'Lithe', icon: 'vault', owner: 'feng', rarity: 3,
    desc: 'After performing a fast vault, sprint at 150% for 3 seconds. Causes Exhaustion for 40 seconds.' },
  dead_hard: { role: 'survivor', name: 'Dead Hard', icon: 'shield', owner: 'david', rarity: 3,
    desc: 'While injured and running, press E to dash forward and become invulnerable for 0.5 seconds. Causes Exhaustion for 40 seconds.' },
  self_care: { role: 'survivor', name: 'Self-Care', icon: 'cross', owner: 'claudette', rarity: 2,
    desc: 'Press E to heal yourself without a Med-Kit at 50% of the normal healing speed.' },
  botany: { role: 'survivor', name: 'Botany Knowledge', icon: 'leaf', owner: 'claudette', rarity: 2,
    desc: 'Increases your healing speed by 33%.' },
  iron_will: { role: 'survivor', name: 'Iron Will', icon: 'mute', owner: 'jake', rarity: 3,
    desc: 'Grunts of pain caused by injuries are completely silenced.' },
  urban_evasion: { role: 'survivor', name: 'Urban Evasion', icon: 'crouch', owner: 'nea', rarity: 2,
    desc: 'Increases your movement speed while crouching by 90%.' },
  bond: { role: 'survivor', name: 'Bond', icon: 'eye', owner: 'dwight', rarity: 2,
    desc: 'See the auras of your allies within 36 metres.' },
  prove_thyself: { role: 'survivor', name: 'Prove Thyself', icon: 'gear', owner: 'dwight', rarity: 2,
    desc: 'Increases repair speed by 15% for each other Survivor repairing the same generator.' },
  spine_chill: { role: 'survivor', name: 'Spine Chill', icon: 'alert', owner: 'any', rarity: 2,
    desc: 'An icon lights up when the Killer is within 36 metres and looking in your direction.' },
  kindred: { role: 'survivor', name: 'Kindred', icon: 'link', owner: 'any', rarity: 2,
    desc: 'While you are hooked, all Survivors see each other\'s auras.' },
  resilience: { role: 'survivor', name: 'Resilience', icon: 'heart', owner: 'any', rarity: 2,
    desc: 'While injured, repair, heal, cleanse, open and vault 9% faster.' },
  borrowed_time: { role: 'survivor', name: 'Borrowed Time', icon: 'clock', owner: 'bill', rarity: 4,
    desc: 'Survivors you unhook gain the Endurance status effect for 15 seconds.' },
  we_make_it: { role: 'survivor', name: 'We\'ll Make It', icon: 'hands', owner: 'any', rarity: 2,
    desc: 'After unhooking a Survivor, you heal others 100% faster for 90 seconds.' },
  quick_quiet: { role: 'survivor', name: 'Quick & Quiet', icon: 'foot', owner: 'meg', rarity: 3,
    desc: 'Fast vaults and rushed locker entries do not trigger loud noise notifications.' },
  technician: { role: 'survivor', name: 'Technician', icon: 'wrench', owner: 'feng', rarity: 2,
    desc: 'Failed repair skill checks do not cause a generator explosion or alert the Killer.' },
  unbreakable: { role: 'survivor', name: 'Unbreakable', icon: 'fist', owner: 'bill', rarity: 3,
    desc: 'Once per match, you can fully recover from the dying state by yourself.' },
  decisive_strike: { role: 'survivor', name: 'Decisive Strike', icon: 'blade', owner: 'laurie', rarity: 4,
    desc: 'Within 60 seconds of being unhooked, if you are picked up, succeed a skill check to stab the Killer and escape.' },
  ace_in_hole: { role: 'survivor', name: 'Ace in the Hole', icon: 'card', owner: 'ace', rarity: 2,
    desc: 'Chests always reward you with a fully-charged item.' },

  // ---- Killer ----
  bbq: { role: 'killer', name: 'Barbecue & Chili', icon: 'flame', owner: 'cannibal', rarity: 4,
    desc: 'After hooking a Survivor, see the auras of all Survivors farther than 40 metres from the hook for 4 seconds.' },
  ruin: { role: 'killer', name: 'Hex: Ruin', icon: 'skull', owner: 'hag', rarity: 4,
    desc: 'Generators not being repaired automatically regress. The Hex lasts until its totem is cleansed.' },
  pop: { role: 'killer', name: 'Pop Goes the Weasel', icon: 'pop', owner: 'clown', rarity: 3,
    desc: 'After hooking a Survivor, the next generator you damage within 45 seconds instantly loses 25% progress.' },
  brutal_strength: { role: 'killer', name: 'Brutal Strength', icon: 'fist', owner: 'trapper', rarity: 2,
    desc: 'Break pallets and damage generators 20% faster.' },
  bamboozle: { role: 'killer', name: 'Bamboozle', icon: 'vault', owner: 'clown', rarity: 3,
    desc: 'Vault windows 15% faster. Vaulting a window blocks it for Survivors for 16 seconds.' },
  sloppy_butcher: { role: 'killer', name: 'Sloppy Butcher', icon: 'blood', owner: 'any', rarity: 2,
    desc: 'Basic attacks inflict Mangled: injured Survivors heal 25% slower and bleed more.' },
  enduring: { role: 'killer', name: 'Enduring', icon: 'shield', owner: 'hillbilly', rarity: 2,
    desc: 'Pallet stun durations are reduced by 50%.' },
  nurses_calling: { role: 'killer', name: 'A Nurse\'s Calling', icon: 'cross', owner: 'nurse', rarity: 3,
    desc: 'See the auras of Survivors who are healing within 28 metres.' },
  whispers: { role: 'killer', name: 'Whispers', icon: 'ear', owner: 'any', rarity: 2,
    desc: 'The perk lights up when a Survivor is within 32 metres of you.' },
  corrupt: { role: 'killer', name: 'Corrupt Intervention', icon: 'block', owner: 'plague', rarity: 3,
    desc: 'At the start of the match, the 3 generators farthest from you are blocked for 120 seconds or until a Survivor goes down.' },
  noed: { role: 'killer', name: 'Hex: No One Escapes Death', icon: 'skull2', owner: 'any', rarity: 4,
    desc: 'When the Exit Gates are powered, a dull totem becomes a Hex Totem: Survivors are Exposed and you gain 4% speed until it is cleansed.' },
  bitter_murmur: { role: 'killer', name: 'Bitter Murmur', icon: 'eye', owner: 'any', rarity: 2,
    desc: 'When a generator is completed, see Survivors within 16 metres of it for 5 seconds. When the last is completed, see all Survivors for 10 seconds.' },
  discordance: { role: 'killer', name: 'Discordance', icon: 'gear', owner: 'legion', rarity: 2,
    desc: 'Generators being repaired by 2 or more Survivors are highlighted in yellow.' },
  agitation: { role: 'killer', name: 'Agitation', icon: 'run', owner: 'trapper', rarity: 2,
    desc: 'Move 18% faster while carrying a Survivor.' },
  iron_grasp: { role: 'killer', name: 'Iron Grasp', icon: 'hands', owner: 'trapper', rarity: 2,
    desc: 'Survivors take 75% longer to wiggle free and their wiggling barely sways you.' },
  unrelenting: { role: 'killer', name: 'Unrelenting', icon: 'blade', owner: 'trapper', rarity: 2,
    desc: 'Reduces the cooldown of missed attacks by 30%.' },
};

export const ITEMS = {
  medkit: { name: 'First Aid Kit', charges: 24, desc: 'Hold M2 to heal yourself. Consumes charges.' },
  toolbox: { name: 'Toolbox', charges: 32, desc: 'Repair generators 50% faster while you have charges.' },
  flashlight: { name: 'Flashlight', charges: 12, desc: 'Hold M2 to shine. Blind the Killer by aiming at their face; frees carried Survivors.' },
};

export const SURVIVOR_PERK_IDS = Object.keys(PERKS).filter((k) => PERKS[k].role === 'survivor');
export const KILLER_PERK_IDS = Object.keys(PERKS).filter((k) => PERKS[k].role === 'killer');

export const DEFAULT_SURVIVOR_PERKS = ['sprint_burst', 'self_care', 'bond', 'borrowed_time'];
export const DEFAULT_KILLER_PERKS = ['bbq', 'ruin', 'pop', 'brutal_strength'];

export const REALMS = {
  macmillan: {
    name: 'The MacMillan Estate',
    maps: ['Coal Tower', 'Groaning Storehouse', 'Ironworks of Misery', 'Suffocation Pit'],
    wall: 'stone', house: 'brick', boundary: 'rockwall', tree: 'dead',
    ground: '#4d4c3b', ground2: '#37382c', fog: '#283240', fogDensity: 0.03,
    skyTop: '#070a12', skyHorizon: '#36424f', moon: '#d8e2ff', moonIntensity: 1.0, hemiSky: '#8296bb', hemiGround: '#2c261c',
    tiles: { jg: 6, longwall: 4, tl: 4, rockpallet: 5, filler: 8, open: 4 },
  },
  coldwind: {
    name: 'Coldwind Farm',
    maps: ['Rotten Fields', 'Fractured Cowshed', 'Thompson House', 'Torment Creek'],
    wall: 'wood', house: 'woodhouse', boundary: 'corn', tree: 'dead',
    ground: '#5b5438', ground2: '#463f2b', fog: '#39372a', fogDensity: 0.029,
    skyTop: '#0b0a0c', skyHorizon: '#4a4230', moon: '#ffe8c0', moonIntensity: 0.95, hemiSky: '#a09a78', hemiGround: '#33291a',
    tiles: { jg: 6, longwall: 3, tl: 3, rockpallet: 4, corn: 7, filler: 5, open: 3 },
  },
  autohaven: {
    name: 'Autohaven Wreckers',
    maps: ['Wreckers\' Yard', 'Gas Heaven', 'Blood Lodge', 'Azarov\'s Resting Place'],
    wall: 'corrugated', house: 'woodhouse', boundary: 'fence', tree: 'dead',
    ground: '#504333', ground2: '#3b3226', fog: '#3a2a20', fogDensity: 0.03,
    skyTop: '#0d0806', skyHorizon: '#4c3222', moon: '#ffcfa0', moonIntensity: 1.0, hemiSky: '#a2806a', hemiGround: '#2e2014',
    tiles: { jg: 5, carloop: 6, longwall: 3, tl: 3, rockpallet: 3, filler: 7, open: 4 },
  },
};

export const BOT_NAMES = {
  survivor: ['Dwight', 'Meg', 'Claudette', 'Jake', 'Nea', 'David', 'Ace', 'Feng'],
};

export const DIFFICULTIES = ['easy', 'normal', 'hard'];

export function defaultLoadout(role) {
  if (role === 'killer') return { character: 'trapper', perks: DEFAULT_KILLER_PERKS.slice(), item: null };
  return { character: 'dwight', perks: DEFAULT_SURVIVOR_PERKS.slice(), item: 'toolbox' };
}

export function sanitizeLoadout(role, lo) {
  const out = defaultLoadout(role);
  if (!lo || typeof lo !== 'object') return out;
  const chars = role === 'killer' ? KILLERS : SURVIVORS;
  if (typeof lo.character === 'string' && chars[lo.character]) out.character = lo.character;
  if (Array.isArray(lo.perks)) {
    const ids = role === 'killer' ? KILLER_PERK_IDS : SURVIVOR_PERK_IDS;
    const perks = [];
    for (const p of lo.perks) {
      if (ids.includes(p) && !perks.includes(p) && perks.length < 4) perks.push(p);
    }
    out.perks = perks;
  }
  if (role === 'survivor') {
    out.item = lo.item && ITEMS[lo.item] ? lo.item : null;
  } else out.item = null;
  return out;
}
