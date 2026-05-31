/**
 * Corp drone — the M5 ranged threat. A small state machine over three modes:
 *
 *   patrol → investigate → engage
 *     ↑           ↑           │
 *     └───────────┴───────────┘
 *
 * - **patrol**: walk a fixed list of waypoints, looping. No waypoints → hold.
 * - **investigate**: A* toward the last known target position. On arrival
 *     without re-acquiring the target, lapse back to patrol.
 * - **engage**: target is in LOS + range. Fire if AP allows; otherwise close
 *     the distance one step. Losing LOS drops to investigate with the last
 *     observed coordinates.
 *
 * Acquisition is line-of-sight only (Combat already shares the geometry via
 * `withinRange` + `hasLineOfSight`, so an "I see you" hand-off to fire-resolution
 * can never disagree with itself). Hearing arrives in M6 with the noise model;
 * for now the drone subscribes to `noise` events and uses the origin as the
 * investigate target — the wiring is ready, the emitters land later.
 *
 * `takeTurn(world, rng)` drains the drone's AP synchronously and returns a
 * log of every committed action. Internally it iterates `takeTurnSteps`, a
 * generator that yields one log entry per committed action — exposed
 * separately so the game shell can interleave a paint + delay between each
 * yield (drones that fire then move would otherwise leave the muzzle flash
 * stranded at a tile the drone has already vacated).
 *
 * The loop has explicit exit conditions for every "we can't make progress"
 * branch (no path, no AP, dead) so a stuck drone returns rather than spinning.
 */

import { Hostile } from '../Hostile.js';
import {
  FACTION,
  AP_COST,
  SIGHT_RANGE,
  moveStepApCost,
  ENEMY_ROLE,
  ENEMY_TIER,
  resolveEnemyStats,
} from '../constants.js';
import type { EnemyTier, TileId } from '../constants.js';
import { findPath } from '../Pathfinding.js';
import { withinRange } from '../LineOfSight.js';
import { canFireRanged, resolveRanged } from '../Combat.js';
import { EVENT } from '../events.js';
import type { EventBus } from '../events.js';
import type { Entity } from '../Entity.js';
import type { HostileInit } from '../Hostile.js';
import type {
  CorpDroneMoveKind,
  CorpDroneMoveStep,
  TurnActionStep,
  TurnActionSteps,
} from '../../types.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export const DRONE_STATE = Object.freeze({
  PATROL: 'patrol',
  INVESTIGATE: 'investigate',
  ENGAGE: 'engage',
});

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

export interface CorpDroneProps extends Omit<HostileInit, 'faction' | 'glyph'> {
  patrolWaypoints?: { x: number; y: number }[];
  tier?: EnemyTier;
}

export class CorpDrone extends Hostile {
  patrolWaypoints: { x: number; y: number }[];
  patrolIndex: number;
  state: (typeof DRONE_STATE)[keyof typeof DRONE_STATE];
  lastKnownTarget: { x: number; y: number } | null;
  #unsubs: (() => void)[];

  constructor({ tier = ENEMY_TIER.T1, patrolWaypoints, ...props }: CorpDroneProps) {
    const stats = resolveEnemyStats(props, ENEMY_ROLE.FODDER, tier);
    super({ ...props, ...stats, faction: FACTION.CORP, glyph: 'd' });
    const waypoints = patrolWaypoints ?? [];
    if (!Array.isArray(waypoints)) {
      throw new TypeError('CorpDrone patrolWaypoints must be an array');
    }
    for (const wp of waypoints) {
      if (!wp || !Number.isInteger(wp.x) || !Number.isInteger(wp.y)) {
        throw new TypeError(`CorpDrone waypoint must be {x:int, y:int}, got ${JSON.stringify(wp)}`);
      }
    }
    this.patrolWaypoints = waypoints.map(wp => ({ x: wp.x, y: wp.y }));
    this.patrolIndex = 0;
    this.state = DRONE_STATE.PATROL;
    /** @type {{ x: number, y: number } | null} */
    this.lastKnownTarget = null;
    /** @type {Array<() => void>} */
    this.#unsubs = [];
  }

