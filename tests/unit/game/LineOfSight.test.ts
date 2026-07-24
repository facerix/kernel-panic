import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { TILE, FACTION } from '../../../src/game/constants.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import {
  tilesBetween,
  hasLineOfSight,
  hasConcealedLineOfSight,
  hasCoverBetween,
  withinRange,
} from '../../../src/game/LineOfSight.js';

test('tilesBetween excludes both endpoints', () => {
  const tiles = tilesBetween(0, 0, 4, 0);
  assert.deepEqual(tiles, [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ]);
});

test('tilesBetween returns [] for adjacent or identical points', () => {
  assert.deepEqual(tilesBetween(2, 2, 2, 2), []);
  assert.deepEqual(tilesBetween(2, 2, 3, 2), []);
  assert.deepEqual(tilesBetween(2, 2, 3, 3), []);
});

test('tilesBetween walks a clean diagonal', () => {
  assert.deepEqual(tilesBetween(0, 0, 4, 4), [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 },
  ]);
});

test('hasLineOfSight is true across open floor', () => {
  const g = new Grid(8, 8);
  assert.equal(hasLineOfSight(g, 0, 0, 7, 0), true);
  assert.equal(hasLineOfSight(g, 0, 0, 7, 7), true);
});

test('hasLineOfSight is true to self and to adjacent tiles', () => {
  const g = new Grid(4, 4);
  assert.equal(hasLineOfSight(g, 1, 1, 1, 1), true);
  assert.equal(hasLineOfSight(g, 1, 1, 2, 1), true);
  assert.equal(hasLineOfSight(g, 1, 1, 2, 2), true);
});

test('hasLineOfSight is blocked by a WALL on the line', () => {
  const g = new Grid(8, 8);
  g.setTile(3, 0, TILE.WALL);
  assert.equal(hasLineOfSight(g, 0, 0, 6, 0), false);
});

test('hasLineOfSight passes through COVER (cover does not block sight)', () => {
  const g = new Grid(8, 8);
  g.setTile(3, 0, TILE.COVER);
  assert.equal(hasLineOfSight(g, 0, 0, 6, 0), true);
});

test('hasLineOfSight is blocked by SMOKE', () => {
  const g = new Grid(8, 8);
  g.setTile(3, 0, TILE.SMOKE);
  assert.equal(hasLineOfSight(g, 0, 0, 6, 0), false);
});

test('hasConcealedLineOfSight treats COVER as an occluder', () => {
  const g = new Grid(8, 8);
  g.setTile(3, 0, TILE.COVER);
  assert.equal(hasConcealedLineOfSight(g, 0, 0, 6, 0), false);
});

test('hasConcealedLineOfSight ignores COVER at endpoints', () => {
  const g = new Grid(8, 8);
  g.setTile(0, 0, TILE.COVER);
  g.setTile(6, 0, TILE.COVER);
  assert.equal(hasConcealedLineOfSight(g, 0, 0, 6, 0), true);
});

test('hasConcealedLineOfSight is blocked by walls and smoke', () => {
  const smoke = new Grid(8, 8);
  smoke.setTile(3, 0, TILE.SMOKE);
  assert.equal(hasConcealedLineOfSight(smoke, 0, 0, 6, 0), false);

  const wall = new Grid(8, 8);
  wall.setTile(3, 0, TILE.WALL);
  assert.equal(hasConcealedLineOfSight(wall, 0, 0, 6, 0), false);
});

test('hasLineOfSight is symmetric across diagonals', () => {
  const g = new Grid(8, 8);
  // Sprinkle a wall off-line to make sure the symmetric trace catches both
  // directions consistently.
  g.setTile(4, 2, TILE.WALL);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const ab = hasLineOfSight(g, 1, 1, x, y);
      const ba = hasLineOfSight(g, x, y, 1, 1);
      assert.equal(ab, ba, `asymmetric LOS between (1,1) and (${x},${y})`);
    }
  }
});

test('hasCoverBetween detects cover on the line', () => {
  const g = new Grid(8, 8);
  g.setTile(3, 0, TILE.COVER);
  assert.equal(hasCoverBetween(g, 0, 0, 6, 0), true);
});

