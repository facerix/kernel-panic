import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENEMY_ARCHETYPE,
  composeEncounter,
  hasDurableMedicPatient,
} from '../../../src/game/encounters.js';
import { CONTRACT_DIFFICULTY, ENEMY_ROLE, ENEMY_TIER } from '../../../src/game/constants.js';

const roles = composition => composition.entries.map(entry => entry.role);
const archetypes = composition => composition.entries.map(entry => entry.archetype);

test('STANDARD composition is fodder only and threatCount is the fodder count', () => {
  const composition = composeEncounter({
    seed: 123,
    difficulty: CONTRACT_DIFFICULTY.STANDARD,
    fodderCount: 3,
  });

  assert.equal(composition.tier, ENEMY_TIER.T1);
  assert.equal(composition.fodderCount, 3);
  assert.equal(composition.entries.length, 3);
  assert.deepEqual(roles(composition), [ENEMY_ROLE.FODDER, ENEMY_ROLE.FODDER, ENEMY_ROLE.FODDER]);
});

test('ELEVATED composition is fodder plus exactly one specialist', () => {
  const composition = composeEncounter({
    seed: 456,
    difficulty: CONTRACT_DIFFICULTY.ELEVATED,
    fodderCount: 3,
  });

  assert.equal(composition.tier, ENEMY_TIER.T2);
  assert.equal(composition.entries.filter(entry => entry.role === ENEMY_ROLE.FODDER).length, 3);
  assert.equal(composition.entries.filter(entry => entry.role === ENEMY_ROLE.SPECIALIST).length, 1);
  assert.equal(composition.entries.filter(entry => entry.role === ENEMY_ROLE.ELITE).length, 0);
});

test('CRITICAL composition is fodder plus exactly one specialist and one elite', () => {
  const composition = composeEncounter({
    seed: 789,
    difficulty: CONTRACT_DIFFICULTY.CRITICAL,
    fodderCount: 4,
  });

  assert.equal(composition.tier, ENEMY_TIER.T3);
  assert.equal(composition.entries.filter(entry => entry.role === ENEMY_ROLE.FODDER).length, 4);
  assert.equal(composition.entries.filter(entry => entry.role === ENEMY_ROLE.SPECIALIST).length, 1);
  assert.equal(composition.entries.filter(entry => entry.role === ENEMY_ROLE.ELITE).length, 1);
});

test('composition is deterministic for a seed', () => {
  const opts = {
    seed: 0xc0ffee,
    difficulty: CONTRACT_DIFFICULTY.CRITICAL,
    fodderCount: 4,
  };

  assert.deepEqual(composeEncounter(opts), composeEncounter(opts));
});

test('composition varies across seeds', () => {
  const first = archetypes(
    composeEncounter({
      seed: 1,
      difficulty: CONTRACT_DIFFICULTY.CRITICAL,
      fodderCount: 4,
    })
  );
  const second = archetypes(
    composeEncounter({
      seed: 4,
      difficulty: CONTRACT_DIFFICULTY.CRITICAL,
      fodderCount: 4,
    })
  );

  assert.notDeepEqual(first, second);
});

test('medic never appears without a durable patient', () => {
  for (let seed = 0; seed < 200; seed++) {
    const elevated = composeEncounter({
      seed,
      difficulty: CONTRACT_DIFFICULTY.ELEVATED,
      fodderCount: 3,
    });
    assert.ok(!archetypes(elevated).includes(ENEMY_ARCHETYPE.MEDIC), `seed ${seed}`);

    const critical = composeEncounter({
      seed,
      difficulty: CONTRACT_DIFFICULTY.CRITICAL,
      fodderCount: 4,
    });
    if (archetypes(critical).includes(ENEMY_ARCHETYPE.MEDIC)) {
      assert.equal(hasDurableMedicPatient(critical.entries), true, `seed ${seed}`);
    }
  }
});

