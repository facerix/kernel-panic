/**
 * P3.M3.1 — Cyberspace-capable contract metadata + gates.
 *
 * The DATA_NODE_SLICE objective kind carries `requiresCyberspace: true` in its
 * params, is generated only in Act 2+ when a living Decker is on the roster,
 * and deploying such a contract with anyone but a living Decker fails loudly
 * at the Hub boundary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Curator,
  OBJECTIVES,
  CONTRACT_RECIPES,
  assertLabelObjectiveRegistryInSync,
  contractRequiresCyberspace,
  normalizeObjective,
} from '../../../../src/game/hub/Curator.js';
import { Campaign, CAMPAIGN_STATE } from '../../../../src/game/Campaign.js';
import { RUN_STATE } from '../../../../src/game/Run.js';
import { Rng } from '../../../../src/rng.js';
import { testContractContext } from '../contractTestUtils.js';
import type { Contract } from '../../../../src/game/hub/Curator.js';
import type { CampaignArcStage } from '../../../../src/types.js';

const cyberObjective = (
  params: Record<string, string | number | boolean> | null = {
    requiresCyberspace: true,
    count: 1,
  }
) => ({
  kind: OBJECTIVES.DATA_NODE_SLICE,
  title: 'Spike the server farm',
  briefing: 'Jack in, slice the data node, then extract.',
  ...(params ? { params } : {}),
});

const cyberContract = (overrides: Partial<Contract> = {}): Contract =>
  ({
    seed: 12345,
    mapWidth: 24,
    mapHeight: 16,
    objective: cyberObjective(),
    difficulty: 'standard',
    threatCount: 1,
    label: '// test cyber job',
    context: testContractContext(OBJECTIVES.DATA_NODE_SLICE),
    reward: { credits: 0, repDelta: 0 },
    ...overrides,
  }) as Contract;

// --- objective validation -------------------------------------------------

test('normalizeObjective accepts a well-formed data-node-slice objective', () => {
  const normalized = normalizeObjective(cyberObjective());
  assert.equal(normalized.kind, OBJECTIVES.DATA_NODE_SLICE);
  assert.equal(normalized.params?.requiresCyberspace, true);
  assert.equal(normalized.params?.count, 1);
});

test('normalizeObjective throws on data-node-slice without requiresCyberspace', () => {
  assert.throws(() => normalizeObjective(cyberObjective(null)), /requiresCyberspace/);
  assert.throws(() => normalizeObjective(cyberObjective({ count: 1 })), /requiresCyberspace/);
  assert.throws(
    () => normalizeObjective(cyberObjective({ requiresCyberspace: false, count: 1 })),
    /requiresCyberspace/
  );
  assert.throws(
    () => normalizeObjective(cyberObjective({ requiresCyberspace: 'yes', count: 1 })),
    /requiresCyberspace/
  );
});

test('normalizeObjective throws on data-node-slice with a malformed count', () => {
  assert.throws(
    () => normalizeObjective(cyberObjective({ requiresCyberspace: true })),
    /count/
  );
  assert.throws(
    () => normalizeObjective(cyberObjective({ requiresCyberspace: true, count: 0 })),
    /count/
  );
  assert.throws(
    () => normalizeObjective(cyberObjective({ requiresCyberspace: true, count: 1.5 })),
    /count/
  );
});

test('normalizeObjective throws when requiresCyberspace appears on a non-cyber kind', () => {
  assert.throws(
    () =>
      normalizeObjective({
        kind: OBJECTIVES.RETRIEVE,
        title: 'Secure cache',
        briefing: 'Find the cache.',
        params: { requiresCyberspace: true },
      }),
    /requiresCyberspace/
  );
});

test('contractRequiresCyberspace is true only for validated cyber contracts', () => {
  assert.equal(contractRequiresCyberspace(cyberContract()), true);
  assert.equal(
    contractRequiresCyberspace(
      cyberContract({
        objective: {
          kind: OBJECTIVES.REACH_EXIT,
          title: 'Extract clean',
          briefing: 'Reach the exit.',
        },
      })
    ),
    false
  );
});

// --- recipe + generation gating --------------------------------------------

test('a cyber-data-spike recipe covers the data-node-slice kind', () => {
  const recipe = CONTRACT_RECIPES.find(r => r.objectiveKind === OBJECTIVES.DATA_NODE_SLICE);
  assert.ok(recipe, 'expected a recipe covering data-node-slice');
  assertLabelObjectiveRegistryInSync();
});

function boardKinds(arcStage: CampaignArcStage, hasLivingDecker: boolean, seeds: number) {
  const curator = new Curator();
  const kinds: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    for (const contract of curator.generateContracts(new Rng(seed), {
      rep: 60,
      arcStage,
      hasLivingDecker,
    })) {
      kinds.push(contract.objective.kind);
    }
  }
  return kinds;
}

test('data-node-slice never generates in Act 1, even with a living Decker', () => {
  assert.ok(!boardKinds('act-1', true, 40).includes(OBJECTIVES.DATA_NODE_SLICE));
});

test('data-node-slice never generates without a living Decker', () => {
  assert.ok(!boardKinds('act-2', false, 40).includes(OBJECTIVES.DATA_NODE_SLICE));
  // Plain campaign fixtures that never mention the Decker behave the same.
  const curator = new Curator();
  for (let seed = 1; seed <= 40; seed++) {
    for (const contract of curator.generateContracts(new Rng(seed), {
      rep: 60,
      arcStage: 'act-2',
    })) {
      assert.notEqual(contract.objective.kind, OBJECTIVES.DATA_NODE_SLICE);
    }
  }
});

test('data-node-slice generates in Act 2+ with a living Decker, validated and door-free', () => {
  const curator = new Curator();
  let found = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (const contract of curator.generateContracts(new Rng(seed), {
      rep: 60,
      arcStage: 'act-2',
      hasLivingDecker: true,
    })) {
      if (contract.objective.kind !== OBJECTIVES.DATA_NODE_SLICE) continue;
      found += 1;
      assert.equal(contractRequiresCyberspace(contract), true);
      assert.equal(contract.objective.params?.requiresCyberspace, true);
      assert.equal(typeof contract.objective.params?.count, 'number');
      // Cyber contracts route through the jack-in port, not prefab doors.
      assert.equal(contract.objective.params?.requiresUnlock, undefined);
    }
  }
  assert.ok(found > 0, 'expected at least one cyber contract across 40 seeded boards');
});

test('cyber-capable board generation is deterministic per seed', () => {
  const campaign = { rep: 60, arcStage: 'act-2' as const, hasLivingDecker: true };
  const a = new Curator().generateContracts(new Rng(777), campaign);
  const b = new Curator().generateContracts(new Rng(777), campaign);
  assert.deepEqual(a, b);
});

// --- Campaign deploy gate ---------------------------------------------------

/** Act-2 campaign whose arc transition has auto-assigned a Decker (P3.M1.2). */
function act2CampaignWithDecker(): Campaign {
  const campaign = new Campaign({ seed: 42, rep: 60, completedJobs: 4 });
  assert.equal(campaign.arcStage, 'act-2');
  assert.ok(campaign.crew.some(m => m.archetype === 'Decker'));
  return campaign;
}

