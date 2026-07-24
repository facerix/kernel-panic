import { AP_COST, STATUS_EFFECT, SURGE_DURATION } from './constants.js';
import type { Entity } from './Entity.js';

export type SurgeCheck =
  | { ok: true; reason?: never }
  | {
      ok: false;
      reason: 'dead' | 'insufficient-ap' | 'already-surging' | 'crashing';
    };

/** Pure legality check for Berserk's self-targeted Surge. */
export function canSurge(entity: Entity): SurgeCheck {
  if (!entity.alive) return { ok: false, reason: 'dead' };
  if (!entity.canAfford(AP_COST.SURGE)) return { ok: false, reason: 'insufficient-ap' };
  if (entity.hasEffect(STATUS_EFFECT.SURGE)) return { ok: false, reason: 'already-surging' };
  if (entity.hasEffect(STATUS_EFFECT.CRASH)) return { ok: false, reason: 'crashing' };
  return { ok: true };
}

/** Commit Surge after validating every precondition; illegal calls do not mutate. */
export function doSurge(entity: Entity): void {
  const check = canSurge(entity);
  if (!check.ok) {
    throw new Error(`Illegal surge for ${entity.id}: ${check.reason}`);
  }
  entity.spendAp(AP_COST.SURGE);
  entity.applyEffect(STATUS_EFFECT.SURGE, SURGE_DURATION);
}
