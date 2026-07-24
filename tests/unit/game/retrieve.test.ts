/**
 * M2.5: Retrieve pickup objectives.
 *
 * Tests cover Pickup interaction, retrieve objective satisfaction, run
 * placement, extraction gating, hazard-adjacent pickup placement, and snapshot
 * round-trip.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME, isObjectiveSatisfied } from '../../../src/game/Run.js';
import { Pickup } from '../../../src/game/entities/Pickup.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { EventBus } from '../../../src/game/events.js';
import { entityLabel } from '../../../src/game/Entity.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { AP_COST, FACTION, PICKUP_GLYPH, TILE } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';
import type { Contract } from '../../../src/game/hub/Curator.js';

function makeGrid(w = 12, h = 12): Grid {
  const grid = new Grid(w, h, TILE.WALL);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  return grid;
}

function makeWorld(w = 12, h = 12): World {
  return new World(makeGrid(w, h), { events: new EventBus() });
}

function makeCrew(archetype = 'razor') {
  return buildCrewMember(archetype, { x: 0, y: 0 }, new Rng(100), {
    id: `crew-${archetype}`,
  });
}

function makeRetrieveContract(overrides: Partial<Contract> = {}): Contract {
  return {
    seed: 42,
    mapWidth: 24,
    mapHeight: 16,
    objective: {
      kind: OBJECTIVES.RETRIEVE,
      title: 'Secure cache',
      briefing: 'Find the cache, secure it, then extract.',
      params: { target: 'sublevel-cache' },
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'Sublevel 3 cache',
    context: testContractContext(OBJECTIVES.RETRIEVE),
    reward: { credits: 50, repDelta: 5 },
    ...overrides,
  };
}

function relocateAdjacentTo(run: Run, entity: Pickup): void {
  if (!run.world || !run.player) throw new Error('run must be in combat');
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = entity.x + dx;
      const y = entity.y + dy;
      if (!run.world!.grid.inBounds(x, y)) continue;
      if (!run.world!.grid.isPassable(x, y)) continue;
      if (run.world!.liveEntityAt(x, y)) continue;
      run.world!.relocateEntity(run.player, x, y);
      return;
    }
  }
  throw new Error(`No adjacent passable tile for ${entity.id}`);
}

function pickupsIn(run: Run): Pickup[] {
  if (!run.world) throw new Error('run must be in combat');
  return [...run.world!.entities.values()].filter(
    (entity): entity is Pickup => entity instanceof Pickup
  );
}

describe('Pickup', () => {
  it('constructs as a passable neutral interactable with the pickup glyph', () => {
    const pickup = new Pickup({ id: 'pickup-0', x: 5, y: 5, label: 'Sublevel cache' });
    assert.equal(pickup.faction, FACTION.NEUTRAL);
    assert.equal(pickup.glyph, PICKUP_GLYPH);
    assert.equal(pickup.label, 'Sublevel cache');
    assert.equal(pickup.passable, true);
    assert.equal(pickup.secured, false);
    assert.equal(pickup.armed, true);
  });

  it('secureWalkOnto records progress and removes the prop without INTERACT AP', () => {
    const world = makeWorld();
    const pickup = new Pickup({ id: 'pickup-0', x: 5, y: 5, label: 'Dead drop' });
    const player = new Merc({ id: 'crew-merc', x: 4, y: 5 });
    world.addEntity(pickup);
    world.addEntity(player);
    const beforeAp = player.ap;
    world.moveEntity(player, 1, 0);

    world.objectivePickupAt(5, 5)!.secureWalkOnto(world);

    assert.equal(pickup.secured, true);
    assert.equal(world.entities.has(pickup.id), false);
    assert.equal(world.securedPickupCount(), 1);
    assert.equal(player.ap, beforeAp - 1, 'walk-onto secure costs MOVE only, not INTERACT');
  });

  it('secures once, removes itself from the world, and rejects repeat interaction', () => {
    const world = makeWorld();
    const player = new Merc({ id: 'crew-merc', x: 4, y: 5 });
    const pickup = new Pickup({ id: 'pickup-0', x: 5, y: 5, label: 'Dead drop' });
    world.addEntity(player);
    world.addEntity(pickup);

    const beforeAp = player.ap;
    const first = pickup.interact(world, player);
    const second = pickup.interact(world, player);

    assert.equal(first.ok, true);
    assert.equal(pickup.secured, true);
    assert.equal(pickup.armed, false);
    assert.equal(world.entities.has(pickup.id), false);
    assert.equal(player.ap, beforeAp - AP_COST.INTERACT);
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'already-secured');
    assert.equal(player.ap, beforeAp - AP_COST.INTERACT);
  });

  it('has a player-facing entity label', () => {
    const pickup = new Pickup({ id: 'pickup-0', x: 5, y: 5, label: 'Cache' });
    assert.equal(entityLabel(pickup), '[Neutral]Pickup');
  });
});

describe('retrieve objective satisfaction', () => {
  it('requires a secured pickup', () => {
    const world = makeWorld();
    const player = new Merc({ id: 'crew-merc', x: 2, y: 3 });
    const pickup = new Pickup({ id: 'pickup-0', x: 3, y: 3, label: 'Cache' });
    world.addEntity(player);
    world.addEntity(pickup);
    const contract = makeRetrieveContract();

    assert.equal(isObjectiveSatisfied(contract, world), false);
    pickup.interact(world, player);
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('respects params.count when multiple pickups are required', () => {
    const world = makeWorld();
    const player = new Merc({ id: 'crew-merc', x: 2, y: 3 });
    const pickups = [
      new Pickup({ id: 'pickup-0', x: 3, y: 3, label: 'Cache 1' }),
      new Pickup({ id: 'pickup-1', x: 4, y: 3, label: 'Cache 2' }),
      new Pickup({ id: 'pickup-2', x: 5, y: 3, label: 'Cache 3' }),
    ];
    world.addEntity(player);
    for (const pickup of pickups) world.addEntity(pickup);
    const contract = makeRetrieveContract({
      objective: {
        kind: OBJECTIVES.RETRIEVE,
        title: 'Secure caches',
        briefing: 'Find two caches.',
        params: { target: 'sublevel-cache', count: 2 },
      },
    });

    pickups[0]!.interact(world, player);
    assert.equal(isObjectiveSatisfied(contract, world), false);
    world.relocateEntity(player, 3, 3);
    pickups[1]!.interact(world, player);
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });
});

describe('retrieve runs', () => {
  it('spawns a pickup and allows abort or completion extraction', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 42,
      onResult: (result: unknown) => results.push(result),
    });
    run.enterBriefing(makeRetrieveContract());
    run.enterCombat();

    const [pickup] = pickupsIn(run);
    assert.ok(pickup, 'retrieve combat map should include a pickup');
    assert.equal(pickup.glyph, PICKUP_GLYPH);
    assert.ok(run.exitTile, 'retrieve run should have an exit tile');
    assert.ok(
      Math.max(Math.abs(pickup.x - run.exitTile!.x), Math.abs(pickup.y - run.exitTile!.y)) > 1,
      'pickup should not spawn adjacent to extraction'
    );
    assert.equal(isObjectiveSatisfied(run.contract!, run.world), false);

    // Reaching exit before securing pickup is an abort extraction.
    run.bus!.emit('entity:moved', {
      entity: run.player,
      from: { x: run.player!.x, y: run.player!.y },
      to: { x: run.exitTile!.x, y: run.exitTile!.y },
    });
    assert.equal(run.state, RUN_STATE.RESULT, 'abort extraction ends the run');
    const abortResult = results[0] as {
      outcome: string;
      telemetry: { objectiveComplete: boolean };
    };
    assert.equal(abortResult.outcome, OUTCOME.EXIT);
    assert.equal(
      abortResult.telemetry.objectiveComplete,
      false,
      'abort marks objective incomplete'
    );
  });

  it('extraction after securing pickup marks objective complete', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 42,
      onResult: (result: unknown) => results.push(result),
    });
    run.enterBriefing(makeRetrieveContract());
    run.enterCombat();

    const [pickup] = pickupsIn(run);
    assert.ok(pickup);
    relocateAdjacentTo(run, pickup);
    const world = run.world!;
    const player = run.player!;
    world.moveEntity(player, pickup.x - player.x, pickup.y - player.y);
    assert.equal(player.x, pickup.x);
    assert.equal(player.y, pickup.y);
    world.objectivePickupAt(pickup.x, pickup.y)!.secureWalkOnto(world);
    assert.equal(world.entities.has(pickup.id), false);
    assert.equal(isObjectiveSatisfied(run.contract!, run.world), true);

    run.bus!.emit('entity:moved', {
      entity: run.player,
      from: { x: run.player!.x, y: run.player!.y },
      to: { x: run.exitTile!.x, y: run.exitTile!.y },
    });
    assert.equal(run.state, RUN_STATE.RESULT);
    const result = results[0] as { outcome: string; telemetry: { objectiveComplete: boolean } };
    assert.equal(result.outcome, OUTCOME.EXIT);
    assert.equal(result.telemetry.objectiveComplete, true);
  });

  it('places count-many pickups for retrieve contracts', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 43 });
    run.enterBriefing(
      makeRetrieveContract({
        objective: {
          kind: OBJECTIVES.RETRIEVE,
          title: 'Secure caches',
          briefing: 'Find two caches.',
          params: { target: 'sublevel-cache', count: 2 },
        },
      })
    );
    run.enterCombat();

    const pickups = pickupsIn(run);
    assert.equal(pickups.length, 2);
    assert.deepEqual(pickups.map(pickup => pickup.label).sort(), [
      'Sublevel Cache 1',
      'Sublevel Cache 2',
    ]);
  });

  it('co-locates hazard-flavored retrieve pickups with a hazard cluster', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 44 });
    run.enterBriefing(
      makeRetrieveContract({
        label: 'Gassed clinic data dump',
        objective: {
          kind: OBJECTIVES.RETRIEVE,
          title: 'Secure clinic records',
          briefing: 'Recover the records from the gassed clinic.',
          params: { target: 'clinic-records', hazardFlavor: 'suppression-gas' },
        },
      })
    );
    run.enterCombat();

    const [pickup] = pickupsIn(run);
    assert.ok(pickup);
    const adjacentHazards: string[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = pickup.x + dx;
        const y = pickup.y + dy;
        if (run.world!.grid.inBounds(x, y) && run.world!.grid.tileAt(x, y) === TILE.HAZARD) {
          adjacentHazards.push(`${x},${y}`);
        }
      }
    }
    assert.ok(adjacentHazards.length > 0, 'hazard-flavored retrieve should have nearby hazards');
  });

  it('snapshot/restore round-trips secured pickup progress without resurrecting the prop', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 45 });
    run.enterBriefing(makeRetrieveContract());
    run.enterCombat();
    const [pickup] = pickupsIn(run);
    assert.ok(pickup);

    relocateAdjacentTo(run, pickup);
    const world = run.world!;
    const player = run.player!;
    world.moveEntity(player, pickup.x - player.x, pickup.y - player.y);
    world.objectivePickupAt(pickup.x, pickup.y)!.secureWalkOnto(world);

    const rec = snapshot(run);
    const pickupRec = rec.entities.find(entity => entity.id === pickup.id);
    assert.equal(pickupRec, undefined);
    assert.deepEqual(rec.objectiveProgress?.securedPickups, [pickup.id]);

    const { world: restoredWorld } = restore(rec);
    const restoredPickup = [...restoredWorld.entities.values()].find(
      (entity): entity is Pickup => entity instanceof Pickup
    );
    assert.equal(restoredPickup, undefined);
    assert.equal(isObjectiveSatisfied(run.contract!, restoredWorld), true);
  });
});
