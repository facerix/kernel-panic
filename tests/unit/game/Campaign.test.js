import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Campaign,
  CAMPAIGN_STATE,
  buildCrew,
  willEndCampaignOnThisDeath,
} from '../../../src/game/Campaign.js';
import { OUTCOME, RUN_STATE } from '../../../src/game/Run.js';
import { Rng } from '../../../src/rng.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';

const fakeContract = (overrides = {}) => ({
  seed: 12345,
  objective: OBJECTIVES.REACH_EXIT,
  threatCount: 1,
  label: 'test job',
  ...overrides,
});

test('buildCrew creates one named member per starter archetype with unique callsigns', () => {
  const crew = buildCrew(new Rng(0xc0ffee));
  assert.equal(crew.length, 3);
  assert.deepEqual(
    crew.map(member => member.constructor.name),
    ['Merc', 'Razor', 'Tech']
  );
  assert.equal(new Set(crew.map(member => member.callsign)).size, 3);
  assert.deepEqual(
    crew.map(member => member.flatlined),
    [false, false, false]
  );
});

test('Campaign starts in HUB with crew, salvage, vouch, and meta state', () => {
  const campaign = new Campaign({ seed: 42 });
  assert.equal(campaign.state, CAMPAIGN_STATE.HUB);
  assert.equal(campaign.salvage, 0);
  assert.equal(campaign.vouch, 50);
  assert.deepEqual(campaign.meta, {});
  assert.equal(campaign.crew.length, 3);
  assert.ok(campaign.world);
  assert.ok(campaign.player);
  assert.ok(campaign.curator);
  assert.ok(campaign.terminal);
});

test('deployCrewMember starts a job Run for a non-flatlined crew member', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[0];
  const run = campaign.deployCrewMember(member.id, fakeContract());
  assert.equal(campaign.state, CAMPAIGN_STATE.COMBAT);
  assert.equal(campaign.activeRun, run);
  assert.equal(run.state, RUN_STATE.BRIEFING);
  assert.equal(run.crewMember, member);
  assert.equal(run.contract.label, 'test job');
});

test('deployCrewMember rejects flatlined or unknown crew members', () => {
  const campaign = new Campaign({ seed: 42 });
  campaign.flatlineMember(campaign.crew[0].id);
  assert.throws(() => campaign.deployCrewMember(campaign.crew[0].id, fakeContract()), /flatlined/);
  assert.throws(() => campaign.deployCrewMember('missing', fakeContract()), /unknown crew/i);
});

test('onJobEnd returns survivors to HUB and accumulates extracted salvage', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[1];
  const run = campaign.deployCrewMember(member.id, fakeContract());
  run.enterCombat();
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: 4 });
  assert.equal(campaign.state, CAMPAIGN_STATE.HUB);
  assert.equal(campaign.activeRun, null);
  assert.equal(campaign.salvage, 4);
  assert.equal(member.flatlined, false);
  assert.ok(campaign.world, 'hub world should be rebuilt');
});

test('willEndCampaignOnThisDeath is true only for the last surviving crew slot', () => {
  const campaign = new Campaign({ seed: 42 });
  assert.equal(willEndCampaignOnThisDeath(campaign), false);
  campaign.flatlineMember(campaign.crew[0].id);
  campaign.flatlineMember(campaign.crew[1].id);
  assert.equal(willEndCampaignOnThisDeath(campaign), true);
  assert.throws(() => willEndCampaignOnThisDeath(null), /Campaign-like/);
});

test('onJobEnd flatlines deaths and ends the campaign when everyone is gone', () => {
  const campaign = new Campaign({ seed: 42 });
  for (const member of campaign.crew) {
    campaign.deployCrewMember(member.id, fakeContract());
    campaign.activeRun.enterCombat();
    campaign.onJobEnd({ outcome: OUTCOME.DEATH });
  }
  assert.equal(campaign.state, CAMPAIGN_STATE.ENDED);
  assert.equal(campaign.activeRun, null);
  assert.deepEqual(
    campaign.crew.map(member => member.flatlined),
    [true, true, true]
  );
});
