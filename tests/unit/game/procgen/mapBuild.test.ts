import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../../../../src/rng.js';
import { CONTRACT_DIFFICULTY, TILE } from '../../../../src/game/constants.js';
import { Grid } from '../../../../src/game/Grid.js';
import { World } from '../../../../src/game/World.js';
import { Door } from '../../../../src/game/entities/Door.js';
import { Terminal } from '../../../../src/game/entities/Terminal.js';
import { findPath } from '../../../../src/game/Pathfinding.js';
import { buildMap, placeDoors } from '../../../../src/game/procgen/mapBuild.js';
import { PREFABS } from '../../../../src/game/procgen/prefabs/index.js';

const W = 24;
const H = 16;

function simpleCorridorWorld() {
  const grid = new Grid(7, 3, TILE.WALL);
  for (let x = 1; x < 6; x++) grid.setTile(x, 1, TILE.FLOOR);
  return new World(grid);
}

function sideRoomWorld() {
  const grid = new Grid(15, 9, TILE.WALL);
  for (let x = 1; x <= 13; x++) {
    grid.setTile(x, 4, TILE.FLOOR);
    grid.setTile(x, 5, TILE.FLOOR);
  }
  for (let x = 6; x <= 8; x++) {
    grid.setTile(x, 1, TILE.FLOOR);
    grid.setTile(x, 2, TILE.FLOOR);
  }
  grid.setTile(7, 3, TILE.FLOOR);
  return new World(grid);
}

