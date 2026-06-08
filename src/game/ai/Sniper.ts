/**
 * Tier-2 **Sniper** — a long-range, telegraphed specialist. Unlike the Lookout
 * (which coordinates fodder via `ALARM` pings), the sniper is a *self-contained
 * personal threat*: break its line of sight, close the distance, or eat a heavy
 * guaranteed shot. It has no ally force-multiplier.
 *
 * The signature is the **cross-turn telegraph**:
 *
 *   corp turn N  → commit aim (2 AP, `aimTargetId` set, `aim` step, no NOISE)
 *   player turn  → full counterplay window (sniper is stationary, holding aim)
 *   corp turn N+1 → fire (guaranteed hit, `SNIPER_DAMAGE`) *or* cancel if the
 *                   shot is no longer valid (target dead / out of range / LOS
 *                   broken / re-stealthed). Leftover AP → reposition.
 *
 * Other identity rules (see phase-2.7-plan.md → M3.2):
 *  - **`Sniper extends PatrolHostile`** — shares the patrol/investigate/engage
 *    shell. `takeTurnSteps` runs a fire-or-cancel preamble *before* the normal
 *    loop so a held shot resolves even when live LOS is gone.
 *  - **Reposition mirror** of the skirmisher kite (`preferredMin`): retreat when
 *    a target closes inside the band, then aim from range. Never melees.
 *  - **Vantage pathing** (Lookout mirror): investigate and blocked-engage seek
 *    the farthest tile that restores LOS — never blindly close on the lead like
 *    fodder. Out-of-range approach still closes, but picks the farthest in-range
 *    step. No vantage → hold or abandon the lead, don't charge.
 *  - **Damage breaks aim** — any HP loss while `aimTargetId` is set clears the
 *    pending shot, rewarding focus-fire during the telegraph window.
 *  - **Guaranteed fire** — the committed shot uses `baseHit: 1` and zero cover
 *    penalty, so the player must *prevent* it (break LOS / kill the sniper),
 *    not pray for a miss.
 *
 * Player-perception range conceal (glyph hide, crosshair overlay, anonymous
 * log copy) is a renderer/targeting concern handled outside this class.
 */

import {
  PatrolHostile,
  type PatrolHostileInit,
  type EngageSteps,
  type PatrolSnapshot,
} from './PatrolHostile.js';
import {
  AP_COST,
  PREFERRED_MIN,
  ENEMY_ROLE,
  ENEMY_TIER,
  SNIPER_SIGHT_RANGE,
  SNIPER_DAMAGE,
  resolveEnemyStats,
} from '../constants.js';
import type { EnemyTier } from '../constants.js';
import { withinRange, hasLineOfSight } from '../LineOfSight.js';
import { canFireRanged, resolveRanged } from '../Combat.js';
import { EVENT } from '../events.js';
import type { EventBus } from '../events.js';
import type { Entity } from '../Entity.js';
import type {
  PatrolHostileMoveKind,
  PatrolHostileMoveStep,
  TurnActionStep,
  TurnActionSteps,
} from '../../types.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export interface SniperProps extends Omit<PatrolHostileInit, 'glyph'> {
  tier?: EnemyTier;
  /** Kiting band override — reposition when a target closes within `preferredMin`. */
  preferredMin?: number;
}

/** P2.7.M6.2: Sniper snapshot `extra` — the patrol block plus its held-aim target. */
export type SniperSnapshot = PatrolSnapshot & { aimTargetId: string | null };

type DamageEventPayload = { target?: Entity };

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]);

export class Sniper extends PatrolHostile {
  preferredMin: number;
  /** Id of the target this sniper is holding a committed shot on, or `null`. */
  aimTargetId: string | null;
  #damageUnsub: (() => void) | null;

  constructor({
    tier = ENEMY_TIER.T2,
    preferredMin,
    sightRange = SNIPER_SIGHT_RANGE,
    patrolWaypoints,
    ...props
  }: SniperProps) {
    const stats = resolveEnemyStats(props, ENEMY_ROLE.SPECIALIST, tier);
    super({ ...props, ...stats, sightRange, glyph: 's', patrolWaypoints });
    const band = preferredMin ?? PREFERRED_MIN;
    if (!Number.isInteger(band) || band < 0) {
      throw new RangeError(`Sniper preferredMin must be a non-negative integer, got ${band}`);
    }
    this.preferredMin = band;
    this.aimTargetId = null;
    this.#damageUnsub = null;
  }

