/**
 * M2.3 — Environmental hazard tiles.
 *
 * Tests cover: grid passability, LOS transparency, movement cost, hazard
 * damage during player aftermath, snapshot round-trip, and hazard cluster
 * placement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import type { World as WorldType } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import {
  TILE,
  FACTION,
  HAZARD_DAMAGE,
  AP_COST,
  DEFAULT_AP,
  INCENDIARY_IMPACT_DAMAGE,
  INCENDIARY_BURN_TURNS,
  moveStepApCost,
} from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';
import {
  advanceFromPlayerTurn,
  runPlayerAftermathSteps,
  formatPlayerAftermathStepLogLines,
  isPlayerAftermathStepLogVisible,
} from '../../../src/game/combatTurnPipeline.js';
import { placeHazardCluster } from '../../../src/game/Run.js';
import { hasLineOfSight } from '../../../src/game/LineOfSight.js';
import { Pickup } from '../../../src/game/entities/Pickup.js';
import { ConsumablePickup } from '../../../src/game/entities/ConsumablePickup.js';
import { SyncPad } from '../../../src/game/entities/SyncPad.js';
import { KeyCard } from '../../../src/game/entities/KeyCard.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { EscortNpc } from '../../../src/game/entities/EscortNpc.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHazardWorld(width = 8, height = 8) {
  const grid = new Grid(width, height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  const bus = new EventBus();
  return { grid, world: new World(grid, { events: bus }), bus };
}

function makeEntity(id: string, x: number, y: number, faction = FACTION.PLAYER, hp = 3) {
  return new Entity({ id, x, y, faction, glyph: '@', maxHp: hp });
}

/**
 * One full round of the parts that touch hazard: the player's aftermath (where
 * standing damage lands), then the round-boundary effect tick (where fire ages).
 * Mirrors the order `advanceFromPlayerTurn` drives them in, minus the corp turn
 * between — see `advanceFromPlayerTurn` in combatTurnPipeline.test.ts for the
 * full-pipeline ordering.
 */
function advanceRound(world: WorldType) {
  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  world.tickTileEffects();
  return steps;
}

// ---------------------------------------------------------------------------
// Grid: passability and LOS
// ---------------------------------------------------------------------------

test('HAZARD tile is passable', () => {
  const g = new Grid(3, 1);
  g.setTile(1, 0, TILE.HAZARD);
  assert.equal(g.isPassable(1, 0), true, 'HAZARD should be passable');
});

test('HAZARD tile does NOT block line of sight', () => {
  const g = new Grid(5, 1);
  g.setTile(2, 0, TILE.HAZARD);
  assert.equal(g.blocksLineOfSight(2, 0), false, 'HAZARD should not block LOS');
  assert.equal(hasLineOfSight(g, 0, 0, 4, 0), true, 'LOS through HAZARD tile');
});

test('HAZARD tile is enterable, but costs ENTER_HAZARD AP to step onto', () => {
  const { world } = makeHazardWorld(4, 1);
  world.grid.setTile(1, 0, TILE.HAZARD);
  const entity = makeEntity('e', 0, 0);
  world.addEntity(entity);
  const check = world.canMoveEntity(entity, 1, 0);
  assert.equal(check.ok, true, 'fire is passable — you may choose to run through it');
  assert.equal(moveStepApCost(TILE.HAZARD), AP_COST.ENTER_HAZARD, 'entry costs extra');
  assert.ok(AP_COST.ENTER_HAZARD > AP_COST.MOVE, 'crossing fire is slower than open floor');
});

test('an entity cannot step onto HAZARD without the AP to pay for it', () => {
  const { world } = makeHazardWorld(4, 1);
  world.grid.setTile(1, 0, TILE.HAZARD);
  const entity = makeEntity('e', 0, 0);
  world.addEntity(entity);
  entity.ap = AP_COST.ENTER_HAZARD - 1;
  const check = world.canMoveEntity(entity, 1, 0);
  assert.equal(check.ok, false, 'not enough AP to enter the fire');
});

test('leaving a HAZARD tile costs only MOVE — the cost is charged on entry', () => {
  const { world } = makeHazardWorld(4, 1);
  world.grid.setTile(0, 0, TILE.HAZARD);
  const entity = makeEntity('e', 0, 0);
  world.addEntity(entity);
  entity.ap = AP_COST.MOVE;
  const check = world.canMoveEntity(entity, 1, 0);
  assert.equal(check.ok, true, 'stepping out onto FLOOR is a normal move');
});

