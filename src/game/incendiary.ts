/**
 * Molotov throw geometry (P3.6).
 *
 * A thrown incendiary is aimed as a direction, not a point: the keymap emits a
 * unit `(dx, dy)` and the bottle flies along that 8-way ray until something
 * stops it. This module answers the only question that matters — *where does it
 * land* — and nothing else. Stamping the fire is `placeHazardCluster`'s job
 * (Run.ts); paying AP and consuming the charge is `Crew.useConsumable`'s.
 *
 * This replaces the original rule, which was "land at exactly
 * `thrower + dir * INCENDIARY_THROW_DIST`, and refuse the throw outright if
 * line-of-sight to that one tile is blocked." That rule had two problems: a
 * hostile standing between you and the max-range tile was simply flown past,
 * and a wall anywhere on the line turned the throw into a `USE FAILED` instead
 * of a short throw. Both are now impacts.
 *
 * Two independent predicates drive the walk, and keeping them separate is the
 * whole trick:
 *
 *   - **Does it stop the bottle?** `World.entityAt` (which already excludes
 *     passable props and pickups) plus `TILE.WALL`. This gets doors right for
 *     free — `Door.passable = !locked`, so a locked door is a backstop and an
 *     open one is a hole to throw through.
 *   - **Does it catch the fire?** `Entity.isHazardImmune()`. A drone catches
 *     it; a locked door or a terminal stops it without becoming the impact
 *     point, because the fire has to land on ground that can burn.
 *
 * Cover is deliberately in neither set: a molotov is a thrown arc, so it clears
 * chest-high cover the same way `hasLineOfSight` ignores it and `Combat` treats
 * it as a hit-modifier rather than an occluder. But cover is not ground fire can
 * take (`thrownFireCanTake`), so it is never an impact centre either — the
 * bottle passes over it and, if nothing beyond catches it, the centre pulls back
 * to the last tile that can hold fire. Which tiles those are (FLOOR, RUBBLE,
 * HAZARD — not EXIT/SMOKE) lives in `thrownFireCanTake` so `canHoldFire` here
 * and `placeHazardCluster`'s stamp cannot disagree.
 */

import { TILE, thrownFireCanTake, type TileId } from './constants.js';
import type { Entity } from './Entity.js';
import type { World } from './World.js';
import type { GridPoint } from '../types.js';

export type IncendiaryImpact = GridPoint & {
  /**
   * The body the bottle hit, when one stopped it — credited so callers can
   * report "caught square on" and so the shell can flash the right tile.
   * `null` when the throw landed on open ground (max range, or short of a wall).
   * Never a hazard-immune prop: those stop the bottle but cannot be its centre.
   */
  intercepted: Entity | null;
};

/**
 * The tiles a thrown incendiary can be centred on.
 *
 * Delegates to `thrownFireCanTake` (constants.ts) — the exact predicate
 * `placeHazardCluster`'s thrown branch stamps against — so an impact point is
 * always somewhere fire can actually take. Sharing the one predicate is what
 * stops the two from drifting into the silent "used the charge, got nothing"
 * bug this rule exists to prevent.
 */
function canHoldFire(world: World, x: number, y: number): boolean {
  return thrownFireCanTake(world.grid.tileAt(x, y) as TileId);
}

/** Walls stop a thrown bottle. Cover does not — see the module note. */
function blocksThrow(world: World, x: number, y: number): boolean {
  return world.grid.tileAt(x, y) === TILE.WALL;
}

/**
 * Walk the throw ray and report where the bottle detonates.
 *
 * @param world   the meat world — read only, never mutated here.
 * @param origin  the thrower's tile. Excluded from the walk: the bottle leaves
 *                your hand, so you are never your own backstop and never your
 *                own impact point.
 * @param aim     unit direction, one of the 8 compass steps. A non-unit or zero
 *                aim is a wiring bug in the caller (the keymap and
 *                `Crew.useConsumable` both validate first), so it throws.
 * @param maxDist how many steps the bottle carries — `INCENDIARY_THROW_DIST`.
 *
 * @returns the impact point, or `null` when the ray never crosses a tile that
 *   can hold fire and nothing caught it — you are facing an adjacent wall, or
 *   throwing off the map edge. There is no sensible place for the fire to go,
 *   so the caller must refuse the throw *before* spending AP or the charge
 *   rather than eating the bottle for nothing.
 */
export function resolveIncendiaryImpact(
  world: World,
  origin: GridPoint,
  aim: { dx: number; dy: number },
  maxDist: number
): IncendiaryImpact | null {
  const { dx, dy } = aim;
  if (
    !Number.isInteger(dx) ||
    !Number.isInteger(dy) ||
    (dx === 0 && dy === 0) ||
    Math.abs(dx) > 1 ||
    Math.abs(dy) > 1
  ) {
    throw new RangeError(
      `resolveIncendiaryImpact: aim (${dx}, ${dy}) must be a non-zero integer unit vector`
    );
  }
  if (!Number.isInteger(maxDist) || maxDist < 1) {
    throw new RangeError(
      `resolveIncendiaryImpact: throw distance must be an integer >= 1, got ${maxDist}`
    );
  }

  // The best place found so far that fire could actually take. Seeded null, not
  // `origin`: a throw with nowhere to go is refused, not smashed at your feet.
  let lastClear: GridPoint | null = null;

  for (let step = 1; step <= maxDist; step++) {
    const x = origin.x + dx * step;
    const y = origin.y + dy * step;
    // Off the map or into a wall: the bottle goes no further. Whatever clear
    // ground it already passed over is where it falls.
    if (!world.grid.inBounds(x, y)) break;
    if (blocksThrow(world, x, y)) break;

    const occupant = world.entityAt(x, y);
    if (occupant) {
      // A body catches it square on — that tile is the centre even if the
      // terrain underneath is rubble or already burning.
      if (!occupant.isHazardImmune()) {
        return { x, y, intercepted: occupant };
      }
      // A hazard-immune blocker (locked door, terminal, sync pad) is a
      // backstop that cannot burn. The bottle stops against it and drops onto
      // the last clear ground behind it.
      break;
    }

    if (canHoldFire(world, x, y)) {
      lastClear = { x, y };
    }
  }

  if (!lastClear) return null;
  return { x: lastClear.x, y: lastClear.y, intercepted: null };
}
