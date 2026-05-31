/**
 * Corp-aligned non-combatant — office workers, desk security. CORP faction,
 * no weapons, no movement. On each corp turn, checks LOS to the deployed
 * crew member; if visible, emits an `alarm` event that transitions all
 * subscribed patrol hostiles (skirmishers, guards, …) to ENGAGE.
 *
 * The alarm is a **map-wide cadence** stored on `world.alarm`. Once any
 * CorpCivilian triggers it, the facility stays alert for a short hold window,
 * then cools down. Additional civilians that see the player during the alert
 * window will not re-emit (no stacking Rep penalties).
 *
 * Does not extend `Hostile` — it never fires, never chases. The alarm is
 * the only combat-relevant action. Killing a CorpCivilian does NOT cost Rep
 * (they're corp-aligned, not neutral); the Rep penalty applies only to
 * NEUTRAL faction civilians.
 *
 * Placed by `mapBuild` at authored spawn points inside prefabs (at least one
 * per `office` prefab).
 */

import { Entity, type EntityInit } from '../Entity.js';
import { EscortNpc } from './EscortNpc.js';
import { FACTION, SIGHT_RANGE } from '../constants.js';
import { hasConcealedLineOfSight, withinRange } from '../LineOfSight.js';
import type { TurnActionStep, TurnActionSteps } from '../../types.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export interface CorpCivilianInit extends Omit<
  EntityInit,
  'faction' | 'glyph' | 'maxAp' | 'maxHp'
> {
  sightRange?: number;
}

export class CorpCivilian extends Entity {
  sightRange: number;

  constructor({ sightRange = SIGHT_RANGE, ...props }: CorpCivilianInit) {
    super({
      ...props,
      faction: FACTION.CORP,
      glyph: 'c',
      maxAp: 1,
      maxHp: 1,
    });
    if (!Number.isInteger(sightRange) || sightRange < 0) {
      throw new RangeError(
        `CorpCivilian sightRange must be a non-negative integer, got ${sightRange}`
      );
    }
    this.sightRange = sightRange;
  }

  /**
   * Generator form — yields one step (alarm or idle) so the corp turn driver
   * can pace it with paint + delay like any other corp entity.
   */
  override *takeTurnSteps(world: World, _rng: Rng): TurnActionSteps {
    if (!this.alive || world.alarmActive) return;

    const target = this.#findPlayerTarget(world);
    if (target) {
      const raised = world.raiseAlarm({
        source: this,
        target,
        origin: { x: this.x, y: this.y },
      });
      if (raised) yield { type: 'alarm', target: target.id };
    }
  }

  override takeTurn(world: World, rng: Rng): TurnActionStep[] {
    return [...this.takeTurnSteps(world, rng)];
  }

  /**
   * Find the first living deployed crew member in LOS + range. Escort extract
   * NPCs are player-aligned but not intruders — ignore them for alarm checks.
   */
  #findPlayerTarget(world: World): Entity | null {
    for (const entity of world.entities.values()) {
      if (!entity.alive || entity.faction !== FACTION.PLAYER) continue;
      if (entity instanceof EscortNpc) continue;
      if (!withinRange(this.x, this.y, entity.x, entity.y, this.sightRange)) continue;
      const blockers = world.blockerKeys();
      if (!hasConcealedLineOfSight(world.grid, this.x, this.y, entity.x, entity.y, { blockers })) {
        continue;
      }
      return entity;
    }
    return null;
  }
}
