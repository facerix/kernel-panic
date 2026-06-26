import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Campaign,
  CAMPAIGN_STATE,
  CLOCK_ACT2_DEADLINE_JOBS,
  CLOCK_ACT2_GRACE_JOBS,
  SCORE_CREDITS_REWARD,
  SITE_ROSTER_CAP,
  buildCrew,
  defaultCampaignArc,
  willEndCampaignAfterResult,
  willEndCampaignOnThisDeath,
} from '../../../src/game/Campaign.js';
import { OUTCOME, RUN_STATE } from '../../../src/game/Run.js';
import { Rng } from '../../../src/rng.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { snapshotCampaign, restoreCampaign } from '../../../src/game/persistence.js';
import {
  CONTRACT_DIFFICULTY,
  SALVAGE_SELL_RATE,
  SHOP_COST,
  TILE,
} from '../../../src/game/constants.js';
import { emptySalvage, makeSalvage, totalSalvage } from '../../../src/game/salvage.js';
import { testContractContext } from './contractTestUtils.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import type { LocationSite } from '../../../src/types.js';

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

function validSite(overrides: Partial<LocationSite> = {}): LocationSite {
  return {
    id: '12345',
    seed: '12345',
    mapWidth: 24,
    mapHeight: 16,
    label: '// Matsuda contractor annex - payroll mirror',
    tier: 'roster',
    scoreTarget: false,
    mutationDeltas: [],
    seenKeys: [],
    lastVisitedJob: 0,
    ...overrides,
  };
}

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
  assert.deepEqual(campaign.salvage, emptySalvage());
  assert.equal(totalSalvage(campaign.salvage), 0);
  assert.equal(campaign.credits, 0);
  assert.equal(campaign.rep, 20);
  assert.deepEqual(campaign.meta, {});
  assert.deepEqual(campaign.arc, defaultCampaignArc());
  assert.equal(campaign.arcStage, 'act-1');
  assert.equal(campaign.crew.length, 3);
  assert.ok(campaign.world);
  assert.ok(campaign.player);
  assert.ok(campaign.curator);
  assert.ok(campaign.terminal);
});

test('Campaign accepts and exposes a valid Phase 3 arc record', () => {
  const campaign = new Campaign({
    seed: 42,
    arc: {
      arcStage: 'act-2',
      deckerRecruited: true,
      scoreRevealed: true,
      clockStarted: false,
      scoreAttempted: false,
      scoreCompleted: false,
    },
  });

  assert.equal(campaign.arcStage, 'act-2');
  assert.deepEqual(campaign.arc, {
    arcStage: 'act-2',
    deckerRecruited: true,
    scoreRevealed: true,
    clockStarted: false,
    scoreAttempted: false,
    scoreCompleted: false,
  });
});

test('Campaign rejects malformed Phase 3 arc records', () => {
  assert.throws(() => new Campaign({ seed: 42, arc: null }), /arc must be an object/i);
  assert.throws(
    () =>
      new Campaign({
        seed: 42,
        arc: {
          arcStage: 'act-x',
          deckerRecruited: false,
          scoreRevealed: false,
          clockStarted: false,
          scoreAttempted: false,
          scoreCompleted: false,
        },
      }),
    /arcStage/
  );
  assert.throws(
    () =>
      new Campaign({
        seed: 42,
        arc: {
          arcStage: 'act-1',
          deckerRecruited: false,
          scoreRevealed: false,
          clockStarted: false,
          scoreAttempted: false,
        },
      }),
    /scoreCompleted/
  );
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

test('P3.M7: casing jobs append arc-aware chronicle entries and survive snapshot restore', () => {
  const campaign = new Campaign({ seed: 42, rep: 65, completedJobs: 4 });
  const scoreTarget = campaign.siteRoster.find(site => site.scoreTarget);
  assert.ok(scoreTarget?.principal);
  assert.ok(
    campaign.chronicle.some(entry => entry.title === 'STAGE 2 — SCORE REVEALED'),
    'Act 2 transition should log the Score reveal'
  );

  const decker = campaign.crew.find(member => member.archetype === 'Decker');
  assert.ok(decker);
  const contract = fakeContract({
    label: '// Matsuda payroll cache //',
    context: {
      ...testContractContext(OBJECTIVES.REACH_EXIT),
      principal: scoreTarget!.principal,
      site: { id: 'payroll-cache', label: 'payroll cache', groups: ['corp', 'data'] },
      locationSiteId: 'case-payroll-cache',
    },
    reward: { credits: 120, repDelta: 5 },
  });

  campaign.deployCrewMember(decker!.id, contract);
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: emptySalvage(), completed: true });

  const entry = campaign.chronicle.at(-1);
  assert.ok(entry);
  assert.equal(entry!.kind, 'job');
  assert.match(entry!.title, /^CASING/);
  assert.match(entry!.summary, /another read/i);
  assert.ok(entry!.detailLines.some(line => line.includes('Rep +5 | Credits +120')));

  const restored = restoreCampaign(snapshotCampaign(campaign));
  assert.equal(restored.chronicle.length, campaign.chronicle.length);
  assert.deepEqual(restored.chronicle.at(-1), entry);
});

test('P3.M7: pending chronicle run survives restore and settles into a job entry', () => {
  const campaign = new Campaign({ seed: 99 });
  const member = campaign.crew[0]!;
  const contract = fakeContract({
    label: 'warehouse ghost',
    reward: { credits: 40, repDelta: 2 },
  });

  campaign.deployCrewMember(member.id, contract);
  const restored = restoreCampaign(snapshotCampaign(campaign));
  assert.ok(restored.pendingChronicleRun, 'mid-run chronicle baseline should persist');

  restored.onJobEnd({ outcome: OUTCOME.EXIT, salvage: emptySalvage(), completed: true });

  const entry = restored.chronicle.at(-1);
  assert.ok(entry);
  assert.equal(entry!.kind, 'job');
  assert.match(entry!.summary, /street-level/i);
  assert.ok(entry!.detailLines.some(line => line.includes('Rep +2 | Credits +40')));
});

