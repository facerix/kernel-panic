/**
 * Shared base for mobile corp fodder that walks a patrol → investigate → engage
 * state machine:
 *
 *   patrol → investigate → engage
 *     ↑           ↑           │
 *     └───────────┴───────────┘
 *
 * - **patrol**: walk a fixed list of waypoints, looping. No waypoints → hold.
 * - **investigate**: A* toward the last known target position. On arrival
 *     without re-acquiring the target, lapse back to patrol.
 * - **engage**: target is in LOS + range. Subclasses decide *how* to engage
 *     (ranged fire + kite for `CorpDrone`, close + melee for `CorpGuard`) by
 *     implementing `engageSteps`. Losing the target drops to investigate with
 *     the last observed coordinates.
 *
 * Acquisition is line-of-sight only (`Hostile.acquireTarget`). The class owns
 * the noise/alarm subscriptions and the AP-draining turn loop with its safety
 * + spin guards; the *only* per-class difference is the ENGAGE behaviour, which
 * the loop delegates to `engageSteps`.
 *
 * `takeTurn(world, rng)` drains AP synchronously and returns a log of committed
 * actions. `takeTurnSteps` is the generator form — one yield per committed
 * action so the shell can paint + delay between yields (a unit that fires then
 * moves would otherwise leave its muzzle flash stranded on a vacated tile).
 */

import { Hostile, type HostileInit } from '../Hostile.js';
import { AP_COST, SIGHT_RANGE, moveStepApCost } from '../constants.js';
import type { TileId } from '../constants.js';
import { findPath } from '../Pathfinding.js';
import { withinRange } from '../LineOfSight.js';
import { EVENT } from '../events.js';
import type { EventBus } from '../events.js';
import type { Entity } from '../Entity.js';
import type {
  CorpDroneMoveKind,
  CorpDroneMoveStep,
  TurnActionStep,
  TurnActionSteps,
} from '../../types.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export const PATROL_STATE = Object.freeze({
  PATROL: 'patrol',
  INVESTIGATE: 'investigate',
  ENGAGE: 'engage',
});

export type PatrolState = (typeof PATROL_STATE)[keyof typeof PATROL_STATE];

/** Outcome a subclass `engageSteps` reports back to the main loop. */
export type EngageVerdict = 'continue' | 'break';
export type EngageSteps = Generator<TurnActionStep, EngageVerdict, undefined>;

type NoiseEventPayload = {
  origin?: { x: number; y: number };
  radius?: number;
  source?: Entity;
};

type AlarmEventPayload = {
  source?: Entity;
  target?: Entity;
  origin?: { x: number; y: number };
};

export interface PatrolHostileInit extends HostileInit {
  patrolWaypoints?: { x: number; y: number }[];
}

export abstract class PatrolHostile extends Hostile {
  patrolWaypoints: { x: number; y: number }[];
  patrolIndex: number;
  state: PatrolState;
  lastKnownTarget: { x: number; y: number } | null;
  #unsubs: (() => void)[];

  constructor({ patrolWaypoints, ...props }: PatrolHostileInit) {
    super(props);
    const waypoints = patrolWaypoints ?? [];
    if (!Array.isArray(waypoints)) {
      throw new TypeError(`${this.constructor.name} patrolWaypoints must be an array`);
    }
    for (const wp of waypoints) {
      if (!wp || !Number.isInteger(wp.x) || !Number.isInteger(wp.y)) {
        throw new TypeError(
          `${this.constructor.name} waypoint must be {x:int, y:int}, got ${JSON.stringify(wp)}`
        );
      }
    }
    this.patrolWaypoints = waypoints.map(wp => ({ x: wp.x, y: wp.y }));
    this.patrolIndex = 0;
    this.state = PATROL_STATE.PATROL;
    this.lastKnownTarget = null;
    this.#unsubs = [];
  }

