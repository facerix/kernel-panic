import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Run,
  RUN_STATE,
  OUTCOME,
  isObjectiveSatisfied,
  type CrewArchetypeId,
  type RunResult,
  type RunSnapshot,
} from '../../../src/game/Run.js';
import { OBJECTIVES, type Contract } from '../../../src/game/hub/Curator.js';
import { FACTION, SALVAGE_DROP_MIN, SALVAGE_DROP_MAX } from '../../../src/game/constants.js';
import { totalSalvage, emptySalvage } from '../../../src/game/salvage.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { EVENT } from '../../../src/game/events.js';
import { Turret } from '../../../src/game/Turret.js';
import { resolveMelee } from '../../../src/game/Combat.js';
import { CorpTurret } from '../../../src/game/entities/CorpTurret.js';
import { CorpCivilian } from '../../../src/game/entities/CorpCivilian.js';
import { NeutralCivilian } from '../../../src/game/entities/NeutralCivilian.js';
import { ConsumablePickup } from '../../../src/game/entities/ConsumablePickup.js';
import { restore, snapshot } from '../../../src/game/persistence.js';
import { Bruiser } from '../../../src/game/ai/Bruiser.js';
import { Juggernaut } from '../../../src/game/ai/Juggernaut.js';
import { Flanker } from '../../../src/game/ai/Flanker.js';
import { Sniper } from '../../../src/game/ai/Sniper.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { findPath } from '../../../src/game/Pathfinding.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';
import { ITEM_ID } from '../../../src/game/items.js';
import { Berserk } from '../../../src/game/archetypes/Berserk.js';
import { Adept } from '../../../src/game/archetypes/Adept.js';
import { Chimera } from '../../../src/game/archetypes/Chimera.js';
import { Lookout } from '../../../src/game/ai/Lookout.js';
import { Entity } from '../../../src/game/Entity.js';

const fakeContract = (overrides: Partial<Contract> = {}): Contract =>
  ({
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
  }) as Contract;

const terminalSliceContract = (overrides: Partial<Contract> = {}) =>
  fakeContract({
    objective: {
      kind: OBJECTIVES.TERMINAL_SLICE,
      title: 'Slice server rack',
      briefing: 'Reach the server terminal, complete the slice, then extract.',
      params: { target: 'server-rack', count: 1 },
    },
    label: 'terminal test job',
    context: testContractContext(OBJECTIVES.TERMINAL_SLICE),
    ...overrides,
  });

function makeCrew(archetype: CrewArchetypeId = 'razor') {
  return buildCrewMember(archetype, { x: 0, y: 0 }, new Rng(100), {
    id: `crew-${archetype}`,
  });
}

function relocateAdjacentTo(run: Run, entity: Entity) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = entity.x + dx;
      const y = entity.y + dy;
      if (!run.world!.grid.inBounds(x, y)) continue;
      if (!run.world!.grid.isPassable(x, y)) continue;
      if (run.world!.liveEntityAt(x, y)) continue;
      run.world!.relocateEntity(run.player!, x, y);
      return;
    }
  }
  throw new Error(`No adjacent passable tile for ${entity.id}`);
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

test('Run classifies a Berserk and seeds matching telemetry', () => {
  const crewMember = makeCrew('berserk');
  const run = new Run({ crewMember, seed: 43 });
  assert.ok(crewMember instanceof Berserk);
  assert.equal(run.archetype, 'berserk');
  assert.equal(run.telemetry.archetype, 'berserk');
});

test('Run classifies an Adept and seeds matching telemetry', () => {
  const crewMember = makeCrew('adept');
  const run = new Run({ crewMember, seed: 44 });
  assert.ok(crewMember instanceof Adept);
  assert.equal(run.archetype, 'adept');
  assert.equal(run.telemetry.archetype, 'adept');
});

test('Run classifies a Chimera and seeds matching telemetry', () => {
  const crewMember = makeCrew('chimera');
  const run = new Run({ crewMember, seed: 45 });
  assert.ok(crewMember instanceof Chimera);
  assert.equal(run.archetype, 'chimera');
  assert.equal(run.telemetry.archetype, 'chimera');
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

test('enterCombat starts the first player turn with an equipped phase shield charged', () => {
  const crewMember = makeCrew('razor');
  crewMember.applyGear(ITEM_ID.PHASE_SHIELD);
  const run = new Run({ crewMember, seed: 42 });
  run.enterBriefing(fakeContract());

  run.enterCombat();

  assert.equal(run.player!.shieldHp, 1);
});

test('enterCombat uses persisted contract map dimensions', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
  run.enterBriefing(fakeContract({ mapWidth: 28, mapHeight: 18, threatCount: 2 }));

  run.enterCombat();

  assert.equal(run.world!.grid.width, 28);
  assert.equal(run.world!.grid.height, 18);
});

test('legacy contracts without map dimensions default to 24x16', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
  run.enterBriefing(fakeContract({ threatCount: 2 }));

  run.enterCombat();

  assert.equal(run.world!.grid.width, 24);
  assert.equal(run.world!.grid.height, 16);
});

