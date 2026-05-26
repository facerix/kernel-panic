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
import { SALVAGE_TO_CRED_RATE, SHOP_COST } from '../../../src/game/constants.js';
import {
  emptySalvage,
  makeSalvage,
  totalSalvage,
} from '../../../src/game/salvage.js';
import { testContractContext } from './contractTestUtils.js';

const fakeContract = (overrides = {}) => ({
  seed: 12345,
  objective: {
    kind: OBJECTIVES.REACH_EXIT,
    title: 'Extract clean',
    briefing: 'Reach the exit.',
  },
  difficulty: 'standard',
  threatCount: 1,
  label: 'test job',
  context: testContractContext(OBJECTIVES.REACH_EXIT),
  reward: { credits: 0, repDelta: 0 },
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

test('Campaign starts in HUB with crew, salvage, credits, rep, and meta state', () => {
  const campaign = new Campaign({ seed: 42 });
  assert.equal(campaign.state, CAMPAIGN_STATE.HUB);
  // M4.2: salvage is a typed-empty wallet, not a number.
  assert.deepEqual(campaign.salvage, emptySalvage());
  assert.equal(totalSalvage(campaign.salvage), 0);
  assert.equal(campaign.credits, 0);
  assert.equal(campaign.rep, 20);
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
  const run = campaign.deployCrewMember(
    member.id,
    fakeContract({ reward: { credits: 50, repDelta: 0 } })
  );
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
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: makeSalvage({ scrap: 4 }) });
  assert.equal(campaign.state, CAMPAIGN_STATE.HUB);
  assert.equal(campaign.activeRun, null);
  assert.equal(campaign.salvage.scrap, 4);
  assert.equal(totalSalvage(campaign.salvage), 4);
  assert.equal(member.flatlined, false);
  assert.ok(campaign.world, 'hub world should be rebuilt');
});

test('onJobEnd with EXIT applies contract Cred and Rep rewards without spending salvage', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[1];
  const contract = fakeContract({
    reward: { credits: 60, repDelta: 7 },
  });
  const run = campaign.deployCrewMember(member.id, contract);
  run.enterCombat();
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: makeSalvage({ scrap: 4 }) });
  assert.equal(campaign.salvage.scrap, 4);
  assert.equal(campaign.credits, 60);
  assert.equal(campaign.rep, 27); // 20 start + 7 repDelta
});

test('onJobEnd with incomplete EXIT extracts salvage but skips contract rewards', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[1];
  const contract = fakeContract({
    reward: { credits: 60, repDelta: 7, recruit: true },
  });
  const run = campaign.deployCrewMember(member.id, contract);
  run.enterCombat();
  campaign.onJobEnd({
    outcome: OUTCOME.EXIT,
    salvage: makeSalvage({ scrap: 4 }),
    completed: false,
  });
  assert.equal(campaign.state, CAMPAIGN_STATE.HUB);
  assert.equal(campaign.salvage.scrap, 4);
  assert.equal(campaign.credits, 0);
  assert.equal(campaign.rep, 20);
  assert.equal(campaign.pendingRecruitReward, false);
  assert.equal(campaign.availableRecruits.length, 0);
  assert.equal(member.flatlined, false);
});

test('critical contract recruit reward creates a recruit lead without Rep gate', () => {
  const campaign = new Campaign({ seed: 42, rep: 20 });
  const member = campaign.crew[1];
  const contract = fakeContract({
    difficulty: 'critical',
    threatCount: 4,
    reward: { credits: 0, repDelta: 0, recruit: true },
  });
  const run = campaign.deployCrewMember(member.id, contract);
  run.enterCombat();
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: emptySalvage() });
  assert.equal(campaign.state, CAMPAIGN_STATE.HUB);
  assert.equal(campaign.pendingRecruitReward, false);
  assert.equal(campaign.availableRecruits.length, 1);
  const recruit = campaign.availableRecruits[0];
  campaign.recruit(recruit.id);
  assert.ok(campaign.crew.some(m => m.id === recruit.id));
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
  member.inventory.salvage = makeSalvage({ scrap: 7 });
  // Exit extracts inventory salvage (M4.2: typed wallet passed through).
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: makeSalvage({ scrap: 7 }) });
  assert.equal(campaign.salvage.scrap, 7, 'scrap accumulated from job');
  assert.equal(totalSalvage(campaign.salvage), 7);
});