// Fire has to be slow enough that a crossing entity is still standing in it
// when the aftermath tick fires. With DEFAULT_AP=4 and a 1 AP step, a drone
// would clear a 3-wide cluster in one turn and take zero damage.
test('a full-AP entity cannot cross a 3-wide hazard cluster in one turn', () => {
  const width = 3;
  const crossingCost = width * AP_COST.ENTER_HAZARD;
  assert.ok(
    crossingCost > DEFAULT_AP,
    `crossing ${width} hazard tiles costs ${crossingCost} AP, which must exceed ` +
      `DEFAULT_AP (${DEFAULT_AP}) or fire deals no damage to anything walking through it`
  );
});

// ---------------------------------------------------------------------------
// Hazard damage during player aftermath
// ---------------------------------------------------------------------------

test('entity on HAZARD tile takes damage during player aftermath', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const entity = makeEntity('victim', 3, 3, FACTION.PLAYER, 3);
  world.addEntity(entity);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  const hazardSteps = steps.filter(s => s.type === 'hazard-damage');
  assert.equal(hazardSteps.length, 1);
  assert.equal(hazardSteps[0].type, 'hazard-damage');
  assert.equal(hazardSteps[0].damage, HAZARD_DAMAGE);
  assert.equal(hazardSteps[0].killed, false);
  assert.equal(entity.hp, 3 - HAZARD_DAMAGE);
  assert.equal(entity.alive, true);
});

// The standing tick historically wrote `entity.hp` directly instead of going
// through `Entity.damage()`, which meant a Medic's shield absorbed every
// damage source in the game except fire.
test('hazard standing tick is absorbed by shields, like every other damage source', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const entity = makeEntity('shielded', 3, 3, FACTION.PLAYER, 3);
  entity.shieldHp = HAZARD_DAMAGE;
  world.addEntity(entity);

  [...runPlayerAftermathSteps(world, new Rng(1))];

  assert.equal(entity.shieldHp, 0, 'shield takes the burn');
  assert.equal(entity.hp, 3, 'HP untouched behind the shield');
});

test('entity on FLOOR tile takes no hazard damage', () => {
  const { world } = makeHazardWorld();
  const entity = makeEntity('safe', 2, 2, FACTION.PLAYER, 3);
  world.addEntity(entity);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  const hazardSteps = steps.filter(s => s.type === 'hazard-damage');
  assert.equal(hazardSteps.length, 0);
  assert.equal(entity.hp, 3);
});

test('hazard damage kills entity at 1 HP', () => {
  const { world, grid, bus } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const entity = makeEntity('doomed', 3, 3, FACTION.CORP, 1);
  world.addEntity(entity);

  const damagedPayloads: unknown[] = [];
  bus.on(EVENT.ENTITY_DAMAGED, p => damagedPayloads.push(p));

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  const hazardSteps = steps.filter(s => s.type === 'hazard-damage');
  assert.equal(hazardSteps.length, 1);
  assert.equal(hazardSteps[0].killed, true);
  assert.equal(entity.hp, 0);
  assert.equal(entity.alive, false);

  // ENTITY_DAMAGED event emitted with source: 'hazard'
  assert.equal(damagedPayloads.length, 1);
  const payload = damagedPayloads[0] as Record<string, unknown>;
  assert.equal(payload.source, 'hazard');
  assert.equal(payload.killed, true);
  assert.equal(payload.attacker, null);
});

test('HAZARD_DAMAGE event emitted on hazard tick', () => {
  const { world, grid, bus } = makeHazardWorld();
  grid.setTile(4, 4, TILE.HAZARD);
  const entity = makeEntity('burned', 4, 4, FACTION.PLAYER, 3);
  world.addEntity(entity);

  const hazardPayloads: unknown[] = [];
  bus.on(EVENT.HAZARD_DAMAGE, p => hazardPayloads.push(p));

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  assert.equal(steps.filter(s => s.type === 'hazard-damage').length, 1);
  assert.equal(hazardPayloads.length, 1);
  const payload = hazardPayloads[0] as Record<string, unknown>;
  assert.equal(payload.damage, HAZARD_DAMAGE);
  assert.equal(payload.x, 4);
  assert.equal(payload.y, 4);
});

