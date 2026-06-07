/**
 * Corp turret — a stationary CORP-faction hostile that fires at PLAYER
 * entities during the corp turn.
 *
 * Peer of the player `Turret` (Tech deployable) but on the opposite side.
 * Extends `Hostile` so it participates in the standard corp turn loop via
 * `takeTurnSteps`, targets via `acquireTarget`, and is targetable by player
 * turrets (which shoot at `Hostile` instances).
 *
 * Key differences from the player turret:
 *   - Faction CORP, not PLAYER.
 *   - Fires during the **corp turn** (via `takeTurnSteps`), not player aftermath.
 *   - Has AP (receives `maxAp` from the TurnQueue refresh) and spends
 *     `AP_COST.RANGED_ATTACK` per shot — consistent with how drones fire.
 *   - Stationary: never moves, never investigates. If no target is in LOS +
 *     range, the turn ends immediately.
 *   - Glyph: `'$'` (distinct from player `'T'`).
 *
 * Placed by `Run.enterCombat` on sweep contracts or as ambient pressure on
 * elevated/critical difficulty maps. Destruction counts toward sweep quotas
 * when `params.target` includes turrets.
 */

import { Hostile, type HostileInit } from '../Hostile.js';
import { FACTION, AP_COST, type FactionId } from '../constants.js';
import { CORP_TURRET_RANGE, CORP_TURRET_DAMAGE, CORP_TURRET_HP } from '../constants.js';
import { canFireRanged, resolveRanged } from '../Combat.js';
import type { TurnActionStep, TurnActionSteps } from '../../types.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export const CORP_TURRET_GLYPH = '$';

export interface CorpTurretInit extends Omit<HostileInit, 'faction' | 'glyph'> {
  /**
   * Allegiance (Phase 2.9). Defaults to `FACTION.CORP`; the spawn path
   * stamps the run's hostile faction for rival-group principals.
   */
  faction?: FactionId;
  range?: number;
  attackDamage?: number;
}

/** M6.2: CorpTurret snapshot `extra` — tuned range/damage (no owner). */
export type CorpTurretSnapshot = {
  range: number;
  attackDamage: number;
};

export class CorpTurret extends Hostile {
  range: number;
  attackDamage: number;
  /** Stationary infrastructure cannot dodge melee. */
  readonly baseDodgeChance = 0;

  constructor({
    range = CORP_TURRET_RANGE,
    attackDamage = CORP_TURRET_DAMAGE,
    maxHp = CORP_TURRET_HP,
    maxAp = AP_COST.RANGED_ATTACK,
    faction,
    ...rest
  }: CorpTurretInit) {
    super({
      ...rest,
      faction: faction ?? FACTION.CORP,
      glyph: CORP_TURRET_GLYPH,
      maxHp,
      maxAp,
    });
    if (!Number.isInteger(range) || range <= 0) {
      throw new RangeError(`CorpTurret range must be a positive integer, got ${range}`);
    }
    if (!Number.isInteger(attackDamage) || attackDamage <= 0) {
      throw new RangeError(
        `CorpTurret attackDamage must be a positive integer, got ${attackDamage}`
      );
    }
    this.range = range;
    this.attackDamage = attackDamage;
  }

  /**
   * Stationary AI: acquire → fire. No movement, no state machine. If a
   * target is visible and AP allows, fire; otherwise idle. Multiple shots
   * per turn are possible if maxAp > AP_COST.RANGED_ATTACK.
   */
  override *takeTurnSteps(world: World, rng: Rng): TurnActionSteps {
    if (!this.alive) return;

    let safety = 8;
    while (this.alive && this.ap >= AP_COST.RANGED_ATTACK && safety-- > 0) {
      const target = this.acquireTarget(world);
      if (!target) break;

      const check = canFireRanged(world, this, target, { range: this.range });
      if (!check.ok) break;

      const result = resolveRanged(world, this, target, rng, {
        range: this.range,
        damage: this.attackDamage,
      });
      yield { type: 'fire', target: target.id, result };
    }

    if (safety <= 0) {
      throw new Error(`CorpTurret ${this.id} exceeded turn iteration cap`);
    }
  }

  override takeTurn(world: World, rng: Rng): TurnActionStep[] {
    return [...this.takeTurnSteps(world, rng)];
  }
}
