/**
 * Ranged combat resolution.
 *
 * Deterministic given the same RNG state — combat asks the supplied `Rng`
 * for one number per shot, so a saved seed reproduces the engagement
 * exactly. That's important for the save flow and for tests that need to pin
 * a hit/miss outcome.
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

import type { DamageResolution, MeleeAttackResult, RangedAttackResult } from '../types.js';
import type { Entity } from './Entity.js';
import type { World } from './World.js';
import type { Rng } from '../rng.js';
import {
  AP_COST,
  BASE_HIT_CHANCE,
  COVER_HIT_PENALTY,
  COVER_DODGE_BONUS,
  DODGE_CHANCE,
  FACTION,
  RANGED_DAMAGE,
  MELEE_DAMAGE,
  NOISE_RADIUS,
  SIGHT_RANGE,
  TILE,
} from './constants.js';
import { hasLineOfSight, hasCoverBetween, withinRange } from './LineOfSight.js';
import { isConcealedFromPlayer } from './playerPerception.js';
import { EVENT } from './events.js';

export type CanFireRangedOptions = {
  freeShot?: boolean;
  range?: number;
};

export type ResolveRangedOptions = CanFireRangedOptions & {
  baseHit?: number;
  coverPenalty?: number;
  damage?: number;
};

export type ResolveMeleeOptions = {
  damage?: number;
  dodgeChance?: number;
  coverDodgeBonus?: number;
};

function attackerRangedDamage(attacker: Entity, override?: number): number {
  if (override !== undefined) return override;
  const rangedAttackDamage = (attacker as { rangedAttackDamage?: () => number }).rangedAttackDamage;
  if (typeof rangedAttackDamage === 'function') {
    return rangedAttackDamage.call(attacker);
  }
  return RANGED_DAMAGE;
}

function attackerMeleeDamage(attacker: Entity, override?: number): number {
  if (override !== undefined) return override;
  const meleeAttackDamage = (attacker as { meleeAttackDamage?: () => number }).meleeAttackDamage;
  if (typeof meleeAttackDamage === 'function') {
    return meleeAttackDamage.call(attacker);
  }
  if ('meleeDamage' in attacker) {
    return (attacker as { meleeDamage: number }).meleeDamage;
  }
  return MELEE_DAMAGE;
}

/**
 * Pure pre-flight check. Doesn't mutate, doesn't roll.
 */
