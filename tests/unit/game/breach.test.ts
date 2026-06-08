import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Run, isObjectiveSatisfied } from '../../../src/game/Run.js';
import { Door } from '../../../src/game/entities/Door.js';
import { DenyTarget } from '../../../src/game/entities/DenyTarget.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { findPath } from '../../../src/game/Pathfinding.js';
import { resolveMelee, resolveRanged } from '../../../src/game/Combat.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { getShopCatalog, ITEM_ID } from '../../../src/game/items.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { BreachingCharge } from '../../../src/game/entities/BreachingCharge.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { detonateBreachingCharge } from '../../../src/game/breachBlast.js';
import { runPlayerAftermathSteps } from '../../../src/game/combatTurnPipeline.js';
import { EVENT } from '../../../src/game/events.js';
import { EventBus } from '../../../src/game/events.js';
import { BREACH_BLAST_DAMAGE, REP, TILE } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';
import type { Contract } from '../../../src/game/hub/Curator.js';

function corridorWorld(): World {
  const grid = new Grid(7, 3);
  for (let x = 0; x < 7; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, 2, TILE.WALL);
  }
  return new World(grid);
}

function makeOpenWorld(): World {
  const grid = new Grid(8, 8, TILE.WALL);
  for (let y = 1; y < 7; y++) {
    for (let x = 1; x < 7; x++) grid.setTile(x, y, TILE.FLOOR);
  }
  return new World(grid);
}

function makeCrew() {
  return buildCrewMember('merc', { x: 0, y: 0 }, new Rng(100), { id: 'crew-merc' });
}

function demolitionContract(overrides: Partial<Contract> = {}): Contract {
  return {
    seed: 42,
    objective: {
      kind: OBJECTIVES.DENY,
      title: 'Breach floodgate',
      briefing: 'Plant a breaching charge on the floodgate, then extract.',
      params: { target: 'floodgate', method: 'breach', requiresBreach: true },
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'Basement floodgate demolition',
    context: testContractContext(OBJECTIVES.DENY),
    reward: { credits: 50, repDelta: 5 },
    ...overrides,
  };
}

test('World.breachWall converts a wall to rubble and records a tile delta', () => {
  const world = corridorWorld();
  world.breachWall(3, 0);

  assert.equal(world.grid.tileAt(3, 0), TILE.RUBBLE);
  assert.deepEqual(world.mutationDeltas, [
    { kind: 'tile', x: 3, y: 0, from: TILE.WALL, to: TILE.RUBBLE },
  ]);
});

test('World.breachWall throws for non-wall and out-of-bounds targets', () => {
  const world = corridorWorld();

  assert.throws(() => world.breachWall(1, 1), /not a wall/);
  assert.throws(() => world.breachWall(-1, 1), /out of bounds/);
});

test('World.breachDoor removes a locked door and leaves rubble on the tile', () => {
  const world = corridorWorld();
  const door = new Door({ id: 'door-entity-0', doorId: 'door-0', x: 3, y: 1 });
  world.addEntity(door);

  const breached = world.breachDoor('door-0');

  assert.equal(breached, door);
  assert.equal(world.entities.has(door.id), false);
  assert.equal(world.grid.tileAt(3, 1), TILE.RUBBLE);
  assert.deepEqual(world.mutationDeltas, [
    { kind: 'entity-removed', id: door.id, x: 3, y: 1, archetype: 'door' },
    { kind: 'tile', x: 3, y: 1, from: TILE.FLOOR, to: TILE.RUBBLE },
  ]);
});

test('breachWall updates pathfinding on the next fresh path call', () => {
  const grid = new Grid(5, 5);
  for (let y = 0; y < 5; y++) grid.setTile(2, y, TILE.WALL);
  const world = new World(grid);

  assert.equal(findPath(world, { x: 0, y: 2 }, { x: 4, y: 2 }), null);

  world.breachWall(2, 2);
  const path = findPath(world, { x: 0, y: 2 }, { x: 4, y: 2 });

  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 4, y: 2 });
});

