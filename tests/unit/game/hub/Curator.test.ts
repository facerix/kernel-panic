import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../../../../src/rng.js';
import {
  CONTRACT_DIFFICULTY,
  FACTION,
  SALVAGE_TO_CRED_RATE,
  TILE,
} from '../../../../src/game/constants.js';
import {
  buildContractRecipeFixture,
  CONTRACT_LEXICON,
  CONTRACT_RECIPES,
  Curator,
  OBJECTIVES,
  assertLabelObjectiveRegistryInSync,
  isObjective,
} from '../../../../src/game/hub/Curator.js';
import { buildHub } from '../../../../src/game/hub/SafeSpace.js';

test('Curator constructs with NEUTRAL faction and zero AP', () => {
  const c = new Curator({ x: 2, y: 3 });
  assert.equal(c.faction, FACTION.NEUTRAL);
  assert.equal(c.maxAp, 0);
  assert.equal(c.glyph, 'C');
  assert.equal(c.x, 2);
  assert.equal(c.y, 3);
  assert.equal(c.alive, true);
});

test('generateContract is deterministic for the same Rng state', () => {
  const a = new Curator().generateContract(new Rng(123));
  const b = new Curator().generateContract(new Rng(123));
  assert.deepEqual(a, b);
});

test('generateContracts returns a deterministic board of 3 tiered contracts', () => {
  const a = new Curator().generateContracts(new Rng(123));
  const b = new Curator().generateContracts(new Rng(123));
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  for (const contract of a) {
    assert.ok(isObjective(contract.objective), `unknown objective ${contract.objective}`);
    assert.ok(
      Object.values(CONTRACT_DIFFICULTY).includes(contract.difficulty),
      `unknown difficulty ${contract.difficulty}`
    );
    assert.ok(contract.threatCount >= 2);
    assert.ok(contract.context, 'generated contracts should carry structured context metadata');
    assert.ok(contract.context.tags.includes(`objective:${contract.objective.kind}`));
    assert.ok(Number.isInteger(contract.reward.credits) && contract.reward.credits >= 0);
    assert.ok(Number.isInteger(contract.reward.repDelta));
  }
  assert.equal(new Set(a.map(contract => contract.label)).size, a.length);
});

test('contract objective is in the known set and threatCount > 0', () => {
  const contract = new Curator().generateContract(new Rng(0xdeadbeef));
  assert.ok(isObjective(contract.objective), `unknown objective ${contract.objective}`);
  assert.ok(typeof contract.objective.title === 'string' && contract.objective.title.length > 0);
  assert.ok(
    typeof contract.objective.briefing === 'string' && contract.objective.briefing.length > 0
  );
  assert.ok(Object.values(CONTRACT_DIFFICULTY).includes(contract.difficulty));
  assert.ok(contract.threatCount > 0);
  assert.ok(typeof contract.label === 'string' && contract.label.length > 0);
  assert.ok(Number.isInteger(contract.seed) && contract.seed >= 0);
  assert.ok(Number.isInteger(contract.reward.credits));
  assert.ok(Number.isInteger(contract.reward.repDelta));
});

test('contract label pool matches objective registry', () => {
  assertLabelObjectiveRegistryInSync();
});

test('lexicon includes expanded corps, civic authorities, and rival factions', () => {
  const principalLabels = new Set(CONTRACT_LEXICON.principals.map(token => token.label));
  for (const label of [
    'Kestrel Dynamics',
    'Sable-Kline Systems',
    'HelioDyne Combine',
    'Orchid Vector',
    'Northstar Civic',
    'Marrowgate Logistics',
    'Bayline Transit Authority',
    'District Water Board',
    'Civic Grid Office',
    'Port Warden Bureau',
    'Chrome Choir',
    'Redline Union',
    'Null Saints',
  ]) {
    assert.ok(principalLabels.has(label), `missing principal token ${label}`);
  }
});

