import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CREW_STAT_ANCHORS,
  DEFAULT_HIT_CHANCE_BY_ARCHETYPE,
  DEFAULT_DODGE_CHANCE_BY_ARCHETYPE,
  rollCrewStats,
  deriveArchetype,
  buildCrewMemberFromRoll,
  buildCrewMemberFromRollForArchetype,
  type CrewStatAnchor,
} from '../../../src/game/crewStatRoll.js';
import {
  CREW_HIT_CHANCE_ROLL_MIN,
  CREW_HIT_CHANCE_ROLL_MAX,
  CREW_DODGE_CHANCE_ROLL_MIN,
  CREW_DODGE_CHANCE_ROLL_MAX,
} from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';
import { SCOREABLE_ARCHETYPE_IDS } from '../../../src/game/archetypeRewards.js';

const NON_DECKER_ARCHETYPES = ['merc', 'razor', 'tech', 'berserk', 'adept', 'chimera'] as const;

// The rounded roll grid: 21 hit values × 26 dodge values = 546 tuples.
function* gridTuples() {
  for (let hi = 0; hi <= 20; hi++) {
    const hitChance = (65 + hi) / 100;
    for (let di = 0; di <= 25; di++) {
      const dodgeChance = (15 + di) / 100;
      yield { hitChance, dodgeChance };
    }
  }
}

test('CREW_STAT_ANCHORS registers exactly the six non-Decker archetypes, Decker absent', () => {
  const ids = CREW_STAT_ANCHORS.map(a => a.archetype);
  assert.deepEqual(new Set(ids), new Set(NON_DECKER_ARCHETYPES));
  assert.ok(!ids.includes('decker' as never), 'Decker must never be a rollable anchor');
});

test('deriveArchetype: exhaustive 546-tuple grid sweep resolves every tuple, no dead zones, no throw', () => {
  const seen = new Set<string>();
  let count = 0;
  for (const stats of gridTuples()) {
    count++;
    const archetype = deriveArchetype(stats);
    assert.ok(
      NON_DECKER_ARCHETYPES.includes(archetype as (typeof NON_DECKER_ARCHETYPES)[number]),
      `tuple (${stats.hitChance}, ${stats.dodgeChance}) resolved to unregistered "${archetype}"`
    );
    seen.add(archetype);
  }
  assert.equal(count, 546, 'grid must be exactly 21 × 26 = 546 tuples');
  assert.deepEqual(
    seen,
    new Set(NON_DECKER_ARCHETYPES),
    'every archetype must be reachable — no starved anchor'
  );
});

test('deriveArchetype: each anchor maps to its own archetype', () => {
  for (const anchor of CREW_STAT_ANCHORS) {
    assert.equal(
      deriveArchetype({ hitChance: anchor.hitChance, dodgeChance: anchor.dodgeChance }),
      anchor.archetype
    );
  }
});

test('deriveArchetype: the four widened-range corners saturate to their nearest archetype', () => {
  const cases: Array<{ hitChance: number; dodgeChance: number; expect: string }> = [
    { hitChance: 0.85, dodgeChance: 0.15, expect: 'chimera' },
    { hitChance: 0.85, dodgeChance: 0.4, expect: 'berserk' },
    { hitChance: 0.65, dodgeChance: 0.4, expect: 'razor' },
    { hitChance: 0.65, dodgeChance: 0.15, expect: 'adept' },
  ];
  for (const { hitChance, dodgeChance, expect } of cases) {
    assert.equal(
      deriveArchetype({ hitChance, dodgeChance }),
      expect,
      `corner (${hitChance}, ${dodgeChance})`
    );
  }
});

test('deriveArchetype: exact-distance ties resolve via the fixed priority order (merc > razor > adept > tech > berserk > chimera)', () => {
  const razor: CrewStatAnchor = { archetype: 'razor', hitChance: 0.6, dodgeChance: 0.5 };
  const chimera: CrewStatAnchor = { archetype: 'chimera', hitChance: 0.4, dodgeChance: 0.5 };
  // Equidistant from both synthetic anchors — razor outranks chimera.
  assert.equal(deriveArchetype({ hitChance: 0.5, dodgeChance: 0.5 }, [chimera, razor]), 'razor');
  assert.equal(deriveArchetype({ hitChance: 0.5, dodgeChance: 0.5 }, [razor, chimera]), 'razor');

  const merc: CrewStatAnchor = { archetype: 'merc', hitChance: 0.6, dodgeChance: 0.5 };
  const berserk: CrewStatAnchor = { archetype: 'berserk', hitChance: 0.4, dodgeChance: 0.5 };
  // Merc outranks everything.
  assert.equal(
    deriveArchetype({ hitChance: 0.5, dodgeChance: 0.5 }, [berserk, merc, razor]),
    'merc'
  );
});

