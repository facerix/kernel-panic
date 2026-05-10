import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../../../../src/rng.js';
import { TILE } from '../../../../src/game/constants.js';
import { World } from '../../../../src/game/World.js';
import { findPath } from '../../../../src/game/Pathfinding.js';
import { buildMap } from '../../../../src/game/procgen/mapBuild.js';

const W = 24;
const H = 16;

test('buildMap is deterministic for the same seed', () => {
  const a = buildMap({ rng: new Rng(0xdecafbad), width: W, height: H, threatCount: 2 });
  const b = buildMap({ rng: new Rng(0xdecafbad), width: W, height: H, threatCount: 2 });
  assert.deepEqual(Array.from(a.grid.tiles), Array.from(b.grid.tiles), 'grid bytes diverged');
  assert.deepEqual(a.spawns, b.spawns);
  assert.deepEqual(a.exitTile, b.exitTile);
  assert.deepEqual(a.drones, b.drones);
});

test('buildMap does not perturb the caller rng (uses a forked substream)', () => {
  const rngA = new Rng(123);
  const rngB = new Rng(123);
  buildMap({ rng: rngA, width: W, height: H, threatCount: 2 });
  // After buildMap, the caller's rng should still produce its untouched
  // first number — buildMap forks rather than consumes.
  const next = rngA.next();
  const expected = rngB.next();
  assert.equal(next, expected, 'caller rng should not advance during buildMap');
});

test('player spawn and exit are different tiles; spawn FLOOR, exit EXIT', () => {
  const map = buildMap({ rng: new Rng(7), width: W, height: H, threatCount: 2 });
  assert.notDeepEqual(map.spawns.player, map.exitTile);
  assert.equal(
    map.grid.tileAt(map.spawns.player.x, map.spawns.player.y),
    TILE.FLOOR,
    'player spawn must be FLOOR'
  );
  assert.equal(
    map.grid.tileAt(map.exitTile.x, map.exitTile.y),
    TILE.EXIT,
    'exit tile must be TILE.EXIT for rendering'
  );
});

test('every FLOOR cell is reachable from the player spawn', () => {
  // Try a handful of seeds — connectivity has to hold for all of them.
  for (const seed of [1, 42, 0xabcd1234, 0xdeadbeef, 0x55555555]) {
    const map = buildMap({ rng: new Rng(seed), width: W, height: H, threatCount: 2 });
    const world = new World(map.grid);
    const spawn = map.spawns.player;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = map.grid.tileAt(x, y);
        if (t !== TILE.FLOOR && t !== TILE.EXIT) continue;
        if (x === spawn.x && y === spawn.y) continue;
        const path = findPath(world, spawn, { x, y });
        assert.ok(
          path !== null && path.length > 0,
          `seed ${seed.toString(16)}: floor (${x},${y}) unreachable from spawn (${spawn.x},${spawn.y})`
        );
      }
    }
  }
});

test('exit is reachable from spawn', () => {
  const map = buildMap({ rng: new Rng(0xfeedface), width: W, height: H, threatCount: 2 });
  const world = new World(map.grid);
  const path = findPath(world, map.spawns.player, map.exitTile);
  assert.ok(path && path.length > 0, 'exit unreachable from spawn');
});

test('drone count matches the requested threat budget', () => {
  for (const threat of [1, 2, 3]) {
    const map = buildMap({ rng: new Rng(11 + threat), width: W, height: H, threatCount: threat });
    assert.equal(map.drones.length, threat, `expected ${threat} drones, got ${map.drones.length}`);
    for (const drone of map.drones) {
      assert.equal(
        map.grid.tileAt(drone.x, drone.y),
        TILE.FLOOR,
        `drone anchor (${drone.x},${drone.y}) is not FLOOR`
      );
      assert.notDeepEqual(
        { x: drone.x, y: drone.y },
        map.spawns.player,
        'drone anchor coincides with spawn'
      );
      assert.notDeepEqual(
        { x: drone.x, y: drone.y },
        map.exitTile,
        'drone anchor coincides with exit'
      );
    }
  }
});

test('drone anchors are unique tiles (no two drones on the same square)', () => {
  const map = buildMap({ rng: new Rng(0xc0ffee), width: W, height: H, threatCount: 3 });
  const seen = new Set();
  for (const drone of map.drones) {
    const key = `${drone.x},${drone.y}`;
    assert.ok(!seen.has(key), `duplicate drone anchor at ${key}`);
    seen.add(key);
  }
});

test('threatCount=0 returns no drones', () => {
  const map = buildMap({ rng: new Rng(2), width: W, height: H, threatCount: 0 });
  assert.equal(map.drones.length, 0);
});

test('non-integer dimensions throw', () => {
  assert.throws(() => buildMap({ rng: new Rng(1), width: 12.5, height: 10, threatCount: 1 }));
  assert.throws(() => buildMap({ rng: new Rng(1), width: 12, height: -1, threatCount: 1 }));
});

test('rng-less call throws TypeError', () => {
  assert.throws(() => buildMap({ rng: null, width: W, height: H, threatCount: 1 }), TypeError);
});
