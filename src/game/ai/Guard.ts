/**
 * Melee fodder guard — the close-and-strike counterpart to the skirmisher.
 * Shares the patrol → investigate → engage state machine via `PatrolHostile`;
 * its identity is the ENGAGE behaviour: close the gap, swing when adjacent.
 *
 * No armor, no knockback, no kiting — a guard trades HP openly. At T1 stats it
 * dies in two player-phase melee swings. It exists so T1 encounters can mix
 * ranged and melee pressure without importing T3 defensive mechanics (those
 * land with `CorpBruiser` in M4).
 */

import { PatrolHostile, type PatrolHostileInit, type EngageSteps } from './PatrolHostile.js';
import {
  FACTION,
  AP_COST,
  ENEMY_ROLE,
  ENEMY_TIER,
  HEAVY_MELEE_DAMAGE,
  resolveEnemyStats,
} from '../constants.js';
import type { EnemyTier } from '../constants.js';
import { canMelee, resolveMelee } from '../Combat.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export interface GuardProps extends Omit<PatrolHostileInit, 'faction' | 'glyph'> {
  tier?: EnemyTier;
}

export class Guard extends PatrolHostile {
  constructor({ tier = ENEMY_TIER.T1, patrolWaypoints, ...props }: GuardProps) {
    const stats = resolveEnemyStats(props, ENEMY_ROLE.FODDER, tier);
    super({ ...props, ...stats, faction: FACTION.CORP, glyph: 'g', patrolWaypoints });
  }

  protected override *engageSteps(world: World, rng: Rng, target: Entity): EngageSteps {
    const meleeCheck = canMelee(world, this, target);
    if (meleeCheck.ok) {
      const result = resolveMelee(world, this, target, rng, {
        damage: HEAVY_MELEE_DAMAGE,
      });
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