test('onJobEnd with DEATH does not add salvage to the campaign pool', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[0];
  const run = campaign.deployCrewMember(
    member.id,
    fakeContract({ reward: { credits: 50, repDelta: 0 } })
  );
  run.enterCombat();
  member.initInventory();
  member.inventory.salvage = makeSalvage({ scrap: 5 });
  campaign.onJobEnd({ outcome: OUTCOME.DEATH });
  assert.equal(totalSalvage(campaign.salvage), 0, 'death forfeits salvage');
  assert.equal(campaign.credits, 0, 'death forfeits contract Creds');
});

// --- M3: persistence round-trip with inventory ----------------------------

test('crew inventory survives campaign snapshot/restore round-trip', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[0];
  member.initInventory();
  member.inventory.salvage = makeSalvage({ scrap: 7 });
  member.inventory.consumables = [];
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  const restoredMember = restored.crew[0];
  assert.deepEqual(restoredMember.inventory, {
    salvage: makeSalvage({ scrap: 7 }),
    consumables: [],
  });
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

test('sellSalvage converts campaign salvage into Creds at the fixed rate', () => {
  // M4.2: legacy `salvage: 8` migrates to `{ scrap: 8, ... }` via the
  // constructor's `migrateSalvage` shim — exercising the back-compat path
  // here keeps the legacy save shape green.
  const campaign = new Campaign({ seed: 42, salvage: 8, credits: 5 });
  campaign.sellSalvage(1);
  assert.equal(totalSalvage(campaign.salvage), 7);
  assert.equal(campaign.credits, 5 + SALVAGE_TO_CRED_RATE);
  campaign.sellSalvage(5);
  assert.equal(totalSalvage(campaign.salvage), 2);
  assert.equal(campaign.credits, 5 + 6 * SALVAGE_TO_CRED_RATE);
  campaign.sellSalvage(totalSalvage(campaign.salvage));
  assert.equal(totalSalvage(campaign.salvage), 0);
  assert.equal(campaign.credits, 5 + 8 * SALVAGE_TO_CRED_RATE);
});

test('sellSalvage throws on invalid quantities and oversell attempts', () => {
  const campaign = new Campaign({ seed: 42, salvage: 3 });
  assert.throws(() => campaign.sellSalvage(0), /positive integer/i);
  assert.throws(() => campaign.sellSalvage(1.5), /positive integer/i);
  assert.throws(() => campaign.sellSalvage(4), /insufficient salvage/i);
  assert.equal(totalSalvage(campaign.salvage), 3);
  assert.equal(campaign.credits, 0);
});

test('sellSalvage(quantity, type) sells from a specific bucket (M4.2)', () => {
  const campaign = new Campaign({ seed: 42, credits: 0 });
  campaign.salvage = makeSalvage({ scrap: 5, chips: 4, bio: 2, data: 1 });
  // Sell 3 chips specifically — other buckets must be untouched.
  campaign.sellSalvage(3, 'chips');
  assert.deepEqual(campaign.salvage, makeSalvage({ scrap: 5, chips: 1, bio: 2, data: 1 }));
  assert.equal(campaign.credits, 3 * SALVAGE_TO_CRED_RATE);

  // Insufficient chips → throws and wallet stays intact.
  assert.throws(() => campaign.sellSalvage(5, 'chips'), /insufficient chips/i);
  assert.equal(campaign.salvage.chips, 1, 'failed typed sell does not partial-debit');
});

test('untyped sellSalvage draws scrap → chips → bio → data in priority order (M4.2)', () => {
  const campaign = new Campaign({ seed: 42, credits: 0 });
  campaign.salvage = makeSalvage({ scrap: 2, chips: 2, bio: 2, data: 2 });
  // Sell 5 total: should drain scrap (2), then chips (2), then 1 from bio.
  campaign.sellSalvage(5);
  assert.deepEqual(campaign.salvage, makeSalvage({ scrap: 0, chips: 0, bio: 1, data: 2 }));
  assert.equal(campaign.credits, 5 * SALVAGE_TO_CRED_RATE);
});

test('sellSalvage rejects unknown salvage types (M4.2)', () => {
  const campaign = new Campaign({ seed: 42 });
  campaign.salvage = makeSalvage({ scrap: 5 });
  assert.throws(
    () => campaign.sellSalvage(1, 'nuclear-waste'),
    /unknown salvage type/i
  );
});

test('sellSalvage is illegal outside HUB state', () => {
  const campaign = new Campaign({ seed: 42, salvage: 3 });
  campaign.deployCrewMember(campaign.crew[0].id, fakeContract());
  assert.throws(() => campaign.sellSalvage(1), /illegal from/i);
});

test('purchase deducts Creds and adds a consumable to the target crew member', () => {
  const campaign = new Campaign({ seed: 42, salvage: 10, credits: SHOP_COST.STIM });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'stim', targetMemberId: member.id });
  assert.equal(totalSalvage(campaign.salvage), 10, 'salvage untouched by purchase');
  assert.equal(campaign.credits, 0);
  assert.ok(member.inventory, 'inventory should be initialised after purchase');
  assert.equal(member.inventory.consumables.length, 1);
  assert.equal(member.inventory.consumables[0].id, 'stim');
});

