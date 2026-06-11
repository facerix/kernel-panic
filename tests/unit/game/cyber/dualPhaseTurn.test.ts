/**
 * P3.M3.6 — the dual-phase corp turn: while the Decker is jacked in, the
 * shell chains two `corpTurnDriver` passes per corp slice — meat hostiles
 * on the meat world, then ICE on the cyber world. One shared TurnQueue
 * gives each side exactly one AP refresh per round; the shared run rng in
 * fixed pass order keeps the whole thing deterministic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run } from '../../../../src/game/Run.js';
import { CyberspaceLayer } from '../../../../src/game/cyber/CyberspaceLayer.js';
import { ProbeIce } from '../../../../src/game/cyber/ProbeIce.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { runCorpTurn } from '../../../../src/game/corpTurnDriver.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { FACTION } from '../../../../src/game/constants.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { Rng } from '../../../../src/rng.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';
import type { TurnActionStep } from '../../../../src/types.js';

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

function jackedInRun(seed = 12345): { run: Run; layer: CyberspaceLayer } {
  const decker = buildCrewMember('decker', { x: 0, y: 0 }, new Rng(100), { id: 'crew-decker' });
  const run = new Run({ crewMember: decker, seed });
  run.enterBriefing(cyberContract(seed));
  run.enterCombat();
  const point = Array.from(run.world!.entities.values()).find(
    e => e instanceof JackInPoint
  ) as JackInPoint;
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  assert.equal(point.interact(run.world!, run.player!).ok, true);
  const layer = (run.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
  return { run, layer };
}

type StepLog = { id: string; type: string }[];

/** Drive one corp pass synchronously and collect the committed steps. */
function drivePass(run: Run, world: World, faction: string): StepLog {
  const log: StepLog = [];
  let finished = false;
  runCorpTurn({
    run: { state: run.state ?? '', world, rng: run.rng },
    corpFaction: faction,
    paint: () => {},
    animLock: { push: () => {} },
    actionDelayMs: 0,
    lockMarginMs: 0,
    schedule: (fn: () => void) => fn(),
    shouldAnimateStep: () => false,
    onStep: (id: string, step: TurnActionStep) => log.push({ id, type: step.type }),
    onFinish: () => {
      finished = true;
    },
  });
  assert.equal(finished, true, 'synchronous pass drains to onFinish');
  return log;
}

/** One full dual-phase corp slice, the way the shell chains it. */
function dualPhaseRound(run: Run, layer: CyberspaceLayer): { meat: StepLog; ice: StepLog } {
  run.queue!.endTurn(run.world!); // player → corp (refreshes both corp sides)
  const meat = drivePass(run, run.world!, run.hostileFaction);
  const ice = drivePass(run, layer.world, FACTION.CORP);
  run.queue!.endTurn(run.world!); // corp → player (refreshes both player sides)
  return { meat, ice };
}

function probeIds(layer: CyberspaceLayer): Set<string> {
  return new Set(
    Array.from(layer.world.entities.values())
      .filter(e => e instanceof ProbeIce)
      .map(e => e.id)
  );
}

// --- isolation -----------------------------------------------------------------------

test('the meat pass steps only meat hostiles; the ICE pass only probes', () => {
  const { run, layer } = jackedInRun();
  const probes = probeIds(layer);
  const { meat, ice } = dualPhaseRound(run, layer);

  for (const { id } of meat) {
    assert.ok(!probes.has(id), `meat pass must not step ICE (stepped ${id})`);
  }
  assert.ok(ice.length > 0, 'probes patrol their rings');
  for (const { id } of ice) {
    assert.ok(probes.has(id), `ICE pass stepped a non-probe (${id})`);
  }
});

// --- AP cadence ------------------------------------------------------------------------

test('one AP refresh per side per round, on the single shared queue', () => {
  const { run, layer } = jackedInRun();
  layer.avatar.spendAp(2);
  run.player!.spendAp(run.player!.ap);

  run.queue!.endTurn(run.world!); // player → corp
  // Corp-side refresh hit both worlds; player sides stay spent.
  assert.equal(layer.avatar.ap, layer.avatar.maxAp - 2);
  assert.equal(run.player!.ap, 0);

  drivePass(run, run.world!, run.hostileFaction);
  drivePass(run, layer.world, FACTION.CORP);
  const probesSpent = Array.from(layer.world.entities.values()).filter(
    e => e instanceof ProbeIce && e.ap < e.maxAp
  );
  assert.ok(probesSpent.length > 0, 'patrolling probes spent AP during the ICE pass');

  run.queue!.endTurn(run.world!); // corp → player
  assert.equal(layer.avatar.ap, layer.avatar.maxAp, 'avatar refreshed');
  assert.equal(run.player!.ap, run.player!.maxAp, 'meat body refreshed on the same flip');
  for (const probe of probesSpent) {
    assert.ok(probe.ap < probe.maxAp, 'probes stay spent until the next corp flip');
  }
});

// --- determinism -------------------------------------------------------------------------

test('the dual-phase sequence is deterministic per contract seed', () => {
  const a = jackedInRun(777);
  const b = jackedInRun(777);
  const roundA = dualPhaseRound(a.run, a.layer);
  const roundB = dualPhaseRound(b.run, b.layer);
  assert.deepEqual(roundA, roundB);

  const c = jackedInRun(778);
  const roundC = dualPhaseRound(c.run, c.layer);
  assert.notDeepEqual(roundA, roundC);
});

// --- engagement through the pass --------------------------------------------------------

test('an ICE pass with the avatar in sight yields the trace flare', () => {
  const { run, layer } = jackedInRun();
  const probe = Array.from(layer.world.entities.values()).find(
    e => e instanceof ProbeIce
  ) as ProbeIce;
  const spot = adjacentFreeTile(layer.world, layer.avatar);
  layer.world.relocateEntity(probe, spot.x, spot.y);

  run.queue!.endTurn(run.world!);
  drivePass(run, run.world!, run.hostileFaction);
  const ice = drivePass(run, layer.world, FACTION.CORP);
  assert.ok(
    ice.some(s => s.id === probe.id && s.type === 'trace-alarm'),
    'the adjacent probe flared a trace during its pass'
  );
  assert.equal(layer.world.alarmActive, true);
});