  /**
   * Subscribe to an `EventBus`. Returns an unbind function so the harness can
   * detach a unit (e.g. on death, scenario reset) and free the listener.
   * Idempotent — calling twice subscribes twice; pair with `unbind`.
   */
  bindToBus(events: EventBus) {
    if (!events || typeof events.on !== 'function') {
      throw new TypeError(`${this.constructor.name}.bindToBus requires an EventBus`);
    }
    const offNoise = events.on(EVENT.NOISE, (payload: unknown) =>
      this.#onNoise(payload as NoiseEventPayload)
    );
    const offAlarm = events.on(EVENT.ALARM, (payload: unknown) =>
      this.#onAlarm(payload as AlarmEventPayload)
    );
    this.#unsubs.push(offNoise, offAlarm);
    return () => this.unbind();
  }

  unbind() {
    for (const off of this.#unsubs) off();
    this.#unsubs = [];
  }

  /**
   * Facility alarm — a CorpCivilian spotted the player. Units force-transition
   * to ENGAGE regardless of current state and point at the target's position.
   * This overrides even an existing ENGAGE target (fresh intel supersedes
   * stale pursuit data).
   */
  #onAlarm({ target }: AlarmEventPayload = {}) {
    if (!this.alive) return;
    if (!target || !Number.isInteger(target.x) || !Number.isInteger(target.y)) return;
    this.lastKnownTarget = { x: target.x, y: target.y };
    this.state = PATROL_STATE.ENGAGE;
  }