test('recipe fixtures cover every shipped objective family', () => {
  const fixtures = [
    buildContractRecipeFixture({
      recipeId: 'retrieve-asset',
      principalId: 'orchid-vector',
      siteId: 'clinic',
      siteStateId: 'gassed',
      assetId: 'clinic-records',
      actionId: 'recover',
      difficulty: CONTRACT_DIFFICULTY.STANDARD,
      seed: 1,
    }),
    buildContractRecipeFixture({
      recipeId: 'handoff-transfer',
      principalId: 'redline-union',
      siteId: 'pier-7',
      assetId: 'cryo-manifest',
      actionId: 'handoff',
      difficulty: CONTRACT_DIFFICULTY.STANDARD,
      seed: 2,
    }),
    buildContractRecipeFixture({
      recipeId: 'terminal-slice',
      principalId: 'kestrel-dynamics',
      siteId: 'server-farm',
      assetId: 'sentinel-terminal',
      actionId: 'spike',
      difficulty: CONTRACT_DIFFICULTY.STANDARD,
      seed: 3,
    }),
    buildContractRecipeFixture({
      recipeId: 'deny-asset',
      principalId: 'heliodyne',
      siteId: 'block-9',
      assetId: 'community-power',
      actionId: 'burn',
      difficulty: CONTRACT_DIFFICULTY.STANDARD,
      seed: 4,
    }),
    buildContractRecipeFixture({
      recipeId: 'sweep-nodes',
      principalId: 'port-warden-bureau',
      siteId: 'skybridge',
      assetId: 'skybridge-relay',
      actionId: 'blind',
      difficulty: CONTRACT_DIFFICULTY.STANDARD,
      seed: 5,
    }),
    buildContractRecipeFixture({
      recipeId: 'dual-site-sync',
      principalId: 'matsuda',
      siteId: 'contractor-annex',
      assetId: 'payroll',
      actionId: 'mirror',
      difficulty: CONTRACT_DIFFICULTY.STANDARD,
      seed: 6,
    }),
    buildContractRecipeFixture({
      recipeId: 'recon-map',
      principalId: 'northstar-civic',
      siteId: 'transit-hub',
      assetId: 'site-layout',
      actionId: 'survey',
      difficulty: CONTRACT_DIFFICULTY.STANDARD,
      seed: 7,
    }),
    buildContractRecipeFixture({
      recipeId: 'escort-extract',
      principalId: 'orchid-vector',
      siteId: 'clinic',
      assetId: 'clinic-witness',
      actionId: 'escort',
      difficulty: CONTRACT_DIFFICULTY.STANDARD,
      seed: 8,
    }),
  ];
  const kinds = new Set(fixtures.map(contract => contract.objective.kind));
  for (const kind of [
    OBJECTIVES.RETRIEVE,
    OBJECTIVES.HANDOFF,
    OBJECTIVES.TERMINAL_SLICE,
    OBJECTIVES.DENY,
    OBJECTIVES.SWEEP,
    OBJECTIVES.DUAL_SITE,
    OBJECTIVES.RECON,
    OBJECTIVES.ESCORT_EXTRACT,
  ]) {
    assert.ok(kinds.has(kind), `missing fixture coverage for ${kind}`);
  }
  for (const contract of fixtures) {
    assert.ok(isObjective(contract.objective));
    assert.ok(contract.context);
    assert.ok(!contract.label.includes('{{'));
    assert.ok(!contract.objective.title.includes('{{'));
    assert.ok(!contract.objective.briefing.includes('{{'));
  }
});

