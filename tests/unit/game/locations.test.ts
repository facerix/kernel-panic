import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { TILE } from '../../../src/game/constants.js';
import {
  applyMutationDeltas,
  mergeSiteDeltas,
  normalizeLocationSite,
  generateSiteId,
} from '../../../src/game/locations.js';
import { Campaign, SITE_ROSTER_CAP } from '../../../src/game/Campaign.js';
import { snapshotCampaign, restoreCampaign } from '../../../src/game/persistence.js';
import {
  Curator,
  OBJECTIVES,
  SITE_REVISIT_CHANCE,
  normalizeContractContext,
} from '../../../src/game/hub/Curator.js';
import { OUTCOME } from '../../../src/game/Run.js';
import { KeyCard } from '../../../src/game/entities/KeyCard.js';
import { Door } from '../../../src/game/entities/Door.js';
import { Rng } from '../../../src/rng.js';
import { resolveMapDimensions } from '../../../src/game/procgen/mapDimensions.js';
import type { Contract } from '../../../src/game/hub/Curator.js';
import type { LocationSite, TileDelta } from '../../../src/types.js';

function validSite(overrides: Partial<LocationSite> = {}): LocationSite {
  return {
    id: '12345',
    seed: '12345',
    mapWidth: 24,
    mapHeight: 16,
    label: '// Matsuda payroll mirror',
    tier: 'roster',
    scoreTarget: false,
    mutationDeltas: [],
    lastVisitedJob: 0,
    ...overrides,
  };
}

// ─── generateSiteId ─────────────────────────────────────────────────────────

test('generateSiteId stringifies a numeric seed deterministically', () => {
  assert.equal(generateSiteId(12345), '12345');
  assert.equal(generateSiteId(12345), generateSiteId(12345));
});

test('generateSiteId passes through a non-empty string seed', () => {
  assert.equal(generateSiteId('12345'), '12345');
});

test('generateSiteId rejects bad seeds', () => {
  assert.throws(() => generateSiteId(NaN), /finite/);
  assert.throws(() => generateSiteId(''), /finite number or non-empty string/);
});

// ─── applyMutationDeltas (case 4) ─────────────────────────────────────────────

test('applyMutationDeltas: two wall breaches replay onto the grid', () => {
  const grid = new Grid(5, 5, TILE.WALL);
  const deltas: TileDelta[] = [
    { kind: 'tile', x: 1, y: 1, from: TILE.WALL, to: TILE.RUBBLE },
    { kind: 'tile', x: 3, y: 2, from: TILE.WALL, to: TILE.RUBBLE },
  ];
  applyMutationDeltas(grid, deltas);
  assert.equal(grid.tileAt(1, 1), TILE.RUBBLE);
  assert.equal(grid.tileAt(3, 2), TILE.RUBBLE);
  // Untouched cells keep their original value.
  assert.equal(grid.tileAt(0, 0), TILE.WALL);
});

test('applyMutationDeltas: entity-removed delta mutates no tile', () => {
  const grid = new Grid(5, 5, TILE.FLOOR);
  applyMutationDeltas(grid, [
    { kind: 'entity-removed', id: 'door-entity-0', x: 2, y: 2, archetype: 'door' },
  ]);
  assert.equal(grid.tileAt(2, 2), TILE.FLOOR);
});

test('applyMutationDeltas: does not mutate the deltas array', () => {
  const grid = new Grid(3, 3, TILE.WALL);
  const deltas: TileDelta[] = [{ kind: 'tile', x: 1, y: 1, from: TILE.WALL, to: TILE.RUBBLE }];
  applyMutationDeltas(grid, deltas);
  assert.deepEqual(deltas, [{ kind: 'tile', x: 1, y: 1, from: TILE.WALL, to: TILE.RUBBLE }]);
});

// ─── applyMutationDeltas corruption (cases 5, 6) ──────────────────────────────

test('applyMutationDeltas: unknown delta kind throws', () => {
  const grid = new Grid(5, 5);
  assert.throws(
    () => applyMutationDeltas(grid, [{ kind: 'teleport', x: 1, y: 1 } as unknown as TileDelta]),
    /unknown kind/
  );
});

