import { TILE, FACTION } from '../game/constants.js';
import type { TileId, FactionId } from '../game/constants.js';
import { terrainPaletteFor } from './principalTerrainPalettes.js';

/** Second glyph painted on top of the base cell (e.g. sniper aim crosshair). */
export type GlyphOverlay = { char: string; fg: string };

/** A renderable glyph: a single character plus a foreground colour. */
export type Glyph = { char: string; fg: string; bg?: string; overlay?: GlyphOverlay };

/**
 * Central palette: every renderable thing maps to a glyph (a single char) plus
 * a foreground colour. Backgrounds are uniform terminal-black, applied by the
 * renderer, so they're not part of the glyph record.
 *
 * Colours roughly follow the project theme — mint-green for the player, hot
 * pink for hostile corp units, amber for cover, dim teal for floor, washed-out
 * cyan for walls. Tweak in one place if the look changes.
 */

const TILE_GLYPH = {
  [TILE.FLOOR]: { char: '.', fg: '#1f4d44' },
  [TILE.WALL]: { char: '#', fg: '#5fbcd4' },
  [TILE.COVER]: { char: '=', fg: '#d49a3a' },
  [TILE.EXIT]: { char: '¤', fg: '#eed5fa' },
  [TILE.SMOKE]: { char: '░', fg: '#8b9da8' },
  [TILE.HAZARD]: { char: '▓', fg: '#d45a3a' },
  [TILE.RUBBLE]: { char: '%', fg: '#5fbcd4' },
};

const FACTION_FG = {
  [FACTION.PLAYER]: '#00d9a5',
  [FACTION.CORP]: '#ff4d6d',
  [FACTION.NEUTRAL]: '#c8b6ff',
  // Phase 2.9 rival/gang allegiance — amber, distinct from corp rose so a
  // rival-owned site reads differently at a glance.
  [FACTION.RIVAL]: '#ff9e3d',
};

/** NEUTRAL interactables after the player has triggered them (slice, sync, handoff). */
export const INTERACTABLE_SECURED_FG = FACTION_FG[FACTION.PLAYER];

/**
 * Electric cyan for a stunned (EMP'd) entity glyph (P3.5.M2). Overrides the
 * faction hue so a shocked hostile reads as "short-circuited, skipping its
 * turn" at a glance. Shared with the EMP screen-flash tint so the discharge and
 * its aftermath are the same colour.
 */
export const STUNNED_FG = '#8be9ff';

/**
 * Sentinel glyph for cells outside the world (camera near the map edge).
 * We render *something* rather than leaving holes so the playfield always
 * fills the canvas — easier on the eyes and on the CRT post-pass. Stays a
 * pure space (renderer skips it) so OOB looks identical to canvas bg.
 */
export const OOB_GLYPH = Object.freeze({ char: ' ', fg: '#000000' });

/**
 * Sentinel for never-seen tiles inside the world (true fog of war).
 *
 * Uses a faint mid-dot rather than a space so the foreground color
 * actually paints — previously the renderer's "skip space" optimization
 * meant the documented `#000000` was dead code. The dot reads
 * as quiet static against the canvas bg and is visibly distinct from the
 * dimmed "memory" tiles, which keep their tile-shaped glyph.
 */
export const UNSEEN_GLYPH = Object.freeze({ char: '·', fg: '#1a1a1a' });

/**
 * P3.M3.6: tileset axis. The cyber grid reuses the FLOOR/WALL tile ids
 * (passability, LOS, pathfinding, persistence untouched) and swaps the look —
 * data-line mid-dots on deep cyan, firewall static in magenta. Principal
 * terrain palettes are a Meatspace mood axis and never recolor the grid.
 */
export type TilesetId = 'meat' | 'cyber';

const CYBER_TILE_GLYPH: Partial<Record<TileId, Glyph>> = {
  [TILE.FLOOR]: { char: '÷', fg: '#5e6b66' },
  [TILE.WALL]: { char: '▒', fg: '#c2e0d4' },
};

export function glyphForTile(
  tile: TileId,
  principalId?: string,
  tileset: TilesetId = 'meat'
): Glyph {
  if (tileset === 'cyber') {
    const cyber = CYBER_TILE_GLYPH[tile];
    // Cyber maps are FLOOR/WALL only by construction (`buildCyberMap`); any
    // other id reaching the cyber painter is corruption, not a style gap.
    if (!cyber) throw new Error(`palette: tile id ${tile} has no cyber tileset glyph`);
    return cyber;
  }
  if (tileset !== 'meat') {
    throw new Error(`palette: unknown tileset "${String(tileset)}"`);
  }
  const g = TILE_GLYPH[tile];
  if (!g) throw new Error(`palette: unknown tile id ${tile}`);
  if (!principalId) return g;

  const palette = terrainPaletteFor(principalId);
  switch (tile) {
    case TILE.FLOOR:
      return { char: g.char, fg: palette.floor };
    case TILE.WALL:
      return { char: g.char, fg: palette.wall };
    case TILE.COVER:
      return { char: g.char, fg: palette.cover };
    case TILE.RUBBLE:
      return { char: g.char, fg: palette.wall };
    default:
      return g;
  }
}

export function glyphForEntity(entity: { faction: FactionId; glyph: string }): Glyph {
  const fg = FACTION_FG[entity.faction];
  if (!fg) throw new Error(`palette: unknown faction "${entity.faction}"`);
  return { char: entity.glyph, fg };
}

/**
 * Corpse glyph — classic roguelike `%`, painted in the entity's faction
 * colour but dimmed via `dimColor`. Distinct char from the live glyph so a
 * glance reads "fell here" rather than "still kicking, low HP". Faction hue
 * is preserved so a downed player and a downed drone read differently.
 *
 * Crashes on unknown factions for the same reason `glyphForEntity` does —
 * silent fallback here would mask a palette bug.
 */
export const CORPSE_GLYPH_CHAR = '%';
export const CORPSE_DIM = 0.5;

export function glyphForCorpse(entity: { faction: FactionId }): Glyph {
  const fg = FACTION_FG[entity.faction];
  if (!fg) throw new Error(`palette: unknown faction "${entity.faction}"`);
  return { char: CORPSE_GLYPH_CHAR, fg: dimColor(fg, CORPSE_DIM) };
}

/**
 * Multiply each channel of a `#rrggbb` colour by `factor` ∈ [0, 1]. Used to
 * produce the dim "remembered" variant of any glyph for fog-of-war memory.
 * Crashes on a malformed hex — silent fallback would mask a palette bug.
 */
export function dimColor(hex: string, factor: number): string {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`dimColor: expected #rrggbb, got "${hex}"`);
  }
  if (!Number.isFinite(factor) || factor < 0 || factor > 1) {
    throw new RangeError(`dimColor: factor must be in [0, 1], got ${factor}`);
  }
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Default dim factor for remembered (out-of-LOS, in-memory) tiles. */
export const MEMORY_DIM = 0.35;

/**
 * Wrap a glyph into its memory variant. Convenience for the frame builder.
 */
export function dimGlyph(glyph: Glyph, factor = MEMORY_DIM): Glyph {
  return { char: glyph.char, fg: dimColor(glyph.fg, factor) };
}