  /**
   * Subscribe to the patrol noise/alarm bus *and* to `ENTITY_DAMAGED` so a hit
   * during the telegraph window can break the held shot. Returns the standard
   * unbind closure.
   */
  override bindToBus(events: EventBus) {
    super.bindToBus(events);
    this.#damageUnsub = events.on(EVENT.ENTITY_DAMAGED, (payload: unknown) =>
      this.#onDamaged(payload as DamageEventPayload)
    );
    return () => this.unbind();
  }

  override unbind() {
    super.unbind();
    if (this.#damageUnsub) {
      this.#damageUnsub();
      this.#damageUnsub = null;
    }
  }

  /** Any damage taken while holding aim breaks the shot — rewards focus fire. */
  #onDamaged({ target }: DamageEventPayload = {}) {
    if (target === this && this.aimTargetId) this.aimTargetId = null;
  }

  /**
   * Fire-or-cancel preamble, then the normal patrol loop. A held shot resolves
   * first (it must fire-or-cancel even with no live LOS); on a fired shot the
   * sniper repositions with leftover AP rather than re-aiming the same turn.
   */
  override *takeTurnSteps(world: World, rng: Rng): TurnActionSteps {
    if (!this.alive) return;
    if (this.aimTargetId) {
      const fired = yield* this.#resolveAim(world, rng);
      if (fired) {
        yield* this.#repositionSteps(world);
        return;
      }
      // Cancelled — fall through to normal AI with whatever AP remains.
    }
    yield* super.takeTurnSteps(world, rng);
  }

  /**
   * Lost LOS: seek the farthest tile that *restores* sight to the lead — same
   * vantage hunt as the Lookout. Unlike fodder, never blindly closes on the
   * coordinate; if no neighbour regains LOS, abandon the lead.
   */
  protected override investigateStep(
    world: World,
    gx: number,
    gy: number
  ): PatrolHostileMoveStep | null {
    return this.#stepToVantage(world, gx, gy, {
      liveTarget: null,
      requireFarther: false,
      kind: 'investigate',
    });
  }

  /**
   * Engage with no pending aim: kite if the target is inside `preferredMin`,
   * else commit aim when in range + LOS + spottable, else reposition for a
   * shot (farthest in-range step when out of range; vantage hunt when blocked).
   * Aim commit costs 2 AP and ends the turn (`'break'`).
   */
  protected override *engageSteps(world: World, _rng: Rng, target: Entity): EngageSteps {
    const cheb = Math.max(Math.abs(target.x - this.x), Math.abs(target.y - this.y));
    if (cheb < this.preferredMin && this.ap >= AP_COST.MOVE) {
      const retreat = this.#stepAwayFrom(world, target);
      if (retreat) {
        yield retreat;
        return 'continue';
      }
    }

    const fireCheck = canFireRanged(world, this, target, { range: this.sightRange });
    if (fireCheck.ok && target.isSpottableBy(this)) {
      this.spendAp(AP_COST.RANGED_ATTACK);
      this.aimTargetId = target.id;
      yield { type: 'aim', target: target.id };
      return 'break';
    }
    if (fireCheck.reason === 'insufficient-ap' || this.ap < AP_COST.MOVE) return 'break';

    let step: PatrolHostileMoveStep | null = null;
    if (fireCheck.reason === 'out-of-range') {
      step = this.#stepIntoRange(world, target);
    } else {
      step = this.#stepToVantage(world, target.x, target.y, {
        liveTarget: target,
        requireFarther: false,
        kind: 'engage',
      });
    }
    if (!step) return 'break';
    yield step;
    return 'continue';
  }

  /**
   * Resolve a committed shot. Fires (guaranteed hit, heavy damage) when still
   * valid, else cancels with a reason. Clears `aimTargetId` either way. Returns
   * `true` when a shot was fired so the caller can reposition with leftover AP.
   */
  *#resolveAim(world: World, rng: Rng): Generator<TurnActionStep, boolean, undefined> {
    const target = this.aimTargetId ? (world.entities.get(this.aimTargetId) ?? null) : null;
    const reason = this.#aimInvalidReason(world, target);
    if (reason || !target) {
      this.aimTargetId = null;
      yield { type: 'aim-cancelled', reason: reason ?? 'target-lost' };
      return false;
    }
    // Guaranteed hit: baseHit 1 with zero cover penalty. The shot still debits
    // AP and emits ranged NOISE via resolveRanged (the muzzle report is loud);
    // only the *aim* telegraph is silent.
    const result = resolveRanged(world, this, target, rng, {
      range: SNIPER_SIGHT_RANGE,
      damage: SNIPER_DAMAGE,
      baseHit: 1,
      coverPenalty: 0,
    });
    this.aimTargetId = null;
    yield { type: 'fire', target: target.id, result };
    return true;
  }

  #aimInvalidReason(world: World, target: Entity | null): string | null {
    if (!target || !target.alive) return 'target-lost';
    const check = canFireRanged(world, this, target, { range: SNIPER_SIGHT_RANGE });
    if (!check.ok) return check.reason ?? 'blocked';
    // Hostile stealth rules: a target that re-cloaked (Razor SLIDE) beyond
    // Chebyshev 1 voids the held shot.
    if (!target.isSpottableBy(this)) return 'concealed-target';
    return null;
  }

  /**
   * After firing, spend leftover AP repositioning: kite if the target closed
   * inside `preferredMin`, otherwise hold (never re-aim the same turn — the
   * telegraph window is the whole point).
   */
  *#repositionSteps(world: World): Generator<TurnActionStep, void, undefined> {
    let safety = 8;
    while (this.alive && this.ap >= AP_COST.MOVE && safety-- > 0) {
      const target = this.acquireTarget(world);
      if (!target) break;
      const cheb = Math.max(Math.abs(target.x - this.x), Math.abs(target.y - this.y));
      if (cheb >= this.preferredMin) break;
      const retreat = this.#stepAwayFrom(world, target);
      if (!retreat) break;
      yield retreat;
    }
  }

  /** Skirmisher-kite mirror: step to the farthest legal neighbour holding LOS. */
  #stepAwayFrom(world: World, target: Entity): PatrolHostileMoveStep | null {
    return this.#stepToVantage(world, target.x, target.y, {
      liveTarget: target,
      requireFarther: true,
      kind: 'engage',
    });
  }

  /**
   * One step into fire range when currently out of range. Among neighbours that
   * make progress (closer while still out, or newly in-range), pick the farthest
   * from the target so the sniper doesn't charge into melee distance.
   */
  #stepIntoRange(world: World, target: Entity): PatrolHostileMoveStep | null {
    const tx = target.x;
    const ty = target.y;
    const curCheb = Math.max(Math.abs(tx - this.x), Math.abs(ty - this.y));
    if (withinRange(this.x, this.y, tx, ty, this.sightRange)) return null;

    const blockers = world.blockerKeys();
    blockers.delete(`${this.x},${this.y}`);

    let bestDx = 0;
    let bestDy = 0;
    let bestCheb = -1;
    let found = false;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      if (!world.canMoveEntity(this, dx, dy).ok) continue;
      const nx = this.x + dx;
      const ny = this.y + dy;
      const cheb = Math.max(Math.abs(tx - nx), Math.abs(ty - ny));
      const nowInRange = withinRange(nx, ny, tx, ty, this.sightRange);
      if (!nowInRange && cheb >= curCheb) continue;
      if (!hasLineOfSight(world.grid, nx, ny, tx, ty, { blockers })) continue;
      if (!target.isSpottableBy({ x: nx, y: ny })) continue;
      if (cheb <= bestCheb) continue;
      bestCheb = cheb;
      bestDx = dx;
      bestDy = dy;
      found = true;
    }

    if (!found) return null;
    world.moveEntity(this, bestDx, bestDy);
    return { type: 'move-engage', to: { x: this.x, y: this.y } } satisfies PatrolHostileMoveStep;
  }

  /**
   * Pick the legal neighbour with the greatest Chebyshev distance to `(tx, ty)`
   * that still holds sight (within `sightRange` + LOS, and — for a live target —
   * spottable from there). `requireFarther` gates whether the tile must beat the
   * current distance (kite: stay put if nothing improves) or merely qualify
   * (investigate / blocked engage: any restoring tile is progress).
   */
  #stepToVantage(
    world: World,
    tx: number,
    ty: number,
    opts: { liveTarget: Entity | null; requireFarther: boolean; kind: PatrolHostileMoveKind }
  ): PatrolHostileMoveStep | null {
    const blockers = world.blockerKeys();
    blockers.delete(`${this.x},${this.y}`);
    const curCheb = Math.max(Math.abs(tx - this.x), Math.abs(ty - this.y));

    let bestDx = 0;
    let bestDy = 0;
    let bestCheb = opts.requireFarther ? curCheb : -1;
    let found = false;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      if (!world.canMoveEntity(this, dx, dy).ok) continue;
      const nx = this.x + dx;
      const ny = this.y + dy;
      const cheb = Math.max(Math.abs(tx - nx), Math.abs(ty - ny));
      if (cheb <= bestCheb) continue;
      if (!withinRange(nx, ny, tx, ty, this.sightRange)) continue;
      if (!hasLineOfSight(world.grid, nx, ny, tx, ty, { blockers })) continue;
      if (opts.liveTarget && !opts.liveTarget.isSpottableBy({ x: nx, y: ny })) continue;
      bestCheb = cheb;
      bestDx = dx;
      bestDy = dy;
      found = true;
    }

    if (!found) return null;
    world.moveEntity(this, bestDx, bestDy);
    return {
      type: `move-${opts.kind}`,
      to: { x: this.x, y: this.y },
    } satisfies PatrolHostileMoveStep;
  }
}
