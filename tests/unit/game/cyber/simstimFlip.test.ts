/**
 * P3.M4.3 — the simstim flip. Tab swaps active control between the Meatspace
 * operator and the Decker's Cyberspace avatar (and, post-jack-out, between the
 * two meat operators). The flip is a free action; the active view/actor follow
 * `activeLayer`, which the flip toggles.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run } from '../../../../src/game/Run.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { CyberAvatar } from '../../../../src/game/cyber/CyberAvatar.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { Rng } from '../../../../src/rng.js';
import { dispatch, MODE } from '../../../../src/input/keymap.js';
import {
  activeActorOf,
  activeTileset,
  activeWorldOf,
  isCyberView,
  isJackedIn,
} from '../../../../src/shell/activeView.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';

const cyberContract = (overrides = {}) => ({
  seed: 12345,
  objective: {
    kind: OBJECTIVES.DATA_NODE_SLICE,
    title: 'Spike the server farm',
    briefing: 'Jack in, slice the data node, then extract.',
    params: { requiresCyberspace: true, count: 1 },
  },
  difficulty: 'standard',
  threatCount: 1,
  label: 'cyber casing job',
  context: testContractContext(OBJECTIVES.DATA_NODE_SLICE),
  reward: { credits: 0, repDelta: 0 },
  ...overrides,
});

const makeDecker = () =>
  buildCrewMember('decker', { x: 0, y: 0 }, new Rng(100), { id: 'crew-decker' });
const makeMerc = () => buildCrewMember('merc', { x: 0, y: 0 }, new Rng(101), { id: 'crew-merc' });

function dualRun(seed = 12345) {
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed });
  run.enterBriefing(cyberContract({ seed }));
  run.enterCombat();
  return run;
}
function soloRun(seed = 12345) {
  const run = new Run({ crewMember: makeDecker(), seed });
  run.enterBriefing(cyberContract({ seed }));
  run.enterCombat();
  return run;
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

function jackIn(run: Run) {
  const point = [...run.world!.entities.values()].find(
    e => e instanceof JackInPoint
  ) as JackInPoint;
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  assert.equal(point.interact(run.world!, run.player!).ok, true);
}

// ---------------------------------------------------------------------------
// Keymap binding
// ---------------------------------------------------------------------------

test('P3.M4.3: Tab dispatches a flip intent in IDLE', () => {
  const r = dispatch('Tab', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'flip' });
  assert.equal(r.nextMode, MODE.IDLE);
});

// ---------------------------------------------------------------------------
// Flip while jacked in (dual deploy)
// ---------------------------------------------------------------------------

test('P3.M4.3: flip swaps meat partner ↔ cyber avatar while jacked in', () => {
  const run = dualRun();
  jackIn(run);
  const partner = run.partnerMember!;

  // Control starts in Meatspace on the partner.
  assert.equal(run.canFlip(), true);
  assert.equal(run.activeLayer, 'meat');
  assert.equal(run.activeActor, partner);
  assert.equal(activeActorOf(run), partner);
  assert.equal(isCyberView(run), false);
  assert.equal(activeTileset(run), 'meat');

  // Flip into Cyberspace.
  run.flip();
  assert.equal(run.activeLayer, 'cyber');
  assert.ok(run.activeActor instanceof CyberAvatar);
  assert.ok(activeActorOf(run) instanceof CyberAvatar);
  assert.equal(isCyberView(run), true);
  assert.equal(isJackedIn(run), true);
  assert.equal(activeTileset(run), 'cyber');
  assert.equal(
    activeWorldOf(run),
    run.cyberspace!.phase === 'active' && run.cyberspace.layer.world
  );

  // Flip back to Meatspace.
  run.flip();
  assert.equal(run.activeLayer, 'meat');
  assert.equal(run.activeActor, partner);
  assert.equal(isCyberView(run), false);
});

test('P3.M4.3: the frozen body is never the flip target while jacked', () => {
  const run = dualRun();
  jackIn(run);
  // Flip to cyber and back; the meat side is always the partner, never the body.
  run.flip();
  run.flip();
  assert.equal(run.activeActor, run.partnerMember);
  assert.notEqual(run.activeActor, run.deckerBody);
});

// ---------------------------------------------------------------------------
// Solo jack-in cannot flip (no controllable meat operator)
// ---------------------------------------------------------------------------

test('P3.M4.3: a solo jack-in cannot flip — only the frozen body is in Meatspace', () => {
  const run = soloRun();
  jackIn(run);
  assert.equal(run.activeLayer, 'cyber');
  assert.equal(run.canFlip(), false);
  assert.throws(() => run.flip(), /no second operator/);
});

// ---------------------------------------------------------------------------
// Pre-jack and non-cyber runs cannot flip
// ---------------------------------------------------------------------------

test('P3.M4.3: pre-jack-in there is nothing to flip to', () => {
  const run = dualRun();
  assert.equal(run.canFlip(), false);
  assert.throws(() => run.flip(), /no second operator/);
});

// ---------------------------------------------------------------------------
// Post-jack-out: meat ↔ meat flip between the two operators
// ---------------------------------------------------------------------------

test('P3.M4.3: after jack-out the flip cycles the two meat operators', () => {
  const run = dualRun();
  const decker = run.player!;
  const partner = run.partnerMember!;
  jackIn(run);
  run.jackOut(); // no hook → resolves immediately even though incomplete

  // Back in Meatspace controlling the Decker; the partner is the alternate.
  assert.equal(run.activeLayer, 'meat');
  assert.equal(run.meatActor, decker);
  assert.equal(run.canFlip(), true);

  run.flip();
  assert.equal(run.meatActor, partner);
  assert.equal(run.activeActor, partner);

  run.flip();
  assert.equal(run.meatActor, decker);
});
