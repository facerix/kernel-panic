/**
 * M2.12: Escort / extract NPC objectives.
 *
 * Tests cover allied NPC construction, activation, follow timing, extraction
 * gating, hostile targetability, death failure, and snapshot round-trip.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME, isObjectiveSatisfied } from '../../../src/game/Run.js';
import { Entity } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { CorpDrone } from '../../../src/game/ai/CorpDrone.js';
import { EscortNpc } from '../../../src/game/entities/EscortNpc.js';
import { runPlayerAftermathSteps } from '../../../src/game/combatTurnPipeline.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { AP_COST, ESCORT_NPC_GLYPH, FACTION, TILE } from '../../../src/game/constants.js';
import { EventBus } from '../../../src/game/events.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { restore, snapshot } from '../../../src/game/persistence.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';
import type { Contract } from '../../../src/game/hub/Curator.js';

function makeEscortContract(overrides: Partial<Contract> = {}): Contract {
  return {
    seed: 212,
    objective: {
      kind: OBJECTIVES.ESCORT_EXTRACT,
      title: 'Extract clinic witness',
      briefing: 'Find the witness, link them up, and extract together.',
      params: { target: 'clinic-witness', contact: 'clinic witness' },
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'Clinic witness extraction',
    context: testContractContext(OBJECTIVES.ESCORT_EXTRACT),
    reward: { credits: 50, repDelta: 5 },
    ...overrides,
  };
}

function makeCrew(archetype = 'razor') {
  return buildCrewMember(archetype, { x: 0, y: 0 }, new Rng(212), {
    id: `crew-${archetype}`,
  });
}

function makeOpenWorld(width = 8, height = 5): World {
  const grid = new Grid(width, height, TILE.FLOOR);
  grid.setTile(width - 2, height - 2, TILE.EXIT);
  return new World(grid, { events: new EventBus() });
}

function escortIn(run: Run): EscortNpc {
  const escort = [...run.world!.entities.values()].find(
    (entity): entity is EscortNpc => entity instanceof EscortNpc
  );
  assert.ok(escort, 'escort contract should place an escort NPC');
  return escort;
}

function adjacentOpenTile(world: World, center: Entity): { x: number; y: number } {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = center.x + dx;
      const y = center.y + dy;
      if (!world.grid.inBounds(x, y)) continue;
      if (!world.grid.isPassable(x, y)) continue;
      if (world.entityAt(x, y)) continue;
      return { x, y };
    }
  }
  throw new Error('test fixture could not find adjacent open tile');
}

function clearLiveEntityAt(world: World, x: number, y: number, keep: Set<string>): void {
  const occupant = world.entityAt(x, y);
  if (occupant && !keep.has(occupant.id)) {
    world.removeEntity(occupant.id);
  }
}

describe('EscortNpc', () => {
  it('constructs as a player-aligned interactable with an escort glyph', () => {
    const escort = new EscortNpc({ id: 'escort-npc-0', x: 2, y: 2, label: 'Witness' });

    assert.equal(escort.faction, FACTION.PLAYER);
    assert.equal(escort.glyph, ESCORT_NPC_GLYPH);
    assert.equal(escort.activated, false);
    assert.equal(escort.armed, true);
    assert.equal(escort.maxAp, 0);
    assert.equal(escort.maxHp, 2);
  });

  it('activates through adjacency interaction and spends player AP', () => {
    const world = makeOpenWorld();
    const player = new Entity({ id: 'crew-merc', x: 2, y: 2, faction: FACTION.PLAYER, glyph: '@' });
    const escort = new EscortNpc({ id: 'escort-npc-0', x: 3, y: 2, label: 'Witness' });
    world.addEntity(player);
    world.addEntity(escort);

    const result = escort.interact(world, player);

    assert.equal(result.ok, true);
    assert.equal(escort.activated, true);
    assert.equal(escort.armed, false);
    assert.equal(player.ap, player.maxAp - AP_COST.INTERACT);
  });

  it('is ignored by corp hostiles despite player faction', () => {
    const world = makeOpenWorld();
    const player = new Entity({ id: 'crew-merc', x: 4, y: 1, faction: FACTION.PLAYER, glyph: '@' });
    const escort = new EscortNpc({
      id: 'escort-npc-0',
      x: 1,
      y: 4,
      label: 'Witness',
      activated: true,
    });
    const drone = new CorpDrone({ id: 'drone-0', x: 1, y: 1, maxAp: 3 });
    world.addEntity(player);
    world.addEntity(escort);
    world.addEntity(drone);

    assert.equal(drone.isHostileTo(escort), false);
    assert.equal(drone.acquireTarget(world), player);
  });
});

describe('escort aftermath follow', () => {
  it('does not follow before activation', () => {
    const world = makeOpenWorld();
    const player = new Entity({ id: 'crew-merc', x: 5, y: 2, faction: FACTION.PLAYER, glyph: '@' });
    const escort = new EscortNpc({ id: 'escort-npc-0', x: 1, y: 2, label: 'Witness' });
    world.addEntity(player);
    world.addEntity(escort);

    const steps = [...runPlayerAftermathSteps(world, new Rng(1))];

    assert.equal(escort.x, 1);
    assert.equal(escort.y, 2);
    assert.equal(steps.find(step => step.type === 'escort-npc')?.step.type, 'escort-wait');
  });

  it('walks a bounded catch-up sequence toward player adjacency after activation', () => {
    const world = makeOpenWorld();
    const player = new Entity({ id: 'crew-merc', x: 5, y: 2, faction: FACTION.PLAYER, glyph: '@' });
    const escort = new EscortNpc({
      id: 'escort-npc-0',
      x: 1,
      y: 2,
      label: 'Witness',
      activated: true,
    });
    world.addEntity(player);
    world.addEntity(escort);

    const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
    const escortSteps = steps.filter(step => step.type === 'escort-npc');

    assert.equal(escortSteps.length, 3);
    assert.ok(escortSteps.every(step => step.step.type === 'escort-follow'));
    assert.equal(Math.max(Math.abs(escort.x - player.x), Math.abs(escort.y - player.y)), 1);
  });

  it('waits visibly when no legal follow path exists', () => {
    const world = makeOpenWorld();
    const player = new Entity({ id: 'crew-merc', x: 5, y: 2, faction: FACTION.PLAYER, glyph: '@' });
    const escort = new EscortNpc({
      id: 'escort-npc-0',
      x: 1,
      y: 2,
      label: 'Witness',
      activated: true,
    });
    world.addEntity(player);
    world.addEntity(escort);
    world.addEntity(new Entity({ id: 'block-n', x: 1, y: 1, faction: FACTION.CORP, glyph: 'd' }));
    world.addEntity(new Entity({ id: 'block-w', x: 0, y: 2, faction: FACTION.CORP, glyph: 'd' }));
    world.addEntity(new Entity({ id: 'block-e', x: 2, y: 2, faction: FACTION.CORP, glyph: 'd' }));
    world.addEntity(new Entity({ id: 'block-s', x: 1, y: 3, faction: FACTION.CORP, glyph: 'd' }));
    world.addEntity(new Entity({ id: 'block-nw', x: 0, y: 1, faction: FACTION.CORP, glyph: 'd' }));
    world.addEntity(new Entity({ id: 'block-ne', x: 2, y: 1, faction: FACTION.CORP, glyph: 'd' }));
    world.addEntity(new Entity({ id: 'block-sw', x: 0, y: 3, faction: FACTION.CORP, glyph: 'd' }));
    world.addEntity(new Entity({ id: 'block-se', x: 2, y: 3, faction: FACTION.CORP, glyph: 'd' }));

    const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
    const escortStep = steps.find(step => step.type === 'escort-npc');

    assert.deepEqual(escortStep?.step, { type: 'escort-wait', reason: 'blocked' });
    assert.equal(escort.x, 1);
    assert.equal(escort.y, 2);
  });
});

describe('escort objective satisfaction', () => {
  it('requires activated living escort and player near extraction', () => {
    const world = makeOpenWorld();
    const player = new Entity({ id: 'crew-merc', x: 6, y: 3, faction: FACTION.PLAYER, glyph: '@' });
    const escort = new EscortNpc({
      id: 'escort-npc-0',
      x: 5,
      y: 3,
      label: 'Witness',
      activated: true,
    });
    world.addEntity(player);
    world.addEntity(escort);
    const contract = makeEscortContract();

    assert.equal(isObjectiveSatisfied(contract, world), true);
    escort.activated = false;
    assert.equal(isObjectiveSatisfied(contract, world), false);
    escort.activated = true;
    escort.damage(escort.maxHp);
    assert.equal(isObjectiveSatisfied(contract, world), false);
  });
});

describe('escort runs', () => {
  it('golden path: activate, follow, then extract together', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 212,
      onResult: result => results.push(result),
    });
    run.enterBriefing(makeEscortContract());
    run.enterCombat();
    const escort = escortIn(run);

    const activationTile = adjacentOpenTile(run.world!, escort);
    run.world!.relocateEntity(run.player!, activationTile.x, activationTile.y);
    const activate = escort.interact(run.world!, run.player!);
    assert.equal(activate.ok, true);

    run.world!.relocateEntity(run.player!, run.exitTile!.x, run.exitTile!.y);
    const escortX = run.exitTile!.x > 4 ? run.exitTile!.x - 4 : run.exitTile!.x + 4;
    const step = escortX < run.exitTile!.x ? 1 : -1;
    for (let x = escortX; x !== run.exitTile!.x; x += step) {
      run.world!.grid.setTile(x, run.exitTile!.y, TILE.FLOOR);
      clearLiveEntityAt(run.world!, x, run.exitTile!.y, new Set([run.player!.id, escort.id]));
    }
    escort.x = escortX;
    escort.y = run.exitTile!.y;
    for (let i = 0; i < 3; i++) {
      [...runPlayerAftermathSteps(run.world!, new Rng(i + 1))];
    }

    assert.equal(run.isObjectiveSatisfied(), true);
    run.bus!.emit('entity:moved', {
      entity: run.player,
      from: { x: run.player!.x - 1, y: run.player!.y },
      to: { x: run.exitTile!.x, y: run.exitTile!.y },
    });

    assert.equal(run.state, RUN_STATE.RESULT);
    assert.equal((results[0] as { outcome: string }).outcome, OUTCOME.EXIT);
  });

  it('defers abort while an activated escort is still catching up to the exit', () => {
    let abortRequested = false;
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 216,
      onResult: result => results.push(result),
    });
    run.onAbortRequested = () => {
      abortRequested = true;
    };
    run.enterBriefing(makeEscortContract({ seed: 216 }));
    run.enterCombat();
    const escort = escortIn(run);
    escort.activated = true;
    escort.armed = false;

    const exit = run.exitTile!;
    const fromX = exit.x - 2;
    run.world!.relocateEntity(run.player!, fromX, exit.y);
    escort.x = fromX - 1;
    escort.y = exit.y;

    run.world!.relocateEntity(run.player!, exit.x, exit.y);
    run.bus!.emit('entity:moved', {
      entity: run.player,
      from: { x: fromX, y: exit.y },
      to: { x: exit.x, y: exit.y },
    });

    assert.equal(abortRequested, false, 'linked escort still en route must not abort');
    assert.equal(run.state, RUN_STATE.COMBAT, 'run stays live until escort arrives');

    [...runPlayerAftermathSteps(run.world!, new Rng(1))];

    assert.equal(run.isObjectiveSatisfied(), true);
    assert.equal(run.state, RUN_STATE.RESULT);
    assert.equal((results[0] as { outcome: string }).outcome, OUTCOME.EXIT);
  });

  it('abort-extracts when the player reaches exit without the escort', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 213,
      onResult: result => results.push(result),
    });
    run.enterBriefing(makeEscortContract({ seed: 213 }));
    run.enterCombat();

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
      'leaving escort behind is an abort'
    );
  });

  it('extracts when the escort catches up while the player is already on the exit', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 215,
      onResult: result => results.push(result),
    });
    run.enterBriefing(makeEscortContract({ seed: 215 }));
    run.enterCombat();
    const escort = escortIn(run);
    escort.activated = true;
    escort.armed = false;
    run.world!.relocateEntity(run.player!, run.exitTile!.x, run.exitTile!.y);

    const escortX = run.exitTile!.x > 2 ? run.exitTile!.x - 2 : run.exitTile!.x + 2;
    const step = escortX < run.exitTile!.x ? 1 : -1;
    for (let x = escortX; x !== run.exitTile!.x; x += step) {
      run.world!.grid.setTile(x, run.exitTile!.y, TILE.FLOOR);
      clearLiveEntityAt(run.world!, x, run.exitTile!.y, new Set([run.player!.id, escort.id]));
    }
    escort.x = escortX;
    escort.y = run.exitTile!.y;

    [...runPlayerAftermathSteps(run.world!, new Rng(1))];

    assert.equal(run.state, RUN_STATE.RESULT);
    assert.equal((results[0] as { outcome: string }).outcome, OUTCOME.EXIT);
  });

  it('snapshot/restore round-trips escort state', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 214 });
    run.enterBriefing(makeEscortContract({ seed: 214 }));
    run.enterCombat();
    const escort = escortIn(run);
    escort.activated = true;
    escort.armed = false;
    escort.hp = 1;

    const rec = snapshot(run);
    const escortRec = rec.entities.find(entity => entity.archetype === 'escort-npc');
    assert.equal(escortRec?.escortNpc?.activated, true);
    assert.equal(escortRec?.escortNpc?.label, escort.label);

    const { run: restored } = restore(rec);
    const restoredEscort = escortIn(restored);
    assert.equal(restoredEscort.activated, true);
    assert.equal(restoredEscort.armed, false);
    assert.equal(restoredEscort.hp, 1);
  });
});