test('onJobEnd with incomplete EXIT (abort) forfeits salvage and applies rep penalty', () => {
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
  assert.equal(campaign.salvage.scrap, 0, 'salvage forfeited on abort');
  assert.equal(campaign.credits, 0, 'no cred reward on abort');
  assert.equal(campaign.rep, 10, 'rep = 20 start + ABORT_PENALTY (-10)');
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

// --- salvage extraction from inventory --------------------------------

test('onJobEnd with EXIT transfers crew inventory salvage to campaign pool', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[0];
  const run = campaign.deployCrewMember(member.id, fakeContract());
  run.enterCombat();
  // Simulate the crew member collecting salvage during the job.
  member.initInventory();
  member.inventory.salvage = makeSalvage({ scrap: 7 });
  // Exit extracts inventory salvage (typed wallet passed through).
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

// --- persistence round-trip with inventory ----------------------------

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

// --- Progressive Hub reveals ----------------------------------------

test('fresh Campaign Hub omits Finn and Clinic until introduced', () => {
  const campaign = new Campaign({ seed: 42 });
  assert.equal(campaign.finn, null);
  assert.equal(campaign.clinic, null);
});

test('Campaign Hub spawns Finn after finnIntroduced', () => {
  const campaign = new Campaign({
    seed: 42,
    hubReveals: { finnIntroduced: true },
  });
  assert.ok(campaign.finn, 'Finn should be spawned in the Hub');
  assert.equal(campaign.finn.glyph, '¥');
  assert.equal(campaign.finn.faction, 'neutral');
});

test('Campaign Hub spawns Patch after clinicIntroduced', () => {
  const campaign = new Campaign({
    seed: 42,
    hubReveals: { clinicIntroduced: true },
  });
  assert.ok(campaign.clinic, 'Clinic should be spawned in the Hub');
  assert.equal(campaign.clinic.glyph, '⧰');
  assert.equal(campaign.clinic.faction, 'neutral');
});

// --- Campaign.purchase ------------------------------------------------

test('sellSalvage converts campaign salvage into Creds at per-type rates', () => {
  // per-type sell rates. Legacy `salvage: 8` migrates to scrap.
  const campaign = new Campaign({ seed: 42, salvage: 8, credits: 5 });
  campaign.sellSalvage(1);
  assert.equal(totalSalvage(campaign.salvage), 7);
  assert.equal(campaign.credits, 5 + SALVAGE_SELL_RATE.scrap); // 5 + 8 = 13
  campaign.sellSalvage(5);
  assert.equal(totalSalvage(campaign.salvage), 2);
  assert.equal(campaign.credits, 5 + 6 * SALVAGE_SELL_RATE.scrap); // 5 + 48 = 53
  campaign.sellSalvage(totalSalvage(campaign.salvage));
  assert.equal(totalSalvage(campaign.salvage), 0);
  assert.equal(campaign.credits, 5 + 8 * SALVAGE_SELL_RATE.scrap); // 5 + 64 = 69
});

test('sellSalvage throws on invalid quantities and oversell attempts', () => {
  const campaign = new Campaign({ seed: 42, salvage: 3 });
  assert.throws(() => campaign.sellSalvage(0), /positive integer/i);
  assert.throws(() => campaign.sellSalvage(1.5), /positive integer/i);
  assert.throws(() => campaign.sellSalvage(4), /insufficient salvage/i);
  assert.equal(totalSalvage(campaign.salvage), 3);
  assert.equal(campaign.credits, 0);
});

test('sellSalvage(quantity, type) sells from a specific bucket at its rate', () => {
  const campaign = new Campaign({ seed: 42, credits: 0 });
  campaign.salvage = makeSalvage({ scrap: 5, chips: 4, bio: 2, data: 1 });
  // Sell 3 chips specifically at the chips rate.
  campaign.sellSalvage(3, 'chips');
  assert.deepEqual(campaign.salvage, makeSalvage({ scrap: 5, chips: 1, bio: 2, data: 1 }));
  assert.equal(campaign.credits, 3 * SALVAGE_SELL_RATE.chips); // 3 * 12 = 36

  // Insufficient chips → throws and wallet stays intact.
  assert.throws(() => campaign.sellSalvage(5, 'chips'), /insufficient chips/i);
  assert.equal(campaign.salvage.chips, 1, 'failed typed sell does not partial-debit');
});

test('untyped sellSalvage draws scrap → chips → bio → data applying per-type rates', () => {
  const campaign = new Campaign({ seed: 42, credits: 0 });
  campaign.salvage = makeSalvage({ scrap: 2, chips: 2, bio: 2, data: 2 });
  // Sell 5 total: drains scrap (2), then chips (2), then 1 from bio.
  // Earned: 2*8 (scrap) + 2*12 (chips) + 1*15 (bio) = 16 + 24 + 15 = 55
  campaign.sellSalvage(5);
  assert.deepEqual(campaign.salvage, makeSalvage({ scrap: 0, chips: 0, bio: 1, data: 2 }));
  assert.equal(
    campaign.credits,
    2 * SALVAGE_SELL_RATE.scrap + 2 * SALVAGE_SELL_RATE.chips + 1 * SALVAGE_SELL_RATE.bio
  );
});

test('sellSalvage rejects unknown salvage types', () => {
  const campaign = new Campaign({ seed: 42 });
  campaign.salvage = makeSalvage({ scrap: 5 });
  assert.throws(() => campaign.sellSalvage(1, 'nuclear-waste'), /unknown salvage type/i);
});

test('per-type sell rates are differentiated', () => {
  // Sell 1 of each type and verify each yields its distinct rate.
  for (const type of ['scrap', 'chips', 'bio', 'data'] as const) {
    const campaign = new Campaign({ seed: 42 });
    campaign.salvage = makeSalvage({ [type]: 1 });
    campaign.sellSalvage(1, type);
    assert.equal(
      campaign.credits,
      SALVAGE_SELL_RATE[type],
      `selling 1 ${type} should yield ${SALVAGE_SELL_RATE[type]} Cr`
    );
  }
  // Verify rates are distinct (Data > Bio > Chips > Scrap).
  assert.ok(SALVAGE_SELL_RATE.data > SALVAGE_SELL_RATE.bio);
  assert.ok(SALVAGE_SELL_RATE.bio > SALVAGE_SELL_RATE.chips);
  assert.ok(SALVAGE_SELL_RATE.chips > SALVAGE_SELL_RATE.scrap);
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

// meta upgrades (expanded-catalog, better-contracts) removed — Rep
// tiers replace them. Tests for those items removed here.

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

// --- onJobEnd clears job-scoped consumables ----------------------------

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

// --- persistence round-trip with gear and consumables ------------------

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
  assert.deepEqual(restoredMember.gear, {
    maxHpBonus: 1,
    hitBonus: 0.1,
    dodgeBonus: 0,
    rangedDamageBonus: 0,
    meleeDamageBonus: 0,
    armorBonus: 0,
    apBonus: 0,
    shieldRegen: 0,
    hpRegen: 0,
  });
  assert.equal(restoredMember.maxHp, member.maxHp);
});

test('net-new scoreable gear survives campaign round-trip', () => {
  // Subdermal Plating writes the live `damageReduction` stat, which the
  // campaign-crew snapshot did NOT carry before P3.M6.2 — guard the round-trip.
  // Phase Shield / Regen Mesh are pure per-turn rates on `gear`.
  const campaign = new Campaign({
    seed: 42,
    credits:
      SHOP_COST.SUBDERMAL_PLATING +
      SHOP_COST.REFLEX_BOOSTER +
      SHOP_COST.MONOBLADE +
      SHOP_COST.PHASE_SHIELD +
      SHOP_COST.REGEN_MESH,
  });
  const member = campaign.crew[0];
  const baseMaxAp = member.maxAp;
  campaign.purchase({ itemId: 'subdermal-plating', targetMemberId: member.id });
  campaign.purchase({ itemId: 'reflex-booster', targetMemberId: member.id });
  campaign.purchase({ itemId: 'monoblade', targetMemberId: member.id });
  campaign.purchase({ itemId: 'phase-shield', targetMemberId: member.id });
  campaign.purchase({ itemId: 'regen-mesh', targetMemberId: member.id });
  assert.equal(member.damageReduction, 1);
  assert.equal(member.maxAp, baseMaxAp + 1);

  const restored = restoreCampaign(snapshotCampaign(campaign)).crew[0];
  assert.equal(restored.damageReduction, 1, 'armour (damageReduction) round-trips');
  assert.equal(restored.maxAp, baseMaxAp + 1, 'reflex booster maxAp round-trips');
  assert.equal(restored.gear.armorBonus, 1);
  assert.equal(restored.gear.apBonus, 1);
  assert.equal(restored.gear.meleeDamageBonus, 1);
  assert.equal(restored.gear.shieldRegen, 1, 'phase shield regen round-trips');
  assert.equal(restored.gear.hpRegen, 1, 'regen mesh round-trips');
  assert.equal(restored.meleeAttackDamage(), member.meleeAttackDamage());
});

test('meta state survives campaign snapshot/restore round-trip', () => {
  // meta upgrades removed, but meta is still a plain Record that can
  // carry arbitrary keys (future features, dead legacy data). Prove the
  // round-trip preserves whatever is in there.
  const campaign = new Campaign({ seed: 42 });
  campaign.meta.customFlag = true;
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  assert.equal(restored.meta.customFlag, true);
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

// --- Rep meter -----------------------------------------------------------

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

test('campaign arc survives persistence round-trip', () => {
  const campaign = new Campaign({
    seed: 42,
    arc: {
      arcStage: 'score',
      deckerRecruited: true,
      scoreRevealed: true,
      clockStarted: true,
      scoreAttempted: true,
      scoreCompleted: false,
    },
  });

  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);

  assert.deepEqual(snap.arc, campaign.arc);
  assert.deepEqual(restored.arc, campaign.arc);
  assert.equal(restored.arcStage, 'score');
});

test('pre-P3 campaign snapshots restore with a default Act 1 arc', () => {
  const campaign = new Campaign({ seed: 42 });
  const snap = snapshotCampaign(campaign) as Record<string, unknown>;
  delete snap.arc;

  const restored = restoreCampaign(snap as never);

  assert.deepEqual(restored.arc, defaultCampaignArc());
  assert.equal(restored.arcStage, 'act-1');
});

test('restoreCampaign rejects corrupt Phase 3 arc snapshots', () => {
  const campaign = new Campaign({ seed: 42 });
  const snap = snapshotCampaign(campaign);

  assert.throws(
    () => restoreCampaign({ ...snap, arc: { ...snap.arc, arcStage: 'bad-stage' } }),
    /arcStage/
  );
  assert.throws(
    () => restoreCampaign({ ...snap, arc: { ...snap.arc, scoreAttempted: 'yes' } }),
    /scoreAttempted/
  );
});

test('P3.M1.2: Act 1 does not advance until Rep and completed job gates both qualify', () => {
  const lowRep = new Campaign({ seed: 42, rep: 64, completedJobs: 4 });
  assert.equal(lowRep.arcStage, 'act-1');
  assert.equal(lowRep.arc.scoreRevealed, false);

  const lowJobs = new Campaign({ seed: 43, rep: 80, completedJobs: 3 });
  assert.equal(lowJobs.arcStage, 'act-1');
  assert.equal(lowJobs.arc.scoreRevealed, false);
});

test('P3.M1.2: Act 1 advances to Act 2 at proven-operator Rep plus four completed jobs and assigns Decker', () => {
  const campaign = new Campaign({ seed: 42, rep: 65, completedJobs: 4 });

  assert.equal(campaign.arcStage, 'act-2');
  assert.equal(campaign.arc.scoreRevealed, true);
  assert.equal(campaign.arc.deckerRecruited, true);

  const decker = campaign.crew.find(m => m.archetype === 'Decker');
  assert.ok(decker, 'Decker should join crew at Act 2 entry');
  assert.ok(decker!.callsign, 'Decker should have a unique callsign');
  assert.match(decker!.id, /^crew-decker-/);
});

test('P3.M1.2: Act 1 advances to Act 2 at TRUSTED Rep when job gate is met', () => {
  const campaign = new Campaign({ seed: 42, rep: 100, completedJobs: 9 });

  assert.equal(campaign.arcStage, 'act-2');
  assert.equal(campaign.arc.scoreRevealed, true);
  assert.equal(campaign.arc.deckerRecruited, true);
  assert.ok(
    campaign.crew.some(m => m.archetype === 'Decker'),
    'TRUSTED Rep should not block Act 2 after overshooting the rep floor'
  );
});

test('P3.M1.2: successful extraction advances Act 2 when the final gate is crossed', () => {
  const campaign = new Campaign({ seed: 42, rep: 64, completedJobs: 3 });
  const member = campaign.crew[0];
  const run = campaign.deployCrewMember(
    member.id,
    fakeContract({ reward: { credits: 0, repDelta: 1 } })
  );
  run.enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: true });

  assert.equal(campaign.completedJobs, 4);
  assert.equal(campaign.rep, 65);
  assert.equal(campaign.arcStage, 'act-2');
  assert.equal(campaign.arc.scoreRevealed, true);
  assert.equal(campaign.arc.deckerRecruited, true);
  assert.ok(
    campaign.crew.some(m => m.archetype === 'Decker'),
    'Decker should join crew when Act 2 gate is crossed'
  );
});

test('P3.M1.2: abort extraction does not count as a completed arc job', () => {
  const campaign = new Campaign({ seed: 42, rep: 90, completedJobs: 3 });
  const member = campaign.crew[0];
  const run = campaign.deployCrewMember(member.id, fakeContract());
  run.enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: false });

  assert.equal(campaign.completedJobs, 3);
  assert.equal(campaign.arcStage, 'act-1');
  assert.equal(campaign.arc.scoreRevealed, false);
});

