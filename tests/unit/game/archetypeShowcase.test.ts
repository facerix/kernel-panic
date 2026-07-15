import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePendingArchetypeShowcase } from '../../../src/game/archetypeShowcase.js';

test('normalizePendingArchetypeShowcase treats an absent store as null', () => {
  assert.equal(normalizePendingArchetypeShowcase(undefined), null);
});

test('normalizePendingArchetypeShowcase passes through an explicit null', () => {
  assert.equal(normalizePendingArchetypeShowcase(null), null);
});

test('normalizePendingArchetypeShowcase passes through a valid id', () => {
  assert.equal(normalizePendingArchetypeShowcase('berserk'), 'berserk');
});

test('normalizePendingArchetypeShowcase throws on a non-string, non-null value', () => {
  assert.throws(() => normalizePendingArchetypeShowcase(1), TypeError);
  assert.throws(() => normalizePendingArchetypeShowcase({}), TypeError);
  assert.throws(() => normalizePendingArchetypeShowcase(['berserk']), TypeError);
});

test('normalizePendingArchetypeShowcase throws on an empty string', () => {
  assert.throws(() => normalizePendingArchetypeShowcase(''), TypeError);
});
