import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  archiveUnlockedArchetype,
  normalizeUnlockedArchetypes,
} from '../../../src/game/archetypeUnlocks.js';

test('normalizeUnlockedArchetypes treats an absent store as empty', () => {
  assert.deepEqual(normalizeUnlockedArchetypes(undefined), []);
});

test('normalizeUnlockedArchetypes passes through a valid id list, fresh copy', () => {
  const input = ['berserk', 'adept'];
  const result = normalizeUnlockedArchetypes(input);
  assert.deepEqual(result, ['berserk', 'adept']);
  assert.notEqual(result, input, 'returns a fresh array, not the caller-owned reference');
});

test('normalizeUnlockedArchetypes de-dupes preserving acquisition order', () => {
  const result = normalizeUnlockedArchetypes(['berserk', 'adept', 'berserk', 'chimera', 'adept']);
  assert.deepEqual(result, ['berserk', 'adept', 'chimera']);
});

test('normalizeUnlockedArchetypes throws on a non-array store', () => {
  assert.throws(() => normalizeUnlockedArchetypes('berserk'), TypeError);
  assert.throws(() => normalizeUnlockedArchetypes({ 0: 'berserk' }), TypeError);
});

test('normalizeUnlockedArchetypes throws on a non-string or empty element', () => {
  assert.throws(() => normalizeUnlockedArchetypes(['berserk', 1]), TypeError);
  assert.throws(() => normalizeUnlockedArchetypes(['berserk', '']), TypeError);
  assert.throws(() => normalizeUnlockedArchetypes(['berserk', null]), TypeError);
});

test('archiveUnlockedArchetype appends a new id to the end (acquisition order)', () => {
  const { list, added } = archiveUnlockedArchetype(['berserk'], 'adept');
  assert.equal(added, true);
  assert.deepEqual(list, ['berserk', 'adept']);
});

test('archiveUnlockedArchetype is a no-op for a duplicate id', () => {
  const start = ['berserk', 'adept'];
  const { list, added } = archiveUnlockedArchetype(start, 'berserk');
  assert.equal(added, false);
  assert.deepEqual(list, ['berserk', 'adept']);
});

test('archiveUnlockedArchetype validates the input list', () => {
  assert.throws(() => archiveUnlockedArchetype('berserk' as unknown as string[], 'x'), TypeError);
  assert.throws(() => archiveUnlockedArchetype(['ok', ''], 'x'), TypeError);
});

test('archiveUnlockedArchetype rejects an empty or non-string id', () => {
  assert.throws(() => archiveUnlockedArchetype(['berserk'], ''), TypeError);
  assert.throws(() => archiveUnlockedArchetype(['berserk'], 7 as unknown as string), TypeError);
});

test('nothing grandfathers in — an independently-empty store even with unrelated history', () => {
  // Design decision locked 2026-07-13: unlockedArchetypes starts empty for
  // every meta-crew regardless of unlockedScoreableItems history.
  assert.deepEqual(normalizeUnlockedArchetypes(undefined), []);
});