test('applyMutationDeltas: out-of-bounds coord throws', () => {
  const grid = new Grid(5, 5);
  assert.throws(
    () =>
      applyMutationDeltas(grid, [{ kind: 'tile', x: 9, y: 9, from: TILE.WALL, to: TILE.RUBBLE }]),
    /out of bounds/
  );
});

test('applyMutationDeltas: unknown tile value throws', () => {
  const grid = new Grid(5, 5);
  assert.throws(
    () => applyMutationDeltas(grid, [{ kind: 'tile', x: 1, y: 1, from: 0, to: 99 }]),
    /unknown tile id/
  );
});

// ─── mergeSiteDeltas (case 7) ─────────────────────────────────────────────────

test('mergeSiteDeltas: same-coordinate deltas keep the latest only', () => {
  const existing: TileDelta[] = [{ kind: 'tile', x: 2, y: 2, from: TILE.WALL, to: TILE.RUBBLE }];
  const incoming: TileDelta[] = [{ kind: 'tile', x: 2, y: 2, from: TILE.RUBBLE, to: TILE.FLOOR }];
  const merged = mergeSiteDeltas(existing, incoming);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], { kind: 'tile', x: 2, y: 2, from: TILE.RUBBLE, to: TILE.FLOOR });
});

test('mergeSiteDeltas: distinct coordinates are unioned', () => {
  const existing: TileDelta[] = [{ kind: 'tile', x: 1, y: 1, from: TILE.WALL, to: TILE.RUBBLE }];
  const incoming: TileDelta[] = [{ kind: 'tile', x: 4, y: 4, from: TILE.WALL, to: TILE.RUBBLE }];
  const merged = mergeSiteDeltas(existing, incoming);
  assert.equal(merged.length, 2);
});

test('mergeSiteDeltas: returns cloned deltas (no shared references)', () => {
  const existing: TileDelta[] = [{ kind: 'tile', x: 1, y: 1, from: TILE.WALL, to: TILE.RUBBLE }];
  const merged = mergeSiteDeltas(existing, []);
  assert.notEqual(merged[0], existing[0]);
  assert.deepEqual(merged[0], existing[0]);
});

// ─── normalizeLocationSite ────────────────────────────────────────────────────

test('normalizeLocationSite: valid site round-trips with cloned deltas', () => {
  const site = validSite({
    mutationDeltas: [{ kind: 'tile', x: 1, y: 1, from: TILE.WALL, to: TILE.RUBBLE }],
  });
  const normalized = normalizeLocationSite(site);
  assert.deepEqual(normalized, site);
  assert.notEqual(normalized.mutationDeltas, site.mutationDeltas);
  assert.notEqual(normalized.mutationDeltas[0], site.mutationDeltas[0]);
});

test('normalizeLocationSite: unknown tier throws', () => {
  assert.throws(() => normalizeLocationSite(validSite({ tier: 'gold' as never })), /unknown tier/);
});

test('normalizeLocationSite: non-boolean scoreTarget throws', () => {
  assert.throws(
    () => normalizeLocationSite(validSite({ scoreTarget: 'yes' as never })),
    /scoreTarget must be a boolean/
  );
});

test('normalizeLocationSite: empty id/seed/label throws', () => {
  assert.throws(() => normalizeLocationSite(validSite({ id: '' })), /id must be a non-empty/);
  assert.throws(() => normalizeLocationSite(validSite({ seed: '' })), /seed must be a non-empty/);
  assert.throws(() => normalizeLocationSite(validSite({ label: '' })), /label must be a non-empty/);
});

test('normalizeLocationSite: legacy site dimensions default to 24x16', () => {
  const raw = validSite() as Partial<LocationSite>;
  delete raw.mapWidth;
  delete raw.mapHeight;

  const normalized = normalizeLocationSite(raw);

  assert.equal(normalized.mapWidth, 24);
  assert.equal(normalized.mapHeight, 16);
});

test('normalizeLocationSite: partial dimensions throw instead of guessing', () => {
  const raw = validSite() as Partial<LocationSite>;
  delete raw.mapHeight;

  assert.throws(() => normalizeLocationSite(raw), /mapWidth and mapHeight/);
});