test('objective Pickup on HAZARD tile is not damaged by hazard tick', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const pickup = new Pickup({ id: 'pickup-0', x: 3, y: 3, label: 'Clinic Records' });
  world.addEntity(pickup);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  assert.equal(steps.filter(s => s.type === 'hazard-damage').length, 0);
  assert.equal(pickup.hp, 1);
  assert.equal(pickup.alive, true);
});

test('ConsumablePickup on HAZARD tile is not damaged by hazard tick', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const pickup = new ConsumablePickup({
    id: 'consumable-pickup-0',
    x: 3,
    y: 3,
    consumableId: 'stim',
    label: 'Stim',
  });
  world.addEntity(pickup);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  assert.equal(steps.filter(s => s.type === 'hazard-damage').length, 0);
  assert.equal(pickup.hp, 1);
  assert.equal(pickup.alive, true);
});

test('SyncPad on HAZARD tile is not damaged by hazard tick', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const pad = new SyncPad({ id: 'sync-pad-0', x: 3, y: 3, label: 'Sampling Bore' });
  world.addEntity(pad);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  assert.equal(steps.filter(s => s.type === 'hazard-damage').length, 0);
  assert.equal(pad.hp, 1);
  assert.equal(pad.alive, true);
});

test('KeyCard on HAZARD tile is not damaged by hazard tick', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const keycard = new KeyCard({
    id: 'keycard-0',
    x: 3,
    y: 3,
    doorId: 'door-0',
    label: 'Annex keycard',
  });
  world.addEntity(keycard);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  assert.equal(steps.filter(s => s.type === 'hazard-damage').length, 0);
  assert.equal(keycard.hp, 1);
  assert.equal(keycard.alive, true);
});

test('Terminal on HAZARD tile is not damaged by hazard tick', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const terminal = new Terminal({ id: 'terminal-0', x: 3, y: 3, label: 'Access terminal' });
  world.addEntity(terminal);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  assert.equal(steps.filter(s => s.type === 'hazard-damage').length, 0);
  assert.equal(terminal.hp, 1);
  assert.equal(terminal.alive, true);
});

test('EscortNpc on HAZARD tile takes hazard damage', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const escort = new EscortNpc({ id: 'escort-npc-0', x: 3, y: 3, label: 'Extractee' });
  world.addEntity(escort);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  assert.equal(steps.filter(s => s.type === 'hazard-damage').length, 1);
  assert.equal(escort.hp, 2 - HAZARD_DAMAGE);
  assert.equal(escort.alive, true);
});

test('dead entities on HAZARD do not take further damage', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const entity = makeEntity('corpse', 3, 3, FACTION.CORP, 1);
  world.addEntity(entity);
  entity.hp = 0;
  entity.alive = false;

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  const hazardSteps = steps.filter(s => s.type === 'hazard-damage');
  assert.equal(hazardSteps.length, 0, 'dead entity should not take hazard damage');
});

test('multiple entities on different HAZARD tiles all take damage', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(1, 1, TILE.HAZARD);
  grid.setTile(5, 5, TILE.HAZARD);
  const a = makeEntity('a', 1, 1, FACTION.PLAYER, 3);
  const b = makeEntity('b', 5, 5, FACTION.CORP, 3);
  world.addEntity(a);
  world.addEntity(b);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  const hazardSteps = steps.filter(s => s.type === 'hazard-damage');
  assert.equal(hazardSteps.length, 2);
  assert.equal(a.hp, 3 - HAZARD_DAMAGE);
  assert.equal(b.hp, 3 - HAZARD_DAMAGE);
});

// ---------------------------------------------------------------------------
// Log formatting
// ---------------------------------------------------------------------------

test('formatPlayerAftermathStepLogLines produces hazard damage line', () => {
  const entity = makeEntity('player-0', 3, 3, FACTION.PLAYER, 3);
  const lines = formatPlayerAftermathStepLogLines({
    type: 'hazard-damage',
    entity,
    damage: 1,
    killed: false,
  });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('hazard damage'));
});

