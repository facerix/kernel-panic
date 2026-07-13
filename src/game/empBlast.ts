/**
 * EMP Neural-Shock (P3.5.M2) — the Decker's signature Meatspace ability,
 * replacing the old Drone Override Hack (which moves to the Adept as
 * "Influence" in M4).
 *
 * A self-centered blast: no aim ray, no target picker. It stuns everyone else
 * alive within {@link EMP_RADIUS} — friend and foe alike, no faction filter and
 * no organic/mechanical branching (a uniform stun, matching the game's
 * deliberately blurred enemy theming) — but **not the Decker who fired it**
 * (the caster is shielded from their own discharge; self-stun read as a pure
 * negative-play footgun). A stunned entity takes 0 AP on its next refresh (see
 * `STATUS_EFFECT.STUN` / `Entity.refreshAp`).
 *
 * Pure verbs, mirroring `breachBlast.ts` (blast hits everyone, no faction
 * check) + `Smoke.ts` (self-centered radius loop). The archetype class stays a
 * thin delegator; the intent layer a thin caller.
 */

import { AP_COST, EMP_RADIUS, EMP_STUN_DURATION, STATUS_EFFECT } from './constants.js';
import { chebyshev } from './Pathfinding.js';
import { EVENT } from './events.js';
import type { Entity } from './Entity.js';
import type { World } from './World.js';

/** Pre-flight legality verdict, mirroring the other archetype perks. */
export type EmpCheck = { ok: true } | { ok: false; reason: 'dead' | 'insufficient-ap' };

/**
 * Pure legality check for detonating an EMP. Never mutates. A self-centered
 * blast has no target, so the only gates are "the Decker is alive" and "can
 * afford the AP".
 */
export function canEmp(decker: Entity): EmpCheck {
  if (!decker.alive) return { ok: false, reason: 'dead' };
  if (!decker.canAfford(AP_COST.EMP)) return { ok: false, reason: 'insufficient-ap' };
  return { ok: true };
}

/** Whether `(x, y)` is within the EMP blast centered on `(cx, cy)`. */
export function isInEmpBlast(cx: number, cy: number, x: number, y: number): boolean {
  return chebyshev(cx, cy, x, y) <= EMP_RADIUS;
}

/**
 * Detonate the EMP. Throws on an illegal attempt *before* mutating any state
 * (no AP burned). On a legal attempt: debits `AP_COST.EMP` exactly once, then
 * stuns every *other* alive entity in radius (the firing Decker is exempt).
 * Returns the entities that were stunned.
 */
export function detonateEmp(world: World, decker: Entity): { stunned: Entity[] } {
  const check = canEmp(decker);
  if (!check.ok) {
    throw new Error(`Illegal EMP for ${decker.id}: ${check.reason}`);
  }
  decker.spendAp(AP_COST.EMP);
  const stunned: Entity[] = [];
  for (const entity of world.entities.values()) {
    if (entity === decker) continue; // the caster is shielded from their own discharge
    if (!entity.alive) continue;
    if (!isInEmpBlast(decker.x, decker.y, entity.x, entity.y)) continue;
    entity.applyEffect(STATUS_EFFECT.STUN, EMP_STUN_DURATION);
    stunned.push(entity);
  }
  // Presentation hook (P3.5.M2): the shell listens for this to paint the cyan
  // discharge flash. Gameplay is already resolved above — this carries no state.
  world.events?.emit(EVENT.EMP_DETONATED, {
    origin: { x: decker.x, y: decker.y },
    stunned: stunned.length,
  });
  return { stunned };
}
