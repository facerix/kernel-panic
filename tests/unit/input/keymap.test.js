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
    assert.deepEqual(r.intent, { type: 'move', dx, dy }, `${key} should emit move(${dx}, ${dy})`);
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

test('IDLE + space is a no-op (no end-turn binding)', () => {
  const r = dispatch(' ', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + . emits end-turn', () => {
  const r = dispatch('.', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'end-turn' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + x enters SPECIAL_AIM with no intent yet', () => {
  // The unified perk key. Replaces M1's per-archetype `v` (vault) and
  // `t` (slide) bindings; the live archetype decides the resolved verb at
  // intent-apply time in `applyIntent.doSpecial`.
  const r = dispatch('x', MODE.IDLE);
  assert.equal(r.intent, null, 'aiming alone produces no intent');
  assert.equal(r.nextMode, MODE.SPECIAL_AIM);
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

// Once-removed `v` (Vault) and `t` (Slide) shortcuts no longer enter an
// aim mode — they're plain noise inside IDLE now. `v` still has no other
// meaning so a press is dropped; `t` is unassigned at IDLE too.
test('IDLE + v is a no-op (collapsed into the unified `x` perk key)', () => {
  const r = dispatch('v', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + t is a no-op (collapsed into the unified `x` perk key)', () => {
  const r = dispatch('t', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.IDLE);
});

test('SPECIAL_AIM + arrow emits a special intent and returns to IDLE', () => {
  const r = dispatch('ArrowRight', MODE.SPECIAL_AIM);
  assert.deepEqual(r.intent, { type: 'special', dx: 1, dy: 0 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('SPECIAL_AIM + diagonal key emits a diagonal special', () => {
  const r = dispatch('q', MODE.SPECIAL_AIM);
  assert.deepEqual(r.intent, { type: 'special', dx: -1, dy: -1 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('SPECIAL_AIM + Escape cancels back to IDLE', () => {
  const r = dispatch('Escape', MODE.SPECIAL_AIM);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('SPECIAL_AIM + non-directional key stays in SPECIAL_AIM with no intent', () => {
  const r = dispatch(' ', MODE.SPECIAL_AIM);
  assert.equal(r.intent, null, 'space should not be confused for a direction');
  assert.equal(r.nextMode, MODE.SPECIAL_AIM);
});

test('dispatch is case-tolerant for letter keys (X, Q, etc.)', () => {
  // Aim with X: same as x.
  assert.equal(dispatch('X', MODE.IDLE).nextMode, MODE.SPECIAL_AIM);
  // Diagonal with Q: same as q.
  assert.deepEqual(dispatch('Q', MODE.IDLE).intent, { type: 'move', dx: -1, dy: -1 });
});

test('dispatch rejects an unknown mode (crash over silent fallback)', () => {
  assert.throws(() => dispatch('ArrowUp', 'NOPE'), /unknown mode/i);
});

test('IDLE + f enters FIRE_AIM with no intent yet', () => {
  const r = dispatch('f', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.FIRE_AIM);
});

test('FIRE_AIM + arrow emits a fire intent and returns to IDLE', () => {
  const r = dispatch('ArrowRight', MODE.FIRE_AIM);
  assert.deepEqual(r.intent, { type: 'fire', dx: 1, dy: 0 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('FIRE_AIM + diagonal key emits a diagonal fire', () => {
  const r = dispatch('e', MODE.FIRE_AIM);
  assert.deepEqual(r.intent, { type: 'fire', dx: 1, dy: -1 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('FIRE_AIM + Escape cancels back to IDLE', () => {
  const r = dispatch('Escape', MODE.FIRE_AIM);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('FIRE_AIM + non-directional key stays in FIRE_AIM with no intent', () => {
  const r = dispatch(' ', MODE.FIRE_AIM);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.FIRE_AIM);
});

// --- M6: melee aim mode ------------------------------------------------

test('IDLE + m enters MELEE_AIM with no intent yet', () => {
  const r = dispatch('m', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.MELEE_AIM);
});

test('MELEE_AIM + arrow emits a melee intent and returns to IDLE', () => {
  const r = dispatch('ArrowRight', MODE.MELEE_AIM);
  assert.deepEqual(r.intent, { type: 'melee', dx: 1, dy: 0 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('MELEE_AIM + diagonal key emits a diagonal melee', () => {
  const r = dispatch('q', MODE.MELEE_AIM);
  assert.deepEqual(r.intent, { type: 'melee', dx: -1, dy: -1 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('MELEE_AIM + Escape cancels back to IDLE', () => {
  const r = dispatch('Escape', MODE.MELEE_AIM);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('MELEE_AIM + non-directional key stays in MELEE_AIM with no intent', () => {
  const r = dispatch(' ', MODE.MELEE_AIM);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.MELEE_AIM);
});

// --- M8: context-sensitive interact verb ------------------------------

test('IDLE + i emits interact intent and stays IDLE', () => {
  const r = dispatch('i', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'interact' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + I (caps) emits interact intent (case-tolerant)', () => {
  const r = dispatch('I', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'interact' });
  assert.equal(r.nextMode, MODE.IDLE);
});
