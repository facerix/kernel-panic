import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KeyboardController } from '../../../src/input/KeyboardController.js';
import { MODE } from '../../../src/input/keymap.js';

/** Bare event-target stub good enough for `addEventListener` / `dispatchEvent`. */
function makeTarget() {
  const listeners = [];
  return {
    addEventListener: (_type, fn) => listeners.push(fn),
    removeEventListener: (_type, fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    /** Synthetic keydown — only the fields the controller actually reads. */
    keydown(key, mods = {}) {
      const evt = {
        key,
        ctrlKey: !!mods.ctrlKey,
        metaKey: !!mods.metaKey,
        altKey: !!mods.altKey,
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      for (const fn of listeners) fn(evt);
      return evt;
    },
  };
}

test('KeyboardController requires an onIntent callback', () => {
  const target = makeTarget();
  assert.throws(() => new KeyboardController({ target }), /onIntent/);
});

test('KeyboardController rejects a non-function isBlocked', () => {
  const target = makeTarget();
  assert.throws(
    () => new KeyboardController({ target, onIntent: () => {}, isBlocked: 'nope' }),
    /isBlocked/
  );
});

test('keydown produces an intent through the default (unblocked) path', () => {
  const target = makeTarget();
  const intents = [];
  const ctrl = new KeyboardController({
    target,
    onIntent: i => intents.push(i),
  });
  ctrl.attach();
  target.keydown('ArrowUp');
  assert.deepEqual(intents, [{ type: 'move', dx: 0, dy: -1 }]);
});

test('isBlocked() === true short-circuits keydown — no intent, no mode change', () => {
  const target = makeTarget();
  const intents = [];
  const modeChanges = [];
  let blocked = true;
  const ctrl = new KeyboardController({
    target,
    onIntent: i => intents.push(i),
    onModeChange: m => modeChanges.push(m),
    isBlocked: () => blocked,
  });
  ctrl.attach();

  target.keydown('f'); // would normally enter MODE.AIM (fire)
  target.keydown('ArrowUp'); // would normally emit move

  assert.equal(ctrl.mode, MODE.IDLE, 'mode must not advance while blocked');
  assert.deepEqual(intents, [], 'no intents dispatched while blocked');
  assert.deepEqual(modeChanges, [], 'no mode-change callbacks while blocked');

  // Once the lock clears, the next press goes through.
  blocked = false;
  target.keydown('ArrowRight');
  assert.deepEqual(intents, [{ type: 'move', dx: 1, dy: 0 }]);
});

test('modifier-key presses are still ignored independently of isBlocked', () => {
  const target = makeTarget();
  const intents = [];
  const ctrl = new KeyboardController({
    target,
    onIntent: i => intents.push(i),
    isBlocked: () => false,
  });
  ctrl.attach();
  target.keydown('ArrowUp', { ctrlKey: true });
  assert.deepEqual(intents, [], 'ctrl-modified key must not produce an intent');
});

test('isBlocked is checked before preventDefault, so blocked keys do not steal the event', () => {
  const target = makeTarget();
  const ctrl = new KeyboardController({
    target,
    onIntent: () => {},
    isBlocked: () => true,
  });
  ctrl.attach();
  const evt = target.keydown('ArrowUp');
  // The contract: blocked keys are passed through. Useful so the browser's
  // own scroll behaviour, native autocomplete, etc. don't accidentally get
  // suppressed during an animation lockout.
  assert.equal(evt.prevented, false, 'preventDefault must not be called while blocked');
});
