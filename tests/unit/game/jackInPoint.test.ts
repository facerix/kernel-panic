/**
 * P3.M3.2 — Jack-in point: the Meatspace door into Cyberspace.
 *
 * A `JackInPoint` is placed for data-node-slice contracts. Only a Decker can
 * link (capability sniff on `canJackIn`); linking emits `EVENT.JACK_IN` once;
 * redundant input logs (never throws); state round-trips through persistence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Run, RUN_STATE } from '../../../src/game/Run.js';
import { JackInPoint } from '../../../src/game/entities/JackInPoint.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { AP_COST, TILE } from '../../../src/game/constants.js';
import { OBJECTIVES, type Contract } from '../../../src/game/hub/Curator.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';

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

function openWorld(width = 7, height = 5) {
  const grid = new Grid(width, height);
  return new World(grid, { events: new EventBus() });
}

function makeDecker(x = 1, y = 1) {
  return buildCrewMember('decker', { x, y }, new Rng(100), { id: 'crew-decker' });
}

function makeMerc(x = 1, y = 1) {
  return buildCrewMember('merc', { x, y }, new Rng(101), { id: 'crew-merc' });
}

function readyForCombat<T extends { ap: number; maxAp: number }>(member: T): T {
  member.ap = member.maxAp = 4;
  return member;
}

// --- interact behavior ------------------------------------------------------

test('a non-Decker cannot link: refused, no AP spent, no event', () => {
  const world = openWorld();
  const merc = readyForCombat(makeMerc(1, 1));
  const point = new JackInPoint({ id: 'jack-in-0', x: 2, y: 1 });
  world.addEntity(merc);
  world.addEntity(point);
  let events = 0;
  world.events!.on(EVENT.JACK_IN, () => events++);

  const apBefore = merc.ap;
  const result = point.interact(world, merc);
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /cyberdeck|decker/i);
  assert.equal(merc.ap, apBefore);
  assert.equal(point.linked, false);
  assert.equal(events, 0);
});

test('a Decker links: AP debited, linked latched, one JACK_IN event', () => {
  const world = openWorld();
  const decker = readyForCombat(makeDecker(1, 1));
  const point = new JackInPoint({ id: 'jack-in-0', x: 2, y: 1 });
  world.addEntity(decker);
  world.addEntity(point);
  const payloads: unknown[] = [];
  world.events!.on(EVENT.JACK_IN, payload => payloads.push(payload));

  const apBefore = decker.ap;
  const result = point.interact(world, decker);
  assert.equal(result.ok, true);
  assert.equal(decker.ap, apBefore - AP_COST.INTERACT);
  assert.equal(point.linked, true);
  assert.equal(payloads.length, 1);
  const payload = payloads[0] as { point: JackInPoint; actor: unknown };
  assert.equal(payload.point, point);
  assert.equal(payload.actor, decker);
});

test('re-linking is redundant input: logged refusal, no second event, no AP', () => {
  const world = openWorld();
  const decker = readyForCombat(makeDecker(1, 1));
  const point = new JackInPoint({ id: 'jack-in-0', x: 2, y: 1 });
  world.addEntity(decker);
  world.addEntity(point);
  let events = 0;
  world.events!.on(EVENT.JACK_IN, () => events++);

  assert.equal(point.interact(world, decker).ok, true);
  const apAfterLink = decker.ap;
  const repeat = point.interact(world, decker);
  assert.equal(repeat.ok, false);
  assert.equal((repeat as { reason: string }).reason, 'already-linked');
  assert.equal(decker.ap, apAfterLink);
  assert.equal(events, 1);
});

test('linking requires adjacency', () => {
  const world = openWorld();
  const decker = readyForCombat(makeDecker(1, 1));
  const point = new JackInPoint({ id: 'jack-in-0', x: 4, y: 1 });
  world.addEntity(decker);
  world.addEntity(point);
  const result = point.interact(world, decker);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'not-adjacent');
});

// --- Run placement ------------------------------------------------------------

function combatRun(seed = 12345) {
  const run = new Run({ crewMember: makeDecker(0, 0), seed });
  run.enterBriefing(cyberContract({ seed }));
  run.enterCombat();
  return run;
}

function jackInPoints(run: Run): JackInPoint[] {
  return Array.from(run.world!.entities.values()).filter(
    (e): e is JackInPoint => e instanceof JackInPoint
  );
}

test('a cyber contract places exactly one jack-in point, deterministically', () => {
  const a = combatRun();
  const b = combatRun();
  const pointsA = jackInPoints(a);
  const pointsB = jackInPoints(b);
  assert.equal(pointsA.length, 1);
  assert.equal(pointsB.length, 1);
  const point = pointsA[0];
  assert.equal(point.id, 'jack-in-0');
  assert.equal(point.linked, false);
  assert.deepEqual({ x: point.x, y: point.y }, { x: pointsB[0].x, y: pointsB[0].y });
  // The jack-in id must never count toward TERMINAL_SLICE objectives.
  assert.ok(!/^terminal-\d+$/.test(point.id));
  // Never stacked on the operator spawn or the exit tile.
  assert.ok(point.x !== a.player!.x || point.y !== a.player!.y);
  assert.ok(point.x !== a.exitTile!.x || point.y !== a.exitTile!.y);
});

test('non-cyber contracts place no jack-in point and carry no cyberspace state', () => {
  const run = new Run({ crewMember: makeDecker(0, 0), seed: 999 });
  run.enterBriefing(fakeContract({ seed: 999 }));
  run.enterCombat();
  assert.equal(jackInPoints(run).length, 0);
  assert.equal(run.cyberspace, null);
});

test('a cyber contract latches dormant cyberspace state at briefing', () => {
  const run = new Run({ crewMember: makeDecker(0, 0), seed: 12345 });
  run.enterBriefing(cyberContract());
  assert.deepEqual(run.cyberspace, { phase: 'dormant' });
  assert.equal(run.state, RUN_STATE.BRIEFING);
});

// --- persistence ---------------------------------------------------------------

test('jack-in point and dormant cyberspace state round-trip a snapshot', () => {
  const run = combatRun();
  const point = jackInPoints(run)[0];
  point.linked = true;
  point.secured = true;
  point.armed = false;

  const record = snapshot(run);
  assert.deepEqual(record.cyberspace, { phase: 'dormant' });

  const { run: restored } = restore(structuredClone(record));
  const restoredPoint = jackInPoints(restored)[0];
  assert.ok(restoredPoint, 'jack-in point survives the round-trip');
  assert.equal(restoredPoint.linked, true);
  assert.equal(restoredPoint.x, point.x);
  assert.equal(restoredPoint.y, point.y);
  assert.deepEqual(restored.cyberspace, { phase: 'dormant' });
});

test('non-cyber snapshots omit the cyberspace block', () => {
  const run = new Run({ crewMember: makeDecker(0, 0), seed: 999 });
  run.enterBriefing(fakeContract({ seed: 999 }));
  run.enterCombat();
  const record = snapshot(run);
  assert.equal('cyberspace' in record && record.cyberspace !== undefined, false);
  assert.equal(restore(structuredClone(record)).run.cyberspace, null);
});

test('restore throws on cyberspace/contract mismatches and malformed phases', () => {
  const cyberRecord = snapshot(combatRun());

  // Cyber contract without its cyberspace block is corrupt.
  const missingBlock = structuredClone(cyberRecord) as Record<string, unknown>;
  delete missingBlock.cyberspace;
  assert.throws(() => restore(missingBlock), /cyberspace/);

  // Unknown phase is corrupt.
  const badPhase = structuredClone(cyberRecord);
  (badPhase.cyberspace as { phase: string }).phase = 'jacked-sideways';
  assert.throws(() => restore(badPhase), /phase/);

  // Dormant must not smuggle payload fields.
  const dormantPayload = structuredClone(cyberRecord);
  (dormantPayload.cyberspace as Record<string, unknown>).grid = { w: 1, h: 1, tiles: [0] };
  assert.throws(() => restore(dormantPayload), /dormant/);

  // A cyberspace block on a non-cyber contract is corrupt.
  const plainRun = new Run({ crewMember: makeDecker(0, 0), seed: 999 });
  plainRun.enterBriefing(fakeContract({ seed: 999 }));
  plainRun.enterCombat();
  const plainRecord = structuredClone(snapshot(plainRun)) as Record<string, unknown>;
  plainRecord.cyberspace = { phase: 'dormant' };
  assert.throws(() => restore(plainRecord), /cyberspace/);
});

test('restore throws on a jack-in point record missing linked state', () => {
  const record = structuredClone(snapshot(combatRun()));
  const pointRec = record.entities.find(e => e.archetype === 'jack-in-point');
  assert.ok(pointRec, 'snapshot carries the jack-in point');
  delete (pointRec!.extra as Record<string, unknown>).linked;
  assert.throws(() => restore(record), /linked/);
});

test('TILE smoke guard: jack-in anchor sits on a passable tile', () => {
  const run = combatRun();
  const point = jackInPoints(run)[0];
  assert.notEqual(run.world!.grid.tileAt(point.x, point.y), TILE.WALL);
});
