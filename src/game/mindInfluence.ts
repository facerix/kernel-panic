/**
 * Mind Influence (P3.5.M4, renamed and rehomed from `droneOverride.ts`) — the
 * Adept's signature Meatspace ability, and the pure machinery the CyberAvatar's
 * cyber-grid Override also delegates to (`CyberAvatar.ts` keeps its own
 * `canOverride`/`overrideDrone` method names — ICE hijack stays "Override" on
 * the digital layer; see that file's doc comment).
 *
 * The Adept reaches out across a clean line of sight and psychically dominates
 * a hostile's will. On success the target's `faction` flips to the Adept's
 * (PLAYER) for {@link INFLUENCE_DURATION} turns; because the existing hostile
 * AI acquires targets purely by faction difference (`Hostile.isHostileTo`), a
 * dominated hostile immediately fights its former allies with *zero* new AI
 * code. When the countdown lapses, the target's own will reasserts itself and
 * it reverts to whatever faction it held before.
 *
 * This mechanic used to be the Decker's "Drone Override Hack" (P3.M2); M2
 * moved the Decker's Meatspace perk to EMP (`empBlast.ts`) and this module
 * kept serving only the CyberAvatar's cyber-grid Override in the interim. M4
 * renames the module wholesale and gives the mechanic a permanent Meatspace
 * owner (the Adept) — behavior is unchanged, only the name and fictional
 * framing.
 *
 * State lives on the target itself (`overrideTurnsRemaining`,
 * `factionBeforeOverride`) so it round-trips through the patrol snapshot —
 * those field names are deliberately *not* renamed (P3.5.M1's "do not
 * migrate" list): they're shared bookkeeping for both the cyber-grid Override
 * and the Adept's Influence, and renaming them buys nothing. This module owns
 * the *verbs*: the legality check, the commit (with the success roll + alarm-
 * on-failure), and the per-turn stepping/revert that the combat aftermath
 * drives. Keeping it here mirrors `slide.ts` — the archetype class stays a
 * thin delegator and the pipeline stays a thin caller.
 */

import { Hostile } from './Hostile.js';
import { hasLineOfSight, withinRange } from './LineOfSight.js';
import {
  AP_COST,
  INFLUENCE_DURATION,
  INFLUENCE_RANGE,
  INFLUENCE_SUCCESS_CHANCE,
  type FactionId,
} from './constants.js';
import type { Entity } from './Entity.js';
import type { World } from './World.js';
import type { Rng } from '../rng.js';
import type { TurnActionStep } from '../types.js';

/** Pre-flight legality verdict, mirroring the Tech/Razor/Merc perk shape. */
export type InfluenceCheck = { ok: true } | { ok: false; reason: InfluenceDenyReason };

export type InfluenceDenyReason =
  | 'dead'
  | 'insufficient-ap'
  | 'not-overridable'
  | 'dead-target'
  | 'already-overridden'
  | 'friendly'
  | 'out-of-range'
  | 'no-los';

/** Result of a committed influence attempt. */
export type InfluenceResult = {
  ok: true;
  /** Whether the domination took. On false the alarm was raised. */
  success: boolean;
  /** The success roll, surfaced for log copy / determinism tests. */
  roll: number;
  alarm: boolean;
};

/**
 * Pure legality check. Returns `{ ok }` or `{ ok: false, reason }`; never
 * mutates. `operator` is the influencing crew member (any PLAYER-faction
 * operator); `target` is the entity it is aiming at.
 *
 * Only a live, in-range, line-of-sight `Hostile` of a *different* faction that
 * is not already dominated can be influenced. A non-Hostile target (terminal,
 * civilian, turret) is `not-overridable` rather than a thrown error — the
 * picker may legitimately land on one and we want a legible deny, not a crash.
 */
export function canInfluence(
  world: World,
  operator: Entity,
  target: Entity | null
): InfluenceCheck {
  if (!operator.alive) return { ok: false, reason: 'dead' };
  if (!operator.canAfford(AP_COST.INFLUENCE)) return { ok: false, reason: 'insufficient-ap' };
  if (!(target instanceof Hostile)) return { ok: false, reason: 'not-overridable' };
  if (!target.alive) return { ok: false, reason: 'dead-target' };
  if (target.isOverridden) return { ok: false, reason: 'already-overridden' };
  if (target.faction === operator.faction) return { ok: false, reason: 'friendly' };
  if (!withinRange(operator.x, operator.y, target.x, target.y, INFLUENCE_RANGE)) {
    return { ok: false, reason: 'out-of-range' };
  }
  if (
    !hasLineOfSight(world.grid, operator.x, operator.y, target.x, target.y, {
      blockers: world.blockerKeys(),
    })
  ) {
    return { ok: false, reason: 'no-los' };
  }
  return { ok: true };
}

