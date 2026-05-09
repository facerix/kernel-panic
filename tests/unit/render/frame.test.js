import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFrame, cameraFor } from '../../../src/render/frame.js';
import { Grid } from '../../../src/game/Grid.js';
import { Entity } from '../../../src/game/Entity.js';
import { World } from '../../../src/game/World.js';
import { TILE, FACTION } from '../../../src/game/constants.js';
import {
  OOB_GLYPH,
  UNSEEN_GLYPH,
  CORPSE_GLYPH_CHAR,
  CORPSE_DIM,
  dimColor,
} from '../../../src/render/palette.js';
import { VisionField } from '../../../src/game/Vision.js';

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

test('buildFrame renders dead entities as a dimmed corpse glyph (faction-coloured)', () => {
  const { world, drone } = fixture();
  drone.alive = false;
  const frame = buildFrame(world, { x: 0, y: 0, width: 6, height: 4 });
  const cell = cellAt(frame, 4, 2);
  assert.equal(cell.char, CORPSE_GLYPH_CHAR, 'corpse uses the % glyph, not the live "d"');
  // FACTION.CORP fg dimmed by CORPSE_DIM. We compare to dimColor here so the
  // assertion follows whatever palette tweaks happen later — the contract is
  // "faction colour, dimmed by the corpse factor".
  assert.equal(cell.fg, dimColor('#ff4d6d', CORPSE_DIM));
});

test('buildFrame: a live entity standing on a corpse tile renders the live entity', () => {
  // Construct two drones on the same tile by killing one and walking the other
  // onto its square — the live silhouette must win the cell.
  const g = new Grid(6, 4);
  const w = new World(g);
  const corpse = new Entity({ id: 'corpse', x: 3, y: 1, faction: FACTION.CORP, glyph: 'd' });
  const live = new Entity({ id: 'live', x: 3, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  // Bypass addEntity's occupancy guard by killing first, then placing.
  w.entities.set(corpse.id, corpse);
  corpse.alive = false;
  w.entities.set(live.id, live);
  const frame = buildFrame(w, { x: 0, y: 0, width: 6, height: 4 });
  assert.equal(cellAt(frame, 3, 1).char, '@', 'live entity overrides corpse on the same tile');
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

test('buildFrame with vision hides never-seen tiles as UNSEEN_GLYPH', () => {
  const { world, player } = fixture();
  const vision = new VisionField();
  vision.recompute(world.grid, player, 1); // tight range so far cells stay unseen
  const frame = buildFrame(world, { x: 0, y: 0, width: 6, height: 4 }, { vision });
  // Far corner — never seen, never visible.
  assert.equal(cellAt(frame, 5, 3).char, UNSEEN_GLYPH.char);
  assert.equal(cellAt(frame, 5, 3).fg, UNSEEN_GLYPH.fg);
});

test('buildFrame with vision dims remembered tiles and hides their entities', () => {
  const { world, player, drone } = fixture();
  const vision = new VisionField();
  // Pretend we once saw the drone's tile.
  vision.seen.add(`${drone.x},${drone.y}`);
  // Recompute from far away so the drone tile is in `seen` but not `visible`.
  vision.recompute(world.grid, player, 1);
  const frame = buildFrame(world, { x: 0, y: 0, width: 6, height: 4 }, { vision });
  const cell = cellAt(frame, drone.x, drone.y);
  // Tile beneath the drone is FLOOR ('.'); memory should show floor, not 'd'.
  assert.equal(cell.char, '.', 'remembered tile renders without entity');
  assert.equal(cell.fg, dimColor('#1f4d44', 0.35), 'remembered tile is dimmed');
});

test('buildFrame with vision hides corpses in remembered (out-of-LOS) tiles', () => {
  // Same rule as live entities: we don't memorise where things were.
  const { world, player, drone } = fixture();
  drone.alive = false;
  const vision = new VisionField();
  vision.seen.add(`${drone.x},${drone.y}`);
  vision.recompute(world.grid, player, 1); // far from the drone tile
  const frame = buildFrame(world, { x: 0, y: 0, width: 6, height: 4 }, { vision });
  const cell = cellAt(frame, drone.x, drone.y);
  assert.notEqual(cell.char, CORPSE_GLYPH_CHAR, 'corpse not rendered in memory mode');
  assert.equal(cell.char, '.', 'memory falls through to dimmed tile glyph');
});

test('buildFrame with vision renders a corpse on a currently-visible tile', () => {
  const g = new Grid(6, 4);
  const w = new World(g);
  const player = new Entity({ id: 'p', x: 1, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new Entity({ id: 'd', x: 4, y: 1, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(player);
  w.addEntity(drone);
  drone.alive = false;
  const vision = new VisionField();
  vision.recompute(g, player, 8);
  const frame = buildFrame(w, { x: 0, y: 0, width: 6, height: 4 }, { vision });
  assert.equal(cellAt(frame, drone.x, drone.y).char, CORPSE_GLYPH_CHAR);
});

test('buildFrame with vision renders entities only where currently visible', () => {
  // Hand-build a fixture without the wall-blockade between player and drone
  // so we can assert the visible-entity branch on its own.
  const g = new Grid(6, 4);
  const w = new World(g);
  const player = new Entity({ id: 'p', x: 1, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new Entity({ id: 'd', x: 4, y: 1, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(player);
  w.addEntity(drone);
  const vision = new VisionField();
  vision.recompute(g, player, 8);
  const frame = buildFrame(w, { x: 0, y: 0, width: 6, height: 4 }, { vision });
  assert.equal(cellAt(frame, drone.x, drone.y).char, 'd');
});
