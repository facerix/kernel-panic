/**
 * Tiny synchronous pub/sub bus. Lives at the seam between game-state mutators
 * (`World.moveEntity`, `Combat.resolveRanged`, `TurnQueue.endTurn`) and the
 * subscribers that react to them — AI, vision recompute, future UI.
 *
 * Why a bus and not direct calls?
 *   - Drones investigate noise without being wired into Combat.
 *   - The harness recomputes player vision when *any* corp entity moves, not
 *     only on player input.
 *   - Telemetry (kill log, run summary) can subscribe without the gameplay
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
  ALARM: 'alarm',
  ALARM_CHANGED: 'alarm:changed',
  CIVILIAN_HARMED: 'civilian:harmed',
  REP_CHANGED: 'rep:changed',
  HAZARD_DAMAGE: 'hazard:damage',
  OBJECTIVE_TIMER_EXPIRED: 'objective:timer-expired',
  DOOR_UNLOCKED: 'door:unlocked',
});

const KNOWN_TYPES = new Set<string>(Object.values(EVENT));

/**
 * Discriminator on the `ALARM` event payload (P2.7.M3.1). Both kinds force
 * subscribed patrol hostiles to ENGAGE on the shared target, but they differ in
 * provenance and side effects:
 *
 *   - **`facility`** — the building noticed you. Emitted by `World.raiseAlarm()`
 *     (CorpCivilian / terminal). Latches the facility alarm cadence. Callers
 *     set `repPenalty` on the payload (CorpCivilian default true; combat
 *     terminals false). Default kind for legacy emits that omit one.
 *   - **`lookout`** — a `Lookout` is calling fire on you *right now*. Emitted
 *     directly on the bus, every corp turn it holds LOS. No facility latch, no
 *     Rep penalty — kill the lookout or break its sight to stop the pings.
 */
export const ALARM_KIND = Object.freeze({
  FACILITY: 'facility',
  LOOKOUT: 'lookout',
});

export type AlarmKind = (typeof ALARM_KIND)[keyof typeof ALARM_KIND];

/**
 * Whether an `ALARM` payload should apply `REP.ALARM_PENALTY`. Reads the
 * explicit `repPenalty` flag set by `World.raiseAlarm()` callers. Lookout
 * pings never adjust Rep. Legacy payloads that omit `repPenalty` penalize.
 */
export function alarmPayloadTriggersRepPenalty(payload: unknown): boolean {
  if (payload == null || typeof payload !== 'object') return true;
  const record = payload as { kind?: string; repPenalty?: boolean };
  if (record.kind === ALARM_KIND.LOOKOUT) return false;
  if (record.repPenalty === false) return false;
  return record.kind === undefined || record.kind === ALARM_KIND.FACILITY;
}

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
