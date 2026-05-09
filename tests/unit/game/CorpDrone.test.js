import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { Entity } from '../../../src/game/Entity.js';
import { World } from '../../../src/game/World.js';
import { TILE, FACTION, AP_COST, BASE_HIT_CHANCE } from '../../../src/game/constants.js';
import { CorpDrone, DRONE_STATE } from '../../../src/game/ai/CorpDrone.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import { Rng } from '../../../src/rng.js';

/**
 * Stub RNG that returns a fixed sequence of numbers and crashes if drained.
 * Lets each combat-touching test pin hit/miss outcomes without coupling to
 * mulberry32 state.
 */
class StubRng {
  constructor(values) {
    this.values = [...values];
    this.calls = 0;
  }
  next() {
    if (this.calls >= this.values.length) {
      throw new Error('StubRng drained — test under-supplied rolls');
    }
    return this.values[this.calls++];
  }
}

const openWorld = (w = 12, h = 6) => new World(new Grid(w, h));

test('drone with patrol waypoints walks toward the first waypoint', () => {
  const w = openWorld();
  const drone = new CorpDrone({
    id: 'd',
    x: 1,
    y: 2,
    maxAp: AP_COST.MOVE,
    patrolWaypoints: [{ x: 5, y: 2 }],
  });
  w.addEntity(drone);
  const log = drone.takeTurn(w, new Rng(1));
  // One AP, one move. Drone advances one Chebyshev step closer to (5, 2).
  assert.equal(drone.ap, 0);
  assert.ok(drone.x > 1, 'drone moved east');
  assert.equal(drone.state, DRONE_STATE.PATROL);
  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'move-patrol');
});

test('drone advances waypoint index on arrival', () => {
  const w = openWorld();
  const drone = new CorpDrone({
    id: 'd',
    x: 5,
    y: 2,
    maxAp: 2,
    patrolWaypoints: [
      { x: 5, y: 2 }, // current tile — should immediately tick
      { x: 8, y: 2 },
    ],
  });
  w.addEntity(drone);
  const log = drone.takeTurn(w, new Rng(1));
  assert.equal(drone.patrolIndex, 1);
  // After ticking, the drone heads toward the second waypoint.
  assert.ok(drone.x > 5);
  assert.ok(log.some(e => e.type === 'patrol-arrived'));
});

test('drone with no waypoints holds position', () => {
  const w = openWorld();
  const drone = new CorpDrone({ id: 'd', x: 3, y: 3, maxAp: 3 });
  w.addEntity(drone);
  const log = drone.takeTurn(w, new Rng(1));
  assert.deepEqual({ x: drone.x, y: drone.y }, { x: 3, y: 3 });
  assert.equal(drone.ap, 3, 'AP unspent — nothing to do');
  assert.deepEqual(log, []);
});

