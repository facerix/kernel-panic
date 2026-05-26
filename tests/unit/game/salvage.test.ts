/**
 * M4.2: TypedSalvage primitives + migration tests.
 *
 * Pins the contracts that the rest of the game (Crew, Campaign, Run loot
 * generation, persistence) relies on. The migration path is load-bearing:
 * a busted `migrateSalvage` would silently corrupt every legacy campaign on
 * first reload.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SALVAGE_TYPES,
  addSalvage,
  cloneSalvage,
  emptySalvage,
  formatSalvageCompact,
  isEmptySalvage,
  makeSalvage,
  migrateSalvage,
  totalSalvage,
  validateSalvage,
} from '../../../src/game/salvage.js';

test('emptySalvage returns a zeroed wallet across all four buckets', () => {
  const s = emptySalvage();
  assert.deepEqual(s, { scrap: 0, chips: 0, bio: 0, data: 0 });
  assert.equal(totalSalvage(s), 0);
  assert.equal(isEmptySalvage(s), true);
});

test('makeSalvage builds a wallet from partial overrides, defaulting to 0', () => {
  const s = makeSalvage({ chips: 3, data: 1 });
  assert.deepEqual(s, { scrap: 0, chips: 3, bio: 0, data: 1 });
  assert.equal(totalSalvage(s), 4);
});

test('makeSalvage throws on negative or non-integer fields', () => {
  assert.throws(() => makeSalvage({ scrap: -1 }), /non-negative integer/i);
  assert.throws(() => makeSalvage({ scrap: 1.5 }), /non-negative integer/i);
});

test('addSalvage folds the second wallet into the first (in place)', () => {
  const a = makeSalvage({ scrap: 2, chips: 1 });
  const b = makeSalvage({ scrap: 1, bio: 4 });
  const out = addSalvage(a, b);
  assert.equal(out, a, 'addSalvage returns the first operand');
  assert.deepEqual(a, { scrap: 3, chips: 1, bio: 4, data: 0 });
});

test('cloneSalvage produces an independent copy', () => {
  const s = makeSalvage({ scrap: 5 });
  const c = cloneSalvage(s);
  c.scrap = 99;
  assert.equal(s.scrap, 5, 'original unaffected by clone mutation');
});

test('totalSalvage sums all four buckets', () => {
  assert.equal(totalSalvage(makeSalvage({ scrap: 2, chips: 3, bio: 1, data: 4 })), 10);
});

// --- validateSalvage ------------------------------------------------------

test('validateSalvage accepts well-formed TypedSalvage', () => {
  const v = validateSalvage({ scrap: 1, chips: 2, bio: 3, data: 4 }, 'test');
  assert.deepEqual(v, { scrap: 1, chips: 2, bio: 3, data: 4 });
});

test('validateSalvage throws on missing fields', () => {
  // Missing data, chips, bio
  assert.throws(() => validateSalvage({ scrap: 1 }, 'test'), /missing/i);
});

test('validateSalvage throws on negative or non-integer values', () => {
  assert.throws(
    () => validateSalvage({ scrap: -1, chips: 0, bio: 0, data: 0 }, 'test'),
    /non-negative integer/i
  );
  assert.throws(
    () => validateSalvage({ scrap: 1.1, chips: 0, bio: 0, data: 0 }, 'test'),
    /non-negative integer/i
  );
});

test('validateSalvage rejects extra fields (catches typos at restore time)', () => {
  assert.throws(
    () => validateSalvage({ scrap: 0, chips: 0, bio: 0, data: 0, extra: 5 }, 'test'),
    /unknown field/i
  );
});

test('validateSalvage rejects non-object inputs', () => {
  assert.throws(() => validateSalvage(null, 'test'), /plain object/i);
  assert.throws(() => validateSalvage(42, 'test'), /plain object/i);
  assert.throws(() => validateSalvage([1, 2, 3], 'test'), /plain object/i);
});

// --- migrateSalvage -------------------------------------------------------

test('migrateSalvage converts a legacy number into a scrap-only wallet', () => {
  // Documented M4 migration: legacy creds bucket entirely into scrap. This is
  // load-bearing — old saves rely on it for backwards-compat.
  assert.deepEqual(migrateSalvage(0, 'legacy'), { scrap: 0, chips: 0, bio: 0, data: 0 });
  assert.deepEqual(migrateSalvage(7, 'legacy'), { scrap: 7, chips: 0, bio: 0, data: 0 });
});

test('migrateSalvage passes through a valid TypedSalvage unchanged (modulo identity)', () => {
  const original = { scrap: 1, chips: 2, bio: 3, data: 4 };
  const migrated = migrateSalvage(original, 'typed');
  assert.deepEqual(migrated, original);
});

test('migrateSalvage throws on negative legacy numbers (no silent floor-to-zero)', () => {
  assert.throws(() => migrateSalvage(-1, 'legacy'), /non-negative integer/i);
});

test('migrateSalvage throws on non-integer legacy numbers', () => {
  assert.throws(() => migrateSalvage(1.5, 'legacy'), /non-negative integer/i);
});

test('migrateSalvage throws on malformed typed shapes (no silent default)', () => {
  // Per CLAUDE.md: silent fallback would corrupt the wallet — crash instead.
  assert.throws(() => migrateSalvage({ scrap: 1 }, 'broken'), /missing/i);
  assert.throws(() => migrateSalvage(null, 'broken'), /plain object/i);
  assert.throws(() => migrateSalvage('seven', 'broken'), /plain object/i);
});

// --- format helpers -------------------------------------------------------

test('formatSalvageCompact renders the four buckets in canonical order', () => {
  const s = makeSalvage({ scrap: 12, chips: 3, bio: 0, data: 1 });
  assert.equal(formatSalvageCompact(s), 'S:12 C:3 B:0 D:1');
});

test('SALVAGE_TYPES exposes the canonical bucket order for priority drawing', () => {
  // Used by Campaign.sellSalvage to draw scrap → chips → bio → data when no
  // explicit type is given. The order doubles as the "priority chain", so
  // pinning it here makes a future reorder fail fast.
  assert.deepEqual([...SALVAGE_TYPES], ['scrap', 'chips', 'bio', 'data']);
});
