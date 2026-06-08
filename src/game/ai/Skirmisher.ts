/**
 * Ranged fodder skirmisher. Shares the patrol → investigate → engage state
 * machine with all `PatrolHostile`s; its identity is the ENGAGE behaviour:
 *
 * - **Fire** at a target in LOS + range when AP allows.
 * - **Kite**: if a target closes inside `preferredMin`, step to the
 *   distance-maximising neighbour that still holds LOS instead of firing —
 *   "maintain distance or die at melee range." Cornered (no legal retreat that
 *   keeps LOS) → fall back to firing. A unit that already fired may lack the
 *   AP to retreat; that's the intended tradeoff.
 * - **Close** the gap one step when the target is out of fire range.
 *
 * Fire acquisition reuses Combat's `canFireRanged` so the "I see you" → fire
 * handoff can never disagree with itself (same `withinRange` + `hasLineOfSight`
 * geometry). The kite candidate test uses the same helpers so a retreat tile is
 * only chosen if the skirmisher could still threaten from it.
 */

import { PatrolHostile, type PatrolHostileInit, type EngageSteps } from './PatrolHostile.js';
import { AP_COST, PREFERRED_MIN, ENEMY_ROLE, ENEMY_TIER, resolveEnemyStats } from '../constants.js';
import type { EnemyTier } from '../constants.js';
import { withinRange, hasLineOfSight } from '../LineOfSight.js';
import { canFireRanged, resolveRanged } from '../Combat.js';
import type { Entity } from '../Entity.js';
import type { PatrolHostileMoveStep } from '../../types.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export interface SkirmisherProps extends Omit<PatrolHostileInit, 'glyph'> {
  tier?: EnemyTier;
  /** Kiting band override — retreat when a target is within `preferredMin`. */
  preferredMin?: number;
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]);

export class Skirmisher extends PatrolHostile {
  preferredMin: number;

  constructor({ tier = ENEMY_TIER.T1, preferredMin, patrolWaypoints, ...props }: SkirmisherProps) {
    const stats = resolveEnemyStats(props, ENEMY_ROLE.FODDER, tier);
    super({ ...props, ...stats, glyph: 'k', patrolWaypoints });
    const band = preferredMin ?? PREFERRED_MIN;
    if (!Number.isInteger(band) || band < 0) {
      throw new RangeError(`Skirmisher preferredMin must be a non-negative integer, got ${band}`);
    }
    this.preferredMin = band;
  }

  /**
   * Ranged engage with kiting. Kite first (if too close and a retreat tile
   * holding LOS exists), else fire, else close.
   */
  protected override *engageSteps(world: World, rng: Rng, target: Entity): EngageSteps {
    const cheb = Math.max(Math.abs(target.x - this.x), Math.abs(target.y - this.y));
    if (cheb < this.preferredMin && this.ap >= AP_COST.MOVE) {
      const retreat = this.#stepAwayFrom(world, target);
      if (retreat) {
        yield retreat;
        return 'continue';
      }
    }

    const fireCheck = canFireRanged(world, this, target, { range: this.sightRange });
    if (fireCheck.ok) {
      const result = resolveRanged(world, this, target, rng, { range: this.sightRange });
      yield { type: 'fire', target: target.id, result };
      return 'continue';
    }
    if (fireCheck.reason !== 'insufficient-ap') {
      yield { type: 'fire-blocked', reason: fireCheck.reason ?? 'unknown' };
      return 'break';
    }
    if (this.ap < AP_COST.MOVE) return 'break';
    const step = this.stepToward(world, target.x, target.y, 'engage');
    if (!step) return 'break';
    yield step;
    return 'continue';
  }

  #stepAwayFrom(world: World, target: Entity): PatrolHostileMoveStep | null {
    const blockers = world.blockerKeys();
    blockers.delete(`${this.x},${this.y}`);
    const curCheb = Math.max(Math.abs(target.x - this.x), Math.abs(target.y - this.y));

    let bestDx = 0;
    let bestDy = 0;
    let bestCheb = curCheb;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      if (!world.canMoveEntity(this, dx, dy).ok) continue;
      const nx = this.x + dx;
      const ny = this.y + dy;
      const cheb = Math.max(Math.abs(target.x - nx), Math.abs(target.y - ny));
      if (cheb <= bestCheb) continue;
      if (!withinRange(nx, ny, target.x, target.y, this.sightRange)) continue;
      if (!hasLineOfSight(world.grid, nx, ny, target.x, target.y, { blockers })) continue;
      if (!target.isSpottableBy({ x: nx, y: ny })) continue;
      bestCheb = cheb;
      bestDx = dx;
      bestDy = dy;
    }

    if (bestDx === 0 && bestDy === 0) return null;
    world.moveEntity(this, bestDx, bestDy);
    return { type: 'move-engage', to: { x: this.x, y: this.y } } satisfies PatrolHostileMoveStep;
  }
}
