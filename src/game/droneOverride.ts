/**
 * Drone Override Hack (P3.M2) — the Decker's signature Meatspace ability.
 *
 * The Decker reaches out across a clean line of sight and hijacks a corp
 * drone's allegiance. On success the drone's `faction` flips to the Decker's
 * (PLAYER) for {@link OVERRIDE_DURATION} turns; because the existing hostile AI
 * acquires targets purely by faction difference (`Hostile.isHostileTo`), a
 * flipped drone immediately fights its former allies with *zero* new AI code.
 * When the countdown lapses, the drone's firmware reasserts control and it
 * reverts to whatever faction it held before.
 *
 * State lives on the hostile itself (`overrideTurnsRemaining`,
 * `factionBeforeOverride`) so it round-trips through the patrol snapshot. This
 * module owns the *verbs*: the legality check, the commit (with the success
 * roll + alarm-on-failure), and the per-turn stepping/revert that the combat
 * aftermath drives. Keeping it here mirrors `slide.ts` — the archetype class
 * stays a thin delegator and the pipeline stays a thin caller.
 */

import { Hostile } from './Hostile.js';
import { hasLineOfSight, withinRange } from './LineOfSight.js';
import {
  AP_COST,
  OVERRIDE_DURATION,
  OVERRIDE_RANGE,
  OVERRIDE_SUCCESS_CHANCE,
  type FactionId,
} from './constants.js';
import type { Entity } from './Entity.js';
import type { World } from './World.js';
import type { Rng } from '../rng.js';
import type { TurnActionStep } from '../types.js';

/** Pre-flight legality verdict, mirroring the Tech/Razor/Merc perk shape. */
export type OverrideCheck = { ok: true } | { ok: false; reason: OverrideDenyReason };

export type OverrideDenyReason =
  | 'dead'
  | 'insufficient-ap'
  | 'not-overridable'
  | 'dead-target'
  | 'already-overridden'
  | 'friendly'
  | 'out-of-range'
  | 'no-los';

/** Result of a committed override attempt. */
export type OverrideResult = {
  ok: true;
  /** Whether the intrusion took. On false the alarm was raised. */
  success: boolean;
  /** The success roll, surfaced for log copy / determinism tests. */
  roll: number;
  alarm: boolean;
};

/**
 * Pure legality check. Returns `{ ok }` or `{ ok: false, reason }`; never
 * mutates. `decker` is the overriding crew member (any PLAYER-faction
 * operator); `target` is the entity it is aiming at.
 *
 * Only a live, in-range, line-of-sight `Hostile` of a *different* faction that
 * is not already overridden can be hijacked. A non-Hostile target (terminal,
 * civilian, turret) is `not-overridable` rather than a thrown error — the
 * picker may legitimately land on one and we want a legible deny, not a crash.
 */
export function canOverride(world: World, decker: Entity, target: Entity | null): OverrideCheck {
  if (!decker.alive) return { ok: false, reason: 'dead' };
  if (!decker.canAfford(AP_COST.OVERRIDE)) return { ok: false, reason: 'insufficient-ap' };
  if (!(target instanceof Hostile)) return { ok: false, reason: 'not-overridable' };
  if (!target.alive) return { ok: false, reason: 'dead-target' };
  if (target.isOverridden) return { ok: false, reason: 'already-overridden' };
  if (target.faction === decker.faction) return { ok: false, reason: 'friendly' };
  if (!withinRange(decker.x, decker.y, target.x, target.y, OVERRIDE_RANGE)) {
    return { ok: false, reason: 'out-of-range' };
  }
  if (
    !hasLineOfSight(world.grid, decker.x, decker.y, target.x, target.y, {
      blockers: world.blockerKeys(),
    })
  ) {
    return { ok: false, reason: 'no-los' };
  }
  return { ok: true };
}

/**
 * Commit an override attempt. Throws on illegal pre-conditions *before*
 * mutating any state (no AP burned). On a legal attempt: debits
 * `AP_COST.OVERRIDE`, rolls against {@link OVERRIDE_SUCCESS_CHANCE}, and either
 * flips the drone (success) or trips the facility alarm (failure). A failed
 * hack still costs AP — the intrusion was noisy whether or not it landed.
 */
export function overrideDrone(
  world: World,
  decker: Entity,
  target: Entity,
  rng: Rng
): OverrideResult {
  const check = canOverride(world, decker, target);
  if (!check.ok) {
    throw new Error(`Illegal override for ${decker.id}: ${check.reason}`);
  }
  decker.spendAp(AP_COST.OVERRIDE);
  const roll = rng.next();
  const success = roll < OVERRIDE_SUCCESS_CHANCE;
  if (success) {
    applyOverride(target as Hostile, decker.faction);
    return { ok: true, success: true, roll, alarm: false };
  }
  // A botched intrusion pings the building's security net.
  const raised = world.raiseAlarm({ source: decker, repPenalty: false });
  return { ok: true, success: false, roll, alarm: raised };
}

/** Flip a hostile to `overriderFaction` for the full override duration. */
export function applyOverride(target: Hostile, overriderFaction: FactionId): void {
  target.factionBeforeOverride = target.faction;
  target.faction = overriderFaction;
  target.overrideTurnsRemaining = OVERRIDE_DURATION;
}

/**
 * Restore a hostile's original allegiance. Throws if there is no recorded
 * pre-override faction — reverting an entity we never overrode is corrupt
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

/** One action emitted by an overridden drone during the player aftermath. */
export type OverriddenDroneAction = TurnActionStep | { type: 'override-expired' };

/**
 * Step every currently-overridden drone through one turn on the player's side,
 * then tick its countdown and revert it when the override lapses. Yields one
 * entry per committed action so the aftermath pipeline can pace + log it, plus
 * a synthetic `override-expired` action when a drone snaps back to corp.
 *
 * Dead overridden drones are skipped (their corpse needs no turn and no
 * revert). The live entity list is snapshotted up front so a drone that kills
 * a corp unit mid-turn can't perturb the iteration.
 */
export function* stepOverriddenDrones(
  world: World,
  rng: Rng
): Generator<{ entity: Hostile; action: OverriddenDroneAction }, void, undefined> {
  const overridden: Hostile[] = [];
  for (const e of world.entities.values()) {
    if (e instanceof Hostile && e.isOverridden && e.alive) overridden.push(e);
  }
  for (const drone of overridden) {
    if (!drone.alive) continue; // may have died earlier in this aftermath pass
    // Corp drones are PatrolHostiles with a step generator; fall back to the
    // synchronous `takeTurn` for any future hostile that lacks one.
    if (typeof drone.takeTurnSteps === 'function') {
      for (const step of drone.takeTurnSteps(world, rng)) {
        yield { entity: drone, action: step };
      }
    } else if (typeof drone.takeTurn === 'function') {
      const steps = drone.takeTurn(world, rng);
      if (Array.isArray(steps)) {
        for (const step of steps) yield { entity: drone, action: step };
      }
    }
    drone.overrideTurnsRemaining -= 1;
    if (drone.overrideTurnsRemaining <= 0) {
      revertOverride(drone);
      yield { entity: drone, action: { type: 'override-expired' } };
    }
  }
}
