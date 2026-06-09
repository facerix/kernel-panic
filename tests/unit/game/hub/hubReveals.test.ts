import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Campaign } from '../../../../src/game/Campaign.js';
import { REP } from '../../../../src/game/constants.js';
import { OUTCOME } from '../../../../src/game/Run.js';
import {
  commitHubReveal,
  emptyHubReveals,
  hubRevealCommitsOnDismiss,
  isTerminalAccessible,
  isTerminalRecruitmentUnlocked,
  migrateLegacyHubReveals,
  normalizeHubReveals,
  shouldSpawnClinic,
  shouldSpawnFinn,
  snapshotHubReveals,
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

test('terminal access and recruitment unlock follow separate hubReveals flags', () => {
  assert.equal(isTerminalAccessible(emptyHubReveals()), false);
  assert.equal(isTerminalRecruitmentUnlocked(emptyHubReveals()), false);
  assert.equal(isTerminalAccessible({ terminalExplained: true }), true);
  assert.equal(isTerminalRecruitmentUnlocked({ terminalRecruitmentExplained: true }), true);
  assert.equal(isTerminalRecruitmentUnlocked({ terminalExplained: true }), false);
});

test('legacy terminalExplained snapshot backfills recruitment unlock on restore', () => {
  const reveals = normalizeHubReveals(
    migrateLegacyHubReveals({ terminalExplained: true }, { rep: REP.RECRUIT_THRESHOLD })
  );
  assert.equal(reveals.terminalExplained, true);
  assert.equal(reveals.terminalRecruitmentExplained, true);
});

test('normalizeHubReveals does not backfill recruitment from terminalExplained alone', () => {
  const reveals = normalizeHubReveals({ terminalExplained: true });
  assert.equal(reveals.terminalExplained, true);
  assert.equal(reveals.terminalRecruitmentExplained, undefined);
});

test('fresh campaign introduces crew terminal on first hub enter', () => {
  const campaign = hubCampaign();
  assert.equal(campaign.lastHubReveal?.id, 'terminal');
  assert.ok(campaign.hubReveals.terminalExplained);
  assert.equal(campaign.hubReveals.terminalRecruitmentExplained, undefined);
});

test('first Hub return with salvage introduces Finn and spawns him', () => {
  const campaign = hubCampaign({
    salvage: makeSalvage({ scrap: 3 }),
    hubReveals: { terminalExplained: true },
  });
  assert.ok(campaign.hubReveals.finnIntroduced);
  assert.ok(campaign.finn);
  assert.equal(campaign.clinic, null);
  assert.ok(campaign.lastHubReveal?.id === 'finn');
});

test('Finn reveal does not fire twice', () => {
  const campaign = hubCampaign({
    salvage: makeSalvage({ scrap: 1 }),
    hubReveals: { finnIntroduced: true, terminalExplained: true },
  });
  campaign.enterHub();
  assert.equal(campaign.lastHubReveal, null);
  assert.ok(campaign.finn);
});

test('only one reveal fires per enterHub when clinic and recruitment both qualify', () => {
  const campaign = hubCampaign({
    hubReveals: { finnIntroduced: true, terminalExplained: true },
  });
  campaign.rep = REP.RECRUIT_THRESHOLD;
  campaign.crew[0].hp = 1;
  campaign.enterHub();
  assert.equal(campaign.lastHubReveal?.id, 'clinic');
  assert.equal(campaign.hubReveals.clinicIntroduced, true);
  assert.equal(campaign.hubReveals.terminalRecruitmentExplained, undefined);
});

test('terminal recruitment reveal when Rep meets threshold', () => {
  const campaign = hubCampaign({
    rep: REP.RECRUIT_THRESHOLD,
    hubReveals: { finnIntroduced: true, terminalExplained: true },
  });
  assert.equal(campaign.lastHubReveal?.id, 'terminal-recruit');
  assert.ok(campaign.hubReveals.terminalRecruitmentExplained);
});

test('Score reveal presents the target and assigns a Decker when Act 2 opens', () => {
  const campaign = hubCampaign({
    rep: 60,
    completedJobs: 4,
    hubReveals: {
      terminalExplained: true,
      finnIntroduced: true,
      clinicIntroduced: true,
      terminalRecruitmentExplained: true,
    },
  });
  assert.equal(campaign.arc.arcStage, 'act-2');
  assert.equal(campaign.lastHubReveal?.id, 'score-reveal');
  assert.equal(campaign.hubReveals.scoreBriefingPresented, undefined);
  assert.ok(hubRevealCommitsOnDismiss('score-reveal'));
  const revealText = campaign.lastHubReveal?.lines.join('\n') ?? '';
  assert.match(revealText, /SCORE SITE/);
  assert.match(revealText, /Decker/);

  // Decker was assigned as part of the same transition beat
  assert.equal(campaign.arc.deckerRecruited, true);
  const decker = campaign.crew.find(m => m.archetype === 'Decker');
  assert.ok(decker, 'Decker should be on the crew after Act 2 entry');
  assert.ok(decker!.callsign, 'Decker should have a callsign');

  commitHubReveal(campaign, 'score-reveal');
  assert.equal(campaign.hubReveals.scoreBriefingPresented, true);

  campaign.enterHub();
  assert.equal(campaign.lastHubReveal, null);
});

test('Score reveal takes priority over clinic when Act 2 opens with injured crew', () => {
  const campaign = hubCampaign({
    rep: 60,
    completedJobs: 4,
    hubReveals: {
      terminalExplained: true,
      finnIntroduced: true,
      terminalRecruitmentExplained: true,
    },
  });
  campaign.crew[0].hp = 1;
  campaign.enterHub();
  assert.equal(campaign.lastHubReveal?.id, 'score-reveal');
  assert.equal(campaign.hubReveals.clinicIntroduced, undefined);
});

test('restoreCampaign leaves Score briefing pending until the shell dismisses it', () => {
  const snap = snapshotCampaign(
    new Campaign({
      seed: 42,
      rep: 100,
      completedJobs: 9,
      hubReveals: {
        terminalExplained: true,
        finnIntroduced: true,
        clinicIntroduced: true,
        terminalRecruitmentExplained: true,
      },
      arc: {
        arcStage: 'act-1',
        deckerRecruited: false,
        scoreRevealed: false,
        clockStarted: false,
        scoreAttempted: false,
        scoreCompleted: false,
      },
    })
  );
  delete snap.arc;

  const restored = restoreCampaign(snap);
  assert.equal(restored.arcStage, 'act-2');
  assert.equal(restored.arc.scoreRevealed, true);
  assert.equal(restored.lastHubReveal?.id, 'score-reveal');
  assert.equal(restored.hubReveals.scoreBriefingPresented, undefined);
});

test('terminal recruitment reveal when pendingRecruitReward even below Rep', () => {
  const campaign = hubCampaign({
    rep: REP.START,
    hubReveals: { finnIntroduced: true, terminalExplained: true },
  });
  campaign.pendingRecruitReward = true;
  campaign.enterHub();
  assert.equal(campaign.lastHubReveal?.id, 'terminal-recruit');
});

test('clinic reveal when crew has attrition', () => {
  const campaign = hubCampaign({
    hubReveals: {
      finnIntroduced: true,
      terminalExplained: true,
      terminalRecruitmentExplained: true,
    },
  });
  campaign.crew[0].hp = 1;
  campaign.enterHub();
  assert.equal(campaign.lastHubReveal?.id, 'clinic');
  assert.ok(campaign.hubReveals.clinicIntroduced);
  assert.ok(campaign.clinic);
});

test('completedJobs alone qualifies Finn introduction', () => {
  const campaign = hubCampaign({
    completedJobs: 1,
    hubReveals: { terminalExplained: true },
  });
  campaign.enterHub();
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
    hubReveals: {
      terminalExplained: true,
      finnIntroduced: true,
      clinicIntroduced: true,
      scoreBriefingPresented: true,
    },
  });
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  assert.deepEqual(restored.hubReveals, snapshotHubReveals(campaign.hubReveals));
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
  assert.deepEqual(restored.hubReveals, { terminalExplained: true });
  assert.equal(restored.completedJobs, 0);
  assert.equal(restored.finn, null);
});