export function canFireRanged(
  world: World,
  attacker: Entity,
  target: Entity,
  options: CanFireRangedOptions = {}
) {
  if (!attacker || !attacker.alive) return { ok: false, reason: 'attacker-dead' };
  if (!target || !target.alive) return { ok: false, reason: 'invalid-target' };
  if (target === attacker) return { ok: false, reason: 'self-target' };
  // NOTE: only same-faction is blocked. NEUTRAL is *not* shielded — civilians
  // are shootable in V1 by design (narrative consequences, not a rules wall).
  // Revisit when noise/Rep lands.
  if (target.faction === attacker.faction) return { ok: false, reason: 'same-faction' };
  if (!options.freeShot && !attacker.canAfford(AP_COST.RANGED_ATTACK)) {
    return { ok: false, reason: 'insufficient-ap' };
  }
  if (attacker.faction === FACTION.PLAYER && isConcealedFromPlayer(target, attacker, world)) {
    return { ok: false, reason: 'concealed-target' };
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
 */
export function resolveRanged(
  world: World,
  attacker: Entity,
  target: Entity,
  rng: Rng,
  options: ResolveRangedOptions = {}
): RangedAttackResult {
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
  // Crew archetypes override baseHitChance (Merc 0.8, Tech 0.75, Razor 0.7);
  // non-crew entities (drones, turrets) fall back to BASE_HIT_CHANCE.
  const entityBaseHit =
    'baseHitChance' in attacker
      ? (attacker as { baseHitChance: number }).baseHitChance
      : BASE_HIT_CHANCE;
  // Crew gear's targeting chip adds hitBonus to the base hit chance.
  const gearBonus = (attacker as Entity & { gear?: { hitBonus?: number } }).gear?.hitBonus ?? 0;
  const baseHit = options.baseHit ?? entityBaseHit + gearBonus;
  const coverPenalty = options.coverPenalty ?? COVER_HIT_PENALTY;
  const threshold = inCover ? baseHit - coverPenalty : baseHit;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError(
      `resolveRanged: hit threshold ${threshold} out of [0,1] ` +
        `(baseHit=${baseHit}, coverPenalty=${coverPenalty}, inCover=${inCover})`
    );
  }

  if (!options.freeShot) {
    attacker.spendAp(AP_COST.RANGED_ATTACK);
  }

  // Attacking breaks stealth — a gunshot drops the cloak regardless of
  // hit/miss. Only relevant for Razor's Slide perk; harmless for others
  // (stealthed is undefined, guard skips).
  if (attacker.stealthed) attacker.stealthed = false;

  const roll = rng.next();
  const hit = roll < threshold;

  let damage = 0;
  let killed = false;
  let damageResolution: DamageResolution | undefined;
  if (hit) {
    const intendedDamage = attackerRangedDamage(attacker, options.damage);
    damageResolution = resolveConnectedDamage(intendedDamage, target);
    // Preserve the established result/event `damage` contract: post-armor
    // attack damage when any HP lands (including overkill). Consumers that
    // need exact HP loss or shield breakdown use `damageResolution`.
    damage =
      damageResolution.hpDamage === 0
        ? 0
        : damageResolution.incomingDamage - damageResolution.armorAbsorbed;
    killed = !target.alive;
    // Emit only on a connected hit. Misses still tick the noise model below
    // (a shot is loud regardless) — that's a separate `noise` event.
    world.events?.emit(EVENT.ENTITY_DAMAGED, {
      attacker,
      target,
      damage,
      damageResolution,
      killed,
      source: 'ranged',
    });
  }
  // Noise fires on every shot, hit or miss — a missed bullet still cracks
  // through the room. Origin is the *attacker*'s tile (where the muzzle
  // flash is); a sentry on the far side investigates back along the line.
  world.events?.emit(EVENT.NOISE, {
    origin: { x: attacker.x, y: attacker.y },
    radius: NOISE_RADIUS.RANGED,
    source: attacker,
    kind: 'ranged',
  });

  return { hit, roll, threshold, inCover, damage, killed, damageResolution };
}

/**
 * Pure pre-flight check for a melee strike. Mirrors `canFireRanged`'s
 * `{ ok, reason }` shape. Adjacency is Chebyshev (the same 8-neighbourhood
 * movement uses) so a diagonal lunge is legal — no orthogonal-only carve-out.
 */
export function canMelee(world: World, attacker: Entity, target: Entity) {
  if (!attacker || !attacker.alive) return { ok: false, reason: 'attacker-dead' };
  if (!target || !target.alive) return { ok: false, reason: 'invalid-target' };
  if (target === attacker) return { ok: false, reason: 'self-target' };
  if (target.faction === attacker.faction) return { ok: false, reason: 'same-faction' };
  if (attacker.faction === FACTION.PLAYER && isConcealedFromPlayer(target, attacker, world)) {
    return { ok: false, reason: 'concealed-target' };
  }
  if (!attacker.canAfford(AP_COST.MELEE_ATTACK)) {
    return { ok: false, reason: 'insufficient-ap' };
  }
  const dx = Math.abs(target.x - attacker.x);
  const dy = Math.abs(target.y - attacker.y);
  if (Math.max(dx, dy) > 1) {
    return { ok: false, reason: 'not-adjacent' };
  }
  // Note we do NOT require LOS here. By the time the attacker is Chebyshev-1
  // adjacent there's no intervening tile to occlude — the check would always
  // be vacuously true. Walls between are impossible (movement couldn't have
  // placed the attacker on the other side without a path).
  return { ok: true };
}

/**
 * Commit a melee strike. Defenders get a dodge roll while keeping the
 * pre-check strict: adjacency + AP buys a committed swing, not guaranteed HP
 * loss. Throws on illegal pre-conditions (so a buggy caller can't silently
 * steal AP with no swing) and emits both `entity:damaged` and a `noise` event
 * so the world reacts the same way it does for ranged.
 *
 * Armor ordering: dodge/miss resolves first; on a connected hit,
 * `damageReduction` mitigates incoming damage with a minimum of 1 damage.
 *
 * Diagonal corner cover counts as `inCover`: the line between two diagonal
 * neighbours passes through the corner shared by two cells, so either COVER
 * cell can give the defender something to duck around. Orthogonal melee has
 * no intervening tile at Chebyshev-1 adjacency.
 */
export function resolveMelee(
  world: World,
  attacker: Entity,
  target: Entity,
  rng: Rng,
  options: ResolveMeleeOptions = {}
): MeleeAttackResult {
  const check = canMelee(world, attacker, target);
  if (!check.ok) {
    throw new Error(`Illegal melee from ${attacker.id} → ${target.id}: ${check.reason}`);
  }
  if (!rng || typeof rng.next !== 'function') {
    throw new TypeError('resolveMelee requires an Rng with a next() method');
  }

  const inCover = hasMeleeCoverBetween(world, attacker, target);
  // Crew archetypes override baseDodgeChance (Razor 0.35); drones and turrets
  // fall back to DODGE_CHANCE.
  const entityBaseDodge =
    'baseDodgeChance' in target
      ? (target as { baseDodgeChance: number }).baseDodgeChance
      : DODGE_CHANCE;
  const gearDodgeBonus =
    (target as Entity & { gear?: { dodgeBonus?: number } }).gear?.dodgeBonus ?? 0;
  const dodgeChance = options.dodgeChance ?? entityBaseDodge + gearDodgeBonus;
  const coverDodgeBonus = options.coverDodgeBonus ?? COVER_DODGE_BONUS;
  // Stationary props (relay, turret) set baseDodgeChance to 0 — cover cannot
  // grant them a dodge roll they do not have.
  const dodgeThreshold = inCover && dodgeChance > 0 ? dodgeChance + coverDodgeBonus : dodgeChance;
  if (!Number.isFinite(dodgeThreshold) || dodgeThreshold < 0 || dodgeThreshold > 1) {
    throw new RangeError(
      `resolveMelee: dodge threshold ${dodgeThreshold} out of [0,1] ` +
        `(dodgeChance=${dodgeChance}, coverDodgeBonus=${coverDodgeBonus}, inCover=${inCover})`
    );
  }

  attacker.spendAp(AP_COST.MELEE_ATTACK);

  // Attacking breaks stealth — a melee swing drops the cloak. Same guard
  // as resolveRanged: only fires when the attacker is actually stealthed.
  if (attacker.stealthed) attacker.stealthed = false;

  const roll = rng.next();
  const dodged = roll < dodgeThreshold;
  const hit = !dodged;
  let damage = 0;
  let killed = false;
  let damageResolution: DamageResolution | undefined;
  if (hit) {
    const intendedDamage = attackerMeleeDamage(attacker, options.damage);
    damageResolution = resolveConnectedDamage(intendedDamage, target);
    damage =
      damageResolution.hpDamage === 0
        ? 0
        : damageResolution.incomingDamage - damageResolution.armorAbsorbed;
    killed = !target.alive;
  }
  world.events?.emit(EVENT.ENTITY_DAMAGED, {
    attacker,
    target,
    damage,
    damageResolution,
    killed,
    source: 'melee',
    dodged,
  });
  // Melee is loud but not as loud as a gunshot — heard mid-room, not building-
  // wide. Origin is the attacker's tile (point of impact in V1; diff between
  // attacker and target tile is 1 so it's barely meaningful either way).
  world.events?.emit(EVENT.NOISE, {
    origin: { x: attacker.x, y: attacker.y },
    radius: NOISE_RADIUS.MELEE,
    source: attacker,
    kind: 'melee',
  });
  return { hit, dodged, roll, dodgeThreshold, inCover, damage, killed, damageResolution };
}

function resolveConnectedDamage(intendedDamage: number, target: Entity): DamageResolution {
  const mitigatedDamage = applyDamageReduction(intendedDamage, target);
  const armorAbsorbed = intendedDamage - mitigatedDamage;
  const shieldBefore = target.shieldHp;
  const hpDamage = target.damage(mitigatedDamage);
  const shieldAbsorbed = shieldBefore - target.shieldHp;
  return { incomingDamage: intendedDamage, armorAbsorbed, shieldAbsorbed, hpDamage };
}

function applyDamageReduction(intendedDamage: number, target: Entity): number {
  if (!Number.isInteger(intendedDamage) || intendedDamage < 0) {
    throw new RangeError(`damage must be a non-negative integer, got ${intendedDamage}`);
  }
  if (intendedDamage === 0) return 0;
  const armor = target.damageReduction;
  if (!Number.isInteger(armor) || armor < 0) {
    throw new RangeError(`target ${target.id} has invalid damageReduction=${armor}`);
  }
  return Math.max(1, intendedDamage - armor);
}

function hasMeleeCoverBetween(world: World, attacker: Entity, target: Entity): boolean {
  if (hasCoverBetween(world.grid, attacker.x, attacker.y, target.x, target.y)) return true;

  const dx = target.x - attacker.x;
  const dy = target.y - attacker.y;
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) return false;

  const cornerA = { x: attacker.x + dx, y: attacker.y };
  const cornerB = { x: attacker.x, y: attacker.y + dy };
  return (
    world.grid.tileAt(cornerA.x, cornerA.y) === TILE.COVER ||
    world.grid.tileAt(cornerB.x, cornerB.y) === TILE.COVER
  );
}