test('hasCoverBetween is false when no cover lies between', () => {
  const g = new Grid(8, 8);
  // Cover off-axis, not on the line of fire.
  g.setTile(3, 3, TILE.COVER);
  assert.equal(hasCoverBetween(g, 0, 0, 6, 0), false);
});

test('hasCoverBetween ignores cover at the endpoints (only strictly between)', () => {
  const g = new Grid(8, 8);
  g.setTile(0, 0, TILE.COVER); // attacker tile
  g.setTile(6, 0, TILE.COVER); // target tile
  assert.equal(hasCoverBetween(g, 0, 0, 6, 0), false);
});

test('hasCoverBetween returns false for adjacent or identical points', () => {
  const g = new Grid(8, 8);
  assert.equal(hasCoverBetween(g, 2, 2, 2, 2), false);
  assert.equal(hasCoverBetween(g, 2, 2, 3, 2), false);
});

// --- withinRange (shared circular-range helper) ----------------------------

test('withinRange treats range as Euclidean — orthogonal step at the cap is in', () => {
  // (0,0) → (8,0): dx²+dy² = 64 ≤ 64
  assert.equal(withinRange(0, 0, 8, 0, 8), true);
});

test('withinRange rejects diagonals that exceed the radius even within Chebyshev', () => {
  // 8 diagonal steps: dx²+dy² = 128 > 64 — this is the harness/Combat mismatch
  // the M4 review flagged. The shared helper must agree with Combat.
  assert.equal(withinRange(0, 0, 8, 8, 8), false);
});

test('withinRange accepts a diagonal that fits the circle', () => {
  // (0,0) → (5,5): 50 ≤ 64
  assert.equal(withinRange(0, 0, 5, 5, 8), true);
});

test('withinRange is symmetric (a→b iff b→a)', () => {
  assert.equal(withinRange(2, 3, 9, 7, 8), withinRange(9, 7, 2, 3, 8));
});

test('withinRange is true for identical points and any non-negative range', () => {
  assert.equal(withinRange(4, 4, 4, 4, 0), true);
  assert.equal(withinRange(4, 4, 4, 4, 8), true);
});

test('withinRange crashes on a negative range (no silent fallback)', () => {
  assert.throws(() => withinRange(0, 0, 1, 1, -1), RangeError);
});

// --- entity occlusion (M4 review item: entities should block LOS) -----------

test('hasLineOfSight is blocked by another entity standing on the line', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  // Blocker stands at (3,1); shooter at (1,1) tries to see (5,1).
  const blocker = new Entity({
    id: 'b',
    x: 3,
    y: 1,
    faction: FACTION.NEUTRAL,
    glyph: 'h',
  });
  w.addEntity(blocker);
  assert.equal(
    hasLineOfSight(g, 1, 1, 5, 1, { blockers: w.blockerKeys() }),
    false,
    'a body on the line breaks the sightline'
  );
});

test('hasLineOfSight ignores entity occupancy when no blocker set is passed (back-compat)', () => {
  // The grid-only signature must keep working — used by tests that don't
  // care about entity occlusion.
  const g = new Grid(8, 8);
  assert.equal(hasLineOfSight(g, 0, 0, 5, 0), true);
});

test('hasLineOfSight ignores blockers sitting on the endpoints (target stays shootable)', () => {
  const g = new Grid(8, 8);
  // Blocker at the *target* tile must not occlude the shot to itself —
  // tilesBetween excludes endpoints, so this is enforced by Bresenham.
  const blockers = new Set(['5,1']);
  assert.equal(hasLineOfSight(g, 1, 1, 5, 1, { blockers }), true);
});

test('hasLineOfSight is blocked by walls regardless of the blocker set', () => {
  const g = new Grid(8, 8);
  g.setTile(3, 1, TILE.WALL);
  const blockers = new Set<string>();
  assert.equal(hasLineOfSight(g, 1, 1, 5, 1, { blockers }), false);
});

test('hasConcealedLineOfSight is blocked by another entity standing on the line', () => {
  const g = new Grid(8, 8);
  const blockers = new Set(['3,1']);
  assert.equal(hasConcealedLineOfSight(g, 1, 1, 5, 1, { blockers }), false);
});