test('normalizeLocationSite: negative lastVisitedJob throws', () => {
  assert.throws(
    () => normalizeLocationSite(validSite({ lastVisitedJob: -1 })),
    /lastVisitedJob must be a non-negative integer/
  );
});

test('normalizeLocationSite: corrupt delta (unknown kind) throws', () => {
  assert.throws(
    () =>
      normalizeLocationSite(
        validSite({ mutationDeltas: [{ kind: 'nope' } as unknown as TileDelta] })
      ),
    /unknown kind/
  );
});

test('normalizeLocationSite: corrupt delta (negative coord) throws', () => {
  assert.throws(
    () =>
      normalizeLocationSite(
        validSite({
          mutationDeltas: [{ kind: 'tile', x: -1, y: 0, from: TILE.WALL, to: TILE.RUBBLE }],
        })
      ),
    /non-negative integer/
  );
});

// ─── Campaign roster (cases 1, 2, 3, 12) ──────────────────────────────────────

test('Campaign.addSiteToRoster: new site appears in roster (case 1)', () => {
  const campaign = new Campaign({ seed: 42 });
  campaign.addSiteToRoster(validSite({ id: 'a', seed: 'a' }));
  assert.equal(campaign.siteRoster.length, 1);
  assert.equal(campaign.findRosterSite('a')?.id, 'a');
});

test('Campaign.addSiteToRoster: re-adding refreshes lastVisitedJob, no duplicate', () => {
  const campaign = new Campaign({ seed: 42 });
  campaign.addSiteToRoster(validSite({ id: 'a', seed: 'a', lastVisitedJob: 1 }));
  campaign.addSiteToRoster(validSite({ id: 'a', seed: 'a', lastVisitedJob: 7 }));
  assert.equal(campaign.siteRoster.length, 1);
  assert.equal(campaign.findRosterSite('a')?.lastVisitedJob, 7);
});

test('Campaign.addSiteToRoster: evicts oldest roster-tier at capacity (case 2)', () => {
  const campaign = new Campaign({ seed: 42 });
  for (let i = 0; i < SITE_ROSTER_CAP; i++) {
    campaign.addSiteToRoster(validSite({ id: `s${i}`, seed: `s${i}`, lastVisitedJob: i }));
  }
  assert.equal(campaign.siteRoster.length, SITE_ROSTER_CAP);
  // s0 has the lowest lastVisitedJob → evicted when a new site arrives.
  campaign.addSiteToRoster(validSite({ id: 'new', seed: 'new', lastVisitedJob: 99 }));
  assert.equal(campaign.siteRoster.length, SITE_ROSTER_CAP);
  assert.equal(campaign.findRosterSite('s0'), null);
  assert.ok(campaign.findRosterSite('new'));
});

test('Campaign.addSiteToRoster: score-tier site is never evicted (case 3)', () => {
  const campaign = new Campaign({ seed: 42 });
  // The score site is the oldest (lastVisitedJob 0) but must survive.
  campaign.addSiteToRoster(
    validSite({ id: 'score', seed: 'score', tier: 'score', scoreTarget: true, lastVisitedJob: 0 })
  );
  for (let i = 1; i < SITE_ROSTER_CAP; i++) {
    campaign.addSiteToRoster(validSite({ id: `s${i}`, seed: `s${i}`, lastVisitedJob: i }));
  }
  campaign.addSiteToRoster(validSite({ id: 'new', seed: 'new', lastVisitedJob: 99 }));
  assert.ok(campaign.findRosterSite('score'), 'score site preserved');
  assert.equal(campaign.findRosterSite('s1'), null, 'oldest roster-tier evicted instead');
});

test('Campaign.mergeSiteDeltas: merges into the named site, throws if unknown', () => {
  const campaign = new Campaign({ seed: 42 });
  campaign.addSiteToRoster(validSite({ id: 'a', seed: 'a' }));
  campaign.mergeSiteDeltas('a', [{ kind: 'tile', x: 2, y: 3, from: TILE.WALL, to: TILE.RUBBLE }]);
  assert.equal(campaign.findRosterSite('a')?.mutationDeltas.length, 1);
  assert.throws(() => campaign.mergeSiteDeltas('missing', []), /unknown site/);
});