test('recipe fixtures produce named compatibility examples', () => {
  const matsuda = buildContractRecipeFixture({
    recipeId: 'dual-site-sync',
    principalId: 'matsuda',
    siteId: 'contractor-annex',
    assetId: 'payroll',
    actionId: 'mirror',
    difficulty: CONTRACT_DIFFICULTY.STANDARD,
    seed: 7,
  });
  assert.equal(matsuda.label, '// Matsuda payroll mirror');
  assert.equal(matsuda.objective.kind, OBJECTIVES.DUAL_SITE);
  assert.deepEqual(matsuda.objective.params, { target: 'payroll-mirror', count: 2 });

  const block9 = buildContractRecipeFixture({
    recipeId: 'deny-asset',
    principalId: 'heliodyne',
    siteId: 'block-9',
    assetId: 'community-power',
    actionId: 'burn',
    difficulty: CONTRACT_DIFFICULTY.STANDARD,
    seed: 8,
  });
  assert.equal(block9.label, '// Block 9 community power burn');
  assert.equal(block9.objective.kind, OBJECTIVES.DENY);
  assert.deepEqual(block9.objective.params, { target: 'power-siphon' });
  assert.equal(block9.context.principal.label, 'HelioDyne Combine');
  assert.equal(block9.context.site?.label, 'Block 9');
  assert.ok(block9.context.tags.includes('principal:heliodyne'));
  assert.ok(block9.context.tags.includes('site:block-9'));

  const northstar = buildContractRecipeFixture({
    recipeId: 'recon-map',
    principalId: 'northstar-civic',
    siteId: 'transit-hub',
    assetId: 'site-layout',
    actionId: 'survey',
    difficulty: CONTRACT_DIFFICULTY.STANDARD,
    seed: 9,
  });
  assert.equal(northstar.label, '// transit hub site layout survey');
  assert.equal(northstar.objective.kind, OBJECTIVES.RECON);
  assert.deepEqual(northstar.objective.params, { target: 'site-layout' });
  assert.equal(northstar.context.principal.label, 'Northstar Civic');
  assert.equal(northstar.context.site?.label, 'transit hub');

  const witness = buildContractRecipeFixture({
    recipeId: 'escort-extract',
    principalId: 'orchid-vector',
    siteId: 'clinic',
    assetId: 'clinic-witness',
    actionId: 'escort',
    difficulty: CONTRACT_DIFFICULTY.STANDARD,
    seed: 10,
  });
  assert.equal(witness.label, '// clinic clinic witness escort');
  assert.equal(witness.objective.kind, OBJECTIVES.ESCORT_EXTRACT);
  assert.deepEqual(witness.objective.params, {
    target: 'clinic-witness',
    contact: 'clinic witness',
  });
  assert.equal(witness.context.principal.label, 'Orchid Vector');
  assert.equal(witness.context.site?.label, 'clinic');
});

test('contract context separates principals from site state', () => {
  const clinic = buildContractRecipeFixture({
    recipeId: 'retrieve-asset',
    principalId: 'orchid-vector',
    siteId: 'clinic',
    siteStateId: 'gassed',
    assetId: 'clinic-records',
    actionId: 'recover',
    difficulty: CONTRACT_DIFFICULTY.STANDARD,
    seed: 10,
  });
  assert.equal(clinic.label, '// Gassed clinic records recovery');
  assert.equal(clinic.context.principal.label, 'Orchid Vector');
  assert.equal(clinic.context.site?.label, 'clinic');
  assert.equal(clinic.context.siteState?.label, 'Gassed');
  assert.ok(clinic.context.tags.includes('site-state:gassed'));
  assert.ok(clinic.context.asset.groups.includes('medical'));
});

test('recipe fixture rejects incompatible tokens loudly', () => {
  assert.throws(
    () =>
      buildContractRecipeFixture({
        recipeId: 'dual-site-sync',
        principalId: 'matsuda',
        assetId: 'server-farm',
        actionId: 'mirror',
        difficulty: CONTRACT_DIFFICULTY.STANDARD,
        seed: 9,
      }),
    /not compatible/
  );
});

test('same seed plus same arc stage yields identical recipe contracts', () => {
  const a = new Curator().generateContracts(new Rng(999), { arcStage: 'act-1' });
  const b = new Curator().generateContracts(new Rng(999), { arcStage: 'act-1' });
  assert.deepEqual(a, b);
  for (const contract of a) {
    assert.equal(contract.context.arcStage, 'act-1');
  }
});

test('different seeds vary compatible recipe output', () => {
  const labels = new Set<string>();
  for (let seed = 0; seed < 8; seed++) {
    for (const contract of new Curator().generateContracts(new Rng(seed))) {
      labels.add(contract.label);
      assert.ok(isObjective(contract.objective));
      assert.ok(contract.context.recipeId);
    }
  }
  assert.ok(labels.size > CONTRACT_RECIPES.length, 'expected token combinations beyond recipe ids');
});

