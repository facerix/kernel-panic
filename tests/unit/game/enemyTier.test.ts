import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CorpDrone } from '../../../src/game/ai/CorpDrone.js';
import {
  CONTRACT_DIFFICULTY,
  DEFAULT_AP,
  DEFAULT_HP,
  ENEMY_ROLE,
  ENEMY_TIER,
  enemyTierForDifficulty,
  resolveEnemyStats,
} from '../../../src/game/constants.js';

test('contract difficulty maps directly to enemy tier', () => {
  assert.equal(enemyTierForDifficulty(CONTRACT_DIFFICULTY.STANDARD), ENEMY_TIER.T1);
  assert.equal(enemyTierForDifficulty(CONTRACT_DIFFICULTY.ELEVATED), ENEMY_TIER.T2);
  assert.equal(enemyTierForDifficulty(CONTRACT_DIFFICULTY.CRITICAL), ENEMY_TIER.T3);
});

test('elite stat profile scales HP, AP, and armor at T3', () => {
  const t1 = resolveEnemyStats(
    { maxHp: DEFAULT_HP, maxAp: DEFAULT_AP, damageReduction: 0 },
    ENEMY_ROLE.ELITE,
    ENEMY_TIER.T1
  );
  const t3 = resolveEnemyStats(
    { maxHp: DEFAULT_HP, maxAp: DEFAULT_AP, damageReduction: 0 },
    ENEMY_ROLE.ELITE,
    ENEMY_TIER.T3
  );

  assert.deepEqual(t1, { maxHp: 3, maxAp: 4, damageReduction: 0 });
  assert.deepEqual(t3, { maxHp: 5, maxAp: 5, damageReduction: 1 });
});

test('fodder stats stay baseline even in T3 encounters', () => {
  const t3 = resolveEnemyStats({ maxHp: 3, maxAp: 3 }, ENEMY_ROLE.FODDER, ENEMY_TIER.T3);

  assert.deepEqual(t3, { maxHp: 3, maxAp: 3, damageReduction: 0 });
});

test('CorpDrone accepts tier hook while preserving fodder baseline', () => {
  const drone = new CorpDrone({ id: 'drone-0', x: 1, y: 1, maxAp: 3, tier: ENEMY_TIER.T3 });

  assert.equal(drone.maxHp, DEFAULT_HP);
  assert.equal(drone.maxAp, 3);
  assert.equal(drone.damageReduction, 0);
});
