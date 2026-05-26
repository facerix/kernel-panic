import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME, isObjectiveSatisfied } from '../../../src/game/Run.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { FACTION, SALVAGE_DROP_MIN, SALVAGE_DROP_MAX } from '../../../src/game/constants.js';
import { totalSalvage, emptySalvage } from '../../../src/game/salvage.js';
import { Entity } from '../../../src/game/Entity.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { EVENT } from '../../../src/game/events.js';
import { Turret } from '../../../src/game/Turret.js';
import { CorpTurret } from '../../../src/game/entities/CorpTurret.js';
import { ConsumablePickup } from '../../../src/game/entities/ConsumablePickup.js';
import { restore, snapshot } from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { findPath } from '../../../src/game/Pathfinding.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';

const fakeContract = (overrides = {}) => ({
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
});

const terminalSliceContract = (overrides = {}) =>
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

function makeCrew(archetype = 'razor') {
  return buildCrewMember(archetype, { x: 0, y: 0 }, new Rng(100), {
    id: `crew-${archetype}`,
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
      if (run.world.liveEntityAt(x, y)) continue;
      run.world.relocateEntity(run.player, x, y);
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
  const drones = [...run.world.entities.values()].filter(entity => entity.id.startsWith('drone-'));
  assert.equal(drones.length, 4);
});

test('terminal-slice contract spawns a terminal and gates objective satisfaction', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
  run.enterBriefing(terminalSliceContract());
  run.enterCombat();

  const terminal = [...run.world.entities.values()].find(entity => entity instanceof Terminal);
  assert.ok(terminal, 'terminal-slice combat map should include a terminal');
  assert.equal(terminal.glyph, '‡');
  assert.ok(
    Math.max(Math.abs(terminal.x - run.exitTile.x), Math.abs(terminal.y - run.exitTile.y)) > 1,
    'terminal should not spawn adjacent to extraction'
  );
  assert.equal(isObjectiveSatisfied(run.contract, run.world), false);

  relocateAdjacentTo(run, terminal);
  const result = terminal.interact(run.world, run.player);

  assert.equal(result.ok, true);
  assert.equal(terminal.sliced, true);
  assert.equal(run.world.alarm.phase, 'alert');
  assert.equal(isObjectiveSatisfied(run.contract, run.world), true);
});