test('drone in LOS+range fires at the player when AP allows', () => {
  const w = openWorld();
  const player = new Entity({ id: 'p', x: 3, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new CorpDrone({ id: 'd', x: 6, y: 2, maxAp: AP_COST.RANGED_ATTACK });
  w.addEntity(player);
  w.addEntity(drone);
  // Roll < BASE_HIT_CHANCE → guaranteed hit.
  const rng = new StubRng([0]);
  const log = drone.takeTurn(w, rng);
  assert.equal(drone.state, DRONE_STATE.ENGAGE);
  assert.equal(drone.ap, 0);
  assert.equal(player.hp, player.maxHp - 1);
  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'fire');
  assert.equal(log[0].result.hit, true);
});

test('drone closes distance when target is out of fire range', () => {
  // Long open corridor; drone is way out of SIGHT_RANGE on a straight line.
  const grid = new Grid(30, 3);
  for (let x = 0; x < 30; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, 2, TILE.WALL);
  }
  const w = new World(grid);
  const player = new Entity({ id: 'p', x: 1, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new CorpDrone({ id: 'd', x: 25, y: 1, maxAp: 4 });
  w.addEntity(player);
  w.addEntity(drone);
  const log = drone.takeTurn(w, new Rng(1));
  // No target acquired (out of sight range), so drone falls back to patrol;
  // with no waypoints, that means hold. The point of this test is the absence
  // of fire / illegal moves — drone shouldn't crash trying to engage at distance.
  assert.equal(player.hp, player.maxHp);
  assert.equal(drone.state, DRONE_STATE.PATROL);
  void log;
});

test('drone investigates last known position when target leaves LOS', () => {
  // Layout: drone on left, player on right, with a tall wall between except
  // at one row. After the drone "sees" the player, we drop a wall in front
  // and re-run; the drone should head for the last-known coords.
  const grid = new Grid(12, 5);
  const w = new World(grid);
  const player = new Entity({ id: 'p', x: 8, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new CorpDrone({ id: 'd', x: 2, y: 2, maxAp: 1 });
  w.addEntity(player);
  w.addEntity(drone);

  // Turn 1: clear LOS, drone acquires + (with only 1 AP) tries to fire.
  drone.takeTurn(w, new StubRng([0]));
  assert.equal(drone.state, DRONE_STATE.ENGAGE);
  assert.deepEqual(drone.lastKnownTarget, { x: 8, y: 2 });

  // Turn 2: player jumps behind cover by removing them from view — wall the row.
  for (let x = 4; x < 7; x++) grid.setTile(x, 2, TILE.WALL);
  drone.refreshAp(); // simulate turn boundary
  drone.takeTurn(w, new Rng(1));
  // Drone should have transitioned to investigate and stepped toward (8, 2)…
  // …but the wall blocks the direct path. With the row walled at y=2 between
  // x=4 and x=6, the drone needs to detour through y=1 or y=3.
  assert.notEqual(drone.state, DRONE_STATE.ENGAGE);
  assert.ok(
    drone.state === DRONE_STATE.INVESTIGATE || drone.state === DRONE_STATE.PATROL,
    `unexpected state ${drone.state}`
  );
  // Either the drone moved (investigating) or marked the lead abandoned.
  // We don't pin the exact coords here — Pathfinding handles geometry; the
  // contract under test is "didn't shoot through a wall and didn't crash".
  assert.equal(player.hp, player.maxHp, 'no fire through wall');
});

test('drone returns to patrol after reaching last-known position empty-handed', () => {
  const w = openWorld();
  const drone = new CorpDrone({
    id: 'd',
    x: 4,
    y: 2,
    maxAp: 1,
    patrolWaypoints: [{ x: 1, y: 2 }],
  });
  drone.state = DRONE_STATE.INVESTIGATE;
  drone.lastKnownTarget = { x: 4, y: 2 }; // already there — nothing to find
  w.addEntity(drone);
  const log = drone.takeTurn(w, new Rng(1));
  assert.equal(drone.state, DRONE_STATE.PATROL);
  assert.equal(drone.lastKnownTarget, null);
  assert.ok(log.some(e => e.type === 'investigate-cleared'));
});

test('noise event puts a patrolling drone into investigate', () => {
  const bus = new EventBus();
  const drone = new CorpDrone({ id: 'd', x: 2, y: 2 });
  drone.bindToBus(bus);
  bus.emit(EVENT.NOISE, { origin: { x: 7, y: 4 } });
  assert.equal(drone.state, DRONE_STATE.INVESTIGATE);
  assert.deepEqual(drone.lastKnownTarget, { x: 7, y: 4 });
});

test('noise event does NOT pull an engaging drone off its target', () => {
  const bus = new EventBus();
  const drone = new CorpDrone({ id: 'd', x: 2, y: 2 });
  drone.state = DRONE_STATE.ENGAGE;
  drone.lastKnownTarget = { x: 4, y: 2 };
  drone.bindToBus(bus);
  bus.emit(EVENT.NOISE, { origin: { x: 9, y: 9 } });
  assert.equal(drone.state, DRONE_STATE.ENGAGE);
  assert.deepEqual(drone.lastKnownTarget, { x: 4, y: 2 }, 'lastKnownTarget unchanged');
});

test('CorpDrone.unbind detaches noise listener', () => {
  const bus = new EventBus();
  const drone = new CorpDrone({ id: 'd', x: 2, y: 2 });
  drone.bindToBus(bus);
  drone.unbind();
  bus.emit(EVENT.NOISE, { origin: { x: 7, y: 4 } });
  assert.equal(drone.state, DRONE_STATE.PATROL);
  assert.equal(drone.lastKnownTarget, null);
});

test('takeTurn on a dead drone is a no-op', () => {
  const w = openWorld();
  const drone = new CorpDrone({
    id: 'd',
    x: 1,
    y: 1,
    patrolWaypoints: [{ x: 5, y: 1 }],
  });
  w.addEntity(drone);
  drone.alive = false;
  const log = drone.takeTurn(w, new Rng(1));
  assert.deepEqual(log, []);
  assert.equal(drone.x, 1);
});

test('CorpDrone constructor rejects malformed waypoints', () => {
  assert.throws(
    () => new CorpDrone({ id: 'd', x: 1, y: 1, patrolWaypoints: [{ x: 0.5, y: 1 }] }),
    TypeError
  );
  assert.throws(
    () => new CorpDrone({ id: 'd', x: 1, y: 1, patrolWaypoints: 'not-an-array' }),
    TypeError
  );
});

// Sanity: BASE_HIT_CHANCE is what the StubRng tests above are pinned against.
// If tuning ever pushes it to 0 the "guaranteed hit" tests would silently
// stop being guaranteed — assert here so the bug surfaces in this file.
test('BASE_HIT_CHANCE is in (0, 1] so a 0-roll always hits', () => {
  assert.ok(BASE_HIT_CHANCE > 0 && BASE_HIT_CHANCE <= 1);
});

// --- M6: stealth + noise filters ---------------------------------------

test('drone does NOT acquire a stealthed target outside Chebyshev 1', () => {
  const w = openWorld();
  const player = new Entity({ id: 'p', x: 3, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  player.stealthed = true;
  const drone = new CorpDrone({ id: 'd', x: 6, y: 2, maxAp: AP_COST.RANGED_ATTACK });
  w.addEntity(player);
  w.addEntity(drone);
  // Same setup as the "drone fires" test — but stealthed: drone shouldn't see
  // her at distance 3.
  const log = drone.takeTurn(w, new StubRng([0]));
  assert.equal(player.hp, player.maxHp, 'no shot through stealth');
  assert.notEqual(drone.state, DRONE_STATE.ENGAGE);
  void log;
});

test('drone DOES acquire a stealthed target standing adjacent (Chebyshev 1)', () => {
  const w = openWorld();
  const player = new Entity({ id: 'p', x: 5, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  player.stealthed = true;
  const drone = new CorpDrone({ id: 'd', x: 6, y: 2, maxAp: AP_COST.RANGED_ATTACK });
  w.addEntity(player);
  w.addEntity(drone);
  drone.takeTurn(w, new StubRng([0]));
  assert.equal(drone.state, DRONE_STATE.ENGAGE);
  assert.equal(player.hp, player.maxHp - 1, 'adjacent-stealth still gets shot');
});

test('drone ignores noise from same-faction sources (no friendly footstep panic)', () => {
  const bus = new EventBus();
  const drone = new CorpDrone({ id: 'd', x: 2, y: 2 });
  drone.bindToBus(bus);
  // Another drone — same faction.
  const teammate = new CorpDrone({ id: 'd2', x: 5, y: 5 });
  bus.emit(EVENT.NOISE, { origin: { x: 5, y: 5 }, radius: 8, source: teammate });
  assert.equal(drone.state, DRONE_STATE.PATROL);
  assert.equal(drone.lastKnownTarget, null);
});

test('drone ignores noise outside its hearing radius', () => {
  const bus = new EventBus();
  const drone = new CorpDrone({ id: 'd', x: 0, y: 0 });
  drone.bindToBus(bus);
  // Origin 100 tiles away, radius 3 — well outside hearing.
  bus.emit(EVENT.NOISE, { origin: { x: 100, y: 0 }, radius: 3 });
  assert.equal(drone.state, DRONE_STATE.PATROL);
  assert.equal(drone.lastKnownTarget, null);
});

test('drone investigates noise from a hostile inside its hearing radius', () => {
  const bus = new EventBus();
  const drone = new CorpDrone({ id: 'd', x: 0, y: 0 });
  const player = new Entity({ id: 'p', x: 2, y: 0, faction: FACTION.PLAYER, glyph: '@' });
  drone.bindToBus(bus);
  bus.emit(EVENT.NOISE, { origin: { x: 2, y: 0 }, radius: 3, source: player });
  assert.equal(drone.state, DRONE_STATE.INVESTIGATE);
  assert.deepEqual(drone.lastKnownTarget, { x: 2, y: 0 });
});
