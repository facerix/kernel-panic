import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Campaign } from '../../../../src/game/Campaign.js';
import { REP } from '../../../../src/game/constants.js';
import { OUTCOME } from '../../../../src/game/Run.js';
import {
  emptyHubReveals,
  shouldSpawnClinic,
  shouldSpawnFinn,
} from '../../../../src/game/hub/hubReveals.js';
import { makeSalvage } from '../../../../src/game/salvage.js';
import { snapshotCampaign, restoreCampaign } from '../../../../src/game/persistence.js';
import { Curator } from '../../../../src/game/hub/Curator.js';

function hubCampaign(
  opts: {
    seed?: number;
    credits?: number;
    salvage?: ReturnType<typeof makeSalvage>;
    rep?: number;
    hubReveals?: Record<string, boolean>;
    completedJobs?: number;
  } = {}
) {
  const campaign = new Campaign({
    seed: opts.seed ?? 42,
    credits: opts.credits ?? 0,
    salvage: opts.salvage ?? 0,
    rep: opts.rep ?? REP.START,
    hubReveals: opts.hubReveals,
    completedJobs: opts.completedJobs,
  });
  return campaign;
}

test('fresh Hub has no Finn or Clinic entities', () => {
  const campaign = hubCampaign();
  assert.equal(campaign.finn, null);
  assert.equal(campaign.clinic, null);
  assert.ok(campaign.terminal, 'Terminal is always on the Hub map');
  assert.ok(campaign.curator);
});

test('shouldSpawnFinn and shouldSpawnClinic follow hubReveals flags', () => {
  assert.equal(shouldSpawnFinn(emptyHubReveals()), false);
  assert.equal(shouldSpawnClinic(emptyHubReveals()), false);
  assert.equal(shouldSpawnFinn({ finnIntroduced: true }), true);
  assert.equal(shouldSpawnClinic({ clinicIntroduced: true }), true);
});

test('first Hub return with salvage introduces Finn and spawns him', () => {
  const campaign = hubCampaign({ salvage: makeSalvage({ scrap: 3 }) });
  assert.ok(campaign.hubReveals.finnIntroduced);
  assert.ok(campaign.finn);
  assert.equal(campaign.clinic, null);
  assert.ok(campaign.lastHubReveal?.id === 'finn');
});

test('Finn reveal does not fire twice', () => {
  const campaign = hubCampaign({
    salvage: makeSalvage({ scrap: 1 }),
    hubReveals: { finnIntroduced: true },
  });
  campaign.enterHub();
  assert.equal(campaign.lastHubReveal, null);
  assert.ok(campaign.finn);
});

test('only one reveal fires per enterHub when clinic and terminal both qualify', () => {
  const campaign = hubCampaign({ hubReveals: { finnIntroduced: true } });
  campaign.rep = REP.RECRUIT_THRESHOLD;
  campaign.crew[0].hp = 1;
  campaign.enterHub();
  assert.equal(campaign.lastHubReveal?.id, 'clinic');
  assert.equal(campaign.hubReveals.clinicIntroduced, true);
  assert.equal(campaign.hubReveals.terminalExplained, undefined);
});

test('terminal reveal when Rep meets threshold', () => {
  const campaign = hubCampaign({
    rep: REP.RECRUIT_THRESHOLD,
    hubReveals: { finnIntroduced: true },
  });
  assert.equal(campaign.lastHubReveal?.id, 'terminal');
  assert.ok(campaign.hubReveals.terminalExplained);
});

test('terminal reveal when pendingRecruitReward even below Rep', () => {
  const campaign = hubCampaign({
    rep: REP.START,
    hubReveals: { finnIntroduced: true },
  });
  campaign.pendingRecruitReward = true;
  campaign.enterHub();
  assert.equal(campaign.lastHubReveal?.id, 'terminal');
});

test('clinic reveal when crew has attrition', () => {
  const campaign = hubCampaign({
    hubReveals: { finnIntroduced: true, terminalExplained: true },
  });
  campaign.crew[0].hp = 1;
  campaign.enterHub();
  assert.equal(campaign.lastHubReveal?.id, 'clinic');
  assert.ok(campaign.hubReveals.clinicIntroduced);
  assert.ok(campaign.clinic);
});

test('completedJobs alone qualifies Finn introduction', () => {
  const campaign = hubCampaign({ completedJobs: 1 });
  assert.ok(campaign.hubReveals.finnIntroduced);
  assert.ok(campaign.finn);
});

test('onJobEnd EXIT increments completedJobs and can introduce Finn on next hub', () => {
  const campaign = hubCampaign();
  assert.equal(campaign.completedJobs, 0);
  const contract = new Curator().generateContract(campaign.rng);
  const run = campaign.deployCrewMember(campaign.crew[0].id, contract);
  run.enterCombat(contract);
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: makeSalvage({ scrap: 1 }) });
  assert.equal(campaign.completedJobs, 1);
  assert.ok(campaign.hubReveals.finnIntroduced);
  assert.ok(campaign.finn);
});

test('hubReveals and completedJobs round-trip in campaign snapshot', () => {
  const campaign = hubCampaign({
    salvage: makeSalvage({ scrap: 1 }),
    completedJobs: 2,
  });
  campaign.hubReveals.clinicIntroduced = true;
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  assert.deepEqual(restored.hubReveals, campaign.hubReveals);
  assert.equal(restored.completedJobs, 2);
  assert.ok(restored.clinic);
});

test('pre-M5.4 snapshot defaults hubReveals and completedJobs', () => {
  const campaign = hubCampaign();
  const snap = snapshotCampaign(campaign);
  const raw = { ...snap };
  delete (raw as { hubReveals?: unknown }).hubReveals;
  delete (raw as { completedJobs?: unknown }).completedJobs;
  const restored = restoreCampaign(raw);
  assert.deepEqual(restored.hubReveals, emptyHubReveals());
  assert.equal(restored.completedJobs, 0);
  assert.equal(restored.finn, null);
});