test('formatPlayerAftermathStepLogLines includes DOWN on kill', () => {
  const entity = makeEntity('drone-0', 3, 3, FACTION.CORP, 1);
  const lines = formatPlayerAftermathStepLogLines({
    type: 'hazard-damage',
    entity,
    damage: 1,
    killed: true,
  });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('DOWN'));
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

test('isPlayerAftermathStepLogVisible: hazard damage to player always visible', () => {
  const entity = makeEntity('player-0', 3, 3, FACTION.PLAYER, 3);
  const visible = isPlayerAftermathStepLogVisible(
    { type: 'hazard-damage', entity, damage: 1, killed: false },
    () => false, // tile not visible
    'player-0'
  );
  assert.equal(visible, true, 'player hazard damage always visible');
});

test('isPlayerAftermathStepLogVisible: hazard damage to non-player respects LOS', () => {
  const entity = makeEntity('drone-0', 3, 3, FACTION.CORP, 3);
  const notVisible = isPlayerAftermathStepLogVisible(
    { type: 'hazard-damage', entity, damage: 1, killed: false },
    () => false,
    'player-0'
  );
  assert.equal(notVisible, false);

  const isVisible = isPlayerAftermathStepLogVisible(
    { type: 'hazard-damage', entity, damage: 1, killed: false },
    () => true,
    'player-0'
  );
  assert.equal(isVisible, true);
});

// ---------------------------------------------------------------------------
// Hazard cluster placement
// ---------------------------------------------------------------------------

test('placeHazardCluster places HAZARD tiles around center', () => {
  const { world } = makeHazardWorld(10, 10);
  const center = { x: 5, y: 5 };
  const { placed } = placeHazardCluster(world, center, new Rng(42));

  assert.ok(placed >= 5, `should place at least center + 4 cardinals, got ${placed}`);
  assert.ok(placed <= 9, `should place at most 9 tiles, got ${placed}`);
  assert.equal(world.grid.tileAt(5, 5), TILE.HAZARD, 'center is HAZARD');
  // All cardinal neighbours should be hazard (all are FLOOR in a clean 10x10)
  assert.equal(world.grid.tileAt(4, 5), TILE.HAZARD, 'left');
  assert.equal(world.grid.tileAt(6, 5), TILE.HAZARD, 'right');
  assert.equal(world.grid.tileAt(5, 4), TILE.HAZARD, 'up');
  assert.equal(world.grid.tileAt(5, 6), TILE.HAZARD, 'down');
});

test('placeHazardCluster does not overwrite WALL tiles', () => {
  const { world } = makeHazardWorld(10, 10);
  world.grid.setTile(4, 5, TILE.WALL);
  const center = { x: 5, y: 5 };
  placeHazardCluster(world, center, new Rng(42));

  assert.equal(world.grid.tileAt(4, 5), TILE.WALL, 'wall should be preserved');
  assert.equal(world.grid.tileAt(5, 5), TILE.HAZARD, 'center still placed');
});

// Map generation stamps scenery around a cast that is *already placed*
// (enterCombat spawns hostiles before objective/hazard placement), so a
// generated cluster must never appear under anyone. A thrown incendiary is
// the opposite: landing on someone is the entire point. Same function, two
// callers, deliberately different rules.
test('placeHazardCluster (generated scenery) does not overwrite occupied tiles', () => {
  const { world } = makeHazardWorld(10, 10);
  const entity = makeEntity('e', 6, 5, FACTION.PLAYER, 3);
  world.addEntity(entity);
  const center = { x: 5, y: 5 };
  placeHazardCluster(world, center, new Rng(42));

  assert.equal(world.grid.tileAt(6, 5), TILE.FLOOR, 'occupied tile should stay FLOOR');
  assert.equal(entity.hp, 3, 'generated scenery deals no impact damage');
});

test('placeHazardCluster (thrown) DOES ignite the tile under a hostile', () => {
  const { world } = makeHazardWorld(10, 10);
  const drone = makeEntity('drone-0', 5, 5, FACTION.CORP, 3);
  world.addEntity(drone);

  placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });

  assert.equal(
    world.grid.tileAt(5, 5),
    TILE.HAZARD,
    'a molotov landing on a drone must set that drone on fire, not ring it in flame'
  );
});

test('placeHazardCluster (thrown) still spares hazard-immune props', () => {
  const { world } = makeHazardWorld(10, 10);
  const terminal = new Terminal({ id: 'terminal-0', x: 6, y: 5, label: 'Access terminal' });
  world.addEntity(terminal);

  placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });

  assert.equal(world.grid.tileAt(6, 5), TILE.FLOOR, 'objective prop tile stays FLOOR');
  assert.equal(terminal.alive, true);
});