test('purchase applies campaign-scoped gear bonus (armour plating)', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.ARMOUR_PLATING });
  const member = campaign.crew[0];
  const origMaxHp = member.maxHp;
  campaign.purchase({ itemId: 'armour-plating', targetMemberId: member.id });
  assert.equal(campaign.credits, 0);
  assert.equal(member.maxHp, origMaxHp + 1);
  assert.equal(member.gear.maxHpBonus, 1);
});

test('purchase applies targeting chip gear bonus', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.TARGETING_CHIP });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'targeting-chip', targetMemberId: member.id });
  assert.equal(member.gear.hitBonus, 0.1);
});

test('purchase applies reflex weave gear bonus', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.REFLEX_WEAVE });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'reflex-weave', targetMemberId: member.id });
  assert.equal(member.gear.dodgeBonus, 0.1);
});

test('purchase sets meta flag for Expanded Catalog', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.EXPANDED_CATALOG });
  campaign.purchase({ itemId: 'expanded-catalog' });
  assert.equal(campaign.meta.expandedCatalog, true);
  assert.equal(campaign.credits, 0);
});

test('purchase sets meta flag for Better Contracts', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.BETTER_CONTRACTS });
  campaign.purchase({ itemId: 'better-contracts' });
  assert.equal(campaign.meta.betterContracts, true);
  assert.equal(campaign.credits, 0);
});

test('purchase rejects duplicate unique meta upgrades', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.EXPANDED_CATALOG * 2 });
  campaign.purchase({ itemId: 'expanded-catalog' });
  assert.throws(() => campaign.purchase({ itemId: 'expanded-catalog' }), /already purchased/i);
});

test('purchase throws on insufficient Creds', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.STIM - 1 });
  const member = campaign.crew[0];
  assert.throws(
    () => campaign.purchase({ itemId: 'stim', targetMemberId: member.id }),
    /insufficient Creds/i
  );
});

test('purchase throws when target is missing for items that need one', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.STIM });
  assert.throws(() => campaign.purchase({ itemId: 'stim' }), /requires a target/i);
});

test('purchase throws when target is flatlined', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.STIM });
  const member = campaign.crew[0];
  campaign.flatlineMember(member.id);
  assert.throws(
    () => campaign.purchase({ itemId: 'stim', targetMemberId: member.id }),
    /flatlined/i
  );
});

test('purchase is illegal outside HUB state', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.STIM });
  campaign.deployCrewMember(campaign.crew[0].id, fakeContract());
  assert.throws(
    () => campaign.purchase({ itemId: 'stim', targetMemberId: campaign.crew[0].id }),
    /illegal from/i
  );
});

