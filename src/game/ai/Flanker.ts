/**
 * Tier-3 **Flanker** — cover-concealed stalker and Razor mirror.
 *
 * Its identity is player-perception asymmetry: cover hides it from rendering
 * and direct targeting, and its silent SLIDE sets `slideConcealed` so it stays
 * vanished through the player's whole next turn unless they are adjacent.
 * While vanished it may reposition, but it never melees on that same activation.
 */

import {
  PatrolHostile,
  type PatrolHostileInit,
  type EngageSteps,
  type PatrolSnapshot,
} from './PatrolHostile.js';
import {
  AP_COST,
  ENEMY_ROLE,
  ENEMY_TIER,
  FLANKER_BASE_AP,
  HEAVY_MELEE_DAMAGE,
  resolveEnemyStats,
} from '../constants.js';
import type { EnemyTier } from '../constants.js';
import { canMelee, resolveMelee } from '../Combat.js';
import { hasConcealedLineOfSight } from '../LineOfSight.js';
import { canSlideTwoTiles, slideTwoTiles } from '../slide.js';
import type { Entity } from '../Entity.js';
import type { GridPoint } from '../../types.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export interface FlankerProps extends Omit<PatrolHostileInit, 'glyph'> {
  tier?: EnemyTier;
  slideConcealed?: boolean;
}

/** P2.7.M6.2: Flanker snapshot `extra` — the patrol block plus its slide-vanish flag. */
export type FlankerSnapshot = PatrolSnapshot & { slideConcealed: boolean };

const SLIDE_OFFSETS: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]);

export class Flanker extends PatrolHostile {
  slideConcealed: boolean;

  constructor({
    tier = ENEMY_TIER.T3,
    maxAp = FLANKER_BASE_AP,
    patrolWaypoints,
    slideConcealed = false,
    ...props
  }: FlankerProps) {
    const stats = resolveEnemyStats({ ...props, maxAp }, ENEMY_ROLE.ELITE, tier);
    super({ ...props, ...stats, glyph: 'f', patrolWaypoints });
    this.slideConcealed = !!slideConcealed;
  }

  get meleeDamage(): number {
    return HEAVY_MELEE_DAMAGE;
  }

  canSlide(world: World, dx: number, dy: number) {
    return canSlideTwoTiles(world, this, dx, dy);
  }

  slide(world: World, dx: number, dy: number): GridPoint {
    const to = slideTwoTiles(world, this, dx, dy);
    this.slideConcealed = true;
    return to;
  }

  override refreshAp(): void {
    super.refreshAp();
    this.slideConcealed = false;
  }

  protected override *engageSteps(world: World, rng: Rng, target: Entity): EngageSteps {
    if (this.slideConcealed) {
      if (this.ap < AP_COST.MOVE) return 'break';
      const step = this.stepToward(world, target.x, target.y, 'engage');
      if (!step) return 'break';
      yield step;
      return 'continue';
    }

    const meleeCheck = canMelee(world, this, target);
    if (meleeCheck.ok) {
      const result = resolveMelee(world, this, target, rng);
      yield { type: 'melee', target: target.id, result };
      return 'continue';
    }
    if (meleeCheck.reason !== 'not-adjacent' && meleeCheck.reason !== 'insufficient-ap') {
      return 'break';
    }

    const slide = this.#bestSlide(world, target);
    if (slide) {
      const to = this.slide(world, slide.dx, slide.dy);
      yield { type: 'slide', to };
      return 'continue';
    }

    if (this.ap < AP_COST.MOVE) return 'break';
    const step = this.stepToward(world, target.x, target.y, 'engage');
    if (!step) return 'break';
    yield step;
    return 'continue';
  }

  #bestSlide(world: World, target: Entity): { dx: number; dy: number } | null {
    if (this.ap < AP_COST.SLIDE) return null;
    const currentCheb = chebyshev(this.x, this.y, target.x, target.y);
    let best: { dx: number; dy: number; cheb: number; coverConcealed: boolean } | null = null;

    for (const [dx, dy] of SLIDE_OFFSETS) {
      if (!this.canSlide(world, dx, dy).ok) continue;
      const x = this.x + 2 * dx;
      const y = this.y + 2 * dy;
      const cheb = chebyshev(x, y, target.x, target.y);
      if (cheb >= currentCheb) continue;
      const coverConcealed = isCoverConcealedFrom(world, target, x, y);
      if (
        !best ||
        (coverConcealed && !best.coverConcealed) ||
        (coverConcealed === best.coverConcealed && cheb < best.cheb)
      ) {
        best = { dx, dy, cheb, coverConcealed };
      }
    }

    return best ? { dx: best.dx, dy: best.dy } : null;
  }
}

function chebyshev(x0: number, y0: number, x1: number, y1: number): number {
  return Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
}

function isCoverConcealedFrom(world: World, observer: Entity, x: number, y: number): boolean {
  return !hasConcealedLineOfSight(world.grid, observer.x, observer.y, x, y, {
    blockers: world.blockerKeys(),
  });
}