// ---------------------------------------------------------------------------
// Thrown incendiary: impact damage
// ---------------------------------------------------------------------------

test('thrown incendiary deals impact damage to entities on ignited tiles', () => {
  const { world, bus } = makeHazardWorld(10, 10);
  const drone = makeEntity('drone-0', 5, 5, FACTION.CORP, 3);
  world.addEntity(drone);

  const damaged: Record<string, unknown>[] = [];
  bus.on(EVENT.ENTITY_DAMAGED, p => damaged.push(p as Record<string, unknown>));

  const result = placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });

  assert.equal(drone.hp, 3 - INCENDIARY_IMPACT_DAMAGE);
  assert.equal(result.casualties.length, 1);
  assert.equal(result.casualties[0].entity.id, 'drone-0');
  assert.equal(result.casualties[0].damage, INCENDIARY_IMPACT_DAMAGE);
  assert.equal(result.casualties[0].killed, false);
  assert.equal(damaged.length, 1);
  assert.equal(damaged[0].source, 'incendiary');
});

test('thrown incendiary credits the thrower as attacker', () => {
  const { world, bus } = makeHazardWorld(10, 10);
  const thrower = makeEntity('player-0', 1, 1, FACTION.PLAYER, 3);
  const drone = makeEntity('drone-0', 5, 5, FACTION.CORP, 3);
  world.addEntity(thrower);
  world.addEntity(drone);

  const damaged: Record<string, unknown>[] = [];
  bus.on(EVENT.ENTITY_DAMAGED, p => damaged.push(p as Record<string, unknown>));

  placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true, attacker: thrower });

  assert.equal(damaged.length, 1);
  assert.equal((damaged[0].attacker as Entity).id, 'player-0');
});

test('thrown incendiary impact respects shields (goes through Entity.damage)', () => {
  const { world } = makeHazardWorld(10, 10);
  const drone = makeEntity('drone-0', 5, 5, FACTION.CORP, 3);
  drone.shieldHp = INCENDIARY_IMPACT_DAMAGE;
  world.addEntity(drone);

  placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });

  assert.equal(drone.shieldHp, 0, 'shield absorbs the impact');
  assert.equal(drone.hp, 3, 'HP untouched behind the shield');
});

test('thrown incendiary impact kills and reports the casualty', () => {
  const { world } = makeHazardWorld(10, 10);
  const drone = makeEntity('drone-0', 5, 5, FACTION.CORP, INCENDIARY_IMPACT_DAMAGE);
  world.addEntity(drone);

  const result = placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });

  assert.equal(drone.alive, false);
  assert.equal(result.casualties[0].killed, true);
});

test('thrown incendiary damages each entity at most once', () => {
  const { world } = makeHazardWorld(10, 10);
  const drone = makeEntity('drone-0', 5, 5, FACTION.CORP, 9);
  world.addEntity(drone);

  const result = placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });

  assert.equal(result.casualties.length, 1, 'one casualty record per entity');
  assert.equal(drone.hp, 9 - INCENDIARY_IMPACT_DAMAGE, 'not damaged once per ignited tile');
});

// P3.6 widening: "caught square on" must actually burn on any tile fire can
// take, not just FLOOR. Before this, a body on RUBBLE or in an existing fire
// pool was reported as the impact centre yet took zero impact damage, because
// its own tile refused to light — the "square on … 0 caught" lie.
test('thrown incendiary ignites RUBBLE under a body and deals impact damage', () => {
  const { world } = makeHazardWorld(10, 10);
  world.grid.setTile(5, 5, TILE.RUBBLE);
  const drone = makeEntity('drone-0', 5, 5, FACTION.CORP, 3);
  world.addEntity(drone);

  const result = placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });

  assert.equal(world.grid.tileAt(5, 5), TILE.HAZARD, 'rubble under the body lights');
  assert.equal(drone.hp, 3 - INCENDIARY_IMPACT_DAMAGE, 'caught square on for real, not for nothing');
  assert.equal(result.casualties.length, 1);
});

