/**
 * M2.9: turnLimit objective gating.
 *
 * Tests cover round-budget math, under-budget completion, expiry before
 * objective completion, event/log hook emission, and snapshot round-trip.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  Run,
  RUN_STATE,
  OUTCOME,
  isObjectiveSatisfied,
  objectiveTurnsRemaining,
  type RunResult,
} from '../../../src/game/Run.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { EVENT } from '../../../src/game/events.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';
import type { Contract } from '../../../src/game/hub/Curator.js';

function makeCrew(archetype = 'razor') {
  return buildCrewMember(archetype, { x: 0, y: 0 }, new Rng(100), {
    id: `crew-${archetype}`,
  });
}

function makeTimedTerminalContract(turnLimit = 2, overrides: Partial<Contract> = {}): Contract {
  return {
    seed: 42,
    objective: {
      kind: OBJECTIVES.TERMINAL_SLICE,
      title: 'Slice sentinel terminal',
      briefing: 'Slice the sentinel terminal before maintenance window expires.',
      params: { target: 'sentinel-terminal', count: 1, turnLimit },
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'Sentinel maintenance window',
    context: testContractContext(OBJECTIVES.TERMINAL_SLICE),
    reward: { credits: 50, repDelta: 5 },
    ...overrides,
  };
}

function terminalIn(run: Run): Terminal {
  if (!run.world) throw new Error('run must be in combat');
  const terminal = [...run.world.entities.values()].find(
    (entity): entity is Terminal => entity instanceof Terminal
  );
  if (!terminal) throw new Error('expected a terminal');
  return terminal;
}

function relocateAdjacentTo(run: Run, entity: Terminal): void {
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

function advanceFullRounds(run: Run, count: number): void {
  if (!run.world || !run.queue) throw new Error('run must be in combat');
  for (let i = 0; i < count; i++) {
    run.queue.endTurn(run.world);
    run.queue.endTurn(run.world);
  }
}

describe('turnLimit helpers', () => {
  it('counts remaining turns from the current player-facing turn number', () => {
    const contract = makeTimedTerminalContract(2);

    assert.equal(objectiveTurnsRemaining(contract, 1), 2);
    assert.equal(objectiveTurnsRemaining(contract, 2), 1);
    assert.equal(objectiveTurnsRemaining(contract, 3), 0);
  });

  it('gates pure objective satisfaction when timing says the window is closed', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
    const contract = makeTimedTerminalContract(2);
    run.enterBriefing(contract);
    run.enterCombat();
    const terminal = terminalIn(run);
    terminal.sliced = true;
    terminal.secured = true;

    assert.equal(isObjectiveSatisfied(contract, run.world, { turnNumber: 2 }), true);
    assert.equal(isObjectiveSatisfied(contract, run.world, { turnNumber: 3 }), false);
  });
});

describe('turnLimit runs', () => {
  it('allows completion under budget and keeps it complete after the window passes', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
    run.enterBriefing(makeTimedTerminalContract(2));
    run.enterCombat();
    const terminal = terminalIn(run);

    relocateAdjacentTo(run, terminal);
    assert.equal(terminal.interact(run.world!, run.player!).ok, true);
    assert.equal(run.isObjectiveSatisfied(), true);
    assert.equal(run.objectiveTimer.completedWithinLimit, true);
    assert.equal(run.objectiveTimer.completedTurn, 1);

    advanceFullRounds(run, 2);

    assert.equal(run.queue!.turnNumber, 3);
    assert.equal(run.objectiveTurnsRemaining(), 0);
    assert.equal(run.isObjectiveSatisfied(), true);
  });

  it('expires after the budget and refuses retroactive completion', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 43 });
    const events: unknown[] = [];
    run.enterBriefing(makeTimedTerminalContract(2));
    run.enterCombat();
    run.bus!.on(EVENT.OBJECTIVE_TIMER_EXPIRED, payload => events.push(payload));
    const terminal = terminalIn(run);

    advanceFullRounds(run, 2);

    assert.equal(run.queue!.turnNumber, 3);
    assert.equal(run.objectiveTurnsRemaining(), 0);
    assert.equal(run.isObjectiveSatisfied(), false);
    assert.equal(run.objectiveTimer.expired, true);
    assert.equal(run.objectiveTimer.expiredTurn, 3);
    assert.equal(events.length, 1);

    relocateAdjacentTo(run, terminal);
    run.player!.refreshAp();
    assert.equal(terminal.interact(run.world!, run.player!).ok, true);
    assert.equal(terminal.sliced, true);
    assert.equal(run.isObjectiveSatisfied(), false);
  });

  it('allows extraction after expiry without marking the objective complete', () => {
    const results: RunResult[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 46,
      onResult: (result: RunResult) => results.push(result),
    });
    run.enterBriefing(makeTimedTerminalContract(2));
    run.enterCombat();

    advanceFullRounds(run, 2);

    assert.equal(run.isObjectiveSatisfied(), false);
    assert.equal(run.objectiveTimer.expired, true);
    assert.equal(run.canExtract(), true);
    run.world!.relocateEntity(run.player!, run.exitTile!.x, run.exitTile!.y);

    assert.equal(run.state, RUN_STATE.RESULT);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0], {
      outcome: OUTCOME.EXIT,
      telemetry: {
        ...run.telemetry,
        cause: 'exit-reached-objective-incomplete',
        objectiveComplete: false,
        objectiveExpired: true,
        outcome: OUTCOME.EXIT,
      },
    });
  });

  it('snapshot/restore round-trips completed timed objective state', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 44 });
    run.enterBriefing(makeTimedTerminalContract(2));
    run.enterCombat();
    const terminal = terminalIn(run);
    relocateAdjacentTo(run, terminal);
    terminal.interact(run.world!, run.player!);
    assert.equal(run.isObjectiveSatisfied(), true);
    advanceFullRounds(run, 2);

    const rec = snapshot(run);
    assert.equal(rec.objectiveTimer?.completedWithinLimit, true);
    assert.equal(rec.objectiveTimer?.completedTurn, 1);

    const { run: restored } = restore(rec);
    assert.equal(restored.objectiveTimer.completedWithinLimit, true);
    assert.equal(restored.objectiveTimer.completedTurn, 1);
    assert.equal(restored.isObjectiveSatisfied(), true);
  });

  it('snapshot/restore round-trips expired timed objective state', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 45 });
    run.enterBriefing(makeTimedTerminalContract(2));
    run.enterCombat();
    advanceFullRounds(run, 2);
    assert.equal(run.isObjectiveSatisfied(), false);

    const rec = snapshot(run);
    assert.equal(rec.objectiveTimer?.expired, true);
    assert.equal(rec.objectiveTimer?.expiredTurn, 3);

    const { run: restored } = restore(rec);
    assert.equal(restored.objectiveTimer.expired, true);
    assert.equal(restored.objectiveTimer.expiredTurn, 3);
    assert.equal(restored.isObjectiveSatisfied(), false);
  });
});