test('available allowlist restricts the specialist roll to buildable archetypes', () => {
  // Phase 2.7 M3: spawn site passes only buildable specialists so the resolver
  // never composes a hostile we'd have to reskin or silently drop.
  for (let seed = 0; seed < 200; seed++) {
    const composition = composeEncounter({
      seed,
      difficulty: CONTRACT_DIFFICULTY.ELEVATED,
      fodderCount: 3,
      available: { specialists: [ENEMY_ARCHETYPE.SPOTTER], elites: [] },
    });
    const specialists = composition.entries.filter(e => e.role === ENEMY_ROLE.SPECIALIST);
    assert.equal(specialists.length, 1, `seed ${seed} still has exactly one specialist`);
    assert.equal(specialists[0].archetype, ENEMY_ARCHETYPE.SPOTTER, `seed ${seed}`);
  }
});

test('spotter+sniper allowlist rolls only buildable T2 specialists', () => {
  for (let seed = 0; seed < 200; seed++) {
    const composition = composeEncounter({
      seed,
      difficulty: CONTRACT_DIFFICULTY.ELEVATED,
      fodderCount: 3,
      available: { specialists: [ENEMY_ARCHETYPE.SPOTTER, ENEMY_ARCHETYPE.SNIPER], elites: [] },
    });
    const spec = composition.entries.find(e => e.role === ENEMY_ROLE.SPECIALIST);
    assert.ok(
      spec?.archetype === ENEMY_ARCHETYPE.SPOTTER || spec?.archetype === ENEMY_ARCHETYPE.SNIPER,
      `seed ${seed}`
    );
  }
});

test('bruiser elite allowlist rolls only the buildable T3 elite', () => {
  for (let seed = 0; seed < 200; seed++) {
    const composition = composeEncounter({
      seed,
      difficulty: CONTRACT_DIFFICULTY.CRITICAL,
      fodderCount: 4,
      available: {
        specialists: [ENEMY_ARCHETYPE.SPOTTER],
        elites: [ENEMY_ARCHETYPE.BRUISER],
      },
    });
    const elites = composition.entries.filter(e => e.role === ENEMY_ROLE.ELITE);
    assert.equal(elites.length, 1, `seed ${seed} still has exactly one elite`);
    assert.equal(elites[0].archetype, ENEMY_ARCHETYPE.BRUISER, `seed ${seed}`);
  }
});

test('empty elite allowlist composes no elite (never a reskin or silent drop)', () => {
  // CRITICAL with no buildable elite: the resolver carries fodder + the one
  // available specialist, and simply no elite — output matches what can spawn.
  const composition = composeEncounter({
    seed: 789,
    difficulty: CONTRACT_DIFFICULTY.CRITICAL,
    fodderCount: 4,
    available: { specialists: [ENEMY_ARCHETYPE.SPOTTER], elites: [] },
  });
  assert.equal(composition.entries.filter(e => e.role === ENEMY_ROLE.ELITE).length, 0);
  const specialists = composition.entries.filter(e => e.role === ENEMY_ROLE.SPECIALIST);
  assert.equal(specialists.length, 1);
  assert.equal(specialists[0].archetype, ENEMY_ARCHETYPE.SPOTTER);
});

test('an empty specialist allowlist composes no specialist', () => {
  const composition = composeEncounter({
    seed: 456,
    difficulty: CONTRACT_DIFFICULTY.ELEVATED,
    fodderCount: 3,
    available: { specialists: [], elites: [] },
  });
  assert.equal(composition.entries.filter(e => e.role === ENEMY_ROLE.SPECIALIST).length, 0);
  assert.equal(composition.entries.length, 3, 'fodder only when nothing is buildable');
});

test('composition rejects corrupt inputs instead of clamping', () => {
  assert.throws(
    () =>
      composeEncounter({
        seed: Number.NaN,
        difficulty: CONTRACT_DIFFICULTY.STANDARD,
        fodderCount: 1,
      }),
    TypeError
  );
  assert.throws(
    () =>
      composeEncounter({
        seed: 1,
        difficulty: CONTRACT_DIFFICULTY.STANDARD,
        fodderCount: -1,
      }),
    RangeError
  );
});
