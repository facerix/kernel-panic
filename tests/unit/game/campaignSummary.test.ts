import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Campaign, CAMPAIGN_STATE, SCORE_CREDITS_REWARD } from '../../../src/game/Campaign.js';
import {
  CAMPAIGN_HISTORY_CAP,
  archiveCampaignSummary,
  buildCampaignSummary,
  cloneCampaignSummary,
  normalizeCampaignHistory,
  validateCampaignSummary,
  type CampaignSummary,
} from '../../../src/game/campaignSummary.js';
import { OUTCOME } from '../../../src/game/Run.js';
import { makeSalvage } from '../../../src/game/salvage.js';
import { SCOREABLE_ITEM_IDS } from '../../../src/game/items.js';
import type { LocationSite } from '../../../src/types.js';

const COMPLETED_AT = '2026-06-14T19:30:00.000Z';

function validSite(overrides: Partial<LocationSite> = {}): LocationSite {
  return {
    id: 'score',
    seed: '100',
    mapWidth: 24,
    mapHeight: 16,
    label: '// Matsuda server farm',
    tier: 'score',
    scoreTarget: true,
    mutationDeltas: [],
    seenKeys: [],
    lastVisitedJob: 5,
    principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
    ...overrides,
  };
}

function summary(overrides: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    campaignId: 'campaign-1',
    completedAt: COMPLETED_AT,
    result: 'win',
    endReason: 'score-complete',
    seed: 42,
    completedJobs: 10,
    rep: 67,
    credits: 1_125,
    crewRoster: [{ callsign: 'Phreak', archetype: 'Decker', flatlined: false }],
    ...overrides,
  };
}

test('Score completion summary uses post-settlement jobs, Rep, and Credits', () => {
  const campaign = new Campaign({
    id: 'campaign-score',
    seed: 42,
    credits: 125,
    rep: 65,
    completedJobs: 9,
    siteRoster: [
      validSite(),
      validSite({ id: 'case-1', tier: 'roster', scoreTarget: false, seed: '101' }),
      validSite({ id: 'case-2', tier: 'roster', scoreTarget: false, seed: '102' }),
    ],
  });
  const decker = campaign.crew.find(member => member.archetype === 'Decker');
  const partner = campaign.crew.find(member => member.archetype !== 'Decker');
  assert.ok(decker);
  assert.ok(partner);
  const score = campaign.buildScoreContract();
  score.reward.repDelta = 7;
  const run = campaign.deployCrewMember(decker.id, score, partner.id);
  run.enterCombat();

  campaign.onJobEnd({
    outcome: OUTCOME.EXIT,
    completed: true,
    salvage: makeSalvage({ scrap: 2, data: 3 }),
  });
  const record = buildCampaignSummary(campaign, COMPLETED_AT);

  assert.equal(campaign.state, CAMPAIGN_STATE.ENDED);
  assert.equal(record.result, 'win');
  assert.equal(record.endReason, 'score-complete');
  assert.equal(record.completedJobs, 10);
  assert.equal(record.rep, 72);
  assert.equal(record.credits, 125 + SCORE_CREDITS_REWARD);
  assert.equal('salvage' in record, false);
  assert.ok(record.crewRoster.some(member => member.archetype === 'Decker'));
  // P3.M6.4: a winning Score captures the stolen blueprint, self-contained.
  assert.ok(record.scoreReward, 'win summary carries the stolen blueprint');
  assert.ok(SCOREABLE_ITEM_IDS.has(record.scoreReward.id));
  assert.ok(record.scoreReward.label.length > 0);
  assert.equal(typeof record.scoreReward.flavor, 'string');
});

test('loss summaries preserve each terminal reason and final roster state', () => {
  for (const endReason of ['crew-wipe', 'clock-expired', 'decker-flatlined-score'] as const) {
    const campaign = new Campaign({ id: `campaign-${endReason}`, seed: 9 });
    campaign.state = CAMPAIGN_STATE.ENDED;
    campaign.crew[0].flatlined = true;
    Object.defineProperty(campaign, 'endReason', { value: endReason });

    const record = buildCampaignSummary(campaign, COMPLETED_AT);

    assert.equal(record.result, 'loss');
    assert.equal(record.endReason, endReason);
    assert.equal(record.crewRoster[0].flatlined, true);
  }
});

