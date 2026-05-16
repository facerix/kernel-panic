import {
  glyphForTile,
  glyphForEntity,
  glyphForCorpse,
  dimGlyph,
  dimColor,
  OOB_GLYPH,
  UNSEEN_GLYPH,
  CORPSE_GLYPH_CHAR,
  MEMORY_DIM,
} from './palette.js';

/**
 * Pure frame builder — converts world state + a camera viewport into a flat
 * array of glyphs. The renderer paints those glyphs onto canvas; this module
 * has no DOM dependency and is exhaustively unit-tested.
 *
 * A camera/viewport is `{ x, y, width, height }` — top-left in world coords,
 * size in tiles. Cells outside the world map to `OOB_GLYPH`.
 *
 * Optional fog of war: pass `{ vision }` (a `VisionField`) to fade tiles
 * outside line of sight. Cells the viewer has never seen render as
 * `UNSEEN_GLYPH` (true black). Cells previously seen but currently
 * out-of-LOS render the dim tile glyph but no entity — entity positions
 * aren't memorised, so a drone that ducked behind a wall vanishes.
 *
 * Corpses render via `glyphForCorpse` when their tile is currently visible.
 * M3 added **corpse memorisation**: when a kill occurs within current LOS,
 * the shell calls `vision.memoriseCorpse(entity)`, and the memory pass here
 * renders memorised corpses at `MEMORY_DIM` (dimmer than a live corpse in
 * LOS). This lets the player navigate back to loot. Live entities moving
 * onto a corpse tile still win the cell.
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
 * @param {{ vision?: import('../game/Vision.js').VisionField }} [options]
 */
export function buildFrame(world, camera, options = {}) {
  const { x: cx, y: cy, width, height } = camera;
  const { vision } = options;
  const cells = Array.from({ length: width * height });

  // Index entities once so we don't pay an O(n) scan per cell. Two-pass:
  // dead first, then live, so a live entity standing on a corpse's tile
  // overwrites it — the live silhouette is what the player needs to react to.
  const entityIndex = new Map();
  for (const e of world.entities.values()) {
    if (!e.alive) entityIndex.set(`${e.x},${e.y}`, e);
  }
  for (const e of world.entities.values()) {
    if (e.alive) entityIndex.set(`${e.x},${e.y}`, e);
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

      if (vision) {
        if (vision.isVisible(wx, wy)) {
          cells[idx] = glyphForCell(world, entityIndex, wx, wy);
        } else if (vision.hasSeen(wx, wy)) {
          // Memory pass: tile only for live entities (we don't track where
          // they are). Memorised corpses render at MEMORY_DIM so the player
          // can navigate back to loot them. The corpse glyph uses its faction
          // colour at the memory dim factor.
          const corpseRec = vision.memorisedCorpses?.get(`${wx},${wy}`);
          if (corpseRec) {
            const fg = factionFgForMemory(corpseRec.faction);
            cells[idx] = { char: CORPSE_GLYPH_CHAR, fg: dimColor(fg, MEMORY_DIM) };
          } else {
            cells[idx] = dimGlyph(glyphForTile(world.grid.tileAt(wx, wy)));
          }
        } else {
          cells[idx] = UNSEEN_GLYPH;
        }
        continue;
      }

      cells[idx] = glyphForCell(world, entityIndex, wx, wy);
    }
  }

  return { width, height, cells };
}

/**
 * Pick the glyph for a single visible cell, favouring entities over terrain.
 * Live entities render full-bright; corpses render via `glyphForCorpse`.
 */
function glyphForCell(world, entityIndex, wx, wy) {
  const entity = entityIndex.get(`${wx},${wy}`);
  if (entity) {
    return entity.alive ? glyphForEntity(entity) : glyphForCorpse(entity);
  }
  return glyphForTile(world.grid.tileAt(wx, wy));
}

/**
 * Resolve a faction string to its canonical foreground colour. Used by the
 * memorised-corpse path which stores a faction string rather than a full
 * entity reference. Uses `glyphForEntity` on a minimal shim so the colour
 * mapping has one source of truth in `palette.js`.
 */
function factionFgForMemory(faction) {
  return glyphForEntity({ faction, glyph: '?' }).fg;
}
