import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { TILE } from '../../../src/game/constants.js';

test('Grid constructor rejects non-positive width', () => {
  assert.throws(() => new Grid(0, 5), RangeError);
  assert.throws(() => new Grid(-1, 5), RangeError);
  assert.throws(() => new Grid(1.5, 5), RangeError);
});

test('Grid constructor rejects non-positive height', () => {
  assert.throws(() => new Grid(5, 0), RangeError);
  assert.throws(() => new Grid(5, -3), RangeError);
});

test('Grid defaults to FLOOR fill', () => {
  const g = new Grid(3, 3);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      assert.equal(g.tileAt(x, y), TILE.FLOOR, `(${x},${y})`);
    }
  }
});

test('Grid honours an explicit fill tile', () => {
  const g = new Grid(2, 2, TILE.WALL);
  assert.equal(g.tileAt(0, 0), TILE.WALL);
  assert.equal(g.tileAt(1, 1), TILE.WALL);
});

test('Grid.inBounds is true for corners, false past them', () => {
  const g = new Grid(4, 3);
  assert.equal(g.inBounds(0, 0), true);
  assert.equal(g.inBounds(3, 2), true);
  assert.equal(g.inBounds(-1, 0), false);
  assert.equal(g.inBounds(0, -1), false);
  assert.equal(g.inBounds(4, 0), false);
  assert.equal(g.inBounds(0, 3), false);
});

test('Grid.tileAt throws RangeError when out of bounds', () => {
  const g = new Grid(2, 2);
  assert.throws(() => g.tileAt(-1, 0), RangeError);
  assert.throws(() => g.tileAt(0, 2), RangeError);
});

test('Grid.setTile mutates the underlying tile', () => {
  const g = new Grid(2, 2);
  g.setTile(1, 0, TILE.WALL);
  assert.equal(g.tileAt(1, 0), TILE.WALL);
  assert.equal(g.tileAt(0, 0), TILE.FLOOR, 'sibling tiles untouched');
});

test('Grid.setTile throws RangeError when out of bounds', () => {
  const g = new Grid(2, 2);
  assert.throws(() => g.setTile(2, 0, TILE.WALL), RangeError);
});

test('Grid.isPassable: FLOOR and EXIT yes, WALL no, COVER no (cover blocks movement, Vault hops it)', () => {
  const g = new Grid(4, 1);
  g.setTile(0, 0, TILE.FLOOR);
  g.setTile(1, 0, TILE.EXIT);
  g.setTile(2, 0, TILE.WALL);
  g.setTile(3, 0, TILE.COVER);
  assert.equal(g.isPassable(0, 0), true);
  assert.equal(g.isPassable(1, 0), true);
  assert.equal(g.isPassable(2, 0), false);
  assert.equal(g.isPassable(3, 0), false);
});

test('Grid.isPassable returns false for out-of-bounds (no throw)', () => {
  const g = new Grid(2, 2);
  assert.equal(g.isPassable(-1, 0), false);
  assert.equal(g.isPassable(2, 0), false);
});

test('Grid.blocksLineOfSight: WALL yes, COVER no, FLOOR no, EXIT no, OOB yes', () => {
  const g = new Grid(4, 1);
  g.setTile(0, 0, TILE.FLOOR);
  g.setTile(1, 0, TILE.EXIT);
  g.setTile(2, 0, TILE.WALL);
  g.setTile(3, 0, TILE.COVER);
  assert.equal(g.blocksLineOfSight(0, 0), false);
  assert.equal(g.blocksLineOfSight(1, 0), false);
  assert.equal(g.blocksLineOfSight(2, 0), true);
  assert.equal(g.blocksLineOfSight(3, 0), false);
  assert.equal(g.blocksLineOfSight(-1, 0), true, 'OOB should block LOS');
});
