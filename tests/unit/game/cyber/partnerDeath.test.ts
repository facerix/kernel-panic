/**
 * P3.M4.4 — partner death. The meat partner can be killed by the corp on the
 * meat grid — including off-screen while the player is jacked into Cyberspace
 * (the exact playtest report). Partner death is *not* run-ending (the Decker
 * fights on), but it must: flatline the partner for good at job end, never
 * leave the player driving a corpse, and alert the shell unconditionally.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME } from '../../../../src/game/Run.js';
import { Campaign } from '../../../../src/game/Campaign.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { CyberAvatar } from '../../../../src/game/cyber/CyberAvatar.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { OBJECTIVES, type Contract } from '../../../../src/game/hub/Curator.js';
import { EVENT } from '../../../../src/game/events.js';
import { FACTION } from '../../../../src/game/constants.js';
import { Rng } from '../../../../src/rng.js';
import {
  snapshot,
  restore,
  snapshotCampaign,
  restoreCampaign,
} from '../../../../src/game/persistence.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';
import type { Crew } from '../../../../src/game/Crew.js';

const cyberContract = (overrides: Partial<Contract> = {}): Contract => ({
  seed: 12345,
  mapWidth: 24,
  mapHeight: 16,
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

function dualRun(opts: { onPartnerDown?: (p: Crew) => void } = {}) {
  const run = new Run({
    crewMember: makeDecker(),
    partnerMember: makeMerc(),
    seed: 12345,
    ...opts,
  });
  run.enterBriefing(cyberContract());
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

/** Flatline the partner the way the corp does — kill it, then fire the same
 *  ENTITY_DAMAGED the Combat resolver emits, so `Run` sees a real death. */
function flatlinePartner(run: Run) {
  const partner = run.partnerMember!;
  const attacker = [...run.world!.entities.values()].find(e => e.faction === FACTION.CORP) ?? null;
  partner.damage(partner.hp);
  run.bus!.emit(EVENT.ENTITY_DAMAGED, {
    attacker,
    target: partner,
    damage: 5,
    killed: true,
    source: 'ranged',
  });
}

// ---------------------------------------------------------------------------
// The run survives; the partner is down
// ---------------------------------------------------------------------------

test('P3.M4.4: partner death does not end the run', () => {
  const run = dualRun();
  jackIn(run);
  flatlinePartner(run);
  assert.equal(run.state, RUN_STATE.COMBAT, 'the Decker fights on');
  assert.equal(run.partnerMember!.alive, false);
  assert.equal(run.partnerDown, true);
});

// ---------------------------------------------------------------------------
// Never leaves the player driving a corpse
// ---------------------------------------------------------------------------

test('P3.M4.4: partner death while viewing Cyberspace leaves control on the avatar', () => {
  const run = dualRun();
  jackIn(run);
  run.flip(); // view cyber
  assert.equal(run.activeLayer, 'cyber');
  flatlinePartner(run);
  // Control still rides the avatar; the dead partner is no longer the meat actor.
  assert.ok(run.activeActor instanceof CyberAvatar);
  assert.notEqual(run.meatActor, run.partnerMember);
  assert.equal(run.canFlip(), false, 'no live meat operator to flip to');
});

test('P3.M4.4: partner death while viewing Meatspace force-flips to the avatar', () => {
  const run = dualRun();
  jackIn(run);
  // Control is in Meatspace on the partner (the post-jack-in default).
  assert.equal(run.activeLayer, 'meat');
  assert.equal(run.activeActor, run.partnerMember);
  flatlinePartner(run);
  // The player must not be left driving the corpse — view snaps to Cyberspace.
  assert.equal(run.activeLayer, 'cyber');
  assert.ok(run.activeActor instanceof CyberAvatar);
});

