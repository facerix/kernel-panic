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
import { snapshotCampaign, restoreCampaign } from '../../../src/game/persistence.js';

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

test('Campaign starts in HUB with crew, salvage, rep, and meta state', () => {
  const campaign = new Campaign({ seed: 42 });
  assert.equal(campaign.state, CAMPAIGN_STATE.HUB);
  assert.equal(campaign.salvage, 0);
  assert.equal(campaign.rep, 50);
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

// --- M3: salvage extraction from inventory --------------------------------

test('onJobEnd with EXIT transfers crew inventory salvage to campaign pool', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[0];
  const run = campaign.deployCrewMember(member.id, fakeContract());
  run.enterCombat();
  // Simulate the crew member collecting salvage during the job.
  member.initInventory();
  member.inventory.salvage = 7;
  // Exit extracts inventory salvage.
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: 7 });
  assert.equal(campaign.salvage, 7, 'salvage accumulated from job');
});

test('onJobEnd with DEATH does not add salvage to the campaign pool', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[0];
  const run = campaign.deployCrewMember(member.id, fakeContract());
  run.enterCombat();
  member.initInventory();
  member.inventory.salvage = 5;
  campaign.onJobEnd({ outcome: OUTCOME.DEATH });
  assert.equal(campaign.salvage, 0, 'death forfeits salvage');
});

// --- M3: persistence round-trip with inventory ----------------------------

test('crew inventory survives campaign snapshot/restore round-trip', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[0];
  member.initInventory();
  member.inventory.salvage = 7;
  member.inventory.consumables = [];
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  const restoredMember = restored.crew[0];
  assert.deepEqual(restoredMember.inventory, { salvage: 7, consumables: [] });
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

// --- M4: Campaign spawns Finn in the Hub ----------------------------------

test('Campaign Hub world includes Finn NPC', () => {
  const campaign = new Campaign({ seed: 42 });
  assert.ok(campaign.finn, 'Finn should be spawned in the Hub');
  assert.equal(campaign.finn.glyph, '¥');
  assert.equal(campaign.finn.faction, 'neutral');
});

// --- M4: Campaign.purchase ------------------------------------------------

test('purchase deducts salvage and adds a consumable to the target crew member', () => {
  const campaign = new Campaign({ seed: 42, salvage: 10 });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'stim', targetMemberId: member.id });
  assert.equal(campaign.salvage, 10 - 2); // SHOP_COST.STIM = 2
  assert.ok(member.inventory, 'inventory should be initialised after purchase');
  assert.equal(member.inventory.consumables.length, 1);
  assert.equal(member.inventory.consumables[0].id, 'stim');
});

test('purchase applies campaign-scoped gear bonus (armour plating)', () => {
  const campaign = new Campaign({ seed: 42, salvage: 20 });
  const member = campaign.crew[0];
  const origMaxHp = member.maxHp;
  campaign.purchase({ itemId: 'armour-plating', targetMemberId: member.id });
  assert.equal(campaign.salvage, 20 - 6); // SHOP_COST.ARMOUR_PLATING = 6
  assert.equal(member.maxHp, origMaxHp + 1);
  assert.equal(member.gear.maxHpBonus, 1);
});

test('purchase applies targeting chip gear bonus', () => {
  const campaign = new Campaign({ seed: 42, salvage: 20 });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'targeting-chip', targetMemberId: member.id });
  assert.equal(member.gear.hitBonus, 0.1);
});

test('purchase sets meta flag for Expanded Catalog', () => {
  const campaign = new Campaign({ seed: 42, salvage: 20 });
  campaign.purchase({ itemId: 'expanded-catalog' });
  assert.equal(campaign.meta.expandedCatalog, true);
  assert.equal(campaign.salvage, 20 - 15);
});

test('purchase rejects duplicate unique meta upgrades', () => {
  const campaign = new Campaign({ seed: 42, salvage: 40 });
  campaign.purchase({ itemId: 'expanded-catalog' });
  assert.throws(() => campaign.purchase({ itemId: 'expanded-catalog' }), /already purchased/i);
});

test('purchase throws on insufficient salvage', () => {
  const campaign = new Campaign({ seed: 42, salvage: 1 });
  const member = campaign.crew[0];
  assert.throws(
    () => campaign.purchase({ itemId: 'stim', targetMemberId: member.id }),
    /insufficient salvage/i
  );
});

test('purchase throws when target is missing for items that need one', () => {
  const campaign = new Campaign({ seed: 42, salvage: 10 });
  assert.throws(() => campaign.purchase({ itemId: 'stim' }), /requires a target/i);
});

test('purchase throws when target is flatlined', () => {
  const campaign = new Campaign({ seed: 42, salvage: 10 });
  const member = campaign.crew[0];
  campaign.flatlineMember(member.id);
  assert.throws(
    () => campaign.purchase({ itemId: 'stim', targetMemberId: member.id }),
    /flatlined/i
  );
});

