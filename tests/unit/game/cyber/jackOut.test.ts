/**
 * P3.M3 S5 — voluntary jack-out finalization (P3.M4.6 pull-forward).
 *
 * The resolve core (latch, teardown, autosave) landed in S3/S4; this file
 * covers the remaining matrix: illegal-phase throws and the LINK BURNED
 * latch on the meat-side port — once the avatar routes out, the link is
 * dead and re-jack-in is refused with burn flavor, across persistence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run } from '../../../../src/game/Run.js';
import { CyberspaceLayer } from '../../../../src/game/cyber/CyberspaceLayer.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { snapshot, restore } from '../../../../src/game/persistence.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { Rng } from '../../../../src/rng.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';
import type { RunEntitySnapshot, RunSnapshot } from '../../../../src/game/Run.js';

const cyberContract = (seed = 12345) => ({
  seed,
  objective: {
    kind: OBJECTIVES.DATA_NODE_SLICE,
    title: 'Spike the server farm',
    briefing: 'Jack in, slice the data node, then extract.',
    params: { requiresCyberspace: true, count: 1 },
  },
  difficulty: 'standard',
  threatCount: 1,
  label: 'cyber test job',
  context: testContractContext(OBJECTIVES.DATA_NODE_SLICE),
  reward: { credits: 0, repDelta: 0 },
});

function makeDecker() {
  return buildCrewMember('decker', { x: 0, y: 0 }, new Rng(100), { id: 'crew-decker' });
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

function combatRun(seed = 12345) {
  const run = new Run({ crewMember: makeDecker(), seed });
  run.enterBriefing(cyberContract(seed));
  run.enterCombat();
  return run;
}

function meatPort(run: Run): JackInPoint {
  const point = Array.from(run.world!.entities.values()).find(e => e instanceof JackInPoint);
  assert.ok(point, 'cyber contract placed a jack-in point');
  return point as JackInPoint;
}

function jackIn(run: Run): CyberspaceLayer {
  const point = meatPort(run);
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  assert.equal(point.interact(run.world!, run.player!).ok, true);
  return (run.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
}

function routeOut(layer: CyberspaceLayer): void {
  const spot = adjacentFreeTile(layer.world, layer.port);
  layer.world.relocateEntity(layer.avatar, spot.x, spot.y);
  layer.avatar.refreshAp();
  assert.equal(layer.port.interact(layer.world, layer.avatar).ok, true);
}

function portRecord(record: RunSnapshot): RunEntitySnapshot {
  const rec = record.entities.find(e => e.archetype === 'jack-in-point');
  assert.ok(rec, 'snapshot carries the jack-in point');
  return rec!;
}

// --- illegal phases -----------------------------------------------------------------

test('jackOut while dormant throws (no layer to resolve)', () => {
  const run = combatRun();
  assert.equal(run.cyberspace?.phase, 'dormant');
  assert.throws(() => run.jackOut(), /phase/);
});

test('jackOut on a non-cyber contract throws', () => {
  const run = new Run({ crewMember: makeDecker(), seed: 999 });
  run.enterBriefing({
    seed: 999,
    objective: { kind: OBJECTIVES.REACH_EXIT, title: 'Extract clean', briefing: 'Reach exit.' },
    difficulty: 'standard',
    threatCount: 1,
    label: 'meat job',
    context: testContractContext(OBJECTIVES.REACH_EXIT),
    reward: { credits: 0, repDelta: 0 },
  });
  run.enterCombat();
  assert.equal(run.cyberspace, null);
  assert.throws(() => run.jackOut(), /phase/);
});

// --- LINK BURNED ---------------------------------------------------------------------

test('jack-out burns the meat-side port', () => {
  const run = combatRun();
  const layer = jackIn(run);
  const point = meatPort(run);
  assert.equal(point.burned, false, 'link is live while the avatar is in the grid');

  routeOut(layer);
  assert.equal(run.cyberspace?.phase, 'resolved');
  assert.equal(point.burned, true);

  run.player!.refreshAp();
  const apBefore = run.player!.ap;
  const repeat = point.interact(run.world!, run.player!);
  assert.equal(repeat.ok, false);
  assert.equal((repeat as { reason: string }).reason, 'link-burned');
  assert.match(repeat.message, /LINK BURNED/);
  assert.equal(run.player!.ap, apBefore, 'refusal burns no AP');
  assert.equal(run.cyberspace?.phase, 'resolved', 'the layer does not reactivate');
});

test('burn() on an unlinked port is corrupt state and throws', () => {
  const point = new JackInPoint({ id: 'jack-in-0', x: 1, y: 1 });
  assert.throws(() => point.burn(), /link/i);
});

// --- persistence ----------------------------------------------------------------------

test('the burned latch round-trips and the restored port stays dead', () => {
  const run = combatRun();
  routeOut(jackIn(run));

  const record = structuredClone(snapshot(run));
  assert.equal((portRecord(record).extra as { burned?: boolean }).burned, true);

  const { run: restored } = restore(record);
  const point = meatPort(restored);
  assert.equal(point.burned, true);
  restored.player!.refreshAp();
  const repeat = point.interact(restored.world!, restored.player!);
  assert.equal(repeat.ok, false);
  assert.equal((repeat as { reason: string }).reason, 'link-burned');
});

test('a pre-S5 record without the burned flag restores unburned', () => {
  const run = combatRun();
  jackIn(run);
  const record = structuredClone(snapshot(run));
  delete (portRecord(record).extra as Record<string, unknown>).burned;
  const { run: restored } = restore(record);
  assert.equal(meatPort(restored).burned, false);
});

test('burned without linked is corrupt and throws on restore', () => {
  const run = combatRun();
  jackIn(run);
  const record = structuredClone(snapshot(run));
  const extra = portRecord(record).extra as Record<string, unknown>;
  extra.linked = false;
  extra.burned = true;
  assert.throws(() => restore(record), /burned/);
});

test('a non-boolean burned flag throws on restore', () => {
  const run = combatRun();
  jackIn(run);
  const record = structuredClone(snapshot(run));
  (portRecord(record).extra as Record<string, unknown>).burned = 'yes';
  assert.throws(() => restore(record), /burned/);
});
