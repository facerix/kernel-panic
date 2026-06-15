/**
 * P3.M4.4 — independent AP pools + decoupled turn-end. Each dual-deploy
 * operator keeps its own AP pool; the mutual turn ends (driving the corp +
 * ICE hostile phases) only when *every controllable* operator is spent — not
 * when whichever one you happen to be driving hits 0. Exhausting the active
 * operator while the other still has AP **auto-flips** control to it instead
 * of ending the turn.
 *
 * `Run.endOfTurnReady()` is the model-level "the crew is spent" predicate;
 * `Run.concludeActiveOperatorTurn()` is the decision+handoff the shell wires
 * its auto-end sites to (`'continue' | 'auto-flip' | 'end'`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run } from '../../../../src/game/Run.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { CyberAvatar } from '../../../../src/game/cyber/CyberAvatar.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { Rng } from '../../../../src/rng.js';
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

const meatContract = (overrides = {}) => ({
  seed: 999,
  objective: {
    kind: OBJECTIVES.REACH_EXIT,
    title: 'Extract clean',
    briefing: 'Reach the exit.',
  },
  difficulty: 'standard',
  threatCount: 1,
  label: 'meat job',
  context: testContractContext(OBJECTIVES.REACH_EXIT),
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
function meatRun(seed = 999) {
  const run = new Run({ crewMember: makeMerc(), seed });
  run.enterBriefing(meatContract({ seed }));
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
  const point = [...run.world!.entities.values()].find(e => e instanceof JackInPoint) as JackInPoint;
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  assert.equal(point.interact(run.world!, run.player!).ok, true);
}

const drain = (a: { ap: number; spendAp(n: number): void }) => a.spendAp(a.ap);

// ---------------------------------------------------------------------------
// endOfTurnReady — the "crew is spent" predicate
// ---------------------------------------------------------------------------

test('P3.M4.4: not end-ready while the active operator still has AP', () => {
  const run = dualRun();
  jackIn(run);
  assert.ok(run.activeActor!.ap > 0);
  assert.equal(run.endOfTurnReady(), false);
});

test('P3.M4.4: not end-ready when the active operator is spent but the other still has AP', () => {
  const run = dualRun();
  jackIn(run);
  // Control starts on the meat partner; spend it dry, avatar still full.
  drain(run.activeActor!);
  assert.equal(run.activeActor!.ap, 0);
  assert.ok(run.cyberspace!.phase === 'active' && run.cyberspace.layer.avatar.ap > 0);
  assert.equal(run.endOfTurnReady(), false);
});

test('P3.M4.4: end-ready only once both controllable operators are spent', () => {
  const run = dualRun();
  jackIn(run);
  const avatar = run.cyberspace!.phase === 'active' ? run.cyberspace.layer.avatar : null;
  drain(run.meatActor!);
  drain(avatar!);
  assert.equal(run.endOfTurnReady(), true);
});

// ---------------------------------------------------------------------------
// concludeActiveOperatorTurn — continue / auto-flip / end
// ---------------------------------------------------------------------------

test('P3.M4.4: concluding with AP left is a no-op continue', () => {
  const run = dualRun();
  jackIn(run);
  const before = run.activeActor;
  assert.equal(run.concludeActiveOperatorTurn(), 'continue');
  assert.equal(run.activeActor, before, 'control did not move');
});

test('P3.M4.4: exhausting one operator auto-flips control to the other (no turn end, no refresh)', () => {
  const run = dualRun();
  jackIn(run);
  const partner = run.meatActor!;
  const avatar = run.cyberspace!.phase === 'active' ? run.cyberspace.layer.avatar : null;
  assert.ok(avatar instanceof CyberAvatar);
  const turnBefore = run.queue!.turnNumber;

  drain(partner);
  assert.equal(run.concludeActiveOperatorTurn(), 'auto-flip');

  // Control handed to the avatar; the partner's spent pool was NOT refreshed,
  // and no corp/ICE turn advanced (the queue did not flip factions).
  assert.equal(run.activeLayer, 'cyber');
  assert.equal(run.activeActor, avatar);
  assert.equal(partner.ap, 0, 'spent partner pool untouched — no early refresh');
  assert.equal(avatar!.ap, avatar!.maxAp, 'avatar keeps its full, independent pool');
  assert.equal(run.queue!.turnNumber, turnBefore, 'mutual turn did not advance');
});

test('P3.M4.4: exhausting the second operator ends the mutual turn', () => {
  const run = dualRun();
  jackIn(run);
  const avatar = run.cyberspace!.phase === 'active' ? run.cyberspace.layer.avatar : null;

  drain(run.meatActor!);
  assert.equal(run.concludeActiveOperatorTurn(), 'auto-flip'); // → cyber
  drain(avatar!);
  assert.equal(run.concludeActiveOperatorTurn(), 'end');
});

// ---------------------------------------------------------------------------
// Wait (passActiveOperatorTurn) — always flips to the other operator
// ---------------------------------------------------------------------------

test('P3.M4.4: waiting with the other operator holding AP flips and keeps the turn open', () => {
  const run = dualRun();
  jackIn(run);
  const avatar = run.cyberspace!.phase === 'active' ? run.cyberspace.layer.avatar : null;
  drain(run.activeActor!); // Wait forfeits the partner's AP
  assert.equal(run.passActiveOperatorTurn(), 'flip');
  assert.equal(run.activeLayer, 'cyber');
  assert.equal(run.activeActor, avatar);
});

test('P3.M4.4: waiting the LAST operator still flips, then ends the mutual turn', () => {
  // The behaviour the playtest flagged: Wait must hand off consistently, even
  // when the other operator is already spent (it just also ends the turn).
  const run = dualRun();
  jackIn(run);
  const partner = run.meatActor!;
  const avatar = run.cyberspace!.phase === 'active' ? run.cyberspace.layer.avatar : null;
  // Both operators spent; control sits on the avatar (cyber).
  drain(partner);
  run.flip();
  assert.equal(run.activeActor, avatar);
  drain(avatar!);

  assert.equal(run.passActiveOperatorTurn(), 'flip-and-end');
  assert.equal(run.activeLayer, 'meat', 'Wait still flips control to the partner');
  assert.equal(run.activeActor, partner);
});

test('P3.M4.4: a solo jack-in Wait just ends — nobody to flip to', () => {
  const run = soloRun();
  jackIn(run);
  drain(run.activeActor!);
  assert.equal(run.passActiveOperatorTurn(), 'end');
  assert.equal(run.activeLayer, 'cyber', 'no flip — control stays on the lone avatar');
});

test('P3.M4.4: single-deploy Wait ends without flipping', () => {
  const run = meatRun();
  drain(run.activeActor!);
  assert.equal(run.passActiveOperatorTurn(), 'end');
});

// ---------------------------------------------------------------------------
// Auto-flip never targets the frozen body or a dead operator
// ---------------------------------------------------------------------------

test('P3.M4.4: a solo jack-in ends the turn at 0 AP — never flips to the frozen body', () => {
  const run = soloRun();
  jackIn(run);
  // Solo: only the avatar is controllable; the body is frozen at the port.
  assert.equal(run.activeLayer, 'cyber');
  drain(run.activeActor!);
  assert.equal(run.endOfTurnReady(), true);
  assert.equal(run.concludeActiveOperatorTurn(), 'end');
});

test('P3.M4.4: a dead partner is not a flip target — exhausting the avatar ends the turn', () => {
  const run = dualRun();
  jackIn(run);
  const partner = run.meatActor!;
  const avatar = run.cyberspace!.phase === 'active' ? run.cyberspace.layer.avatar : null;
  // Avatar takes control, partner falls on the meat field.
  run.flip();
  assert.equal(run.activeActor, avatar);
  partner.damage(partner.hp); // flatline the partner
  assert.equal(partner.alive, false);

  drain(avatar!);
  assert.equal(run.endOfTurnReady(), true, 'no living second operator to flip to');
  assert.equal(run.concludeActiveOperatorTurn(), 'end');
});

// ---------------------------------------------------------------------------
// Single-deploy (no cyber layer) — unchanged: end at 0
// ---------------------------------------------------------------------------

test('P3.M4.4: single-deploy meat run ends the turn when its one operator is spent', () => {
  const run = meatRun();
  assert.equal(run.canFlip(), false);
  drain(run.activeActor!);
  assert.equal(run.endOfTurnReady(), true);
  assert.equal(run.concludeActiveOperatorTurn(), 'end');
});

// ---------------------------------------------------------------------------
// Post jack-out: meat ↔ meat auto-flip between the two operators
// ---------------------------------------------------------------------------

test('P3.M4.4: after jack-out, exhausting one meat operator auto-flips to the other', () => {
  const run = dualRun();
  const decker = run.player!;
  const partner = run.partnerMember!;
  jackIn(run);
  run.jackOut(); // no hook → resolves immediately

  assert.equal(run.meatActor, decker);
  drain(run.activeActor!); // drain the Decker
  assert.equal(run.concludeActiveOperatorTurn(), 'auto-flip');
  assert.equal(run.meatActor, partner, 'control flipped to the partner');
  assert.equal(decker.ap, 0, 'no early refresh of the spent operator');

  drain(run.activeActor!); // drain the partner
  assert.equal(run.concludeActiveOperatorTurn(), 'end');
});
