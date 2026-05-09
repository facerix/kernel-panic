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
 * `takeTurn(world, rng)` drains the drone's AP. The loop has explicit exit
 * conditions for every "we can't make progress" branch (no path, no AP, dead)
 * so a stuck drone returns rather than spinning.
 */

import { Entity } from '../Entity.js';
import { FACTION, AP_COST, SIGHT_RANGE } from '../constants.js';
import { findPath } from '../Pathfinding.js';
import { hasLineOfSight, withinRange } from '../LineOfSight.js';
import { canFireRanged, resolveRanged } from '../Combat.js';
import { EVENT } from '../events.js';

export const DRONE_STATE = Object.freeze({
  PATROL: 'patrol',
  INVESTIGATE: 'investigate',
  ENGAGE: 'engage',
});

export class CorpDrone extends Entity {
  constructor(props = {}) {
    super({ faction: FACTION.CORP, glyph: 'd', ...props });
    const waypoints = props.patrolWaypoints ?? [];
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

  /** @type {Array<() => void>} */
  #unsubs;

  /**
   * Subscribe the drone to an `EventBus`. Returns an unbind function so the
   * harness can detach a drone (e.g. on death, scenario reset) and free the
   * listener. Idempotent — calling twice subscribes twice; pair with `unbind`.
   */
  bindToBus(events) {
    if (!events || typeof events.on !== 'function') {
      throw new TypeError('CorpDrone.bindToBus requires an EventBus');
    }
    const off = events.on(EVENT.NOISE, payload => this.#onNoise(payload));
    this.#unsubs.push(off);
    return () => this.unbind();
  }

  unbind() {
    for (const off of this.#unsubs) off();
    this.#unsubs = [];
  }

  #onNoise({ origin, radius, source } = {}) {
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
    if (!withinRange(this.x, this.y, origin.x, origin.y, r)) return;
    this.lastKnownTarget = { x: origin.x, y: origin.y };
    this.state = DRONE_STATE.INVESTIGATE;
  }

  /**
   * Acquire the closest visible hostile (different faction). Squared-distance
   * comparison — no `Math.sqrt` needed. Returns `null` if nothing visible.
   */
  acquireTarget(world) {
    const blockers = world.blockerKeys();
    let best = null;
    let bestD2 = Infinity;
    for (const e of world.entities.values()) {
      if (!e.alive || e.faction === this.faction) continue;
      if (!withinRange(this.x, this.y, e.x, e.y, SIGHT_RANGE)) continue;
      if (!hasLineOfSight(world.grid, this.x, this.y, e.x, e.y, { blockers })) continue;
      // Stealth gate (M6 Razor Slide). The Razor's perk sets `stealthed=true`
      // for the duration of the corp turn following her slide; while it's set
      // she requires Chebyshev adjacency to be acquired. Generic on Entity so
      // future cyberware can flip the same flag.
      if (typeof e.isSpottableBy === 'function' && !e.isSpottableBy(this)) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  /**
   * Spend AP until exhausted, dead, or stuck. Returns a log of actions taken
   * this turn — useful for the harness display and for tests that want to
   * assert behaviour without poking at internal state.
   */
  takeTurn(world, rng) {
    /** @type {Array<object>} */
    const log = [];
    if (!this.alive) return log;

    // Bound the loop independently of AP — a logic bug that fails to spend
    // AP shouldn't lock the harness. With DEFAULT_AP=4 and per-action cost ≥1,
    // 32 iterations is comfortably above any legitimate turn.
    let safety = 32;
    while (this.alive && this.ap > 0 && safety-- > 0) {
      const target = this.acquireTarget(world);

      if (target) {
        this.state = DRONE_STATE.ENGAGE;
        this.lastKnownTarget = { x: target.x, y: target.y };
        const fireCheck = canFireRanged(world, this, target);
        if (fireCheck.ok) {
          const result = resolveRanged(world, this, target, rng);
          log.push({ type: 'fire', target: target.id, result });
          continue;
        }
        if (fireCheck.reason !== 'insufficient-ap') {
          // Some other reason (out-of-range from a different `range` option,
          // same-faction edge case) — should be rare at this layer. Stop
          // rather than thrash; surfacing the state in the log helps debug.
          log.push({ type: 'fire-blocked', reason: fireCheck.reason });
          break;
        }
        // We have AP but not enough to fire — try to step toward to set up
        // for next turn.
        if (this.ap < AP_COST.MOVE) break;
        const stepped = this.#stepToward(world, target.x, target.y, log, 'engage');
        if (!stepped) break;
        continue;
      }

      // No live target visible.
      if (this.state === DRONE_STATE.ENGAGE && this.lastKnownTarget) {
        // Lost sight — pursue.
        this.state = DRONE_STATE.INVESTIGATE;
      }

      if (this.state === DRONE_STATE.INVESTIGATE && this.lastKnownTarget) {
        if (this.x === this.lastKnownTarget.x && this.y === this.lastKnownTarget.y) {
          // Reached the last known position empty-handed; resume patrol.
          this.lastKnownTarget = null;
          this.state = DRONE_STATE.PATROL;
          log.push({ type: 'investigate-cleared' });
          continue;
        }
        if (this.ap < AP_COST.MOVE) break;
        const stepped = this.#stepToward(
          world,
          this.lastKnownTarget.x,
          this.lastKnownTarget.y,
          log,
          'investigate'
        );
        if (!stepped) {
          // Unreachable — give up the lead and patrol.
          this.lastKnownTarget = null;
          this.state = DRONE_STATE.PATROL;
          log.push({ type: 'investigate-abandoned' });
          continue;
        }
        continue;
      }

      // Patrol.
      if (this.patrolWaypoints.length === 0) break;
      const wp = this.patrolWaypoints[this.patrolIndex];
      if (this.x === wp.x && this.y === wp.y) {
        this.patrolIndex = (this.patrolIndex + 1) % this.patrolWaypoints.length;
        log.push({ type: 'patrol-arrived', waypoint: wp });
        continue;
      }
      if (this.ap < AP_COST.MOVE) break;
      const stepped = this.#stepToward(world, wp.x, wp.y, log, 'patrol');
      if (!stepped) {
        // Skip this waypoint — likely temporarily blocked. Picks back up
        // next turn at the next one.
        this.patrolIndex = (this.patrolIndex + 1) % this.patrolWaypoints.length;
        log.push({ type: 'patrol-skipped', waypoint: wp });
        continue;
      }
    }

    if (safety <= 0) {
      // Defensive: this is the bug-class we explicitly guarded against, so
      // crash rather than ship a quietly-stuck drone.
      throw new Error(`CorpDrone ${this.id} exceeded turn iteration cap`);
    }
    return log;
  }

  #stepToward(world, gx, gy, log, kind) {
    const path = findPath(world, { x: this.x, y: this.y }, { x: gx, y: gy });
    if (!path || path.length === 0) return false;
    const next = path[0];
    const dx = next.x - this.x;
    const dy = next.y - this.y;
    const check = world.canMoveEntity(this, dx, dy);
    if (!check.ok) return false;
    world.moveEntity(this, dx, dy);
    log.push({ type: `move-${kind}`, to: { x: this.x, y: this.y } });
    return true;
  }
}