test('partial contract map dimensions fail loud', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });

  assert.throws(() => run.enterBriefing(fakeContract({ mapWidth: 28 })), /mapWidth and mapHeight/);
});

test('enterCombat passes contract threat and difficulty into map generation', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
  run.enterBriefing(
    fakeContract({
      difficulty: 'critical',
      threatCount: 4,
      reward: { credits: 80, repDelta: 10, recruit: true },
    })
  );
  run.enterCombat();
  // Phase 2.7 M2: threatCount sizes the *fodder* count, and the seed-driven
  // composition fills each anchor with a skirmisher (`drone-`) or a guard
  // (`guard-`). Count both so the assertion tracks the threat budget rather
  // than a single class.
  const fodder = [...run.world!.entities.values()].filter(
    entity => entity.id.startsWith('drone-') || entity.id.startsWith('guard-')
  );
  assert.equal(fodder.length, 4);
  const elites = [...run.world!.entities.values()].filter(
    entity => entity instanceof Bruiser || entity instanceof Juggernaut || entity instanceof Flanker
  );
  assert.equal(elites.length, 1, 'CRITICAL contracts spawn one T3 elite anchor');
});

test('STANDARD encounter fills fodder anchors with a deterministic skirmisher/guard mix', () => {
  // seed 42 / STANDARD / fodderCount 3 → composeEncounter rolls [guard, guard,
  // skirmisher], mapped 1:1 onto the three drone anchors. Deterministic on the
  // contract seed, independent of mapgen.
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 42, difficulty: 'standard', threatCount: 3 }));
  run.enterCombat();
  const ids = [...run.world!.entities.values()].map(e => e.id);
  assert.equal(ids.filter(id => id.startsWith('guard-')).length, 2);
  assert.equal(ids.filter(id => id.startsWith('drone-')).length, 1);
  assert.equal(ids.filter(id => id.startsWith('lookout-')).length, 0, 'STANDARD has no specialist');
});

test('ELEVATED encounter spawns fodder plus exactly one specialist', () => {
  // Phase 2.7 M3: ELEVATED (T2) rolls one specialist from the buildable pool
  // ([sniper, lookout] in canonical order). Seed 7 → sniper on this roster.
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 7, difficulty: 'elevated', threatCount: 3 }));
  run.enterCombat();
  const specialists = [...run.world!.entities.values()].filter(
    e => e.id.startsWith('lookout-') || e.id.startsWith('sniper-')
  );
  assert.equal(specialists.length, 1, 'exactly one T2 specialist');
  assert.equal(specialists[0].constructor.name, 'Sniper');
  const fodder = [...run.world!.entities.values()].filter(
    e => e.id.startsWith('drone-') || e.id.startsWith('guard-')
  );
  assert.equal(fodder.length, 3, 'fodder count still tracks threatCount');
});

test('a spawned Lookout round-trips through a run snapshot', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 3, difficulty: 'elevated', threatCount: 3 }));
  run.enterCombat();
  const before = [...run.world!.entities.values()].find(
    (e): e is Lookout => e.id.startsWith('lookout-') && e instanceof Lookout
  );
  assert.ok(before, 'lookout present pre-snapshot');
  before.state = 'investigate';
  before.lastKnownTarget = { x: before.x, y: before.y };

  const rec = snapshot(run);
  assert.ok(
    rec.entities.some(entity => entity.archetype === 'lookout'),
    'lookout serialised under its own archetype'
  );
  const { world } = restore(rec);
  const after = [...world.entities.values()].find(
    (e): e is Lookout => e.id.startsWith('lookout-') && e instanceof Lookout
  );
  assert.ok(after, 'lookout survives the round-trip');
  assert.equal(after.constructor.name, 'Lookout');
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
  assert.equal(after.state, 'investigate');
  assert.deepEqual(after.lastKnownTarget, before.lastKnownTarget);
});

test('a spawned Sniper round-trips aimTargetId through a run snapshot', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 7, difficulty: 'elevated', threatCount: 3 }));
  run.enterCombat();
  const before = [...run.world!.entities.values()].find(e => e.id.startsWith('sniper-'));
  assert.ok(before instanceof Sniper, 'sniper present pre-snapshot');
  before.aimTargetId = run.player!.id;

  const rec = snapshot(run);
  assert.ok(
    rec.entities.some(entity => entity.archetype === 'sniper' && entity.extra?.aimTargetId),
    'sniper serialised with pending aim'
  );
  const { world } = restore(rec);
  const after = [...world.entities.values()].find(e => e.id.startsWith('sniper-'));
  assert.ok(after instanceof Sniper, 'sniper survives the round-trip');
  assert.equal(after.aimTargetId, run.player!.id);
});