// --- M4: onJobEnd clears job-scoped consumables ----------------------------

test('onJobEnd preserves consumables but clears salvage', () => {
  const campaign = new Campaign({ seed: 42, salvage: 10, credits: SHOP_COST.STIM * 2 });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'stim', targetMemberId: member.id });
  campaign.purchase({ itemId: 'stim', targetMemberId: member.id });
  assert.equal(member.inventory.consumables.length, 2);
  campaign.deployCrewMember(member.id, fakeContract());
  campaign.activeRun.enterCombat();
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: emptySalvage() });
  assert.equal(member.inventory.consumables.length, 2, 'consumables persist across jobs');
  assert.equal(totalSalvage(member.inventory.salvage), 0, 'salvage zeroed on job end');
});

test('crew member HP persists across jobs — no free heal on deploy', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[0];
  const startingHp = member.hp;

  // Deploy and enter combat — member takes damage.
  campaign.deployCrewMember(member.id, fakeContract());
  campaign.activeRun.enterCombat();
  member.hp = startingHp - 2; // simulate taking 2 damage
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: emptySalvage() });
  assert.equal(member.hp, startingHp - 2, 'HP should carry back from job');

  // Deploy again — HP must NOT reset to maxHp.
  campaign.deployCrewMember(member.id, fakeContract({ seed: 99 }));
  campaign.activeRun.enterCombat();
  assert.equal(member.hp, startingHp - 2, 'HP must persist into the next job');
});

// --- M4: persistence round-trip with gear and consumables ------------------

test('crew gear survives campaign snapshot/restore round-trip', () => {
  const campaign = new Campaign({
    seed: 42,
    credits: SHOP_COST.ARMOUR_PLATING + SHOP_COST.TARGETING_CHIP,
  });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'armour-plating', targetMemberId: member.id });
  campaign.purchase({ itemId: 'targeting-chip', targetMemberId: member.id });
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  const restoredMember = restored.crew[0];
  assert.deepEqual(restoredMember.gear, { maxHpBonus: 1, hitBonus: 0.1, dodgeBonus: 0 });
  assert.equal(restoredMember.maxHp, member.maxHp);
});

test('meta state survives campaign snapshot/restore round-trip', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.EXPANDED_CATALOG });
  campaign.purchase({ itemId: 'expanded-catalog' });
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  assert.equal(restored.meta.expandedCatalog, true);
});

test('consumables survive campaign snapshot/restore round-trip', () => {
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.STIM });
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
  const campaign = new Campaign({ seed: 42 }); // starts at 20
  const delta = campaign.adjustRep(10);
  assert.equal(campaign.rep, 30);
  assert.equal(delta, 10);
  // Clamp at 100.
  const overshoot = campaign.adjustRep(999);
  assert.equal(campaign.rep, 100);
  assert.equal(overshoot, 70); // 100 − 30
});

test('adjustRep lowers rep and clamps at 0', () => {
  const campaign = new Campaign({ seed: 42 }); // starts at 20
  const delta = campaign.adjustRep(-15);
  assert.equal(campaign.rep, 5);
  assert.equal(delta, -15);
  // Clamp at 0.
  const overshoot = campaign.adjustRep(-999);
  assert.equal(campaign.rep, 0);
  assert.equal(overshoot, -5); // 0 − 5
});

test('adjustRep with zero delta is a no-op', () => {
  const campaign = new Campaign({ seed: 42 });
  const delta = campaign.adjustRep(0);
  assert.equal(campaign.rep, 20);
  assert.equal(delta, 0);
});

test('adjustRep throws on non-finite delta', () => {
  const campaign = new Campaign({ seed: 42 });
  assert.throws(() => campaign.adjustRep(NaN), /finite/);
  assert.throws(() => campaign.adjustRep(Infinity), /finite/);
});

test('rep survives campaign snapshot/restore round-trip', () => {
  const campaign = new Campaign({ seed: 42 });
  campaign.adjustRep(15);
  assert.equal(campaign.rep, 35);
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  assert.equal(restored.rep, 35);
});

