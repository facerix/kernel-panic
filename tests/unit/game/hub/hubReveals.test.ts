import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Campaign, CLOCK_ACT2_GRACE_JOBS } from '../../../../src/game/Campaign.js';
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
    clockJobsTaken?: number;
  } = {}
) {
  const campaign = new Campaign({
    seed: opts.seed ?? 42,
    credits: opts.credits ?? 0,
    salvage: opts.salvage ?? 0,
    rep: opts.rep ?? REP.START,
    hubReveals: opts.hubReveals,
    completedJobs: opts.completedJobs,
    clockJobsTaken: opts.clockJobsTaken,
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
  assert.match(revealText, /CASING/);
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

test('Clock reveal fires after grace deploys once Score briefing was dismissed', () => {
  const campaign = hubCampaign({
    rep: 60,
    completedJobs: 4,
    clockJobsTaken: CLOCK_ACT2_GRACE_JOBS,
    hubReveals: {
      terminalExplained: true,
      finnIntroduced: true,
      clinicIntroduced: true,
      terminalRecruitmentExplained: true,
      scoreBriefingPresented: true,
    },
  });
  assert.equal(campaign.arc.clockStarted, true);
  assert.equal(campaign.lastHubReveal?.id, 'clock-reveal');
  assert.equal(campaign.hubReveals.clockBriefingPresented, undefined);
  assert.ok(hubRevealCommitsOnDismiss('clock-reveal'));
  const revealText = campaign.lastHubReveal?.lines.join('\n') ?? '';
  assert.match(revealText, /heat/i);
  assert.match(revealText, /window closes/i);

  commitHubReveal(campaign, 'clock-reveal');
  assert.equal(campaign.hubReveals.clockBriefingPresented, true);
  campaign.enterHub();
  assert.equal(campaign.lastHubReveal, null);
});

test('Act 3 reveal presents THE SCORE when final prep unlocks', () => {
  const scorePrincipal = { id: 'matsuda', label: 'Matsuda', groups: ['corp'] as const };
  const campaign = new Campaign({
    seed: 42,
    rep: 60,
    completedJobs: 9,
    hubReveals: {
      terminalExplained: true,
      finnIntroduced: true,
      clinicIntroduced: true,
      terminalRecruitmentExplained: true,
      scoreBriefingPresented: true,
      clockBriefingPresented: true,
    },
    siteRoster: [
      {
        id: 'score',
        seed: '100',
        mapWidth: 32,
        mapHeight: 20,
        label: '// Matsuda server farm - Score target',
        tier: 'score',
        scoreTarget: true,
        mutationDeltas: [],
        seenKeys: [],
        lastVisitedJob: 5,
        principal: scorePrincipal,
        site: { id: 'server-farm', label: 'server farm', groups: ['corp', 'data'] },
      },
      {
        id: 'case-1',
        seed: '101',
        mapWidth: 24,
        mapHeight: 16,
        label: '// Matsuda case site',
        tier: 'roster',
        scoreTarget: false,
        mutationDeltas: [],
        seenKeys: [],
        lastVisitedJob: 6,
        principal: scorePrincipal,
      },
      {
        id: 'case-2',
        seed: '102',
        mapWidth: 24,
        mapHeight: 16,
        label: '// Matsuda case site 2',
        tier: 'roster',
        scoreTarget: false,
        mutationDeltas: [],
        seenKeys: [],
        lastVisitedJob: 7,
        principal: scorePrincipal,
      },
    ],
  });
  assert.equal(campaign.arc.arcStage, 'act-3');
  assert.equal(campaign.canAttemptScore(), true);
  assert.equal(campaign.lastHubReveal?.id, 'act-3-reveal');
  assert.equal(campaign.hubReveals.act3BriefingPresented, undefined);
  assert.ok(hubRevealCommitsOnDismiss('act-3-reveal'));
  const revealText = campaign.lastHubReveal?.lines.join('\n') ?? '';
  assert.match(revealText, /You're ready/i);
  assert.match(revealText, /THE SCORE/i);
  assert.match(revealText, /heat/i);

  commitHubReveal(campaign, 'act-3-reveal');
  assert.equal(campaign.hubReveals.act3BriefingPresented, true);
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
