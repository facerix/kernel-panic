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
import { OUTCOME } from '../../../../src/game/Run.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { Rng } from '../../../../src/rng.js';
import { snapshot, restore, snapshotCampaign, restoreCampaign } from '../../../../src/game/persistence.js';
import { testContractContext } from '../contractTestUtils.js';

const fakeContract = (overrides = {}) => ({
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
});

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
