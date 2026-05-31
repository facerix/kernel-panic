/**
 * Corp guard — the melee fodder counterpart to the skirmisher (`CorpDrone`).
 * Shares the patrol → investigate → engage state machine via `PatrolHostile`;
 * its identity is the ENGAGE behaviour: close the gap, swing when adjacent.
 *
 * No armor, no knockback, no kiting — a guard trades HP openly. At T1 stats it
 * dies in two player-phase melee swings. It exists so T1 encounters can mix
 * ranged and melee pressure without importing T3 defensive mechanics (those
 * land with `CorpBruiser` in M4).
 */

import { PatrolHostile, type PatrolHostileInit, type EngageSteps } from './PatrolHostile.js';
import { FACTION, AP_COST, ENEMY_ROLE, ENEMY_TIER, resolveEnemyStats } from '../constants.js';
import type { EnemyTier } from '../constants.js';
import { canMelee, resolveMelee } from '../Combat.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export interface CorpGuardProps extends Omit<PatrolHostileInit, 'faction' | 'glyph'> {
  tier?: EnemyTier;
}

export class CorpGuard extends PatrolHostile {
  constructor({ tier = ENEMY_TIER.T1, patrolWaypoints, ...props }: CorpGuardProps) {
    const stats = resolveEnemyStats(props, ENEMY_ROLE.FODDER, tier);
    super({ ...props, ...stats, faction: FACTION.CORP, glyph: 'g', patrolWaypoints });
  }

  /**
   * Melee engage: strike when adjacent and AP allows, otherwise step toward the
   * target to close. `canMelee` reporting `not-adjacent` is the normal "keep
   * closing" path — only an unexpected failure (or no path / no AP) breaks the
   * turn.
   */
  protected override *engageSteps(world: World, rng: Rng, target: Entity): EngageSteps {
    const meleeCheck = canMelee(world, this, target);
    if (meleeCheck.ok) {
      const result = resolveMelee(world, this, target, rng);
      yield { type: 'melee', target: target.id, result };
      return 'continue';
    }
    if (meleeCheck.reason !== 'not-adjacent' && meleeCheck.reason !== 'insufficient-ap') {
      // Same-faction / dead-target edge cases — should be rare at this layer.
      // Stop rather than thrash.
      return 'break';
    }
    // Not adjacent (or can't afford the swing yet) — close the distance.
    if (this.ap < AP_COST.MOVE) return 'break';
    const step = this.stepToward(world, target.x, target.y, 'engage');
    if (!step) return 'break';
    yield step;
    return 'continue';
  }
}
