/**
 * Ranged combat resolution.
 *
 * Deterministic given the same RNG state — combat asks the supplied `Rng`
 * for one number per shot, so a saved seed reproduces the engagement
 * exactly. That's important for the M7 save flow and for tests that need to
 * pin a hit/miss outcome.
 *
 * Hit math:
 *   threshold = BASE_HIT_CHANCE − (cover ? COVER_HIT_PENALTY : 0)
 *   hit       = roll < threshold
 *
 * Cover triggers when any COVER tile lies strictly between attacker and
 * target on the Bresenham line — see `LineOfSight.hasCoverBetween`. Walls
 * don't apply a penalty; they block LOS entirely so the shot is illegal in
 * the first place.
 *
 * Pre-conditions are validated with a `{ ok, reason }` discriminator (same
 * shape as `World.canMoveEntity`) so callers can branch on the failure.
 * `resolveRanged` *commits* — it debits AP, rolls, and applies damage. On
 * an illegal call it throws *before* mutating state.
 */

import {
  AP_COST,
  BASE_HIT_CHANCE,
  COVER_HIT_PENALTY,
  RANGED_DAMAGE,
  SIGHT_RANGE,
} from './constants.js';
import { hasLineOfSight, hasCoverBetween, withinRange } from './LineOfSight.js';

/**
 * Pure pre-flight check. Doesn't mutate, doesn't roll.
 */
export function canFireRanged(world, attacker, target, options = {}) {
  if (!attacker || !attacker.alive) return { ok: false, reason: 'attacker-dead' };
  if (!target || !target.alive) return { ok: false, reason: 'invalid-target' };
  if (target === attacker) return { ok: false, reason: 'self-target' };
  // NOTE: only same-faction is blocked. NEUTRAL is *not* shielded — civilians
  // are shootable in V1 by design (narrative consequences, not a rules wall).
  // Revisit when noise/Vouch lands.
  if (target.faction === attacker.faction) return { ok: false, reason: 'same-faction' };
  if (!attacker.canAfford(AP_COST.RANGED_ATTACK)) {
    return { ok: false, reason: 'insufficient-ap' };
  }

  const range = options.range ?? SIGHT_RANGE;
  if (!withinRange(attacker.x, attacker.y, target.x, target.y, range)) {
    return { ok: false, reason: 'out-of-range' };
  }
  // Entities occlude LOS — a body on the line breaks the sightline. Endpoints
  // (attacker/target tiles) are excluded by Bresenham, so they don't block
  // themselves.
  const blockers = typeof world.blockerKeys === 'function' ? world.blockerKeys() : null;
  if (!hasLineOfSight(world.grid, attacker.x, attacker.y, target.x, target.y, { blockers })) {
    return { ok: false, reason: 'no-los' };
  }
  return { ok: true };
}

/**
 * Commit a ranged attack. Throws on illegal pre-conditions (so a bug can't
 * silently steal AP with no shot fired). Returns a result object the caller
 * can log / animate.
 *
 * @returns {{ hit: boolean, roll: number, threshold: number, inCover: boolean,
 *             damage: number, killed: boolean }}
 */
export function resolveRanged(world, attacker, target, rng, options = {}) {
  const check = canFireRanged(world, attacker, target, options);
  if (!check.ok) {
    throw new Error(`Illegal ranged attack from ${attacker.id} → ${target.id}: ${check.reason}`);
  }
  if (!rng || typeof rng.next !== 'function') {
    throw new TypeError('resolveRanged requires an Rng with a next() method');
  }

  // Compute (and validate) threshold *before* debiting AP / rolling. A
  // pathological tuning override (negative or >1) is data corruption, not a
  // gameplay quirk — surface it loudly per the project's no-silent-fallback
  // rule. 0 and 1 are valid (always-miss / always-hit).
  const inCover = hasCoverBetween(world.grid, attacker.x, attacker.y, target.x, target.y);
  const baseHit = options.baseHit ?? BASE_HIT_CHANCE;
  const coverPenalty = options.coverPenalty ?? COVER_HIT_PENALTY;
  const threshold = inCover ? baseHit - coverPenalty : baseHit;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError(
      `resolveRanged: hit threshold ${threshold} out of [0,1] ` +
        `(baseHit=${baseHit}, coverPenalty=${coverPenalty}, inCover=${inCover})`
    );
  }

  attacker.spendAp(AP_COST.RANGED_ATTACK);

  const roll = rng.next();
  const hit = roll < threshold;

  let damage = 0;
  let killed = false;
  if (hit) {
    damage = options.damage ?? RANGED_DAMAGE;
    target.damage(damage);
    killed = !target.alive;
  }

  return { hit, roll, threshold, inCover, damage, killed };
}
