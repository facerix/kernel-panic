import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONTRACT_DIFFICULTY } from '../../../../src/game/constants.js';
import { buildContractRecipeFixture } from '../../../../src/game/hub/Curator.js';
import {
  findDecker,
  findScoreTargetSite,
  formatArcStageLabel,
  formatHubArcStatus,
  isScoreSiteContract,
  scoreRevealLines,
  scoreTargetDisplayName,
  scoreTargetSiteId,
} from '../../../../src/game/hub/arcSurface.js';
import { Decker } from '../../../../src/game/archetypes/Decker.js';
import { Merc } from '../../../../src/game/archetypes/Merc.js';
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

test('formatHubArcStatus shows act label and Score target once revealed', () => {
  const campaign = {
    arc: arc({ arcStage: 'act-2', scoreRevealed: true }),
    siteRoster: [scoreSite()],
  };
  assert.equal(formatHubArcStatus(campaign), 'STAGE 2: CASING | SCORE: Matsuda server farm');
});

test('formatHubArcStatus throws when revealed state has no Score target', () => {
  assert.throws(
    () =>
      formatHubArcStatus({
        arc: arc({ arcStage: 'act-2', scoreRevealed: true }),
        siteRoster: [],
      }),
    /score revealed without a Score target/i
  );
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
  assert.match(lines.join('\n'), /SCORE SITE/);
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
  assert.equal(isScoreSiteContract(contract, null), false);
});

test('findDecker throws when no Decker is present', () => {
  const merc = new Merc({ id: 'merc', x: 0, y: 0, callsign: 'Glitch' });
  assert.throws(() => findDecker([merc]), /without a Decker/i);
  assert.throws(() => findDecker([]), /without a Decker/i);
});

test('findDecker returns the Decker when one is present', () => {
  const decker = new Decker({ id: 'decker', x: 0, y: 0, callsign: 'Case' });
  const crew = [new Merc({ id: 'merc', x: 1, y: 1, callsign: 'Glitch' }), decker];
  assert.equal(findDecker(crew), decker);
});