test('Campaign.hasLivingDecker tracks roster state', () => {
  const fresh = new Campaign({ seed: 42 });
  assert.equal(fresh.hasLivingDecker, false);

  const campaign = act2CampaignWithDecker();
  assert.equal(campaign.hasLivingDecker, true);

  const decker = campaign.crew.find(m => m.archetype === 'Decker')!;
  campaign.flatlineMember(decker.id);
  assert.equal(campaign.hasLivingDecker, false);
});

test('deploying a non-Decker on a cyber contract throws at the Hub boundary', () => {
  const campaign = act2CampaignWithDecker();
  const merc = campaign.crew.find(m => m.archetype !== 'Decker')!;
  assert.throws(() => campaign.deployCrewMember(merc.id, cyberContract()), /Decker/);
  assert.equal(campaign.state, CAMPAIGN_STATE.HUB, 'failed deploy must not leave the Hub');
});

test('a living Decker deploys onto a cyber contract', () => {
  const campaign = act2CampaignWithDecker();
  const decker = campaign.crew.find(m => m.archetype === 'Decker')!;
  const run = campaign.deployCrewMember(decker.id, cyberContract());
  assert.equal(run.state, RUN_STATE.BRIEFING);
  assert.equal(campaign.state, CAMPAIGN_STATE.COMBAT);
});

test('a flatlined Decker cannot deploy onto a cyber contract', () => {
  const campaign = act2CampaignWithDecker();
  const decker = campaign.crew.find(m => m.archetype === 'Decker')!;
  campaign.flatlineMember(decker.id);
  assert.throws(() => campaign.deployCrewMember(decker.id, cyberContract()), /flatlined/);
});