test('deriveArchetype: throws on an empty anchor list rather than returning an unclassifiable result', () => {
  assert.throws(() => deriveArchetype({ hitChance: 0.7, dodgeChance: 0.2 }, []), /anchors/i);
});

test('deriveArchetype: measured distribution over the full grid stays in the documented 13–21%-ish spread (guards against re-skew toward the discarded 35/1 design)', () => {
  const counts: Record<string, number> = Object.fromEntries(
    NON_DECKER_ARCHETYPES.map(id => [id, 0])
  );
  for (const stats of gridTuples()) {
    counts[deriveArchetype(stats)]++;
  }
  const total = 546;
  for (const id of NON_DECKER_ARCHETYPES) {
    const ratio = counts[id] / total;
    assert.ok(
      ratio > 0.1 && ratio < 0.26,
      `${id}: ${(ratio * 100).toFixed(1)}% of the grid, outside the healthy partition band`
    );
  }
});

test('rollCrewStats: every roll lands on the 0.01 grid within the documented ranges', () => {
  const rng = new Rng(1234);
  for (let i = 0; i < 2000; i++) {
    const { hitChance, dodgeChance, armor } = rollCrewStats(rng);
    assert.ok(hitChance >= CREW_HIT_CHANCE_ROLL_MIN && hitChance <= CREW_HIT_CHANCE_ROLL_MAX);
    assert.ok(
      dodgeChance >= CREW_DODGE_CHANCE_ROLL_MIN && dodgeChance <= CREW_DODGE_CHANCE_ROLL_MAX
    );
    assert.equal(Math.round(hitChance * 100) / 100, hitChance, `${hitChance} not on 0.01 grid`);
    assert.equal(
      Math.round(dodgeChance * 100) / 100,
      dodgeChance,
      `${dodgeChance} not on 0.01 grid`
    );
    assert.ok(armor === 0 || armor === 1);
  }
});

test('rollCrewStats: armor rolls roughly at the documented 15% rate over a large sample', () => {
  const rng = new Rng(99);
  let armored = 0;
  const total = 5000;
  for (let i = 0; i < total; i++) {
    if (rollCrewStats(rng).armor === 1) armored++;
  }
  const ratio = armored / total;
  assert.ok(ratio > 0.1 && ratio < 0.2, `armor rate ${(ratio * 100).toFixed(1)}% out of range`);
});

test('rollCrewStats throws without a valid Rng', () => {
  assert.throws(() => rollCrewStats(null as never));
  assert.throws(() => rollCrewStats({} as never));
});

test('DEFAULT_HIT_CHANCE_BY_ARCHETYPE / DEFAULT_DODGE_CHANCE_BY_ARCHETYPE cover all seven archetypes including Decker', () => {
  const allSeven = [...NON_DECKER_ARCHETYPES, 'decker'];
  for (const id of allSeven) {
    assert.equal(typeof DEFAULT_HIT_CHANCE_BY_ARCHETYPE[id as never], 'number');
    assert.equal(typeof DEFAULT_DODGE_CHANCE_BY_ARCHETYPE[id as never], 'number');
  }
  // Frozen pre-P3.5 values — old-save safety (see crewStatRoll.ts doc comment).
  assert.equal(DEFAULT_HIT_CHANCE_BY_ARCHETYPE.merc, 0.8);
  assert.equal(DEFAULT_HIT_CHANCE_BY_ARCHETYPE.razor, 0.7);
  assert.equal(DEFAULT_DODGE_CHANCE_BY_ARCHETYPE.razor, 0.35);
  assert.equal(DEFAULT_HIT_CHANCE_BY_ARCHETYPE.tech, 0.75);
});

// --- buildCrewMemberFromRoll ----------------------------------------------

test('buildCrewMemberFromRoll constructs a crew member whose archetype matches deriveArchetype(rollCrewStats(fork))', () => {
  const rng = new Rng(42);
  const forked = rng.fork('crew-stats');
  const expectedStats = rollCrewStats(forked);
  const expectedArchetype = deriveArchetype(expectedStats);

  // rng itself is untouched by the fork above (fork doesn't consume from the
  // parent stream) — buildCrewMemberFromRoll will derive the exact same
  // stats from the same rng state.
  const member = buildCrewMemberFromRoll({ x: 0, y: 0 }, rng, { id: 'roll-1' });
  assert.equal(member.constructor.name.toLowerCase(), expectedArchetype);
  assert.equal(member.baseHitChance, expectedStats.hitChance);
  assert.equal(member.baseDodgeChance, expectedStats.dodgeChance);
});

