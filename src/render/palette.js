import { TILE, FACTION } from '../game/constants.js';

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
  [TILE.COVER]: { char: '+', fg: '#d49a3a' },
};

const FACTION_FG = {
  [FACTION.PLAYER]: '#00d9a5',
  [FACTION.CORP]: '#ff4d6d',
  [FACTION.NEUTRAL]: '#c8b6ff',
};

/**
 * Sentinel glyph for cells outside the world (camera near the map edge).
 * We render *something* rather than leaving holes so the playfield always
 * fills the canvas — easier on the eyes and on the CRT post-pass.
 */
export const OOB_GLYPH = Object.freeze({ char: ' ', fg: '#000000' });

export function glyphForTile(tile) {
  const g = TILE_GLYPH[tile];
  if (!g) throw new Error(`palette: unknown tile id ${tile}`);
  return g;
}

export function glyphForEntity(entity) {
  const fg = FACTION_FG[entity.faction];
  if (!fg) throw new Error(`palette: unknown faction "${entity.faction}"`);
  return { char: entity.glyph, fg };
}
