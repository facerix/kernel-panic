import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME } from '../../../src/game/Run.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { FACTION } from '../../../src/game/constants.js';

const fakeContract = (overrides = {}) => ({
  seed: 12345,
  objective: OBJECTIVES.REACH_EXIT,
  threatCount: 1,
  label: 'test job',
  ...overrides,
});

test('Run starts with state=null and a freshly seeded rng', () => {
  const run = new Run({ archetype: 'razor', seed: 42 });
  assert.equal(run.state, null);
  assert.equal(run.seed, 42);
  assert.equal(run.rng.seed, 42);
});

test('legal transition chain: HUB → BRIEFING → COMBAT → RESULT → HUB', () => {
  const run = new Run({ archetype: 'razor', seed: 42 });
  run.enterHub();
  assert.equal(run.state, RUN_STATE.HUB);
  assert.ok(run.world && run.player && run.curator);
  run.enterBriefing(fakeContract());
  assert.equal(run.state, RUN_STATE.BRIEFING);
  run.enterCombat();
  assert.equal(run.state, RUN_STATE.COMBAT);
  assert.ok(run.world && run.exitTile);
  run.enterResult({ outcome: OUTCOME.DEATH });
  assert.equal(run.state, RUN_STATE.RESULT);
  run.enterHub();
  assert.equal(run.state, RUN_STATE.HUB);
});

test('illegal transitions throw — fresh Run rejects everything but enterHub', () => {
  const run = new Run({ archetype: 'merc', seed: 1 });
  assert.throws(() => run.enterCombat(), /illegal/);
  assert.throws(() => run.enterBriefing(fakeContract()), /illegal/);
  assert.throws(() => run.enterResult({ outcome: OUTCOME.DEATH }), /illegal/);
});

test('illegal transitions throw — HUB → COMBAT direct (skipping BRIEFING)', () => {
  const run = new Run({ archetype: 'merc', seed: 1 });
  run.enterHub();
  assert.throws(() => run.enterCombat(), /illegal/);
});

test('illegal transitions throw — double enterHub before RESULT', () => {
  const run = new Run({ archetype: 'razor', seed: 1 });
  run.enterHub();
  assert.throws(() => run.enterHub(), /illegal/);
});

test('illegal transitions throw — COMBAT → HUB (must go through RESULT)', () => {
  const run = new Run({ archetype: 'razor', seed: 1 });
  run.enterHub();
  run.enterBriefing(fakeContract());
  run.enterCombat();
  assert.throws(() => run.enterHub(), /illegal/);
});

test('enterBriefing rejects malformed contracts', () => {
  const run = new Run({ archetype: 'razor', seed: 1 });
  run.enterHub();
  assert.throws(() => run.enterBriefing(null));
  assert.throws(() => run.enterBriefing({ ...fakeContract(), seed: -1 }));
  assert.throws(() => run.enterBriefing({ ...fakeContract(), objective: 'nuke-everything' }));
  assert.throws(() => run.enterBriefing({ ...fakeContract(), threatCount: -1 }));
  assert.throws(() => run.enterBriefing({ ...fakeContract(), label: '' }));
});

test('enterResult rejects unknown outcomes', () => {
  const run = new Run({ archetype: 'razor', seed: 1 });
  run.enterHub();
  run.enterBriefing(fakeContract());
  run.enterCombat();
  assert.throws(() => run.enterResult({ outcome: 'undecided' }));
});