// ─── M6 — Recruitment ────────────────────────────────────────────────────────

test('generateRecruits returns 1–2 candidates when Rep ≥ 65', () => {
  const campaign = new Campaign({ seed: 99, rep: 65 });
  assert.ok(campaign.availableRecruits.length >= 1);
  assert.ok(campaign.availableRecruits.length <= 2);
});

test('generateRecruits returns empty when Rep < 65', () => {
  const campaign = new Campaign({ seed: 99, rep: 64 });
  assert.equal(campaign.availableRecruits.length, 0);
});

test('generateRecruits archetype weights approximate 40/40/20 over many seeds', () => {
  const counts: Record<string, number> = { Merc: 0, Razor: 0, Tech: 0 };
  const total = 1000;
  for (let i = 0; i < total; i++) {
    const campaign = new Campaign({ seed: i, rep: 80 });
    for (const recruit of campaign.availableRecruits) {
      counts[recruit.constructor.name]++;
    }
  }
  const sum = counts.Merc + counts.Razor + counts.Tech;
  // Merc and Razor should each be ~40%, Tech ~20%. Allow ±8% tolerance.
  assert.ok(counts.Merc / sum > 0.32, `Merc ${((counts.Merc / sum) * 100).toFixed(1)}% < 32%`);
  assert.ok(counts.Merc / sum < 0.48, `Merc ${((counts.Merc / sum) * 100).toFixed(1)}% > 48%`);
  assert.ok(counts.Razor / sum > 0.32, `Razor ${((counts.Razor / sum) * 100).toFixed(1)}% < 32%`);
  assert.ok(counts.Razor / sum < 0.48, `Razor ${((counts.Razor / sum) * 100).toFixed(1)}% > 48%`);
  assert.ok(counts.Tech / sum > 0.12, `Tech ${((counts.Tech / sum) * 100).toFixed(1)}% < 12%`);
  assert.ok(counts.Tech / sum < 0.28, `Tech ${((counts.Tech / sum) * 100).toFixed(1)}% > 28%`);
});

test('generateRecruits deduplicates callsigns against flatlined crew members', () => {
  const campaign = new Campaign({ seed: 42, rep: 80 });
  // Flatline all starter crew — their callsigns should still be excluded
  for (const member of campaign.crew) {
    member.flatlined = true;
  }
  // Regenerate recruits (simulates next hub visit)
  campaign.enterHub();
  const starterCallsigns = new Set(campaign.crew.map(m => m.callsign));
  for (const recruit of campaign.availableRecruits) {
    assert.ok(
      !starterCallsigns.has(recruit.callsign),
      `Recruit callsign "${recruit.callsign}" collides with flatlined crew member`
    );
  }
});

test('generateRecruits deduplicates callsigns within the same batch', () => {
  // Over many seeds, no single batch should have duplicate callsigns
  for (let i = 0; i < 200; i++) {
    const campaign = new Campaign({ seed: i, rep: 80 });
    const callsigns = campaign.availableRecruits.map(r => r.callsign);
    assert.equal(
      callsigns.length,
      new Set(callsigns).size,
      `Seed ${i}: duplicate callsigns in batch: ${callsigns}`
    );
  }
});

test('recruit() moves a recruit from availableRecruits into crew', () => {
  const campaign = new Campaign({ seed: 7, rep: 80 });
  assert.ok(campaign.availableRecruits.length > 0, 'Precondition: has recruits');
  const recruit = campaign.availableRecruits[0];
  const recruitId = recruit.id;
  const crewSizeBefore = campaign.crew.length;

  campaign.recruit(recruitId);

  assert.equal(campaign.crew.length, crewSizeBefore + 1);
  assert.ok(campaign.crew.some(m => m.id === recruitId));
  assert.ok(!campaign.availableRecruits.some(r => r.id === recruitId));
});

