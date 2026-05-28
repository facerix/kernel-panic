/**
 * M2.7: Deny / destroy objectives.
 *
 * Tests cover DenyTarget construction, combat targetability, objective
 * satisfaction, run placement, extraction gating, and snapshot round-trip.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME, isObjectiveSatisfied } from '../../../src/game/Run.js';
import { DenyTarget } from '../../../src/game/entities/DenyTarget.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { EventBus } from '../../../src/game/events.js';
import { entityLabel } from '../../../src/game/Entity.js';
import { canFireRanged } from '../../../src/game/Combat.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { DENY_TARGET_GLYPH, DENY_TARGET_HP, FACTION, TILE } from '../../../src/game/constants.js';
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

function makeDenyContract(overrides: Partial<Contract> = {}): Contract {
  return {
    seed: 42,
    objective: {
      kind: OBJECTIVES.DENY,
      title: 'Disable shipment',
      briefing: 'Find and disable the marked shipment before extraction.',
      params: { target: 'shipment' },
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'Spinning Fox warehouse',
    context: testContractContext(OBJECTIVES.DENY),
    reward: { credits: 50, repDelta: 5 },
    ...overrides,
  };
}

function denyTargetsIn(run: Run): DenyTarget[] {
  if (!run.world) throw new Error('run must be in combat');
  return [...run.world.entities.values()].filter(
    (entity): entity is DenyTarget => entity instanceof DenyTarget
  );
}

describe('DenyTarget', () => {
  it('constructs as a corp destructible objective prop', () => {
    const target = new DenyTarget({ id: 'deny-target-0', x: 5, y: 5, label: 'Shipment' });
    assert.equal(target.faction, FACTION.CORP);
    assert.equal(target.glyph, DENY_TARGET_GLYPH);
    assert.equal(target.label, 'Shipment');
    assert.equal(target.maxHp, DENY_TARGET_HP);
    assert.equal(target.maxAp, 0);
    assert.equal(target.baseDodgeChance, 0);
  });

  it('can be destroyed', () => {
    const target = new DenyTarget({ id: 'deny-target-0', x: 5, y: 5 });
    target.damage(target.maxHp);
    assert.equal(target.alive, false);
    assert.equal(target.hp, 0);
  });

  it('is targetable by normal player ranged combat', () => {
    const world = makeWorld();
    const player = new Merc({ id: 'crew-merc', x: 3, y: 5 });
    const target = new DenyTarget({ id: 'deny-target-0', x: 5, y: 5 });
    world.addEntity(player);
    world.addEntity(target);

    assert.equal(canFireRanged(world, player, target).ok, true);
  });

  it('has a player-facing entity label', () => {
    const target = new DenyTarget({ id: 'deny-target-0', x: 5, y: 5, label: 'Shipment' });
    assert.equal(entityLabel(target), '[Corp]Asset');
  });
});

describe('deny objective satisfaction', () => {
  it('requires a destroyed deny target', () => {
    const world = makeWorld();
    const target = new DenyTarget({ id: 'deny-target-0', x: 3, y: 3, label: 'Shipment' });
    world.addEntity(target);
    const contract = makeDenyContract();

    assert.equal(isObjectiveSatisfied(contract, world), false);
    target.damage(target.maxHp);
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('respects params.count when multiple targets are required', () => {
    const world = makeWorld();
    const targets = [
      new DenyTarget({ id: 'deny-target-0', x: 3, y: 3, label: 'Shipment 1' }),
      new DenyTarget({ id: 'deny-target-1', x: 4, y: 3, label: 'Shipment 2' }),
      new DenyTarget({ id: 'deny-target-2', x: 5, y: 3, label: 'Shipment 3' }),
    ];
    for (const target of targets) world.addEntity(target);
    const contract = makeDenyContract({
      objective: {
        kind: OBJECTIVES.DENY,
        title: 'Disable shipments',
        briefing: 'Destroy two shipments.',
        params: { target: 'shipment', count: 2 },
      },
    });

    targets[0]!.damage(targets[0]!.maxHp);
    assert.equal(isObjectiveSatisfied(contract, world), false);
    targets[1]!.damage(targets[1]!.maxHp);
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });
});

describe('deny runs', () => {
  it('spawns a deny target and allows abort or completion extraction', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 42,
      onResult: result => results.push(result),
    });
    run.enterBriefing(makeDenyContract());
    run.enterCombat();

    const [target] = denyTargetsIn(run);
    assert.ok(target, 'deny combat map should include a deny target');
    assert.equal(target.glyph, DENY_TARGET_GLYPH);
    assert.equal(target.label, 'Shipment');
    assert.ok(run.exitTile, 'deny run should have an exit tile');
    assert.ok(
      Math.max(Math.abs(target.x - run.exitTile.x), Math.abs(target.y - run.exitTile.y)) > 1,
      'deny target should not spawn adjacent to extraction'
    );
    assert.equal(isObjectiveSatisfied(run.contract!, run.world), false);

    // Reaching exit before objective is an abort extraction.
    run.bus!.emit('entity:moved', {
      entity: run.player,
      from: { x: run.player!.x, y: run.player!.y },
      to: { x: run.exitTile.x, y: run.exitTile.y },
    });
    assert.equal(run.state, RUN_STATE.RESULT, 'abort extraction ends the run');
    const abortResult = results[0] as { outcome: string; telemetry: { objectiveComplete: boolean } };
    assert.equal(abortResult.outcome, OUTCOME.EXIT);
    assert.equal(abortResult.telemetry.objectiveComplete, false, 'abort marks objective incomplete');
  });

  it('extraction after objective completion marks objective complete', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 42,
      onResult: result => results.push(result),
    });
    run.enterBriefing(makeDenyContract());
    run.enterCombat();

    const [target] = denyTargetsIn(run);
    target.damage(target.maxHp);
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

  it('places count-many deny targets', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 43 });
    run.enterBriefing(
      makeDenyContract({
        objective: {
          kind: OBJECTIVES.DENY,
          title: 'Disable shipments',
          briefing: 'Destroy two shipments.',
          params: { target: 'shipment', count: 2 },
        },
      })
    );
    run.enterCombat();

    const targets = denyTargetsIn(run);
    assert.equal(targets.length, 2);
    assert.deepEqual(targets.map(target => target.label).sort(), ['Shipment 1', 'Shipment 2']);
  });

  it('snapshot/restore round-trips dead deny target state', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 44 });
    run.enterBriefing(makeDenyContract());
    run.enterCombat();
    const [target] = denyTargetsIn(run);
    assert.ok(target);

    target.damage(target.maxHp);

    const rec = snapshot(run);
    const targetRec = rec.entities.find(entity => entity.id === target.id);
    assert.equal(targetRec?.archetype, 'deny-target');
    assert.equal(targetRec?.denyTarget?.label, 'Shipment');
    assert.equal(targetRec?.alive, false);
    assert.equal(targetRec?.hp, 0);

    const { world: restoredWorld } = restore(rec);
    const restoredTarget = [...restoredWorld.entities.values()].find(
      (entity): entity is DenyTarget => entity instanceof DenyTarget
    );
    assert.ok(restoredTarget, 'expected restored deny target');
    assert.equal(restoredTarget.label, 'Shipment');
    assert.equal(restoredTarget.alive, false);
    assert.equal(restoredTarget.hp, 0);
  });
});
