/**
 * P3.6 — Molotov throw geometry.
 *
 * `resolveIncendiaryImpact` replaces the old "land at exactly `dir * 3`, refuse
 * if LOS is blocked" rule. The bottle now flies until something stops it and
 * detonates there, so these tests are the contract for *where* it lands.
 *
 * The shell (`resolveAimedUseItem`) is the only caller and has no unit coverage
 * of its own — see the `shell-runtime-untestable` note. This file is what guards
 * the behaviour, so it carries the edge cases the shell used to gate on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { EventBus } from '../../../src/game/events.js';
import { TILE, FACTION, INCENDIARY_THROW_DIST } from '../../../src/game/constants.js';
import { resolveIncendiaryImpact } from '../../../src/game/incendiary.js';
import { Door } from '../../../src/game/entities/Door.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { ConsumablePickup } from '../../../src/game/entities/ConsumablePickup.js';
import { EscortNpc } from '../../../src/game/entities/EscortNpc.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorld(width = 12, height = 12) {
  const grid = new Grid(width, height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  return new World(grid, { events: new EventBus() });
}

/** A plain blocking, burnable body — the drone stand-in. */
function makeBody(id: string, x: number, y: number, faction: string = FACTION.CORP) {
  return new Entity({ id, x, y, faction, glyph: 'd', maxHp: 3 });
}

const THROWER = { x: 5, y: 5 };

/** Throw from THROWER along `aim`, at the real configured range. */
function throwFrom(world: World, dx: number, dy: number, origin = THROWER) {
  return resolveIncendiaryImpact(world, origin, { dx, dy }, INCENDIARY_THROW_DIST);
}

// ---------------------------------------------------------------------------
// Baseline: open ground
// ---------------------------------------------------------------------------

test('over open floor the bottle flies the full throw distance', () => {
  const world = makeWorld();
  const impact = throwFrom(world, 1, 0);
  assert.deepEqual(
    { x: impact?.x, y: impact?.y },
    { x: 5 + INCENDIARY_THROW_DIST, y: 5 },
    'nothing in the way means it lands at max range'
  );
  assert.equal(impact?.intercepted, null);
});

test('diagonal throws travel the same number of steps, not the same euclidean distance', () => {
  const world = makeWorld();
  const impact = throwFrom(world, -1, 1);
  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 2, y: 8 });
});

// ---------------------------------------------------------------------------
// Interception: the headline case
// ---------------------------------------------------------------------------

test('a hostile 2 diagonal steps away intercepts a throw with 3 steps of range', () => {
  // Rylee's case: throw SW, hostile at (dx, dy) = (-2, +2). The bottle must
  // stop on them rather than sailing past to the max-range tile at (-3, +3).
  const world = makeWorld();
  const drone = makeBody('drone-1', 3, 7);
  world.addEntity(drone);

  const impact = throwFrom(world, -1, 1);

  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 3, y: 7 }, 'fire radiates from the drone');
  assert.equal(impact?.intercepted, drone, 'the drone is reported as the thing that stopped it');
});

test('the nearest body on the ray intercepts, not the furthest', () => {
  const world = makeWorld();
  const near = makeBody('near', 6, 5);
  const far = makeBody('far', 8, 5);
  world.addEntity(near);
  world.addEntity(far);

  const impact = throwFrom(world, 1, 0);

  assert.equal(impact?.intercepted, near);
  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 6, y: 5 });
});

test('a friendly crewmate on the ray intercepts the throw — friendly fire is intended', () => {
  const world = makeWorld();
  const ally = makeBody('ally', 6, 5, FACTION.PLAYER);
  world.addEntity(ally);

  const impact = throwFrom(world, 1, 0);

  assert.equal(impact?.intercepted, ally, 'the bottle does not politely fly around your own crew');
});

test('an EscortNpc intercepts — it is a blocker and it burns', () => {
  const world = makeWorld();
  const npc = new EscortNpc({ id: 'vip', x: 6, y: 5, label: 'VIP' });
  world.addEntity(npc);

  const impact = throwFrom(world, 1, 0);

  assert.equal(impact?.intercepted, npc);
});