test('fresh Campaign has an empty roster (case 12: delete → new campaign)', () => {
  const campaign = new Campaign({ seed: 7 });
  assert.deepEqual(campaign.siteRoster, []);
});

// ─── Persistence (cases 10, 11) ───────────────────────────────────────────────

test('CampaignSnapshot round-trips the full roster including deltas + identity (case 10)', () => {
  const campaign = new Campaign({ seed: 42 });
  campaign.addSiteToRoster(
    validSite({
      id: 'a',
      seed: 'a',
      tier: 'score',
      scoreTarget: true,
      lastVisitedJob: 3,
      mutationDeltas: [
        { kind: 'tile', x: 1, y: 1, from: TILE.WALL, to: TILE.RUBBLE },
        { kind: 'entity-removed', id: 'door-entity-0', x: 2, y: 2, archetype: 'door' },
      ],
      principal: { id: 'orchid-vector', label: 'Orchid Vector', groups: ['corp', 'medical'] },
      site: { id: 'sublevel-3', label: 'Sublevel 3', groups: ['infrastructure', 'hidden'] },
    })
  );
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  assert.deepEqual(restored.siteRoster, campaign.siteRoster);
  // Identity tokens survive the round-trip.
  assert.equal(restored.siteRoster[0]!.principal!.id, 'orchid-vector');
  assert.equal(restored.siteRoster[0]!.site!.id, 'sublevel-3');
  // Round-trip must deep-clone, not share delta references.
  assert.notEqual(restored.siteRoster[0]!.mutationDeltas, campaign.siteRoster[0]!.mutationDeltas);
});

test('pre-M7.2 save restore defaults siteRoster to [] (case 11)', () => {
  const campaign = new Campaign({ seed: 42 });
  const snap = snapshotCampaign(campaign) as Record<string, unknown>;
  delete snap.siteRoster;
  const restored = restoreCampaign(snap);
  assert.deepEqual(restored.siteRoster, []);
});

test('restoreCampaign throws on a corrupt roster entry', () => {
  const campaign = new Campaign({ seed: 42 });
  const snap = snapshotCampaign(campaign) as Record<string, unknown>;
  snap.siteRoster = [
    {
      id: 'bad',
      seed: 'bad',
      label: 'x',
      tier: 'gold',
      scoreTarget: false,
      mutationDeltas: [],
      lastVisitedJob: 0,
    },
  ];
  assert.throws(() => restoreCampaign(snap), /unknown tier/);
});

// ─── Curator revisit biasing (case 9) ─────────────────────────────────────────

// Distinct principals so each remembered site renders a distinguishable
// principal-led label; all share a Sublevel 3 site compatible with most recipes.
const TEST_PRINCIPALS = [
  { id: 'orchid-vector', label: 'Orchid Vector', groups: ['corp', 'medical'] },
  { id: 'matsuda', label: 'Matsuda', groups: ['corp', 'finance'] },
  { id: 'kestrel-dynamics', label: 'Kestrel Dynamics', groups: ['corp', 'security'] },
];

function rosterOf(...seeds: number[]): LocationSite[] {
  return seeds.map((s, i) =>
    validSite({
      id: String(s),
      seed: String(s),
      label: `// site ${s}`,
      principal: TEST_PRINCIPALS[i % TEST_PRINCIPALS.length],
      site: { id: 'sublevel-3', label: 'Sublevel 3', groups: ['infrastructure', 'hidden'] },
    })
  );
}

test('Curator: empty roster never sets locationSiteId and draws no extra rng', () => {
  const curator = new Curator();
  // Identical contracts whether siteRoster is omitted or empty — empty roster
  // must not consume extra rng (preserves pre-M7.2 determinism).
  const withoutRoster = curator.generateContracts(new Rng(123), { rep: 50 });
  const withEmptyRoster = curator.generateContracts(new Rng(123), { rep: 50, siteRoster: [] });
  assert.deepEqual(
    withEmptyRoster.map(c => c.seed),
    withoutRoster.map(c => c.seed)
  );
  assert.ok(withEmptyRoster.every(c => c.context.locationSiteId === undefined));
});

