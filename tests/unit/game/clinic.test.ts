import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Campaign } from '../../../src/game/Campaign.js';
import { CLINIC_COST_PER_HP } from '../../../src/game/constants.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { snapshotCampaign, restoreCampaign } from '../../../src/game/persistence.js';
import { testContractContext } from './contractTestUtils.js';

function damagedCampaign(
  opts: { seed?: number; credits?: number; hp?: number; maxHp?: number } = {}
) {
  const campaign = new Campaign({ seed: opts.seed ?? 42, credits: opts.credits ?? 500 });
  const member = campaign.crew[0];
  member.hp = opts.hp ?? 1;
  member.maxHp = opts.maxHp ?? 3;
  return campaign;
}

function healCost(hp: number, maxHp: number) {
  return (maxHp - hp) * CLINIC_COST_PER_HP;
}

test('healMember cost is (maxHp - hp) * CLINIC_COST_PER_HP', () => {
  const cases = [
    { hp: 1, maxHp: 3, credits: 100 },
    { hp: 2, maxHp: 5, credits: 200 },
    { hp: 0, maxHp: 4, credits: 300 },
  ];
  for (const { hp, maxHp, credits } of cases) {
    const campaign = damagedCampaign({ hp, maxHp, credits });
    const member = campaign.crew[0];
    const cost = healCost(hp, maxHp);
    campaign.healMember(member.id);
    assert.equal(campaign.credits, credits - cost);
  }
});

test('healMember restores member HP to maxHp', () => {
  const campaign = damagedCampaign({ hp: 1, maxHp: 4 });
  const member = campaign.crew[0];
  campaign.healMember(member.id);
  assert.equal(member.hp, member.maxHp);
});

test('healMember rejects a second heal for the same member this visit', () => {
  const campaign = damagedCampaign({ hp: 1, maxHp: 3, credits: 500 });
  const member = campaign.crew[0];
  campaign.healMember(member.id);
  member.hp = 1;
  assert.throws(() => campaign.healMember(member.id), /already healed this visit/i);
});

test('healMember allows healing two different members in the same visit', () => {
  const campaign = new Campaign({ seed: 42, credits: 500 });
  campaign.crew[0].hp = 1;
  campaign.crew[1].hp = 2;
  campaign.healMember(campaign.crew[0].id);
  campaign.healMember(campaign.crew[1].id);
  assert.equal(campaign.crew[0].hp, campaign.crew[0].maxHp);
  assert.equal(campaign.crew[1].hp, campaign.crew[1].maxHp);
});

test('healMember rejects flatlined members', () => {
  const campaign = damagedCampaign();
  const member = campaign.crew[0];
  campaign.flatlineMember(member.id);
  assert.throws(() => campaign.healMember(member.id), /flatlined/i);
});

test('healMember rejects members already at full HP', () => {
  const campaign = new Campaign({ seed: 42, credits: 100 });
  const member = campaign.crew[0];
  assert.throws(() => campaign.healMember(member.id), /full HP/i);
});

test('healMember rejects insufficient Creds', () => {
  const campaign = damagedCampaign({ hp: 1, maxHp: 5, credits: 10 });
  assert.throws(() => campaign.healMember(campaign.crew[0].id), /insufficient Creds/i);
});

test('healMember rejects unknown member id', () => {
  const campaign = damagedCampaign();
  assert.throws(() => campaign.healMember('nobody'), /unknown crew member/i);
});

test('healMember rejects calls when not in HUB', () => {
  const campaign = damagedCampaign();
  const member = campaign.crew[0];
  campaign.deployCrewMember(member.id, {
    seed: 1,
    objective: {
      kind: OBJECTIVES.REACH_EXIT,
      title: 'Extract',
      briefing: 'Reach the exit.',
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'job',
    context: testContractContext(OBJECTIVES.REACH_EXIT),
    reward: { credits: 0, repDelta: 0 },
  });
  assert.throws(() => campaign.healMember(member.id), /illegal from COMBAT/i);
});

test('healedThisVisit resets on enterHub', () => {
  const campaign = damagedCampaign({ hp: 1, maxHp: 3, credits: 500 });
  const member = campaign.crew[0];
  campaign.healMember(member.id);
  assert.ok(campaign.healedThisVisit.has(member.id));

  campaign.enterHub();
  assert.equal(campaign.healedThisVisit.size, 0);
});

test('healedThisVisit survives snapshot round-trip', () => {
  const campaign = damagedCampaign({ hp: 1, maxHp: 3, credits: 500 });
  const member = campaign.crew[0];
  campaign.healMember(member.id);

  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);

  assert.deepEqual([...restored.healedThisVisit], [member.id]);
});

test('pre-M5.3 snapshot restores healedThisVisit as empty set', () => {
  const campaign = new Campaign({ seed: 42 });
  const snap = snapshotCampaign(campaign) as Record<string, unknown>;
  delete snap.healedThisVisit;

  const restored = restoreCampaign(snap as never);
  assert.equal(restored.healedThisVisit.size, 0);
});
