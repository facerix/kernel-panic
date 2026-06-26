/**
 * P3.M3 — Spark ICE: the fast, fragile swarm attacker of the cyber grid.
 *
 * Where the Probe is the *detector* (long sight, trace flare) and the Guardian
 * the *parked heavy*, the Spark is the **silent fast responder**. It does NOT
 * raise the trace flare itself — it *listens* for one (the `PatrolHostile`
 * alarm default) and converges at speed. Its identity is action economy:
 *
 *   - `SPARK_ICE_AP = 4` — double the Probe's budget. It closes three tiles and
 *     strikes in a single activation, so a flare anywhere on the grid pulls a
 *     wave of Sparks onto the avatar the very next turn — the swarm.
 *   - `SPARK_ICE_HP = 1` — one avatar swing deletes it. The threat is numbers
 *     and tempo, never durability.
 *
 * Engage is plain close-and-strike (the Guard loop); the chip strike is
 * mitigated to the engine-wide minimum of 1 by the avatar's `iceResistance`.
 * ICE stats are an explicit axis (no `resolveEnemyStats` tiers) — see ProbeIce.
 */
import { PatrolHostile, type PatrolHostileInit, type EngageSteps } from '../ai/PatrolHostile.js';
import { AP_COST, SPARK_ICE_GLYPH } from '../constants.js';
import { canMelee, resolveMelee } from '../Combat.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export const SPARK_ICE_HP = 1;
export const SPARK_ICE_AP = 4;
export const SPARK_ICE_DAMAGE = 1;
export const SPARK_ICE_SIGHT_RANGE = 6;

export interface SparkIceProps extends Omit<PatrolHostileInit, 'glyph'> {}

export class SparkIce extends PatrolHostile {
  /** Sniffed by `Combat.attackerMeleeDamage` — the chip strike. */
  readonly meleeDamage = SPARK_ICE_DAMAGE;

  constructor({
    maxHp = SPARK_ICE_HP,
    maxAp = SPARK_ICE_AP,
    sightRange = SPARK_ICE_SIGHT_RANGE,
    patrolWaypoints,
    ...props
  }: SparkIceProps) {
    super({
      ...props,
      maxAp,
      maxHp,
      sightRange,
      glyph: SPARK_ICE_GLYPH,
      displayName: 'Spark',
      patrolWaypoints,
    });
  }

  /**
   * Silent close-and-strike. No trace flare — the Spark rides the Probe/Guardian
   * alarm to find the avatar, then spends its deep AP pool closing and biting.
   */
  protected override *engageSteps(world: World, rng: Rng, target: Entity): EngageSteps {
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