test('Curator: a revisit reuses the site seed and PINS principal + site identity', () => {
  const curator = new Curator();
  const roster = rosterOf(1001, 2002, 3003);
  const byId = new Map(roster.map(s => [s.id, s]));
  let foundRevisit = false;
  for (let seed = 0; seed < 50 && !foundRevisit; seed++) {
    for (const contract of curator.generateContracts(new Rng(seed), {
      rep: 50,
      siteRoster: roster,
    })) {
      if (contract.context.locationSiteId !== undefined) {
        foundRevisit = true;
        const site = byId.get(contract.context.locationSiteId)!;
        // Same geometry seed.
        assert.equal(contract.seed, Number(site.seed));
        assert.equal(contract.mapWidth, site.mapWidth);
        assert.equal(contract.mapHeight, site.mapHeight);
        // Identity is pinned: principal + site match the remembered location.
        assert.equal(contract.context.principal.id, site.principal!.id);
        assert.equal(contract.context.site?.id, site.site!.id);
        // Label is regenerated principal-led so the place stays recognizable.
        assert.ok(
          contract.label.startsWith(`// ${site.principal!.label} — ${site.site!.label}`),
          `label "${contract.label}" should lead with the pinned principal + site`
        );
      }
    }
  }
  assert.ok(foundRevisit, 'expected at least one revisit across 50 seeds');
});

test('Curator: a roster site WITHOUT identity tokens is not offered as a revisit', () => {
  const curator = new Curator();
  // Legacy/pre-pinning entry: no principal → cannot be pinned, so never tagged.
  const roster = [validSite({ id: '4040', seed: '4040', label: '// legacy site' })];
  for (let seed = 0; seed < 60; seed++) {
    for (const contract of curator.generateContracts(new Rng(seed), {
      rep: 50,
      siteRoster: roster,
    })) {
      assert.equal(contract.context.locationSiteId, undefined);
    }
  }
});

test('Curator: a board never surfaces duplicate labels even with revisits', () => {
  const curator = new Curator();
  const roster = rosterOf(101, 202, 303);
  for (let seed = 0; seed < 200; seed++) {
    const board = curator.generateContracts(new Rng(seed), { rep: 50, siteRoster: roster });
    const labels = board.map(c => c.label);
    assert.equal(new Set(labels).size, labels.length, `seed ${seed} produced a duplicate label`);
  }
});

test('Curator: revisit biasing is deterministic for a fixed seed + roster', () => {
  const curator = new Curator();
  const roster = rosterOf(11, 22, 33);
  const a = curator.generateContracts(new Rng(777), { rep: 50, siteRoster: roster });
  const b = curator.generateContracts(new Rng(777), { rep: 50, siteRoster: roster });
  assert.deepEqual(
    a.map(c => ({ seed: c.seed, site: c.context.locationSiteId ?? null })),
    b.map(c => ({ seed: c.seed, site: c.context.locationSiteId ?? null }))
  );
});

test('Curator: revisit rate sits in a sane band across 200 seeds (case 9)', () => {
  const curator = new Curator();
  const roster = rosterOf(101, 202, 303);
  let total = 0;
  let revisits = 0;
  for (let seed = 0; seed < 200; seed++) {
    for (const contract of curator.generateContracts(new Rng(seed), {
      rep: 50,
      siteRoster: roster,
    })) {
      total += 1;
      if (contract.context.locationSiteId !== undefined) revisits += 1;
    }
  }
  const rate = revisits / total;
  // The per-slot roll is SITE_REVISIT_CHANCE (0.4), but fallbacks (board can't
  // repeat a site/label; pinned identity must admit a compatible recipe + a
  // unique label) drop the *effective* tagged rate to ~0.35. Assert a band that
  // brackets that without being brittle.
  assert.ok(
    rate > 0.25 && rate < SITE_REVISIT_CHANCE + 0.05,
    `effective revisit rate ${rate.toFixed(3)} should sit just below ${SITE_REVISIT_CHANCE}`
  );
});