test('buildCrewMemberFromRoll applies rolled armor onto damageReduction', () => {
  // Sweep seeds until we find one that rolls armor, to exercise the branch —
  // deterministic given the fixed seed sequence.
  for (let seed = 0; seed < 200; seed++) {
    const rng = new Rng(seed);
    const forked = rng.fork('crew-stats');
    const stats = rollCrewStats(forked);
    if (stats.armor === 0) continue;
    const member = buildCrewMemberFromRoll({ x: 0, y: 0 }, new Rng(seed), { id: `roll-${seed}` });
    assert.equal(member.damageReduction, stats.armor);
    return;
  }
  assert.fail('no seed in [0, 200) rolled armor — widen the sweep');
});

test('buildCrewMemberFromRoll never derives a Decker', () => {
  for (let seed = 0; seed < 300; seed++) {
    const member = buildCrewMemberFromRoll({ x: 0, y: 0 }, new Rng(seed), { id: `roll-${seed}` });
    assert.notEqual(member.constructor.name, 'Decker');
  }
});

test('buildCrewMemberFromRoll respects a caller-supplied anchor subset (P3.5.M7 gating hook)', () => {
  const mercOnly: CrewStatAnchor[] = [{ archetype: 'merc', hitChance: 0.83, dodgeChance: 0.27 }];
  for (let seed = 0; seed < 25; seed++) {
    const member = buildCrewMemberFromRoll(
      { x: 0, y: 0 },
      new Rng(seed),
      { id: `roll-${seed}` },
      mercOnly
    );
    assert.equal(member.constructor.name, 'Merc');
  }
});

// --- P3.5.M7: locked-archetype anchor gating ------------------------------
//
// Real gating lives in `Campaign.#crewStatAnchors()`, which filters
// `CREW_STAT_ANCHORS` down to `!SCOREABLE_ARCHETYPE_IDS.has(id) ||
// unlocked.includes(id)` before calling `deriveArchetype`/
// `buildCrewMemberFromRoll`. These tests exercise that exact filter shape
// directly against `deriveArchetype`, independent of Campaign.

/** Anchors with only {merc, razor, tech} unlocked — every M7-gated archetype absent. */
const STARTER_ONLY_ANCHORS: CrewStatAnchor[] = CREW_STAT_ANCHORS.filter(
  anchor => !SCOREABLE_ARCHETYPE_IDS.has(anchor.archetype)
);

test('SCOREABLE_ARCHETYPE_IDS names exactly the three M7-gated archetypes', () => {
  assert.deepEqual(new Set(SCOREABLE_ARCHETYPE_IDS), new Set(['berserk', 'adept', 'chimera']));
});

test('STARTER_ONLY_ANCHORS fixture retains exactly merc/razor/tech', () => {
  assert.deepEqual(
    new Set(STARTER_ONLY_ANCHORS.map(a => a.archetype)),
    new Set(['merc', 'razor', 'tech'])
  );
});

test('deriveArchetype with only {merc, razor, tech} unlocked: every one of the 546 tuples resolves to a registered unlocked archetype, no dead zones, no throw', () => {
  const seen = new Set<string>();
  let count = 0;
  for (const stats of gridTuples()) {
    count++;
    const archetype = deriveArchetype(stats, STARTER_ONLY_ANCHORS);
    assert.ok(
      archetype === 'merc' || archetype === 'razor' || archetype === 'tech',
      `tuple (${stats.hitChance}, ${stats.dodgeChance}) resolved to locked/unknown "${archetype}"`
    );
    seen.add(archetype);
  }
  assert.equal(count, 546);
  assert.deepEqual(seen, new Set(['merc', 'razor', 'tech']));
});

test('each locked archetype anchor point saturates to a different, unlocked neighbor rather than dead-zoning or throwing', () => {
  for (const anchor of CREW_STAT_ANCHORS) {
    if (!SCOREABLE_ARCHETYPE_IDS.has(anchor.archetype)) continue; // only test the three gated ones
    const resolved = deriveArchetype(
      { hitChance: anchor.hitChance, dodgeChance: anchor.dodgeChance },
      STARTER_ONLY_ANCHORS
    );
    assert.notEqual(
      resolved,
      anchor.archetype,
      `${anchor.archetype}'s own anchor must saturate away`
    );
    assert.ok(['merc', 'razor', 'tech'].includes(resolved));
  }
});