test('requiresBreach deny target ignores normal melee and ranged damage', () => {
  const world = makeOpenWorld();
  const player = new Merc({ id: 'crew-merc', x: 3, y: 3 });
  const target = new DenyTarget({
    id: 'deny-target-0',
    x: 4,
    y: 3,
    label: 'Floodgate',
    requiresBreach: true,
  });
  world.addEntity(player);
  world.addEntity(target);

  const melee = resolveMelee(world, player, target, new Rng(1), { dodgeChance: 0 });
  assert.equal(melee.damage, 0);
  assert.equal(target.hp, target.maxHp);
  assert.equal(target.alive, true);

  player.ap = player.maxAp;
  const ranged = resolveRanged(world, player, target, new Rng(1), { baseHit: 1 });
  assert.equal(ranged.damage, 0);
  assert.equal(target.hp, target.maxHp);
  assert.equal(target.alive, true);
});

test('breach-only deny target is destroyed by breach path and satisfies demolition objective', () => {
  const world = makeOpenWorld();
  const target = new DenyTarget({
    id: 'deny-target-0',
    x: 4,
    y: 3,
    label: 'Floodgate',
    requiresBreach: true,
  });
  world.addEntity(target);
  const contract = demolitionContract();

  assert.equal(isObjectiveSatisfied(contract, world), false);
  target.destroyByBreach();
  assert.equal(target.alive, false);
  assert.equal(isObjectiveSatisfied(contract, world), true);
});

test('Run places requiresBreach deny targets for demolition contracts', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 44 });
  run.enterBriefing(demolitionContract());
  run.enterCombat();

  const targets = [...run.world!.entities.values()].filter(
    (entity): entity is DenyTarget => entity instanceof DenyTarget
  );

  assert.equal(targets.length, 1);
  assert.equal(targets[0]!.requiresBreach, true);
});

test('mutation deltas and requiresBreach deny target state round-trip through run snapshots', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 45 });
  run.enterBriefing(demolitionContract());
  run.enterCombat();
  run.world!.breachWall(0, 0);
  const target = [...run.world!.entities.values()].find(
    (entity): entity is DenyTarget => entity instanceof DenyTarget
  );
  assert.ok(target);

  const rec = snapshot(run);
  assert.equal(rec.mutationDeltas?.length, 1);
  assert.equal(rec.entities.find(entity => entity.id === target.id)?.extra?.requiresBreach, true);

  const { world } = restore(rec);
  const restoredTarget = [...world.entities.values()].find(
    (entity): entity is DenyTarget => entity instanceof DenyTarget
  );

  assert.deepEqual(world.mutationDeltas, rec.mutationDeltas);
  assert.equal(restoredTarget?.requiresBreach, true);
});

test('pre-P2.5.M7.1 run snapshots restore with empty mutationDeltas', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 46 });
  run.enterBriefing(demolitionContract());
  run.enterCombat();
  const rec = snapshot(run);
  delete rec.mutationDeltas;

  const { world } = restore(rec);

  assert.deepEqual(world.mutationDeltas, []);
});

test('placeBreachingCharge on free floor tile; rejects wall and occupied cells', () => {
  const world = corridorWorld();
  const charge = world.placeBreachingCharge(3, 1);

  assert.ok(charge instanceof BreachingCharge);
  assert.equal(world.grid.tileAt(3, 0), TILE.WALL);
  assert.equal(world.mutationDeltas.length, 0);

  assert.throws(() => world.placeBreachingCharge(3, 0), /blocked/);
  const door = new Door({ id: 'door-entity-1', doorId: 'door-1', x: 4, y: 1 });
  world.addEntity(door);
  assert.throws(() => world.placeBreachingCharge(4, 1), /occupied/);
});

test('detonateBreachingCharge breaches adjacent wall; distant wall unchanged', () => {
  const world = corridorWorld();
  world.placeBreachingCharge(3, 1);
  detonateBreachingCharge(world, 3, 1);
  assert.equal(world.grid.tileAt(3, 0), TILE.RUBBLE);

  const grid = new Grid(9, 3);
  for (let x = 0; x < 9; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, 2, TILE.WALL);
  }
  const far = new World(grid);
  far.placeBreachingCharge(4, 1);
  detonateBreachingCharge(far, 4, 1);
  assert.equal(far.grid.tileAt(0, 0), TILE.WALL);
});