  #onNoise({ origin, radius, source }: NoiseEventPayload = {}) {
    if (!this.alive) return;
    if (!origin || !Number.isInteger(origin.x) || !Number.isInteger(origin.y)) return;
    // Engaging units are already on a live target — don't let a clatter pull
    // them off it. Patrolling and investigating units latch onto the noise.
    if (this.state === PATROL_STATE.ENGAGE) return;
    // Same-faction filter: don't investigate teammates' footsteps or our own
    // gunshots. (`source` may be absent on synthetic emits — be permissive.)
    if (source && source.faction === this.faction) return;
    // Range filter: hearing isn't omniscient. Default to SIGHT_RANGE for
    // legacy emits without a radius so older callers keep working.
    const r = Number.isFinite(radius) ? radius : SIGHT_RANGE;
    if (!withinRange(this.x, this.y, origin.x, origin.y, r!)) return;
    this.lastKnownTarget = { x: origin.x, y: origin.y };
    this.state = PATROL_STATE.INVESTIGATE;
  }

  /**
   * Spend AP until exhausted, dead, or stuck. Thin wrapper over `takeTurnSteps`
   * so synchronous callers (tests, debug harness) get the batched-log shape.
   */
  override takeTurn(world: World, rng: Rng): TurnActionStep[] {
    return [...this.takeTurnSteps(world, rng)];
  }

  /**
   * Generator form of the AI loop — yields one log entry per committed action
   * so the shell can `paint()` between yields. The ENGAGE branch is delegated
   * to `engageSteps`, which yields its own committed actions and returns a
   * verdict telling the loop whether to `continue` (re-loop) or `break`.
   */
  override *takeTurnSteps(world: World, rng: Rng): TurnActionSteps {
    if (!this.alive) return;

    // Bound the loop independently of AP — a logic bug that fails to spend AP
    // shouldn't lock the harness. With DEFAULT_AP=4 and per-action cost ≥1, 32
    // iterations is comfortably above any legitimate turn.
    let safety = 32;
    /**
     * Consecutive patrol iterations that advanced `patrolIndex` without
     * stepping. Reset by any productive action. If it exceeds the waypoint
     * count we've cycled the whole ring without burning AP, so we exit.
     */
    let patrolSpin = 0;
    while (this.alive && this.ap > 0 && safety-- > 0) {
      const target = this.acquireTarget(world);

      if (target) {
        // Out of patrol — any successful engage action breaks the spin.
        patrolSpin = 0;
        this.state = PATROL_STATE.ENGAGE;
        this.lastKnownTarget = { x: target.x, y: target.y };
        const verdict = yield* this.engageSteps(world, rng, target);
        if (verdict === 'break') break;
        continue;
      }

      // No live target visible.
      if (this.state === PATROL_STATE.ENGAGE && this.lastKnownTarget) {
        // Lost sight — pursue.
        this.state = PATROL_STATE.INVESTIGATE;
      }

      if (this.state === PATROL_STATE.INVESTIGATE && this.lastKnownTarget) {
        patrolSpin = 0;
        if (this.x === this.lastKnownTarget.x && this.y === this.lastKnownTarget.y) {
          // Reached the last known position empty-handed; resume patrol.
          this.lastKnownTarget = null;
          this.state = PATROL_STATE.PATROL;
          yield { type: 'investigate-cleared' };
          continue;
        }
        if (this.ap < AP_COST.MOVE) break;
        const step = this.stepToward(
          world,
          this.lastKnownTarget.x,
          this.lastKnownTarget.y,
          'investigate'
        );
        if (!step) {
          // Unreachable — give up the lead and patrol.
          this.lastKnownTarget = null;
          this.state = PATROL_STATE.PATROL;
          yield { type: 'investigate-abandoned' };
          continue;
        }
        yield step;
        continue;
      }

      // Patrol.
      if (this.patrolWaypoints.length === 0) break;
      const wp = this.patrolWaypoints[this.patrolIndex];
      if (this.x === wp.x && this.y === wp.y) {
        // Co-located with the current waypoint — tick to the next one. Costs no
        // AP, so we count it as a "spin" and exit once we've gone full ring
        // without a productive step.
        this.patrolIndex = (this.patrolIndex + 1) % this.patrolWaypoints.length;
        patrolSpin += 1;
        if (patrolSpin > this.patrolWaypoints.length) break;
        yield { type: 'patrol-arrived', waypoint: wp };
        continue;
      }
      if (this.ap < AP_COST.MOVE) break;
      const step = this.stepToward(world, wp.x, wp.y, 'patrol');
      if (!step) {
        // Skip this waypoint — likely temporarily blocked. Same spin guard as
        // patrol-arrived: if every waypoint in the ring is unreachable from
        // where we stand, stop trying this turn.
        this.patrolIndex = (this.patrolIndex + 1) % this.patrolWaypoints.length;
        patrolSpin += 1;
        if (patrolSpin > this.patrolWaypoints.length) break;
        yield { type: 'patrol-skipped', waypoint: wp };
        continue;
      }
      // Real step taken — reset the spin counter so the next turn can cycle
      // waypoints again.
      patrolSpin = 0;
      yield step;
    }

    if (safety <= 0) {
      // Defensive: this is the bug-class we explicitly guarded against, so
      // crash rather than ship a quietly-stuck unit.
      throw new Error(`${this.constructor.name} ${this.id} exceeded turn iteration cap`);
    }
  }

  /**
   * ENGAGE behaviour. Yields one committed action per yield (a shot, a swing,
   * a step) and returns a verdict: `'continue'` to re-enter the main loop,
   * `'break'` to end the turn. Implementations must respect AP and never
   * commit an illegal action.
   */
  protected abstract engageSteps(world: World, rng: Rng, target: Entity): EngageSteps;

  /**
   * Step one tile along an A* path toward `(gx, gy)`. Returns the move step on
   * success, or `null` when there's no path / not enough AP / the move is
   * illegal. `protected` so subclass engage logic can close distance.
   */
  protected stepToward(
    world: World,
    gx: number,
    gy: number,
    kind: CorpDroneMoveKind
  ): CorpDroneMoveStep | null {
    const path = findPath(world, { x: this.x, y: this.y }, { x: gx, y: gy });
    if (!path || path.length === 0) return null;
    const next = path[0];
    const stepCost = moveStepApCost(world.grid.tileAt(next.x, next.y) as TileId);
    if (this.ap < stepCost) return null;
    const dx = next.x - this.x;
    const dy = next.y - this.y;
    const check = world.canMoveEntity(this, dx, dy);
    if (!check.ok) return null;
    world.moveEntity(this, dx, dy);
    return { type: `move-${kind}`, to: { x: this.x, y: this.y } } satisfies CorpDroneMoveStep;
  }
}
