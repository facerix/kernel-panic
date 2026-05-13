import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME } from '../../../src/game/Run.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { FACTION } from '../../../src/game/constants.js';
import { Turret } from '../../../src/game/Turret.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { Rng } from '../../../src/rng.js';

const fakeContract = (overrides = {}) => ({
  seed: 12345,
  objective: OBJECTIVES.REACH_EXIT,
  threatCount: 1,
  label: 'test job',
  ...overrides,
});

function makeCrew(archetype = 'razor') {
  return buildCrewMember(archetype, { x: 0, y: 0 }, new Rng(100), {
    id: `crew-${archetype}`,
  });
}

test('Run starts with state=null and a deployed crew member', () => {
  const crewMember = makeCrew('razor');
  const run = new Run({ crewMember, seed: 42 });
  assert.equal(run.state, null);
  assert.equal(run.seed, 42);
  assert.equal(run.rng.seed, 42);
  assert.equal(run.crewMember, crewMember);
  assert.equal(run.archetype, 'razor');
});

test('legal transition chain: BRIEFING → COMBAT → RESULT', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
  run.enterBriefing(fakeContract());
  assert.equal(run.state, RUN_STATE.BRIEFING);
  run.enterCombat();
  assert.equal(run.state, RUN_STATE.COMBAT);
  assert.ok(run.world && run.player && run.exitTile);
  run.enterResult({ outcome: OUTCOME.DEATH });
  assert.equal(run.state, RUN_STATE.RESULT);
});

test('illegal transitions throw — fresh Run rejects combat/result before briefing', () => {
  const run = new Run({ crewMember: makeCrew('merc'), seed: 1 });
  assert.throws(() => run.enterCombat(), /illegal/);
  assert.throws(() => run.enterResult({ outcome: OUTCOME.DEATH }), /illegal/);
});

test('illegal transitions throw — double briefing and result to briefing', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract());
  assert.throws(() => run.enterBriefing(fakeContract()), /illegal/);
  run.enterCombat();
  run.enterResult({ outcome: OUTCOME.DEATH });
  assert.throws(() => run.enterBriefing(fakeContract()), /illegal/);
});

test('enterBriefing rejects malformed contracts', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  assert.throws(() => run.enterBriefing(null));
  assert.throws(() => run.enterBriefing({ ...fakeContract(), seed: -1 }));
  assert.throws(() => run.enterBriefing({ ...fakeContract(), objective: 'nuke-everything' }));
  assert.throws(() => run.enterBriefing({ ...fakeContract(), threatCount: -1 }));
  assert.throws(() => run.enterBriefing({ ...fakeContract(), label: '' }));
});

test('enterResult rejects unknown outcomes', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  assert.throws(() => run.enterResult({ outcome: 'undecided' }));
});

test('turn:ended in COMBAT triggers onPersist with a snapshot record', () => {
  const records = [];
  const run = new Run({
    crewMember: makeCrew('razor'),
    seed: 1,
    onPersist: rec => records.push(rec),
  });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  assert.equal(records.length, 0, 'no persist before any turn ends');
  run.queue.endTurn(run.world);
  assert.equal(records.length, 1, 'one persist after one turn end');
  const rec = records[0];
  assert.equal(rec.type, 'run');
  assert.equal(rec.state, RUN_STATE.COMBAT);
  assert.equal(rec.archetype, 'razor');
  assert.equal(rec.turnNumber, run.queue.turnNumber);
  assert.equal(rec.currentFaction, FACTION.CORP);
});

test('enterResult persists RESULT snapshot before onResult (no stale COMBAT save)', () => {
  const order = [];
  const persists = [];
  const run = new Run({
    crewMember: makeCrew('razor'),
    seed: 1,
    onPersist: rec => {
      order.push('persist');
      persists.push(rec);
    },
    onResult: () => order.push('result'),
  });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  run.enterResult({ outcome: OUTCOME.EXIT });
  assert.deepEqual(order, ['persist', 'result']);
  assert.equal(persists.length, 1);
  assert.equal(persists[0].state, RUN_STATE.RESULT);
  assert.equal(run.state, RUN_STATE.RESULT);
});

test('player-killed entity:damaged transitions to RESULT(DEATH)', () => {
  const results = [];
  const run = new Run({
    crewMember: makeCrew('razor'),
    seed: 1,
    onResult: r => results.push(r),
  });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  run.player.damage(run.player.hp);
  run.bus.emit('entity:damaged', {
    attacker: { id: 'drone-0', faction: FACTION.CORP },
    target: run.player,
    damage: run.player.maxHp,
    killed: true,
    source: 'ranged',
  });
  assert.equal(run.state, RUN_STATE.RESULT);
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, OUTCOME.DEATH);
  assert.equal(results[0].telemetry.archetype, 'razor');
});

test('player kill of a corp entity increments telemetry.kills', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone, 'expected at least one corp drone for threatCount=1');
  run.bus.emit('entity:damaged', {
    attacker: run.player,
    target: drone,
    damage: 99,
    killed: true,
    source: 'melee',
  });
  assert.equal(run.telemetry.kills, 1);
  assert.equal(run.state, RUN_STATE.COMBAT, 'a corp kill must not end the run');
});

test('Tech turret kill increments telemetry.kills when ownerId matches player', () => {
  const run = new Run({ crewMember: makeCrew('tech'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone);
  const turret = new Turret({ id: `${run.player.id}-turret`, x: 1, y: 1, ownerId: run.player.id });
  run.bus.emit('entity:damaged', {
    attacker: turret,
    target: drone,
    damage: 1,
    killed: true,
    source: 'ranged',
  });
  assert.equal(run.telemetry.kills, 1);
  assert.equal(run.state, RUN_STATE.COMBAT);
});

test('reaching the exit tile transitions to RESULT(EXIT)', () => {
  const results = [];
  const run = new Run({
    crewMember: makeCrew('razor'),
    seed: 99,
    onResult: r => results.push(r),
  });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  run.bus.emit('entity:moved', {
    entity: run.player,
    from: { x: run.player.x, y: run.player.y },
    to: { x: run.exitTile.x, y: run.exitTile.y },
  });
  assert.equal(run.state, RUN_STATE.RESULT);
  assert.equal(results[0].outcome, OUTCOME.EXIT);
});

test('Run constructor rejects bad inputs', () => {
  const member = makeCrew('merc');
  member.flatlined = true;
  assert.throws(() => new Run({ crewMember: null, seed: 1 }), /Crew/);
  assert.throws(() => new Run({ crewMember: member, seed: 1 }), /flatlined/);
  assert.throws(() => new Run({ crewMember: makeCrew('merc'), seed: NaN }), /seed/);
  assert.throws(() => new Run({ crewMember: makeCrew('merc'), seed: Infinity }), /seed/);
  assert.throws(
    () => new Run({ crewMember: makeCrew('merc'), seed: 1, onPersist: 'no' }),
    /function/
  );
  assert.throws(() => new Run({ crewMember: makeCrew('merc'), seed: 1, onResult: 42 }), /function/);
});