test('different Rng states yield different seeds (no constant return)', () => {
  // Pull two contracts from different streams; with five labels + 2³¹ seeds
  // the seeds collision probability is negligible, so two distinct rngs
  // producing identical seeds would be a sign generateContract isn't
  // actually consuming randomness.
  const a = new Curator().generateContract(new Rng(1));
  const b = new Curator().generateContract(new Rng(2));
  assert.notEqual(a.seed, b.seed, 'expected different seeds from different rngs');
});

test('generateContract throws on missing rng', () => {
  assert.throws(() => new Curator().generateContract(null), /requires an Rng/);
});

test('better-contracts shifts the board toward elevated/critical tiers and raises Cred floors', () => {
  const normalCounts = { elevatedOrCritical: 0, credits: 0 };
  const betterCounts = { elevatedOrCritical: 0, credits: 0 };
  for (let seed = 0; seed < 200; seed++) {
    for (const contract of new Curator().generateContracts(new Rng(seed), { meta: {} })) {
      if (contract.difficulty !== CONTRACT_DIFFICULTY.STANDARD) normalCounts.elevatedOrCritical++;
      normalCounts.credits += contract.reward.credits;
    }
    for (const contract of new Curator().generateContracts(new Rng(seed), {
      meta: { betterContracts: true },
    })) {
      if (contract.difficulty !== CONTRACT_DIFFICULTY.STANDARD) betterCounts.elevatedOrCritical++;
      betterCounts.credits += contract.reward.credits;
      assert.ok(
        contract.reward.credits >= 20 + 2 * SALVAGE_TO_CRED_RATE,
        'better-contracts should raise reward floors by 20 Cr'
      );
    }
  }
  assert.ok(
    betterCounts.elevatedOrCritical > normalCounts.elevatedOrCritical,
    'better-contracts should offer more elevated/critical jobs'
  );
  assert.ok(
    betterCounts.credits > normalCounts.credits,
    'better-contracts should improve aggregate Cred rewards'
  );
});

test('Curator is immobile — refreshAp keeps ap at 0', () => {
  const c = new Curator();
  c.refreshAp();
  assert.equal(c.ap, 0);
  assert.equal(c.canAfford(1), false);
});

test('buildHub places spawn and curator on FLOOR; exit on TILE.EXIT', () => {
  const hub = buildHub();
  assert.equal(hub.grid.isPassable(hub.playerSpawn.x, hub.playerSpawn.y), true);
  assert.equal(hub.grid.isPassable(hub.curatorSpawn.x, hub.curatorSpawn.y), true);
  assert.equal(hub.grid.isPassable(hub.exitTile.x, hub.exitTile.y), true);
  assert.equal(hub.grid.tileAt(hub.exitTile.x, hub.exitTile.y), TILE.EXIT);
});

test('buildHub returns a stable layout (idempotent)', () => {
  const a = buildHub();
  const b = buildHub();
  assert.deepEqual(Array.from(a.grid.tiles), Array.from(b.grid.tiles));
  assert.deepEqual(a.playerSpawn, b.playerSpawn);
  assert.deepEqual(a.curatorSpawn, b.curatorSpawn);
  assert.deepEqual(a.exitTile, b.exitTile);
  assert.deepEqual(a.terminalSpawn, b.terminalSpawn);
});

test('buildHub returns a terminalSpawn distinct from other interactables', () => {
  const hub = buildHub();
  assert.ok(hub.terminalSpawn, 'expected terminalSpawn in buildHub() result');
  assert.equal(typeof hub.terminalSpawn.x, 'number');
  assert.equal(typeof hub.terminalSpawn.y, 'number');
  // Terminal must occupy a walkable tile so the player can stand adjacent.
  assert.equal(hub.grid.isPassable(hub.terminalSpawn.x, hub.terminalSpawn.y), true);
  // …and must not collide with the player spawn, Curator, or door.
  const same = (a, b) => a.x === b.x && a.y === b.y;
  assert.ok(!same(hub.terminalSpawn, hub.playerSpawn), 'terminal overlaps player spawn');
  assert.ok(!same(hub.terminalSpawn, hub.curatorSpawn), 'terminal overlaps curator');
  assert.ok(!same(hub.terminalSpawn, hub.exitTile), 'terminal overlaps exit tile');
});
