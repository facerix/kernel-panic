/**
 * P3.M3.3 — Run-level jack-in: the dormant → active transition.
 *
 * Linking the jack-in point emits `EVENT.JACK_IN` on the meat bus; `Run`
 * builds the CyberspaceLayer from the *contract* seed (jack-in-turn
 * independent), wires the cyber listeners, and keeps Meatspace ticking.
 * Avatar death routes through the existing DEATH/flatline path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME } from '../../../../src/game/Run.js';
import { CyberspaceLayer } from '../../../../src/game/cyber/CyberspaceLayer.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { EVENT } from '../../../../src/game/events.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { OBJECTIVES, type Contract } from '../../../../src/game/hub/Curator.js';
import { Rng } from '../../../../src/rng.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';
import type { RunResult, RunSnapshot } from '../../../../src/game/Run.js';

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

const cyberContract = (overrides = {}) =>
  fakeContract({
    objective: {
      kind: OBJECTIVES.DATA_NODE_SLICE,
      title: 'Spike the server farm',
      briefing: 'Jack in, slice the data node, then extract.',
      params: { requiresCyberspace: true, count: 1 },
    },
    label: 'cyber test job',
    context: testContractContext(OBJECTIVES.DATA_NODE_SLICE),
    ...overrides,
  });

function makeDecker(x = 0, y = 0) {
  return buildCrewMember('decker', { x, y }, new Rng(100), { id: 'crew-decker' });
}

type RunHooks = {
  onPersist?: (record: RunSnapshot) => void;
  onResult?: (result: RunResult) => void;
};

function combatRun(seed = 12345, hooks: RunHooks = {}) {
  const run = new Run({ crewMember: makeDecker(), seed, ...hooks });
  run.enterBriefing(cyberContract({ seed }));
  run.enterCombat();
  return run;
}

function jackInPoint(run: Run): JackInPoint {
  const point = Array.from(run.world!.entities.values()).find(e => e instanceof JackInPoint);
  assert.ok(point, 'cyber contract placed a jack-in point');
  return point as JackInPoint;
}

function adjacentFreeTile(world: World, target: Entity) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = target.x + dx;
      const y = target.y + dy;
      if (world.grid.inBounds(x, y) && world.grid.isPassable(x, y) && !world.entityAt(x, y)) {
        return { x, y };
      }
    }
  }
  throw new Error(`no free tile adjacent to ${target.id}`);
}

/** Walk the Decker to the port and link. Returns the active layer. */
function jackIn(run: Run): CyberspaceLayer {
  const point = jackInPoint(run);
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  const result = point.interact(run.world!, run.player!);
  assert.equal(result.ok, true, `link failed: ${result.message}`);
  assert.equal(run.cyberspace?.phase, 'active');
  return (run.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
}

// --- golden path ---------------------------------------------------------------

test('linking the port flips the run to an active cyber layer', () => {
  const run = combatRun();
  const layer = jackIn(run);
  assert.ok(layer instanceof CyberspaceLayer);
  assert.equal(run.cyberActive, true);
  assert.equal(run.activeWorld, layer.world);
  assert.equal(run.activeActor, layer.avatar);
  // Avatar stats derive from the deployed Decker's base cyber stats.
  const decker = run.player! as unknown as { ram: number; iceResistance: number };
  assert.equal(layer.avatar.maxHp, decker.ram);
  assert.equal(layer.avatar.damageReduction, decker.iceResistance);
  // The Decker body keeps standing at the port in Meatspace.
  assert.equal(run.player!.alive, true);
  assert.ok(run.world!.entities.has(run.player!.id));
});

test('jack-in autosaves the active layer', () => {
  const records: RunSnapshot[] = [];
  const run = combatRun(12345, { onPersist: r => records.push(r) });
  jackIn(run);
  const last = records.at(-1)!;
  assert.equal(last.cyberspace?.phase, 'active');
  const block = last.cyberspace as { grid: { tiles: number[] }; entities: unknown[] };
  assert.ok(block.grid.tiles.length > 0);
  assert.ok(block.entities.length >= 2);
});

test('layer layout is independent of the jack-in turn', () => {
  const immediate = jackIn(combatRun(777));

  const late = combatRun(777);
  late.queue!.endTurn(late.world!); // player → corp
  late.queue!.endTurn(late.world!); // corp → player (round advance)
  const lateLayer = jackIn(late);

  assert.deepEqual(Array.from(lateLayer.world.grid.tiles), Array.from(immediate.world.grid.tiles));
  assert.deepEqual(lateLayer.entryTile, immediate.entryTile);

  // And both equal a fresh build from the same contract seed.
  const fresh = CyberspaceLayer.build({
    contractSeed: 777,
    difficulty: 'standard',
    decker: makeDecker(),
    nodeCount: 1,
  });
  assert.deepEqual(Array.from(fresh.world.grid.tiles), Array.from(immediate.world.grid.tiles));
});

// --- illegal transitions ---------------------------------------------------------

test('jackIn while already active throws (corrupt latch)', () => {
  const run = combatRun();
  jackIn(run);
  assert.throws(() => run.jackIn(jackInPoint(run)), /phase/);
});

test('jackIn outside COMBAT throws', () => {
  const run = new Run({ crewMember: makeDecker(), seed: 12345 });
  run.enterBriefing(cyberContract());
  assert.throws(
    () => run.jackIn(new JackInPoint({ id: 'jack-in-0', x: 1, y: 1, linked: true })),
    /COMBAT|illegal/
  );
});

test('a JACK_IN emission on a non-cyber contract throws', () => {
  const run = new Run({ crewMember: makeDecker(), seed: 999 });
  run.enterBriefing(fakeContract({ seed: 999 }));
  run.enterCombat();
  assert.equal(run.cyberspace, null);
  // Smuggle a port into a non-cyber run — the Run listener must refuse loudly.
  const point = new JackInPoint({ id: 'jack-in-rogue', x: 0, y: 0 });
  const spot = adjacentFreeTile(run.world!, run.player!);
  point.x = spot.x;
  point.y = spot.y;
  run.world!.addEntity(point);
  run.player!.refreshAp();
  assert.throws(() => point.interact(run.world!, run.player!), /[Cc]yberspace/);
});

// --- both worlds tick -------------------------------------------------------------

test('meat turn cadence drives the cyber AP refresh', () => {
  const run = combatRun();
  const layer = jackIn(run);
  layer.avatar.spendAp(3);
  run.queue!.endTurn(run.world!); // player → corp: avatar stays spent
  assert.equal(layer.avatar.ap, layer.avatar.maxAp - 3);
  run.queue!.endTurn(run.world!); // corp → player: avatar refreshes
  assert.equal(layer.avatar.ap, layer.avatar.maxAp);
  // The meat body refreshed on the same cadence (single TurnQueue).
  assert.equal(run.player!.ap, run.player!.maxAp);
});

// --- avatar death = flatline --------------------------------------------------------

test('avatar death routes through the existing DEATH path', () => {
  const results: RunResult[] = [];
  const run = combatRun(12345, { onResult: r => results.push(r) });
  const layer = jackIn(run);
  const avatar = layer.avatar;
  avatar.damage(avatar.hp);
  layer.bus.emit(EVENT.ENTITY_DAMAGED, {
    target: avatar,
    attacker: null,
    damage: avatar.maxHp,
    killed: true,
    source: 'black-ice',
  });
  assert.equal(run.state, RUN_STATE.RESULT);
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, OUTCOME.DEATH);
  assert.match(String(results[0].telemetry.cause), /black-ice/);
});

