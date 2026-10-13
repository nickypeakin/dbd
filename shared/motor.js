// Character movement shared by the client (own player prediction) and the
// server (bots). Speeds depend on role, health, effects and killer power state.

import { SURV, KILL } from './constants.js';
import { KILLERS } from './data.js';
import { angDiff } from './interact.js';

export const POWER_SPEED = {
  cloaking: 0.55,
  uncloaking: 0.55,
  cloaked: 6.0 / 4.6,
  rev: 0.6,
  wind: 0.7,
};
export const SAW_SPEED = 9.2;

export function survivorSpeed(p, sprint, crouch) {
  if (p.health === 'dying') return SURV.CRAWL;
  let base;
  if (crouch) base = SURV.CROUCH * (p.perks && p.perks.includes('urban_evasion') ? 1.9 : 1);
  else if (sprint) base = SURV.RUN;
  else base = SURV.WALK;
  return base * (p.sm || 1);
}

export function killerSpeed(p) {
  const def = KILLERS[p.char] || KILLERS.trapper;
  if (p.pw === 'saw') return SAW_SPEED;
  let s = def.speed;
  if (p.carrying != null) s = KILL.CARRY_SPEED * (p.perks && p.perks.includes('agitation') ? 1.18 : 1);
  if (p.atk === 'lunge') s *= KILL.LUNGE_MUL;
  else if (p.atk === 'cd') s *= KILL.COOLDOWN_SPEED_MUL;
  if (p.pw && POWER_SPEED[p.pw]) s *= POWER_SPEED[p.pw];
  return s * (p.sm || 1);
}

export function radiusOf(p) { return p.role === 'killer' ? KILL.RADIUS : SURV.RADIUS; }

export function turnToward(cur, target, maxStep) {
  const d = angDiff(cur, target);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

// Circles of other players that block movement.
export function playerBlockers(players, self) {
  const out = [];
  for (const o of players) {
    if (o === self || o.id === self.id) continue;
    if (o.health === 'dead' || o.health === 'escaped' || o.health === 'hooked' || o.health === 'carried') continue;
    if (o.locker != null) continue;
    if (o.role === self.role) continue; // survivors pass through each other
    out.push({ x: o.x, z: o.z, r: radiusOf(o) * 0.9, h: 2 });
  }
  return out;
}

// Moves the player. input: {mx, mz, sprint, crouch}. Returns info about the step.
export function stepMove(p, input, dt, world, extra) {
  let mx = input.mx || 0, mz = input.mz || 0;
  let len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; len = 1; }
  let spd;
  if (p.role === 'killer') {
    spd = killerSpeed(p);
    if (p.pw === 'saw') { mx = Math.sin(p.rot); mz = Math.cos(p.rot); len = 1; }
  } else {
    spd = survivorSpeed(p, input.sprint, input.crouch);
  }
  if (len < 0.01) return { moved: 0, hit: false, speed: spd, ratio: 1 };
  const r = radiusOf(p);
  const dx = mx * spd * dt, dz = mz * spd * dt;
  const res = world.move(p.x, p.z, r, dx, dz, null, extra);
  const moved = Math.hypot(res.x - p.x, res.z - p.z);
  p.x = res.x;
  p.z = res.z;
  if (p.role === 'survivor') {
    const turn = p.health === 'dying' ? 4 : 12;
    p.rot = turnToward(p.rot, Math.atan2(mx, mz), turn * dt);
  }
  return { moved, hit: res.hit, speed: spd, ratio: moved / Math.max(1e-6, spd * dt * len) };
}
