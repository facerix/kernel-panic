import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch, MODE } from '../../../src/input/keymap.js';

test('IDLE + arrow keys produce move intents in the right direction', () => {
  const cases = [
    ['ArrowUp', 0, -1],
    ['ArrowDown', 0, 1],
    ['ArrowLeft', -1, 0],
    ['ArrowRight', 1, 0],
  ];
  for (const [key, dx, dy] of cases) {
    const r = dispatch(key, MODE.IDLE);
    assert.deepEqual(
      r.intent,
      { type: 'move', dx, dy },
      `${key} should emit move(${dx}, ${dy})`
    );
    assert.equal(r.nextMode, MODE.IDLE);
  }
});

test('IDLE + diagonal keys (q/e/z/c) produce move intents', () => {
  const cases = [
    ['q', -1, -1],
    ['e', 1, -1],
    ['z', -1, 1],
    ['c', 1, 1],
  ];
  for (const [key, dx, dy] of cases) {
    const r = dispatch(key, MODE.IDLE);
    assert.deepEqual(r.intent, { type: 'move', dx, dy });
    assert.equal(r.nextMode, MODE.IDLE);
  }
});

test('IDLE + space emits end-turn', () => {
  const r = dispatch(' ', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'end-turn' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + . emits wait', () => {
  const r = dispatch('.', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'wait' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + v enters VAULT_AIM with no intent yet', () => {
  const r = dispatch('v', MODE.IDLE);
  assert.equal(r.intent, null, 'aiming alone produces no intent');
  assert.equal(r.nextMode, MODE.VAULT_AIM);
});

test('IDLE + Escape emits cancel and stays IDLE', () => {
  const r = dispatch('Escape', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + unknown key produces no intent and no mode change', () => {
  const r = dispatch('F13', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.IDLE);
});

test('VAULT_AIM + arrow emits vault intent and returns to IDLE', () => {
  const r = dispatch('ArrowRight', MODE.VAULT_AIM);
  assert.deepEqual(r.intent, { type: 'vault', dx: 1, dy: 0 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('VAULT_AIM + diagonal key emits a diagonal vault', () => {
  const r = dispatch('q', MODE.VAULT_AIM);
  assert.deepEqual(r.intent, { type: 'vault', dx: -1, dy: -1 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('VAULT_AIM + Escape cancels back to IDLE', () => {
  const r = dispatch('Escape', MODE.VAULT_AIM);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('VAULT_AIM + non-directional key stays in VAULT_AIM with no intent', () => {
  const r = dispatch(' ', MODE.VAULT_AIM);
  assert.equal(r.intent, null, 'space should not be confused for a direction');
  assert.equal(r.nextMode, MODE.VAULT_AIM);
});

test('dispatch is case-tolerant for letter keys (V, Q, etc.)', () => {
  // Aim with V: same as v.
  assert.equal(dispatch('V', MODE.IDLE).nextMode, MODE.VAULT_AIM);
  // Diagonal with Q: same as q.
  assert.deepEqual(dispatch('Q', MODE.IDLE).intent, { type: 'move', dx: -1, dy: -1 });
});

test('dispatch rejects an unknown mode (crash over silent fallback)', () => {
  assert.throws(() => dispatch('ArrowUp', 'NOPE'), /unknown mode/i);
});
