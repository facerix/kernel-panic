/**
 * P3.M3 — Guardian ICE: the heavy that guards a critical data node.
 *
 * The counterweight to the Spark. Where the swarm trades durability for tempo,
 * the Guardian is slow, sighted short, and very hard to move through:
 *
 *   - `GUARDIAN_ICE_HP = 6` — three avatar swings at the cyber melee baseline.
 *   - `GUARDIAN_ICE_DAMAGE = 3` (`HEAVY_MELEE_DAMAGE`) — the avatar's
 *     `iceResistance` only files this down to 2; the prize bites back.
 *   - `GUARDIAN_ICE_AP = 2` — limited mobility. It spawns *on* its node and is
 *     deliberately given no patrol ring, so it holds station until the avatar
 *     enters its short sight, then closes and strikes.
 *
 * Like the Probe, it flares on engagement — a hand on the crown jewel trips the
 * trace and calls the swarm. ICE stats are an explicit axis (no
 * `resolveEnemyStats` tiers) — see ProbeIce.
 */
import { PatrolHostile, type PatrolHostileInit, type EngageSteps } from '../ai/PatrolHostile.js';
import { AP_COST, GUARDIAN_ICE_GLYPH, HEAVY_MELEE_DAMAGE } from '../constants.js';
import { canMelee, resolveMelee } from '../Combat.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export const GUARDIAN_ICE_HP = 6;
export const GUARDIAN_ICE_AP = 2;
export const GUARDIAN_ICE_DAMAGE = HEAVY_MELEE_DAMAGE;
export const GUARDIAN_ICE_SIGHT_RANGE = 5;

export interface GuardianIceProps extends Omit<PatrolHostileInit, 'glyph'> {}

export class GuardianIce extends PatrolHostile {
  /** Sniffed by `Combat.attackerMeleeDamage` — the heavy ICE strike. */
  readonly meleeDamage = GUARDIAN_ICE_DAMAGE;

  constructor({
    maxHp = GUARDIAN_ICE_HP,
    maxAp = GUARDIAN_ICE_AP,
    sightRange = GUARDIAN_ICE_SIGHT_RANGE,
    patrolWaypoints,
    ...props
  }: GuardianIceProps) {
    super({
      ...props,
      maxAp,
      maxHp,
      sightRange,
      glyph: GUARDIAN_ICE_GLYPH,
      displayName: 'Guardian',
      patrolWaypoints,
    });
  }

  /**
   * Trace flare on first contact, then heavy close-and-strike. `raiseAlarm`
   * self-gates (false while already ALERT), so the flare yields exactly once
   * per alarm window — identical cadence to the Probe.
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
