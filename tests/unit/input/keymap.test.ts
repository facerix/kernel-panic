import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AIM_KIND, dispatch, MODE } from '../../../src/input/keymap.js';

function noIdleChange() {
  return { intent: null, nextMode: MODE.IDLE, aimKind: null };
}

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
    assert.equal(r.aimKind, null);
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

test('IDLE + . emits end-turn (wait / pass turn)', () => {
  const r = dispatch('.', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'end-turn' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + Space emits interact and stays IDLE', () => {
  const r = dispatch(' ', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'interact' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + x enters AIM (special) with no intent yet', () => {
  const r = dispatch('x', MODE.IDLE);
  assert.equal(r.intent, null, 'aiming alone produces no intent');
  assert.equal(r.nextMode, MODE.AIM);
  assert.equal(r.aimKind, AIM_KIND.SPECIAL);
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

test('AIM (special) + arrow emits a special intent and returns to IDLE', () => {
  const r = dispatch('ArrowRight', MODE.AIM, AIM_KIND.SPECIAL);
  assert.deepEqual(r.intent, { type: 'special', dx: 1, dy: 0 });
  assert.equal(r.nextMode, MODE.IDLE);
  assert.equal(r.aimKind, null);
});

test('AIM (special) + diagonal key emits a diagonal special', () => {
  const r = dispatch('q', MODE.AIM, AIM_KIND.SPECIAL);
  assert.deepEqual(r.intent, { type: 'special', dx: -1, dy: -1 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (special) + Escape cancels back to IDLE', () => {
  const r = dispatch('Escape', MODE.AIM, AIM_KIND.SPECIAL);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (special) + non-directional key stays in AIM with no intent', () => {
  const r = dispatch(' ', MODE.AIM, AIM_KIND.SPECIAL);
  assert.equal(r.intent, null, 'space should not be confused for a direction');
  assert.equal(r.nextMode, MODE.AIM);
  assert.equal(r.aimKind, AIM_KIND.SPECIAL);
});

test('dispatch is case-sensitive for letter keys (uppercase is ignored except Q)', () => {
  assert.deepEqual(dispatch('X', MODE.IDLE), noIdleChange());
  assert.deepEqual(dispatch('W', MODE.IDLE), noIdleChange());
  assert.deepEqual(dispatch('F', MODE.IDLE), noIdleChange());
  assert.deepEqual(dispatch('I', MODE.IDLE), noIdleChange());
});

test('IDLE + Q emits quit-campaign intent', () => {
  const r = dispatch('Q', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'quit-campaign' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (fire) + Q stays in AIM (quit is IDLE-only)', () => {
  const r = dispatch('Q', MODE.AIM, AIM_KIND.FIRE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.AIM);
  assert.equal(r.aimKind, AIM_KIND.FIRE);
});

test('dispatch rejects an unknown mode (crash over silent fallback)', () => {
  assert.throws(() => dispatch('ArrowUp', 'NOPE' as typeof MODE.IDLE), /unknown mode/i);
});

test('MODE.AIM without aimKind throws (crash over silent fallback)', () => {
  assert.throws(() => dispatch('ArrowUp', MODE.AIM), /requires an aimKind/i);
});

test('IDLE + f enters AIM (fire) with no intent yet', () => {
  const r = dispatch('f', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.AIM);
  assert.equal(r.aimKind, AIM_KIND.FIRE);
});

test('AIM (fire) + arrow emits a fire intent and returns to IDLE', () => {
  const r = dispatch('ArrowRight', MODE.AIM, AIM_KIND.FIRE);
  assert.deepEqual(r.intent, { type: 'fire', dx: 1, dy: 0 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (fire) + diagonal key emits a diagonal fire', () => {
  const r = dispatch('e', MODE.AIM, AIM_KIND.FIRE);
  assert.deepEqual(r.intent, { type: 'fire', dx: 1, dy: -1 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (fire) + Escape cancels back to IDLE', () => {
  const r = dispatch('Escape', MODE.AIM, AIM_KIND.FIRE);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (fire) + non-directional key stays in AIM with no intent', () => {
  const r = dispatch(' ', MODE.AIM, AIM_KIND.FIRE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.AIM);
  assert.equal(r.aimKind, AIM_KIND.FIRE);
});

test('AIM (use-item) + direction emits use-item intent', () => {
  const r = dispatch('ArrowRight', MODE.AIM, AIM_KIND.USE_ITEM);
  assert.deepEqual(r.intent, { type: 'use-item', dx: 1, dy: 0 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + m is a no-op (melee is bump-only for the player keymap)', () => {
  const r = dispatch('m', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + i emits inventory intent (M4)', () => {
  const r = dispatch('i', MODE.IDLE);
  assert.deepStrictEqual(r.intent, { type: 'inventory' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + l enters LOOK with no intent yet', () => {
  const r = dispatch('l', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.LOOK);
  assert.equal(r.aimKind, null);
});

test('LOOK + direction emits look-move and stays in LOOK', () => {
  const r = dispatch('ArrowRight', MODE.LOOK);
  assert.deepEqual(r.intent, { type: 'look-move', dx: 1, dy: 0 });
  assert.equal(r.nextMode, MODE.LOOK);
  assert.equal(r.aimKind, null);
});

test('LOOK + Escape cancels back to IDLE', () => {
  const r = dispatch('Escape', MODE.LOOK);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
  assert.equal(r.aimKind, null);
});

test('IDLE + I (uppercase) is a no-op (case-sensitive)', () => {
  const r = dispatch('I', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (special) + Q (uppercase) does not resolve a direction', () => {
  const r = dispatch('Q', MODE.AIM, AIM_KIND.SPECIAL);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.AIM);
  assert.equal(r.aimKind, AIM_KIND.SPECIAL);
});
