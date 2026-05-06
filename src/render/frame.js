import { glyphForTile, glyphForEntity, OOB_GLYPH } from './palette.js';

/**
 * Pure frame builder — converts world state + a camera viewport into a flat
 * array of glyphs. The renderer paints those glyphs onto canvas; this module
 * has no DOM dependency and is exhaustively unit-tested.
 *
 * A camera/viewport is `{ x, y, width, height }` — top-left in world coords,
 * size in tiles. Cells outside the world map to `OOB_GLYPH`.
 */

/**
 * @param {{ x: number, y: number }} target
 * @param {{ width: number, height: number }} viewport
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function cameraFor(target, viewport) {
  if (!Number.isInteger(viewport.width) || viewport.width <= 0) {
    throw new RangeError(`viewport.width must be a positive integer, got ${viewport.width}`);
  }
  if (!Number.isInteger(viewport.height) || viewport.height <= 0) {
    throw new RangeError(`viewport.height must be a positive integer, got ${viewport.height}`);
  }
  return {
    x: target.x - Math.floor(viewport.width / 2),
    y: target.y - Math.floor(viewport.height / 2),
    width: viewport.width,
    height: viewport.height,
  };
}

/**
 * @param {import('../game/World.js').World} world
 * @param {{ x: number, y: number, width: number, height: number }} camera
 */
export function buildFrame(world, camera) {
  const { x: cx, y: cy, width, height } = camera;
  const cells = Array.from({ length: width * height });

  // Index entities once so we don't pay an O(n) scan per cell.
  const entityIndex = new Map();
  for (const e of world.entities.values()) {
    if (!e.alive) continue;
    entityIndex.set(`${e.x},${e.y}`, e);
  }

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const wx = cx + dx;
      const wy = cy + dy;
      const idx = dy * width + dx;
      if (!world.grid.inBounds(wx, wy)) {
        cells[idx] = OOB_GLYPH;
        continue;
      }
      const entity = entityIndex.get(`${wx},${wy}`);
      cells[idx] = entity ? glyphForEntity(entity) : glyphForTile(world.grid.tileAt(wx, wy));
    }
  }

  return { width, height, cells };
}
