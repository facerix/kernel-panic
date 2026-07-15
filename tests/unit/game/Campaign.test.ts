import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED,
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
import { SCOREABLE_ITEMS } from '../../../src/game/items.js';
import {
  SCOREABLE_ARCHETYPES,
  SCOREABLE_ARCHETYPE_IDS,
} from '../../../src/game/archetypeRewards.js';
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

test('buildCrew creates three named crew members with unique callsigns', () => {
  // P3.5.M6: no fixed [Merc, Razor, Tech] triple — each slot rolls its own
  // stats and derives its own archetype (crewStatRoll.ts), so duplicates
  // are a legal outcome. Assert structure, not a specific archetype list.
  const crew = buildCrew(new Rng(0xc0ffee));
  assert.equal(crew.length, 3);
  const registered = new Set(['Merc', 'Razor', 'Tech', 'Berserk', 'Adept', 'Chimera']);
  for (const member of crew) {
    assert.ok(
      registered.has(member.constructor.name),
      `unexpected starter archetype "${member.constructor.name}" (Decker must never roll)`
    );
    assert.ok(member.callsign, 'every starter crew member gets a callsign');
  }
  assert.equal(new Set(crew.map(member => member.callsign)).size, 3);
  assert.deepEqual(
    crew.map(member => member.flatlined),
    [false, false, false]
  );
});

test('buildCrew: every starter slot carries its own rolled base stats', () => {
  const crew = buildCrew(new Rng(7));
  for (const member of crew) {
    assert.ok(member.baseHitChance >= 0.65 && member.baseHitChance <= 0.85);
    assert.ok(member.baseDodgeChance >= 0.15 && member.baseDodgeChance <= 0.4);
  }
});

test('buildCrew is deterministic from a fixed seed (rng.fork does not desync the stream)', () => {
  const describe = (crew: ReturnType<typeof buildCrew>) =>
    crew.map(m => ({
      archetype: m.constructor.name,
      callsign: m.callsign,
      baseHitChance: m.baseHitChance,
      baseDodgeChance: m.baseDodgeChance,
    }));
  const a = buildCrew(new Rng(555));
  const b = buildCrew(new Rng(555));
  assert.deepEqual(describe(a), describe(b));
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
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.BONE_LACING });
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
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.GHOST_WEAVE });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'reflex-weave', targetMemberId: member.id });
  assert.equal(member.gear.dodgeBonus, 0.1);
});

test('purchase refuses limit-1 gear the target already has equipped, without charging', () => {
  // Adrenal Spike is limit-1 ("One per operator"): a second sale would silently
  // clamp to a no-op in applyGear while still pocketing the Creds. Guard it.
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.ADRENAL_SPIKE * 2 });
  const member = campaign.crew[0];
  campaign.purchase({ itemId: 'reflex-booster', targetMemberId: member.id });
  const creditsAfterFirst = campaign.credits;
  const maxApAfterFirst = member.maxAp;
  assert.throws(
    () => campaign.purchase({ itemId: 'reflex-booster', targetMemberId: member.id }),
    /at capacity/i
  );
  assert.equal(campaign.credits, creditsAfterFirst, 'no Creds deducted on the refused sale');
  assert.equal(member.maxAp, maxApAfterFirst, 'stat unchanged by the refused sale');
});

test('purchase refuses every net-new limit-1 gear item once equipped', () => {
  for (const itemId of ['monoblade', 'subdermal-plating', 'phase-shield', 'regen-mesh'] as const) {
    const cost = SHOP_COST[itemId.toUpperCase().replace(/-/g, '_') as keyof typeof SHOP_COST];
    const campaign = new Campaign({ seed: 42, credits: cost * 2 });
    const member = campaign.crew[0];
    campaign.purchase({ itemId, targetMemberId: member.id });
    assert.throws(
      () => campaign.purchase({ itemId, targetMemberId: member.id }),
      /at capacity/i,
      `${itemId} should be refused once equipped`
    );
    assert.equal(campaign.credits, cost, `${itemId} refusal must not deduct Creds`);
  }
});