test('Curator: revisit contracts still pass context validation (locationSiteId allowed)', () => {
  const curator = new Curator();
  const roster = rosterOf(5, 6, 7);
  for (let seed = 0; seed < 20; seed++) {
    for (const contract of curator.generateContracts(new Rng(seed), {
      rep: 50,
      siteRoster: roster,
    })) {
      // The revisit path attaches locationSiteId after buildContractFromRecipe,
      // so re-normalizing proves the assembled context is still valid and the
      // field round-trips.
      const normalized = normalizeContractContext(contract.context);
      assert.equal(normalized.locationSiteId, contract.context.locationSiteId);
    }
  }
});

// ─── Run re-entry / deploy / job-end (cases 5+6+7, case 8) ────────────────────

function reachExitContract(seed: number, overrides: Partial<Contract> = {}): Contract {
  const dimensions = resolveMapDimensions({ seed, difficulty: 'standard' });
  return {
    seed,
    mapWidth: dimensions.width,
    mapHeight: dimensions.height,
    objective: { kind: OBJECTIVES.REACH_EXIT, title: 'Extract clean', briefing: 'Reach the exit.' },
    difficulty: 'standard',
    threatCount: 1,
    label: '// test site',
    context: testContext(),
    reward: { credits: 10, repDelta: 1 },
    ...overrides,
  };
}

function testContext(locationSiteId?: string): Contract['context'] {
  return {
    recipeId: 'test',
    principal: { id: 'p', label: 'P', groups: ['test'] },
    asset: { id: 'a', label: 'a', groups: ['test'] },
    action: { id: 'x', label: 'x', groups: ['test'] },
    tags: ['test'],
    ...(locationSiteId ? { locationSiteId } : {}),
  };
}

function findWallCell(grid: Grid): { x: number; y: number } | null {
  for (let y = 1; y < grid.height - 1; y++) {
    for (let x = 1; x < grid.width - 1; x++) {
      if (grid.tileAt(x, y) === TILE.WALL) return { x, y };
    }
  }
  return null;
}

test('Run re-entry: prior breaches restore as RUBBLE under fresh entities (case 8)', () => {
  const seed = 9090;

  // Probe run (empty roster) to locate a deterministic wall cell for this seed.
  const probe = new Campaign({ seed: 1 });
  const probeRun = probe.deployCrewMember(probe.crew[0]!.id, reachExitContract(seed));
  probeRun.enterCombat();
  const wall = findWallCell(probeRun.world!.grid);
  assert.ok(wall, 'generated map should contain an interior wall');

  // A campaign that remembers this site with a breach at the wall cell.
  const campaign = new Campaign({ seed: 1 });
  campaign.addSiteToRoster(
    validSite({
      id: String(seed),
      seed: String(seed),
      mutationDeltas: [{ kind: 'tile', x: wall!.x, y: wall!.y, from: TILE.WALL, to: TILE.RUBBLE }],
    })
  );
  const revisit = reachExitContract(seed, { context: testContext(String(seed)) });
  const run = campaign.deployCrewMember(campaign.crew[0]!.id, revisit);
  run.enterCombat();

  assert.equal(run.world!.grid.tileAt(wall!.x, wall!.y), TILE.RUBBLE, 'breach hole persists');
  // Fresh entities layered over restored geometry.
  assert.ok(run.player, 'player spawned over restored geometry');
  assert.ok([...run.world!.entities.values()].some(e => e.id === run.player!.id));
});

test('deployCrewMember remembers a fresh location with empty deltas (case 1, deploy seam)', () => {
  const campaign = new Campaign({ seed: 1 });
  const contract = reachExitContract(555);
  campaign.deployCrewMember(campaign.crew[0]!.id, contract);
  const site = campaign.findRosterSite('555');
  assert.ok(site, 'fresh deploy adds the site to the roster');
  assert.equal(site!.seed, '555');
  assert.deepEqual(site!.mutationDeltas, []);
});

test("onJobEnd EXIT merges this run's breaches into the roster (case 6)", () => {
  const campaign = new Campaign({ seed: 1 });
  const contract = reachExitContract(7777);
  const run = campaign.deployCrewMember(campaign.crew[0]!.id, contract);
  run.enterCombat();
  const wall = findWallCell(run.world!.grid)!;
  run.world!.breachWall(wall.x, wall.y);

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: true });

  const site = campaign.findRosterSite('7777');
  assert.ok(site, 'site still in roster after extract');
  assert.ok(
    site!.mutationDeltas.some(
      d => d.kind === 'tile' && d.x === wall.x && d.y === wall.y && d.to === TILE.RUBBLE
    ),
    'breach merged into persisted site deltas'
  );
});

