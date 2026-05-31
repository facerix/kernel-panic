/**
 * Corp drone — the ranged fodder skirmisher. Shares the patrol → investigate →
 * engage state machine with all `PatrolHostile`s; its identity is the ENGAGE
 * behaviour implemented here:
 *
 * - **Fire** at a target in LOS + range when AP allows.
 * - **Kite** (M2.1): if a target closes inside `preferredMin`, step to the
 *   distance-maximising neighbour that still holds LOS instead of firing —
 *   "maintain distance or die at melee range." Cornered (no legal retreat that
 *   keeps LOS) → fall back to firing. A drone that already fired may lack the
 *   AP to retreat; that's the intended tradeoff.
 * - **Close** the gap one step when the target is out of fire range.
 *
 * Fire acquisition reuses Combat's `canFireRanged` so the "I see you" → fire
 * handoff can never disagree with itself (same `withinRange` + `hasLineOfSight`
 * geometry). The kite candidate test uses the same helpers so a retreat tile is
 * only chosen if the drone could still threaten from it.
 */

import {
  PatrolHostile,
  PATROL_STATE,
  type PatrolHostileInit,
  type EngageSteps,
} from './PatrolHostile.js';
import {
  FACTION,
  AP_COST,
  PREFERRED_MIN,
  ENEMY_ROLE,
  ENEMY_TIER,
  resolveEnemyStats,
} from '../constants.js';
import type { EnemyTier } from '../constants.js';
import { withinRange, hasLineOfSight } from '../LineOfSight.js';
import { canFireRanged, resolveRanged } from '../Combat.js';
import type { Entity } from '../Entity.js';
import type { CorpDroneMoveStep } from '../../types.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

// Re-exported under the historical name so persistence and existing callers
// keep importing `DRONE_STATE` from here. Drones and guards share these states.
export const DRONE_STATE = PATROL_STATE;

export interface CorpDroneProps extends Omit<PatrolHostileInit, 'faction' | 'glyph'> {
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

export class CorpDrone extends PatrolHostile {
  preferredMin: number;

  constructor({ tier = ENEMY_TIER.T1, preferredMin, patrolWaypoints, ...props }: CorpDroneProps) {
    const stats = resolveEnemyStats(props, ENEMY_ROLE.FODDER, tier);
    super({ ...props, ...stats, faction: FACTION.CORP, glyph: 'd', patrolWaypoints });
    const band = preferredMin ?? PREFERRED_MIN;
    if (!Number.isInteger(band) || band < 0) {
      throw new RangeError(`CorpDrone preferredMin must be a non-negative integer, got ${band}`);
    }
    this.preferredMin = band;
  }

  /**
   * Ranged engage with M2.1 kiting. Kite first (if too close and a retreat tile
   * holding LOS exists), else fire, else close.
   */
  protected override *engageSteps(world: World, rng: Rng, target: Entity): EngageSteps {
    // Kite: target inside the preferred band and we can afford to move.
    const cheb = Math.max(Math.abs(target.x - this.x), Math.abs(target.y - this.y));
    if (cheb < this.preferredMin && this.ap >= AP_COST.MOVE) {
      const retreat = this.#stepAwayFrom(world, target);
      if (retreat) {
        yield retreat;
        return 'continue';
      }
      // Cornered — no legal retreat that keeps LOS. Fall through and fire.
    }

    // Fire at sight range: `acquireTarget` qualifies targets by `this.sightRange`,
    // so the fire check must use the same range or a long-sighted drone could
    // see a target it can never shoot.
    const fireCheck = canFireRanged(world, this, target, { range: this.sightRange });
    if (fireCheck.ok) {
      const result = resolveRanged(world, this, target, rng, { range: this.sightRange });
      yield { type: 'fire', target: target.id, result };
      return 'continue';
    }
    if (fireCheck.reason !== 'insufficient-ap') {
      // Out-of-range or another rare reason at this layer — stop rather than
      // thrash; surfacing the state in the log helps debug.
      yield { type: 'fire-blocked', reason: fireCheck.reason ?? 'unknown' };
      return 'break';
    }
    // We have AP but not enough to fire — step toward to set up for next turn.
    if (this.ap < AP_COST.MOVE) return 'break';
    const step = this.stepToward(world, target.x, target.y, 'engage');
    if (!step) return 'break';
    yield step;
    return 'continue';
  }

  /**
   * Pick the legal neighbour tile that maximises Chebyshev distance to the
   * target while keeping line of sight (so the drone can still threaten/fire
   * next turn) and staying within `sightRange`. Returns the committed move
   * step, or `null` when no such tile exists (cornered).
   *
   * LOS is tested from the candidate tile with the drone's *own* current tile
   * removed from the blocker set — it vacates that tile on the move, so a
   * straight-line retreat (old tile collinear with the line) must not
   * false-block itself.
   */
  #stepAwayFrom(world: World, target: Entity): CorpDroneMoveStep | null {
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
      if (cheb <= bestCheb) continue; // must strictly increase distance
      if (!withinRange(nx, ny, target.x, target.y, this.sightRange)) continue;
      if (!hasLineOfSight(world.grid, nx, ny, target.x, target.y, { blockers })) continue;
      // Never kite ourselves blind: only retreat to a tile from which the
      // target stays acquirable. A stealthed target is only spottable at
      // Chebyshev ≤1, so backing off would drop it — stand and fire instead.
      if (!target.isSpottableBy({ x: nx, y: ny })) continue;
      bestCheb = cheb;
      bestDx = dx;
      bestDy = dy;
    }

    if (bestDx === 0 && bestDy === 0) return null;
    world.moveEntity(this, bestDx, bestDy);
    return { type: 'move-engage', to: { x: this.x, y: this.y } } satisfies CorpDroneMoveStep;
  }
}
