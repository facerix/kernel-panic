import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFrame, cameraFor } from '../../../src/render/frame.js';
import { Grid } from '../../../src/game/Grid.js';
import { Entity } from '../../../src/game/Entity.js';
import { World } from '../../../src/game/World.js';
import { TILE, FACTION } from '../../../src/game/constants.js';
import { OOB_GLYPH } from '../../../src/render/palette.js';

const fixture = () => {
  const g = new Grid(6, 4); // FLOOR-filled
  g.setTile(2, 1, TILE.WALL);
  g.setTile(3, 2, TILE.COVER);
  const w = new World(g);
  const player = new Entity({ id: 'p', x: 1, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new Entity({ id: 'd', x: 4, y: 2, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(player);
  w.addEntity(drone);
  return { world: w, player, drone };
};

const cellAt = (frame, x, y) => frame.cells[y * frame.width + x];

test('buildFrame returns a frame matching the viewport dimensions', () => {
  const { world } = fixture();
  const frame = buildFrame(world, { x: 0, y: 0, width: 6, height: 4 });
  assert.equal(frame.width, 6);
  assert.equal(frame.height, 4);
  assert.equal(frame.cells.length, 24);
});

test('buildFrame maps tiles to expected glyphs', () => {
  const { world } = fixture();
  const frame = buildFrame(world, { x: 0, y: 0, width: 6, height: 4 });
  assert.equal(cellAt(frame, 0, 0).char, '.', 'floor');
  assert.equal(cellAt(frame, 2, 1).char, '#', 'wall');
  assert.equal(cellAt(frame, 3, 2).char, '+', 'cover');
});

test('buildFrame renders entities on top of their tile', () => {
  const { world } = fixture();
  const frame = buildFrame(world, { x: 0, y: 0, width: 6, height: 4 });
  assert.equal(cellAt(frame, 1, 1).char, '@', 'player overrides floor');
  assert.equal(cellAt(frame, 4, 2).char, 'd', 'drone overrides floor');
});

test('buildFrame skips dead entities', () => {
  const { world, drone } = fixture();
  drone.alive = false;
  const frame = buildFrame(world, { x: 0, y: 0, width: 6, height: 4 });
  assert.equal(cellAt(frame, 4, 2).char, '.', 'dead drone no longer drawn');
});

test('buildFrame translates by camera offset (top-left becomes world (cx, cy))', () => {
  const { world } = fixture();
  const frame = buildFrame(world, { x: 2, y: 1, width: 3, height: 2 });
  // Frame (0,0) is world (2,1) which is a wall.
  assert.equal(cellAt(frame, 0, 0).char, '#');
  // Frame (2,1) is world (4,2) which has the drone.
  assert.equal(cellAt(frame, 2, 1).char, 'd');
});

test('buildFrame fills out-of-bounds cells with OOB_GLYPH', () => {
  const { world } = fixture();
  // Camera shifted past the world edge — bottom row & rightmost col should be OOB.
  const frame = buildFrame(world, { x: 4, y: 2, width: 4, height: 4 });
  // World(7,5) is out of bounds (world is 6x4) — frame cell (3,3).
  assert.equal(cellAt(frame, 3, 3).char, OOB_GLYPH.char);
  assert.equal(cellAt(frame, 3, 3).fg, OOB_GLYPH.fg);
});

test('cameraFor centers a follow-target inside the viewport', () => {
  const cam = cameraFor({ x: 10, y: 10 }, { width: 5, height: 3 });
  // For a 5x3 viewport centered on (10,10): x = 10 - floor(5/2) = 8, y = 10 - floor(3/2) = 9
  assert.equal(cam.x, 8);
  assert.equal(cam.y, 9);
  assert.equal(cam.width, 5);
  assert.equal(cam.height, 3);
});

test('cameraFor rejects non-positive viewport dims', () => {
  assert.throws(() => cameraFor({ x: 0, y: 0 }, { width: 0, height: 3 }), RangeError);
  assert.throws(() => cameraFor({ x: 0, y: 0 }, { width: 5, height: -1 }), RangeError);
});