  /**
   * Subscribe the drone to an `EventBus`. Returns an unbind function so the
   * harness can detach a drone (e.g. on death, scenario reset) and free the
   * listener. Idempotent — calling twice subscribes twice; pair with `unbind`.
   */
  bindToBus(events: EventBus) {
    if (!events || typeof events.on !== 'function') {
      throw new TypeError('CorpDrone.bindToBus requires an EventBus');
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
   * Facility alarm — a CorpCivilian spotted the player. All drones force-
   * transition to ENGAGE regardless of current state and point at the
   * target's position. This overrides even an existing ENGAGE target
   * (fresh intel from a spotter supersedes stale pursuit data).
   */
  #onAlarm({ target }: AlarmEventPayload = {}) {
    if (!this.alive) return;
    if (!target || !Number.isInteger(target.x) || !Number.isInteger(target.y)) return;
    this.lastKnownTarget = { x: target.x, y: target.y };
    this.state = DRONE_STATE.ENGAGE;
  }

  #onNoise({ origin, radius, source }: NoiseEventPayload = {}) {
    if (!this.alive) return;
    if (!origin || !Number.isInteger(origin.x) || !Number.isInteger(origin.y)) return;
    // Engaging drones are already firing — don't let a clatter pull them off
    // a live target. Patrolling and investigating drones latch onto the noise.
    if (this.state === DRONE_STATE.ENGAGE) return;
    // Same-faction filter: don't investigate your own teammates' footsteps
    // or your own gunshots. M6 wires `World.moveEntity` to emit movement noise
    // unconditionally, so without this every drone step would ping every
    // other drone. (`source` may be absent on synthetic emits — be permissive.)
    if (source && source.faction === this.faction) return;
    // Range filter: hearing isn't omniscient. Noise carries `radius` and we
    // only react if we're inside it. Default to SIGHT_RANGE for legacy emits
    // that don't carry a radius, so older callers keep working.
    const r = Number.isFinite(radius) ? radius : SIGHT_RANGE;
    if (!withinRange(this.x, this.y, origin.x, origin.y, r!)) return;
    this.lastKnownTarget = { x: origin.x, y: origin.y };
    this.state = DRONE_STATE.INVESTIGATE;
  }

  /**
   * Spend AP until exhausted, dead, or stuck. Returns a log of actions taken
   * this turn — useful for the harness display and for tests that want to
   * assert behaviour without poking at internal state.
   *
   * Thin wrapper around `takeTurnSteps` so callers that don't need per-action
   * interleaving (tests, the debug harness, anything synchronous) get the
   * familiar batched-log shape unchanged.
   */
  override takeTurn(world: World, rng: Rng): TurnActionStep[] {
    return [...this.takeTurnSteps(world, rng)];
  }