test('thrown fire on RUBBLE reverts to RUBBLE after burnout, not FLOOR', () => {
  const { world } = makeHazardWorld(10, 10);
  world.grid.setTile(5, 5, TILE.RUBBLE);
  placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });
  assert.equal(world.grid.tileAt(5, 5), TILE.HAZARD, 'ignites the rubble');

  for (let i = 0; i < INCENDIARY_BURN_TURNS; i++) advanceRound(world);

  // The tile-effect registry reads the tile underneath, so widening ignition
  // must not erase terrain: rubble comes back, not FLOOR.
  assert.equal(world.grid.tileAt(5, 5), TILE.RUBBLE, 'terrain underneath preserved');
});

test('thrown incendiary catches a body standing in an existing fire pool', () => {
  const { world } = makeHazardWorld(10, 10);
  world.grid.setTile(5, 5, TILE.HAZARD);
  const drone = makeEntity('drone-0', 5, 5, FACTION.CORP, 3);
  world.addEntity(drone);

  const result = placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });

  assert.equal(drone.hp, 3 - INCENDIARY_IMPACT_DAMAGE, 'a body in a fire pool takes the impact hit');
  assert.equal(result.casualties.length, 1);
});

test('thrown incendiary spares an EXIT tile even under a body — extraction stays unburnable', () => {
  const { world } = makeHazardWorld(10, 10);
  world.grid.setTile(5, 5, TILE.EXIT);
  const drone = makeEntity('drone-0', 5, 5, FACTION.CORP, 3);
  world.addEntity(drone);

  const result = placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });

  // Hard constraint: burning the extraction tile would make it uninteractable.
  // Accepted residual — a body parked exactly on the EXIT takes no impact damage
  // — which is why the shell only claims "square on" when the body is a casualty.
  assert.equal(world.grid.tileAt(5, 5), TILE.EXIT, 'EXIT never burns, body or not');
  assert.equal(drone.hp, 3, 'a body on the EXIT takes no impact damage');
  assert.equal(result.casualties.length, 0);
});

// ---------------------------------------------------------------------------
// Thrown incendiary: burnout
// ---------------------------------------------------------------------------

test('thrown fire reverts to FLOOR after INCENDIARY_BURN_TURNS rounds', () => {
  const { world } = makeHazardWorld(10, 10);
  placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });
  assert.equal(world.grid.tileAt(5, 5), TILE.HAZARD, 'ignites immediately');

  for (let i = 0; i < INCENDIARY_BURN_TURNS - 1; i++) {
    advanceRound(world);
    assert.equal(world.grid.tileAt(5, 5), TILE.HAZARD, `still burning after round ${i + 1}`);
  }

  advanceRound(world);
  assert.equal(world.grid.tileAt(5, 5), TILE.FLOOR, 'fire burns out');
});

test('thrown fire damages on every round it burns, including its last', () => {
  const { world } = makeHazardWorld(10, 10);
  const victim = makeEntity('victim', 5, 5, FACTION.CORP, 99);
  world.addEntity(victim);
  placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });
  const hpAfterImpact = victim.hp;

  let ticks = 0;
  for (let i = 0; i < INCENDIARY_BURN_TURNS + 2; i++) {
    ticks += advanceRound(world).filter(s => s.type === 'hazard-damage').length;
  }

  assert.equal(ticks, INCENDIARY_BURN_TURNS, 'one damage tick per burning round, then nothing');
  assert.equal(victim.hp, hpAfterImpact - INCENDIARY_BURN_TURNS * HAZARD_DAMAGE);
});

// The reason the effect tick hangs off the round boundary rather than player
// aftermath. Fire has to still be on the map during the corp turns it's meant
// to deny — if it aged in aftermath instead, it would wink out one corp turn
// early and the last round of denial the player paid for would never happen.
test('thrown fire is still burning during every corp turn it is meant to deny', () => {
  const { world } = makeHazardWorld(10, 10);
  placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });

  const litDuringCorpTurn: boolean[] = [];
  const queue = { endTurn: () => {} };
  for (let round = 0; round < INCENDIARY_BURN_TURNS + 1; round++) {
    advanceFromPlayerTurn({
      queue,
      world,
      rng: new Rng(1),
      driveCorpTurn: ({ onFinish }) => {
        litDuringCorpTurn.push(world.grid.tileAt(5, 5) === TILE.HAZARD);
        onFinish();
      },
    });
  }

  assert.deepEqual(
    litDuringCorpTurn,
    [true, true, true, false],
    `fire must deny ${INCENDIARY_BURN_TURNS} full corp turns, then be gone`
  );
});