test('terminal-slice placement never blocks the route from spawn to exit', () => {
  for (const seed of [1, 42, 0xabcd1234, 0xdeadbeef, 0x55555555, 0xc0ffee, 0xfeedface]) {
    const run = new Run({ crewMember: makeCrew('razor'), seed });
    run.enterBriefing(terminalSliceContract({ seed }));
    run.enterCombat();
    const path = findPath(run.world, run.player, run.exitTile, { allowOccupiedGoal: false });
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
    const terminal = [...run.world.entities.values()].find(entity => entity instanceof Terminal);
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

// --- M3: loot drops on kill -----------------------------------------------

test('killing a corp entity assigns loot to the target', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone);
  drone.damage(drone.maxHp);
  run.bus.emit('entity:damaged', {
    attacker: run.player,
    target: drone,
    damage: drone.maxHp,
    killed: true,
    source: 'ranged',
  });
  assert.ok(drone.loot, 'killed drone should have loot assigned');
  // M4.2: drone loot is typed — scrap-only for drones; total stays in the
  // configured drop range.
  assert.equal(drone.loot.salvage.chips, 0, 'drone loot has no chips');
  assert.equal(drone.loot.salvage.bio, 0, 'drone loot has no bio');
  assert.equal(drone.loot.salvage.data, 0, 'drone loot has no data');
  const total = totalSalvage(drone.loot.salvage);
  assert.ok(
    total >= SALVAGE_DROP_MIN && total <= SALVAGE_DROP_MAX,
    `salvage total ${total} outside [${SALVAGE_DROP_MIN}, ${SALVAGE_DROP_MAX}]`
  );
});

test('killing a corp entity via turret also assigns loot', () => {
  const run = new Run({ crewMember: makeCrew('tech'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone);
  const turret = new Turret({ id: `${run.player.id}-turret`, x: 1, y: 1, ownerId: run.player.id });
  drone.damage(drone.maxHp);
  run.bus.emit('entity:damaged', {
    attacker: turret,
    target: drone,
    damage: 1,
    killed: true,
    source: 'ranged',
  });
  assert.ok(drone.loot, 'turret-killed drone should have loot');
  assert.ok(totalSalvage(drone.loot.salvage) >= SALVAGE_DROP_MIN);
});

test('killing a CorpTurret drops chips, not scrap (M4.2)', () => {
  const run = new Run({ crewMember: makeCrew('merc'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  // Place a CorpTurret on a known floor tile near the player and kill it via
  // the same damage-emit path that drone kills use.
  const player = run.player;
  const turret = new CorpTurret({
    id: 'corp-turret-loot-test',
    x: player.x + 2,
    y: player.y,
  });
  // Find a passable tile if (x+2, y) is blocked — bumping is fine for the test.
  while (!run.world.grid.isPassable(turret.x, turret.y) || run.world.entityAt(turret.x, turret.y)) {
    turret.x++;
    if (turret.x >= run.world.grid.w) throw new Error('no passable tile for CorpTurret');
  }
  run.world.addEntity(turret);
  turret.damage(turret.maxHp);
  run.bus.emit('entity:damaged', {
    attacker: run.player,
    target: turret,
    damage: turret.maxHp,
    killed: true,
    source: 'ranged',
  });
  assert.ok(turret.loot, 'killed corp turret should have loot assigned');
  assert.equal(turret.loot.salvage.scrap, 0, 'turret loot has no scrap');
  assert.equal(turret.loot.salvage.bio, 0, 'turret loot has no bio');
  assert.equal(turret.loot.salvage.data, 0, 'turret loot has no data');
  assert.ok(
    turret.loot.salvage.chips >= SALVAGE_DROP_MIN && turret.loot.salvage.chips <= SALVAGE_DROP_MAX,
    `chips ${turret.loot.salvage.chips} outside [${SALVAGE_DROP_MIN}, ${SALVAGE_DROP_MAX}]`
  );
});

test('non-lethal damage does not assign loot', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone);
  run.bus.emit('entity:damaged', {
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
  const loots = [];
  for (let i = 0; i < 2; i++) {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
    run.enterBriefing(fakeContract());
    run.enterCombat();
    const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
    drone.damage(drone.maxHp);
    run.bus.emit('entity:damaged', {
      attacker: run.player,
      target: drone,
      damage: drone.maxHp,
      killed: true,
      source: 'ranged',
    });
    loots.push(totalSalvage(drone.loot.salvage));
  }
  assert.equal(loots[0], loots[1], 'same seed should produce same loot');
});

test('player inventory is initialised at job deploy (enterCombat)', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  assert.ok(run.player.inventory, 'inventory should be initialised');
  // M4.2: fresh inventory has a typed-empty wallet.
  assert.deepEqual(run.player.inventory.salvage, emptySalvage());
  assert.deepEqual(run.player.inventory.consumables, []);
});

test('Run places deterministic consumable pickups from the contract seed', () => {
  const first = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  first.enterBriefing(fakeContract({ seed: 4 }));
  first.enterCombat();
  const second = new Run({ crewMember: makeCrew('razor'), seed: 999 });
  second.enterBriefing(fakeContract({ seed: 4 }));
  second.enterCombat();

  const serialize = run =>
    [...run.world.entities.values()]
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
  const before = [...run.world.entities.values()]
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

test('civilian:harmed emitted when player damages a NEUTRAL entity', () => {
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

  const neutral = new Entity({
    id: 'test-neutral-civ',
    x: nx,
    y: ny,
    faction: FACTION.NEUTRAL,
    glyph: 'n',
  });
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

  assert.equal(harmed.length, 1, 'civilian:harmed should fire on NEUTRAL hit');
  const payload = harmed[0] as Record<string, unknown>;
  assert.equal(payload.killed, false);
  assert.equal(payload.target, neutral);
  assert.equal(run.telemetry.civilianHarms as number, 1);
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
