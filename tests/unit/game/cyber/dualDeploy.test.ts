/**
 * P3.M4.1 — Dual-deploy: a Cyberspace contract reserves a meat partner who
 * rides along with the Decker (the jack-in operator). This slice carries the
 * partner reference through deploy, validation, and persistence; the partner
 * does not spawn onto the meat grid until jack-in (P3.M4.2).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run } from '../../../../src/game/Run.js';
import { Campaign } from '../../../../src/game/Campaign.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { OUTCOME } from '../../../../src/game/Run.js';
import { OBJECTIVES, type Contract } from '../../../../src/game/hub/Curator.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { Rng } from '../../../../src/rng.js';
import {
  snapshot,
  restore,
  snapshotCampaign,
  restoreCampaign,
} from '../../../../src/game/persistence.js';
import { testContractContext } from '../contractTestUtils.js';

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
    label: 'meat job',
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
    label: 'cyber casing job',
    context: testContractContext(OBJECTIVES.DATA_NODE_SLICE),
    ...overrides,
  });

const makeDecker = (id = 'crew-decker') =>
  buildCrewMember('decker', { x: 0, y: 0 }, new Rng(100), { id });
const makeMerc = (id = 'crew-merc') =>
  buildCrewMember('merc', { x: 0, y: 0 }, new Rng(101), { id });

// An Act-2 campaign: buildCrew trio (merc/razor/tech) + auto-assigned Decker.
const act2Campaign = () => new Campaign({ seed: 42, rep: 65, completedJobs: 4 });
const deckerOf = (c: Campaign) => c.crew.find(m => m.archetype === 'Decker')!;
const meatOf = (c: Campaign) => c.crew.find(m => m.archetype !== 'Decker')!;

// ---------------------------------------------------------------------------
// Run model: partner shape validation
// ---------------------------------------------------------------------------

test('P3.M4.1: Run accepts a non-Decker meat partner on a cyber contract', () => {
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed: 42 });
  run.enterBriefing(cyberContract());
  assert.equal(run.partnerMember?.id, 'crew-merc');
});

test('P3.M4.1: Run rejects a Decker as the meat partner', () => {
  assert.throws(
    () => new Run({ crewMember: makeDecker('a'), partnerMember: makeDecker('b'), seed: 42 }),
    /partner cannot be a Decker/
  );
});

test('P3.M4.1: Run rejects a flatlined partner', () => {
  const partner = makeMerc();
  partner.flatlined = true;
  assert.throws(
    () => new Run({ crewMember: makeDecker(), partnerMember: partner, seed: 42 }),
    /flatlined partner/
  );
});

test('P3.M4.1: Run rejects a partner identical to the deployed operator', () => {
  const solo = makeMerc('crew-merc');
  assert.throws(
    () => new Run({ crewMember: makeMerc('crew-merc'), partnerMember: solo, seed: 42 }),
    /partner must differ/
  );
});

test('P3.M4.1: a partner on a non-cyber contract throws at enterBriefing', () => {
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed: 42 });
  assert.throws(() => run.enterBriefing(fakeContract()), /requires a Cyberspace contract/);
});

test('P3.M4.1: a solo Decker cyber run (no partner) stays legal', () => {
  const run = new Run({ crewMember: makeDecker(), seed: 42 });
  run.enterBriefing(cyberContract());
  assert.equal(run.partnerMember, null);
});

// ---------------------------------------------------------------------------
// Campaign deploy gates
// ---------------------------------------------------------------------------

test('P3.M4.1: deployCrewMember reserves the partner and records deployedPartnerId', () => {
  const campaign = act2Campaign();
  const decker = deckerOf(campaign);
  const partner = meatOf(campaign);
  const run = campaign.deployCrewMember(decker.id, cyberContract(), partner.id);
  assert.equal(run.partnerMember?.id, partner.id);
  assert.equal(campaign.deployedPartnerId, partner.id);
  assert.equal(campaign.deployedMemberId, decker.id);
});

test('P3.M4.1: deployCrewMember rejects a Decker partner', () => {
  const campaign = act2Campaign();
  const decker = deckerOf(campaign);
  // A second Decker can only arrive via direct construction — simulate by
  // pointing the partner id at the Decker itself (same archetype guard fires).
  assert.throws(
    () => campaign.deployCrewMember(decker.id, cyberContract(), decker.id),
    /partner must differ|cannot be a Decker/
  );
});

test('P3.M4.1: deployCrewMember rejects a flatlined partner', () => {
  const campaign = act2Campaign();
  const decker = deckerOf(campaign);
  const partner = meatOf(campaign);
  partner.flatlined = true;
  assert.throws(
    () => campaign.deployCrewMember(decker.id, cyberContract(), partner.id),
    /flatlined/
  );
});

test('P3.M4.1: deployCrewMember rejects an unknown partner id', () => {
  const campaign = act2Campaign();
  const decker = deckerOf(campaign);
  assert.throws(
    () => campaign.deployCrewMember(decker.id, cyberContract(), 'ghost'),
    /unknown partner/
  );
});

test('P3.M4.1: deployCrewMember rejects a partner on a non-cyber contract', () => {
  const campaign = act2Campaign();
  const member = meatOf(campaign);
  const other = campaign.crew.find(m => m !== member && m.archetype !== 'Decker')!;
  assert.throws(
    () => campaign.deployCrewMember(member.id, fakeContract(), other.id),
    /requires a Cyberspace contract/
  );
});

test('P3.M4.1: solo Decker cyber deploy leaves deployedPartnerId null', () => {
  const campaign = act2Campaign();
  const decker = deckerOf(campaign);
  const run = campaign.deployCrewMember(decker.id, cyberContract());
  assert.equal(run.partnerMember, null);
  assert.equal(campaign.deployedPartnerId, null);
});

// ---------------------------------------------------------------------------
// Persistence round-trips
// ---------------------------------------------------------------------------

test('P3.M4.1: partner survives a campaign round-trip in BRIEFING state', () => {
  const campaign = act2Campaign();
  const decker = deckerOf(campaign);
  const partner = meatOf(campaign);
  campaign.deployCrewMember(decker.id, cyberContract(), partner.id);

  const restored = restoreCampaign(snapshotCampaign(campaign));
  assert.equal(restored.deployedPartnerId, partner.id);
  assert.equal(restored.activeRun?.partnerMember?.id, partner.id);
  // Re-linked to the canonical crew object, not a detached copy.
  assert.equal(restored.activeRun?.partnerMember, restored.getCrewMember(partner.id));
});

test('P3.M4.1: partner survives a campaign round-trip in COMBAT state', () => {
  const campaign = act2Campaign();
  const decker = deckerOf(campaign);
  const partner = meatOf(campaign);
  const run = campaign.deployCrewMember(decker.id, cyberContract(), partner.id);
  run.enterCombat();

  const restored = restoreCampaign(snapshotCampaign(campaign));
  assert.equal(restored.deployedPartnerId, partner.id);
  assert.equal(restored.activeRun?.partnerMember?.id, partner.id);
  assert.equal(restored.activeRun?.partnerMember, restored.getCrewMember(partner.id));
  assert.equal(restored.activeRun?.partnerMember?.flatlined, false);
});

// P3.M4.4 regression: once the partner is a live grid entity (jacked in, or
// jacked out), the campaign restore must keep `partnerMember` pointing at that
// grid entity — not the off-grid canonical roster copy. Rebinding it to the
// roster object stranded the partner off the map: flipping to it controlled a
// phantom that couldn't move (the on-grid copy sat frozen in place).
function jackInCampaignRun(run: Run) {
  const point = [...run.world!.entities.values()].find(
    e => e instanceof JackInPoint
  ) as JackInPoint;
  let spot: { x: number; y: number } | null = null;
  for (let dy = -1; dy <= 1 && !spot; dy++) {
    for (let dx = -1; dx <= 1 && !spot; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = point.x + dx;
      const y = point.y + dy;
      if (
        run.world!.grid.inBounds(x, y) &&
        run.world!.grid.isPassable(x, y) &&
        !run.world!.entityAt(x, y)
      ) {
        spot = { x, y };
      }
    }
  }
  run.world!.relocateEntity(run.player!, spot!.x, spot!.y);
  run.player!.refreshAp();
  assert.equal(point.interact(run.world!, run.player!).ok, true);
}

test('P3.M4.4: after jack-out the campaign round-trip keeps the partner on the grid', () => {
  const campaign = act2Campaign();
  const decker = deckerOf(campaign);
  const partner = meatOf(campaign);
  const run = campaign.deployCrewMember(decker.id, cyberContract(), partner.id);
  run.enterCombat();
  jackInCampaignRun(run); // spawns the partner on the meat grid
  run.jackOut(); // phase → resolved; both meat crew on the grid, control on the body
  assert.equal(run.cyberspace?.phase, 'resolved');

  const restored = restoreCampaign(structuredClone(snapshotCampaign(campaign)));
  const rerun = restored.activeRun!;

  // The partner reference IS the live grid entity (identity), not an off-grid
  // roster copy — so flipping to it controls the thing the player can see.
  const gridPartner = rerun.world!.entities.get(partner.id);
  assert.ok(gridPartner, 'partner is a live entity on the restored meat grid');
  assert.equal(rerun.partnerMember, gridPartner, 'partnerMember is the grid entity');
  assert.equal(rerun.partnerMember!.frozen, false, 'partner is not frozen post jack-out');

  // Flip to the partner: the active meat operator is the on-grid entity.
  rerun.flip();
  assert.equal(rerun.meatActor, gridPartner);
  assert.equal(rerun.world!.entities.get(rerun.meatActor!.id), rerun.meatActor);
});

test('P3.M4.1: partner survives a standalone run snapshot/restore', () => {
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed: 42 });
  run.enterBriefing(cyberContract());
  run.enterCombat();

  const restored = restore(snapshot(run)).run;
  assert.equal(restored.partnerMember?.id, 'crew-merc');
  assert.equal(restored.partnerMember?.archetype, 'Merc');
  assert.equal(restored.partnerMember?.flatlined, false);
});

test('P3.M4.1: a partner record on a non-cyber run snapshot is rejected on restore', () => {
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed: 42 });
  run.enterBriefing(cyberContract());
  run.enterCombat();
  const snap = snapshot(run);
  // Strip the Cyberspace component but keep the partner block — corrupt pairing.
  delete snap.cyberspace;
  snap.contract!.objective = { kind: OBJECTIVES.REACH_EXIT, title: 'x', briefing: 'y' };
  assert.throws(() => restore(snap), /partner but no Cyberspace contract/);
});

// ---------------------------------------------------------------------------
// Job end returns the partner
// ---------------------------------------------------------------------------

test('P3.M4.1: a clean extraction returns the partner and clears deployedPartnerId', () => {
  const campaign = act2Campaign();
  const decker = deckerOf(campaign);
  const partner = meatOf(campaign);
  const run = campaign.deployCrewMember(decker.id, cyberContract(), partner.id);
  run.enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: false });
  assert.equal(campaign.deployedPartnerId, null);
  assert.equal(campaign.getCrewMember(partner.id)?.flatlined, false);
});
