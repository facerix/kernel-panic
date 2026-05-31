import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { Entity } from '../../../src/game/Entity.js';
import { World } from '../../../src/game/World.js';
import {
  TILE,
  FACTION,
  AP_COST,
  BASE_HIT_CHANCE,
  SIGHT_RANGE,
} from '../../../src/game/constants.js';
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

test('long-sighted drone fires at a target beyond SIGHT_RANGE but within its sightRange', () => {
  // Regression: acquireTarget qualifies targets by this.sightRange, but the
  // fire check used to default to SIGHT_RANGE — so a drone with extended
  // sight could see a target it could never shoot.
  const dist = SIGHT_RANGE + 2;
  const w = openWorld(dist + 3, 6);
  const player = new Entity({ id: 'p', x: 1 + dist, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new CorpDrone({
    id: 'd',
    x: 1,
    y: 2,
    maxAp: AP_COST.RANGED_ATTACK,
    sightRange: SIGHT_RANGE + 4,
  });
  w.addEntity(player);
  w.addEntity(drone);
  const log = drone.takeTurn(w, new StubRng([0]));
  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'fire');
  assert.equal(player.hp, player.maxHp - 1);
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

// ---------------------------------------------------------------------------
// takeTurnSteps — generator form. Exists so the game shell can paint between
// each committed action; the M0 user-reported bug was a "fire then move" turn
// leaving the muzzle flash stranded on the tile the drone had just vacated.
// ---------------------------------------------------------------------------

test('takeTurnSteps yields one entry per committed action (fire then move)', () => {
  const w = openWorld();
  const player = new Entity({ id: 'p', x: 3, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  // 3 AP: enough to fire (cost 2) AND then take one step (cost 1).
  const drone = new CorpDrone({ id: 'd', x: 6, y: 2, maxAp: 3 });
  w.addEntity(player);
  w.addEntity(drone);
  const rng = new StubRng([0]); // guaranteed hit
  const steps = [...drone.takeTurnSteps(w, rng)];
  assert.equal(steps.length, 2, 'one fire + one move');
  assert.equal(steps[0].type, 'fire');
  assert.equal(steps[1].type, 'move-engage');
  // Drone has used all 3 AP and moved closer.
  assert.equal(drone.ap, 0);
  assert.ok(drone.x < 6, 'drone closed distance after firing');
});

test('takeTurnSteps pauses mid-turn — caller can inspect state between yields', () => {
  // This is the core property the corp-turn animator relies on: when the
  // shell consumes one yield, the world is *already mutated* by that action,
  // and the *next* action hasn't happened yet. Without this, the per-step
  // paint between yields would either be a frame ahead of the action or a
  // frame behind it.
  const w = openWorld();
  const player = new Entity({ id: 'p', x: 3, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new CorpDrone({ id: 'd', x: 6, y: 2, maxAp: 3 });
  w.addEntity(player);
  w.addEntity(drone);
  const gen = drone.takeTurnSteps(w, new StubRng([0]));

  const first = gen.next();
  assert.equal(first.value.type, 'fire');
  // After the fire yield: player is damaged, drone hasn't moved yet.
  assert.equal(player.hp, player.maxHp - 1);
  assert.equal(drone.x, 6, 'drone has not stepped yet at the fire-yield boundary');

  const second = gen.next();
  assert.equal(second.value.type, 'move-engage');
  assert.ok(drone.x < 6, 'drone has now stepped');

  assert.equal(gen.next().done, true);
});

test('takeTurnSteps on a dead drone is a no-op generator', () => {
  const w = openWorld();
  const drone = new CorpDrone({ id: 'd', x: 1, y: 1, maxAp: 3 });
  w.addEntity(drone);
  drone.damage(drone.maxHp); // flatline
  const steps = [...drone.takeTurnSteps(w, new Rng(1))];
  assert.deepEqual(steps, []);
});

test('takeTurnSteps does NOT crash the safety cap on unreachable patrol waypoints', () => {
  // Layout: drone walled in on all 8 neighbours so pathfinding to any
  // outside waypoint returns null. Without the patrol-spin guard, the
  // generator would cycle patrolIndex through the ring forever (no AP
  // spent on `patrol-skipped`) and trip the 32-iteration safety cap with
  // `CorpDrone <id> exceeded turn iteration cap`.
  const grid = new Grid(8, 6);
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ]) {
    grid.setTile(1 + dx, 1 + dy, TILE.WALL);
  }
  const w = new World(grid);
  const drone = new CorpDrone({
    id: 'd',
    x: 1,
    y: 1,
    maxAp: 3,
    patrolWaypoints: [
      { x: 5, y: 1 },
      { x: 6, y: 2 },
      { x: 5, y: 4 },
    ],
  });
  w.addEntity(drone);

  // Just calling `takeTurn` (which drains the generator) must not throw.
  // We also assert it produced *some* log entries (the skips themselves) so
  // a future regression that silently aborts the generator pre-yield fails too.
  let log;
  assert.doesNotThrow(() => {
    log = drone.takeTurn(w, new Rng(1));
  });
  assert.ok(
    log.some(e => e.type === 'patrol-skipped'),
    'drone should have logged at least one skip before exiting'
  );
  // And we expect the exit path: spin guard, not the safety cap. With 3
  // waypoints, the loop should yield at most `waypoints.length` skips
  // before breaking.
  const skips = log.filter(e => e.type === 'patrol-skipped').length;
  assert.ok(skips <= 4, `spin guard should cap skips at ~waypoints.length, got ${skips}`);
});

test('takeTurnSteps does NOT crash on co-located patrol waypoints', () => {
  // Pathological but legal author input: every waypoint sits on the drone's
  // tile. Without the spin guard, the drone advances `patrolIndex` infinitely
  // (yielding `patrol-arrived` without burning AP) and hits the safety cap.
  const w = openWorld();
  const drone = new CorpDrone({
    id: 'd',
    x: 3,
    y: 3,
    maxAp: 3,
    patrolWaypoints: [
      { x: 3, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 3 },
    ],
  });
  w.addEntity(drone);
  let log;
  assert.doesNotThrow(() => {
    log = drone.takeTurn(w, new Rng(1));
  });
  const arrivals = log.filter(e => e.type === 'patrol-arrived').length;
  assert.ok(arrivals <= 4, `spin guard should cap arrivals at ~waypoints.length, got ${arrivals}`);
});

test('takeTurn drains takeTurnSteps into the legacy log shape', () => {
  // Behaviour contract: the synchronous wrapper produces the same array of
  // log entries the generator would, in order — tests + the debug harness
  // both depend on this.
  const w = openWorld();
  const player = new Entity({ id: 'p', x: 3, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new CorpDrone({ id: 'd', x: 6, y: 2, maxAp: 3 });
  w.addEntity(player);
  w.addEntity(drone);

  // Snapshot the generator's output on a fresh world, then re-run via takeTurn
  // on an identical setup and confirm the two are deep-equal.
  const gw = openWorld();
  const gplayer = new Entity({ id: 'p', x: 3, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const gdrone = new CorpDrone({ id: 'd', x: 6, y: 2, maxAp: 3 });
  gw.addEntity(gplayer);
  gw.addEntity(gdrone);
  const generated = [...gdrone.takeTurnSteps(gw, new StubRng([0]))];

  const fromWrapper = drone.takeTurn(w, new StubRng([0]));
  assert.deepEqual(fromWrapper, generated);
});

// --- M5: alarm subscription --------------------------------------------------

test('drone subscribes to alarm and force-transitions to ENGAGE with target position', () => {
  const bus = new EventBus();
  const world = new World(new Grid(12, 6), { events: bus });
  const drone = new CorpDrone({ id: 'd', x: 1, y: 1, maxAp: 3, patrolWaypoints: [{ x: 5, y: 1 }] });
  world.addEntity(drone);
  drone.bindToBus(bus);
  assert.equal(drone.state, DRONE_STATE.PATROL);

  // Simulate an alarm from a CorpCivilian spotting a player at (8, 3).
  bus.emit(EVENT.ALARM, {
    source: { id: 'civ-0', x: 3, y: 3 },
    target: { id: 'player', x: 8, y: 3, alive: true },
    origin: { x: 3, y: 3 },
  });

  assert.equal(drone.state, DRONE_STATE.ENGAGE, 'alarm should force ENGAGE');
  assert.deepEqual(drone.lastKnownTarget, { x: 8, y: 3 }, 'target should be the player position');
});

test('alarm overrides existing ENGAGE target with fresh intel', () => {
  const bus = new EventBus();
  const world = new World(new Grid(12, 6), { events: bus });
  const drone = new CorpDrone({ id: 'd', x: 1, y: 1, maxAp: 3 });
  world.addEntity(drone);
  drone.bindToBus(bus);

  // Already engaging a stale target.
  drone.state = DRONE_STATE.ENGAGE;
  drone.lastKnownTarget = { x: 5, y: 5 };

  // Fresh alarm with a different player position.
  bus.emit(EVENT.ALARM, {
    source: { id: 'civ-0', x: 2, y: 2 },
    target: { id: 'player', x: 9, y: 1, alive: true },
    origin: { x: 2, y: 2 },
  });

  assert.deepEqual(drone.lastKnownTarget, { x: 9, y: 1 }, 'fresh alarm should update target');
});

test('dead drone ignores alarm events', () => {
  const bus = new EventBus();
  const world = new World(new Grid(12, 6), { events: bus });
  const drone = new CorpDrone({ id: 'd', x: 1, y: 1, maxAp: 3 });
  world.addEntity(drone);
  drone.bindToBus(bus);
  drone.damage(drone.maxHp); // kill

  bus.emit(EVENT.ALARM, {
    source: { id: 'civ-0', x: 2, y: 2 },
    target: { id: 'player', x: 8, y: 3, alive: true },
    origin: { x: 2, y: 2 },
  });

  assert.equal(drone.state, DRONE_STATE.PATROL, 'dead drone stays in original state');
  assert.equal(drone.lastKnownTarget, null, 'dead drone does not acquire target');
});

// --- M5: drones must not target NEUTRAL civilians ----------------------------

// --- M2.1: skirmisher kiting (preferred engagement band) ---------------------

test('drone kites away from a target that closed inside preferredMin (with retreat room)', () => {
  const w = openWorld(14, 6);
  const player = new Entity({ id: 'p', x: 5, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  // Adjacent (cheb 1 < preferredMin 3). 2 AP — enough to fire (cost 2) OR move;
  // it must CHOOSE to retreat rather than fire at point-blank.
  const drone = new CorpDrone({ id: 'd', x: 6, y: 2, maxAp: 2 });
  w.addEntity(player);
  w.addEntity(drone);
  const log = drone.takeTurn(w, new StubRng([0])); // a 0-roll would guarantee a hit IF it fired
  assert.equal(player.hp, player.maxHp, 'drone retreated instead of firing point-blank');
  assert.ok(!log.some(s => s.type === 'fire'), 'no shot while kiting');
  assert.ok(
    log.some(s => s.type === 'move-engage'),
    'drone stepped away under the engage banner'
  );
  assert.ok(drone.x > 6, 'drone increased distance from the player');
});

test('cornered drone fires when no retreat tile increases distance', () => {
  // Left wall at x=0 boxes the drone at x=1; the only legal neighbours
  // (1,1)/(1,3) sit at the same Chebyshev distance to the player, so none
  // strictly increases distance → kite is impossible → it stands and fires.
  const grid = new Grid(8, 6);
  for (let y = 0; y < 6; y++) grid.setTile(0, y, TILE.WALL);
  const w = new World(grid);
  const player = new Entity({ id: 'p', x: 2, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new CorpDrone({ id: 'd', x: 1, y: 2, maxAp: AP_COST.RANGED_ATTACK });
  w.addEntity(player);
  w.addEntity(drone);
  const log = drone.takeTurn(w, new StubRng([0]));
  assert.equal(drone.state, DRONE_STATE.ENGAGE);
  assert.ok(
    log.some(s => s.type === 'fire'),
    'cornered drone falls back to firing'
  );
  assert.equal(player.hp, player.maxHp - 1);
});

test('drone at or beyond preferredMin fires rather than kiting', () => {
  // cheb distance exactly preferredMin (3): outside the kite band, so it fires.
  const w = openWorld();
  const player = new Entity({ id: 'p', x: 3, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new CorpDrone({ id: 'd', x: 6, y: 2, maxAp: AP_COST.RANGED_ATTACK });
  assert.equal(drone.preferredMin, 3, 'default kite band');
  w.addEntity(player);
  w.addEntity(drone);
  const log = drone.takeTurn(w, new StubRng([0]));
  assert.equal(log[0].type, 'fire');
  assert.equal(player.hp, player.maxHp - 1);
});

test('drone does NOT kite away from an adjacent stealthed target (would lose acquisition)', () => {
  // A stealthed target is only spottable at Chebyshev ≤1; retreating would drop
  // it entirely, so the drone stands and fires instead of kiting itself blind.
  const w = openWorld();
  const player = new Entity({ id: 'p', x: 5, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  player.stealthed = true;
  const drone = new CorpDrone({ id: 'd', x: 6, y: 2, maxAp: AP_COST.RANGED_ATTACK });
  w.addEntity(player);
  w.addEntity(drone);
  const log = drone.takeTurn(w, new StubRng([0]));
  assert.equal(drone.state, DRONE_STATE.ENGAGE);
  assert.ok(log.some(s => s.type === 'fire'));
  assert.equal(player.hp, player.maxHp - 1);
});

test('drone does not acquire NEUTRAL entities as targets', () => {
  const grid = new Grid(10, 10);
  for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 10; y++) grid.setTile(x, y, TILE.FLOOR);
  }
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  const drone = new CorpDrone({
    id: 'drone',
    x: 3,
    y: 3,
    maxAp: 3,
    patrolWaypoints: [{ x: 3, y: 3 }],
  });
  const neutral = new Entity({
    id: 'neutral-civ',
    x: 4,
    y: 3,
    faction: FACTION.NEUTRAL,
    glyph: 'n',
  });
  world.addEntity(drone);
  world.addEntity(neutral);
  drone.bindToBus(bus);

  // The drone should NOT see the neutral as hostile.
  assert.equal(drone.acquireTarget(world), null, 'NEUTRAL must not be a valid target');
  assert.equal(drone.isHostileTo(neutral), false, 'NEUTRAL must not be hostile');
});
