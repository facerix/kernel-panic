import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONTRACT_DIFFICULTY } from '../../../../src/game/constants.js';
import { buildContractRecipeFixture } from '../../../../src/game/hub/Curator.js';
import {
  act3RevealLines,
  findDecker,
  findScoreTargetSite,
  formatArcStageLabel,
  formatClockStatus,
  formatHubArcStatus,
  formatHubArcStatusLines,
  isScorePrincipalContract,
  isScoreSiteContract,
  scoreRevealLines,
  scoreTargetDisplayName,
  scoreTargetSiteId,
} from '../../../../src/game/hub/arcSurface.js';
import { Decker } from '../../../../src/game/archetypes/Decker.js';
import { Merc } from '../../../../src/game/archetypes/Merc.js';
import { CLOCK_ACT2_DEADLINE_JOBS, CLOCK_ACT2_GRACE_JOBS } from '../../../../src/game/Campaign.js';
import type { CampaignArc } from '../../../../src/game/Campaign.js';
import type { LocationSite, LocationToken } from '../../../../src/types.js';

const principal = token('matsuda', 'Matsuda', ['corp']);
const site = token('server-farm', 'server farm', ['corp', 'data']);

function token(id: string, label: string, groups: string[]): LocationToken {
  return { id, label, groups };
}

function arc(overrides: Partial<CampaignArc> = {}): CampaignArc {
  return {
    arcStage: 'act-1',
    deckerRecruited: false,
    scoreRevealed: false,
    clockStarted: false,
    scoreAttempted: false,
    scoreCompleted: false,
    ...overrides,
  };
}

function scoreSite(overrides: Partial<LocationSite> = {}): LocationSite {
  return {
    id: 'score-site',
    seed: '123',
    mapWidth: 32,
    mapHeight: 20,
    label: '// Matsuda server farm - Score target',
    tier: 'score',
    scoreTarget: true,
    mutationDeltas: [],
    seenKeys: [],
    lastVisitedJob: 4,
    principal,
    site,
    ...overrides,
  };
}

test('formatHubArcStatusLines omits clock until the Curator briefing is dismissed', () => {
  const campaign = {
    arc: arc({ arcStage: 'act-2', scoreRevealed: true, clockStarted: true }),
    siteRoster: [scoreSite()],
    crew: [],
    hubReveals: {},
    clockJobsTaken: CLOCK_ACT2_GRACE_JOBS + 1,
    clockHeat: 1,
    scoreDeadlineJobsRemaining: 4,
  };
  assert.deepEqual(formatHubArcStatusLines(campaign), [
    'STAGE 2: CASING | SCORE: Matsuda server farm',
    null,
  ]);
  assert.equal(formatHubArcStatus(campaign), 'STAGE 2: CASING | SCORE: Matsuda server farm');
});

test('formatHubArcStatusLines shows active heat only after clock briefing', () => {
  const campaign = {
    arc: arc({ arcStage: 'act-2', scoreRevealed: true, clockStarted: true }),
    siteRoster: [scoreSite()],
    crew: [],
    hubReveals: { clockBriefingPresented: true },
    clockJobsTaken: CLOCK_ACT2_GRACE_JOBS + 2,
    clockHeat: 2,
    scoreDeadlineJobsRemaining: 3,
  };
  assert.deepEqual(formatHubArcStatusLines(campaign), [
    'STAGE 2: CASING | SCORE: Matsuda server farm',
    'CLOCK: HEAT 2',
  ]);
});

test('formatHubArcStatus throws when revealed state has no Score target', () => {
  assert.throws(
    () =>
      formatHubArcStatus({
        arc: arc({ arcStage: 'act-2', scoreRevealed: true }),
        siteRoster: [],
        crew: [],
      }),
    /score revealed without a Score target/i
  );
});

test('formatClockStatus stays hidden before briefing, during grace, and after Act 3 deadline', () => {
  assert.equal(
    formatClockStatus({
      arc: arc({ scoreRevealed: true }),
      siteRoster: [scoreSite()],
      crew: [],
      hubReveals: {},
      clockJobsTaken: 1,
    }),
    null
  );
  assert.equal(
    formatClockStatus({
      arc: arc({ scoreRevealed: true, clockStarted: false }),
      siteRoster: [scoreSite()],
      crew: [],
      hubReveals: { clockBriefingPresented: true },
      clockJobsTaken: 1,
    }),
    null
  );
  assert.equal(
    formatClockStatus({
      arc: arc({ scoreRevealed: true, clockStarted: true, scoreAttempted: true }),
      siteRoster: [scoreSite()],
      crew: [],
      hubReveals: { clockBriefingPresented: true },
      clockJobsTaken: CLOCK_ACT2_DEADLINE_JOBS,
    }),
    null
  );
  assert.equal(
    formatClockStatus({
      arc: arc({ arcStage: 'act-2', scoreRevealed: true, clockStarted: true }),
      siteRoster: [scoreSite()],
      crew: [],
      hubReveals: { clockBriefingPresented: true },
      clockJobsTaken: CLOCK_ACT2_DEADLINE_JOBS,
      clockHeat: CLOCK_ACT2_DEADLINE_JOBS - CLOCK_ACT2_GRACE_JOBS,
    }),
    `CLOCK: HEAT ${CLOCK_ACT2_DEADLINE_JOBS - CLOCK_ACT2_GRACE_JOBS}`
  );
  assert.equal(
    formatClockStatus({
      arc: arc({ arcStage: 'act-3', scoreRevealed: true, clockStarted: true }),
      siteRoster: [scoreSite()],
      crew: [],
      hubReveals: { clockBriefingPresented: true },
      clockJobsTaken: CLOCK_ACT2_DEADLINE_JOBS,
    }),
    null
  );
});

