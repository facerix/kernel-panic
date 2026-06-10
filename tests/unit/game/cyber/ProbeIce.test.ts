/**
 * P3.M3.5 — Probe ICE: the first hostile on the cyber grid.
 *
 * A weak melee patroller on the node rings. Its identity: on acquiring the
 * avatar it raises the *cyber* alarm (trace flare — no rep penalty, no meat
 * coupling) so the pack converges, then strikes. Avatar death routes through
 * the existing DEATH/flatline path via the real combat pipeline; ICE
 * resistance mitigates with the min-1 rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME } from '../../../../src/game/Run.js';
import { CyberspaceLayer } from '../../../../src/game/cyber/CyberspaceLayer.js';
import { ProbeIce } from '../../../../src/game/cyber/ProbeIce.js';
import { PATROL_STATE } from '../../../../src/game/ai/PatrolHostile.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { resolveMelee } from '../../../../src/game/Combat.js';
import { EVENT } from '../../../../src/game/events.js';
import { snapshot, restore } from '../../../../src/game/persistence.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { Decker } from '../../../../src/game/archetypes/Decker.js';
import { FACTION } from '../../../../src/game/constants.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { Rng } from '../../../../src/rng.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';
import type { RunResult } from '../../../../src/game/Run.js';

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

function buildLayer(contractSeed = 12345) {
  return CyberspaceLayer.build({
    contractSeed,
    difficulty: 'standard',
    decker: new Decker({ id: 'crew-decker', x: 0, y: 0 }),
    nodeCount: 1,
  });
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

function combatRun(seed = 12345, hooks: { onResult?: (r: RunResult) => void } = {}) {
  const run = new Run({ crewMember: makeDecker(), seed, ...hooks });
  run.enterBriefing(cyberContract(seed));
  run.enterCombat();
  return run;
}

function jackIn(run: Run): CyberspaceLayer {
  const point = Array.from(run.world!.entities.values()).find(
    e => e instanceof JackInPoint
  ) as JackInPoint;
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  assert.equal(point.interact(run.world!, run.player!).ok, true);
  return (run.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
}

function probesOf(layer: CyberspaceLayer): ProbeIce[] {
  return Array.from(layer.world.entities.values()).filter(
    (e): e is ProbeIce => e instanceof ProbeIce
  );
}

function probeKey(p: ProbeIce) {
  return { id: p.id, x: p.x, y: p.y, waypoints: p.patrolWaypoints };
}

// --- spawning -------------------------------------------------------------------------

test('build spawns one probe per patrol ring with explicit ICE stats', () => {
  const layer = buildLayer();
  const probes = probesOf(layer);
  assert.equal(probes.length, layer.patrolRings.length);
  assert.ok(probes.length > 0, 'standard difficulty patrols at least one ring');
  const ids = new Set(probes.map(p => p.id));
  assert.equal(ids.size, probes.length, 'probe ids are unique');
  for (const probe of probes) {
    assert.equal(probe.glyph, '¶');
    assert.equal(probe.displayName, 'Probe');
    assert.equal(probe.maxHp, 3);
    assert.equal(probe.sightRange, 6);
    assert.equal(probe.meleeDamage, 1);
    assert.equal(probe.faction, FACTION.CORP);
    assert.ok(probe.patrolWaypoints.length > 0, 'probe walks a ring');
    assert.ok(
      probe.patrolWaypoints.some(wp => wp.x === probe.x && wp.y === probe.y),
      'probe spawns on its own ring'
    );
    assert.ok(layer.world.grid.isPassable(probe.x, probe.y));
  }
});

test('probe spawns are deterministic on the contract seed', () => {
  const a = probesOf(buildLayer(909)).map(probeKey);
  const b = probesOf(buildLayer(909)).map(probeKey);
  assert.deepEqual(a, b);
  const c = probesOf(buildLayer(910)).map(probeKey);
  assert.notDeepEqual(a, c, 'a different seed diverges');
});

// --- combat ---------------------------------------------------------------------------

test('probe damage is mitigated by ICE resistance with the min-1 rule', () => {
  const layer = buildLayer();
  const avatar = layer.avatar; // RAM 8, iceResistance 1
  const probe = probesOf(layer)[0];
  const spot = adjacentFreeTile(layer.world, avatar);
  layer.world.relocateEntity(probe, spot.x, spot.y);
  probe.refreshAp();

  const result = resolveMelee(layer.world, probe, avatar, new Rng(1), { dodgeChance: 0 });
  assert.equal(result.hit, true);
  assert.equal(result.damage, 1, 'dmg 1 vs resist 1 still chips the minimum 1');
  assert.equal(avatar.hp, avatar.maxHp - 1);
});

test('acquisition raises the cyber alarm and converges the pack', () => {
  const layer = buildLayer();
  const avatar = layer.avatar;
  const probes = probesOf(layer);
  const hunter = probes[0];
  const distant = probes[probes.length - 1];
  assert.notEqual(hunter, distant);

  const spot = adjacentFreeTile(layer.world, avatar);
  layer.world.relocateEntity(hunter, spot.x, spot.y);
  hunter.refreshAp();
  assert.equal(distant.state, PATROL_STATE.PATROL);

  const steps = hunter.takeTurn(layer.world, new Rng(7));
  assert.equal(layer.world.alarmActive, true, 'trace flare trips the cyber alarm');
  assert.ok(
    steps.some(s => s.type === 'trace-alarm'),
    'turn log carries the trace step'
  );
  assert.ok(
    steps.some(s => s.type === 'melee'),
    'the probe strikes after flaring'
  );
  // The far probe heard the flare (alarm bus) and converges on the avatar.
  assert.equal(distant.state, PATROL_STATE.ENGAGE);
  assert.deepEqual(distant.lastKnownTarget, { x: avatar.x, y: avatar.y });
});

test('the cyber alarm never couples to Meatspace', () => {
  const run = combatRun();
  const layer = jackIn(run);
  let meatAlarmEvents = 0;
  run.bus!.on(EVENT.ALARM, () => meatAlarmEvents++);

  layer.world.raiseAlarm({ target: layer.avatar, repPenalty: false });
  assert.equal(layer.world.alarmActive, true);
  assert.equal(run.world!.alarmActive, false, 'meat alarm latch untouched');
  assert.equal(meatAlarmEvents, 0, 'no ALARM event leaks onto the meat bus');
});

test('the cyber alarm cadence ticks on meat round advances', () => {
  const run = combatRun();
  const layer = jackIn(run);
  layer.world.raiseAlarm({ target: layer.avatar, repPenalty: false });
  const before = layer.world.snapshotAlarm();

  run.queue!.endTurn(run.world!); // player → corp
  run.queue!.endTurn(run.world!); // corp → player: round advance ticks the cyber alarm
  const after = layer.world.snapshotAlarm();
  assert.equal(after.holdTurnsRemaining, before.holdTurnsRemaining - 1);
});

// --- death paths ------------------------------------------------------------------------

test('a probe killing the avatar flatlines through the real combat pipeline', () => {
  const results: RunResult[] = [];
  const run = combatRun(12345, { onResult: r => results.push(r) });
  const layer = jackIn(run);
  const avatar = layer.avatar;
  avatar.damage(avatar.hp - 1); // one strike from death

  const probe = probesOf(layer)[0];
  const spot = adjacentFreeTile(layer.world, avatar);
  layer.world.relocateEntity(probe, spot.x, spot.y);
  probe.refreshAp();
  const result = resolveMelee(layer.world, probe, avatar, new Rng(1), { dodgeChance: 0 });
  assert.equal(result.killed, true);

  assert.equal(run.state, RUN_STATE.RESULT);
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, OUTCOME.DEATH);
  assert.match(String(results[0].telemetry.cause), new RegExp(probe.id));
});

test('the avatar killing a probe counts toward run telemetry', () => {
  const run = combatRun();
  const layer = jackIn(run);
  const probe = probesOf(layer)[0];
  const spot = adjacentFreeTile(layer.world, probe);
  layer.world.relocateEntity(layer.avatar, spot.x, spot.y);
  layer.avatar.refreshAp();
  const before = run.telemetry.kills ?? 0;

  const result = resolveMelee(layer.world, layer.avatar, probe, new Rng(1), {
    dodgeChance: 0,
    damage: probe.hp,
  });
  assert.equal(result.killed, true);
  assert.equal(probe.alive, false);
  assert.equal(run.telemetry.kills, before + 1);
});

// --- persistence --------------------------------------------------------------------------

test('probe patrol state round-trips and restored probes are re-bound', () => {
  const run = combatRun();
  const layer = jackIn(run);
  const probe = probesOf(layer)[0];
  // Dirty the state machine: mid-pursuit, off-ring, chipped.
  const spot = adjacentFreeTile(layer.world, layer.avatar);
  layer.world.relocateEntity(probe, spot.x, spot.y);
  probe.state = PATROL_STATE.ENGAGE;
  probe.lastKnownTarget = { x: layer.avatar.x, y: layer.avatar.y };
  probe.patrolIndex = 1 % probe.patrolWaypoints.length;
  probe.damage(1);

  const { run: restored } = restore(structuredClone(snapshot(run)));
  const restoredLayer = (restored.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
  const twin = probesOf(restoredLayer).find(p => p.id === probe.id);
  assert.ok(twin instanceof ProbeIce);
  assert.deepEqual(
    { x: twin!.x, y: twin!.y, state: twin!.state, idx: twin!.patrolIndex, hp: twin!.hp },
    { x: probe.x, y: probe.y, state: probe.state, idx: probe.patrolIndex, hp: probe.hp }
  );
  assert.deepEqual(twin!.lastKnownTarget, probe.lastKnownTarget);
  assert.deepEqual(twin!.patrolWaypoints, probe.patrolWaypoints);

  // Re-binding: a fresh cyber alarm drags a still-patrolling probe to ENGAGE.
  const patroller = probesOf(restoredLayer).find(p => p.state === PATROL_STATE.PATROL);
  assert.ok(patroller, 'another probe is still on its ring');
  restoredLayer.world.raiseAlarm({ target: restoredLayer.avatar, repPenalty: false });
  assert.equal(patroller!.state, PATROL_STATE.ENGAGE);
});