test('P3.M1.2: Act 2 gates — each Act 3 condition checked independently', () => {
  // Act 3 requires: completedJobs >= 9, 4 living crew, and 3 visited same-principal sites.
  // Default test crew: buildCrew() trio + auto-Decker = 4 living.
  const scorePrincipal = { id: 'matsuda', label: 'Matsuda', groups: ['corp'] };

  // Gate: not enough jobs (crew and sites satisfied by default)
  const tooFewJobs = new Campaign({
    seed: 44,
    rep: 65,
    completedJobs: 8,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: scorePrincipal,
      }),
      validSite({ id: 'case-1', seed: '101', lastVisitedJob: 6, principal: scorePrincipal }),
      validSite({ id: 'case-2', seed: '102', lastVisitedJob: 7, principal: scorePrincipal }),
    ],
  });
  assert.equal(tooFewJobs.arcStage, 'act-2', 'blocks on job count');

  // Gate: not enough living crew (need 4 non-flatlined).
  // Start in Act 1 (low rep), flatline a member, then cross the Act 2 threshold
  // so the Act 3 check sees only 3 living crew.
  const attrition = new Campaign({
    seed: 45,
    rep: 20,
    completedJobs: 9,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: scorePrincipal,
      }),
      validSite({ id: 'case-1', seed: '101', lastVisitedJob: 6, principal: scorePrincipal }),
      validSite({ id: 'case-2', seed: '102', lastVisitedJob: 7, principal: scorePrincipal }),
    ],
  });
  assert.equal(attrition.arcStage, 'act-1', 'starts in Act 1 with low rep');
  attrition.crew[0].flatlined = true;
  attrition.rep = 65;
  attrition.enterHub();
  assert.equal(attrition.crew.length, 4, 'buildCrew trio + auto-Decker');
  assert.equal(attrition.crew.filter(m => !m.flatlined).length, 3, 'only 3 living');
  assert.equal(attrition.arcStage, 'act-2', 'blocks on living crew count');

  // Gate: not enough same-principal visited sites (2 of 3 required)
  const tooCasual = new Campaign({
    seed: 46,
    rep: 65,
    completedJobs: 9,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: scorePrincipal,
      }),
      validSite({ id: 'case-1', seed: '101', lastVisitedJob: 6, principal: scorePrincipal }),
      // Only 2 visited sites for this principal — need 3
    ],
  });
  assert.equal(tooCasual.arcStage, 'act-2', 'blocks on principal site visits');

  // Gate: score target never visited (synthesized, lastVisitedJob: 0)
  const noTargetVisit = new Campaign({
    seed: 47,
    rep: 65,
    completedJobs: 9,
  });
  const scoreTarget = noTargetVisit.siteRoster.find(s => s.scoreTarget);
  assert.ok(scoreTarget);
  assert.equal(scoreTarget!.lastVisitedJob, 0, 'synthesized target starts unvisited');
  assert.equal(noTargetVisit.arcStage, 'act-2', 'blocks when score target unvisited');
});

