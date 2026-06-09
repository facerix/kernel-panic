import { TILE } from '../game/constants.js';
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
  INTERACTABLE_SECURED_FG,
} from './palette.js';
import { Interactable } from '../game/entities/Interactable.js';
import type { World } from '../game/World.js';
import type { Entity } from '../game/Entity.js';
import type { VisionField } from '../game/Vision.js';
import type { Glyph } from './palette.js';
import { isConcealedFromPlayer, sniperAimOverlayTiles } from '../game/playerPerception.js';
import type { FactionId, TileId } from '../game/constants.js';

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
 * **Corpse memorisation**: when a kill occurs within current LOS,
 * the shell calls `vision.memoriseCorpse(entity)`, and the memory pass here
 * renders memorised corpses at `MEMORY_DIM` (dimmer than a live corpse in
 * LOS). This lets the player navigate back to loot. Live entities moving
 * onto a corpse tile still win the cell.
 */

export type Viewport = {
  width: number;
  height: number;
};
export type Camera = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Frame = {
  width: number;
  height: number;
  cells: Glyph[];
};

/**
 * @param {{ x: number, y: number }} target
 * @param {{ width: number, height: number }} viewport
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function cameraFor(target: Entity, viewport: Viewport): Camera {
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

export type BuildFrameOptions = {
  vision?: VisionField;
  /**
   * Deployed crew member — enables player-perception conceal (sniper range
   * hide) and the aim crosshair overlay on marked targets.
   */
  player?: Entity;
  /**
   * `"x,y"` keys in world coords. Brief breaching-charge detonation flash: hazard
   * glyph (`▓`) on terrain in these cells (~`BREACH_BLAST_OVERLAY` ms).
   */
  blastOverlayKeys?: ReadonlySet<string>;
  lookCursor?: { x: number; y: number } | null;
  /** Combat terrain mood — `contract.context.principal.id` when in a job. */
  principalId?: string;
};

/** Sniper telegraph overlay — red crosshair composited over the target glyph. */
const AIM_CROSSHAIR_OVERLAY = Object.freeze({ char: '+', fg: '#ff4444' });

/** Presentation-only — does not mutate the grid. */
const BLAST_OVERLAY_GLYPH = glyphForTile(TILE.HAZARD);
/**
 * @param {import('../game/World.js').World} world
 * @param {{ x: number, y: number, width: number, height: number }} camera
 * @param {{ vision?: import('../game/Vision.js').VisionField }} [options]
 */
