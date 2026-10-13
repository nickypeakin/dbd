// Interaction rules shared by client (prompts) and server (validation & bots).
// Works on a "state" object with the common shape:
//   S.players, S.gens, S.pallets, S.windows, S.hooks, S.lockers, S.chests,
//   S.totems, S.gates, S.hatch, S.traps, S.gatesPowered

import { RANGE, SURV, KILL, HEAL } from './constants.js';
import { distToBox, genBox, chestBox } from './collision.js';

export function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Position relative to a window/pallet: perpendicular (signed) and lateral offsets.
export function relTo(p, o) {
  const dx = p.x - o.x, dz = p.z - o.z;
  return { perp: dx * o.nx + dz * o.nz, lat: dx * -o.nz + dz * o.nx };
}

export function isUp(p) { return p.health === 'healthy' || p.health === 'injured'; }

export function survivorCanAct(p) {
  return isUp(p) && !p.lk && p.locker == null && p.trap == null && p.carriedBy == null;
}

function facingScore(p, yaw, x, z) {
  if (yaw == null) return 0;
  const a = Math.atan2(x - p.x, z - p.z);
  return Math.cos(angDiff(yaw, a));
}

export function hittable(o) {
  return (o.health === 'healthy' || o.health === 'injured') && o.locker == null && o.carriedBy == null &&
    o.lk !== 'locker_in' && o.lk !== 'locker_out' && o.lk !== 'hatch' && !(o.fx && o.fx.dh > 0);
}

