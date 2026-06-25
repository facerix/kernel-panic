import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  archiveScoreableItem,
  normalizeUnlockedScoreableItems,
} from '../../../src/game/scoreableUnlocks.js';

test('normalizeUnlockedScoreableItems treats an absent store as empty', () => {
  assert.deepEqual(normalizeUnlockedScoreableItems(undefined), []);
});

test('normalizeUnlockedScoreableItems passes through a valid id list, fresh copy', () => {
  const input = ['proto-exoframe', 'mil-spec-optics'];
  const result = normalizeUnlockedScoreableItems(input);
  assert.deepEqual(result, ['proto-exoframe', 'mil-spec-optics']);
  assert.notEqual(result, input, 'returns a fresh array, not the caller-owned reference');
});

test('normalizeUnlockedScoreableItems de-dupes preserving acquisition order', () => {
  const result = normalizeUnlockedScoreableItems(['a', 'b', 'a', 'c', 'b']);
  assert.deepEqual(result, ['a', 'b', 'c']);
});

test('normalizeUnlockedScoreableItems throws on a non-array store', () => {
  assert.throws(() => normalizeUnlockedScoreableItems('proto-exoframe'), TypeError);
  assert.throws(() => normalizeUnlockedScoreableItems({ 0: 'a' }), TypeError);
});

test('normalizeUnlockedScoreableItems throws on a non-string or empty element', () => {
  assert.throws(() => normalizeUnlockedScoreableItems(['ok', 1]), TypeError);
  assert.throws(() => normalizeUnlockedScoreableItems(['ok', '']), TypeError);
  assert.throws(() => normalizeUnlockedScoreableItems(['ok', null]), TypeError);
});

test('archiveScoreableItem appends a new id to the end (acquisition order)', () => {
  const { list, added } = archiveScoreableItem(['proto-exoframe'], 'mil-spec-optics');
  assert.equal(added, true);
  assert.deepEqual(list, ['proto-exoframe', 'mil-spec-optics']);
});

test('archiveScoreableItem is a no-op for a duplicate id', () => {
  const start = ['proto-exoframe', 'mil-spec-optics'];
  const { list, added } = archiveScoreableItem(start, 'proto-exoframe');
  assert.equal(added, false);
  assert.deepEqual(list, ['proto-exoframe', 'mil-spec-optics']);
});

test('archiveScoreableItem validates the input list', () => {
  assert.throws(() => archiveScoreableItem('proto-exoframe' as unknown as string[], 'x'), TypeError);
  assert.throws(() => archiveScoreableItem(['ok', ''], 'x'), TypeError);
});

test('archiveScoreableItem rejects an empty or non-string id', () => {
  assert.throws(() => archiveScoreableItem(['proto-exoframe'], ''), TypeError);
  assert.throws(
    () => archiveScoreableItem(['proto-exoframe'], 7 as unknown as string),
    TypeError
  );
});