  /**
   * Generator form of the AI loop — yields one log entry per committed
   * action so the shell can `paint()` between yields. Each yield represents
   * a discrete world mutation (a shot fired, a step taken, a waypoint
   * advanced); state transitions that don't mutate the world (e.g. ENGAGE
   * → INVESTIGATE on losing LOS) are folded into the next yielded action.
   */
  override *takeTurnSteps(world: World, rng: Rng): TurnActionSteps {
    if (!this.alive) return;

    // Bound the loop independently of AP — a logic bug that fails to spend
    // AP shouldn't lock the harness. With DEFAULT_AP=4 and per-action cost ≥1,
    // 32 iterations is comfortably above any legitimate turn.
    let safety = 32;
    /**
     * Consecutive patrol iterations that advanced `patrolIndex` without
     * actually stepping (`patrol-arrived` on a co-located waypoint, or
     * `patrol-skipped` on an unreachable one). Reset by any productive
     * action — fire, move, or a state transition out of patrol. If it
     * exceeds the waypoint count we've cycled the whole ring without
     * burning AP, so further iterations would just repeat the cycle.
     * This is what hits the iteration cap when several waypoints are
     * unreachable from the drone's current position.
     */
    let patrolSpin = 0;
    while (this.alive && this.ap > 0 && safety-- > 0) {
      const target = this.acquireTarget(world);

      if (target) {
        // Out of patrol — any successful engage action breaks the spin.
        patrolSpin = 0;
        this.state = DRONE_STATE.ENGAGE;
        this.lastKnownTarget = { x: target.x, y: target.y };
        // Fire at sight range: `acquireTarget` qualifies targets by
        // `this.sightRange`, so the fire check must use the same range or a
        // long-sighted drone could see a target it can never shoot.
        const fireCheck = canFireRanged(world, this, target, { range: this.sightRange });
        if (fireCheck.ok) {
          const result = resolveRanged(world, this, target, rng, { range: this.sightRange });
          yield { type: 'fire', target: target.id, result };
          continue;
        }
        if (fireCheck.reason !== 'insufficient-ap') {
          // Some other reason (out-of-range from a different `range` option,
          // same-faction edge case) — should be rare at this layer. Stop
          // rather than thrash; surfacing the state in the log helps debug.
          yield { type: 'fire-blocked', reason: fireCheck.reason ?? 'unknown' };
          break;
        }
        // We have AP but not enough to fire — try to step toward to set up
        // for next turn.
        if (this.ap < AP_COST.MOVE) break;
        const step = this.#stepToward(world, target.x, target.y, 'engage');
        if (!step) break;
        yield step;
        continue;
      }

      // No live target visible.
      if (this.state === DRONE_STATE.ENGAGE && this.lastKnownTarget) {
        // Lost sight — pursue.
        this.state = DRONE_STATE.INVESTIGATE;
      }

      if (this.state === DRONE_STATE.INVESTIGATE && this.lastKnownTarget) {
        patrolSpin = 0;
        if (this.x === this.lastKnownTarget.x && this.y === this.lastKnownTarget.y) {
          // Reached the last known position empty-handed; resume patrol.
          this.lastKnownTarget = null;
          this.state = DRONE_STATE.PATROL;
          yield { type: 'investigate-cleared' };
          continue;
        }
        if (this.ap < AP_COST.MOVE) break;
        const step = this.#stepToward(
          world,
          this.lastKnownTarget.x,
          this.lastKnownTarget.y,
          'investigate'
        );
        if (!step) {
          // Unreachable — give up the lead and patrol.
          this.lastKnownTarget = null;
          this.state = DRONE_STATE.PATROL;
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
        // Co-located with the current waypoint — tick to the next one. This
        // costs no AP, so we count it as a "spin" and exit once we've gone
        // full ring without a productive step (prevents an N-way ring of
        // co-located waypoints from spinning until safety crashes).
        this.patrolIndex = (this.patrolIndex + 1) % this.patrolWaypoints.length;
        patrolSpin += 1;
        if (patrolSpin > this.patrolWaypoints.length) break;
        yield { type: 'patrol-arrived', waypoint: wp };
        continue;
      }
      if (this.ap < AP_COST.MOVE) break;
      const step = this.#stepToward(world, wp.x, wp.y, 'patrol');
      if (!step) {
        // Skip this waypoint — likely temporarily blocked. Same spin
        // guard as patrol-arrived: if every waypoint in the ring is
        // unreachable from where we stand, stop trying this turn.
        this.patrolIndex = (this.patrolIndex + 1) % this.patrolWaypoints.length;
        patrolSpin += 1;
        if (patrolSpin > this.patrolWaypoints.length) break;
        yield { type: 'patrol-skipped', waypoint: wp };
        continue;
      }
      // Real step taken — reset the spin counter so the next turn can
      // cycle waypoints again.
      patrolSpin = 0;
      yield step;
    }

    if (safety <= 0) {
      // Defensive: this is the bug-class we explicitly guarded against, so
      // crash rather than ship a quietly-stuck drone.
      throw new Error(`CorpDrone ${this.id} exceeded turn iteration cap`);
    }
  }

  #stepToward(
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
