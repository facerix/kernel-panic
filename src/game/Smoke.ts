/**
 * Smoke cloud placement and cleanup for the Smoke Charge consumable (M4).
 *
 * Smoke is a grid overlay — FLOOR tiles under the cloud are temporarily
 * replaced with `TILE.SMOKE`, which is passable but blocks LOS. The overlay
 * records each original tile so `clearSmoke` can restore the grid exactly.
 *
 * Smoke lasts 1 turn: placed on the player's turn, blocks drone LOS during
 * the following corp turn, then clears at the start of the player's next
 * turn. The shell drives the lifecycle via `onPlayerTurnReady`.
 *
 * Pure module — no DOM, no side-effects beyond grid mutation.
 */

import { TILE } from './constants.js';
import type { Grid } from './Grid.js';

type SmokeOverlay = { x: number; y: number; originalTile: number };

/**
 * Place a smoke cloud centered on (cx, cy) with the given Chebyshev radius.
 * Only FLOOR and EXIT tiles are converted to SMOKE — walls and cover are
 * unaffected (smoke doesn't fill solid objects). Out-of-bounds tiles are
 * silently skipped.
 *
 * @returns {Array<SmokeOverlay>}
 *   Records for each tile converted, used by `clearSmoke` to restore.
 */
export function placeSmoke(grid: Grid, cx: number, cy: number, radius: number): SmokeOverlay[] {
  const overlays = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!grid.inBounds(x, y)) continue;
      const t = grid.tileAt(x, y);
      // Only replace passable, non-smoke tiles.
      if (t === TILE.FLOOR || t === TILE.EXIT) {
        overlays.push({ x, y, originalTile: t });
        grid.setTile(x, y, TILE.SMOKE);
      }
    }
  }
  return overlays;
}

/**
 * Remove smoke by restoring each overlay's original tile type. Idempotent —
 * calling with an empty array is a no-op.
 */
export function clearSmoke(grid: Grid, overlays: SmokeOverlay[]) {
  for (const { x, y, originalTile } of overlays) {
    if (grid.inBounds(x, y) && grid.tileAt(x, y) === TILE.SMOKE) {
      grid.setTile(x, y, originalTile);
    }
  }
}