test('a spawned Bruiser round-trips through a run snapshot', () => {
  // contract seed 0 / CRITICAL / fodder 4 deterministically rolls a Bruiser
  // after M4.3 widened the elite pool to include Flanker.
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 0, difficulty: 'critical', threatCount: 4 }));
  run.enterCombat();
  const before = [...run.world!.entities.values()].find(e => e instanceof Bruiser);
  assert.ok(before instanceof Bruiser, 'bruiser present pre-snapshot');
  before.state = 'investigate';
  before.lastKnownTarget = { x: before.x, y: before.y };

  const rec = snapshot(run);
  const bruiserRec = rec.entities.find(e => e.id === before.id);
  assert.equal(bruiserRec?.archetype, 'bruiser');
  assert.ok(bruiserRec?.extra, 'state machine lives in the slim extra bag (M6.2)');
  assert.equal(bruiserRec?.extra?.state, 'investigate');

  const { world } = restore(rec);
  const after = [...world.entities.values()].find(e => e.id === before.id);
  assert.ok(after instanceof Bruiser, 'bruiser survives the round-trip');
  assert.equal(after.glyph, 'b');
  assert.equal(after.state, 'investigate');
  assert.deepEqual(after.lastKnownTarget, before.lastKnownTarget);
});

test('a spawned Juggernaut round-trips through a run snapshot', () => {
  // contract seed 1 / CRITICAL / fodder 4 deterministically rolls a Juggernaut.
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 1, difficulty: 'critical', threatCount: 4 }));
  run.enterCombat();
  const before = [...run.world!.entities.values()].find(e => e instanceof Juggernaut);
  assert.ok(before instanceof Juggernaut, 'juggernaut present pre-snapshot');
  before.state = 'investigate';
  before.lastKnownTarget = { x: before.x, y: before.y };

  const rec = snapshot(run);
  const jugRec = rec.entities.find(e => e.id === before.id);
  assert.equal(jugRec?.archetype, 'juggernaut');
  assert.ok(jugRec?.extra, 'state machine lives in the slim extra bag (M6.2)');
  assert.equal(jugRec?.extra?.state, 'investigate');

  const { world } = restore(rec);
  const after = [...world.entities.values()].find(e => e.id === before.id);
  assert.ok(after instanceof Juggernaut, 'juggernaut survives the round-trip');
  assert.equal(after.glyph, 'j');
  assert.equal(after.state, 'investigate');
  assert.deepEqual(after.lastKnownTarget, before.lastKnownTarget);
});

test('a spawned Flanker round-trips slide conceal through a run snapshot', () => {
  // contract seed 2 / CRITICAL / fodder 4 deterministically rolls a Flanker.
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 2, difficulty: 'critical', threatCount: 4 }));
  run.enterCombat();
  const before = [...run.world!.entities.values()].find(e => e instanceof Flanker);
  assert.ok(before instanceof Flanker, 'flanker present pre-snapshot');
  before.state = 'investigate';
  before.lastKnownTarget = { x: before.x, y: before.y };
  before.slideConcealed = true;

  const rec = snapshot(run);
  const flankerRec = rec.entities.find(e => e.id === before.id);
  assert.equal(flankerRec?.archetype, 'flanker');
  assert.ok(flankerRec?.extra, 'state machine lives in the slim extra bag (M6.2)');
  assert.equal(flankerRec?.extra?.slideConcealed, true);

  const { world } = restore(rec);
  const after = [...world.entities.values()].find(e => e.id === before.id);
  assert.ok(after instanceof Flanker, 'flanker survives the round-trip');
  assert.equal(after.glyph, 'f');
  assert.equal(after.state, 'investigate');
  assert.deepEqual(after.lastKnownTarget, before.lastKnownTarget);
  assert.equal(after.slideConcealed, true);
});

