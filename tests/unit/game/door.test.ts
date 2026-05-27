import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { Run, RUN_STATE } from '../../../src/game/Run.js';
import { Door } from '../../../src/game/entities/Door.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { Pickup } from '../../../src/game/entities/Pickup.js';
import { findPath } from '../../../src/game/Pathfinding.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { DOOR_LOCKED_GLYPH, DOOR_OPEN_GLYPH, FACTION, TILE } from '../../../src/game/constants.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';

function corridorWorld() {
  const grid = new Grid(7, 3);
  for (let x = 0; x < 7; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, 2, TILE.WALL);
  }
  return new World(grid);
}

function makePlayer(x = 1, y = 1) {
  return new Entity({ id: 'crew-test', x, y, faction: FACTION.PLAYER, glyph: '@' });
}

function makeCrew() {
  return buildCrewMember('razor', { x: 0, y: 0 }, new Rng(100), { id: 'crew-razor' });
}

function fakeContract(overrides = {}) {
  return {
    seed: 12345,
    objective: {
      kind: OBJECTIVES.REACH_EXIT,
      title: 'Extract clean',
      briefing: 'Reach the exit.',
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'test job',
    context: testContractContext(OBJECTIVES.REACH_EXIT),
    reward: { credits: 0, repDelta: 0 },
    ...overrides,
  };
}

function retrieveDoorContract(seed, overrides = {}) {
  return fakeContract({
    seed,
    objective: {
      kind: OBJECTIVES.RETRIEVE,
      title: 'Secure locked cache',
      briefing: 'Open the checkpoint, secure the cache, then extract.',
      params: { target: 'locked-cache', doorId: 'door-0', ...overrides },
    },
    label: 'locked cache test job',
    context: testContractContext(OBJECTIVES.RETRIEVE),
  });
}

function relocateAdjacentTo(run, entity) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = entity.x + dx;
      const y = entity.y + dy;
      if (!run.world.grid.inBounds(x, y)) continue;
      if (!run.world.grid.isPassable(x, y)) continue;
      if (run.world.entityAt(x, y)) continue;
      run.world.relocateEntity(run.player, x, y);
      return;
    }
  }
  throw new Error(`No adjacent passable tile for ${entity.id}`);
}

test('Door constructs locked by default and unlock flips passability + glyph', () => {
  const door = new Door({ id: 'door-entity-0', doorId: 'door-0', x: 3, y: 1 });

  assert.equal(door.faction, FACTION.NEUTRAL);
  assert.equal(door.label, 'Door');
  assert.equal(door.locked, true);
  assert.equal(door.passable, false);
  assert.equal(door.glyph, DOOR_LOCKED_GLYPH);

  door.unlock();

  assert.equal(door.locked, false);
  assert.equal(door.passable, true);
  assert.equal(door.glyph, DOOR_OPEN_GLYPH);
});

test('locked door interact gives feedback without spending AP', () => {
  const world = corridorWorld();
  const player = makePlayer(1, 1);
  const door = new Door({ id: 'door-entity-0', doorId: 'door-0', x: 2, y: 1 });
  world.addEntity(player);
  world.addEntity(door);

  const beforeAp = player.ap;
  const result = door.interact(world, player);

  assert.equal(result.ok, false);
  assert.match(result.message, /locked/i);
  assert.equal(player.ap, beforeAp);
});

test('adjacent locked door appears in world.adjacentInteractables', () => {
  const world = corridorWorld();
  const player = makePlayer(1, 1);
  const door = new Door({ id: 'door-entity-0', doorId: 'door-0', x: 2, y: 1 });
  world.addEntity(player);
  world.addEntity(door);

  const interactables = world.adjacentInteractables(player);
  assert.equal(interactables.length, 1);
  assert.equal(interactables[0], door);
});

test('closed door blocks pathfinding and unlocked door allows the next fresh path call', () => {
  const world = corridorWorld();
  const door = new Door({ id: 'door-entity-0', doorId: 'door-0', x: 3, y: 1 });
  world.addEntity(door);

  assert.equal(findPath(world, { x: 1, y: 1 }, { x: 5, y: 1 }), null);

  door.unlock();
  const path = findPath(world, { x: 1, y: 1 }, { x: 5, y: 1 });

  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 5, y: 1 });
});

test('World.unlockDoor unlocks by stable doorId and throws on missing/duplicate ids', () => {
  const world = corridorWorld();
  const door = new Door({ id: 'door-entity-0', doorId: 'door-0', x: 3, y: 1 });
  world.addEntity(door);

  assert.equal(world.unlockDoor('door-0'), door);
  assert.equal(door.locked, false);
  assert.throws(() => world.unlockDoor('missing-door'), /no door/);

  const duplicate = new Door({ id: 'door-entity-1', doorId: 'door-0', x: 4, y: 1 });
  world.addEntity(duplicate);
  assert.throws(() => world.unlockDoor('door-0'), /duplicate doorId/);
});

test('terminal slice unlocks its linked door before completing the interaction', () => {
  const world = corridorWorld();
  const player = makePlayer(1, 1);
  const terminal = new Terminal({
    id: 'terminal-0',
    x: 2,
    y: 1,
    label: 'Access terminal',
    raisesAlarm: false,
    unlocksId: 'door-0',
  });
  const door = new Door({ id: 'door-entity-0', doorId: 'door-0', x: 3, y: 1 });
  world.addEntity(player);
  world.addEntity(terminal);
  world.addEntity(door);

  const result = terminal.interact(world, player);

  assert.equal(result.ok, true);
  assert.equal(terminal.sliced, true);
  assert.equal(door.locked, false);
  assert.equal(door.passable, true);
});