test('partial Score summary validates as partial', () => {
  const record = validateCampaignSummary(
    summary({ result: 'partial', endReason: 'score-partial' })
  );
  assert.equal(record.result, 'partial');
  assert.equal(record.endReason, 'score-partial');
});

test('CampaignSummary validation rejects mismatched outcomes and malformed credit totals', () => {
  assert.throws(
    () => validateCampaignSummary(summary({ result: 'loss' })),
    /score-complete must have result win/
  );
  assert.throws(
    () => validateCampaignSummary(summary({ result: 'win', endReason: 'score-partial' })),
    /score-partial must have result partial/
  );
  assert.throws(
    () => validateCampaignSummary({ ...summary(), credits: -1 }),
    /credits must be a non-negative integer/
  );
});

test('summary without scoreReward validates (optional field, legacy-compatible)', () => {
  const record = validateCampaignSummary(summary());
  assert.equal(record.scoreReward, undefined);
});

test('summary with a well-formed scoreReward round-trips through validate + clone', () => {
  const withReward = summary({
    scoreReward: { id: 'monoblade', label: 'Monoblade', flavor: 'An edge that never dulls.' },
  });
  const record = validateCampaignSummary(withReward);
  assert.deepEqual(record.scoreReward, {
    id: 'monoblade',
    label: 'Monoblade',
    flavor: 'An edge that never dulls.',
  });
  // Clone is deep — mutating the clone must not touch the original.
  const clone = cloneCampaignSummary(record);
  clone.scoreReward!.label = 'CHANGED';
  assert.equal(record.scoreReward!.label, 'Monoblade');
});

test('CampaignSummary validation rejects unexpected keys and malformed scoreReward', () => {
  assert.throws(
    () => validateCampaignSummary({ ...summary(), bogus: true }),
    /unexpected key "bogus"/
  );
  assert.throws(
    () => validateCampaignSummary(summary({ scoreReward: { id: 'x', label: 'X' } as never })),
    /scoreReward is missing required key "flavor"/
  );
  assert.throws(
    () =>
      validateCampaignSummary(
        summary({ scoreReward: { id: '', label: 'X', flavor: 'f' } as never })
      ),
    /scoreReward\.id/
  );
});

test('legacy history defaults empty and imported history deduplicates then trims', () => {
  assert.deepEqual(normalizeCampaignHistory(undefined), []);
  const imported = Array.from({ length: CAMPAIGN_HISTORY_CAP + 5 }, (_, index) =>
    summary({ campaignId: `campaign-${index}` })
  );
  imported.splice(1, 0, summary({ campaignId: 'campaign-0', completedJobs: 999 }));

  const normalized = normalizeCampaignHistory(imported);

  assert.equal(normalized.length, CAMPAIGN_HISTORY_CAP);
  assert.equal(normalized[0].campaignId, 'campaign-0');
  assert.equal(normalized[0].completedJobs, 10, 'newest original row wins duplicate conflict');
});

test('archival is newest-first, preserves an existing record, and caps at 50', () => {
  const existing = summary({ campaignId: 'campaign-existing', completedAt: COMPLETED_AT });
  const duplicate = summary({
    campaignId: 'campaign-existing',
    completedAt: '2026-06-15T19:30:00.000Z',
    completedJobs: 99,
  });
  const duplicateResult = archiveCampaignSummary([existing], duplicate);
  assert.equal(duplicateResult.added, false);
  assert.deepEqual(duplicateResult.summary, existing);

  const full = Array.from({ length: CAMPAIGN_HISTORY_CAP }, (_, index) =>
    summary({ campaignId: `campaign-${index}` })
  );
  const newest = summary({ campaignId: 'campaign-newest' });
  const added = archiveCampaignSummary(full, newest);
  assert.equal(added.added, true);
  assert.equal(added.history.length, CAMPAIGN_HISTORY_CAP);
  assert.equal(added.history[0].campaignId, 'campaign-newest');
  assert.equal(
    added.history.some(entry => entry.campaignId === 'campaign-49'),
    false
  );
});