/**
 * Commit an influence attempt. Throws on illegal pre-conditions *before*
 * mutating any state (no AP burned). On a legal attempt: debits
 * `AP_COST.INFLUENCE`, rolls against {@link INFLUENCE_SUCCESS_CHANCE}, and
 * either dominates the target (success) or trips the facility alarm
 * (failure). A failed attempt still costs AP — the intrusion was noisy
 * whether or not it landed.
 */
export function influenceTarget(
  world: World,
  operator: Entity,
  target: Entity,
  rng: Rng
): InfluenceResult {
  const check = canInfluence(world, operator, target);
  if (!check.ok) {
    throw new Error(`Illegal override for ${operator.id}: ${check.reason}`);
  }
  operator.spendAp(AP_COST.INFLUENCE);
  const roll = rng.next();
  const success = roll < INFLUENCE_SUCCESS_CHANCE;
  if (success) {
    applyOverride(target as Hostile, operator.faction);
    return { ok: true, success: true, roll, alarm: false };
  }
  // A botched intrusion pings the building's security net.
  const raised = world.raiseAlarm({ source: operator, repPenalty: false });
  return { ok: true, success: false, roll, alarm: raised };
}

/** Flip a hostile to `overriderFaction` for the full influence duration. */
export function applyOverride(target: Hostile, overriderFaction: FactionId): void {
  target.factionBeforeOverride = target.faction;
  target.faction = overriderFaction;
  target.overrideTurnsRemaining = INFLUENCE_DURATION;
}

/**
 * Restore a hostile's original allegiance. Throws if there is no recorded
 * pre-override faction — reverting an entity we never dominated is corrupt
 * bookkeeping, not a recoverable situation.
 */
export function revertOverride(target: Hostile): void {
  if (target.factionBeforeOverride === null) {
    throw new Error(`revertOverride: ${target.id} has no factionBeforeOverride to restore`);
  }
  target.faction = target.factionBeforeOverride;
  target.factionBeforeOverride = null;
  target.overrideTurnsRemaining = 0;
}

/** One action emitted by an influenced hostile during the player aftermath. */
export type InfluencedHostileAction = TurnActionStep | { type: 'override-expired' };

/**
 * Step every currently-dominated hostile through one turn on the player's
 * side, then tick its countdown and revert it when the influence lapses.
 * Yields one entry per committed action so the aftermath pipeline can pace +
 * log it, plus a synthetic `override-expired` action when a target snaps back
 * to its original faction.
 *
 * Dead dominated hostiles are skipped (their corpse needs no turn and no
 * revert). The live entity list is snapshotted up front so a hostile that
 * kills another unit mid-turn can't perturb the iteration.
 */
export function* stepInfluencedHostiles(
  world: World,
  rng: Rng
): Generator<{ entity: Hostile; action: InfluencedHostileAction }, void, undefined> {
  const overridden: Hostile[] = [];
  for (const e of world.entities.values()) {
    if (e instanceof Hostile && e.isOverridden && e.alive) overridden.push(e);
  }
  for (const target of overridden) {
    if (!target.alive) continue; // may have died earlier in this aftermath pass
    // Corp drones/ICE are PatrolHostiles with a step generator; fall back to
    // the synchronous `takeTurn` for any future hostile that lacks one.
    if (typeof target.takeTurnSteps === 'function') {
      for (const step of target.takeTurnSteps(world, rng)) {
        yield { entity: target, action: step };
      }
    } else if (typeof target.takeTurn === 'function') {
      const steps = target.takeTurn(world, rng);
      if (Array.isArray(steps)) {
        for (const step of steps) yield { entity: target, action: step };
      }
    }
    target.overrideTurnsRemaining -= 1;
    if (target.overrideTurnsRemaining <= 0) {
      revertOverride(target);
      yield { entity: target, action: { type: 'override-expired' } };
    }
  }
}
