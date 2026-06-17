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

import { JACK_OUT_SHOCK_DAMAGE } from '../../../../src/game/constants.js';
import { Run } from '../../../../src/game/Run.js';
import { CyberspaceLayer } from '../../../../src/game/cyber/CyberspaceLayer.js';
import { DataNode } from '../../../../src/game/cyber/DataNode.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { snapshot, restore } from '../../../../src/game/persistence.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { EVENT } from '../../../../src/game/events.js';
import { Rng } from '../../../../src/rng.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';
import type { JackOutRequest, RunEntitySnapshot, RunSnapshot } from '../../../../src/game/Run.js';

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

function makeMerc() {
  return buildCrewMember('merc', { x: 0, y: 0 }, new Rng(101), { id: 'crew-merc' });
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

function dualCombatRun(seed = 12345) {
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed });
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

/** Slice every node in the layer (standard difficulty 2 vs decker intrusion 2 → one pass each). */
function sliceAllNodes(layer: CyberspaceLayer): void {
  for (const entity of Array.from(layer.world.entities.values())) {
    if (!(entity instanceof DataNode)) continue;
    const spot = adjacentFreeTile(layer.world, entity);
    layer.world.relocateEntity(layer.avatar, spot.x, spot.y);
    layer.avatar.refreshAp();
    assert.equal(entity.interact(layer.world, layer.avatar).ok, true);
    assert.equal(entity.sliced, true, 'standard node slices in one pass at base intrusion');
  }
}

