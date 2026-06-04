/**
 * Tier-2 **Medic** — support specialist. It never attacks; its value is making
 * a durable patient survive the player phase: heal a wounded ally first, then
 * add a short-lived shield to a durable ally (bruiser/juggernaut/flanker).
 *
 * Shields live on the patient and expire on that patient's next AP refresh,
 * which means a shield applied during corp turn N survives the full player
 * response window and drops before corp turn N+1.
 */

import { PatrolHostile, type PatrolHostileInit, type EngageSteps } from './PatrolHostile.js';
import { Hostile } from '../Hostile.js';
import {
  DEFAULT_HP,
  FACTION,
  ENEMY_ROLE,
  ENEMY_TIER,
  MEDIC_HEAL_AMOUNT,
  MEDIC_SHIELD_HP,
  MEDIC_SUPPORT_AP,
  MEDIC_SUPPORT_RANGE,
  resolveEnemyStats,
} from '../constants.js';
import type { EnemyTier } from '../constants.js';
import { hasLineOfSight, withinRange } from '../LineOfSight.js';
import type { Entity } from '../Entity.js';
import type { TurnActionSteps } from '../../types.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export interface MedicProps extends Omit<PatrolHostileInit, 'faction' | 'glyph'> {
  tier?: EnemyTier;
}

export class Medic extends PatrolHostile {
  constructor({ tier = ENEMY_TIER.T2, patrolWaypoints, ...props }: MedicProps) {
    const stats = resolveEnemyStats(props, ENEMY_ROLE.SPECIALIST, tier);
    super({ ...props, ...stats, faction: FACTION.CORP, glyph: 'm', patrolWaypoints });
  }

  override *takeTurnSteps(world: World, rng: Rng): TurnActionSteps {
    if (!this.alive) return;

    const support = this.#supportTarget(world);
    if (support) {
      if (this.#canSupport(world, support)) {
        if (support.hp < support.maxHp) {
          this.spendAp(MEDIC_SUPPORT_AP);
          const amount = support.heal(MEDIC_HEAL_AMOUNT);
          if (amount > 0) yield { type: 'heal', target: support.id, amount };
          return;
        }

        const missingShield = MEDIC_SHIELD_HP - support.shieldHp;
        if (missingShield > 0) {
          this.spendAp(MEDIC_SUPPORT_AP);
          const amount = support.addShield(missingShield);
          yield { type: 'shield', target: support.id, amount };
          return;
        }
      }

      const step = this.stepToward(world, support.x, support.y, 'engage');
      if (step) yield step;
      return;
    }

    yield* super.takeTurnSteps(world, rng);
  }

  protected override *engageSteps(world: World, _rng: Rng, target: Entity): EngageSteps {
    const support = this.#supportTarget(world);
    if (support && this.ap >= MEDIC_SUPPORT_AP) {
      if (this.#canSupport(world, support)) {
        if (support.hp < support.maxHp) {
          this.spendAp(MEDIC_SUPPORT_AP);
          const amount = support.heal(MEDIC_HEAL_AMOUNT);
          if (amount > 0) yield { type: 'heal', target: support.id, amount };
          return 'break';
        }
        const missingShield = MEDIC_SHIELD_HP - support.shieldHp;
        if (missingShield > 0) {
          this.spendAp(MEDIC_SUPPORT_AP);
          const amount = support.addShield(missingShield);
          yield { type: 'shield', target: support.id, amount };
          return 'break';
        }
      }

      const step = this.stepToward(world, support.x, support.y, 'engage');
      if (step) {
        yield step;
        return 'break';
      }
    }

    // No useful patient right now: preserve the specialist by drifting away
    // from the live hostile target if the generic patrol shell acquired one.
    const step = this.stepToward(world, target.x, target.y, 'engage');
    if (step) yield step;
    return 'break';
  }

  #supportTarget(world: World): Entity | null {
    let best: Entity | null = null;
    let bestScore = -Infinity;
    for (const entity of world.entities.values()) {
      if (!entity.alive || entity === this || entity.faction !== this.faction) continue;
      if (!(entity instanceof Hostile)) continue;
      const missingHp = entity.maxHp - entity.hp;
      const shieldable = isDurablePatient(entity) && entity.shieldHp < MEDIC_SHIELD_HP;
      if (missingHp <= 0 && !shieldable) continue;

      const cheb = Math.max(Math.abs(entity.x - this.x), Math.abs(entity.y - this.y));
      const score =
        (isDurablePatient(entity) ? 100 : 0) + (missingHp > 0 ? 20 + missingHp : 0) - cheb / 100;
      if (score > bestScore) {
        best = entity;
        bestScore = score;
      }
    }
    return best;
  }

  #canSupport(world: World, target: Entity): boolean {
    if (this.ap < MEDIC_SUPPORT_AP) return false;
    if (!withinRange(this.x, this.y, target.x, target.y, MEDIC_SUPPORT_RANGE)) return false;
    const blockers = world.blockerKeys();
    blockers.delete(`${this.x},${this.y}`);
    blockers.delete(`${target.x},${target.y}`);
    return hasLineOfSight(world.grid, this.x, this.y, target.x, target.y, { blockers });
  }
}

function isDurablePatient(entity: Entity): boolean {
  return entity.damageReduction > 0 || entity.maxHp > DEFAULT_HP;
}