test('hostile-all sweep is not satisfied while a guard remains alive', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(
    fakeContract({
      seed: 42, // → 2 guards + 1 skirmisher
      difficulty: 'standard',
      threatCount: 3,
      objective: {
        kind: OBJECTIVES.SWEEP,
        title: 'Sweep',
        briefing: 'Clear all hostiles.',
        params: { sweepTarget: 'hostile-all' },
      },
      context: testContractContext(OBJECTIVES.SWEEP),
    })
  );
  run.enterCombat();
  const fodder = [...run.world!.entities.values()].filter(
    e => e.id.startsWith('drone-') || e.id.startsWith('guard-')
  );
  const turret = [...run.world!.entities.values()].find(e => e instanceof CorpTurret);
  assert.ok(turret, 'hostile-all sweep places an ambient turret that counts as hostile');
  // Kill only the skirmishers — guards still hold the room.
  for (const e of fodder) if (e.id.startsWith('drone-')) e.damage(e.hp);
  assert.equal(run.isObjectiveSatisfied(), false, 'sweep incomplete while guards live');
  // Drop the guards too, but the ambient turret is still a live hostile.
  for (const e of fodder) if (e.id.startsWith('guard-')) e.damage(e.hp);
  assert.equal(run.isObjectiveSatisfied(), false, 'sweep incomplete while turret lives');
  turret.damage(turret.hp);
  assert.equal(run.isObjectiveSatisfied(), true, 'all live hostiles down — sweep complete');
});

test('a killed guard drops scrap salvage', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 42, difficulty: 'standard', threatCount: 3 }));
  run.enterCombat();
  const guard = [...run.world!.entities.values()].find(e => e.id.startsWith('guard-'));
  assert.ok(guard, 'seed 42 rolls at least one guard');
  // Teleport the player adjacent and swing; the run's combat listener assigns
  // loot on a kill. dodgeChance 0 forces a connect.
  run.player!.x = guard.x + 1;
  run.player!.y = guard.y;
  guard.hp = 1; // one swing kills regardless of melee tuning
  resolveMelee(run.world!, run.player!, guard, new Rng(1), { dodgeChance: 0 });
  assert.ok(!guard.alive, 'guard down');
  assert.ok(guard.loot, 'killed guard received loot');
  assert.ok(totalSalvage(guard.loot!.salvage) > 0);
  assert.ok(guard.loot!.salvage.scrap > 0, 'fodder drops scrap');
});

test('terminal-slice contract spawns a terminal and gates objective satisfaction', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
  run.enterBriefing(terminalSliceContract());
  run.enterCombat();

  const terminal = [...run.world!.entities.values()].find(entity => entity instanceof Terminal);
  assert.ok(terminal, 'terminal-slice combat map should include a terminal');
  assert.equal(terminal.glyph, '‡');
  assert.ok(
    Math.max(Math.abs(terminal.x - run.exitTile!.x), Math.abs(terminal.y - run.exitTile!.y)) > 1,
    'terminal should not spawn adjacent to extraction'
  );
  assert.equal(isObjectiveSatisfied(run.contract!, run.world!), false);

  relocateAdjacentTo(run, terminal);
  const result = terminal.interact(run.world!, run.player!);

  assert.equal(result.ok, true);
  assert.equal(terminal.sliced, true);
  assert.equal(run.world!.alarm.phase, 'alert');
  assert.equal(isObjectiveSatisfied(run.contract!, run.world!), true);
});

test('terminal-slice placement never blocks the route from spawn to exit', () => {
  for (const seed of [1, 42, 0xabcd1234, 0xdeadbeef, 0x55555555, 0xc0ffee, 0xfeedface]) {
    const run = new Run({ crewMember: makeCrew('razor'), seed });
    run.enterBriefing(terminalSliceContract({ seed }));
    run.enterCombat();
    const path = findPath(run.world!, run.player!, run.exitTile!, { allowOccupiedGoal: false });
    assert.ok(
      path && path.length > 0,
      `seed ${seed.toString(16)}: exit unreachable after terminal placement`
    );
  }
});

test('terminal-slice terminal placement varies across contract seeds', () => {
  const positions = new Set();
  for (let seed = 100; seed < 112; seed++) {
    const run = new Run({ crewMember: makeCrew('razor'), seed });
    run.enterBriefing(terminalSliceContract({ seed }));
    run.enterCombat();
    const terminal = [...run.world!.entities.values()].find(entity => entity instanceof Terminal);
    assert.ok(terminal, 'terminal-slice combat map should include a terminal');
    positions.add(`${terminal.x},${terminal.y}`);
  }
  assert.ok(positions.size > 1, 'terminal placement should vary across contract seeds');
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
  assert.throws(() =>
    run.enterBriefing({ ...fakeContract(), objective: { kind: 'retrieve', title: '' } })
  );
  assert.throws(() => run.enterBriefing({ ...fakeContract(), difficulty: 'meltdown' }));
  assert.throws(() => run.enterBriefing({ ...fakeContract(), threatCount: -1 }));
  assert.throws(() => run.enterBriefing({ ...fakeContract(), reward: null }));
  assert.throws(() =>
    run.enterBriefing({ ...fakeContract(), reward: { credits: -1, repDelta: 0 } })
  );
  assert.throws(() => run.enterBriefing({ ...fakeContract(), label: '' }));
  assert.throws(() => run.enterBriefing({ ...fakeContract(), context: null }));
});

