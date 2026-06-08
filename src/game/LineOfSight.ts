/**
 * Line-of-sight + line-of-fire utilities.
 *
 * V1 uses a Bresenham line traced from origin to target, then enforced
 * symmetric — i.e. A sees B iff B sees A. Plain Bresenham can be asymmetric
 * around ties (the algorithm steps through different cells depending on
 * direction), so we trace both ways and require both to clear.
 *
 * The blueprint says walls block sight; cover does not (cover gives a
 * defender hit-modifier instead). This module enforces that:
 *   - `hasLineOfSight` ignores cover.
 *   - `hasConcealedLineOfSight` treats cover like a full occluder for
 *     civilian/flanker perception only.
 *   - `hasCoverBetween` reports whether the line crosses any cover so that
 *     `Combat` can apply the penalty.
 *
 * If Bresenham asymmetry ever produces visible "stairsteps" through walls
 * we'll swap in shadowcasting — see the milestone plan note.
 */

import { TILE } from './constants.js';
import type { Grid } from './Grid.js';
import type { GridPoint } from '../types.js';

/**
 * Intermediate tiles along the Bresenham line from (x0,y0) to (x1,y1),
 * exclusive of both endpoints. Returns an empty array for adjacent or
 * identical points.
 */
export function tilesBetween(x0: number, y0: number, x1: number, y1: number): GridPoint[] {
  const tiles: GridPoint[] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  // Standard integer Bresenham — step until we land on the target.
  for (;;) {
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x === x1 && y === y1) break;
    tiles.push({ x, y });
  }
  return tiles;
}

/**
 * Euclidean (circular) range check. Shared by Combat, Vision, and harness
 * targeting so "can see / can shoot" use one geometry. Before this helper
 * a prior harness was walking Chebyshev steps while Combat enforced
 * Euclidean — produced "phantom" out-of-range denials on diagonals.
 */
export function withinRange(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  range: number
): boolean {
  if (!Number.isFinite(range) || range < 0) {
    throw new RangeError(`withinRange: range must be ≥ 0, got ${range}`);
  }
  const dx = x1 - x0;
  const dy = y1 - y0;
  return dx * dx + dy * dy <= range * range;
}

/**
 * Walls (and out-of-bounds) block; cover does not. Symmetric: traces both
 * directions and requires both to clear.
 *
 * Pass `options.blockers` (a `Set<"x,y">`) to enforce entity occlusion —
 * any live entity standing on an intermediate tile breaks the sightline.
 * Bresenham excludes endpoints so the viewer / target tiles never block
 * themselves; callers can include them in the Set without filtering. We
 * keep this opt-in (instead of always taking a `World`) so the geometry
 * tests can drive the function with a bare `Grid`.
 */
export function hasLineOfSight(
  grid: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  options: { blockers?: Set<string> | null } = {}
): boolean {
  if (x0 === x1 && y0 === y1) return true;
  const blockers = options.blockers ?? null;
  return (
    clearsTrace(grid, tilesBetween(x0, y0, x1, y1), blockers) &&
    clearsTrace(grid, tilesBetween(x1, y1, x0, y0), blockers)
  );
}

/**
 * Civilian/flanker sight test: walls, smoke, entity blockers, and COVER
 * occlude. Combat deliberately does NOT use this; cover still permits fire
 * with a hit penalty there.
 */
export function hasConcealedLineOfSight(
  grid: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  options: { blockers?: Set<string> | null } = {}
): boolean {
  if (x0 === x1 && y0 === y1) return true;
  const blockers = options.blockers ?? null;
  return (
    clearsTrace(grid, tilesBetween(x0, y0, x1, y1), blockers, { coverBlocks: true }) &&
    clearsTrace(grid, tilesBetween(x1, y1, x0, y0), blockers, { coverBlocks: true })
  );
}

/**
 * True if any tile strictly between origin and target is COVER. Used by
 * Combat to apply the cover hit-penalty. Independent of LOS — cover doesn't
 * block sightlines, only modifies fire resolution.
 */
export function hasCoverBetween(
  grid: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): boolean {
  if (x0 === x1 && y0 === y1) return false;
  for (const { x, y } of tilesBetween(x0, y0, x1, y1)) {
    if (!grid.inBounds(x, y)) continue;
    if (grid.tileAt(x, y) === TILE.COVER) return true;
  }
  return false;
}

function clearsTrace(
  grid: Grid,
  tiles: GridPoint[],
  blockers: Set<string> | null,
  options: { coverBlocks?: boolean } = {}
): boolean {
  for (const { x, y } of tiles) {
    if (grid.blocksLineOfSight(x, y)) return false;
    if (options.coverBlocks && grid.inBounds(x, y) && grid.tileAt(x, y) === TILE.COVER) {
      return false;
    }
    if (blockers && blockers.has(`${x},${y}`)) return false;
  }
  return true;
}
