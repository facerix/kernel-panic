import { test } from 'node:test';
import assert from 'node:assert/strict';

import { v4, v4WithTimestamp } from '../../src/uuid.js';

const V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('v4() returns a well-formed v4 variant-1 UUID', () => {
  for (let i = 0; i < 1000; i++) {
    const id = v4();
    assert.match(id, V4_REGEX, `unexpected format: ${id}`);
  }
});

test('v4() produces unique values across calls', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    seen.add(v4());
  }
  assert.equal(seen.size, 1000);
});

test('v4WithTimestamp() returns a well-formed v4 variant-1 UUID', () => {
  for (let i = 0; i < 1000; i++) {
    const id = v4WithTimestamp();
    assert.match(id, V4_REGEX, `unexpected format: ${id}`);
  }
});

test('v4WithTimestamp() prefix matches Date.now() hex high-order chars', () => {
  // Take prefix samples just before and just after the call to tolerate the
  // (extremely rare) hour-tick during the test.
  const before = Date.now().toString(16).slice(0, 8);
  const id = v4WithTimestamp();
  const after = Date.now().toString(16).slice(0, 8);
  const prefix = id.slice(0, 8);
  assert.ok(
    prefix === before || prefix === after,
    `prefix ${prefix} did not match ${before} or ${after}`
  );
});

test('v4WithTimestamp() produces unique values across calls', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    seen.add(v4WithTimestamp());
  }
  assert.equal(seen.size, 1000);
});
