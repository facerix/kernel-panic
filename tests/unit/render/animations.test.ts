import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANIMATION_DURATIONS,
  DAMAGE_CLASS,
  SHAKE_CLASS,
  createAnimationLock,
  restartCssAnimation,
  runInteractSecuredFlash,
  runMuzzleFlash,
  triggerDamageFlash,
  triggerShake,
} from '../../../src/render/animations.js';

/**
 * Minimal DOM-element stub — enough surface for restartCssAnimation to
 * exercise both branches (class toggling + the offsetWidth reflow read).
 * Each call to `cssText()` returns the join of the current class set so
 * tests can assert state without inspecting the internals.
 */
function makeElement() {
  const classes = new Set();
  let offsetWidthReads = 0;
  return {
    classList: {
      add: cls => classes.add(cls),
      remove: cls => classes.delete(cls),
      contains: cls => classes.has(cls),
      toString: () => Array.from(classes).join(' '),
    },
    get offsetWidth() {
      offsetWidthReads += 1;
      return 100;
    },
    _classes: classes,
    _offsetWidthReads: () => offsetWidthReads,
  };
}

/** Fake timer pair: deterministic `now()` and a manually-pumped queue. */
function makeTimers() {
  let nowMs = 0;
  /** @type {{at: number, fn: () => void}[]} */
  const queue = [];
  return {
    now: () => nowMs,
    setTimeout: (fn, ms) => {
      queue.push({ at: nowMs + ms, fn });
      return queue.length;
    },
    advance(ms) {
      nowMs += ms;
      // Stable sort by time; pop everything due.
      queue.sort((a, b) => a.at - b.at);
      while (queue.length && queue[0].at <= nowMs) {
        const due = queue.shift();
        due.fn();
      }
    },
    pending: () => queue.length,
  };
}

test('restartCssAnimation adds the class and forces a reflow read', () => {
  const el = makeElement();
  const timers = makeTimers();
  const result = restartCssAnimation(el, 'flash', 100, timers);
  assert.equal(result, true);
  assert.equal(el.classList.contains('flash'), true);
  assert.ok(el._offsetWidthReads() >= 1, 'offsetWidth must be read to force reflow');
});

test('restartCssAnimation removes the class after the duration elapses', () => {
  const el = makeElement();
  const timers = makeTimers();
  restartCssAnimation(el, 'flash', 100, timers);
  timers.advance(99);
  assert.equal(el.classList.contains('flash'), true, 'class should persist before duration');
  timers.advance(2);
  assert.equal(el.classList.contains('flash'), false, 'class should be removed after duration');
});

test('restartCssAnimation retriggers cleanly on a back-to-back call', () => {
  const el = makeElement();
  const timers = makeTimers();
  restartCssAnimation(el, 'flash', 100, timers);
  timers.advance(50);
  // Second hit lands while the first is still mid-animation.
  restartCssAnimation(el, 'flash', 100, timers);
  // Both `remove` callbacks are scheduled. The first remove (at t=100) runs;
  // the class is then re-added by our manual second call which already happened.
  // Wait — our setTimeout-driven removes both fire. Need to ensure the class
  // ends up removed once both timers have fired.
  timers.advance(60); // t=110 → first remove fires (class removed at 100, then re-added by the explicit second call? Let's trace)
  // Actually: at t=50 we called restartCssAnimation again. It removes the
  // class (idempotent), reads offsetWidth, adds it back, schedules a remove
  // at t=150. The first scheduled remove (at t=100) will also run, removing
  // the class. The second remove (at t=150) is then a no-op for `.delete`.
  assert.equal(el.classList.contains('flash'), false, 'first timer should have removed the class');
  timers.advance(50); // t=160 → second remove fires (no-op)
  assert.equal(el.classList.contains('flash'), false);
});

test('restartCssAnimation tolerates a null target', () => {
  const timers = makeTimers();
  assert.equal(restartCssAnimation(null, 'flash', 50, timers), false);
  assert.equal(restartCssAnimation({}, 'flash', 50, timers), false, 'no classList → false');
});

test('restartCssAnimation rejects a negative duration', () => {
  const el = makeElement();
  const timers = makeTimers();
  assert.throws(() => restartCssAnimation(el, 'flash', -1, timers), /non-negative/);
});

test('triggerShake / triggerDamageFlash apply the shared class constants', () => {
  const el = makeElement();
  const timers = makeTimers();
  triggerShake(el, timers);
  assert.equal(el.classList.contains(SHAKE_CLASS), true);
  triggerDamageFlash(el, timers);
  assert.equal(el.classList.contains(DAMAGE_CLASS), true);
  timers.advance(ANIMATION_DURATIONS.SHAKE + 1);
  assert.equal(el.classList.contains(SHAKE_CLASS), false);
  // Damage flash is the longer of the two; still pending.
  assert.equal(el.classList.contains(DAMAGE_CLASS), true);
  timers.advance(ANIMATION_DURATIONS.DAMAGE_FLASH);
  assert.equal(el.classList.contains(DAMAGE_CLASS), false);
});

test('createAnimationLock: isLocked is false before any push', () => {
  const timers = makeTimers();
  const lock = createAnimationLock(timers);
  assert.equal(lock.isLocked(), false);
});