test('enterResult rejects unknown outcomes', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  // @ts-expect-error Runtime validation must reject an unknown outcome.
  assert.throws(() => run.enterResult({ outcome: 'undecided' }));
});

test('turn:ended in COMBAT triggers onPersist with a snapshot record', () => {
  const records: RunSnapshot[] = [];
  const run = new Run({
    crewMember: makeCrew('razor'),
    seed: 1,
    onPersist: (rec: RunSnapshot) => records.push(rec),
  });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  assert.equal(records.length, 0, 'no persist before any turn ends');
  run.queue!.endTurn(run.world!);
  assert.equal(records.length, 1, 'one persist after one turn end');
  const rec = records[0];
  assert.equal(rec.type, 'run');
  assert.equal(rec.state, RUN_STATE.COMBAT);
  assert.equal(rec.archetype, 'razor');
  assert.equal(rec.turnNumber, run.queue!.turnNumber);
  assert.equal(rec.currentFaction, FACTION.CORP);
});

test('enterResult persists RESULT snapshot before onResult (no stale COMBAT save)', () => {
  const order: string[] = [];
  const persists: RunSnapshot[] = [];
  const run = new Run({
    crewMember: makeCrew('razor'),
    seed: 1,
    onPersist: (rec: RunSnapshot) => {
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
  const results: RunResult[] = [];
  const run = new Run({
    crewMember: makeCrew('razor'),
    seed: 1,
    onResult: (r: RunResult) => results.push(r),
  });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  run.player!.damage(run.player!.hp);
  run.bus!.emit('entity:damaged', {
    attacker: { id: 'drone-0', faction: FACTION.CORP },
    target: run.player,
    damage: run.player!.maxHp,
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
  const drone = [...run.world!.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone, 'expected at least one corp drone for threatCount=1');
  run.bus!.emit('entity:damaged', {
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
  const drone = [...run.world!.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone);
  const turret = new Turret({
    id: `${run.player!.id}-turret`,
    x: 1,
    y: 1,
    ownerId: run.player!.id,
  });
  run.bus!.emit('entity:damaged', {
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
  const results: RunResult[] = [];
  const run = new Run({
    crewMember: makeCrew('razor'),
    seed: 99,
    onResult: (r: RunResult) => results.push(r),
  });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  run.bus!.emit('entity:moved', {
    entity: run.player,
    from: { x: run.player!.x, y: run.player!.y },
    to: { x: run.exitTile!.x, y: run.exitTile!.y },
  });
  assert.equal(run.state, RUN_STATE.RESULT);
  assert.equal(results[0].outcome, OUTCOME.EXIT);
});

// --- M3: loot drops on kill -----------------------------------------------

test('killing a corp entity assigns loot to the target', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  const drone = [...run.world!.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone);
  drone.damage(drone.maxHp);
  run.bus!.emit('entity:damaged', {
    attacker: run.player,
    target: drone,
    damage: drone.maxHp,
    killed: true,
    source: 'ranged',
  });
  assert.ok(drone.loot, 'killed drone should have loot assigned');
  // M4.2: drone loot is typed — scrap-only for drones; total stays in the
  // configured drop range.
  assert.equal(drone.loot!.salvage.chips, 0, 'drone loot has no chips');
  assert.equal(drone.loot!.salvage.bio, 0, 'drone loot has no bio');
  assert.equal(drone.loot!.salvage.data, 0, 'drone loot has no data');
  const total = totalSalvage(drone.loot!.salvage);
  assert.ok(
    total >= SALVAGE_DROP_MIN && total <= SALVAGE_DROP_MAX,
    `salvage total ${total} outside [${SALVAGE_DROP_MIN}, ${SALVAGE_DROP_MAX}]`
  );
});

test('killing a corp entity via turret also assigns loot', () => {
  const run = new Run({ crewMember: makeCrew('tech'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  const drone = [...run.world!.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone);
  const turret = new Turret({
    id: `${run.player!.id}-turret`,
    x: 1,
    y: 1,
    ownerId: run.player!.id,
  });
  drone.damage(drone.maxHp);
  run.bus!.emit('entity:damaged', {
    attacker: turret,
    target: drone,
    damage: 1,
    killed: true,
    source: 'ranged',
  });
  assert.ok(drone.loot, 'turret-killed drone should have loot');
  assert.ok(totalSalvage(drone.loot!.salvage) >= SALVAGE_DROP_MIN);
});

test('killing a CorpTurret drops chips, not scrap (M4.2)', () => {
  const run = new Run({ crewMember: makeCrew('merc'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  // Place a CorpTurret on a known floor tile near the player and kill it via
  // the same damage-emit path that drone kills use.
  const player = run.player!;
  const turret = new CorpTurret({
    id: 'corp-turret-loot-test',
    x: player.x + 2,
    y: player.y,
  });
  // Find a passable tile if (x+2, y) is blocked — bumping is fine for the test.
  while (
    !run.world!.grid.isPassable(turret.x, turret.y) ||
    run.world!.entityAt(turret.x, turret.y)
  ) {
    turret.x++;
    if (turret.x >= run.world!.grid.width) throw new Error('no passable tile for CorpTurret');
  }
  run.world!.addEntity(turret);
  turret.damage(turret.maxHp);
  run.bus!.emit('entity:damaged', {
    attacker: run.player,
    target: turret,
    damage: turret.maxHp,
    killed: true,
    source: 'ranged',
  });
  assert.ok(turret.loot, 'killed corp turret should have loot assigned');
  assert.equal(turret.loot!.salvage.scrap, 0, 'turret loot has no scrap');
  assert.equal(turret.loot!.salvage.bio, 0, 'turret loot has no bio');
  assert.equal(turret.loot!.salvage.data, 0, 'turret loot has no data');
  assert.ok(
    turret.loot!.salvage.chips >= SALVAGE_DROP_MIN &&
      turret.loot!.salvage.chips <= SALVAGE_DROP_MAX,
    `chips ${turret.loot!.salvage.chips} outside [${SALVAGE_DROP_MIN}, ${SALVAGE_DROP_MAX}]`
  );
});

test('killing a Bruiser drops bio salvage, not scrap or chips', () => {
  const run = new Run({ crewMember: makeCrew('merc'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 0, difficulty: 'critical', threatCount: 4 }));
  run.enterCombat();
  const bruiser = [...run.world!.entities.values()].find(e => e instanceof Bruiser);
  assert.ok(bruiser instanceof Bruiser, 'critical job should spawn a bruiser');
  bruiser.damage(bruiser.maxHp);
  run.bus!.emit('entity:damaged', {
    attacker: run.player,
    target: bruiser,
    damage: bruiser.maxHp,
    killed: true,
    source: 'ranged',
  });
  assert.ok(bruiser.loot, 'killed bruiser should have loot assigned');
  assert.equal(bruiser.loot!.salvage.scrap, 0, 'bruiser loot has no scrap');
  assert.equal(bruiser.loot!.salvage.chips, 0, 'bruiser loot has no chips');
  assert.equal(bruiser.loot!.salvage.data, 0, 'bruiser loot has no data');
  assert.ok(
    bruiser.loot!.salvage.bio >= SALVAGE_DROP_MIN && bruiser.loot!.salvage.bio <= SALVAGE_DROP_MAX,
    `bio ${bruiser.loot!.salvage.bio} outside [${SALVAGE_DROP_MIN}, ${SALVAGE_DROP_MAX}]`
  );
});

test('killing a Juggernaut drops bio salvage, not scrap or chips', () => {
  const run = new Run({ crewMember: makeCrew('merc'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 1, difficulty: 'critical', threatCount: 4 }));
  run.enterCombat();
  const juggernaut = [...run.world!.entities.values()].find(e => e instanceof Juggernaut);
  assert.ok(juggernaut instanceof Juggernaut, 'critical job should spawn a juggernaut');
  juggernaut.damage(juggernaut.maxHp);
  run.bus!.emit('entity:damaged', {
    attacker: run.player,
    target: juggernaut,
    damage: juggernaut.maxHp,
    killed: true,
    source: 'ranged',
  });
  assert.ok(juggernaut.loot, 'killed juggernaut should have loot assigned');
  assert.equal(juggernaut.loot!.salvage.scrap, 0, 'juggernaut loot has no scrap');
  assert.equal(juggernaut.loot!.salvage.chips, 0, 'juggernaut loot has no chips');
  assert.equal(juggernaut.loot!.salvage.data, 0, 'juggernaut loot has no data');
  assert.ok(
    juggernaut.loot!.salvage.bio >= SALVAGE_DROP_MIN &&
      juggernaut.loot!.salvage.bio <= SALVAGE_DROP_MAX,
    `bio ${juggernaut.loot!.salvage.bio} outside [${SALVAGE_DROP_MIN}, ${SALVAGE_DROP_MAX}]`
  );
});

test('killing a Flanker drops bio salvage, not scrap or chips', () => {
  const run = new Run({ crewMember: makeCrew('merc'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 2, difficulty: 'critical', threatCount: 4 }));
  run.enterCombat();
  const flanker = [...run.world!.entities.values()].find(e => e instanceof Flanker);
  assert.ok(flanker instanceof Flanker, 'critical job should spawn a flanker');
  flanker.damage(flanker.maxHp);
  run.bus!.emit('entity:damaged', {
    attacker: run.player,
    target: flanker,
    damage: flanker.maxHp,
    killed: true,
    source: 'ranged',
  });
  assert.ok(flanker.loot, 'killed flanker should have loot assigned');
  assert.equal(flanker.loot!.salvage.scrap, 0, 'flanker loot has no scrap');
  assert.equal(flanker.loot!.salvage.chips, 0, 'flanker loot has no chips');
  assert.equal(flanker.loot!.salvage.data, 0, 'flanker loot has no data');
  assert.ok(
    flanker.loot!.salvage.bio >= SALVAGE_DROP_MIN && flanker.loot!.salvage.bio <= SALVAGE_DROP_MAX,
    `bio ${flanker.loot!.salvage.bio} outside [${SALVAGE_DROP_MIN}, ${SALVAGE_DROP_MAX}]`
  );
});

test('non-lethal damage does not assign loot', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  const drone = [...run.world!.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone);
  run.bus!.emit('entity:damaged', {
    attacker: run.player,
    target: drone,
    damage: 1,
    killed: false,
    source: 'ranged',
  });
  assert.equal(drone.loot, undefined, 'non-lethal hit should not assign loot');
});

test('loot rolls are deterministic across seeds', () => {
  // Two runs with the same seed should produce the same loot roll.
  const loots: number[] = [];
  for (let i = 0; i < 2; i++) {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
    run.enterBriefing(fakeContract());
    run.enterCombat();
    const drone = [...run.world!.entities.values()].find(e => e.faction === FACTION.CORP);
    assert.ok(drone);
    drone.damage(drone.maxHp);
    run.bus!.emit('entity:damaged', {
      attacker: run.player,
      target: drone,
      damage: drone.maxHp,
      killed: true,
      source: 'ranged',
    });
    loots.push(totalSalvage(drone.loot!.salvage));
  }
  assert.equal(loots[0], loots[1], 'same seed should produce same loot');
});

test('player inventory is initialised at job deploy (enterCombat)', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  assert.ok(run.player!.inventory, 'inventory should be initialised');
  // M4.2: fresh inventory has a typed-empty wallet.
  assert.deepEqual(run.player!.inventory.salvage, emptySalvage());
  assert.deepEqual(run.player!.inventory.consumables, []);
});

test('Run places deterministic consumable pickups from the contract seed', () => {
  const first = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  first.enterBriefing(fakeContract({ seed: 4 }));
  first.enterCombat();
  const second = new Run({ crewMember: makeCrew('razor'), seed: 999 });
  second.enterBriefing(fakeContract({ seed: 4 }));
  second.enterCombat();

  const serialize = (run: Run) =>
    [...run.world!.entities.values()]
      .filter(entity => entity instanceof ConsumablePickup)
      .map(pickup => ({
        id: pickup.id,
        x: pickup.x,
        y: pickup.y,
        consumableId: pickup.consumableId,
        label: pickup.label,
      }));

  const pickups = serialize(first);
  assert.equal(pickups.length, 2, 'seed 4 should prove multi-pickup placement');
  assert.deepEqual(serialize(second), pickups);
});

test('Run snapshot/restore preserves on-map consumable pickups', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract({ seed: 4 }));
  run.enterCombat();
  const before = [...run.world!.entities.values()]
    .filter(entity => entity instanceof ConsumablePickup)
    .map(pickup => ({
      id: pickup.id,
      x: pickup.x,
      y: pickup.y,
      consumableId: pickup.consumableId,
      label: pickup.label,
    }));
  assert.ok(before.length > 0, 'test seed should place at least one pickup');

  const rec = snapshot(run);
  assert.ok(rec.entities.some(entity => entity.archetype === 'consumable-pickup'));
  const { world } = restore(rec);
  const after = [...world.entities.values()]
    .filter(entity => entity instanceof ConsumablePickup)
    .map(pickup => ({
      id: pickup.id,
      x: pickup.x,
      y: pickup.y,
      consumableId: pickup.consumableId,
      label: pickup.label,
    }));
  assert.deepEqual(after, before);
});

// --- M5: civilian:harmed emission --------------------------------------------

test('civilian:harmed emitted when player damages a NeutralCivilian', () => {
  const run = new Run({ crewMember: makeCrew('merc'), seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();

  // Find a passable, unoccupied tile near the player to place the neutral.
  const world = run.world!;
  const player = run.player!;
  let nx = -1;
  let ny = -1;
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
    const cx = player.x + dx;
    const cy = player.y + dy;
    if (world.grid.isPassable(cx, cy) && !world.entityAt(cx, cy)) {
      nx = cx;
      ny = cy;
      break;
    }
  }
  assert.ok(nx >= 0, 'need a passable neighbor to place neutral');

  const neutral = new NeutralCivilian({ id: 'test-neutral-civ', x: nx, y: ny });
  world.addEntity(neutral);

  const harmed: unknown[] = [];
  run.bus!.on(EVENT.CIVILIAN_HARMED, (payload: unknown) => harmed.push(payload));

  // Simulate a melee hit via entity:damaged event (the combat resolver emits
  // this; we trigger the Run listener directly through the bus).
  run.bus!.emit(EVENT.ENTITY_DAMAGED, {
    attacker: run.player,
    target: neutral,
    damage: 2,
    killed: false,
    source: 'melee',
  });

  assert.equal(harmed.length, 1, 'civilian:harmed should fire on NeutralCivilian hit');
  const payload = harmed[0] as Record<string, unknown>;
  assert.equal(payload.killed, false);
  assert.equal(payload.target, neutral);
  assert.equal(run.telemetry.civilianHarms as number, 1);
});

test('enterCombat survives crowded critical deny map (debug.json regression)', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 2086354852 });
  run.enterBriefing(
    fakeContract({
      seed: 2086354852,
      difficulty: 'critical',
      threatCount: 4,
      objective: {
        kind: OBJECTIVES.DENY,
        title: 'Disable community power',
        briefing:
          'Find Vuong Holdings community power at skybridge, execute the torch, then extract.',
        params: { target: 'power-siphon', requiresUnlock: true },
      },
      label: '// Blacked-out skybridge community power torch',
    })
  );
  assert.doesNotThrow(() => run.enterCombat());
  assert.equal(run.state, RUN_STATE.COMBAT);
});

test('civilian:harmed does NOT fire when a CORP entity is killed', () => {
  const run = new Run({ crewMember: makeCrew('merc'), seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();

  const harmed: unknown[] = [];
  run.bus!.on(EVENT.CIVILIAN_HARMED, (payload: unknown) => harmed.push(payload));

  // The drones are corp — killing one should not emit civilian:harmed.
  const drone = [...run.world!.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone, 'should have a corp drone on the map');
  run.bus!.emit(EVENT.ENTITY_DAMAGED, {
    attacker: run.player,
    target: drone,
    damage: 3,
    killed: true,
    source: 'ranged',
  });

  assert.equal(harmed.length, 0, 'corp kills must not emit civilian:harmed');
});

test('civilian:harmed emitted when player-planted breaching charge hits NEUTRAL', () => {
  const run = new Run({ crewMember: makeCrew('merc'), seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();

  const world = run.world!;
  const player = run.player!;
  let nx = -1;
  let ny = -1;
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
    const cx = player.x + dx;
    const cy = player.y + dy;
    if (world.grid.isPassable(cx, cy) && !world.entityAt(cx, cy)) {
      nx = cx;
      ny = cy;
      break;
    }
  }
  assert.ok(nx >= 0, 'need a passable neighbor to place neutral');
  const neutral = new NeutralCivilian({ id: 'test-neutral', x: nx, y: ny });
  world.addEntity(neutral);

  const harmed: unknown[] = [];
  run.bus!.on(EVENT.CIVILIAN_HARMED, (payload: unknown) => harmed.push(payload));

  run.bus!.emit(EVENT.ENTITY_DAMAGED, {
    attacker: player,
    target: neutral,
    damage: 1,
    killed: true,
    source: 'breach-blast',
  });

  assert.equal(harmed.length, 1, 'breach-blast with player attacker should emit civilian:harmed');
  assert.equal(run.telemetry.civilianHarms as number, 1);
});

test('civilian:harmed does NOT fire when player-planted breaching charge kills CorpCivilian', () => {
  const run = new Run({ crewMember: makeCrew('merc'), seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();

  const world = run.world!;
  const player = run.player!;
  let nx = -1;
  let ny = -1;
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
    const cx = player.x + dx;
    const cy = player.y + dy;
    if (world.grid.isPassable(cx, cy) && !world.entityAt(cx, cy)) {
      nx = cx;
      ny = cy;
      break;
    }
  }
  assert.ok(nx >= 0, 'need a passable neighbor to place corp civilian');
  const corpCiv = new CorpCivilian({ id: 'desk-clerk', x: nx, y: ny });
  world.addEntity(corpCiv);

  const harmed: unknown[] = [];
  run.bus!.on(EVENT.CIVILIAN_HARMED, (payload: unknown) => harmed.push(payload));

  run.bus!.emit(EVENT.ENTITY_DAMAGED, {
    attacker: player,
    target: corpCiv,
    damage: 1,
    killed: true,
    source: 'breach-blast',
  });

  assert.equal(harmed.length, 0, 'CorpCivilian kills must not emit civilian:harmed or cost Rep');
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