test('generated hazard scenery is permanent — it never burns out', () => {
  const { world } = makeHazardWorld(10, 10);
  placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42));

  for (let i = 0; i < INCENDIARY_BURN_TURNS + 5; i++) {
    advanceRound(world);
  }

  assert.equal(
    world.grid.tileAt(5, 5),
    TILE.HAZARD,
    'a contaminated site stays contaminated for the whole run'
  );
});

test('a second molotov on the same tile refreshes its burn timer', () => {
  const { world } = makeHazardWorld(10, 10);
  placeHazardCluster(world, { x: 5, y: 5 }, new Rng(42), { thrown: true });
  advanceRound(world);

  // Re-ignite the (still burning) centre directly — placeHazardCluster only
  // stamps FLOOR, so an overlapping throw re-registers via applyTileEffect.
  world.applyTileEffect(5, 5, TILE.HAZARD, INCENDIARY_BURN_TURNS);

  for (let i = 0; i < INCENDIARY_BURN_TURNS - 1; i++) {
    advanceRound(world);
  }
  assert.equal(world.grid.tileAt(5, 5), TILE.HAZARD, 'timer restarted from the second throw');

  advanceRound(world);
  assert.equal(world.grid.tileAt(5, 5), TILE.FLOOR);
});

test('a refreshed effect still reverts to the ORIGINAL tile, not the effect tile', () => {
  // Re-applying must not capture HAZARD as the thing to restore — that would
  // make the second molotov's fire permanent.
  const { world } = makeHazardWorld(10, 10);
  world.applyTileEffect(5, 5, TILE.HAZARD, 1);
  world.applyTileEffect(5, 5, TILE.HAZARD, 1);

  advanceRound(world);

  assert.equal(world.grid.tileAt(5, 5), TILE.FLOOR, 'terrain underneath is remembered once');
});

test('burnout does not revert a tile that has since become something else', () => {
  const { world } = makeHazardWorld(10, 10);
  world.applyTileEffect(5, 5, TILE.HAZARD, 1);
  // A breaching charge turns the tile to rubble while the fire is still lit.
  world.grid.setTile(5, 5, TILE.RUBBLE);

  advanceRound(world);

  assert.equal(world.grid.tileAt(5, 5), TILE.RUBBLE, 'burnout must not clobber a newer tile');
});

test('applyTileEffect refuses an effect that matches the tile underneath', () => {
  // Would be invisible and expire into a no-op — a wiring bug, not a play.
  const { world } = makeHazardWorld(10, 10);
  assert.throws(() => world.applyTileEffect(5, 5, TILE.FLOOR, 1), /already the tile underneath/i);
});

test('placeHazardCluster handles edge-of-map center gracefully', () => {
  const { world } = makeHazardWorld(6, 6);
  const center = { x: 0, y: 0 };
  const { placed } = placeHazardCluster(world, center, new Rng(1));
  assert.ok(placed >= 1, 'should place at least the center tile');
  assert.equal(world.grid.tileAt(0, 0), TILE.HAZARD);
});

// ---------------------------------------------------------------------------
// Snapshot round-trip (HAZARD tiles survive as grid tile type 5)
// ---------------------------------------------------------------------------

test('HAZARD tiles survive grid snapshot round-trip', () => {
  const { grid } = makeHazardWorld(4, 4);
  grid.setTile(2, 2, TILE.HAZARD);

  // Simulate snapshot: tiles become a plain number array
  const tilesArray = Array.from(grid.tiles);
  assert.equal(tilesArray[2 * 4 + 2], TILE.HAZARD);

  // Simulate restore: rebuild grid from array
  const restored = new Grid(4, 4);
  for (let i = 0; i < tilesArray.length; i++) {
    restored.tiles[i] = tilesArray[i] & 0xff;
  }
  assert.equal(restored.tileAt(2, 2), TILE.HAZARD);
  assert.equal(restored.isPassable(2, 2), true);
});

// ---------------------------------------------------------------------------
// Palette: HAZARD tile has a defined glyph (import test)
// ---------------------------------------------------------------------------

test('palette defines a glyph for HAZARD tile', async () => {
  const { glyphForTile } = await import('../../../src/render/palette.js');
  const glyph = glyphForTile(TILE.HAZARD);
  assert.equal(glyph.char, '▓');
  assert.ok(glyph.fg, 'HAZARD glyph must have a foreground color');
});