test('KeyCard on a revisit contract is stamped with the site id (case 7)', () => {
  const campaign = new Campaign({ seed: 1 });
  campaign.addSiteToRoster(validSite({ id: '4242', seed: '4242' }));
  const contract = reachExitContract(4242, {
    objective: {
      kind: OBJECTIVES.RETRIEVE,
      title: 'Grab cache',
      briefing: 'Retrieve the cache behind the locked door.',
      params: { target: 'cache', requiresUnlock: true, unlockMethod: 'keycard' },
    },
    context: testContext('4242'),
  });
  const run = campaign.deployCrewMember(campaign.crew[0]!.id, contract);
  run.enterCombat();

  const keycard = [...run.world!.entities.values()].find(e => e instanceof KeyCard) as
    | KeyCard
    | undefined;
  assert.ok(keycard, 'keycard placed for a keycard-unlock contract');
  assert.equal(keycard!.siteId, '4242', 'keycard carries the location site id');
});

test('revisit with prior site keycard skips spawn and keeps door locked (case 9)', () => {
  const campaign = new Campaign({ seed: 1 });
  campaign.addSiteToRoster(validSite({ id: '4242', seed: '4242' }));
  campaign.addKeyItem({
    id: 'keycard-door-0',
    label: 'Access keycard',
    doorId: 'door-0',
    siteId: '4242',
  });
  const contract = reachExitContract(4242, {
    objective: {
      kind: OBJECTIVES.RETRIEVE,
      title: 'Grab cache',
      briefing: 'Retrieve the cache behind the locked door.',
      params: { target: 'cache', requiresUnlock: true, unlockMethod: 'keycard' },
    },
    context: testContext('4242'),
  });
  const run = campaign.deployCrewMember(campaign.crew[0]!.id, contract);
  run.enterCombat();

  const keycard = [...run.world!.entities.values()].find(e => e instanceof KeyCard);
  assert.equal(keycard, undefined, 'no keycard when campaign already holds this site card');

  const door = [...run.world!.entities.values()].find(
    e => e instanceof Door && e.doorId === 'door-0'
  );
  assert.ok(door instanceof Door, 'door still present');
  assert.equal(door.locked, true, 'door stays locked until player interacts with held keycard');
});

test('resumed BRIEFING run re-derives prior deltas from the roster (case 8, restore path)', () => {
  const seed = 8181;
  // Locate a wall cell for this seed.
  const probe = new Campaign({ seed: 1 });
  const probeRun = probe.deployCrewMember(probe.crew[0]!.id, reachExitContract(seed));
  probeRun.enterCombat();
  const wall = findWallCell(probeRun.world!.grid)!;

  const campaign = new Campaign({ seed: 1 });
  campaign.addSiteToRoster(
    validSite({
      id: String(seed),
      seed: String(seed),
      mutationDeltas: [{ kind: 'tile', x: wall.x, y: wall.y, from: TILE.WALL, to: TILE.RUBBLE }],
    })
  );
  // Deploy but do NOT enterCombat — the run stays in BRIEFING.
  campaign.deployCrewMember(
    campaign.crew[0]!.id,
    reachExitContract(seed, { context: testContext(String(seed)) })
  );

  // Round-trip the campaign while the run is mid-briefing.
  const restored = restoreCampaign(snapshotCampaign(campaign));
  assert.ok(restored.activeRun, 'active run restored');
  assert.deepEqual(restored.activeRun!.priorMutationDeltas, [
    { kind: 'tile', x: wall.x, y: wall.y, from: TILE.WALL, to: TILE.RUBBLE },
  ]);

  // Entering combat post-restore still replays the breach.
  restored.activeRun!.enterCombat();
  assert.equal(restored.activeRun!.world!.grid.tileAt(wall.x, wall.y), TILE.RUBBLE);
});