test('recruit() sets recruitedThisVisit and prevents second recruitment', () => {
  const campaign = new Campaign({ seed: 7, rep: 80 });
  assert.equal(campaign.recruitedThisVisit, false);
  const recruit = campaign.availableRecruits[0];

  campaign.recruit(recruit.id);

  assert.equal(campaign.recruitedThisVisit, true);
  // If there's a second recruit available, trying to recruit them should throw
  if (campaign.availableRecruits.length > 0) {
    assert.throws(() => campaign.recruit(campaign.availableRecruits[0].id), /already recruited/i);
  }
});

test('recruit() throws for unknown recruitId', () => {
  const campaign = new Campaign({ seed: 7, rep: 80 });
  assert.throws(() => campaign.recruit('nonexistent'), /unknown recruit/i);
});

test('recruit() throws when Rep drops below threshold before recruiting', () => {
  const campaign = new Campaign({ seed: 7, rep: 65 });
  assert.ok(campaign.availableRecruits.length > 0, 'Precondition: has recruits');
  const recruit = campaign.availableRecruits[0];
  // Drop rep below threshold after recruits were generated
  campaign.adjustRep(-20);
  assert.throws(() => campaign.recruit(recruit.id), /rep/i);
});

test('recruitedThisVisit resets on enterHub', () => {
  const campaign = new Campaign({ seed: 7, rep: 80 });
  const recruit = campaign.availableRecruits[0];
  campaign.recruit(recruit.id);
  assert.equal(campaign.recruitedThisVisit, true);

  // Simulate returning from a job
  campaign.enterHub();
  assert.equal(campaign.recruitedThisVisit, false);
});

test('availableRecruits and recruitedThisVisit survive persistence round-trip', () => {
  const campaign = new Campaign({ seed: 55, rep: 80 });
  assert.ok(campaign.availableRecruits.length > 0, 'Precondition: has recruits');
  const recruitCallsign = campaign.availableRecruits[0].callsign;

  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);

  assert.equal(restored.availableRecruits.length, campaign.availableRecruits.length);
  assert.equal(restored.availableRecruits[0].callsign, recruitCallsign);
  assert.equal(restored.recruitedThisVisit, false);
});

test('pre-M6 snapshot restores with empty availableRecruits', () => {
  // Simulate a legacy snapshot without the M6 fields
  const campaign = new Campaign({ seed: 42 });
  const snap = snapshotCampaign(campaign) as Record<string, unknown>;
  delete snap.availableRecruits;
  delete snap.recruitedThisVisit;

  const restored = restoreCampaign(snap as never);
  assert.deepEqual(restored.availableRecruits, []);
  assert.equal(restored.recruitedThisVisit, false);
});

test('backfillRecruitsIfEligible fills empty pool when Rep meets threshold', () => {
  const campaign = new Campaign({ seed: 3, rep: 80 });
  assert.ok(campaign.availableRecruits.length > 0);
  campaign.availableRecruits = [];
  campaign.backfillRecruitsIfEligible();
  assert.ok(campaign.availableRecruits.length >= 1);
});

test('backfillRecruitsIfEligible is a no-op when Rep is below threshold', () => {
  const campaign = new Campaign({ seed: 3, rep: 50 });
  assert.equal(campaign.availableRecruits.length, 0);
  campaign.backfillRecruitsIfEligible();
  assert.equal(campaign.availableRecruits.length, 0);
});

test('backfillRecruitsIfEligible does not run when recruitedThisVisit is true', () => {
  const campaign = new Campaign({ seed: 3, rep: 80 });
  campaign.recruit(campaign.availableRecruits[0].id);
  campaign.availableRecruits = [];
  campaign.backfillRecruitsIfEligible();
  assert.equal(campaign.availableRecruits.length, 0);
});

// ─── M6 Phase B — Campaign-start rework ──────────────────────────────────────

test('Campaign with crew: [] starts without entering the Hub', () => {
  const campaign = new Campaign({ seed: 42, crew: [] });
  assert.equal(campaign.crew.length, 0);
  assert.equal(campaign.state, CAMPAIGN_STATE.HUB);
  // Hub world should NOT be built when crew is empty (no persist yet).
  assert.equal(campaign.world, null);
  assert.equal(campaign.player, null);
});