function damageBody(run: Run, amount: number): void {
  const body = run.player!;
  const damage = body.damage(amount);
  run.world!.events!.emit(EVENT.ENTITY_DAMAGED, {
    attacker: null,
    target: body,
    damage,
    killed: !body.alive,
    source: 'test-body-hit',
  });
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

// --- early jack-out confirmation (P3.M3 S7.5) -----------------------------------------
//
// An incomplete jack-out is irreversible — the link burns and the objective
// latches unsatisfiable. With `onJackOutRequested` registered, Run defers to
// the shell instead of resolving; `confirmJackOut()` finalizes. No callback
// (tests/harness) → resolve immediately, the `onAbortRequested` posture —
// locked by the LINK BURNED tests above, which route out with no callback.

test('jackIn invokes onJackInPresent after layer spawns', () => {
  const run = combatRun();
  let presented = 0;
  run.onJackInPresent = () => presented++;
  jackIn(run);
  assert.equal(presented, 1);
});

test('finalize jack-out invokes onJackOutPresent', () => {
  const run = combatRun();
  const layer = jackIn(run);
  sliceAllNodes(layer);
  let presented = 0;
  run.onJackOutPresent = () => presented++;
  routeOut(layer);
  assert.equal(presented, 1);
  assert.equal(run.cyberspace?.phase, 'resolved');
});

test('Run rejects a non-function onJackOutRequested', () => {
  assert.throws(
    () => new Run({ crewMember: makeDecker(), seed: 1, onJackOutRequested: 'nope' }),
    TypeError
  );
});

test('incomplete jack-out defers to onJackOutRequested — layer stays live, link unburned', () => {
  const run = combatRun();
  const layer = jackIn(run);
  let requests = 0;
  run.onJackOutRequested = () => requests++;

  routeOut(layer);
  assert.equal(requests, 1, 'shell asked exactly once');
  assert.equal(run.cyberspace?.phase, 'active', 'layer stays live pending confirmation');
  assert.equal(meatPort(run).burned, false, 'deferred request does not burn the link');
});

test('confirmJackOut finalizes the deferred jack-out: resolved, incomplete, burned', () => {
  const run = combatRun();
  const layer = jackIn(run);
  run.onJackOutRequested = () => {};
  routeOut(layer);

  run.confirmJackOut();
  assert.equal(run.cyberspace?.phase, 'resolved');
  assert.equal(
    (run.cyberspace as { objectiveComplete?: boolean }).objectiveComplete,
    false,
    'early jack-out latches the objective unsatisfiable'
  );
  assert.equal(meatPort(run).burned, true);
});

test('complete objective jacks out immediately — no confirmation requested', () => {
  const run = combatRun();
  const layer = jackIn(run);
  let requests = 0;
  run.onJackOutRequested = () => requests++;

  sliceAllNodes(layer);
  routeOut(layer);
  assert.equal(requests, 0, 'a clean jack-out never asks');
  assert.equal(run.cyberspace?.phase, 'resolved');
  assert.equal((run.cyberspace as { objectiveComplete?: boolean }).objectiveComplete, true);
});

test('confirmJackOut with no jack-out pending throws (dormant and resolved)', () => {
  const run = combatRun();
  assert.equal(run.cyberspace?.phase, 'dormant');
  assert.throws(() => run.confirmJackOut(), /pending/);

  const layer = jackIn(run);
  assert.throws(() => run.confirmJackOut(), /pending/);

  routeOut(layer); // no callback → resolves immediately
  assert.equal(run.cyberspace?.phase, 'resolved');
  assert.throws(() => run.confirmJackOut(), /pending/);
});

test('a pending jack-out confirmation persists as a live layer', () => {
  const run = combatRun();
  const layer = jackIn(run);
  run.onJackOutRequested = () => {};
  routeOut(layer);

  const { run: restored } = restore(structuredClone(snapshot(run)));
  assert.equal(restored.cyberspace?.phase, 'active', 'nothing resolved until the shell confirms');
  assert.equal(meatPort(restored).burned, false);
});

// --- explicit jack-out key (P3.M4 gap closeout) ---------------------------------------

test('explicit jack-out defers for neural shock even after the objective is complete', () => {
  const run = combatRun();
  const layer = jackIn(run);
  sliceAllNodes(layer);
  const body = run.player!;
  const requests: JackOutRequest[] = [];
  run.onJackOutRequested = request => requests.push(request);

  run.requestJackOut();

  assert.equal(run.cyberspace?.phase, 'active', 'link stays live pending confirmation');
  assert.equal(body.hp, body.maxHp, 'shock is not applied before confirmation');
  assert.deepEqual(requests, [
    {
      reason: 'explicit-key',
      objectiveComplete: true,
      shockDamage: JACK_OUT_SHOCK_DAMAGE,
    },
  ]);

  run.confirmJackOut();
  assert.equal(run.cyberspace?.phase, 'resolved');
  assert.equal((run.cyberspace as { objectiveComplete?: boolean }).objectiveComplete, true);
  assert.equal(body.hp, body.maxHp - JACK_OUT_SHOCK_DAMAGE);
  assert.equal(meatPort(run).burned, true);
});

test('explicit jack-out works while controlling the meat partner and fails unfinished objective', () => {
  const run = dualCombatRun();
  jackIn(run);
  assert.equal(run.activeLayer, 'meat', 'dual-deploy jack-in leaves control in Meatspace');
  const body = run.player!;
  run.onJackOutRequested = () => {};

  run.requestJackOut();
  run.confirmJackOut();

  assert.equal(run.cyberspace?.phase, 'resolved');
  assert.equal((run.cyberspace as { objectiveComplete?: boolean }).objectiveComplete, false);
  assert.equal(body.hp, body.maxHp - JACK_OUT_SHOCK_DAMAGE);
  assert.equal(run.activeLayer, 'meat');
  assert.equal(run.meatActor, body);
  assert.equal(body.frozen, false);
  assert.equal(meatPort(run).burned, true);
});

test('confirmed explicit jack-out can flatline a critically wounded Decker', () => {
  const run = combatRun();
  jackIn(run);
  const body = run.player!;
  body.hp = JACK_OUT_SHOCK_DAMAGE - 1;
  let result: unknown = null;
  run.onResult = value => {
    result = value;
  };
  run.onJackOutRequested = () => {};

  run.requestJackOut();
  run.confirmJackOut();

  assert.equal(run.state, 'RESULT');
  assert.equal(body.alive, false);
  assert.equal(body.hp, 0);
  assert.equal(run.cyberspace?.phase, 'resolved', 'link still drops before shock death resolves');
  assert.equal(meatPort(run).burned, true);
  assert.deepEqual(result, {
    outcome: 'death',
    telemetry: {
      ...run.telemetry,
      outcome: 'death',
      hpAtDeath: 0,
      lastDamageSource: 'neural-shock',
      lastAttacker: null,
      hpAtDamage: 0,
      cause: `neural-shock(${JACK_OUT_SHOCK_DAMAGE - 1})`,
    },
  });
});

// --- forced jack-out (P3.M4.6) ---------------------------------------------------------

test('body damage to 1 HP forces jack-out without early-jack-out confirmation', () => {
  const run = dualCombatRun();
  jackIn(run);
  run.flip(); // view Cyberspace, leaving the body in the meat feed.
  const body = run.player!;
  body.hp = 2;
  let requests = 0;
  run.onJackOutRequested = () => requests++;

  damageBody(run, 1);

  assert.equal(requests, 0, 'forced jack-out never asks for early-jack-out confirmation');
  assert.equal(run.cyberspace?.phase, 'resolved');
  assert.equal((run.cyberspace as { objectiveComplete?: boolean }).objectiveComplete, false);
  assert.equal(body.alive, true);
  assert.equal(body.hp, 1);
  assert.equal(body.frozen, false);
  assert.equal(run.activeLayer, 'meat');
  assert.equal(run.meatActor, body);
  assert.equal(meatPort(run).burned, true);
  assert.equal(run.canFlip(), true, 'post-jack-out control can still flip to the living partner');
});

test('lethal body damage while jacked in clamps the Decker alive and round-trips', () => {
  const run = dualCombatRun();
  jackIn(run);
  const body = run.player!;
  body.hp = 1;
  let results = 0;
  run.onResult = () => results++;

  damageBody(run, body.maxHp);

  assert.equal(results, 0, 'forced jack-out is not a run death');
  assert.equal(run.state, 'COMBAT');
  assert.equal(body.alive, true);
  assert.equal(body.hp, 1);
  assert.equal(run.cyberspace?.phase, 'resolved');

  const { run: restored } = restore(structuredClone(snapshot(run)));
  assert.equal(restored.cyberspace?.phase, 'resolved');
  assert.equal((restored.cyberspace as { objectiveComplete?: boolean }).objectiveComplete, false);
  assert.equal(restored.player!.alive, true);
  assert.equal(restored.player!.hp, 1);
  assert.equal(restored.player!.frozen, false);
  assert.equal(restored.meatActor, restored.player);
  assert.equal(meatPort(restored).burned, true);
});

test('forced jack-out after all nodes are sliced preserves the completed objective latch', () => {
  const run = dualCombatRun();
  const layer = jackIn(run);
  sliceAllNodes(layer);
  const body = run.player!;
  body.hp = 1;

  damageBody(run, body.maxHp);

  assert.equal(run.cyberspace?.phase, 'resolved');
  assert.equal((run.cyberspace as { objectiveComplete?: boolean }).objectiveComplete, true);
  assert.equal(body.alive, true);
  assert.equal(body.hp, 1);
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
