/**
 * Per-viewer visibility + memory.
 *
 * `visible` — tiles with a clean LOS to the viewer right now. Recomputed
 *   every time the viewer moves (or the grid mutates, which won't happen
 *   until destruction lands in M7).
 * `seen` — every tile that has ever been visible. Persistent so the renderer
 *   can dim previously-explored areas — classic roguelike fog of war.
 *
 * Sight is a circular range capped by `SIGHT_RANGE`, intersected with LOS.
 * The viewer's own tile is always visible regardless of LOS — otherwise
 * `hasLineOfSight(self, self)` would short-circuit but a zero-radius range
 * wouldn't add the tile.
 */

import { hasLineOfSight } from './LineOfSight.js';
import { SIGHT_RANGE } from './constants.js';
import type { Entity } from './Entity.js';
import type { Grid } from './Grid.js';

type RecomputeOptions = {
  blockers?: Set<string> | null;
};

const keyOf = (x: number, y: number): string => `${x},${y}`;

export class VisionField {
  visible: Set<string>;
  seen: Set<string>;
  memorisedCorpses: Map<string, { x: number; y: number; faction: string }>;

  constructor() {
    this.visible = new Set();
    this.seen = new Set();
    /**
     * Corpse positions memorised during this job. Updated when a kill occurs
     * within current LOS (the shell wires `entity:damaged` with `killed: true`
     * to `memoriseCorpse`). Rendered at `MEMORY_DIM` when the tile is out of
     * current LOS but has been `seen`. Cleared when a new combat episode
     * starts ({@link resetFogState} from the shell).
     *
     * @type {Map<string, { x: number, y: number, faction: string }>}
     */
    this.memorisedCorpses = new Map();
  }

  /**
   * Record a corpse's position so the frame builder can render it dimly when
   * the tile leaves current LOS. Called by the shell's `entity:damaged`
   * listener when `killed` is true and the corpse tile is currently visible.
   * Cleared with {@link resetFogState} when a new combat episode starts.
   */
  memoriseCorpse(entity: Entity) {
    const k = keyOf(entity.x, entity.y);
    this.memorisedCorpses.set(k, {
      x: entity.x,
      y: entity.y,
      faction: entity.faction,
    });
  }

  /** Clear all corpse memory — used when tearing down fog for a new grid. */
  clearCorpseMemory() {
    this.memorisedCorpses.clear();
  }

  /**
   * Drop `visible`, `seen`, and corpse memory in one shot. The main shell
   * calls this when **jacking into** a new combat map so coordinates from the
   * previous job cannot paint memorised corpses or exploration into the new
   * episode (the `VisionField` instance outlives each `Run`).
   */
  resetFogState() {
    this.visible.clear();
    this.seen.clear();
    this.memorisedCorpses.clear();
  }

  /**
   * Recompute `visible` (and merge into `seen`) given a viewer position.
   * `range` defaults to `SIGHT_RANGE`. Uses Euclidean range (circular FOV)
   * over the bounding box, then a per-cell LOS check.
   *
   * Pass `options.blockers` (a `Set<"x,y">`, e.g. from `World.blockerKeys()`)
   * to enforce entity occlusion — a drone standing on the line hides what's
   * behind it. The set may include the viewer's own tile; Bresenham excludes
   * trace endpoints so it won't block the viewer's own visibility.
   *
   * The module itself is pure — it doesn't subscribe to anything. The harness
   * (and the eventual game-loop owner) wires this to the M5 `EventBus`:
   * recompute on the player's own moves, *and* on `entity:moved` for non-
   * player factions, so a drone walking into LOS becomes visible without
   * waiting for the player to step.
   */
  recompute(grid: Grid, viewer: Entity, range = SIGHT_RANGE, options: RecomputeOptions = {}) {
    if (!Number.isInteger(range) || range < 0) {
      throw new RangeError(`vision range must be a non-negative integer, got ${range}`);
    }
    this.visible.clear();
    const { x: ox, y: oy } = viewer;
    if (!grid.inBounds(ox, oy)) {
      throw new RangeError(`viewer (${ox}, ${oy}) out of grid bounds`);
    }
    const blockers = options.blockers ?? null;
    const r2 = range * range;
    const xMin = Math.max(0, ox - range);
    const xMax = Math.min(grid.width - 1, ox + range);
    const yMin = Math.max(0, oy - range);
    const yMax = Math.min(grid.height - 1, oy + range);

    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const dx = x - ox;
        const dy = y - oy;
        if (dx * dx + dy * dy > r2) continue;
        if (!hasLineOfSight(grid, ox, oy, x, y, { blockers })) continue;
        const k = keyOf(x, y);
        this.visible.add(k);
        this.seen.add(k);
      }
    }
  }

  isVisible(x: number, y: number): boolean {
    return this.visible.has(keyOf(x, y));
  }

  hasSeen(x: number, y: number): boolean {
    return this.seen.has(keyOf(x, y));
  }
}
