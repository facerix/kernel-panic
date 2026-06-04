import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENEMY_ARCHETYPE,
  composeEncounter,
  encounterHostileCount,
  hasDurableMedicPatient,
} from '../../../src/game/encounters.js';
import { CONTRACT_DIFFICULTY, ENEMY_ROLE, ENEMY_TIER } from '../../../src/game/constants.js';

const roles = composition => composition.entries.map(entry => entry.role);
const archetypes = composition => composition.entries.map(entry => entry.archetype);

test('encounterHostileCount matches composed roster size', () => {
  assert.equal(
    encounterHostileCount({
      seed: 123,
      difficulty: CONTRACT_DIFFICULTY.STANDARD,
      threatCount: 3,
    }),
    3
  );
  assert.equal(
    encounterHostileCount({
      seed: 456,
      difficulty: CONTRACT_DIFFICULTY.ELEVATED,
      threatCount: 3,
    }),
    4
  );
  assert.equal(
    encounterHostileCount({
      seed: 789,
      difficulty: CONTRACT_DIFFICULTY.CRITICAL,
      threatCount: 4,
    }),
    6
  );
});

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