test('deriveArchetype throws with an anchor table filtered down to nothing (all six gated)', () => {
  const allGated = CREW_STAT_ANCHORS.filter(a => !NON_DECKER_ARCHETYPES.includes(a.archetype));
  assert.deepEqual(allGated, []);
  assert.throws(
    () => deriveArchetype({ hitChance: 0.75, dodgeChance: 0.25 }, allGated),
    /anchors/i
  );
});

test('a partially-unlocked table (e.g. only Berserk unlocked among the gated three) reaches four archetypes total', () => {
  const withBerserkUnlocked = CREW_STAT_ANCHORS.filter(
    anchor => !SCOREABLE_ARCHETYPE_IDS.has(anchor.archetype) || anchor.archetype === 'berserk'
  );
  const seen = new Set<string>();
  for (const stats of gridTuples()) {
    seen.add(deriveArchetype(stats, withBerserkUnlocked));
  }
  assert.deepEqual(seen, new Set(['merc', 'razor', 'tech', 'berserk']));
});

// --- showcase-slot follow-up (2026-07-14): buildCrewMemberFromRollForArchetype ---

test('buildCrewMemberFromRollForArchetype always constructs the forced archetype, with varying stats', () => {
  const hitChances = new Set<number>();
  const dodgeChances = new Set<number>();
  for (let seed = 0; seed < 40; seed++) {
    const member = buildCrewMemberFromRollForArchetype(
      { x: 0, y: 0 },
      new Rng(seed),
      'berserk',
      CREW_STAT_ANCHORS,
      { id: `showcase-${seed}` }
    );
    assert.equal(member.constructor.name, 'Berserk');
    assert.ok(member.baseHitChance >= 0.65 && member.baseHitChance <= 0.85);
    assert.ok(member.baseDodgeChance >= 0.15 && member.baseDodgeChance <= 0.4);
    hitChances.add(member.baseHitChance);
    dodgeChances.add(member.baseDodgeChance);
  }
  // Natural variance, not always pinned to the anchor point.
  assert.ok(hitChances.size > 1, 'hit chance should vary across seeds');
  assert.ok(dodgeChances.size > 1, 'dodge chance should vary across seeds');
});

test('buildCrewMemberFromRollForArchetype works for every non-Decker archetype', () => {
  for (const archetype of ['merc', 'razor', 'tech', 'berserk', 'adept', 'chimera'] as const) {
    const member = buildCrewMemberFromRollForArchetype(
      { x: 0, y: 0 },
      new Rng(1),
      archetype,
      CREW_STAT_ANCHORS,
      { id: `showcase-${archetype}` }
    );
    assert.equal(member.archetype.toLowerCase(), archetype);
  }
});

test('buildCrewMemberFromRollForArchetype throws when the archetype has no anchor in the supplied table (locked)', () => {
  const withoutBerserk = CREW_STAT_ANCHORS.filter(a => a.archetype !== 'berserk');
  assert.throws(
    () =>
      buildCrewMemberFromRollForArchetype({ x: 0, y: 0 }, new Rng(1), 'berserk', withoutBerserk),
    /no anchor/i
  );
});

test('buildCrewMemberFromRollForArchetype applies rolled armor onto damageReduction', () => {
  let sawArmor = false;
  for (let seed = 0; seed < 200 && !sawArmor; seed++) {
    const member = buildCrewMemberFromRollForArchetype(
      { x: 0, y: 0 },
      new Rng(seed),
      'merc',
      CREW_STAT_ANCHORS,
      { id: `showcase-armor-${seed}` }
    );
    if (member.damageReduction > 0) {
      assert.equal(member.damageReduction, 1);
      sawArmor = true;
    }
  }
  assert.ok(sawArmor, 'no seed in [0, 200) rolled armor for the showcase build — widen the sweep');
});

test('buildCrewMemberFromRollForArchetype does not perturb the caller rng beyond the callsign pick (matches buildCrewMemberFromRoll)', () => {
  // Same fork-then-build shape as buildCrewMemberFromRoll — two independently
  // constructed rngs from the same seed must produce identical results.
  const a = buildCrewMemberFromRollForArchetype({ x: 0, y: 0 }, new Rng(77), 'chimera');
  const b = buildCrewMemberFromRollForArchetype({ x: 0, y: 0 }, new Rng(77), 'chimera');
  assert.equal(a.callsign, b.callsign);
  assert.equal(a.baseHitChance, b.baseHitChance);
  assert.equal(a.baseDodgeChance, b.baseDodgeChance);
});
