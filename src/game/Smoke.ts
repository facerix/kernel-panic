/**
 * Smoke cloud placement for the Smoke Charge consumable.
 *
 * Smoke is a timed tile effect — FLOOR/EXIT tiles under the cloud are replaced
 * with `TILE.SMOKE`, which is passable but blocks LOS. Lifetime is owned by
 * `World.applyTileEffect`: placed on the player's turn, it blocks drone LOS
 * through the following corp turn, and `World.tickTileEffects` clears it at the
 * round boundary before the player acts again.
 *
 * Cleanup used to be the *shell's* job (`shellRuntime.activeSmokeOverlays`,
 * cleared on `onPlayerTurnReady`), which quietly broke across saves: the grid is
 * persisted, that overlay list was not, and autosave fires at the player→corp
 * hand-off — exactly when smoke is on the map. Save inside your own cloud,
 * reload, and the SMOKE tiles came back with no overlay left to clear them: a
 * permanent sight-line wall. Lifetimes now live with the grid they mutate.
 *
 * Pure module — no DOM, no side-effects beyond the world's grid.
 */

import { SMOKE_DURATION, TILE } from './constants.js';
import type { World } from './World.js';
import type { GridPoint } from '../types.js';

/**
 * Place a smoke cloud centered on (cx, cy) with the given Chebyshev radius.
 * Only FLOOR and EXIT tiles are converted — walls and cover are unaffected
 * (smoke doesn't fill solid objects), and tiles already carrying an effect
 * (a burning hazard, say) are left to it. Out-of-bounds tiles are skipped.
 *
 * @returns the tiles that took smoke.
 */
export function placeSmoke(world: World, cx: number, cy: number, radius: number): GridPoint[] {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new RangeError(`placeSmoke requires a non-negative integer radius, got ${radius}`);
  }
  const placed: GridPoint[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!world.grid.inBounds(x, y)) continue;
      const t = world.grid.tileAt(x, y);
      if (t !== TILE.FLOOR && t !== TILE.EXIT) continue;
      world.applyTileEffect(x, y, TILE.SMOKE, SMOKE_DURATION);
      placed.push({ x, y });
    }
  }
  return placed;
}