test('runPlayerAftermathSteps detonates planted charges and removes them', () => {
  const world = corridorWorld();
  world.placeBreachingCharge(3, 1);
  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  assert.equal(steps.length, 1);
  assert.equal(steps[0]!.type, 'breach-detonate');
  assert.equal(world.grid.tileAt(3, 0), TILE.RUBBLE);
  assert.equal([...world.entities.values()].filter(e => e instanceof BreachingCharge).length, 0);
});

test('detonation destroys requiresBreach deny in blast radius only', () => {
  const world = makeOpenWorld();
  const inBlast = new DenyTarget({
    id: 'deny-target-0',
    x: 4,
    y: 3,
    label: 'Floodgate',
    requiresBreach: true,
  });
  const outOfBlast = new DenyTarget({
    id: 'deny-target-1',
    x: 1,
    y: 1,
    label: 'Remote gate',
    requiresBreach: true,
  });
  world.addEntity(inBlast);
  world.addEntity(outOfBlast);
  world.placeBreachingCharge(3, 3);
  detonateBreachingCharge(world, 3, 3);
  assert.equal(inBlast.alive, false);
  assert.equal(outOfBlast.alive, true);
});

test('detonation damages blast-vulnerable entities and emits breach-blast events', () => {
  const world = makeOpenWorld();
  const bus = new EventBus();
  world.events = bus;
  const player = new Merc({ id: 'crew-merc', x: 3, y: 3, maxHp: 5 });
  const drone = new Skirmisher({
    id: 'drone-0',
    x: 4,
    y: 3,
    patrolWaypoints: [{ x: 4, y: 3 }],
  });
  world.addEntity(player);
  world.addEntity(drone);
  world.placeBreachingCharge(3, 4);
  const damaged: unknown[] = [];
  bus.on(EVENT.ENTITY_DAMAGED, payload => damaged.push(payload));

  const { casualties } = detonateBreachingCharge(world, 3, 4, player);

  assert.equal(casualties.length, 2);
  assert.equal(player.hp, 5 - BREACH_BLAST_DAMAGE);
  assert.equal(drone.hp, drone.maxHp - BREACH_BLAST_DAMAGE);
  assert.ok(damaged.some((p: { source?: string }) => p.source === 'breach-blast'));
  assert.ok(
    damaged.every((p: { attacker?: unknown }) => p.attacker === player),
    'breach blast should attribute damage to the planter'
  );
});

test('runPlayerAftermathSteps passes player to breach detonation', () => {
  const world = makeOpenWorld();
  const bus = new EventBus();
  world.events = bus;
  const player = new Merc({ id: 'crew-merc', x: 3, y: 3, maxHp: 5 });
  world.addEntity(player);
  world.placeBreachingCharge(3, 4);
  const damaged: unknown[] = [];
  bus.on(EVENT.ENTITY_DAMAGED, payload => damaged.push(payload));

  [...runPlayerAftermathSteps(world, new Rng(1), { player })];

  assert.ok(
    damaged.some(
      (p: { attacker?: unknown; source?: string }) =>
        p.source === 'breach-blast' && p.attacker === player
    )
  );
});

test('armed breaching charge round-trips through run snapshots', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 47 });
  run.enterBriefing(demolitionContract());
  run.enterCombat();
  const world = run.world!;
  const player = run.player!;
  let planted = false;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ]) {
    const x = player.x + dx;
    const y = player.y + dy;
    if (world.canPlaceBreachingCharge(x, y).ok) {
      world.placeBreachingCharge(x, y);
      planted = true;
      break;
    }
  }
  assert.ok(planted, 'expected an adjacent plant tile on the combat map');
  const rec = snapshot(run);
  assert.ok(rec.entities.some(e => e.archetype === 'breaching-charge'));
  const { world: restoredWorld } = restore(rec);
  const charges = [...restoredWorld.entities.values()].filter(e => e instanceof BreachingCharge);
  assert.equal(charges.length, 1);
});

test('breaching charge appears in Finn catalog at UNKNOWN tier and is aimed', () => {
  const item = getShopCatalog(REP.START).find(entry => entry.id === ITEM_ID.BREACHING_CHARGE);

  assert.ok(item);
  assert.equal(item.needsAim, true);
  assert.equal(item.minRepTier, 'UNKNOWN');
});
