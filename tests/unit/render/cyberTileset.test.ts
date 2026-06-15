/**
 * P3.M3.6 — cyber tileset: distinct visuals on a separate *tileset axis*,
 * not new TILE ids. The cyber grid reuses FLOOR/WALL (so passability, LOS,
 * A*, and persistence stay untouched) and the palette swaps the look.
 * Meat rendering must stay byte-stable when no tileset is passed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { glyphForTile } from '../../../src/render/palette.js';
import { buildFrame } from '../../../src/render/frame.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { TILE } from '../../../src/game/constants.js';
import type { TileId } from '../../../src/game/constants.js';

// --- palette ---------------------------------------------------------------------

test('cyber tiles render distinct glyphs from meat', () => {
  const meatFloor = glyphForTile(TILE.FLOOR as TileId);
  const cyberFloor = glyphForTile(TILE.FLOOR as TileId, undefined, 'cyber');
  const meatWall = glyphForTile(TILE.WALL as TileId);
  const cyberWall = glyphForTile(TILE.WALL as TileId, undefined, 'cyber');

  assert.equal(cyberFloor.char, '÷');
  assert.equal(cyberWall.char, '▒');
  assert.notDeepEqual(cyberFloor, meatFloor);
  assert.notDeepEqual(cyberWall, meatWall);
  assert.notEqual(cyberFloor.fg, cyberWall.fg, 'floor and wall hues are distinct');
});

test('the meat tileset is the default and stays byte-stable', () => {
  for (const tile of [TILE.FLOOR, TILE.WALL, TILE.COVER, TILE.EXIT] as TileId[]) {
    assert.deepEqual(glyphForTile(tile, undefined, 'meat'), glyphForTile(tile));
  }
});

test('principal terrain palettes do not recolor the cyber tileset', () => {
  // The grid is the grid — corp moodboards belong to Meatspace.
  const plain = glyphForTile(TILE.FLOOR as TileId, undefined, 'cyber');
  const themed = glyphForTile(TILE.FLOOR as TileId, 'corp-helix', 'cyber');
  assert.deepEqual(themed, plain);
});

test('an unknown tileset throws', () => {
  assert.throws(() => glyphForTile(TILE.FLOOR as TileId, undefined, 'astral' as never), /tileset/);
});

test('non-cyber tile ids on the cyber tileset throw (FLOOR/WALL only by construction)', () => {
  assert.throws(() => glyphForTile(TILE.COVER as TileId, undefined, 'cyber'), /cyber/);
  assert.throws(() => glyphForTile(TILE.HAZARD as TileId, undefined, 'cyber'), /cyber/);
});

// --- frame threading ---------------------------------------------------------------

function tinyWorld(): World {
  const grid = new Grid(4, 3); // all FLOOR
  grid.setTile(1, 1, TILE.WALL);
  return new World(grid);
}

test('buildFrame threads the cyber tileset into terrain cells', () => {
  const world = tinyWorld();
  const camera = { x: 0, y: 0, width: 4, height: 3 };
  const frame = buildFrame(world, camera, { tileset: 'cyber' });
  assert.deepEqual(frame.cells[0], glyphForTile(TILE.FLOOR as TileId, undefined, 'cyber'));
  assert.deepEqual(frame.cells[1 * 4 + 1], glyphForTile(TILE.WALL as TileId, undefined, 'cyber'));
});

test('buildFrame without a tileset stays byte-identical to before', () => {
  const world = tinyWorld();
  const camera = { x: 0, y: 0, width: 4, height: 3 };
  const implicit = buildFrame(world, camera, {});
  const explicit = buildFrame(world, camera, { tileset: 'meat' });
  assert.deepEqual(explicit, implicit);
  assert.deepEqual(implicit.cells[0], glyphForTile(TILE.FLOOR as TileId));
});