test('a body beyond max range does not intercept', () => {
  const world = makeWorld();
  world.addEntity(makeBody('far', 5 + INCENDIARY_THROW_DIST + 1, 5));

  const impact = throwFrom(world, 1, 0);

  assert.equal(impact?.intercepted, null, 'out of range is out of range');
  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 5 + INCENDIARY_THROW_DIST, y: 5 });
});

// ---------------------------------------------------------------------------
// Terrain: walls stop it, cover is lobbed over
// ---------------------------------------------------------------------------

test('a wall stops the bottle and it lands on the last clear tile short of it', () => {
  const world = makeWorld();
  world.grid.setTile(7, 5, TILE.WALL);

  const impact = throwFrom(world, 1, 0);

  assert.deepEqual(
    { x: impact?.x, y: impact?.y },
    { x: 6, y: 5 },
    'impact is never the wall tile itself'
  );
  assert.equal(impact?.intercepted, null);
});

test('cover is lobbed over — a hostile behind it still catches the bottle', () => {
  const world = makeWorld();
  world.grid.setTile(6, 5, TILE.COVER);
  const drone = makeBody('drone-1', 7, 5);
  world.addEntity(drone);

  const impact = throwFrom(world, 1, 0);

  assert.equal(impact?.intercepted, drone, 'chest-high cover does not stop a thrown arc');
  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 7, y: 5 });
});

test('cover is passed over but is never itself a landing tile — fire cannot take there', () => {
  const world = makeWorld();
  // Cover sits on the max-range tile with nothing beyond to catch the bottle.
  world.grid.setTile(8, 5, TILE.COVER);

  const impact = throwFrom(world, 1, 0);

  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 7, y: 5 }, 'pulls back to the last floor');
});

test('a wall directly behind cover still stops the throw', () => {
  const world = makeWorld();
  world.grid.setTile(6, 5, TILE.COVER);
  world.grid.setTile(7, 5, TILE.WALL);

  const impact = throwFrom(world, 1, 0);

  // Step 1 (6,5) is cover — flown over, but not a landing tile. So the only
  // clear tile the bottle passed is... none. Nowhere to throw.
  assert.equal(impact, null);
});

// ---------------------------------------------------------------------------
// Blocking props: stop the flight, but never catch the fire
// ---------------------------------------------------------------------------

test('a locked door stops the bottle without catching it', () => {
  const world = makeWorld();
  const door = new Door({ id: 'door-1', doorId: 'd1', x: 7, y: 5, locked: true });
  world.addEntity(door);

  const impact = throwFrom(world, 1, 0);

  assert.equal(impact?.intercepted, null, 'a hazard-immune prop never becomes the impact point');
  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 6, y: 5 }, 'fire pools in the doorway');
});

test('an unlocked door is walk-through — the bottle flies through the opening', () => {
  const world = makeWorld();
  world.addEntity(new Door({ id: 'door-1', doorId: 'd1', x: 6, y: 5, locked: false }));

  const impact = throwFrom(world, 1, 0);

  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 8, y: 5 }, 'open door does not block');
});

test('a Terminal stops the bottle but does not catch it', () => {
  const world = makeWorld();
  world.addEntity(new Terminal({ id: 'term-1', x: 7, y: 5, label: 'Terminal' }));

  const impact = throwFrom(world, 1, 0);

  assert.equal(impact?.intercepted, null);
  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 6, y: 5 });
});

test('a walk-through consumable pickup does not stop the bottle', () => {
  const world = makeWorld();
  world.addEntity(
    new ConsumablePickup({ id: 'pk-1', x: 6, y: 5, consumableId: 'stim', label: 'Stim' })
  );

  const impact = throwFrom(world, 1, 0);

  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 8, y: 5 }, 'litter is not a backstop');
});

test('a dead body does not stop the bottle', () => {
  const world = makeWorld();
  const corpse = makeBody('corpse', 6, 5);
  corpse.alive = false;
  world.addEntity(corpse);

  const impact = throwFrom(world, 1, 0);

  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 8, y: 5 });
});

// ---------------------------------------------------------------------------
// Map edges
// ---------------------------------------------------------------------------

test('a throw toward the map edge lands on the last in-bounds tile', () => {
  const world = makeWorld();
  // From (1,1) throwing W: (0,1) is the last in-bounds tile on the ray.
  const impact = throwFrom(world, -1, 0, { x: 1, y: 1 });

  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 0, y: 1 });
});

