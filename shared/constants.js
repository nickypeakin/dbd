// Gameplay tuning. Units are metres and seconds. Values follow Dead by Daylight
// as closely as practical.

export const TICK_RATE = 30;
export const MAP_HALF = 46;

export const SURV = {
  RADIUS: 0.32,
  WALK: 2.26,
  RUN: 4.0,
  CROUCH: 1.13,
  CRAWL: 0.7,
  EYE: 1.5,
  EYE_CROUCH: 0.9,
  HIT_BOOST_MUL: 1.5,
  HIT_BOOST_TIME: 1.8,
};

export const KILL = {
  RADIUS: 0.45,
  EYE: 2.0,
  CARRY_SPEED: 3.68,
  LUNGE_MUL: 1.45,
  LUNGE_MIN: 0.12,
  LUNGE_MAX: 0.6,
  ATTACK_RANGE: 1.9,
  ATTACK_ANGLE: 0.8, // radians either side of facing
  HIT_COOLDOWN: 2.7,
  MISS_COOLDOWN: 1.5,
  COOLDOWN_SPEED_MUL: 0.5,
};

export const GEN = {
  CHARGES: 90,
  TOTAL: 7,
  REQUIRED: 5,
  COOP: [0, 1, 0.85, 0.7, 0.55], // efficiency per repairer when N repair together
  REGRESS: 0.25, // charges per second while regressing
  KICK_TIME: 1.8,
  KICK_LOSS: 0.025, // fraction of a full generator removed instantly on kick
  SKILL_MISS_LOSS: 0.1,
  GREAT_BONUS: 0.01,
};

export const HEAL = {
  CHARGES: 16,
  SELF_CARE_RATE: 0.5,
  RECOVER_RATE: 0.25,
  RECOVER_MAX: 0.95,
  BLEEDOUT: 240,
  COOP: [0, 1, 0.85, 0.7, 0.55],
  MISS_LOSS: 0.1,
};

export const HOOK = {
  STAGE_TIME: 60,
  UNHOOK_TIME: 1.0,
  SELF_UNHOOK_CHANCE: 0.04,
  SELF_UNHOOK_ATTEMPTS: 3,
  SELF_UNHOOK_TIME: 1.0,
  PICKUP_TIME: 1.4,
  HOOK_TIME: 1.2,
  WIGGLE_TIME: 16,
  WIGGLE_STUN: 3,
  STRUGGLE_MISS: 10,
};

export const TIMES = {
  GATE: 20,
  EGC: 120,
  CLEANSE: 14,
  CHEST: 10,
  VAULT_FAST: 0.5,
  VAULT_MED: 0.9,
  VAULT_SLOW: 1.5,
  KILLER_VAULT: 1.7,
  PALLET_DROP: 0.35,
  PALLET_STUN: 2.0,
  PALLET_BREAK: 2.6,
  LOCKER_ENTER: 0.9,
  LOCKER_RUSH: 0.45,
  LOCKER_EXIT: 0.8,
  LOCKER_SEARCH: 1.4,
  HATCH_JUMP: 0.8,
  HATCH_CLOSE: 1.5,
  EXHAUSTION: 40,
  FREE_TRAP: 2.0,
  ESCAPE_TRAP_ATTEMPT: 1.0,
  DISARM_TRAP: 2.5,
  SET_TRAP: 2.5,
  RELOAD: 4.0,
  STUN_BUMP: 2.5,
  BLIND: 2.5,
};

export const SKILL = {
  CHANCE_PER_SEC: 0.08,
  WARN: 0.6, // delay between warning sound and the check appearing
  ROTATION: 1.1, // seconds for the needle to sweep a full circle
  GOOD: 0.13, // fraction of the circle
  GREAT: 0.035,
};

export const TERROR_RADIUS = 32;

// Bloodpoint categories
export const SURV_CATS = ['objectives', 'survival', 'altruism', 'boldness'];
export const KILLER_CATS = ['brutality', 'deviousness', 'hunter', 'sacrifice'];
export const CAT_CAP = 8000;

// Interaction ranges
export const RANGE = {
  GEN: 0.75,
  HEAL: 1.4,
  UNHOOK: 1.6,
  GATE: 1.3,
  TOTEM: 1.3,
  CHEST: 0.8,
  VAULT_PERP: 1.15,
  VAULT_LAT: 0.75,
  PALLET_PERP: 1.05,
  PALLET_LAT: 1.0,
  LOCKER: 0.95,
  HATCH: 1.3,
  PICKUP: 1.8,
  HOOK: 2.0,
  BREAK_PERP: 1.45,
  KICK: 0.95,
  K_VAULT_PERP: 1.35,
  SEARCH: 1.25,
  TRAP: 1.3,
};
