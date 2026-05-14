import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dispatchTouchAction,
  syntheticKeyFor,
  TOUCHPAD_ACTIONS,
  TOUCHPAD_DIRECTIONS,
} from '../../../src/input/touchpad.js';
import { MODE } from '../../../src/input/keymap.js';

test('TOUCHPAD_DIRECTIONS lists all 8 compass directions', () => {
  assert.deepEqual([...TOUCHPAD_DIRECTIONS].sort(), ['E', 'N', 'NE', 'NW', 'S', 'SE', 'SW', 'W']);
});

test('TOUCHPAD_ACTIONS includes the six gameplay actions (perks unified as `special`)', () => {
  // Vault and slide collapsed into one `special` button alongside the new
  // Tech deploy verb — same unified-perk-key model as the keyboard layer.
  assert.deepEqual([...TOUCHPAD_ACTIONS].sort(), [
    'cancel',
    'end-turn',
    'fire',
    'interact',
    'melee',
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
  assert.equal(syntheticKeyFor('melee'), 'm');
  assert.equal(syntheticKeyFor('special'), 'x');
  assert.equal(syntheticKeyFor('end-turn'), '.');
  assert.equal(syntheticKeyFor('cancel'), 'Escape');
  assert.equal(syntheticKeyFor('interact'), ' ');
});

test('syntheticKeyFor throws on an unknown button (crash > silent fallback)', () => {
  assert.throws(() => syntheticKeyFor('jump'), /unknown button/i);
  assert.throws(() => syntheticKeyFor(''), /unknown button/i);
  assert.throws(() => syntheticKeyFor(null), /unknown button/i);
});

// --- Direction taps in IDLE → move intents -----------------------------

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

// --- Action button → aim mode → direction → targeted intent -----------

test('IDLE + fire button enters FIRE_AIM with no intent yet', () => {
  const r = dispatchTouchAction('fire', MODE.IDLE);
  assert.equal(r.intent, null, 'aiming alone produces no intent');
  assert.equal(r.nextMode, MODE.FIRE_AIM);
});

test('FIRE_AIM + direction emits a directional fire and returns to IDLE', () => {
  const r = dispatchTouchAction('E', MODE.FIRE_AIM);
  assert.deepEqual(r.intent, { type: 'fire', dx: 1, dy: 0 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + melee button enters MELEE_AIM', () => {
  const r = dispatchTouchAction('melee', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.MELEE_AIM);
});

test('MELEE_AIM + diagonal direction emits a diagonal melee', () => {
  const r = dispatchTouchAction('NW', MODE.MELEE_AIM);
  assert.deepEqual(r.intent, { type: 'melee', dx: -1, dy: -1 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('IDLE + special button enters SPECIAL_AIM', () => {
  // One archetype-perk button covers Vault / Slide / Deploy. The aim mode
  // is shared; the actual verb is dispatched by `applyIntent.doSpecial`
  // based on the live player's class.
  const r = dispatchTouchAction('special', MODE.IDLE);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.SPECIAL_AIM);
});

test('SPECIAL_AIM + direction emits a special intent', () => {
  const r = dispatchTouchAction('S', MODE.SPECIAL_AIM);
  assert.deepEqual(r.intent, { type: 'special', dx: 0, dy: 1 });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('SPECIAL_AIM + diagonal direction emits a diagonal special intent', () => {
  const r = dispatchTouchAction('NE', MODE.SPECIAL_AIM);
  assert.deepEqual(r.intent, { type: 'special', dx: 1, dy: -1 });
  assert.equal(r.nextMode, MODE.IDLE);
});

// --- Cancel inside aim modes drops back to IDLE -------------------------

test('FIRE_AIM + cancel button drops back to IDLE with cancel intent', () => {
  const r = dispatchTouchAction('cancel', MODE.FIRE_AIM);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('SPECIAL_AIM + cancel button drops back to IDLE with cancel intent', () => {
  const r = dispatchTouchAction('cancel', MODE.SPECIAL_AIM);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

test('MELEE_AIM + cancel button drops back to IDLE with cancel intent', () => {
  const r = dispatchTouchAction('cancel', MODE.MELEE_AIM);
  assert.deepEqual(r.intent, { type: 'cancel' });
  assert.equal(r.nextMode, MODE.IDLE);
});

// --- Aim mode is sticky on noise (matches keyboard behaviour) -----------

test('FIRE_AIM + end-turn button does NOT fire; stays in FIRE_AIM', () => {
  // The keymap treats non-directional keys as no-ops inside aim modes so
  // the user can't accidentally fire the wait shortcut. Touch inherits that
  // by going through the same dispatcher.
  const r = dispatchTouchAction('end-turn', MODE.FIRE_AIM);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.FIRE_AIM);
});

test('SPECIAL_AIM + end-turn button stays in SPECIAL_AIM', () => {
  const r = dispatchTouchAction('end-turn', MODE.SPECIAL_AIM);
  assert.equal(r.intent, null);
  assert.equal(r.nextMode, MODE.SPECIAL_AIM);
});

// --- Unknown button surface ---------------------------------------------

test('dispatchTouchAction throws on an unknown button', () => {
  assert.throws(() => dispatchTouchAction('jump', MODE.IDLE), /unknown button/i);
});