test('purchase still allows re-buying unbounded Bone Lacing (not limit-1)', () => {
  // Bone Lacing has no cap (+1 maxHp each time), so it must stay re-purchasable.
  const campaign = new Campaign({ seed: 42, credits: SHOP_COST.BONE_LACING * 2 });
  const member = campaign.crew[0];
  const origMaxHp = member.maxHp;
  campaign.purchase({ itemId: 'armour-plating', targetMemberId: member.id });
  campaign.purchase({ itemId: 'armour-plating', targetMemberId: member.id });
  assert.equal(member.maxHp, origMaxHp + 2, 'second Bone Lacing stacks');
  assert.equal(campaign.credits, 0, 'both Bone Lacings charged');
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
    credits: SHOP_COST.BONE_LACING + SHOP_COST.TARGETING_CHIP,
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
      SHOP_COST.ADRENAL_SPIKE +
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

const SCORE_PRINCIPAL = { id: 'matsuda', label: 'Matsuda', groups: ['corp'] };

/** Synthesized Score target as it exists in real play: never visited pre-heist. */
function scoreTargetSite(): LocationSite {
  return validSite({
    id: 'score',
    seed: '100',
    tier: 'score',
    scoreTarget: true,
    lastVisitedJob: 0,
    principal: SCORE_PRINCIPAL,
  });
}

/** `n` distinct visited sites belonging to the Score org (the casing payoff). */
function casedSites(n: number): LocationSite[] {
  return Array.from({ length: n }, (_, i) =>
    validSite({
      id: `case-${i}`,
      seed: `${101 + i}`,
      lastVisitedJob: 6 + i,
      principal: SCORE_PRINCIPAL,
    })
  );
}

test('P3.M1.2: casing is the sole Act 3 gate — cased-site count drives the transition', () => {
  // One fewer than required stays in Stage 2, and casingProgress reflects it.
  const underCased = new Campaign({
    seed: 46,
    rep: 65,
    completedJobs: 4,
    siteRoster: [scoreTargetSite(), ...casedSites(ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED - 1)],
  });
  assert.equal(underCased.arcStage, 'act-2', 'blocks below the casing threshold');
  assert.deepEqual(underCased.casingProgress(), {
    cased: ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED - 1,
    required: ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED,
  });

  // The synthesized Score target is never visited, so it never counts toward
  // its own casing gate.
  assert.equal(
    underCased.siteRoster.find(s => s.scoreTarget)!.lastVisitedJob,
    0,
    'score target stays unvisited'
  );

  // Hitting the threshold advances regardless of total job count.
  const cased = new Campaign({
    seed: 42,
    rep: 65,
    completedJobs: 4,
    siteRoster: [scoreTargetSite(), ...casedSites(ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED)],
  });
  assert.equal(cased.arcStage, 'act-3', 'advances on cased-site count alone');
  assert.deepEqual(cased.casingProgress(), {
    cased: ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED,
    required: ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED,
  });
});

test('P3.M1.2: crew attrition no longer blocks Act 3 (living-crew gate removed)', () => {
  // Start in Act 1 (low rep), flatline most of the crew, then cross into Act 2.
  // Under the old gate this stalled at act-2; now casing alone decides.
  const campaign = new Campaign({
    seed: 45,
    rep: 20,
    completedJobs: 4,
    siteRoster: [scoreTargetSite(), ...casedSites(ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED)],
  });
  assert.equal(campaign.arcStage, 'act-1', 'starts in Act 1 with low rep');

  campaign.crew[0].flatlined = true;
  campaign.crew[1].flatlined = true;
  campaign.rep = 65;
  campaign.enterHub();

  assert.ok(
    campaign.crew.filter(m => !m.flatlined).length < 4,
    'fewer than the old 4-living-crew floor'
  );
  assert.equal(campaign.arcStage, 'act-3', 'casing satisfied — attrition does not block');
});

test('P3.M1.2: casingProgress is null before the Score target is designated', () => {
  const act1 = new Campaign({ seed: 7, rep: 20, completedJobs: 0 });
  assert.equal(act1.arcStage, 'act-1');
  assert.equal(act1.casingProgress(), null);
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
      validSite({
        id: 'case-3',
        seed: '103',
        lastVisitedJob: 8,
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
      validSite({
        id: 'case-4',
        seed: '104',
        lastVisitedJob: 9,
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
      validSite({ id: 'case-3', seed: '103', lastVisitedJob: 8, principal: scorePrincipal }),
      validSite({ id: 'case-4', seed: '104', lastVisitedJob: 9, principal: scorePrincipal }),
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
      validSite({
        id: 'case-3',
        seed: '103',
        lastVisitedJob: 8,
        principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
      }),
      validSite({
        id: 'case-4',
        seed: '104',
        lastVisitedJob: 9,
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

test('P3.M1.7: Score contract is gated to Act 3 and commits the attempt only at combat entry', () => {
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
      validSite({ id: 'case-3', seed: '103', lastVisitedJob: 8, principal: scorePrincipal }),
      validSite({ id: 'case-4', seed: '104', lastVisitedJob: 9, principal: scorePrincipal }),
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
  // Defer-commit: deploying alone must NOT consume the (terminal) Score. The map
  // is built in enterCombat, which can throw; committing earlier would strand the
  // campaign in score-partial on a generation failure.
  assert.equal(campaign.arc.scoreAttempted, false, 'deploy alone does not commit the Score');
  assert.equal(campaign.arcStage, 'act-3');
  assert.equal(run.contract?.context.locationSiteId, 'score');
  // Entering combat (map built, fixtures placed) is what commits the attempt.
  run.enterCombat();
  assert.equal(campaign.arc.scoreAttempted, true, 'combat entry commits the Score');
  assert.equal(campaign.arcStage, 'score');
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
      validSite({ id: 'case-3', seed: '103', lastVisitedJob: 8, principal: scorePrincipal }),
      validSite({ id: 'case-4', seed: '104', lastVisitedJob: 9, principal: scorePrincipal }),
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
      validSite({ id: 'case-3', seed: '103', lastVisitedJob: 8, principal: scorePrincipal }),
      validSite({ id: 'case-4', seed: '104', lastVisitedJob: 9, principal: scorePrincipal }),
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
      validSite({ id: 'case-3', seed: '103', lastVisitedJob: 8, principal: scorePrincipal }),
      validSite({ id: 'case-4', seed: '104', lastVisitedJob: 9, principal: scorePrincipal }),
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

test('generateRecruits archetypes come from the roll-then-derive pipeline, never Decker', () => {
  // P3.5.M6: RECRUIT_ARCHETYPE_POOL is retired. Every recruit's archetype is
  // derived from a stat roll (crewStatRoll.ts) rather than picked from a
  // weighted pool — every registered non-Decker archetype should be
  // reachable, each landing roughly in the plan's documented 13–21% spread
  // (generous tolerance here to avoid sample-size flakiness; the exact
  // partition math is asserted exhaustively in crewStatRoll.test.ts).
  const counts: Record<string, number> = {
    Merc: 0,
    Razor: 0,
    Tech: 0,
    Berserk: 0,
    Adept: 0,
    Chimera: 0,
  };
  const total = 1000;
  for (let i = 0; i < total; i++) {
    const campaign = new Campaign({ seed: i, rep: 80 });
    for (const recruit of campaign.availableRecruits) {
      assert.notEqual(recruit.constructor.name, 'Decker', 'Decker must never be a random recruit');
      counts[recruit.constructor.name]++;
    }
  }
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const id of Object.keys(counts)) {
    const ratio = counts[id] / sum;
    assert.ok(ratio > 0.08 && ratio < 0.28, `${id} ${(ratio * 100).toFixed(1)}% out of range`);
  }
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

test('generateInitialCandidates archetypes come from the roll-then-derive pipeline', () => {
  // P3.5.M6: same retired-pool rationale as the generateRecruits test above.
  const counts: Record<string, number> = {
    Merc: 0,
    Razor: 0,
    Tech: 0,
    Berserk: 0,
    Adept: 0,
    Chimera: 0,
  };
  const total = 500;
  for (let i = 0; i < total; i++) {
    const campaign = new Campaign({ seed: i, crew: [] });
    const candidates = campaign.generateInitialCandidates();
    for (const c of candidates) {
      assert.notEqual(c.constructor.name, 'Decker', 'Decker must never be an initial candidate');
      counts[c.constructor.name]++;
    }
  }
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const id of Object.keys(counts)) {
    assert.ok(counts[id] > 0, `${id} must be reachable in the starter candidate pool`);
    const ratio = counts[id] / sum;
    assert.ok(ratio > 0.07 && ratio < 0.28, `${id} ${(ratio * 100).toFixed(1)}% out of range`);
  }
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

// ─── P3.5.M7: archetype unlocks via Score rewards ──────────────────────────

const M7_SCORE_PRINCIPAL = { id: 'matsuda', label: 'Matsuda', groups: ['corp'] };

/**
 * A Score-ready campaign (Act 3, living Decker + partner, designated target).
 * `pickScorePayload` is seeded from the Score *target site's* seed, not the
 * campaign's own seed — vary both together so a seed sweep actually produces
 * different draws (a fixed site seed would draw the same payload every time).
 */
function m7ScoreReadyCampaign(
  overrides: { seed?: number; unlockedArchetypeIds?: string[] } = {}
): Campaign {
  const seed = overrides.seed ?? 42;
  const campaign = new Campaign({
    seed,
    rep: 65,
    completedJobs: 9,
    unlockedArchetypeIds: overrides.unlockedArchetypeIds,
    siteRoster: [
      validSite({
        id: 'score',
        seed: String(seed),
        tier: 'score',
        scoreTarget: true,
        lastVisitedJob: 5,
        principal: M7_SCORE_PRINCIPAL,
      }),
      validSite({
        id: 'case-1',
        seed: `${seed}01`,
        lastVisitedJob: 6,
        principal: M7_SCORE_PRINCIPAL,
      }),
      validSite({
        id: 'case-2',
        seed: `${seed}02`,
        lastVisitedJob: 7,
        principal: M7_SCORE_PRINCIPAL,
      }),
      validSite({
        id: 'case-3',
        seed: `${seed}03`,
        lastVisitedJob: 8,
        principal: M7_SCORE_PRINCIPAL,
      }),
      validSite({
        id: 'case-4',
        seed: `${seed}04`,
        lastVisitedJob: 9,
        principal: M7_SCORE_PRINCIPAL,
      }),
    ],
  });
  assert.ok(campaign.canAttemptScore(), 'fixture should be Score-ready');
  return campaign;
}

test('pickScorePayload draws from the merged item+archetype pool over enough seeds', () => {
  let itemDraws = 0;
  let archetypeDraws = 0;
  for (let seed = 0; seed < 60; seed++) {
    const contract = m7ScoreReadyCampaign({ seed }).buildScoreContract([], []);
    if (contract.objective.params?.scoreItemId) itemDraws++;
    if (contract.objective.params?.scoreArchetypeId) archetypeDraws++;
  }
  assert.ok(itemDraws > 0, 'merged pool must still be able to draw items');
  assert.ok(archetypeDraws > 0, 'merged pool must be able to draw archetypes too');
});

test('a drawn contract carries at most one of scoreItemId/scoreArchetypeId, never both', () => {
  for (let seed = 0; seed < 60; seed++) {
    const contract = m7ScoreReadyCampaign({ seed }).buildScoreContract([], []);
    const hasItem = contract.objective.params?.scoreItemId !== undefined;
    const hasArchetype = contract.objective.params?.scoreArchetypeId !== undefined;
    assert.ok(!(hasItem && hasArchetype), `seed ${seed}: contract carries both payload kinds`);
  }
});

test('pool exhaustion (abstract fallback) requires both item and archetype catalogs acquired', () => {
  const campaign = m7ScoreReadyCampaign();
  const allItems = SCOREABLE_ITEMS.map(i => i.id);
  const allArchetypes = SCOREABLE_ARCHETYPES.map(r => r.id);

  // Items exhausted, archetypes NOT — draw must still be an archetype, not abstract.
  const itemsGone = campaign.buildScoreContract(allItems, []);
  assert.equal(itemsGone.objective.params?.scoreItemId, undefined);
  assert.equal(typeof itemsGone.objective.params?.scoreArchetypeId, 'string');

  // Archetypes exhausted, items NOT — draw must still be an item, not abstract.
  const archetypesGone = campaign.buildScoreContract([], allArchetypes);
  assert.equal(archetypesGone.objective.params?.scoreArchetypeId, undefined);
  assert.equal(typeof archetypesGone.objective.params?.scoreItemId, 'string');

  // Both exhausted → abstract fallback, neither param present.
  const bothGone = campaign.buildScoreContract(allItems, allArchetypes);
  assert.equal(bothGone.objective.params?.scoreItemId, undefined);
  assert.equal(bothGone.objective.params?.scoreArchetypeId, undefined);
});

test('settlement records the drawn archetype reward when items are exhausted, never both meta fields', () => {
  const campaign = m7ScoreReadyCampaign();
  const decker = campaign.crew.find(m => m.archetype === 'Decker')!;
  const partner = campaign.crew.find(m => m.archetype !== 'Decker')!;
  const allItems = SCOREABLE_ITEMS.map(i => i.id);
  const contract = campaign.buildScoreContract(allItems, []);
  const expectedArchetypeId = contract.objective.params!.scoreArchetypeId as string;
  campaign.deployCrewMember(decker.id, contract, partner.id).enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: true });
  assert.equal(campaign.endReason, 'score-complete');
  assert.equal(campaign.scoreUnlockedArchetypeId, expectedArchetypeId);
  assert.equal(campaign.scoreUnlockedItemId, null, 'never both');
});

test('a score-partial outcome writes nothing to either meta-store key', () => {
  const campaign = m7ScoreReadyCampaign();
  const decker = campaign.crew.find(m => m.archetype === 'Decker')!;
  const partner = campaign.crew.find(m => m.archetype !== 'Decker')!;
  const allItems = SCOREABLE_ITEMS.map(i => i.id);
  campaign
    .deployCrewMember(decker.id, campaign.buildScoreContract(allItems, []), partner.id)
    .enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: false });
  assert.equal(campaign.endReason, 'score-partial');
  assert.equal(campaign.scoreUnlockedItemId, null);
  assert.equal(campaign.scoreUnlockedArchetypeId, null);
});

test('SCOREABLE_ARCHETYPE_IDS matches the SCOREABLE_ARCHETYPES catalog', () => {
  assert.deepEqual(new Set(SCOREABLE_ARCHETYPE_IDS), new Set(SCOREABLE_ARCHETYPES.map(r => r.id)));
});

// ─── P3.5.M7: gating crew generation via Campaign construction-time unlocks ─

test('unlockedArchetypeIds: [] gates the starter trio to merc/razor/tech only', () => {
  for (let seed = 0; seed < 40; seed++) {
    const campaign = new Campaign({ seed, unlockedArchetypeIds: [] });
    for (const member of campaign.crew) {
      assert.ok(
        ['Merc', 'Razor', 'Tech'].includes(member.constructor.name),
        `seed ${seed}: unexpected "${member.constructor.name}" with archetypes locked`
      );
    }
  }
});

test('unlockedArchetypeIds with all three gated archetypes reaches all six starter archetypes', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 150; seed++) {
    const campaign = new Campaign({ seed, unlockedArchetypeIds: ['berserk', 'adept', 'chimera'] });
    for (const member of campaign.crew) seen.add(member.constructor.name);
  }
  assert.deepEqual(seen, new Set(['Merc', 'Razor', 'Tech', 'Berserk', 'Adept', 'Chimera']));
});

test('a partial unlock (only Berserk) reaches exactly four starter archetypes across enough campaigns', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 150; seed++) {
    const campaign = new Campaign({ seed, unlockedArchetypeIds: ['berserk'] });
    for (const member of campaign.crew) seen.add(member.constructor.name);
  }
  assert.deepEqual(seen, new Set(['Merc', 'Razor', 'Tech', 'Berserk']));
});

test('omitting unlockedArchetypeIds stays ungated (bare engine/test construction reaches all six)', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 150; seed++) {
    const campaign = new Campaign({ seed });
    for (const member of campaign.crew) seen.add(member.constructor.name);
  }
  assert.deepEqual(seen, new Set(['Merc', 'Razor', 'Tech', 'Berserk', 'Adept', 'Chimera']));
});

test('generateInitialCandidates respects the same gating (never rolls a locked archetype)', () => {
  const campaign = new Campaign({ seed: 1, crew: [], unlockedArchetypeIds: [] });
  for (let seed = 0; seed < 100; seed++) {
    campaign.rng = new Rng(seed);
    for (const candidate of campaign.generateInitialCandidates()) {
      assert.ok(['Merc', 'Razor', 'Tech'].includes(candidate.constructor.name));
    }
  }
});

test('generateRecruits respects the same gating (never rolls a locked archetype)', () => {
  const campaign = new Campaign({ seed: 1, rep: 80, unlockedArchetypeIds: [] });
  for (let seed = 0; seed < 100; seed++) {
    campaign.rng = new Rng(seed);
    for (const recruit of campaign.generateRecruits()) {
      assert.ok(
        !['Berserk', 'Adept', 'Chimera'].includes(recruit.constructor.name),
        `seed ${seed}: rolled locked archetype "${recruit.constructor.name}"`
      );
    }
  }
});

// ─── Showcase-slot follow-up (2026-07-14): reserve candidate slot 0 ────────

test('showcaseArchetypeId reserves initialCandidates[0] for that archetype', () => {
  for (let seed = 0; seed < 30; seed++) {
    const campaign = new Campaign({
      seed,
      crew: [],
      unlockedArchetypeIds: ['berserk', 'adept', 'chimera'],
      showcaseArchetypeId: 'berserk',
    });
    const candidates = campaign.generateInitialCandidates();
    assert.equal(candidates.length, 3);
    assert.equal(candidates[0].constructor.name, 'Berserk');
    assert.equal(candidates[0].id, 'crew-init-0');
  }
});

test('showcaseArchetypeId still yields 3 unique candidates with unique callsigns', () => {
  const campaign = new Campaign({
    seed: 5,
    crew: [],
    unlockedArchetypeIds: ['berserk'],
    showcaseArchetypeId: 'berserk',
  });
  const candidates = campaign.generateInitialCandidates();
  assert.equal(candidates.length, 3);
  assert.equal(new Set(candidates.map(c => c.callsign)).size, 3);
  assert.equal(new Set(candidates.map(c => c.id)).size, 3);
});

test('the other two showcase-run slots still roll normally (not forced to any particular archetype)', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 60; seed++) {
    const campaign = new Campaign({
      seed,
      crew: [],
      unlockedArchetypeIds: ['berserk', 'adept', 'chimera'],
      showcaseArchetypeId: 'berserk',
    });
    const candidates = campaign.generateInitialCandidates();
    for (const candidate of candidates.slice(1)) seen.add(candidate.constructor.name);
  }
  // Slots 1–2 should still range over more than just Berserk across enough seeds.
  assert.ok(
    seen.size > 1,
    `expected varied archetypes in the non-showcase slots, got ${[...seen]}`
  );
});

test('no showcaseArchetypeId (the ordinary case) behaves exactly as before — no forced slot', () => {
  const campaign = new Campaign({ seed: 9, crew: [] });
  const candidates = campaign.generateInitialCandidates();
  assert.equal(candidates.length, 3);
  // Not asserting a specific archetype — just that construction succeeds
  // and nothing about the ordinary path changed shape.
  assert.equal(campaign.showcaseArchetypeId, null);
});

test('showcaseArchetypeId defensively no-ops when the id is not actually reachable under gating', () => {
  // Simulates a stale/hand-edited save: showcase points at an archetype that
  // (per unlockedArchetypeIds) isn't actually unlocked. Must not throw or
  // leak a locked archetype into the candidate pool — just skip the reservation.
  const campaign = new Campaign({
    seed: 3,
    crew: [],
    unlockedArchetypeIds: [], // berserk NOT unlocked, contradicting the showcase below
    showcaseArchetypeId: 'berserk',
  });
  const candidates = campaign.generateInitialCandidates();
  assert.equal(candidates.length, 3);
  for (const candidate of candidates) {
    assert.ok(['Merc', 'Razor', 'Tech'].includes(candidate.constructor.name));
  }
});

test('Campaign rejects a malformed showcaseArchetypeId (empty string)', () => {
  assert.throws(() => new Campaign({ seed: 1, showcaseArchetypeId: '' }), /showcaseArchetypeId/);
});

test('Campaign accepts an explicit null showcaseArchetypeId (DataStore.pendingArchetypeShowcase shape)', () => {
  const campaign = new Campaign({ seed: 1, crew: [], showcaseArchetypeId: null });
  assert.equal(campaign.showcaseArchetypeId, null);
  const candidates = campaign.generateInitialCandidates();
  assert.equal(candidates.length, 3);
});