test('formatClockStatus shows Act 3 deadline countdown', () => {
  assert.equal(
    formatClockStatus({
      arc: arc({ arcStage: 'act-3', scoreRevealed: true, clockStarted: true }),
      siteRoster: [scoreSite()],
      crew: [],
      hubReveals: { clockBriefingPresented: true },
      clockJobsTaken: CLOCK_ACT2_GRACE_JOBS + 2,
      clockHeat: 2,
      scoreDeadlineJobsRemaining: 3,
    }),
    'CLOCK: HEAT 2 / 3 JOBS LEFT'
  );
});

test('act3 reveal copy points at THE SCORE on the job board', () => {
  const lines = act3RevealLines();
  assert.match(lines.join('\n'), /You're ready/i);
  assert.match(lines.join('\n'), /THE SCORE/i);
  assert.match(lines.join('\n'), /heat/i);
});

test('Score target helpers reject multiple targets instead of guessing', () => {
  const sites = [scoreSite({ id: 'a' }), scoreSite({ id: 'b' })];
  assert.throws(() => findScoreTargetSite(sites), /multiple Score targets/i);
  assert.throws(() => scoreTargetSiteId({ arc: arc(), siteRoster: sites }), /multiple Score/i);
});

test('score reveal copy names the target and points at job-board badges', () => {
  const lines = scoreRevealLines({
    arc: arc({ arcStage: 'act-2', scoreRevealed: true }),
    siteRoster: [scoreSite()],
    crew: [new Decker({ id: 'decker', x: 0, y: 0, callsign: 'Case' })],
  });
  assert.match(lines.join('\n'), /Matsuda server farm/);
  assert.match(lines.join('\n'), /CASING/);
  assert.match(lines.join('\n'), /Case/);
});

test('scoreTargetDisplayName falls back to sanitized roster label', () => {
  assert.equal(
    scoreTargetDisplayName(scoreSite({ principal: undefined, site: undefined })),
    'Matsuda server farm'
  );
});

test('formatArcStageLabel has stable player-facing labels', () => {
  assert.equal(formatArcStageLabel('act-1'), 'STAGE 1: STREET LEVEL');
  assert.equal(formatArcStageLabel('act-3'), 'STAGE 3: FINAL PREP');
  assert.equal(formatArcStageLabel('score'), 'THE SCORE');
});

test('isScoreSiteContract matches contract locationSiteId to the Score target id', () => {
  const contract = buildContractRecipeFixture({
    recipeId: 'terminal-slice',
    principalId: 'matsuda',
    siteId: 'server-farm',
    assetId: 'identity-spool',
    actionId: 'slice',
    difficulty: CONTRACT_DIFFICULTY.STANDARD,
    seed: 11,
  });
  contract.context.locationSiteId = 'score-site';

  assert.equal(isScoreSiteContract(contract, 'score-site'), true);
  assert.equal(isScoreSiteContract(contract, 'other-site'), false);
});

test('isScorePrincipalContract matches same-principal jobs but not the Score site', () => {
  const contract = buildContractRecipeFixture({
    recipeId: 'terminal-slice',
    principalId: 'matsuda',
    siteId: 'server-farm',
    assetId: 'identity-spool',
    actionId: 'slice',
    difficulty: CONTRACT_DIFFICULTY.STANDARD,
    seed: 11,
  });
  contract.context.locationSiteId = 'case-site';

  assert.equal(isScorePrincipalContract(contract, 'matsuda', 'score-site'), true);
  contract.context.locationSiteId = 'score-site';
  assert.equal(isScorePrincipalContract(contract, 'matsuda', 'score-site'), false);
});

test('findDecker throws when crew has no Decker', () => {
  assert.throws(
    () => findDecker([new Merc({ id: 'merc', x: 0, y: 0, callsign: 'Wraith' })]),
    /without a Decker/i
  );
});