test('P3.M1.2: Act 2 advances to Act 3 with 4 living crew and 3 visited same-principal sites', () => {
  const scorePrincipal = { id: 'matsuda', label: 'Matsuda', groups: ['corp'] };
  const campaign = new Campaign({
    seed: 42,
    rep: 65,
    completedJobs: 9,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: scorePrincipal,
      }),
      validSite({ id: 'case-1', seed: '101', lastVisitedJob: 6, principal: scorePrincipal }),
      validSite({ id: 'case-2', seed: '102', lastVisitedJob: 7, principal: scorePrincipal }),
    ],
  });

  const living = campaign.crew.filter(m => !m.flatlined).length;
  assert.ok(living >= 4, `need 4 living crew, have ${living}`);
  assert.equal(campaign.arcStage, 'act-3');
});

test('P3.M2: Decker assignment is idempotent — restored save with existing Decker does not duplicate', () => {
  const decker = buildCrewMember('decker', { x: 0, y: 0 }, new Rng(102), {
    id: 'crew-decker',
  });
  const campaign = new Campaign({
    seed: 42,
    rep: 65,
    completedJobs: 4,
    crew: [decker],
  });

  assert.equal(campaign.arcStage, 'act-2');
  const deckers = campaign.crew.filter(m => m.archetype === 'Decker');
  assert.equal(deckers.length, 1, 'should not duplicate Decker when one already exists');
});

