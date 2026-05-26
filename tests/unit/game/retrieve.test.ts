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
      if (!run.world.grid.inBounds(x, y)) continue;
      if (!run.world.grid.isPassable(x, y)) continue;
      if (run.world.liveEntityAt(x, y)) continue;
      run.world.relocateEntity(run.player, x, y);
      return;
    }
  }
  throw new Error(`No adjacent passable tile for ${entity.id}`);
}

function pickupsIn(run: Run): Pickup[] {
  if (!run.world) throw new Error('run must be in combat');
  return [...run.world.entities.values()].filter(
    (entity): entity is Pickup => entity instanceof Pickup
  );
}

describe('Pickup', () => {
  it('constructs as a neutral interactable with the pickup glyph', () => {
    const pickup = new Pickup({ id: 'pickup-0', x: 5, y: 5, label: 'Sublevel cache' });
    assert.equal(pickup.faction, FACTION.NEUTRAL);
    assert.equal(pickup.glyph, PICKUP_GLYPH);
    assert.equal(pickup.label, 'Sublevel cache');
    assert.equal(pickup.secured, false);
    assert.equal(pickup.armed, true);
  });

  it('secures once, spends AP once, and rejects repeat interaction', () => {
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
    const pickup = new Pickup({ id: 'pickup-0', x: 3, y: 3, label: 'Cache' });
    world.addEntity(pickup);
    const contract = makeRetrieveContract();

    assert.equal(isObjectiveSatisfied(contract, world), false);
    pickup.secured = true;
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('respects params.count when multiple pickups are required', () => {
    const world = makeWorld();
    const pickups = [
      new Pickup({ id: 'pickup-0', x: 3, y: 3, label: 'Cache 1' }),
      new Pickup({ id: 'pickup-1', x: 4, y: 3, label: 'Cache 2' }),
      new Pickup({ id: 'pickup-2', x: 5, y: 3, label: 'Cache 3' }),
    ];
    for (const pickup of pickups) world.addEntity(pickup);
    const contract = makeRetrieveContract({
      objective: {
        kind: OBJECTIVES.RETRIEVE,
        title: 'Secure caches',
        briefing: 'Find two caches.',
        params: { target: 'sublevel-cache', count: 2 },
      },
    });

    pickups[0]!.secured = true;
    assert.equal(isObjectiveSatisfied(contract, world), false);
    pickups[1]!.secured = true;
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });
});

describe('retrieve runs', () => {
  it('spawns a pickup and gates extraction until the pickup is secured', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 42,
      onResult: result => results.push(result),
    });
    run.enterBriefing(makeRetrieveContract());
    run.enterCombat();

    const [pickup] = pickupsIn(run);
    assert.ok(pickup, 'retrieve combat map should include a pickup');
    assert.equal(pickup.glyph, PICKUP_GLYPH);
    assert.ok(run.exitTile, 'retrieve run should have an exit tile');
    assert.ok(
      Math.max(Math.abs(pickup.x - run.exitTile.x), Math.abs(pickup.y - run.exitTile.y)) > 1,
      'pickup should not spawn adjacent to extraction'
    );
    assert.equal(isObjectiveSatisfied(run.contract!, run.world), false);

    run.bus!.emit('entity:moved', {
      entity: run.player,
      from: { x: run.player!.x, y: run.player!.y },
      to: { x: run.exitTile.x, y: run.exitTile.y },
    });
    assert.equal(run.state, RUN_STATE.COMBAT, 'extract is blocked before retrieve is secured');
    assert.equal(results.length, 0);

    relocateAdjacentTo(run, pickup);
    const result = pickup.interact(run.world!, run.player!);
    assert.equal(result.ok, true);
    assert.equal(isObjectiveSatisfied(run.contract!, run.world), true);

    run.bus!.emit('entity:moved', {
      entity: run.player,
      from: { x: run.player!.x, y: run.player!.y },
      to: { x: run.exitTile.x, y: run.exitTile.y },
    });
    assert.equal(run.state, RUN_STATE.RESULT);
    assert.equal((results[0] as { outcome: string }).outcome, OUTCOME.EXIT);
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

  it('snapshot/restore round-trips pickup state', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 45 });
    run.enterBriefing(makeRetrieveContract());
    run.enterCombat();
    const [pickup] = pickupsIn(run);
    assert.ok(pickup);

    relocateAdjacentTo(run, pickup);
    pickup.interact(run.world!, run.player!);

    const rec = snapshot(run);
    const pickupRec = rec.entities.find(entity => entity.id === pickup.id);
    assert.equal(pickupRec?.archetype, 'pickup');
    assert.equal(pickupRec?.pickup?.secured, true);
    assert.equal(pickupRec?.pickup?.armed, false);

    const { world: restoredWorld } = restore(rec);
    const restoredPickup = [...restoredWorld.entities.values()].find(
      (entity): entity is Pickup => entity instanceof Pickup
    );
    assert.ok(restoredPickup, 'expected restored pickup');
    assert.equal(restoredPickup.secured, true);
    assert.equal(restoredPickup.armed, false);
  });
});
