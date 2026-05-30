/**
 * errorBoundary unit tests.
 *
 * The boundary is the bridge that makes the project's "fail loud, but recover"
 * doctrine survivable on a console-less tablet: it catches a tier-1 throw at the
 * top level, emits a dev-channel signal, and hands off to a `degrade` callback
 * (which the shell wires to "return to Hub, save intact") instead of leaving a
 * white screen.
 *
 * These tests drive the browser-free logic via an injected `EventTarget`, so no
 * DOM is required. Node 22 has no `ErrorEvent`/`PromiseRejectionEvent`, so the
 * module must duck-type the event payload — the tests deliberately dispatch
 * plain `Event`s with `.error` / `.reason` / `.message` attached, exactly the
 * shape `window` would produce.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installErrorBoundary } from '../../src/errorBoundary.js';

/** Build an `error`-type event carrying a thrown value, like `window` would. */
function errorEvent(props: Record<string, unknown>): Event {
  const ev = new Event('error');
  Object.assign(ev, props);
  return ev;
}

/** Build an `unhandledrejection`-type event carrying a rejection reason. */
function rejectionEvent(reason: unknown): Event {
  const ev = new Event('unhandledrejection');
  Object.assign(ev, { reason });
  return ev;
}

test('a thrown Error on the target invokes degrade with the normalized signal', () => {
  const target = new EventTarget();
  const signals: Array<{ error: Error; source: string }> = [];
  installErrorBoundary({ target, degrade: s => signals.push(s), onSignal: () => {} });

  const boom = new Error('kaboom');
  target.dispatchEvent(errorEvent({ error: boom }));

  assert.equal(signals.length, 1);
  assert.equal(signals[0].error, boom);
  assert.equal(signals[0].source, 'error');
});

test('an unhandledrejection invokes degrade and tags the source', () => {
  const target = new EventTarget();
  const signals: Array<{ error: Error; source: string }> = [];
  installErrorBoundary({ target, degrade: s => signals.push(s), onSignal: () => {} });

  const reason = new Error('promise blew up');
  target.dispatchEvent(rejectionEvent(reason));

  assert.equal(signals.length, 1);
  assert.equal(signals[0].error, reason);
  assert.equal(signals[0].source, 'unhandledrejection');
});

test('a non-Error thrown value is normalized to an Error', () => {
  // The boundary degrades exactly once (latched), so each shape gets its own
  // boundary rather than two dispatches into one.
  const stringSignals: Array<{ error: Error; source: string }> = [];
  const stringTarget = new EventTarget();
  installErrorBoundary({
    target: stringTarget,
    degrade: s => stringSignals.push(s),
    onSignal: () => {},
  });
  // Some code throws a string — the browser surfaces it as event.message only.
  stringTarget.dispatchEvent(errorEvent({ message: 'string fault', error: undefined }));

  assert.equal(stringSignals.length, 1);
  assert.ok(stringSignals[0].error instanceof Error);
  assert.match(stringSignals[0].error.message, /string fault/);

  const objSignals: Array<{ error: Error; source: string }> = [];
  const objTarget = new EventTarget();
  installErrorBoundary({ target: objTarget, degrade: s => objSignals.push(s), onSignal: () => {} });
  // A promise rejects with a plain object.
  objTarget.dispatchEvent(rejectionEvent({ code: 42 }));

  assert.equal(objSignals.length, 1);
  assert.ok(objSignals[0].error instanceof Error);
});

test('onSignal fires before degrade (dev-channel signal is the loud part)', () => {
  const target = new EventTarget();
  const order: string[] = [];
  installErrorBoundary({
    target,
    onSignal: () => order.push('signal'),
    degrade: () => order.push('degrade'),
  });

  target.dispatchEvent(errorEvent({ error: new Error('x') }));

  assert.deepEqual(order, ['signal', 'degrade']);
});

test('re-entrancy guard: a fault while already degrading does not re-invoke degrade', () => {
  const target = new EventTarget();
  let degradeCalls = 0;
  installErrorBoundary({
    target,
    onSignal: () => {},
    // Simulate the degrade path itself throwing (which would re-enter via the
    // global handler in a real browser) — the boundary must not loop.
    degrade: () => {
      degradeCalls++;
      target.dispatchEvent(errorEvent({ error: new Error('fault during degrade') }));
    },
  });

  target.dispatchEvent(errorEvent({ error: new Error('first') }));

  assert.equal(degradeCalls, 1, 'degrade ran exactly once despite a nested fault');
});

test('a throw inside degrade is contained, not propagated', () => {
  const target = new EventTarget();
  installErrorBoundary({
    target,
    onSignal: () => {},
    degrade: () => {
      throw new Error('degrade itself failed');
    },
  });

  // dispatchEvent must not throw out to the caller (the browser event loop).
  assert.doesNotThrow(() => target.dispatchEvent(errorEvent({ error: new Error('x') })));
});

test('uninstall removes the listeners', () => {
  const target = new EventTarget();
  let calls = 0;
  const uninstall = installErrorBoundary({
    target,
    onSignal: () => {},
    degrade: () => calls++,
  });

  uninstall();
  target.dispatchEvent(errorEvent({ error: new Error('after uninstall') }));

  assert.equal(calls, 0);
});

test('onSignal defaults to a console.error channel when omitted', () => {
  const target = new EventTarget();
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    installErrorBoundary({ target, degrade: () => {} });
    target.dispatchEvent(errorEvent({ error: new Error('signal me') }));
  } finally {
    console.error = originalError;
  }

  assert.ok(logged.length >= 1, 'default signal channel wrote to console.error');
});

test('validates its options', () => {
  const target = new EventTarget();
  // @ts-expect-error missing degrade
  assert.throws(() => installErrorBoundary({ target }), /degrade/);
  // @ts-expect-error missing target
  assert.throws(() => installErrorBoundary({ degrade: () => {} }), /target/);
});
