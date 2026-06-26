import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dispatchTouchAction,
  syntheticKeyFor,
  TOUCHPAD_ACTIONS,
  TOUCHPAD_DIRECTIONS,
  TOUCHPAD_SHELL_ACTIONS,
} from '../../../src/input/touchpad.js';
import { AIM_KIND, MODE } from '../../../src/input/keymap.js';

test('TOUCHPAD_DIRECTIONS lists all 8 compass directions', () => {
  assert.deepEqual([...TOUCHPAD_DIRECTIONS].sort(), ['E', 'N', 'NE', 'NW', 'S', 'SE', 'SW', 'W']);
});

test('TOUCHPAD_ACTIONS includes gameplay actions (perks unified as `special`)', () => {
  assert.deepEqual([...TOUCHPAD_ACTIONS].sort(), [
    'cancel',
    'end-turn',
    'fire',
    'interact',
    'inventory',
    'jack-out',
    'look',
    'special',
  ]);
});

test('syntheticKeyFor resolves directions to keymap arrow/diagonal keys', () => {
  assert.equal(syntheticKeyFor('N'), 'ArrowUp');
  assert.equal(syntheticKeyFor('S'), 'ArrowDown');
  assert.equal(syntheticKeyFor('W'), 'ArrowLeft');
  assert.equal(syntheticKeyFor('E'), 'ArrowRight');
  assert.equal(syntheticKeyFor('NW'), 'q');
  assert.equal(syntheticKeyFor('NE'), 'e');
  assert.equal(syntheticKeyFor('SW'), 'z');
  assert.equal(syntheticKeyFor('SE'), 'c');
});

test('syntheticKeyFor resolves actions to keymap keys', () => {
  assert.equal(syntheticKeyFor('fire'), 'f');
  assert.equal(syntheticKeyFor('special'), 'x');
  assert.equal(syntheticKeyFor('end-turn'), '.');
  assert.equal(syntheticKeyFor('cancel'), 'Escape');
  assert.equal(syntheticKeyFor('interact'), ' ');
  assert.equal(syntheticKeyFor('inventory'), 'i');
  assert.equal(syntheticKeyFor('jack-out'), 'j');
  assert.equal(syntheticKeyFor('look'), 'l');
});

test('TOUCHPAD_SHELL_ACTIONS lists shell-only buttons', () => {
  assert.deepEqual([...TOUCHPAD_SHELL_ACTIONS].sort(), ['quit-campaign']);
});

test('syntheticKeyFor resolves quit-campaign to Q', () => {
  assert.equal(syntheticKeyFor('quit-campaign'), 'Q');
});

test('IDLE + quit-campaign touch button emits quit-campaign intent', () => {
  const r = dispatchTouchAction('quit-campaign', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'quit-campaign' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (fire) + quit-campaign touch button stays in AIM', () => {
  const r = dispatchTouchAction('quit-campaign', MODE.AIM, AIM_KIND.FIRE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.AIM);
  assert.equal(r.aimKind, AIM_KIND.FIRE);
});

test('syntheticKeyFor throws on an unknown button (crash > silent fallback)', () => {
  assert.throws(() => syntheticKeyFor('jump'), /unknown button/i);
  assert.throws(() => syntheticKeyFor(''), /unknown button/i);
  assert.throws(() => syntheticKeyFor(null), /unknown button/i);
});

test('IDLE + direction button emits a move intent in that direction', () => {
  const cases = [
    ['N', 0, -1],
    ['S', 0, 1],
    ['W', -1, 0],
    ['E', 1, 0],
    ['NW', -1, -1],
    ['NE', 1, -1],
    ['SW', -1, 1],
    ['SE', 1, 1],
  ];
  for (const [btn, dx, dy] of cases) {
    const r = dispatchTouchAction(btn, MODE.IDLE);
    assert.deepEqual(r.intent, { type: 'move', dx, dy }, `${btn} should move (${dx}, ${dy})`);
    assert.equal(r.nextMode, MODE.IDLE);
  }
});

test('IDLE + end-turn button emits end-turn intent', () => {
  const r = dispatchTouchAction('end-turn', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'end-turn' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + cancel button emits cancel intent', () => {
  const r = dispatchTouchAction('cancel', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + fire button enters AIM (fire) with no intent yet', () => {
  const r = dispatchTouchAction('fire', MODE.IDLE);
  assert.equal(r.intent, null, 'aiming alone produces no intent');
  assert.equal(r.nextMode, MODE.AIM);
  assert.equal(r.aimKind, AIM_KIND.FIRE);
});

test('AIM (fire) + direction emits a directional fire and returns to IDLE', () => {
  const r = dispatchTouchAction('E', MODE.AIM, AIM_KIND.FIRE);
  assert.deepEqual(r.intent, { type: 'fire', dx: 1, dy: 0 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('syntheticKeyFor rejects legacy melee button id (removed from pad)', () => {
  assert.throws(() => syntheticKeyFor('melee'), /unknown button/i);
});

test('IDLE + special button enters AIM (special)', () => {
  const r = dispatchTouchAction('special', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.AIM);
  assert.equal(r.aimKind, AIM_KIND.SPECIAL);
});

test('IDLE + look button enters LOOK mode', () => {
  const r = dispatchTouchAction('look', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.LOOK);
});

test('IDLE + jack-out button emits jack-out intent', () => {
  const r = dispatchTouchAction('jack-out', MODE.IDLE);
  assert.deepEqual(r.intent, { type: 'jack-out' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('LOOK + direction emits a look-move intent', () => {
  const r = dispatchTouchAction('N', MODE.LOOK);
  assert.deepEqual(r.intent, { type: 'look-move', dx: 0, dy: -1 });
  assert.equal(r.nextMode, MODE.LOOK);
});

test('AIM (special) + direction emits a special intent', () => {
  const r = dispatchTouchAction('S', MODE.AIM, AIM_KIND.SPECIAL);
  assert.deepEqual(r.intent, { type: 'special', dx: 0, dy: 1 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (special) + diagonal direction emits a diagonal special intent', () => {
  const r = dispatchTouchAction('NE', MODE.AIM, AIM_KIND.SPECIAL);
  assert.deepEqual(r.intent, { type: 'special', dx: 1, dy: -1 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (fire) + cancel button drops back to IDLE with cancel intent', () => {
  const r = dispatchTouchAction('cancel', MODE.AIM, AIM_KIND.FIRE);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (special) + cancel button drops back to IDLE with cancel intent', () => {
  const r = dispatchTouchAction('cancel', MODE.AIM, AIM_KIND.SPECIAL);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('AIM (fire) + end-turn button does NOT fire; stays in AIM', () => {
  const r = dispatchTouchAction('end-turn', MODE.AIM, AIM_KIND.FIRE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.AIM);
  assert.equal(r.aimKind, AIM_KIND.FIRE);
});

test('AIM (special) + end-turn button stays in AIM', () => {
  const r = dispatchTouchAction('end-turn', MODE.AIM, AIM_KIND.SPECIAL);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.AIM);
  assert.equal(r.aimKind, AIM_KIND.SPECIAL);
});

test('dispatchTouchAction throws on an unknown button', () => {
  assert.throws(() => dispatchTouchAction('jump', MODE.IDLE), /unknown button/i);
});