// Survivor the killer's basic attack connects with (or null).
export function attackCandidate(k, players, world, range = KILL.ATTACK_RANGE, angle = KILL.ATTACK_ANGLE) {
  let best = null, bd = 1e9;
  const fx = Math.sin(k.rot), fz = Math.cos(k.rot);
  for (const o of players) {
    if (o.role !== 'survivor' || !hittable(o)) continue;
    const dx = o.x - k.x, dz = o.z - k.z;
    const d = Math.hypot(dx, dz);
    if (d > range + SURV.RADIUS) continue;
    const c = (dx * fx + dz * fz) / Math.max(d, 1e-6);
    const a = Math.acos(Math.max(-1, Math.min(1, c)));
    if (d > 0.9 && a > angle) continue;
    if (d <= 0.9 && c < -0.2) continue;
    if (!world.clearLine(k.x, k.z, o.x, o.z, 1.0, 0)) continue;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// Returns available interactions for a survivor: {space, m1, m2, e, all}
export function survivorOptions(me, S, yaw, slack = 1) {
  const out = { space: null, m1: null, m2: null, e: null, all: [] };
  if (!me || me.health === 'dead' || me.health === 'escaped' || me.health === 'carried') return out;
  if (me.health === 'hooked') {
    if (me.hookCount === 1 && (me.unhookTries || 0) < 3 && !me.lk) out.m1 = { kind: 'selfunhook', label: 'ATTEMPT ESCAPE' };
    if (out.m1) out.all.push(out.m1);
    return out;
  }
  if (me.lk) return out;
  if (me.trap != null) {
    out.m1 = { kind: 'escapetrap', label: 'ESCAPE TRAP' };
    out.all.push(out.m1);
    return out;
  }
  if (me.locker != null) {
    out.space = { kind: 'exitlocker', id: me.locker, label: 'EXIT LOCKER' };
    out.all.push(out.space);
    return out;
  }
  if (me.health === 'dying') {
    const cap = me.perks && me.perks.includes('unbreakable') && !me.usedUnbreakable ? 1 : HEAL.RECOVER_MAX;
    if ((me.healP || 0) < cap - 0.001) out.m1 = { kind: 'recover', label: 'RECOVER' };
    if (out.m1) out.all.push(out.m1);
    return out;
  }
  if (!isUp(me)) return out;

  // ---- SPACE: hatch, pallets, windows, lockers
  let best = null, bestScore = -1e9;
  const cand = (opt, score) => { out.all.push(opt); if (score > bestScore) { best = opt; bestScore = score; } };
  if (S.hatch && S.hatch.state === 'open' && Math.hypot(me.x - S.hatch.x, me.z - S.hatch.z) <= RANGE.HATCH * slack) {
    cand({ kind: 'hatch', label: 'JUMP IN' }, 100);
  }
  for (const pl of S.pallets) {
    if (pl.state !== 'up' && pl.state !== 'down') continue;
    if (Math.abs(pl.x - me.x) > 3 || Math.abs(pl.z - me.z) > 3) continue;
    const r = relTo(me, pl);
    if (pl.state === 'up') {
      if (Math.abs(r.perp) <= RANGE.PALLET_PERP * slack && Math.abs(r.lat) <= RANGE.PALLET_LAT * slack) {
        cand({ kind: 'drop', id: pl.id, label: 'PULL DOWN' }, 50 - Math.abs(r.perp) + facingScore(me, yaw, pl.x, pl.z));
      }
    } else if (Math.abs(r.perp) <= (RANGE.VAULT_PERP + 0.2) * slack && Math.abs(r.perp) > 0.15 && Math.abs(r.lat) <= (pl.len / 2) * slack) {
      cand({ kind: 'vaultp', id: pl.id, label: 'VAULT' }, 40 - Math.abs(r.perp) + facingScore(me, yaw, pl.x, pl.z));
    }
  }
  for (const w of S.windows) {
    if (Math.abs(w.x - me.x) > 3 || Math.abs(w.z - me.z) > 3) continue;
    if (w.blocked) continue;
    const r = relTo(me, w);
    if (Math.abs(r.perp) <= RANGE.VAULT_PERP * slack && Math.abs(r.perp) > 0.15 && Math.abs(r.lat) <= RANGE.VAULT_LAT * slack) {
      cand({ kind: 'vault', id: w.id, label: 'VAULT' }, 40 - Math.abs(r.perp) + facingScore(me, yaw, w.x, w.z));
    }
  }
  {
    for (const l of S.lockers) {
      const fx = l.x + Math.sin(l.rot) * 0.6, fz = l.z + Math.cos(l.rot) * 0.6;
      const d = Math.hypot(me.x - fx, me.z - fz);
      if (d <= RANGE.LOCKER * slack) cand({ kind: 'locker', id: l.id, label: 'HIDE' }, 10 - d + facingScore(me, yaw, l.x, l.z) - (best ? 100 : 0));
    }
  }
  out.space = best;

  // ---- M1: altruism & objectives
  best = null; bestScore = -1e9;
  for (const h of S.hooks) {
    if (h.occupant == null || h.occupant === me.id) continue;
    const occ = S.players.find((p) => p.id === h.occupant);
    if (!occ || occ.health !== 'hooked' || occ.lk) continue;
    const d = Math.hypot(me.x - h.x, me.z - h.z);
    if (d <= RANGE.UNHOOK * slack) cand({ kind: 'unhook', id: h.id, label: 'UNHOOK' }, 100 - d);
  }
  for (const o of S.players) {
    if (o.id === me.id || o.role !== 'survivor') continue;
    const d = Math.hypot(me.x - o.x, me.z - o.z);
    if (d > RANGE.HEAL * slack) continue;
    if (o.carriedBy != null || o.locker != null || o.lk === 'hooking' || o.lk === 'pickedup') continue;
    if (o.trap != null) cand({ kind: 'freetrap', id: o.id, label: 'FREE' }, 90 - d);
    else if (o.health === 'injured' || o.health === 'dying') cand({ kind: 'heal', id: o.id, label: 'HEAL' }, 80 - d + facingScore(me, yaw, o.x, o.z));
  }
  if (S.gatesPowered) {
    for (const g of S.gates) {
      if (g.open) continue;
      const d = Math.hypot(me.x - g.sx, me.z - g.sz);
      if (d <= RANGE.GATE * slack) cand({ kind: 'gate', id: g.id, label: 'OPEN' }, 70 - d);
    }
  }
  for (const g of S.gens) {
    if (g.done || g.blocked) continue;
    const d = distToBox(me.x, me.z, genBox(g));
    if (d <= RANGE.GEN * slack + SURV.RADIUS) cand({ kind: 'repair', id: g.id, label: 'REPAIR' }, 60 - d);
  }
  for (const t of S.totems) {
    if (t.state === 'cleansed') continue;
    const d = Math.hypot(me.x - t.x, me.z - t.z);
    if (d <= RANGE.TOTEM * slack) cand({ kind: 'cleanse', id: t.id, label: t.state === 'hex' || t.state === 'noed' ? 'CLEANSE HEX' : 'CLEANSE' }, 50 - d);
  }
  for (const c of S.chests) {
    if (c.opened) continue;
    const d = distToBox(me.x, me.z, chestBox(c));
    if (d <= RANGE.CHEST * slack + SURV.RADIUS) cand({ kind: 'chest', id: c.id, label: 'SEARCH' }, 40 - d);
  }
  if (S.traps) {
    for (const t of S.traps) {
      if (t.state !== 'armed') continue;
      const d = Math.hypot(me.x - t.x, me.z - t.z);
      if (d <= RANGE.TRAP * slack && d > 0.5) cand({ kind: 'disarm', id: t.id, label: 'DISARM' }, 30 - d);
    }
  }
  out.m1 = best;

  // ---- M2: items
  if (me.item && me.item.charges > 0) {
    if (me.item.type === 'medkit' && me.health === 'injured') out.m2 = { kind: 'medkit', label: 'HEAL SELF' };
    if (me.item.type === 'flashlight') out.m2 = { kind: 'flashlight', label: 'FLASHLIGHT' };
    if (out.m2) out.all.push(out.m2);
  }
  // ---- E: perks
  if (me.perks) {
    if (me.perks.includes('dead_hard') && me.health === 'injured' && !(me.exh > 0)) out.e = { kind: 'deadhard', label: 'DEAD HARD' };
    else if (me.perks.includes('self_care') && me.health === 'injured') out.e = { kind: 'selfcare', label: 'SELF-CARE' };
    if (out.e) out.all.push(out.e);
  }
  return out;
}

// Returns available interactions for the killer: {space, e}
export function killerOptions(me, S, yaw, slack = 1) {
  const out = { space: null, e: null, all: [] };
  if (!me || me.lk) return out;
  if (me.carrying != null) {
    let best = null, bd = 1e9;
    for (const h of S.hooks) {
      if (h.occupant != null || h.broken) continue;
      const d = Math.hypot(me.x - h.x, me.z - h.z);
      if (d <= RANGE.HOOK * slack) out.all.push({ kind: 'hook', id: h.id, label: 'HOOK' });
      if (d <= RANGE.HOOK * slack && d < bd) { bd = d; best = { kind: 'hook', id: h.id, label: 'HOOK' }; }
    }
    out.space = best;
    out.e = { kind: 'dropsurv', label: 'DROP' };
    out.all.push(out.e);
    return out;
  }
  let best = null, bestScore = -1e9;
  const cand = (opt, score) => { out.all.push(opt); if (score > bestScore) { best = opt; bestScore = score; } };
  for (const o of S.players) {
    if (o.role !== 'survivor') continue;
    const d = Math.hypot(me.x - o.x, me.z - o.z);
    if (d > RANGE.PICKUP * slack) continue;
    if (o.carriedBy != null || o.lk) continue;
    if (o.health === 'dying' || (o.trap != null && isUp(o))) cand({ kind: 'pickup', id: o.id, label: 'PICK UP' }, 100 - d + facingScore(me, yaw, o.x, o.z));
  }
  if (S.hatch && S.hatch.state === 'open' && Math.hypot(me.x - S.hatch.x, me.z - S.hatch.z) <= RANGE.HATCH * slack) {
    cand({ kind: 'closehatch', label: 'CLOSE HATCH' }, 90);
  }
  for (const pl of S.pallets) {
    if (pl.state !== 'down') continue;
    if (Math.abs(pl.x - me.x) > 3 || Math.abs(pl.z - me.z) > 3) continue;
    const r = relTo(me, pl);
    if (Math.abs(r.perp) <= RANGE.BREAK_PERP * slack && Math.abs(r.lat) <= (pl.len / 2 + 0.3) * slack) {
      cand({ kind: 'break', id: pl.id, label: 'BREAK' }, 80 - Math.abs(r.perp) + facingScore(me, yaw, pl.x, pl.z));
    }
  }
  for (const w of S.windows) {
    if (Math.abs(w.x - me.x) > 3 || Math.abs(w.z - me.z) > 3) continue;
    const r = relTo(me, w);
    if (Math.abs(r.perp) <= RANGE.K_VAULT_PERP * slack && Math.abs(r.perp) > 0.2 && Math.abs(r.lat) <= RANGE.VAULT_LAT * slack) {
      cand({ kind: 'kvault', id: w.id, label: 'VAULT' }, 70 - Math.abs(r.perp) + facingScore(me, yaw, w.x, w.z) * 2);
    }
  }
  for (const g of S.gens) {
    if (g.done || g.regressing || g.progress <= 0 || g.kickCd) continue;
    const d = distToBox(me.x, me.z, genBox(g));
    if (d <= RANGE.KICK * slack + KILL.RADIUS) cand({ kind: 'kick', id: g.id, label: 'DAMAGE' }, 60 - d + facingScore(me, yaw, g.x, g.z));
  }
  for (const l of S.lockers) {
    const fx = l.x + Math.sin(l.rot) * 0.7, fz = l.z + Math.cos(l.rot) * 0.7;
    const d = Math.hypot(me.x - fx, me.z - fz);
    if (d > RANGE.SEARCH * slack) continue;
    if (me.char === 'huntress' && (me.ammo ?? 5) < 5) cand({ kind: 'reload', id: l.id, label: 'RELOAD' }, 45 - d + facingScore(me, yaw, l.x, l.z));
    else cand({ kind: 'search', id: l.id, label: 'SEARCH' }, 40 - d + facingScore(me, yaw, l.x, l.z));
  }
  if (me.char === 'trapper' && S.traps && (me.ammo ?? 0) < 2) {
    for (const t of S.traps) {
      if (t.state !== 'ground') continue;
      const d = Math.hypot(me.x - t.x, me.z - t.z);
      if (d <= RANGE.TRAP * slack) cand({ kind: 'taketrap', id: t.id, label: 'PICK UP TRAP' }, 35 - d);
    }
  }
  out.space = best;
  return out;
}

// Vault path across a window or dropped pallet.
export function vaultPath(p, o, isKiller) {
  const r = relTo(p, o);
  const side = r.perp >= 0 ? 1 : -1;
  const half = (o.w || o.len) / 2 - (isKiller ? 0.5 : 0.35);
  const lat = Math.max(-Math.max(0, half), Math.min(Math.max(0, half), r.lat));
  const tx = -o.nz, tz = o.nx;
  const d = isKiller ? 0.95 : 0.8;
  return {
    from: { x: o.x + o.nx * side * Math.max(Math.abs(r.perp), 0.5) + tx * lat, z: o.z + o.nz * side * Math.max(Math.abs(r.perp), 0.5) + tz * lat },
    to: { x: o.x - o.nx * side * d + tx * lat, z: o.z - o.nz * side * d + tz * lat },
  };
}

// Which vault speed a survivor gets: 'fast' | 'med' | 'slow'
export function vaultType(p, o, speed, sprinting, rotFacing) {
  if (!sprinting || speed < 2.6) return 'slow';
  const r = relTo(p, o);
  const side = r.perp >= 0 ? 1 : -1;
  const want = Math.atan2(-o.nx * side, -o.nz * side);
  const facing = Math.cos(angDiff(rotFacing, want));
  if (facing > 0.7 && speed >= 3.5) return 'fast';
  return 'med';
}