test('turn:ended in COMBAT triggers onPersist with a snapshot record', () => {
  const records = [];
  const run = new Run({
    archetype: 'razor',
    seed: 1,
    onPersist: rec => records.push(rec),
  });
  run.enterHub();
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

test('player-killed entity:damaged transitions to RESULT(DEATH)', () => {
  const results = [];
  const run = new Run({
    archetype: 'razor',
    seed: 1,
    onResult: r => results.push(r),
  });
  run.enterHub();
  run.enterBriefing(fakeContract());
  run.enterCombat();
  // Lethal damage to the player should trip the listener and transition
  // to RESULT with DEATH outcome.
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
  const run = new Run({ archetype: 'razor', seed: 1 });
  run.enterHub();
  run.enterBriefing(fakeContract());
  run.enterCombat();
  const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone, 'expected at least one corp drone for threatCount=1');
  // Synthesise a kill event — we don't need to actually resolve combat;
  // Run only listens for the entity:damaged shape.
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

test('reaching the exit tile transitions to RESULT(EXIT)', () => {
  const results = [];
  const run = new Run({
    archetype: 'razor',
    seed: 99,
    onResult: r => results.push(r),
  });
  run.enterHub();
  run.enterBriefing(fakeContract());
  run.enterCombat();
  // Synthesise an entity:moved event placing the player on the exit tile.
  run.bus.emit('entity:moved', {
    entity: run.player,
    from: { x: run.player.x, y: run.player.y },
    to: { x: run.exitTile.x, y: run.exitTile.y },
  });
  assert.equal(run.state, RUN_STATE.RESULT);
  assert.equal(results[0].outcome, OUTCOME.EXIT);
});

test('Run constructor rejects unknown archetype + non-finite seed', () => {
  assert.throws(() => new Run({ archetype: 'wizard', seed: 1 }), /archetype/);
  assert.throws(() => new Run({ archetype: 'merc', seed: NaN }), /seed/);
  assert.throws(() => new Run({ archetype: 'merc', seed: Infinity }), /seed/);
});

test('Run constructor rejects non-function callbacks', () => {
  assert.throws(() => new Run({ archetype: 'merc', seed: 1, onPersist: 'no' }), /function/);
  assert.throws(() => new Run({ archetype: 'merc', seed: 1, onResult: 42 }), /function/);
  assert.throws(() => new Run({ archetype: 'merc', seed: 1, onPrefsChange: 7 }), /function/);
});

// --- M8b: character select / archetype switching ---------------------------

test('setArchetype before enterHub updates the archetype field', () => {
  const run = new Run({ archetype: 'merc', seed: 1 });
  run.setArchetype('razor');
  assert.equal(run.archetype, 'razor');
});

test('setArchetype fires onPrefsChange with the new archetype id', () => {
  const picks = [];
  const run = new Run({
    archetype: 'merc',
    seed: 1,
    onPrefsChange: id => picks.push(id),
  });
  run.setArchetype('razor');
  run.setArchetype('merc');
  // Reaffirming the same archetype still fires — first ever load defaults
  // to 'merc' but no prefs record exists; the callback is what writes one.
  run.setArchetype('merc');
  assert.deepEqual(picks, ['razor', 'merc', 'merc']);
});

test('setArchetype during HUB rebuilds the player entity on the same spawn tile', () => {
  const run = new Run({ archetype: 'merc', seed: 1 });
  run.enterHub();
  const oldPlayer = run.player;
  assert.equal(oldPlayer.constructor.name, 'Merc');
  const spawn = { x: oldPlayer.x, y: oldPlayer.y };

  run.setArchetype('razor');
  assert.equal(run.archetype, 'razor');
  assert.equal(run.player.constructor.name, 'Razor');
  // Same tile, fresh entity instance.
  assert.equal(run.player.x, spawn.x);
  assert.equal(run.player.y, spawn.y);
  assert.notEqual(run.player, oldPlayer, 'player should be a new instance');

  // Exactly one PLAYER-faction entity in the world (no leak of the old one).
  const players = [...run.world.entities.values()].filter(e => e.faction === FACTION.PLAYER);
  assert.equal(players.length, 1);
  assert.equal(players[0], run.player);
});

test('setArchetype updates telemetry.archetype so death-screen shows the new pick', () => {
  const run = new Run({ archetype: 'merc', seed: 1 });
  assert.equal(run.telemetry.archetype, 'merc');
  run.setArchetype('razor');
  assert.equal(run.telemetry.archetype, 'razor');
});

test('setArchetype rejects unknown ids (crash > silent fallback)', () => {
  const run = new Run({ archetype: 'merc', seed: 1 });
  assert.throws(() => run.setArchetype('wizard'), /archetype/i);
  assert.throws(() => run.setArchetype(null), /archetype/i);
});

test('setArchetype is illegal during BRIEFING/COMBAT/RESULT', () => {
  const run = new Run({ archetype: 'merc', seed: 1 });
  run.enterHub();
  run.enterBriefing(fakeContract());
  assert.throws(() => run.setArchetype('razor'), /illegal/i);
  run.enterCombat();
  assert.throws(() => run.setArchetype('razor'), /illegal/i);
  run.enterResult({ outcome: OUTCOME.DEATH });
  assert.throws(() => run.setArchetype('razor'), /illegal/i);
});

test('enterHub places a Terminal entity in the world', () => {
  const run = new Run({ archetype: 'merc', seed: 1 });
  run.enterHub();
  const terminals = [...run.world.entities.values()].filter(e => e.glyph === '‡');
  assert.equal(terminals.length, 1, 'expected exactly one Terminal in the hub world');
});

test('archetype persists across enterHub (last pick wins when returning from RESULT)', () => {
  const run = new Run({ archetype: 'merc', seed: 1 });
  run.enterHub();
  run.setArchetype('razor');
  run.enterBriefing(fakeContract());
  run.enterCombat();
  run.enterResult({ outcome: OUTCOME.DEATH });
  run.enterHub();
  assert.equal(run.archetype, 'razor');
  assert.equal(run.player.constructor.name, 'Razor');
});