test('P3.M2: Decker callsign does not collide with existing crew', () => {
  const campaign = new Campaign({ seed: 42, rep: 65, completedJobs: 4 });
  const decker = campaign.crew.find(m => m.archetype === 'Decker');
  assert.ok(decker);
  const otherCallsigns = campaign.crew.filter(m => m.archetype !== 'Decker').map(m => m.callsign);
  assert.ok(
    !otherCallsigns.includes(decker!.callsign!),
    `Decker callsign "${decker!.callsign}" should not collide with existing crew`
  );
});

test('P3.M1.3: Act 2 entry always synthesizes a new CRITICAL-tier Score target', () => {
  const campaign = new Campaign({
    seed: 42,
    rep: 65,
    completedJobs: 4,
    siteRoster: [
      validSite({
        id: 'remembered',
        seed: '98765',
        mapWidth: 30,
        mapHeight: 18,
        lastVisitedJob: 3,
        seenKeys: ['1,1'],
        mutationDeltas: [{ kind: 'tile', x: 2, y: 2, from: TILE.WALL, to: TILE.RUBBLE }],
        principal: { id: 'orchid-vector', label: 'Orchid Vector', groups: ['corp', 'medical'] },
        site: { id: 'sublevel-3', label: 'Sublevel 3', groups: ['infrastructure', 'hidden'] },
      }),
    ],
  });

  const remembered = campaign.findRosterSite('remembered');
  assert.ok(remembered);
  assert.equal(remembered!.scoreTarget, false, 'existing roster site is not promoted');
  assert.notEqual(remembered!.tier, 'score');

  const target = campaign.siteRoster.find(site => site.scoreTarget);
  assert.ok(target, 'synthesized Score target exists');
  assert.match(target!.id, /^score-/);
  assert.equal(target!.tier, 'score');
  assert.ok(target!.mapWidth >= 28, 'Score target uses CRITICAL-tier dimensions');
  assert.ok(target!.mapHeight >= 18);
  assert.equal(campaign.siteRoster.filter(site => site.scoreTarget).length, 1);
});

test('P3.M1.3: Act 2 entry synthesizes a Score target even when roster is empty', () => {
  const campaign = new Campaign({ seed: 42, rep: 65, completedJobs: 4 });

  assert.equal(campaign.arcStage, 'act-2');
  assert.equal(campaign.arc.scoreRevealed, true);
  assert.equal(campaign.siteRoster.length, 1);
  const target = campaign.siteRoster[0]!;
  assert.equal(target.scoreTarget, true);
  assert.equal(target.tier, 'score');
  assert.match(target.id, /^score-/);
  assert.match(target.seed, /^\d+$/);
  assert.ok(target.mapWidth >= 28);
  assert.ok(target.mapHeight >= 18);
  assert.ok(target.principal?.id);
  assert.ok(target.site?.id);
});

test('P3.M1.3: designated Score target survives roster eviction at cap', () => {
  const campaign = new Campaign({ seed: 42, rep: 65, completedJobs: 4 });
  const targetId = campaign.siteRoster.find(site => site.scoreTarget)!.id;

  for (let i = 0; i < SITE_ROSTER_CAP; i++) {
    campaign.addSiteToRoster(validSite({ id: `filler-${i}`, seed: `${1000 + i}` }));
  }

  assert.equal(campaign.siteRoster.length, SITE_ROSTER_CAP);
  assert.ok(campaign.findRosterSite(targetId), 'Score target must not be evicted');
  assert.equal(campaign.siteRoster.filter(site => site.scoreTarget).length, 1);
});

test('P3.M1.3: multiple persisted Score targets crash instead of being normalized', () => {
  assert.throws(
    () =>
      new Campaign({
        seed: 42,
        rep: 65,
        completedJobs: 4,
        siteRoster: [
          validSite({ id: 'score-a', seed: '111', tier: 'score', scoreTarget: true }),
          validSite({ id: 'score-b', seed: '222', tier: 'score', scoreTarget: true }),
        ],
      }),
    /multiple Score targets/i
  );
});

test('P3.M1.5: Clock ignores completedJobs until act-2/3 deploys cross grace', () => {
  const freshAct2 = new Campaign({ seed: 42, rep: 65, completedJobs: 9 });
  assert.equal(freshAct2.arc.clockStarted, false);
  assert.equal(freshAct2.clockHeat, 0);
  assert.equal(freshAct2.scoreDeadlineJobsRemaining, CLOCK_ACT2_DEADLINE_JOBS);

  const heating = new Campaign({
    seed: 42,
    rep: 65,
    completedJobs: 9,
    clockJobsTaken: CLOCK_ACT2_GRACE_JOBS + 2,
  });
  assert.equal(heating.arc.clockStarted, true);
  assert.equal(heating.clockHeat, 2);
  assert.equal(
    heating.scoreDeadlineJobsRemaining,
    CLOCK_ACT2_DEADLINE_JOBS - heating.clockJobsTaken
  );
  assert.equal(heating.state, CAMPAIGN_STATE.HUB);

  const expired = new Campaign({
    seed: 43,
    rep: 65,
    completedJobs: 4,
    clockJobsTaken: CLOCK_ACT2_DEADLINE_JOBS,
  });
  assert.equal(expired.clockHeat, CLOCK_ACT2_DEADLINE_JOBS - CLOCK_ACT2_GRACE_JOBS);
  assert.equal(expired.arc.clockStarted, true);
  assert.equal(expired.arcStage, 'act-2');
  assert.equal(expired.state, CAMPAIGN_STATE.HUB);
  assert.equal(expired.endReason, null);
});

