/**
 * M2.11: Recon / exhaustive mapping objectives.
 *
 * Tests cover eligible-cell accounting, objective satisfaction, run extraction
 * gating, and snapshot round-trip for persisted recon map knowledge.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  Run,
  RUN_STATE,
  OUTCOME,
  isObjectiveSatisfied,
  reconEligibleCellKeys,
  reconObjectiveProgress,
} from '../../../src/game/Run.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { EventBus } from '../../../src/game/events.js';
import { VisionField } from '../../../src/game/Vision.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { restore, snapshot } from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { TILE } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';
import type { Contract } from '../../../src/game/hub/Curator.js';

function makeReconContract(overrides: Partial<Contract> = {}): Contract {
  return {
    seed: 211,
    objective: {
      kind: OBJECTIVES.RECON,
      title: 'Map site layout',
      briefing: 'Map the whole floor, then extract.',
      params: { target: 'site-layout' },
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'Northstar site survey',
    context: testContractContext(OBJECTIVES.RECON),
    reward: { credits: 50, repDelta: 5 },
    ...overrides,
  };
}

function makeCrew(archetype = 'razor') {
  return buildCrewMember(archetype, { x: 0, y: 0 }, new Rng(211), {
    id: `crew-${archetype}`,
  });
}

function makeDisconnectedWorld(): World {
  const grid = new Grid(7, 5, TILE.WALL);
  for (const [x, y] of [
    [1, 1],
    [2, 1],
    [3, 1],
    [1, 2],
    [2, 2],
    [3, 2],
    [5, 3],
  ]) {
    grid.setTile(x, y, TILE.FLOOR);
  }
  const world = new World(grid, { events: new EventBus() });
  world.addEntity(new Merc({ id: 'crew-merc', x: 1, y: 1 }));
  return world;
}

describe('recon objective accounting', () => {
  it('counts reachable passable cells and excludes sealed disconnected pockets', () => {
    const world = makeDisconnectedWorld();

    const eligible = reconEligibleCellKeys(world);

    assert.equal(eligible.size, 6);
    assert.equal(eligible.has('5,3'), false, 'sealed disconnected floor should not be required');
  });

  it('requires every eligible cell to be seen', () => {
    const world = makeDisconnectedWorld();
    const eligible = reconEligibleCellKeys(world);
    const partial = new Set([...eligible].slice(0, eligible.size - 1));
    const contract = makeReconContract();

    assert.deepEqual(reconObjectiveProgress(world, partial), {
      mapped: eligible.size - 1,
      required: eligible.size,
    });
    assert.equal(isObjectiveSatisfied(contract, world, undefined, { reconSeen: partial }), false);
    assert.equal(isObjectiveSatisfied(contract, world, undefined, { reconSeen: eligible }), true);
  });

  it('excludes pockets sealed by impassable entities from required recon tiles', () => {
    const grid = new Grid(7, 5, TILE.WALL);
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [3, 1],
      [1, 2],
      [2, 2],
      [3, 2],
      [5, 3],
    ]) {
      grid.setTile(x, y, TILE.FLOOR);
    }
    grid.setTile(4, 2, TILE.FLOOR);
    const world = new World(grid, { events: new EventBus() });
    world.addEntity(new Merc({ id: 'crew-merc', x: 1, y: 1 }));
    world.addEntity(
      new Terminal({
        id: 'terminal-bridge',
        x: 4,
        y: 2,
        label: 'Access terminal',
      })
    );

    const eligible = reconEligibleCellKeys(world);

    assert.equal(eligible.has('5,3'), false);
    assert.equal(eligible.size, 6);
  });
});

describe('recon runs', () => {
  it('allows abort extraction before recon is complete', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 211,
      onResult: result => results.push(result),
    });
    run.enterBriefing(makeReconContract());
    run.enterCombat();

    const startProgress = run.reconProgress();
    assert.ok(startProgress.required > 0);
    assert.ok(startProgress.mapped > 0);
    assert.ok(startProgress.mapped < startProgress.required);
    assert.equal(run.isObjectiveSatisfied(), false);

    // Reaching exit before recon is complete is an abort extraction.
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

  it('extraction after full recon marks objective complete', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 211,
      onResult: result => results.push(result),
    });
    run.enterBriefing(makeReconContract());
    run.enterCombat();

    run.recordReconSeen(reconEligibleCellKeys(run.world!));
    assert.equal(run.isObjectiveSatisfied(), true);

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

  it('snapshot/restore round-trips recon map knowledge', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 212 });
    run.enterBriefing(makeReconContract());
    run.enterCombat();

    const eligible = reconEligibleCellKeys(run.world!);
    const seen = new Set([...eligible].slice(0, 3));
    run.recordReconSeen(seen);
    const before = run.reconProgress();
    const beforeSeen = new Set(run.mapSeenKeys());

    const rec = snapshot(run);
    const { run: restored } = restore(rec);

    assert.deepEqual(restored.reconProgress(), before);
    assert.deepEqual(new Set(restored.mapSeenKeys()), beforeSeen);
    assert.equal(restored.isObjectiveSatisfied(), before.mapped === before.required);

    const vision = new VisionField();
    vision.restoreSeen(restored.mapSeenKeys());
    for (const key of seen) {
      const [x, y] = key.split(',').map(Number);
      assert.equal(vision.hasSeen(x!, y!), true, `restored vision should remember ${key}`);
    }
  });

  it('ignores recon state for non-recon contracts', () => {
    const world = makeDisconnectedWorld();
    const contract = {
      ...makeReconContract(),
      objective: {
        kind: OBJECTIVES.REACH_EXIT,
        title: 'Extract clean',
        briefing: 'Leave.',
      },
      context: testContractContext(OBJECTIVES.REACH_EXIT),
    };

    assert.equal(isObjectiveSatisfied(contract, world, undefined, { reconSeen: new Set() }), true);
  });
});
