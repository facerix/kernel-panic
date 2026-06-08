import { Entity } from './Entity.js';
import { Hostile } from './Hostile.js';
import { FACTION, TURRET_MAX_HP, TURRET_RANGE, TURRET_DAMAGE } from './constants.js';
import { resolveRanged, canFireRanged } from './Combat.js';
import type { EntityInit } from './Entity.js';
import type { World } from './World.js';
import type { Rng } from '../rng.js';

/**
 * Turret — a placed grid entity that automatically fires on the nearest
 * hostile each player turn.
 *
 * Peer of `Entity.js`, not an archetype. The Tech archetype places it at
 * `AP_COST.DEPLOY`; once placed it's faction-PLAYER, has HP, and can be
 * destroyed by drone fire like any other entity. It does *not* take a queue
 * turn — turrets are passive infrastructure, not actors. Instead, the
 * player-aftermath phase in `combatTurnPipeline.js` calls `autoFire(world,
 * rng)` after the player yields and before the corp turn begins. This keeps
 * the TurnQueue model honest (two factions only) and means turret behaviour
 * is one aftermath step, not an AI tick.
 *
 * `autoFire` selects the nearest live combatant (`Hostile` subclass, Chebyshev
 * distance) within `TURRET_RANGE` that has line of sight. Non-combatants
 * (CorpCivilian, NeutralCivilian) are never valid targets. If a target exists
 * it routes through
 * `Combat.resolveRanged` with `freeShot: true` (no AP gate — the turret has
 * no AP pool) and `damage: TURRET_DAMAGE`. The shared `Combat` path means
 * cover penalties, LOS occlusion, and damage events all behave the same as
 * for the player's own ranged attacks.
 *
 * Glyph is `'T'`. Improvised turrets (deployed via `Tech.improviseTurret`)
 * share this class.
 */

type TurretAutoFireFireResult = {
  type: 'fire';
  target: Entity;
  result: ReturnType<typeof resolveRanged>;
};
type TurretAutoFireIdleResult = {
  type: 'idle';
  reason: 'no-target' | 'destroyed';
};
export type TurretAutoFireResult = TurretAutoFireFireResult | TurretAutoFireIdleResult;
export type TurretAnnotatedResult = { turret: Turret; action: TurretAutoFireResult };

export interface TurretInit extends EntityInit {
  range?: number;
  attackDamage?: number;
  ownerId?: string | null;
}

/** P2.7.M6.2: Turret snapshot `extra` — tuned range/damage and deploying owner. */
export type TurretSnapshot = {
  range: number;
  attackDamage: number;
  ownerId: string | null;
};

export class Turret extends Entity {
  range: number;
  attackDamage: number;
  ownerId: string | null;

  constructor({
    maxHp = TURRET_MAX_HP,
    range = TURRET_RANGE,
    attackDamage = TURRET_DAMAGE,
    ownerId = null,
    ...rest
  }: TurretInit) {
    super({
      ...rest,
      faction: FACTION.PLAYER,
      glyph: 'T',
      maxAp: 0, // turrets don't take turns
      maxHp,
    });
    if (!Number.isInteger(range) || range <= 0) {
      throw new RangeError(`Turret range must be a positive integer, got ${range}`);
    }
    if (!Number.isInteger(attackDamage) || attackDamage <= 0) {
      throw new RangeError(`Turret attackDamage must be a positive integer, got ${attackDamage}`);
    }
    if (ownerId !== null && typeof ownerId !== 'string') {
      throw new TypeError(`Turret ownerId must be a string or null, got ${typeof ownerId}`);
    }
    this.range = range;
    // NOTE: deliberately `attackDamage`, not `damage` — `Entity.prototype.damage`
    // is the *method* that applies incoming damage to this entity. Shadowing
    // that with a number field broke `turret.damage(n)` on the corpse-cleanup
    // path; a tiny rename is much safer than a method-shaped getter.
    this.attackDamage = attackDamage;
    /** The id of the crew member who deployed this turret; for kill credit. */
    this.ownerId = ownerId;
  }

  /**
   * Pick the nearest live hostile that's within range and has LOS. Returns
   * `null` if no candidate exists — the caller logs an idle line instead of
   * resolving a shot. Pure scan; no mutation.
   */
  findTarget(world: World) {
    if (!this.alive) return null;
    let best = null;
    let bestDist = Infinity;
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      if (e.faction === this.faction) continue;
      // Only engage active combatants — corp civilians alarm but don't fight.
      if (!(e instanceof Hostile)) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const cheb = Math.max(Math.abs(dx), Math.abs(dy));
      if (cheb > this.range) continue;
      // Defer the LOS + Combat range check to canFireRanged so the turret
      // shares the exact visibility contract the player uses — no risk of the
      // turret firing through a wall the player can't see through.
      const check = canFireRanged(world, this, e, {
        freeShot: true,
        range: this.range,
      });
      if (!check.ok) continue;
      if (cheb < bestDist) {
        bestDist = cheb;
        best = e;
      }
    }
    return best;
  }

  /**
   * Pick a target (if any) and fire. Returns a result descriptor so the shell
   * can log the action:
   *   - `{ type: 'fire', target, result }` when a shot is taken.
   *   - `{ type: 'idle', reason: 'no-target' | 'destroyed' }` otherwise.
   *
   * Destroyed turrets are silent (they're a corpse — nothing to fire).
   */
  autoFire(world: World, rng: Rng): TurretAutoFireResult {
    if (!this.alive) return { type: 'idle', reason: 'destroyed' };
    if (!rng || typeof rng.next !== 'function') {
      throw new TypeError('Turret.autoFire requires an Rng with a next() method');
    }
    const target = this.findTarget(world);
    if (!target) return { type: 'idle', reason: 'no-target' };
    const result = resolveRanged(world, this, target, rng, {
      freeShot: true,
      damage: this.attackDamage,
      range: this.range,
    });
    return { type: 'fire', target, result };
  }
}

/**
 * Drive every live turret in `world` through one autofire pass. Returns an
 * array of `{ turret, action }` so callers can render a log line per shot.
 * Kept for compatibility with tests and aggregate callers; the main turn
 * pipeline uses `runPlayerAftermathSteps` to pace one turret action at a time.
 *
 * Call site contract (per the plan): at the *end of the player turn, before
 * the corp turn begins*. Putting it any later would let drones move into LOS
 * during their own turn and then immediately eat the turret's fire on the
 * same tick — the player wouldn't see the engagement build.
 */
export function runTurretAutoFire(world: World, rng: Rng): TurretAnnotatedResult[] {
  const results: TurretAnnotatedResult[] = [];
  for (const entity of world.entities.values()) {
    if (!(entity instanceof Turret)) continue;
    if (!entity.alive) continue;
    const action = entity.autoFire(world, rng);
    results.push({ turret: entity, action });
  }
  return results;
}
