/**
 * P3.1 regression — consumable targeting on a dual-deploy.
 *
 * Consumables must act through whichever operator currently has control:
 * the Decker before jack-in, the partner while jacked in (the body freezes at
 * the port), and whichever crewmate is flipped-to after jack-out. The shell
 * resolves that through `activeActorOf` / `run.activeActor`. The original bug
 * routed `useConsumable` through `run.player`, so once a partner was in control
 * a STIM healed the full-HP frozen Decker (reporting "healed 0 HP") while the
 * wounded partner stayed hurt.
 *
 * The shell wiring itself (shellRuntime) is DOM-coupled and not unit-testable,
 * so this pins the model-level contract it now depends on: `run.activeActor`
 * is the operator in control, distinct from `run.player` (the frozen body).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run } from '../../../../src/game/Run.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { ITEM_ID } from '../../../../src/game/items.js';
import { STIM_HEAL } from '../../../../src/game/constants.js';
import { activeActorOf } from '../../../../src/shell/activeView.js';
import { Rng } from '../../../../src/rng.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';
import type { Crew } from '../../../../src/game/Crew.js';

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

function jackInPoint(run: Run): JackInPoint {
  const point = [...run.world!.entities.values()].find(e => e instanceof JackInPoint);
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

function jackIn(run: Run) {
  const point = jackInPoint(run);
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  const result = point.interact(run.world!, run.player!);
  assert.equal(result.ok, true, `link failed: ${result.message}`);
  assert.equal(run.cyberspace?.phase, 'active');
}

test('P3.1: before jack-in the active operator is the Decker', () => {
  const run = dualRun();
  // No jack-in yet — the Decker is the controllable operator and the
  // consumable target, exactly as the user expects on a fresh cyber run.
  assert.equal(activeActorOf(run), run.player, 'pre-jack-in target is the Decker');
});

test('P3.1: STIM heals the in-control partner, not the frozen Decker body', () => {
  const run = dualRun();
  const body = run.player! as Crew;
  jackIn(run);

  const partner = run.partnerMember! as Crew;
  // Wound the partner; leave the Decker body at full HP (the original bug's
  // tell: the body soaked the heal and reported "healed 0 HP").
  partner.hp = Math.max(1, partner.maxHp - STIM_HEAL);
  body.hp = body.maxHp;
  partner.refreshAp();

  // The shell resolves the consumable target through `activeActorOf`. The
  // inventory overlay is gated to Meatspace, so control sits with the partner.
  const target = activeActorOf(run) as Crew;
  assert.equal(target, partner, 'consumable target is the in-control partner');
  assert.notEqual(target, run.player, 'consumable target is NOT the frozen Decker body');

  target.addConsumable(ITEM_ID.STIM);
  const before = partner.hp;
  const result = target.useConsumable(ITEM_ID.STIM);

  assert.equal(result.type, 'stim');
  assert.equal((result as { healed: number }).healed, STIM_HEAL, 'STIM healed the partner');
  assert.equal(partner.hp, before + STIM_HEAL);
  assert.equal(body.hp, body.maxHp, 'the frozen Decker body was untouched');
});

test('P3.1: after jack-out the consumable target follows the flip between crewmates', () => {
  const run = dualRun();
  const body = run.player! as Crew;
  jackIn(run);
  // No onJackOutRequested hook → the jack-out resolves immediately; control
  // returns to the Decker body and both crewmates share the meat grid.
  run.jackOut();
  assert.equal(run.cyberspace?.phase, 'resolved');

  const partner = run.partnerMember! as Crew;
  assert.equal(activeActorOf(run), body, 'post-jack-out control returns to the Decker');

  // The simstim flip toggles control to the partner — the consumable target
  // must follow, not stay pinned to `run.player`.
  assert.equal(run.canFlip(), true, 'two live meat operators can be flipped between');
  run.flip();
  assert.equal(activeActorOf(run), partner, 'after the flip the partner is the target');
  assert.notEqual(activeActorOf(run), body, 'control moved off the Decker');
});