test('P3.M1.5: clock loss requires Act 3 — Act 2 casing survives past the deploy deadline', () => {
  const act2PastDeadline = new Campaign({
    seed: 43,
    rep: 65,
    completedJobs: 6,
    clockJobsTaken: CLOCK_ACT2_DEADLINE_JOBS - 1,
  });
  assert.equal(act2PastDeadline.arcStage, 'act-2');
  assert.equal(act2PastDeadline.state, CAMPAIGN_STATE.HUB);
  assert.equal(act2PastDeadline.endReason, null);
  assert.equal(willEndCampaignAfterResult(act2PastDeadline, OUTCOME.EXIT, true), false);

  const act3AtDeadline = new Campaign({
    seed: 43,
    rep: 65,
    completedJobs: 9,
    clockJobsTaken: CLOCK_ACT2_DEADLINE_JOBS,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
      validSite({
        id: 'case-1',
        seed: '101',
        lastVisitedJob: 6,
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
      validSite({
        id: 'case-2',
        seed: '102',
        lastVisitedJob: 7,
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
    ],
  });
  assert.equal(act3AtDeadline.arcStage, 'act-3');
  assert.equal(act3AtDeadline.state, CAMPAIGN_STATE.HUB, 'Act 3 entry refunds over-budget clock');
  act3AtDeadline.clockJobsTaken = CLOCK_ACT2_DEADLINE_JOBS;
  act3AtDeadline.state = CAMPAIGN_STATE.COMBAT;
  act3AtDeadline.enterHub();
  assert.equal(act3AtDeadline.state, CAMPAIGN_STATE.ENDED);
  assert.equal(act3AtDeadline.endReason, 'clock-expired');
});

test('P3.M1.5: Act 3 entry clamps an over-budget clock to guarantee Score deploy headroom', () => {
  const scorePrincipal = { id: 'matsuda', label: 'Matsuda', groups: ['corp'] };
  const campaign = new Campaign({
    seed: 42,
    rep: 65,
    completedJobs: 9,
    clockJobsTaken: CLOCK_ACT2_DEADLINE_JOBS,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: scorePrincipal,
      }),
      validSite({ id: 'case-1', seed: '101', lastVisitedJob: 6, principal: scorePrincipal }),
      validSite({ id: 'case-2', seed: '102', lastVisitedJob: 7, principal: scorePrincipal }),
    ],
  });

  assert.equal(campaign.arcStage, 'act-3');
  assert.equal(campaign.state, CAMPAIGN_STATE.HUB);
  assert.equal(
    campaign.clockJobsTaken,
    CLOCK_ACT2_DEADLINE_JOBS - 3,
    'must leave at least three Act 3 deploys'
  );
  assert.equal(campaign.scoreDeadlineJobsRemaining, 3);
  assert.ok(campaign.canAttemptScore());
});

test('P3.M1.5: endReason distinguishes score win, clock loss, and crew wipe', () => {
  const clockLoss = new Campaign({
    seed: 43,
    rep: 65,
    completedJobs: 4,
    clockJobsTaken: CLOCK_ACT2_DEADLINE_JOBS,
  });
  assert.equal(clockLoss.endReason, null, 'Act 2 past deadline is not clock loss');

  const scoreWin = new Campaign({
    seed: 44,
    rep: 65,
    completedJobs: 4,
    arc: {
      arcStage: 'score',
      deckerRecruited: true,
      scoreRevealed: true,
      clockStarted: true,
      scoreAttempted: true,
      scoreCompleted: true,
    },
    siteRoster: [
      validSite({ id: 'score', seed: '100', tier: 'score', scoreTarget: true, lastVisitedJob: 5 }),
    ],
  });
  scoreWin.state = CAMPAIGN_STATE.ENDED;
  assert.equal(scoreWin.endReason, 'score-complete');

  const crewWipe = new Campaign({
    seed: 45,
    rep: 65,
    completedJobs: 2,
  });
  crewWipe.crew.forEach(member => {
    member.flatlined = true;
  });
  crewWipe.state = CAMPAIGN_STATE.ENDED;
  assert.equal(crewWipe.endReason, 'crew-wipe');
});