function bypassConnectorWorld() {
  const grid = new Grid(15, 9, TILE.WALL);
  for (let x = 1; x <= 13; x++) {
    grid.setTile(x, 3, TILE.FLOOR);
    grid.setTile(x, 5, TILE.FLOOR);
  }
  for (const x of [1, 7, 13]) {
    for (let y = 3; y <= 5; y++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  return new World(grid);
}

test('buildMap is deterministic for the same seed', () => {
  const a = buildMap({ rng: new Rng(0xdecafbad), width: W, height: H, threatCount: 2 });
  const b = buildMap({ rng: new Rng(0xdecafbad), width: W, height: H, threatCount: 2 });
  assert.deepEqual(Array.from(a.grid.tiles), Array.from(b.grid.tiles), 'grid bytes diverged');
  assert.deepEqual(a.spawns, b.spawns);
  assert.deepEqual(a.exitTile, b.exitTile);
  assert.deepEqual(a.drones, b.drones);
});

test('checkpoint divider wall survives corridor carve (regression: map-debug seed)', () => {
  const map = buildMap({ rng: new Rng(2015515018), width: W, height: H, threatCount: 2 });
  const cp = PREFABS.checkpoint;
  const doorCol = [0, 1, 2, 3, 4].map(y => map.grid.tileAt(4, 10 + y));
  assert.deepEqual(
    doorCol,
    [TILE.WALL, TILE.WALL, TILE.FLOOR, TILE.WALL, TILE.WALL],
    'checkpoint door column should be intact after mapgen'
  );
  assert.equal(cp.tiles[2 * cp.w + 3], TILE.FLOOR, 'prefab door cell is floor');
});

test('buildMap only returns door anchors when prefab doors are requested', () => {
  const closed = buildMap({ rng: new Rng(0xdecafbad), width: W, height: H, threatCount: 2 });
  const gated = buildMap({
    rng: new Rng(0xdecafbad),
    width: W,
    height: H,
    threatCount: 2,
    includePrefabDoors: true,
  });

  assert.deepEqual(closed.doors, []);
  assert.ok(gated.doors.length > 0, 'door-preferring maps should expose door anchors');
  for (const door of gated.doors) {
    assert.equal(gated.grid.tileAt(door.x, door.y), TILE.FLOOR);
    assert.notDeepEqual(door, gated.spawns.player);
    assert.notDeepEqual(door, gated.exitTile);
  }
});

test('placeDoors identifies a meaningful bottleneck and pairs a reachable unlock terminal', () => {
  const world = sideRoomWorld();
  const placed = placeDoors(world, CONTRACT_DIFFICULTY.ELEVATED, new Rng(7), {
    spawn: { x: 1, y: 4 },
    exitTile: { x: 13, y: 4 },
  });

  assert.equal(placed.length, 1);
  const door = [...world.entities.values()].find(entity => entity instanceof Door);
  const terminal = [...world.entities.values()].find(entity => entity instanceof Terminal);
  assert.ok(door instanceof Door);
  assert.ok(terminal instanceof Terminal);
  assert.equal(terminal.unlocksId, door.doorId);
  assert.equal(world.grid.tileAt(door.x, door.y), TILE.FLOOR);
  assert.equal(world.grid.tileAt(terminal.x, terminal.y), TILE.FLOOR);
  const terminalAdjacentReachable = [
    { x: terminal.x - 1, y: terminal.y },
    { x: terminal.x + 1, y: terminal.y },
    { x: terminal.x, y: terminal.y - 1 },
    { x: terminal.x, y: terminal.y + 1 },
  ].some(
    point =>
      world.grid.inBounds(point.x, point.y) &&
      world.grid.isPassable(point.x, point.y) &&
      !world.entityAt(point.x, point.y) &&
      findPath(world, { x: 1, y: 4 }, point, { allowOccupiedGoal: false })
  );
  assert.ok(
    terminalAdjacentReachable,
    'terminal should be reachable while the dynamic door is locked'
  );
  assert.ok(
    findPath(world, { x: 1, y: 4 }, { x: 13, y: 4 }, { allowOccupiedGoal: false }),
    'dynamic door must preserve spawn-to-exit connectivity while locked'
  );
});

test('placeDoors skips a bottleneck that would sever spawn-to-exit connectivity', () => {
  const world = simpleCorridorWorld();
  const placed = placeDoors(world, CONTRACT_DIFFICULTY.ELEVATED, new Rng(7), {
    spawn: { x: 1, y: 1 },
    exitTile: { x: 5, y: 1 },
  });

  assert.deepEqual(placed, []);
  assert.equal([...world.entities.values()].filter(entity => entity instanceof Door).length, 0);
});

test('placeDoors skips connector doors that do not gate any additional floor', () => {
  const world = bypassConnectorWorld();
  const placed = placeDoors(world, CONTRACT_DIFFICULTY.ELEVATED, new Rng(7), {
    spawn: { x: 1, y: 3 },
    exitTile: { x: 13, y: 3 },
  });

  assert.deepEqual(placed, []);
  assert.equal([...world.entities.values()].filter(entity => entity instanceof Door).length, 0);
  assert.equal([...world.entities.values()].filter(entity => entity instanceof Terminal).length, 0);
});

test('placeDoors gates count by difficulty', () => {
  const standard = sideRoomWorld();
  assert.equal(
    placeDoors(standard, CONTRACT_DIFFICULTY.STANDARD, new Rng(1), {
      spawn: { x: 1, y: 4 },
      exitTile: { x: 13, y: 4 },
    }).length,
    0
  );

  const elevated = sideRoomWorld();
  assert.equal(
    placeDoors(elevated, CONTRACT_DIFFICULTY.ELEVATED, new Rng(1), {
      spawn: { x: 1, y: 4 },
      exitTile: { x: 13, y: 4 },
    }).length,
    1
  );

  const critical = sideRoomWorld();
  const criticalCount = placeDoors(critical, CONTRACT_DIFFICULTY.CRITICAL, new Rng(1), {
    spawn: { x: 1, y: 4 },
    exitTile: { x: 13, y: 4 },
  }).length;
  assert.ok(criticalCount >= 1 && criticalCount <= 2);
});

test('buildMap returns dynamic door diagnostics separately from prefab door anchors', () => {
  const standard = buildMap({
    rng: new Rng(0xdecafbad),
    width: W,
    height: H,
    threatCount: 2,
    difficulty: CONTRACT_DIFFICULTY.STANDARD,
  });
  assert.equal(standard.dynamicDoorCount, 0);
  assert.deepEqual(standard.dynamicDoors, []);

  let elevated: ReturnType<typeof buildMap> | null = null;
  for (let seed = 1; seed < 80 && !elevated; seed++) {
    const candidate = buildMap({
      rng: new Rng(seed),
      width: W,
      height: H,
      threatCount: 2,
      difficulty: CONTRACT_DIFFICULTY.ELEVATED,
    });
    if (candidate.dynamicDoorCount > 0) elevated = candidate;
  }
  assert.ok(elevated, 'expected at least one deterministic seed to place a dynamic door');
  assert.equal(elevated.dynamicDoorCount, elevated.dynamicDoors.length);
  assert.deepEqual(elevated.doors, [], 'ambient doors must not masquerade as prefab doors');
});

test('door-linked maps never spawn the player on a door anchor', () => {
  for (let seed = 0; seed < 100; seed++) {
    const map = buildMap({
      rng: new Rng(seed),
      width: W,
      height: H,
      threatCount: 3,
      includePrefabDoors: true,
    });
    for (const door of map.doors) {
      assert.notDeepEqual(
        map.spawns.player,
        door,
        `seed ${seed}: player spawn must not coincide with door anchor`
      );
    }
  }
});

test('spawn leaf never uses the checkpoint prefab', () => {
  for (let seed = 0; seed < 50; seed++) {
    const map = buildMap({
      rng: new Rng(seed),
      width: W,
      height: H,
      threatCount: 2,
      includePrefabDoors: true,
    });
    const door = map.doors[0];
    assert.ok(door, 'expected a door anchor');
    const spawnCenterMatchesDoor = map.spawns.player.x === door.x && map.spawns.player.y === door.y;
    assert.equal(spawnCenterMatchesDoor, false);
  }
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
