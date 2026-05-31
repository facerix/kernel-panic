/**
 * Tier-2 **Spotter** — a mobile combat specialist that never fires. Its force
 * multiplier is *coordination*: every corp turn it holds line of sight, it
 * pings the fireteam with the target's fresh coordinates, dragging every
 * subscribed patrol hostile onto the player (and refreshing stale pursuit data
 * so kiting doesn't shake them). Kill it, or keep breaking its sight, to defuse
 * the encounter — it is the canonical start of the T2 priority-target puzzle.
 *
 * **Not a `CorpCivilian`** (see phase-2.7-plan.md → "CorpCivilian vs Spotter"):
 * - Emits `ALARM` with `kind: 'spotter'` *directly on the bus* — no
 *   `World.raiseAlarm()`, so no facility latch and no Rep penalty.
 * - Pings **every** corp turn it holds LOS (civilians fire once per alert).
 * - Uses standard combat LOS (cover does not block it) and Hostile stealth
 *   rules — cover alone cannot permanently neutralise it; it repositions.
 *
 * Reuses the patrol → investigate → engage machine via `PatrolHostile`. Two
 * overrides express its identity:
 *  - `listensForAlarm() → false`: it is the *source* of pings, never a
 *    consumer (no self-wake, no facility coupling).
 *  - `engageSteps`: spot-only — emit the ping, then evasively reposition to a
 *    distance-maximising tile that still holds LOS (the skirmisher's kite,
 *    inverted into a vantage hunt). It never attacks.
 *  - `investigateStep`: when LOS is lost, seek the farthest tile that *restores*
 *    sight to the lead rather than closing on it.
 */

import { PatrolHostile, type PatrolHostileInit, type EngageSteps } from './PatrolHostile.js';
import {
  FACTION,
  AP_COST,
  ENEMY_ROLE,
  ENEMY_TIER,
  SPOTTER_SIGHT_RANGE,
  resolveEnemyStats,
} from '../constants.js';
import type { EnemyTier } from '../constants.js';
import type { PatrolHostileMoveKind, PatrolHostileMoveStep } from '../../types.js';
import { withinRange, hasLineOfSight } from '../LineOfSight.js';
import { EVENT, ALARM_KIND } from '../events.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export interface SpotterProps extends Omit<PatrolHostileInit, 'faction' | 'glyph'> {
  tier?: EnemyTier;
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

export class Spotter extends PatrolHostile {
  constructor({
    tier = ENEMY_TIER.T2,
    sightRange = SPOTTER_SIGHT_RANGE,
    patrolWaypoints,
    ...props
  }: SpotterProps) {
    const stats = resolveEnemyStats(props, ENEMY_ROLE.SPECIALIST, tier);
    super({ ...props, ...stats, sightRange, faction: FACTION.CORP, glyph: 's', patrolWaypoints });
  }

  /**
   * The spotter emits `spotter`-kind alarms; it must never consume them — no
   * self-wake, no coupling to the facility latch. (Axis 1 of the locked design.)
   */
  protected override listensForAlarm(): boolean {
    return false;
  }

  /**
   * Spot-only engage. Emit the target-share ping (every turn LOS holds), then
   * evasively reposition one step toward the farthest tile that still holds
   * LOS + range + a spottable target. Never attacks.
   */
  protected override *engageSteps(world: World, _rng: Rng, target: Entity): EngageSteps {
    world.events?.emit(EVENT.ALARM, {
      kind: ALARM_KIND.SPOTTER,
      source: this,
      target,
      origin: { x: this.x, y: this.y },
    });
    yield { type: 'spot', target: target.id };

    if (this.ap >= AP_COST.MOVE) {
      const step = this.#stepToVantage(world, target.x, target.y, {
        liveTarget: target,
        requireFarther: true,
        kind: 'engage',
      });
      if (step) yield step;
    }
    return 'break';
  }

  /**
   * Lost LOS: head for the farthest tile that *restores* sight to the lead,
   * not the lead itself. Falls back to closing in (base `stepToward`) when no
   * reachable neighbour regains LOS, so the spotter can reacquire.
   */
  protected override investigateStep(
    world: World,
    gx: number,
    gy: number
  ): PatrolHostileMoveStep | null {
    const vantage = this.#stepToVantage(world, gx, gy, {
      liveTarget: null,
      requireFarther: false,
      kind: 'investigate',
    });
    if (vantage) return vantage;
    return this.stepToward(world, gx, gy, 'investigate');
  }

  /**
   * Pick the legal neighbour with the greatest Chebyshev distance to `(tx, ty)`
   * that still holds sight (within `sightRange` + LOS, and — for a live target —
   * spottable from there). `requireFarther` gates whether the tile must beat the
   * current distance (engage: stay put if nothing improves) or merely qualify
   * (investigate: current tile has no LOS, so any restoring tile is progress).
   */
  #stepToVantage(
    world: World,
    tx: number,
    ty: number,
    opts: { liveTarget: Entity | null; requireFarther: boolean; kind: PatrolHostileMoveKind }
  ): PatrolHostileMoveStep | null {
    const blockers = world.blockerKeys();
    blockers.delete(`${this.x},${this.y}`);
    const curCheb = Math.max(Math.abs(tx - this.x), Math.abs(ty - this.y));

    let bestDx = 0;
    let bestDy = 0;
    let bestCheb = opts.requireFarther ? curCheb : -1;
    let found = false;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      if (!world.canMoveEntity(this, dx, dy).ok) continue;
      const nx = this.x + dx;
      const ny = this.y + dy;
      const cheb = Math.max(Math.abs(tx - nx), Math.abs(ty - ny));
      if (cheb <= bestCheb) continue;
      if (!withinRange(nx, ny, tx, ty, this.sightRange)) continue;
      if (!hasLineOfSight(world.grid, nx, ny, tx, ty, { blockers })) continue;
      if (opts.liveTarget && !opts.liveTarget.isSpottableBy({ x: nx, y: ny })) continue;
      bestCheb = cheb;
      bestDx = dx;
      bestDy = dy;
      found = true;
    }

    if (!found) return null;
    world.moveEntity(this, bestDx, bestDy);
    return {
      type: `move-${opts.kind}`,
      to: { x: this.x, y: this.y },
    } satisfies PatrolHostileMoveStep;
  }
}