test('terminal result detection bypasses debrief for Score, terminal death, and Clock loss', () => {
  const scoreCampaign = new Campaign({
    seed: 44,
    rep: 65,
    completedJobs: 9,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
      validSite({
        id: 'case-1',
        seed: '101',
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
      validSite({
        id: 'case-2',
        seed: '102',
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
    ],
  });
  scoreCampaign.arc.arcStage = 'act-3';
  const decker = scoreCampaign.crew.find(member => member.archetype === 'Decker');
  const partner = scoreCampaign.crew.find(member => member.archetype !== 'Decker');
  assert.ok(decker);
  assert.ok(partner);
  scoreCampaign.deployCrewMember(decker.id, scoreCampaign.buildScoreContract(), partner.id);
  assert.equal(willEndCampaignAfterResult(scoreCampaign, OUTCOME.EXIT, true), true);
  assert.equal(willEndCampaignAfterResult(scoreCampaign, OUTCOME.EXIT, false), true);
  assert.equal(willEndCampaignAfterResult(scoreCampaign, OUTCOME.DEATH, false), true);

  const finalOperator = new Campaign({ seed: 45 });
  finalOperator.crew.slice(1).forEach(member => {
    member.flatlined = true;
  });
  finalOperator.deployCrewMember(finalOperator.crew[0].id, fakeContract());
  assert.equal(willEndCampaignAfterResult(finalOperator, OUTCOME.DEATH, false), true);

  const clockLoss = new Campaign({
    seed: 46,
    rep: 65,
    completedJobs: 9,
    clockJobsTaken: CLOCK_ACT2_DEADLINE_JOBS - 1,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
      validSite({
        id: 'case-1',
        seed: '101',
        lastVisitedJob: 6,
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
      validSite({
        id: 'case-2',
        seed: '102',
        lastVisitedJob: 7,
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
    ],
  });
  assert.equal(clockLoss.arcStage, 'act-3');
  clockLoss.clockJobsTaken = CLOCK_ACT2_DEADLINE_JOBS;
  clockLoss.state = CAMPAIGN_STATE.COMBAT;
  assert.equal(willEndCampaignAfterResult(clockLoss, OUTCOME.EXIT, true), true);
});

test('completed Score extraction settles synchronously before the exit move callback returns', () => {
  let campaign!: Campaign;
  campaign = new Campaign({
    seed: 47,
    rep: 65,
    completedJobs: 9,
    onResult: result => {
      campaign.onJobEnd({
        outcome: result.outcome,
        completed: result.telemetry.objectiveComplete === true,
      });
    },
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
    ],
  });
  campaign.arc.arcStage = 'act-3';
  const decker = campaign.crew.find(member => member.archetype === 'Decker');
  const partner = campaign.crew.find(member => member.archetype !== 'Decker');
  assert.ok(decker);
  assert.ok(partner);
  const run = campaign.deployCrewMember(decker.id, campaign.buildScoreContract(), partner.id);
  run.enterCombat();
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: true });

  assert.equal(campaign.state, CAMPAIGN_STATE.ENDED);
  assert.equal(campaign.endReason, 'score-complete');
  assert.equal(
    campaign.activeRun,
    null,
    'Score settlement tears down the active run synchronously'
  );
});

test('P3.M1.5: Clock deadline does not end the campaign after the Score is attempted', () => {
  const campaign = new Campaign({
    seed: 42,
    rep: 65,
    completedJobs: 4,
    clockJobsTaken: CLOCK_ACT2_DEADLINE_JOBS,
    arc: {
      arcStage: 'score',
      deckerRecruited: true,
      scoreRevealed: true,
      clockStarted: true,
      scoreAttempted: true,
      scoreCompleted: false,
    },
    siteRoster: [
      validSite({ id: 'score', seed: '100', tier: 'score', scoreTarget: true, lastVisitedJob: 5 }),
    ],
  });

  assert.equal(campaign.state, CAMPAIGN_STATE.HUB);
  assert.equal(campaign.clockHeat, CLOCK_ACT2_DEADLINE_JOBS - CLOCK_ACT2_GRACE_JOBS);
});

test('P3.M1.7: Score contract is gated to Act 3 and marks attempted on deployment', () => {
  const scorePrincipal = { id: 'matsuda', label: 'Matsuda', groups: ['corp'] };
  const campaign = new Campaign({
    seed: 42,
    rep: 65,
    completedJobs: 9,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: scorePrincipal,
        site: { id: 'server-farm', label: 'server farm', groups: ['corp', 'data'] },
      }),
      validSite({ id: 'case-1', seed: '101', lastVisitedJob: 6, principal: scorePrincipal }),
      validSite({ id: 'case-2', seed: '102', lastVisitedJob: 7, principal: scorePrincipal }),
    ],
  });
  assert.equal(campaign.arcStage, 'act-3');
  assert.equal(campaign.canAttemptScore(), true);

  const score = campaign.buildScoreContract();
  assert.equal(score.difficulty, CONTRACT_DIFFICULTY.CRITICAL);
  assert.equal(score.context.locationSiteId, 'score');
  assert.ok(score.context.tags.includes('score'));
  assert.match(score.label, /THE SCORE/);
  assert.equal(score.objective.kind, OBJECTIVES.SCORE_FINAL);
  assert.equal(score.objective.params?.requiresCyberspace, true);
  assert.equal(score.objective.params?.count, 1);
  assert.equal(score.objective.params?.doorId, 'score-door-0');
  assert.equal(score.reward.credits, SCORE_CREDITS_REWARD);
  assert.equal(score.reward.repDelta, 0);

  const decker = campaign.crew.find(m => m.archetype === 'Decker');
  const partner = campaign.crew.find(m => m.archetype !== 'Decker');
  assert.ok(decker, 'Act 3 campaign should include auto-assigned Decker');
  assert.ok(partner, 'Act 3 campaign should include a living meat partner');
  assert.throws(() => campaign.deployCrewMember(decker!.id, score), /meat partner/);
  const run = campaign.deployCrewMember(decker!.id, score, partner!.id);
  assert.equal(campaign.arc.scoreAttempted, true);
  assert.equal(campaign.arcStage, 'score');
  assert.equal(run.contract?.context.locationSiteId, 'score');
});

test('a flatlined pre-Score Decker creates a free Terminal replacement lead', () => {
  const campaign = new Campaign({ seed: 42, rep: 65, completedJobs: 4 });
  const original = campaign.crew.find(member => member.archetype === 'Decker');
  assert.ok(original);
  campaign.flatlineMember(original.id);
  campaign.enterHub();

  assert.equal(campaign.hasLivingDecker, false);
  assert.equal(campaign.availableRecruits.length, 1);
  const replacement = campaign.availableRecruits[0];
  assert.equal(replacement.archetype, 'Decker');
  campaign.recruit(replacement.id);
  assert.equal(campaign.hasLivingDecker, true);
  assert.equal(campaign.recruitedThisVisit, true);
});

test('the Score remains unavailable until a living replacement Decker is recruited', () => {
  const scorePrincipal = { id: 'matsuda', label: 'Matsuda', groups: ['corp'] };
  const campaign = new Campaign({
    seed: 42,
    rep: 65,
    completedJobs: 9,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: scorePrincipal,
      }),
      validSite({ id: 'case-1', seed: '101', lastVisitedJob: 6, principal: scorePrincipal }),
      validSite({ id: 'case-2', seed: '102', lastVisitedJob: 7, principal: scorePrincipal }),
    ],
  });
  const decker = campaign.crew.find(member => member.archetype === 'Decker');
  assert.ok(decker);
  campaign.flatlineMember(decker.id);
  campaign.enterHub();

  assert.equal(campaign.arcStage, 'act-3');
  assert.equal(campaign.canAttemptScore(), false);
  const replacement = campaign.availableRecruits[0];
  campaign.recruit(replacement.id);
  assert.equal(campaign.canAttemptScore(), true);
});