test('a throw off the map from the edge tile itself has nowhere to land', () => {
  const world = makeWorld();
  const impact = throwFrom(world, -1, 0, { x: 0, y: 4 });

  assert.equal(impact, null, 'every tile on the ray is out of bounds');
});

// ---------------------------------------------------------------------------
// The refusal case — no clear ground
// ---------------------------------------------------------------------------

test('facing an adjacent wall there is nowhere to throw — returns null, no smash-at-your-feet', () => {
  const world = makeWorld();
  world.grid.setTile(6, 5, TILE.WALL);

  const impact = throwFrom(world, 1, 0);

  assert.equal(impact, null, 'the shell refuses this before spending AP or the charge');
});

test('a body adjacent to the thrower still catches it, wall or no wall behind', () => {
  const world = makeWorld();
  const drone = makeBody('drone-1', 6, 5);
  world.addEntity(drone);
  world.grid.setTile(7, 5, TILE.WALL);

  const impact = throwFrom(world, 1, 0);

  assert.equal(impact?.intercepted, drone, 'point blank is a hit, not a refusal');
});

// ---------------------------------------------------------------------------
// Non-FLOOR passable terrain
// ---------------------------------------------------------------------------

test('rubble now holds thrown fire; exit still never does', () => {
  const world = makeWorld();
  world.grid.setTile(7, 5, TILE.RUBBLE);
  world.grid.setTile(8, 5, TILE.EXIT);

  const impact = throwFrom(world, 1, 0);

  // Widened whitelist (P3.6): rubble can take thrown fire, so a body caught on
  // it actually burns rather than being ringed in flame. The centre lands on
  // the rubble at (7,5). EXIT stays unburnable — burying the extraction tile in
  // fire is never allowed — so the bottle never centres on (8,5), even in range.
  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 7, y: 5 });
});

test('existing fire holds fire — a second throw can re-centre on the burning tile', () => {
  const world = makeWorld();
  world.grid.setTile(8, 5, TILE.HAZARD);

  const impact = throwFrom(world, 1, 0);

  // A burning tile can take fire (it re-lights / refreshes its timer and, more
  // importantly, catches a body standing in it), so the max-range HAZARD at
  // (8,5) is a valid centre rather than being pulled back.
  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 8, y: 5 });
});

test('a body standing in existing fire still intercepts', () => {
  const world = makeWorld();
  world.grid.setTile(7, 5, TILE.HAZARD);
  const drone = makeBody('drone-1', 7, 5);
  world.addEntity(drone);

  const impact = throwFrom(world, 1, 0);

  assert.equal(impact?.intercepted, drone);
});

test('a hostile in an open doorway is caught — the open door does not shield it', () => {
  const world = makeWorld();
  world.addEntity(new Door({ id: 'door-1', doorId: 'd1', x: 7, y: 5, locked: false }));
  const drone = makeBody('drone-1', 7, 4);
  world.addEntity(drone);
  // Share the tile with the passable (walk-through) open door — the only way a
  // real drone comes to stand in a doorway. `entityAt` skips the open door, so
  // `relocateEntity` sees the tile as free.
  world.relocateEntity(drone, 7, 5);

  const impact = throwFrom(world, 1, 0);

  assert.equal(
    impact?.intercepted,
    drone,
    'the open door is flown through; the body co-located with it still catches the bottle'
  );
  assert.deepEqual({ x: impact?.x, y: impact?.y }, { x: 7, y: 5 });
});

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

test('a non-unit or zero aim is a wiring bug, not a recoverable miss', () => {
  const world = makeWorld();
  assert.throws(() => throwFrom(world, 0, 0), /unit vector/i);
  assert.throws(() => throwFrom(world, 2, 0), /unit vector/i);
  assert.throws(() => throwFrom(world, 0.5, 0), /unit vector/i);
});

test('a non-positive throw distance is a wiring bug', () => {
  const world = makeWorld();
  assert.throws(
    () => resolveIncendiaryImpact(world, THROWER, { dx: 1, dy: 0 }, 0),
    /throw distance/i
  );
});
