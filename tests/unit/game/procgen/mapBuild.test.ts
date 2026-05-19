import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../../../../src/rng.js';
import { CONTRACT_DIFFICULTY, TILE } from '../../../../src/game/constants.js';
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

test('every drone receives a moving patrol path', () => {
  for (const seed of [0xc0ffee, 0xfeedface, 0xdeadbeef, 0x12345678]) {
    const map = buildMap({ rng: new Rng(seed), width: W, height: H, threatCount: 5 });
    for (const drone of map.drones) {
      assert.ok(
        drone.waypoints.length >= 2,
        `seed ${seed.toString(16)} drone at (${drone.x},${drone.y}) has too few waypoints`
      );
      assert.ok(
        drone.waypoints.some(wp => wp.x !== drone.x || wp.y !== drone.y),
        `seed ${seed.toString(16)} drone at (${drone.x},${drone.y}) patrols in place`
      );
      for (const wp of drone.waypoints) {
        assert.equal(
          map.grid.tileAt(wp.x, wp.y),
          TILE.FLOOR,
          `seed ${seed.toString(16)} waypoint (${wp.x},${wp.y}) is not FLOOR`
        );
      }
    }
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

test('outer rim is always WALL (no rooms stamped flush against the edges)', () => {
  // Try several seeds — the rim is what the player sees when they read the
  // map as a coherent space, so this has to hold for every layout we produce.
  for (const seed of [1, 42, 0xabcd1234, 0xdeadbeef, 0x55555555, 0xc0ffee, 0xfeedface]) {
    const map = buildMap({ rng: new Rng(seed), width: W, height: H, threatCount: 2 });
    for (let x = 0; x < W; x++) {
      assert.equal(
        map.grid.tileAt(x, 0),
        TILE.WALL,
        `seed ${seed.toString(16)}: top rim (${x},0) is not WALL`
      );
      assert.equal(
        map.grid.tileAt(x, H - 1),
        TILE.WALL,
        `seed ${seed.toString(16)}: bottom rim (${x},${H - 1}) is not WALL`
      );
    }
    for (let y = 0; y < H; y++) {
      assert.equal(
        map.grid.tileAt(0, y),
        TILE.WALL,
        `seed ${seed.toString(16)}: left rim (0,${y}) is not WALL`
      );
      assert.equal(
        map.grid.tileAt(W - 1, y),
        TILE.WALL,
        `seed ${seed.toString(16)}: right rim (${W - 1},${y}) is not WALL`
      );
    }
  }
});

test('map dimensions smaller than the inset+MIN_LEAF envelope throw a helpful error', () => {
  // 7×7 → playable 5×5 after a 1-tile rim inset, below MIN_LEAF=6.
  assert.throws(
    () => buildMap({ rng: new Rng(1), width: 7, height: 7, threatCount: 0 }),
    /rim inset/i
  );
});

// --- M5: civilian anchors ---------------------------------------------------

test('buildMap returns civilian anchor arrays (may be empty for some seeds)', () => {
  const SEEDS = [0xface, 0xdead, 0xbeef, 0xc0de, 0xcafe];
  for (const seed of SEEDS) {
    const map = buildMap({ rng: new Rng(seed), width: 24, height: 16, threatCount: 2 });
    assert.ok(Array.isArray(map.corpCivilians), `seed ${seed}: corpCivilians must be an array`);
    assert.ok(
      Array.isArray(map.neutralCivilians),
      `seed ${seed}: neutralCivilians must be an array`
    );
    // Civilians should be on valid, passable tiles.
    for (const c of [...map.corpCivilians, ...map.neutralCivilians]) {
      assert.ok(map.grid.inBounds(c.x, c.y), `civilian at (${c.x},${c.y}) must be in bounds`);
      assert.equal(
        map.grid.tileAt(c.x, c.y),
        TILE.FLOOR,
        `civilian at (${c.x},${c.y}) must be on FLOOR`
      );
    }
  }
});

test('civilian counts respect maxCorpCivilians / maxNeutralCivilians caps', () => {
  // Default caps are 1 each — verify no seed exceeds that.
  for (const seed of [0xface, 0xdead, 0xbeef, 0xc0de, 0xcafe, 0xfeedface, 0xdeadbeef]) {
    const map = buildMap({ rng: new Rng(seed), width: 24, height: 16, threatCount: 2 });
    assert.ok(
      map.corpCivilians.length <= 1,
      `seed ${seed.toString(16)}: corpCivilians ${map.corpCivilians.length} > default cap 1`
    );
    assert.ok(
      map.neutralCivilians.length <= 1,
      `seed ${seed.toString(16)}: neutralCivilians ${map.neutralCivilians.length} > default cap 1`
    );
  }
});

test('maxCorpCivilians=0 / maxNeutralCivilians=0 produces no civilians', () => {
  const map = buildMap({
    rng: new Rng(0xface),
    width: 24,
    height: 16,
    threatCount: 2,
    maxCorpCivilians: 0,
    maxNeutralCivilians: 0,
  });
  assert.equal(map.corpCivilians.length, 0);
  assert.equal(map.neutralCivilians.length, 0);
});

test('contract difficulty controls default civilian caps', () => {
  for (const seed of [0xface, 0xdead, 0xbeef, 0xcafe, 0xfeedface]) {
    const standard = buildMap({
      rng: new Rng(seed),
      width: 24,
      height: 16,
      threatCount: 2,
      difficulty: CONTRACT_DIFFICULTY.STANDARD,
    });
    assert.equal(standard.corpCivilians.length, 0);
    assert.equal(standard.neutralCivilians.length, 0);

    const elevated = buildMap({
      rng: new Rng(seed),
      width: 24,
      height: 16,
      threatCount: 3,
      difficulty: CONTRACT_DIFFICULTY.ELEVATED,
    });
    assert.ok(elevated.corpCivilians.length <= 1);
    assert.equal(elevated.neutralCivilians.length, 0);

    const critical = buildMap({
      rng: new Rng(seed),
      width: 24,
      height: 16,
      threatCount: 4,
      difficulty: CONTRACT_DIFFICULTY.CRITICAL,
    });
    assert.ok(critical.corpCivilians.length <= 1);
    assert.ok(critical.neutralCivilians.length <= 1);
  }
});

test('unknown contract difficulty throws', () => {
  assert.throws(
    () =>
      buildMap({
        rng: new Rng(1),
        width: 24,
        height: 16,
        threatCount: 1,
        difficulty: 'black-ice',
      }),
    /unknown difficulty/
  );
});

test('negative maxCorpCivilians / maxNeutralCivilians throw', () => {
  assert.throws(
    () =>
      buildMap({ rng: new Rng(1), width: 24, height: 16, threatCount: 1, maxCorpCivilians: -1 }),
    /maxCorpCivilians/
  );
  assert.throws(
    () =>
      buildMap({ rng: new Rng(1), width: 24, height: 16, threatCount: 1, maxNeutralCivilians: -1 }),
    /maxNeutralCivilians/
  );
});