export function buildFrame(world: World, camera: Camera, options: BuildFrameOptions = {}): Frame {
  const { x: cx, y: cy, width, height } = camera;
  const { vision, blastOverlayKeys, lookCursor, player, principalId } = options;
  const cells: Glyph[] = Array.from({ length: width * height });

  const omitEntity = (e: Entity) => player && isConcealedFromPlayer(e, player, world);

  // Index entities once so we don't pay an O(n) scan per cell. Three-pass:
  // dead first, then passable live props, then impassable live actors — so a
  // drone stepping onto a walk-onto consumable pickup still renders the drone,
  // and a live entity standing on a corpse's tile still wins the cell.
  const entityIndex: Map<string, Entity> = new Map();
  for (const e of world.entities.values()) {
    if (!e.alive) entityIndex.set(`${e.x},${e.y}`, e);
  }
  for (const e of world.entities.values()) {
    if (e.alive && e.passable && !omitEntity(e)) entityIndex.set(`${e.x},${e.y}`, e);
  }
  for (const e of world.entities.values()) {
    if (e.alive && !e.passable && !omitEntity(e)) entityIndex.set(`${e.x},${e.y}`, e);
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
          cells[idx] = glyphForCell(world, entityIndex, wx, wy, blastOverlayKeys, principalId);
        } else if (vision.hasSeen(wx, wy)) {
          // Memory pass: tile only for live entities (we don't track where
          // they are). Memorised corpses render at MEMORY_DIM so the player
          // can navigate back to loot them. The corpse glyph uses its faction
          // colour at the memory dim factor.
          const entity = entityIndex.get(`${wx},${wy}`);
          const corpseRec = vision.memorisedCorpses.get(`${wx},${wy}`);
          // Only paint a memorised corpse while the body is still in the
          // world — looting strips the entity but used to leave stale memory.
          if (corpseRec && entity && !entity.alive) {
            const fg = factionFgForMemory(corpseRec.faction as FactionId);
            cells[idx] = { char: CORPSE_GLYPH_CHAR, fg: dimColor(fg, MEMORY_DIM) };
          } else {
            const tileGlyph = dimGlyph(
              glyphForTile(world.grid.tileAt(wx, wy) as TileId, principalId)
            );
            cells[idx] = blastTerrainOverlay(wx, wy, blastOverlayKeys, tileGlyph, { dim: true });
          }
        } else {
          cells[idx] = UNSEEN_GLYPH;
        }
        continue;
      }

      cells[idx] = glyphForCell(world, entityIndex, wx, wy, blastOverlayKeys, principalId);
    }
  }

  if (lookCursor) {
    const dx = lookCursor.x - cx;
    const dy = lookCursor.y - cy;
    if (dx >= 0 && dy >= 0 && dx < width && dy < height) {
      const idx = dy * width + dx;
      const cell = cells[idx];
      if (cell && cell.char !== OOB_GLYPH.char) {
        cells[idx] = { ...cell, fg: '#06110f', bg: '#00d9a5' };
      }
    }
  }

  // Sniper aim telegraph — red crosshair composited over the marked target
  // (player glyph stays visible underneath). Look-cursor highlight wins on
  // the same cell.
  for (const { x: tx, y: ty } of sniperAimOverlayTiles(world)) {
    const dx = tx - cx;
    const dy = ty - cy;
    if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
    if (lookCursor && lookCursor.x === tx && lookCursor.y === ty) continue;
    const idx = dy * width + dx;
    const cell = cells[idx];
    if (!cell || cell.char === OOB_GLYPH.char) continue;
    cells[idx] = { ...cell, overlay: AIM_CROSSHAIR_OVERLAY };
  }

  return { width, height, cells };
}

/**
 * Pick the glyph for a single visible cell, favouring entities over terrain.
 * Live entities render full-bright; corpses render via `glyphForCorpse`.
 */
function glyphForCell(
  world: World,
  entityIndex: Map<string, Entity>,
  wx: number,
  wy: number,
  blastOverlayKeys: ReadonlySet<string> | undefined,
  principalId?: string
): Glyph {
  const entity = entityIndex.get(`${wx},${wy}`);
  if (entity) {
    return glyphForEntityCell(entity);
  }
  const tileGlyph = glyphForTile(world.grid.tileAt(wx, wy) as TileId, principalId);
  return blastTerrainOverlay(wx, wy, blastOverlayKeys, tileGlyph);
}

function glyphForEntityCell(entity: Entity): Glyph {
  if (!entity.alive) return glyphForCorpse(entity);
  if (entity instanceof Interactable && entity.secured) {
    return { char: entity.glyph, fg: INTERACTABLE_SECURED_FG };
  }
  return glyphForEntity(entity);
}

function blastTerrainOverlay(
  wx: number,
  wy: number,
  blastOverlayKeys: ReadonlySet<string> | undefined,
  tileGlyph: Glyph,
  opts: { dim?: boolean } = {}
): Glyph {
  if (!blastOverlayKeys?.has(`${wx},${wy}`)) return tileGlyph;
  const blast = opts.dim ? dimGlyph(BLAST_OVERLAY_GLYPH) : BLAST_OVERLAY_GLYPH;
  return blast;
}

/**
 * Resolve a faction string to its canonical foreground colour. Used by the
 * memorised-corpse path which stores a faction string rather than a full
 * entity reference. Uses `glyphForEntity` on a minimal shim so the colour
 * mapping has one source of truth in `palette.js`.
 */
function factionFgForMemory(faction: FactionId): string {
  return glyphForEntity({ faction, glyph: '?' }).fg;
}