test('generateInitialCandidates returns RECRUIT.INITIAL_CANDIDATES (3) candidates', () => {
  const campaign = new Campaign({ seed: 42, crew: [] });
  const candidates = campaign.generateInitialCandidates();
  assert.equal(candidates.length, 3);
  // All candidates should have unique callsigns.
  const callsigns = candidates.map(c => c.callsign);
  assert.equal(new Set(callsigns).size, 3, `Duplicate callsigns: ${callsigns}`);
  // All should have unique IDs.
  const ids = candidates.map(c => c.id);
  assert.equal(new Set(ids).size, 3);
});

test('generateInitialCandidates uses weighted archetype pool', () => {
  const counts: Record<string, number> = { Merc: 0, Razor: 0, Tech: 0 };
  const total = 500;
  for (let i = 0; i < total; i++) {
    const campaign = new Campaign({ seed: i, crew: [] });
    const candidates = campaign.generateInitialCandidates();
    for (const c of candidates) {
      counts[c.constructor.name]++;
    }
  }
  const sum = counts.Merc + counts.Razor + counts.Tech;
  // Merc and Razor should each be ~40%, Tech ~20%. Allow ±10% tolerance.
  assert.ok(counts.Merc / sum > 0.3, `Merc ${((counts.Merc / sum) * 100).toFixed(1)}% < 30%`);
  assert.ok(counts.Merc / sum < 0.5, `Merc ${((counts.Merc / sum) * 100).toFixed(1)}% > 50%`);
  assert.ok(counts.Tech / sum > 0.1, `Tech ${((counts.Tech / sum) * 100).toFixed(1)}% < 10%`);
  assert.ok(counts.Tech / sum < 0.3, `Tech ${((counts.Tech / sum) * 100).toFixed(1)}% > 30%`);
});

test('recruitInitial validates exactly RECRUIT.INITIAL_PICKS (2) IDs', () => {
  const campaign = new Campaign({ seed: 42, crew: [] });
  campaign.generateInitialCandidates();
  const ids = campaign.initialCandidates.map(c => c.id);

  assert.throws(() => campaign.recruitInitial([ids[0]]), /exactly 2/i);
  assert.throws(() => campaign.recruitInitial(ids), /exactly 2/i);
  assert.throws(() => campaign.recruitInitial([]), /exactly 2/i);
});

test('recruitInitial moves selected candidates into crew', () => {
  const campaign = new Campaign({ seed: 42, crew: [] });
  campaign.generateInitialCandidates();
  const picked = campaign.initialCandidates.slice(0, 2);
  const pickedIds = picked.map(c => c.id);
  const discardedId = campaign.initialCandidates[2].id;

  campaign.recruitInitial(pickedIds);

  assert.equal(campaign.crew.length, 2);
  assert.ok(campaign.crew.some(m => m.id === pickedIds[0]));
  assert.ok(campaign.crew.some(m => m.id === pickedIds[1]));
  assert.ok(!campaign.crew.some(m => m.id === discardedId));
  // initialCandidates should be cleared after recruitment.
  assert.equal(campaign.initialCandidates.length, 0);
});

test('recruitInitial throws for unknown candidate IDs', () => {
  const campaign = new Campaign({ seed: 42, crew: [] });
  campaign.generateInitialCandidates();
  const validId = campaign.initialCandidates[0].id;

  assert.throws(() => campaign.recruitInitial([validId, 'nonexistent']), /unknown candidate/i);
});

test('recruitInitial does not require Rep gate', () => {
  // Fresh campaign has rep=20, below the 65 threshold — but initial
  // recruitment bypasses the gate.
  const campaign = new Campaign({ seed: 42, crew: [], rep: 20 });
  campaign.generateInitialCandidates();
  const ids = campaign.initialCandidates.slice(0, 2).map(c => c.id);

  // Should NOT throw despite low rep.
  campaign.recruitInitial(ids);
  assert.equal(campaign.crew.length, 2);
});
