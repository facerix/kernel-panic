/**
 * Tier-3 **Juggernaut** — the soak/attrition elite and the **Tech mirror**: a
 * walking suppression platform rather than a deploy verb. Where the Bruiser is
 * the T3 Guard (fast melee that owns adjacency), the Juggernaut is the T3
 * Skirmisher (ranged band control + armor). High HP + armor, low AP.
 *
 * Identity lives in the ENGAGE behaviour (`engageSteps`), not a new state
 * machine — it shares the patrol → investigate → engage shell with every
 * `PatrolHostile`. Acquisition/patrol use the baseline `SIGHT_RANGE` (8); fire
 * validation uses the tighter `JUGGERNAUT_SUPPRESS_RANGE` (5) only.
 *
 * Engage priority (Phase 2.7 M4.2):
 *   1. **Band-kite** — if a target closes inside `preferredMin` and a legal
 *      neighbour still holds the suppress band + LOS, step to the
 *      distance-maximising one. This is *maintain gunner distance*, not the
 *      skirmisher's fear-flee: the retreat tile must stay within suppress range.
 *   2. **Cornered shove** — if the target is adjacent and no band-kite tile
 *      exists (a dead-end), body-check the target one tile away: a **no-damage
 *      knockback** that reopens the band so the elite can resume suppressing next
 *      turn, rather than firing point-blank. Defensive spacing reset, *not* the
 *      Bruiser's offensive knockback-on-hit. A blocked lane → hold ground.
 *   3. **Suppress** — in band + LOS + spottable + AP → 1-AP / 1-damage chip via
 *      `resolveRanged` at suppress range (normal hit roll + cover penalties,
 *      emits ranged NOISE). The only ranged verb; no burst, no second shot type.
 *   4. **Advance** — one `stepToward` per corp turn to close into the band.
 *
 * Never deploys or spawns a `$`/`T` turret entity (the body *is* the denial
 * asset). Never matches the skirmisher's 4-AP dance: base AP is low so a typical
 * corp turn is move + suppress, or suppress twice when already in the band.
 */

import { PatrolHostile, type PatrolHostileInit, type EngageSteps } from './PatrolHostile.js';
import {
  AP_COST,
  ENEMY_ROLE,
  ENEMY_TIER,
  JUGGERNAUT_SUPPRESS_RANGE,
  JUGGERNAUT_SUPPRESS_AP,
  JUGGERNAUT_SUPPRESS_DAMAGE,
  JUGGERNAUT_PREFERRED_MIN,
  JUGGERNAUT_BASE_AP,
  resolveEnemyStats,
} from '../constants.js';
import type { EnemyTier } from '../constants.js';
import { withinRange, hasLineOfSight } from '../LineOfSight.js';
import { canFireRanged, resolveRanged, canMelee } from '../Combat.js';
import { knockbackByOffset, awayVector } from '../knockback.js';
import type { Entity } from '../Entity.js';
import type { PatrolHostileMoveStep } from '../../types.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export interface JuggernautProps extends Omit<PatrolHostileInit, 'glyph'> {
  tier?: EnemyTier;
  /** Band floor override — band-kite when a target closes within `preferredMin`. */
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

export class Juggernaut extends PatrolHostile {
  preferredMin: number;

  constructor({
    tier = ENEMY_TIER.T3,
    preferredMin,
    maxAp = JUGGERNAUT_BASE_AP,
    patrolWaypoints,
    ...props
  }: JuggernautProps) {
    // Resolve elite stat scaling from the *base* (low) AP so the T3 apBonus
    // lifts a 3-AP body to 4, not a 4-AP body to 5 (that band is the Bruiser's).
    const stats = resolveEnemyStats({ ...props, maxAp }, ENEMY_ROLE.ELITE, tier);
    super({ ...props, ...stats, glyph: 'j', patrolWaypoints });
    const band = preferredMin ?? JUGGERNAUT_PREFERRED_MIN;
    if (!Number.isInteger(band) || band < 0) {
      throw new RangeError(`Juggernaut preferredMin must be a non-negative integer, got ${band}`);
    }
    this.preferredMin = band;
  }

  /**
   * Suppress-platform engage: band-kite when crowded, shove when cornered
   * point-blank, suppress from the band, else advance. See the class header for
   * the full priority rationale.
   */
  protected override *engageSteps(world: World, rng: Rng, target: Entity): EngageSteps {
    const cheb = Math.max(Math.abs(target.x - this.x), Math.abs(target.y - this.y));
    const insideBand = cheb < this.preferredMin;

    // (1) Band-kite — back off to the farthest neighbour that still holds the
    // suppress band + LOS. Maintains gunner distance; does not flee the fight.
    if (insideBand && this.ap >= AP_COST.MOVE) {
      const retreat = this.#stepAwayFrom(world, target);
      if (retreat) {
        yield retreat;
        return 'continue';
      }
    }

    // (2) Cornered shove — adjacent with no band-kite tile (dead-end). Body-check
    // the target one tile away to *reopen* the suppress band, rather than firing
    // point-blank. No damage: this is a defensive spacing reset, distinct from
    // the Bruiser's offensive knockback-on-hit. If the lane is blocked
    // (wall/OOB/occupied) the elite can't create space — it holds its ground.
    if (insideBand && canMelee(world, this, target).ok) {
      const away = awayVector(this, target);
      const landing = away ? knockbackByOffset(world, target, away.x, away.y) : null;
      if (landing) {
        this.spendAp(AP_COST.MELEE_ATTACK);
        yield { type: 'shove', target: target.id, to: landing };
        return 'continue';
      }
      return 'break';
    }

    // (3) Suppress — cheap attrition chip from the band. `freeShot` bypasses the
    // 2-AP ranged gate so we can charge the 1-AP suppress cost ourselves; the
    // hit roll, cover penalty, and ranged NOISE all resolve normally.
    if (
      this.ap >= JUGGERNAUT_SUPPRESS_AP &&
      target.isSpottableBy(this) &&
      canFireRanged(world, this, target, { range: JUGGERNAUT_SUPPRESS_RANGE, freeShot: true }).ok
    ) {
      this.spendAp(JUGGERNAUT_SUPPRESS_AP);
      const result = resolveRanged(world, this, target, rng, {
        range: JUGGERNAUT_SUPPRESS_RANGE,
        damage: JUGGERNAUT_SUPPRESS_DAMAGE,
        freeShot: true,
      });
      yield { type: 'suppress', target: target.id, result };
      return 'continue';
    }

    // (4) Advance one step into the band.
    if (this.ap < AP_COST.MOVE) return 'break';
    const step = this.stepToward(world, target.x, target.y, 'engage');
    if (!step) return 'break';
    yield step;
    return 'continue';
  }

  /**
   * Band-kite: step to the legal neighbour with the greatest Chebyshev distance
   * to the target that *still* holds the suppress band (`JUGGERNAUT_SUPPRESS_RANGE`)
   * + LOS + spottability. Scoping the retreat to suppress range (not the wider
   * sight range) is what makes this *maintain gunner distance* rather than flee:
   * the juggernaut never backs out of its own firing band.
   */
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
      if (!withinRange(nx, ny, target.x, target.y, JUGGERNAUT_SUPPRESS_RANGE)) continue;
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
