import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { Entity } from '../../../src/game/Entity.js';
import { World } from '../../../src/game/World.js';
import { TILE, FACTION } from '../../../src/game/constants.js';
import { findPath, chebyshev } from '../../../src/game/Pathfinding.js';

const openWorld = (w = 8, h = 8) => new World(new Grid(w, h));

test('chebyshev distance matches max(|dx|,|dy|)', () => {
  assert.equal(chebyshev(0, 0, 3, 5), 5);
  assert.equal(chebyshev(0, 0, 7, 2), 7);
  assert.equal(chebyshev(2, 2, 2, 2), 0);
});

test('findPath returns [] when start equals goal', () => {
  const w = openWorld();
  assert.deepEqual(findPath(w, { x: 3, y: 3 }, { x: 3, y: 3 }), []);
});

test('findPath on open floor returns a Chebyshev-length path', () => {
  const w = openWorld();
  // (1,1) → (5,4): Chebyshev = max(4, 3) = 4 — should be 4 diagonal-flavoured steps.
  const path = findPath(w, { x: 1, y: 1 }, { x: 5, y: 4 });
  assert.ok(path);
  assert.equal(path.length, 4);
  // Every step must be a 1-tile Chebyshev move from the previous tile.
  let { x, y } = { x: 1, y: 1 };
  for (const step of path) {
    assert.ok(Math.abs(step.x - x) <= 1 && Math.abs(step.y - y) <= 1, 'each step ≤1 Chebyshev');
    x = step.x;
    y = step.y;
  }
  // Ends exactly on the goal.
  assert.deepEqual(path[path.length - 1], { x: 5, y: 4 });
});

test('findPath routes around walls', () => {
  const grid = new Grid(8, 5);
  // Vertical wall at x=4 from y=0..3, with a gap at y=4 to squeeze through.
  for (let y = 0; y < 4; y++) grid.setTile(4, y, TILE.WALL);
  const w = new World(grid);
  const path = findPath(w, { x: 1, y: 1 }, { x: 6, y: 1 });
  assert.ok(path, 'expected a path around the wall');
  // No step should land on a wall tile.
  for (const step of path) {
    assert.notEqual(grid.tileAt(step.x, step.y), TILE.WALL);
  }
});

test('findPath returns null when goal is unreachable', () => {
  const grid = new Grid(5, 5);
  // Vertical wall at x=2 splits the grid into two unconnected halves.
  for (let y = 0; y < 5; y++) grid.setTile(2, y, TILE.WALL);
  const w = new World(grid);
  assert.equal(findPath(w, { x: 0, y: 2 }, { x: 4, y: 2 }), null);
});

test('findPath treats live entities as blockers on non-goal tiles', () => {
  // A 1-tall corridor with the only choke-point occupied by an entity.
  const grid = new Grid(6, 3);
  for (let x = 0; x < 6; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, 2, TILE.WALL);
  }
  const w = new World(grid);
  const blocker = new Entity({ id: 'b', x: 3, y: 1, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(blocker);
  const path = findPath(w, { x: 1, y: 1 }, { x: 5, y: 1 });
  assert.equal(path, null, 'corridor blocked by an entity should be unreachable');
});

test('findPath honours extraBlockers without placing entities', () => {
  const grid = new Grid(6, 3);
  for (let x = 0; x < 6; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, 2, TILE.WALL);
  }
  const w = new World(grid);
  const path = findPath(
    w,
    { x: 1, y: 1 },
    { x: 5, y: 1 },
    { extraBlockers: new Set(['3,1']) }
  );
  assert.equal(path, null, 'simulated blocker on choke tile should seal the corridor');
});

test('findPath allows a path that ends on a goal tile occupied by an entity (default)', () => {
  const w = openWorld();
  const target = new Entity({ id: 't', x: 4, y: 4, faction: FACTION.PLAYER, glyph: '@' });
  w.addEntity(target);
  const path = findPath(w, { x: 1, y: 1 }, { x: 4, y: 4 });
  assert.ok(path);
  assert.deepEqual(path[path.length - 1], { x: 4, y: 4 });
});

test('findPath rejects an occupied goal when allowOccupiedGoal=false', () => {
  const w = openWorld();
  const target = new Entity({ id: 't', x: 4, y: 4, faction: FACTION.PLAYER, glyph: '@' });
  w.addEntity(target);
  const path = findPath(w, { x: 1, y: 1 }, { x: 4, y: 4 }, { allowOccupiedGoal: false });
  assert.equal(path, null);
});

test('findPath honours maxSteps cap', () => {
  const w = openWorld(10, 10);
  // True Chebyshev distance is 6; cap at 3 should fail.
  assert.equal(findPath(w, { x: 1, y: 1 }, { x: 7, y: 4 }, { maxSteps: 3 }), null);
  // Cap at 6 (exact) should succeed.
  const ok = findPath(w, { x: 1, y: 1 }, { x: 7, y: 4 }, { maxSteps: 6 });
  assert.ok(ok);
  assert.equal(ok.length, 6);
});

test('findPath throws on non-integer or out-of-bounds endpoints', () => {
  const w = openWorld();
  assert.throws(() => findPath(w, { x: 0.5, y: 1 }, { x: 4, y: 4 }), TypeError);
  assert.throws(() => findPath(w, { x: 1, y: 1 }, { x: 4, y: 'oops' }), TypeError);
  assert.throws(() => findPath(w, { x: -1, y: 1 }, { x: 4, y: 4 }), RangeError);
  assert.throws(() => findPath(w, { x: 1, y: 1 }, { x: 99, y: 4 }), RangeError);
});

test('findPath rejects negative or non-integer maxSteps', () => {
  const w = openWorld();
  assert.throws(() => findPath(w, { x: 1, y: 1 }, { x: 4, y: 4 }, { maxSteps: -1 }), RangeError);
  assert.throws(() => findPath(w, { x: 1, y: 1 }, { x: 4, y: 4 }, { maxSteps: 1.5 }), RangeError);
});