test('World.unlockDoor emits door:unlocked when terminal slice unlocks a linked door', async () => {
  const { EventBus, EVENT } = await import('../../../src/game/events.js');
  const bus = new EventBus();
  const world = new World(corridorWorld().grid, { events: bus });
  const player = makePlayer(1, 1);
  const terminal = new Terminal({
    id: 'terminal-0',
    x: 2,
    y: 1,
    label: 'Access terminal',
    raisesAlarm: false,
    unlocksId: 'door-0',
  });
  const door = new Door({
    id: 'door-entity-0',
    doorId: 'door-0',
    label: 'Checkpoint door',
    x: 3,
    y: 1,
  });
  world.addEntity(player);
  world.addEntity(terminal);
  world.addEntity(door);
  const unlocked = [];
  bus.on(EVENT.DOOR_UNLOCKED, payload => unlocked.push(payload));

  const result = terminal.interact(world, player);

  assert.equal(result.ok, true);
  assert.equal(unlocked.length, 1);
  assert.equal(unlocked[0].label, 'Checkpoint door');
  assert.equal(unlocked[0].doorId, 'door-0');
});

test('snapshot/restore round-trips locked and unlocked door state', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  assert.equal(run.state, RUN_STATE.COMBAT);

  const anchors = [];
  for (let y = 1; y < run.world.grid.height - 1 && anchors.length < 2; y++) {
    for (let x = 1; x < run.world.grid.width - 1 && anchors.length < 2; x++) {
      if (!run.world.grid.isPassable(x, y)) continue;
      if (run.world.liveEntityAt(x, y)) continue;
      anchors.push({ x, y });
    }
  }
  assert.equal(anchors.length, 2);
  run.world.addEntity(new Door({ id: 'door-entity-0', doorId: 'door-0', ...anchors[0] }));
  run.world.addEntity(
    new Door({ id: 'door-entity-1', doorId: 'door-1', locked: false, ...anchors[1] })
  );

  const rec = snapshot(run);
  const { world } = restore(rec);
  const locked = [...world.entities.values()].find(entity => entity.id === 'door-entity-0');
  const open = [...world.entities.values()].find(entity => entity.id === 'door-entity-1');

  assert.ok(locked instanceof Door);
  assert.ok(open instanceof Door);
  assert.equal(locked.locked, true);
  assert.equal(locked.passable, false);
  assert.equal(locked.glyph, DOOR_LOCKED_GLYPH);
  assert.equal(open.locked, false);
  assert.equal(open.passable, true);
  assert.equal(open.glyph, DOOR_OPEN_GLYPH);
});

test('restore rejects door snapshots whose glyph disagrees with locked state', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();

  let anchor = null;
  for (let y = 1; y < run.world.grid.height - 1 && !anchor; y++) {
    for (let x = 1; x < run.world.grid.width - 1 && !anchor; x++) {
      if (!run.world.grid.isPassable(x, y)) continue;
      if (run.world.liveEntityAt(x, y)) continue;
      anchor = { x, y };
    }
  }
  assert.ok(anchor);
  run.world.addEntity(new Door({ id: 'door-entity-0', doorId: 'door-0', ...anchor }));
  const rec = snapshot(run);
  const doorRec = rec.entities.find(entity => entity.archetype === 'door');
  assert.ok(doorRec);
  doorRec.glyph = DOOR_OPEN_GLYPH;

  assert.throws(() => restore(rec), /glyph/);
});

test('door-linked retrieve run places objective behind the door and unlock terminal on the access side', () => {
  let run = null;
  for (let seed = 1; seed < 80 && !run; seed++) {
    const candidate = new Run({ crewMember: makeCrew(), seed });
    candidate.enterBriefing(retrieveDoorContract(seed, { unlockMethod: 'terminal' }));
    try {
      candidate.enterCombat();
      run = candidate;
    } catch (error) {
      if (!String(error).includes('door-linked contract')) throw error;
    }
  }
  assert.ok(run, 'expected at least one deterministic seed to produce a door-linked layout');

  const door = [...run.world.entities.values()].find(entity => entity instanceof Door);
  const terminal = [...run.world.entities.values()].find(entity => entity instanceof Terminal);
  const pickup = [...run.world.entities.values()].find(entity => entity instanceof Pickup);
  assert.ok(door instanceof Door);
  assert.ok(terminal instanceof Terminal);
  assert.ok(pickup instanceof Pickup);
  assert.equal(door.doorId, 'door-0');
  assert.equal(terminal.unlocksId, 'door-0');
  assert.equal(door.locked, true);
  assert.equal(
    findPath(run.world, { x: run.player.x, y: run.player.y }, { x: pickup.x, y: pickup.y }),
    null,
    'pickup starts unreachable while the door is locked'
  );

  relocateAdjacentTo(run, terminal);
  const result = terminal.interact(run.world, run.player);

  assert.equal(result.ok, true);
  assert.equal(door.locked, false);
  assert.ok(
    findPath(run.world, { x: run.player.x, y: run.player.y }, { x: pickup.x, y: pickup.y }),
    'pickup becomes reachable once the door unlocks'
  );
});
