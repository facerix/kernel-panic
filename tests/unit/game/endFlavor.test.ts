import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WIN_BANNERS,
  WIN_REASONS,
  WIN_DETAILS,
  WIN_REWARD_KICKERS,
  PARTIAL_BANNERS,
  PARTIAL_REASONS,
  PARTIAL_DETAILS,
  LOSS_FLAVOR,
  pickFlavor,
  selectEndFlavor,
} from '../../../src/game/endFlavor.js';
import type { CampaignSummary } from '../../../src/game/campaignSummary.js';
import type { CampaignEndReason } from '../../../src/types.js';

const PROSE_POOLS = [
  WIN_BANNERS,
  WIN_REASONS,
  WIN_DETAILS,
  WIN_REWARD_KICKERS,
  PARTIAL_BANNERS,
  PARTIAL_REASONS,
  PARTIAL_DETAILS,
  ...Object.values(LOSS_FLAVOR).flatMap(pool => [pool.banners, pool.reasons, pool.details]),
];

function summary(overrides: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    campaignId: 'campaign-1',
    completedAt: '2026-06-14T19:30:00.000Z',
    result: 'win',
    endReason: 'score-complete',
    seed: 42,
    completedJobs: 10,
    rep: 67,
    credits: 1_125,
    crewRoster: [{ callsign: 'Phreak', archetype: 'Decker', flatlined: false }],
    ...overrides,
  };
}

test('pickFlavor is deterministic for a given seed and salt', () => {
  for (const seed of [0, 1, 42, 1024, 0xdeadbeef, -7]) {
    assert.equal(pickFlavor(seed, 0, WIN_BANNERS), pickFlavor(seed, 0, WIN_BANNERS));
  }
});

test('pickFlavor always returns an in-bounds member of the pool', () => {
  for (const pool of PROSE_POOLS) {
    for (let seed = -50; seed <= 50; seed += 1) {
      assert.ok(pool.includes(pickFlavor(seed, 0, pool)), `seed ${seed} must land in the pool`);
    }
  }
});

test('every pool entry is reachable across the seed space', () => {
  // A collapsed hash (always index 0) would fail this — the whole point of the RNG.
  for (const pool of PROSE_POOLS) {
    const seen = new Set<string>();
    for (let seed = 0; seed < 5000; seed += 1) {
      seen.add(pickFlavor(seed, 0, pool));
    }
    assert.equal(seen.size, pool.length, 'pool should be fully reachable');
  }
});

test('different salts decorrelate slots so a seed is not always the same index', () => {
  const pairings = new Set<string>();
  for (let seed = 0; seed < 200; seed += 1) {
    const bannerIdx = WIN_BANNERS.indexOf(pickFlavor(seed, 0, WIN_BANNERS));
    const reasonIdx = WIN_REASONS.indexOf(pickFlavor(seed, 1, WIN_REASONS));
    pairings.add(`${bannerIdx}:${reasonIdx}`);
  }
  assert.ok(pairings.size > Math.max(WIN_BANNERS.length, WIN_REASONS.length));
});

test('pickFlavor rejects an empty pool rather than returning undefined', () => {
  assert.throws(() => pickFlavor(1, 0, []), /non-empty/);
});

test('selectEndFlavor draws win copy from the win pools, with a loot kicker', () => {
  const flavor = selectEndFlavor(summary({ result: 'win', endReason: 'score-complete' }));
  assert.ok(WIN_BANNERS.includes(flavor.banner as (typeof WIN_BANNERS)[number]));
  assert.ok(WIN_REASONS.includes(flavor.reason as (typeof WIN_REASONS)[number]));
  assert.ok(WIN_DETAILS.includes(flavor.detail as (typeof WIN_DETAILS)[number]));
  assert.ok(
    WIN_REWARD_KICKERS.includes(flavor.rewardKicker as (typeof WIN_REWARD_KICKERS)[number])
  );
});

test('selectEndFlavor draws partial copy from the partial pools, no loot kicker', () => {
  const flavor = selectEndFlavor(summary({ result: 'partial', endReason: 'score-partial' }));
  assert.ok(PARTIAL_BANNERS.includes(flavor.banner as (typeof PARTIAL_BANNERS)[number]));
  assert.ok(PARTIAL_REASONS.includes(flavor.reason as (typeof PARTIAL_REASONS)[number]));
  assert.ok(PARTIAL_DETAILS.includes(flavor.detail as (typeof PARTIAL_DETAILS)[number]));
  assert.equal(flavor.rewardKicker, undefined);
});

test('selectEndFlavor keeps losses cause-aware so banners never cross pools', () => {
  // A clock-expired loss must not borrow the Decker-death banner, and vice versa.
  const lossReasons: CampaignEndReason[] = ['clock-expired', 'decker-flatlined-score', 'crew-wipe'];
  for (const endReason of lossReasons) {
    const pool = LOSS_FLAVOR[endReason];
    // Sweep seeds so we exercise every index, not just the default one.
    for (let seed = 0; seed < 300; seed += 1) {
      const flavor = selectEndFlavor(summary({ result: 'loss', endReason, seed }));
      assert.ok(pool.banners.includes(flavor.banner), `${endReason} banner stayed in its pool`);
      assert.ok(pool.reasons.includes(flavor.reason), `${endReason} reason stayed in its pool`);
      assert.ok(pool.details.includes(flavor.detail), `${endReason} detail stayed in its pool`);
      assert.equal(flavor.rewardKicker, undefined);
    }
  }
});

test('selectEndFlavor is deterministic for a given summary', () => {
  const s = summary({ result: 'loss', endReason: 'crew-wipe', seed: 9001 });
  assert.deepEqual(selectEndFlavor(s), selectEndFlavor(s));
});