// --- voluntary jack-out core (S5 finalizes) -----------------------------------------

test('the avatar routing out resolves the layer', () => {
  const run = combatRun();
  const layer = jackIn(run);
  const result = layer.port.interact(layer.world, layer.avatar);
  assert.equal(result.ok, true);
  assert.deepEqual(run.cyberspace, { phase: 'resolved', objectiveComplete: false });
  assert.equal(run.state, RUN_STATE.COMBAT, 'jack-out returns to Meatspace, not RESULT');
  assert.equal(run.cyberActive, false);
  assert.equal(run.activeWorld, run.world);
  assert.equal(run.activeActor, run.player);
  // Resolved is a latch: jacking out twice is corrupt state.
  assert.throws(() => run.jackOut(), /phase/);
});

test('re-interacting the meat port after resolve stays refused (LINK BURNED)', () => {
  const run = combatRun();
  const layer = jackIn(run);
  layer.port.interact(layer.world, layer.avatar);
  const point = jackInPoint(run);
  run.player!.refreshAp();
  const repeat = point.interact(run.world!, run.player!);
  assert.equal(repeat.ok, false);
  // S5: jack-out burns the link — the refusal carries burn flavor, not the
  // redundant-input 'already-linked'.
  assert.equal((repeat as { reason: string }).reason, 'link-burned');
  assert.equal(run.cyberspace?.phase, 'resolved');
});
