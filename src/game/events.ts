/**
 * Tiny synchronous pub/sub bus. Lives at the seam between game-state mutators
 * (`World.moveEntity`, `Combat.resolveRanged`, `TurnQueue.endTurn`) and the
 * subscribers that react to them — AI, vision recompute, future UI.
 *
 * Why a bus and not direct calls?
 *   - Drones investigate noise without being wired into Combat.
 *   - The harness recomputes player vision when *any* corp entity moves, not
 *     only on player input. (Closes the M4 deferred fix.)
 *   - M7 telemetry (kill log, run summary) can subscribe without the gameplay
 *     code knowing.
 *
 * Design rules:
 *   - **Known-types only.** `emit`/`on`/`off` for an unregistered type throw.
 *     Typo'd event names are exactly the silent-fallback bug class we want
 *     surfaced loudly.
 *   - **Synchronous, registration-order dispatch.** No async, no batching.
 *   - **Listener exceptions propagate.** A buggy listener should crash the
 *     turn, not corrupt downstream state. Per the project standard.
 *   - **Safe to unsubscribe during emit.** We snapshot the listener set per
 *     dispatch, so an `off()` call mid-emit affects the *next* emission.
 */

export const EVENT = Object.freeze({
  ENTITY_MOVED: 'entity:moved',
  ENTITY_DAMAGED: 'entity:damaged',
  NOISE: 'noise',
  TURN_ENDED: 'turn:ended',
});

const KNOWN_TYPES = new Set<string>(Object.values(EVENT));

export type EventType = (typeof EVENT)[keyof typeof EVENT];
export type EventListener = (payload?: unknown) => void;

function assertKnownType(type: string): void {
  if (!KNOWN_TYPES.has(type)) {
    throw new Error(`Unknown event type: ${type}`);
  }
}

export class EventBus {
  listeners: Map<string, Set<EventListener>> = new Map();

  /**
   * Subscribe `fn` to `type`. Returns an unsubscribe function so callers can
   * `const off = bus.on(...)`; the same `fn` reference can also be passed to
   * `off(type, fn)`.
   */
  on(type: string, fn: EventListener): () => void {
    assertKnownType(type);
    if (typeof fn !== 'function') {
      throw new TypeError('EventBus.on requires a function listener');
    }
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => this.off(type, fn);
  }

  off(type: string, fn: EventListener): void {
    assertKnownType(type);
    const set = this.listeners.get(type);
    if (set) set.delete(fn);
  }

  /**
   * Synchronously dispatch `payload` to every listener registered for `type`,
   * in registration order. Snapshots the listener set first so an unsubscribe
   * during dispatch is safe (it takes effect on the next emit, not this one).
   */
  emit(type: string, payload?: unknown): void {
    assertKnownType(type);
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    // Snapshot — listeners may add/remove during dispatch.
    const snapshot = [...set];
    for (const fn of snapshot) {
      fn(payload);
    }
  }
}
