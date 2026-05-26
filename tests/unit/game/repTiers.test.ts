/**
 * M5.1 — Rep tier constants and helpers.
 *
 * Tests that `repTierForRep` maps Rep values to the correct tier, that
 * tier definitions are consistent, and that boundary transitions work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  REP,
  REP_TIER,
  REP_TIERS,
  REP_LABEL,
  repTierForRep,
  CONTRACT_DIFFICULTY,
  SALVAGE_TO_CRED_RATE,
} from '../../../src/game/constants.js';

// ---------------------------------------------------------------------------
// Tier lookup
// ---------------------------------------------------------------------------

test('repTierForRep returns BURNED for rep 0–19', () => {
  assert.equal(repTierForRep(0).id, REP_TIER.BURNED);
  assert.equal(repTierForRep(10).id, REP_TIER.BURNED);
  assert.equal(repTierForRep(19).id, REP_TIER.BURNED);
});

test('repTierForRep returns UNKNOWN for rep 20–49', () => {
  assert.equal(repTierForRep(20).id, REP_TIER.UNKNOWN);
  assert.equal(repTierForRep(35).id, REP_TIER.UNKNOWN);
  assert.equal(repTierForRep(49).id, REP_TIER.UNKNOWN);
});

test('repTierForRep returns KNOWN for rep 50–79', () => {
  assert.equal(repTierForRep(50).id, REP_TIER.KNOWN);
  assert.equal(repTierForRep(65).id, REP_TIER.KNOWN);
  assert.equal(repTierForRep(79).id, REP_TIER.KNOWN);
});

test('repTierForRep returns TRUSTED for rep 80–100', () => {
  assert.equal(repTierForRep(80).id, REP_TIER.TRUSTED);
  assert.equal(repTierForRep(90).id, REP_TIER.TRUSTED);
  assert.equal(repTierForRep(100).id, REP_TIER.TRUSTED);
});

test('repTierForRep at REP.START returns UNKNOWN', () => {
  assert.equal(repTierForRep(REP.START).id, REP_TIER.UNKNOWN);
});

// ---------------------------------------------------------------------------
// Tier definitions — structural checks
// ---------------------------------------------------------------------------

test('REP_TIERS are ordered from highest min to lowest', () => {
  for (let i = 1; i < REP_TIERS.length; i++) {
    assert.ok(
      REP_TIERS[i - 1].min > REP_TIERS[i].min,
      `tier ${REP_TIERS[i - 1].id} (min ${REP_TIERS[i - 1].min}) should have a higher min than ${REP_TIERS[i].id} (min ${REP_TIERS[i].min})`
    );
  }
});

test('every tier has a 9-entry difficulty pool', () => {
  for (const tier of REP_TIERS) {
    assert.equal(tier.pool.length, 9, `tier ${tier.id} pool should have 9 entries`);
  }
});

test('every pool entry is a valid CONTRACT_DIFFICULTY', () => {
  const valid = new Set(Object.values(CONTRACT_DIFFICULTY));
  for (const tier of REP_TIERS) {
    for (const entry of tier.pool) {
      assert.ok(valid.has(entry), `tier ${tier.id} has invalid pool entry "${entry}"`);
    }
  }
});

test('BURNED pool is all STANDARD', () => {
  const burned = REP_TIERS.find(t => t.id === REP_TIER.BURNED)!;
  for (const entry of burned.pool) {
    assert.equal(entry, CONTRACT_DIFFICULTY.STANDARD);
  }
});

test('TRUSTED pool has more CRITICAL entries than UNKNOWN pool', () => {
  const trusted = REP_TIERS.find(t => t.id === REP_TIER.TRUSTED)!;
  const unknown = REP_TIERS.find(t => t.id === REP_TIER.UNKNOWN)!;
  const trustedCritical = trusted.pool.filter(d => d === CONTRACT_DIFFICULTY.CRITICAL).length;
  const unknownCritical = unknown.pool.filter(d => d === CONTRACT_DIFFICULTY.CRITICAL).length;
  assert.ok(
    trustedCritical > unknownCritical,
    `TRUSTED should have more CRITICAL (${trustedCritical}) than UNKNOWN (${unknownCritical})`
  );
});

test('only TRUSTED tier has a non-zero rewardFloorBump', () => {
  for (const tier of REP_TIERS) {
    if (tier.id === REP_TIER.TRUSTED) {
      assert.ok(tier.rewardFloorBump > 0, 'TRUSTED should have a reward floor bump');
      assert.equal(tier.rewardFloorBump, 2 * SALVAGE_TO_CRED_RATE);
    } else {
      assert.equal(tier.rewardFloorBump, 0, `${tier.id} should have no reward floor bump`);
    }
  }
});

// ---------------------------------------------------------------------------
// REP_LABEL compat
// ---------------------------------------------------------------------------

test('REP_LABEL alias works for shell status line lookup', () => {
  // The shell does: REP_LABEL.find(b => rep >= b.min)?.label
  const label = REP_LABEL.find(b => 65 >= b.min)?.label;
  assert.equal(label, 'KNOWN');
  const burned = REP_LABEL.find(b => 5 >= b.min)?.label;
  assert.equal(burned, 'BURNED');
  const trusted = REP_LABEL.find(b => 90 >= b.min)?.label;
  assert.equal(trusted, 'TRUSTED');
});

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

test('TRUSTED tier is reachable in ~10-12 clean completions from REP.START', () => {
  // REP.START = 20, clean completion = +10 rep (CLEAN_COMPLETION_BONUS) plus
  // contract repDelta (4–10 depending on difficulty). Conservative: +10 per run.
  // 20 + 10*6 = 80 → TRUSTED in 6 clean runs. With contract repDelta it's faster.
  const trustedMin = REP_TIERS.find(t => t.id === REP_TIER.TRUSTED)!.min;
  const runsNeeded = Math.ceil((trustedMin - REP.START) / REP.CLEAN_COMPLETION_BONUS);
  assert.ok(
    runsNeeded <= 12,
    `TRUSTED should be reachable in ≤12 clean runs, needs ${runsNeeded}`
  );
  assert.ok(
    runsNeeded >= 3,
    `TRUSTED should not be trivially easy (needs ${runsNeeded} runs)`
  );
});
