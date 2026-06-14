/**
 * P3.M3.5 — Probe ICE: the patrol fodder of the cyber grid.
 *
 * Walks a perimeter ring around a data-node room via the shared
 * patrol → investigate → engage machine. Its identity is the **trace
 * flare**: on acquiring the avatar it raises the *cyber* world's alarm
 * (`repPenalty: false` — job noise on a private bus, never a social cost)
 * so the whole pack converges, then closes and strikes like a Guard.
 * Unlike the Lookout it *listens* for alarms (the `PatrolHostile` default):
 * one probe's flare is every probe's heading.
 *
 * Stats are explicit and small — ICE scaling is its own axis (Spark and
 * Guardian ICE are the follow-up slices), so `resolveEnemyStats` tiers are
 * deliberately not reused. The avatar's `iceResistance` mitigates the weak
 * strike down to the engine-wide minimum of 1.
 */
import { PatrolHostile, type PatrolHostileInit, type EngageSteps } from '../ai/PatrolHostile.js';
import { AP_COST, PROBE_ICE_GLYPH } from '../constants.js';
import { canMelee, resolveMelee } from '../Combat.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export const PROBE_ICE_HP = 2;
export const PROBE_ICE_AP = 2;
export const PROBE_ICE_DAMAGE = 1;
export const PROBE_ICE_SIGHT_RANGE = 6;

export interface ProbeIceProps extends Omit<PatrolHostileInit, 'glyph'> {}

export class ProbeIce extends PatrolHostile {
  /** Sniffed by `Combat.attackerMeleeDamage` — the weak ICE strike. */
  readonly meleeDamage = PROBE_ICE_DAMAGE;

  constructor({
    maxHp = PROBE_ICE_HP,
    maxAp = PROBE_ICE_AP,
    sightRange = PROBE_ICE_SIGHT_RANGE,
    patrolWaypoints,
    ...props
  }: ProbeIceProps) {
    super({
      ...props,
      maxAp,
      maxHp,
      sightRange,
      glyph: PROBE_ICE_GLYPH,
      displayName: 'Probe',
      patrolWaypoints,
    });
  }

  /**
   * Trace flare, then Guard-style close-and-strike. `raiseAlarm` self-gates
   * (returns false while the alarm is already ALERT), so the flare step is
   * yielded exactly once per alarm window.
   */
  protected override *engageSteps(world: World, rng: Rng, target: Entity): EngageSteps {
    const raised = world.raiseAlarm({
      source: this,
      target,
      origin: { x: this.x, y: this.y },
      repPenalty: false,
    });
    if (raised) {
      yield { type: 'trace-alarm', target: target.id };
    }

    const meleeCheck = canMelee(world, this, target);
    if (meleeCheck.ok) {
      const result = resolveMelee(world, this, target, rng);
      yield { type: 'melee', target: target.id, result };
      return 'continue';
    }
    if (meleeCheck.reason !== 'not-adjacent' && meleeCheck.reason !== 'insufficient-ap') {
      return 'break';
    }
    if (this.ap < AP_COST.MOVE) return 'break';
    const step = this.stepToward(world, target.x, target.y, 'engage');
    if (!step) return 'break';
    yield step;
    return 'continue';
  }
}