test('P3.M4.4: after jack-out, partner death hands meat control back to the Decker', () => {
  const run = dualRun();
  const decker = run.player!;
  jackIn(run);
  run.jackOut(); // resolved; both meat crew on the grid, control on the Decker
  run.flip(); // control to the partner
  assert.equal(run.meatActor, run.partnerMember);
  flatlinePartner(run);
  assert.equal(run.meatActor, decker, 'control returns to the Decker');
  assert.equal(run.activeActor, decker);
  assert.equal(run.canFlip(), false, 'the partner is gone — nothing to flip to');
});

// ---------------------------------------------------------------------------
// Shell alert hook fires (even off-screen)
// ---------------------------------------------------------------------------

test('P3.M4.4: the onPartnerDown hook fires with the flatlined partner', () => {
  const downed: Crew[] = [];
  const run = dualRun({ onPartnerDown: p => downed.push(p) });
  jackIn(run);
  const partner = run.partnerMember!;
  flatlinePartner(run);
  assert.deepEqual(downed, [partner]);
});

// ---------------------------------------------------------------------------
// Restore never strands control on a dead partner
// ---------------------------------------------------------------------------

test('P3.M4.4: restoring a jacked-in run whose partner died defaults control to the avatar', () => {
  const run = dualRun();
  jackIn(run);
  const partner = run.partnerMember!;
  // Reproduce a save written *before* control was repaired (the dead-partner
  // -stuck save): the partner is dead, but meatActor/activeLayer still point at
  // it. Kill it without firing the bus so #onPartnerFlatlined does NOT run.
  partner.damage(partner.hp);
  assert.equal(run.meatActor, partner);
  assert.equal(run.activeLayer, 'meat');

  const restored = restore(snapshot(run)).run;
  assert.equal(restored.partnerDown, true);
  assert.notEqual(restored.meatActor, restored.partnerMember, 'not driving the corpse');
  assert.equal(restored.meatActor, restored.player, 'meat control falls back to the body');
  assert.equal(restored.activeLayer, 'cyber', 'view defaults to Cyberspace');
  assert.ok(restored.activeActor instanceof CyberAvatar);
  assert.equal(restored.canFlip(), false, 'no live meat operator to flip to');
});

// ---------------------------------------------------------------------------
// Campaign flatlines the partner at job end
// ---------------------------------------------------------------------------

const act2Campaign = () => new Campaign({ seed: 42, rep: 65, completedJobs: 4 });
const deckerOf = (c: Campaign) => c.crew.find(m => m.archetype === 'Decker')!;
const meatOf = (c: Campaign) => c.crew.find(m => m.archetype !== 'Decker')!;

test('P3.M4.4: a partner that died on the field is flatlined at job end even on a clean extract', () => {
  const campaign = act2Campaign();
  const decker = deckerOf(campaign);
  const partner = meatOf(campaign);
  const run = campaign.deployCrewMember(decker.id, cyberContract(), partner.id);
  run.enterCombat();
  jackIn(run);
  flatlinePartner(run);
  assert.equal(partner.flatlined, false, 'not flatlined until the job wraps');

  // The Decker extracts clean; the partner still died covering the body.
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: true });
  assert.equal(campaign.getCrewMember(partner.id)?.flatlined, true);
  assert.equal(campaign.deployedPartnerId, null);
});

test('P3.M4.4: partner-down survives a campaign round-trip and flatlines on the far side', () => {
  const campaign = act2Campaign();
  const decker = deckerOf(campaign);
  const partner = meatOf(campaign);
  const run = campaign.deployCrewMember(decker.id, cyberContract(), partner.id);
  run.enterCombat();
  jackIn(run);
  flatlinePartner(run);

  const restored = restoreCampaign(structuredClone(snapshotCampaign(campaign)));
  assert.equal(restored.activeRun!.partnerDown, true, 'the downed partner round-trips');
  restored.onJobEnd({ outcome: OUTCOME.EXIT, completed: true });
  assert.equal(restored.getCrewMember(partner.id)?.flatlined, true);
});