test('purchase is illegal outside HUB state', () => {
  const campaign = new Campaign({ seed: 42, salvage: 10 });
  campaign.deployCrewMember(campaign.crew[0].id, fakeContract());
  assert.throws(
    () => campaign.purchase({ itemId: 'stim', targetMemberId: campaign.crew[0].id }),
    /illegal from/i
  );
});

// --- M4: onJobEnd clears job-scoped consumables ----------------------------

test('onJobEnd preserves consumables but clears salvage', () => {
  const campaign = new Campaign({ seed: 42, salvage: 10 });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'stim', targetMemberId: member.id });
  campaign.purchase({ itemId: 'stim', targetMemberId: member.id });
  assert.equal(member.inventory.consumables.length, 2);
  campaign.deployCrewMember(member.id, fakeContract());
  campaign.activeRun.enterCombat();
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: 0 });
  assert.equal(member.inventory.consumables.length, 2, 'consumables persist across jobs');
  assert.equal(member.inventory.salvage, 0, 'salvage zeroed on job end');
});

test('crew member HP persists across jobs — no free heal on deploy', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[0];
  const startingHp = member.hp;

  // Deploy and enter combat — member takes damage.
  campaign.deployCrewMember(member.id, fakeContract());
  campaign.activeRun.enterCombat();
  member.hp = startingHp - 2; // simulate taking 2 damage
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: 0 });
  assert.equal(member.hp, startingHp - 2, 'HP should carry back from job');

  // Deploy again — HP must NOT reset to maxHp.
  campaign.deployCrewMember(member.id, fakeContract({ seed: 99 }));
  campaign.activeRun.enterCombat();
  assert.equal(member.hp, startingHp - 2, 'HP must persist into the next job');
});

// --- M4: persistence round-trip with gear and consumables ------------------

test('crew gear survives campaign snapshot/restore round-trip', () => {
  const campaign = new Campaign({ seed: 42, salvage: 20 });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'armour-plating', targetMemberId: member.id });
  campaign.purchase({ itemId: 'targeting-chip', targetMemberId: member.id });
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  const restoredMember = restored.crew[0];
  assert.deepEqual(restoredMember.gear, { maxHpBonus: 1, hitBonus: 0.1 });
  assert.equal(restoredMember.maxHp, member.maxHp);
});

test('meta state survives campaign snapshot/restore round-trip', () => {
  const campaign = new Campaign({ seed: 42, salvage: 20 });
  campaign.purchase({ itemId: 'expanded-catalog' });
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  assert.equal(restored.meta.expandedCatalog, true);
});

test('consumables survive campaign snapshot/restore round-trip', () => {
  const campaign = new Campaign({ seed: 42, salvage: 10 });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'stim', targetMemberId: member.id });
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  const restoredMember = restored.crew[0];
  assert.equal(restoredMember.inventory.consumables.length, 1);
  assert.equal(restoredMember.inventory.consumables[0].id, 'stim');
});

// --- M5: Rep meter -----------------------------------------------------------

test('adjustRep raises rep and clamps at 100', () => {
  const campaign = new Campaign({ seed: 42 }); // starts at 50
  const delta = campaign.adjustRep(10);
  assert.equal(campaign.rep, 60);
  assert.equal(delta, 10);
  // Clamp at 100.
  const overshoot = campaign.adjustRep(999);
  assert.equal(campaign.rep, 100);
  assert.equal(overshoot, 40); // 100 − 60
});

test('adjustRep lowers rep and clamps at 0', () => {
  const campaign = new Campaign({ seed: 42 }); // starts at 50
  const delta = campaign.adjustRep(-20);
  assert.equal(campaign.rep, 30);
  assert.equal(delta, -20);
  // Clamp at 0.
  const overshoot = campaign.adjustRep(-999);
  assert.equal(campaign.rep, 0);
  assert.equal(overshoot, -30); // 0 − 30
});

test('adjustRep with zero delta is a no-op', () => {
  const campaign = new Campaign({ seed: 42 });
  const delta = campaign.adjustRep(0);
  assert.equal(campaign.rep, 50);
  assert.equal(delta, 0);
});

test('adjustRep throws on non-finite delta', () => {
  const campaign = new Campaign({ seed: 42 });
  assert.throws(() => campaign.adjustRep(NaN), /finite/);
  assert.throws(() => campaign.adjustRep(Infinity), /finite/);
});

test('rep survives campaign snapshot/restore round-trip', () => {
  const campaign = new Campaign({ seed: 42 });
  campaign.adjustRep(-15);
  assert.equal(campaign.rep, 35);
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  assert.equal(restored.rep, 35);
});