test('P3.M1.7: completed Score contract records campaign win state', () => {
  const scorePrincipal = { id: 'matsuda', label: 'Matsuda', groups: ['corp'] };
  const campaign = new Campaign({
    seed: 42,
    credits: 25,
    rep: 65,
    completedJobs: 9,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: scorePrincipal,
        site: { id: 'server-farm', label: 'server farm', groups: ['corp', 'data'] },
      }),
      validSite({ id: 'case-1', seed: '101', lastVisitedJob: 6, principal: scorePrincipal }),
      validSite({ id: 'case-2', seed: '102', lastVisitedJob: 7, principal: scorePrincipal }),
    ],
  });
  const decker = campaign.crew.find(m => m.archetype === 'Decker');
  const partner = campaign.crew.find(m => m.archetype !== 'Decker');
  assert.ok(decker, 'Act 3 campaign should include auto-assigned Decker');
  assert.ok(partner);
  const run = campaign.deployCrewMember(decker!.id, campaign.buildScoreContract(), partner.id);
  run.enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: true });

  assert.equal(campaign.arc.scoreCompleted, true);
  assert.equal(campaign.state, CAMPAIGN_STATE.ENDED);
  assert.equal(campaign.credits, 25 + SCORE_CREDITS_REWARD);
});

test('a Decker flatline during the Score ends the campaign explicitly', () => {
  const scorePrincipal = { id: 'matsuda', label: 'Matsuda', groups: ['corp'] };
  const campaign = new Campaign({
    seed: 42,
    rep: 65,
    completedJobs: 9,
    siteRoster: [
      validSite({
        id: 'score',
        seed: '100',
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: scorePrincipal,
      }),
      validSite({ id: 'case-1', seed: '101', lastVisitedJob: 6, principal: scorePrincipal }),
      validSite({ id: 'case-2', seed: '102', lastVisitedJob: 7, principal: scorePrincipal }),
    ],
  });
  const decker = campaign.crew.find(member => member.archetype === 'Decker');
  const partner = campaign.crew.find(member => member.archetype !== 'Decker');
  assert.ok(decker);
  assert.ok(partner);
  const run = campaign.deployCrewMember(decker.id, campaign.buildScoreContract(), partner.id);
  run.enterCombat();
  assert.equal(
    willEndCampaignOnThisDeath(campaign),
    true,
    'Score death is terminal even with surviving crew'
  );

  campaign.onJobEnd({ outcome: OUTCOME.DEATH });

  assert.equal(campaign.state, CAMPAIGN_STATE.ENDED);
  assert.equal(campaign.endReason, 'decker-flatlined-score');
  assert.ok(
    campaign.crew.some(member => !member.flatlined),
    'other survivors do not avert the loss'
  );

  const restored = restoreCampaign(snapshotCampaign(campaign));
  assert.equal(restored.state, CAMPAIGN_STATE.ENDED);
  assert.equal(restored.endReason, 'decker-flatlined-score');
});

// ─── Recruitment ────────────────────────────────────────────────────────

test('generateRecruits returns 1–2 candidates when Rep ≥ threshold', () => {
  const campaign = new Campaign({ seed: 99, rep: 50 });
  assert.ok(campaign.availableRecruits.length >= 1);
  assert.ok(campaign.availableRecruits.length <= 2);
});

test('generateRecruits returns empty when Rep < threshold', () => {
  const campaign = new Campaign({ seed: 99, rep: 49 });
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
  const campaign = new Campaign({ seed: 7, rep: 50 });
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

test('pre-P2.5.M6 snapshot restores with empty availableRecruits', () => {
  // Simulate a legacy snapshot without the fields
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
  const campaign = new Campaign({ seed: 3, rep: 49 });
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

// ─── Campaign-start rework ──────────────────────────────────────

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

test('deployCrewMember auto-grants breaching charge on breach contract', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[1];
  const contract = fakeContract({
    objective: {
      kind: OBJECTIVES.DENY,
      title: 'Demolish target',
      briefing: 'Plant a charge and destroy the target.',
      params: { method: 'breach', requiresBreach: true },
    },
  });
  campaign.deployCrewMember(member.id, contract);
  const hasCharge = member.inventory?.consumables.some(
    (c: { id: string }) => c.id === 'breaching-charge'
  );
  assert.ok(hasCharge, 'operative should receive a breaching charge for breach contracts');
});

test('deployCrewMember does NOT double-grant breaching charge if already carried', () => {
  const campaign = new Campaign({ seed: 42 });
  const member = campaign.crew[1];
  member.addConsumable('breaching-charge');
  const before = member.inventory?.consumables.filter(
    (c: { id: string }) => c.id === 'breaching-charge'
  ).length;
  const contract = fakeContract({
    objective: {
      kind: OBJECTIVES.DENY,
      title: 'Demolish target',
      briefing: 'Plant a charge and destroy the target.',
      params: { method: 'breach', requiresBreach: true },
    },
  });
  campaign.deployCrewMember(member.id, contract);
  const after = member.inventory?.consumables.filter(
    (c: { id: string }) => c.id === 'breaching-charge'
  ).length;
  assert.equal(after, before, 'should not add a second breaching charge');
});

test('recruitInitial does not require Rep gate', () => {
  // Fresh campaign has rep=20, below the recruitment threshold — but initial
  // recruitment bypasses the gate.
  const campaign = new Campaign({ seed: 42, crew: [], rep: 20 });
  campaign.generateInitialCandidates();
  const ids = campaign.initialCandidates.slice(0, 2).map(c => c.id);

  // Should NOT throw despite low rep.
  campaign.recruitInitial(ids);
  assert.equal(campaign.crew.length, 2);
});
