/**
 * T3 elite melee brawler. Shares Guard's close-and-strike engage loop, but a
 * connected heavy melee hit shoves the target one tile away.
 */

import { PatrolHostile, type PatrolHostileInit, type EngageSteps } from './PatrolHostile.js';
import {
  AP_COST,
  ENEMY_ROLE,
  ENEMY_TIER,
  FACTION,
  HEAVY_MELEE_DAMAGE,
  resolveEnemyStats,
} from '../constants.js';
import type { EnemyTier } from '../constants.js';
import { canMelee, resolveMelee } from '../Combat.js';
import type { Entity } from '../Entity.js';
import { knockbackByOffset } from '../knockback.js';
import type { World } from '../World.js';
import type { GridPoint } from '../../types.js';
import type { Rng } from '../../rng.js';

export interface BruiserProps extends Omit<PatrolHostileInit, 'faction' | 'glyph'> {
  tier?: EnemyTier;
}

export class Bruiser extends PatrolHostile {
  constructor({ tier = ENEMY_TIER.T3, patrolWaypoints, ...props }: BruiserProps) {
    const stats = resolveEnemyStats(props, ENEMY_ROLE.ELITE, tier);
    super({ ...props, ...stats, faction: FACTION.CORP, glyph: 'e', patrolWaypoints });
  }

  get meleeDamage(): number {
    return HEAVY_MELEE_DAMAGE;
  }

  protected override *engageSteps(world: World, rng: Rng, target: Entity): EngageSteps {
    const meleeCheck = canMelee(world, this, target);
    if (meleeCheck.ok) {
      const result = resolveMelee(world, this, target, rng);
      const away = awayVector(this, target);
      const knockback =
        result.hit && target.alive && away
          ? knockbackByOffset(world, target, away.x, away.y)
          : null;
      yield { type: 'melee', target: target.id, result, knockback };
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

function awayVector(attacker: Entity, target: Entity): GridPoint | null {
  const rawDx = target.x - attacker.x;
  const rawDy = target.y - attacker.y;
  if (rawDx === 0 && rawDy === 0) return null;

  const absDx = Math.abs(rawDx);
  const absDy = Math.abs(rawDy);
  if (absDx > absDy) return { x: Math.sign(rawDx), y: 0 };
  if (absDy > absDx) return { x: 0, y: Math.sign(rawDy) };
  return { x: Math.sign(rawDx), y: Math.sign(rawDy) };
}