test('createAnimationLock: push extends the deadline; isLocked tracks the clock', () => {
  const timers = makeTimers();
  const lock = createAnimationLock(timers);
  lock.push(100);
  assert.equal(lock.isLocked(), true);
  timers.advance(50);
  assert.equal(lock.isLocked(), true);
  timers.advance(60);
  assert.equal(lock.isLocked(), false, 'lock should release once the deadline passes');
});

test('createAnimationLock: overlapping pushes pick the longer outstanding deadline', () => {
  const timers = makeTimers();
  const lock = createAnimationLock(timers);
  lock.push(300); // ends at t=300
  timers.advance(50);
  lock.push(100); // would end at t=150 — shorter, should NOT shrink the lock
  assert.equal(lock._deadline(), 300, 'shorter push must not shorten the lock');
  timers.advance(260); // t=310
  assert.equal(lock.isLocked(), false);
});

test('createAnimationLock: a longer push from later still extends the lock', () => {
  const timers = makeTimers();
  const lock = createAnimationLock(timers);
  lock.push(100); // ends at t=100
  timers.advance(50);
  lock.push(200); // ends at t=250 — longer, should extend
  assert.equal(lock._deadline(), 250);
  timers.advance(100);
  assert.equal(lock.isLocked(), true);
  timers.advance(110);
  assert.equal(lock.isLocked(), false);
});

test('createAnimationLock: reset clears an outstanding lock immediately', () => {
  const timers = makeTimers();
  const lock = createAnimationLock(timers);
  lock.push(500);
  assert.equal(lock.isLocked(), true);
  lock.reset();
  assert.equal(lock.isLocked(), false);
});

test('createAnimationLock: rejects non-finite durations', () => {
  const lock = createAnimationLock();
  assert.throws(() => lock.push(NaN), /non-negative/);
  assert.throws(() => lock.push(-5), /non-negative/);
});

test('runMuzzleFlash: paints the cell and schedules the repaint', () => {
  const timers = makeTimers();
  const calls = [];
  const renderer = {
    flashCell: (wx, wy, opts) => {
      calls.push(['flash', wx, wy, opts]);
      return true;
    },
  };
  const repaint = () => calls.push(['repaint']);

  const fired = runMuzzleFlash(renderer, repaint, 4, 7, { timers });
  assert.equal(fired, true);
  // Duration is forwarded so the renderer's per-flash expiry matches the
  // scheduled cleanup — otherwise the overlay would either flicker out
  // early or linger past the repaint.
  assert.deepEqual(calls[0], ['flash', 4, 7, { duration: ANIMATION_DURATIONS.MUZZLE_FLASH }]);
  // Repaint hasn't fired yet — only scheduled.
  assert.equal(calls.length, 1);
  timers.advance(ANIMATION_DURATIONS.MUZZLE_FLASH);
  assert.deepEqual(calls[1], ['repaint']);
});

test('runMuzzleFlash: custom duration overrides default and is forwarded to flashCell', () => {
  const timers = makeTimers();
  const calls = [];
  const renderer = {
    flashCell: (wx, wy, opts) => {
      calls.push(['flash', opts.duration]);
      return true;
    },
  };
  runMuzzleFlash(renderer, () => calls.push(['repaint']), 0, 0, { duration: 250, timers });
  assert.deepEqual(calls[0], ['flash', 250]);
  timers.advance(249);
  assert.equal(calls.length, 1, 'repaint should not fire before duration elapses');
  timers.advance(2);
  assert.deepEqual(calls[1], ['repaint']);
});

test('runMuzzleFlash: when the renderer cannot paint, returns false and does not schedule', () => {
  const timers = makeTimers();
  const renderer = { flashCell: () => false };
  let repainted = false;
  const fired = runMuzzleFlash(renderer, () => (repainted = true), 0, 0, { timers });
  assert.equal(fired, false);
  timers.advance(1000);
  assert.equal(repainted, false, 'no repaint should be scheduled when nothing was painted');
  assert.equal(timers.pending(), 0);
});

test('runMuzzleFlash: rejects malformed arguments', () => {
  assert.throws(() => runMuzzleFlash({}, () => {}, 0, 0), /flashCell/);
  assert.throws(() => runMuzzleFlash({ flashCell: () => true }, null, 0, 0), /repaint/);
});

test('runInteractSecuredFlash: paints the prop glyph in white and schedules repaint', () => {
  const timers = makeTimers();
  const calls = [];
  const renderer = {
    flashCell: (wx, wy, opts) => {
      calls.push(['flash', wx, wy, opts]);
      return true;
    },
  };
  const repaint = () => calls.push(['repaint']);

  const fired = runInteractSecuredFlash(renderer, repaint, 2, 5, '‡', { timers });
  assert.equal(fired, true);
  assert.deepEqual(calls[0], [
    'flash',
    2,
    5,
    {
      duration: ANIMATION_DURATIONS.INTERACT_SECURED_FLASH,
      char: '‡',
      color: '#ffffff',
    },
  ]);
  timers.advance(ANIMATION_DURATIONS.INTERACT_SECURED_FLASH);
  assert.deepEqual(calls[1], ['repaint']);
});
