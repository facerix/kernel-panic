import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus, EVENT, type EventListener } from '../../../src/game/events.js';

test('EventBus.on subscribes and emit invokes the listener with payload', () => {
  const bus = new EventBus();
  const calls: unknown[] = [];
  bus.on(EVENT.ENTITY_MOVED, payload => calls.push(payload));
  bus.emit(EVENT.ENTITY_MOVED, { id: 'a' });
  assert.deepEqual(calls, [{ id: 'a' }]);
});

test('EventBus.emit with no subscribers is a silent no-op', () => {
  const bus = new EventBus();
  // No throw, no return value contract — just don't blow up.
  assert.doesNotThrow(() => bus.emit(EVENT.NOISE, { origin: { x: 0, y: 0 } }));
});

test('EventBus.on returns an unsubscribe function', () => {
  const bus = new EventBus();
  const calls: unknown[] = [];
  const off = bus.on(EVENT.NOISE, p => calls.push(p));
  bus.emit(EVENT.NOISE, { tag: 'first' });
  off();
  bus.emit(EVENT.NOISE, { tag: 'second' });
  assert.deepEqual(calls, [{ tag: 'first' }]);
});

test('EventBus.off removes a listener by reference', () => {
  const bus = new EventBus();
  const calls: unknown[] = [];
  const fn: EventListener = p => calls.push(p);
  bus.on(EVENT.TURN_ENDED, fn);
  bus.off(EVENT.TURN_ENDED, fn);
  bus.emit(EVENT.TURN_ENDED, { previous: 'player', next: 'corp', turn: 1 });
  assert.deepEqual(calls, []);
});

test('EventBus rejects unknown event types in on/off/emit (typo-guard)', () => {
  const bus = new EventBus();
  assert.throws(() => bus.on('entity:moove', () => {}), /Unknown event type/);
  assert.throws(() => bus.off('entity:moove', () => {}), /Unknown event type/);
  assert.throws(() => bus.emit('entity:moove', {}), /Unknown event type/);
});

test('EventBus.on requires a function listener', () => {
  const bus = new EventBus();
  // @ts-expect-error Runtime validation must reject null.
  assert.throws(() => bus.on(EVENT.NOISE, null), TypeError);
  // @ts-expect-error Runtime validation must reject a string.
  assert.throws(() => bus.on(EVENT.NOISE, 'not a fn'), TypeError);
});

test('EventBus dispatches in registration order', () => {
  const bus = new EventBus();
  const order: string[] = [];
  bus.on(EVENT.NOISE, () => order.push('a'));
  bus.on(EVENT.NOISE, () => order.push('b'));
  bus.on(EVENT.NOISE, () => order.push('c'));
  bus.emit(EVENT.NOISE, {});
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('a listener that throws propagates the error (no silent swallow)', () => {
  const bus = new EventBus();
  bus.on(EVENT.ENTITY_DAMAGED, () => {
    throw new Error('listener bug');
  });
  assert.throws(() => bus.emit(EVENT.ENTITY_DAMAGED, {}), /listener bug/);
});

test('a listener can unsubscribe during dispatch without breaking the snapshot', () => {
  const bus = new EventBus();
  const order: string[] = [];
  let off = () => {};
  bus.on(EVENT.NOISE, () => {
    order.push('first');
    off();
  });
  // We capture a reference to the second listener so we can confirm it still
  // fired even though the first one removed itself mid-dispatch.
  off = bus.on(EVENT.NOISE, () => order.push('second'));
  bus.emit(EVENT.NOISE, {});
  assert.deepEqual(order, ['first', 'second']);
});
