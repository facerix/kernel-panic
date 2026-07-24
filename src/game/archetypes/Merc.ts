import { Crew } from '../Crew.js';
import {
  TILE,
  AP_COST,
  FACTION,
  MERC_RANGED_DAMAGE,
  MERC_DEFAULT_HIT_CHANCE,
} from '../constants.js';
import { canKnockbackByOffset } from '../knockback.js';
import type { CrewInit } from '../Crew.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

export type VaultCheck =
  | { ok: true; mode: 'hop' | 'shove'; occupant: Entity | null; reason?: never }
  | { ok: false; reason: string };

/**
 * Curated callsign pool for the Merc archetype. `buildCrewMember` in
 * `archetypes/index.js` picks one of these using a campaign-scoped `Rng`;
 * `Campaign.buildCrew` filters out names already used by any living or
 * flatlined crew member in the campaign's history. The list is sized 10–15
 * per the Phase-2 plan — enough variety that two campaigns rarely share the
 * same trio, few enough that every entry can be hand-tuned for tone.
 */
export const CALLSIGNS = Object.freeze([
  'Tracer',
  'Bishop',
  'Reaver',
  'Echo',
  'Wraith',
  'Cinder',
  'Riot',
  'Vex',
  'Knox',
  'Carver',
  'Hawk',
  'Drift',
]);

/**
 * Merc — ranged-combat archetype. Perk: **Vault** (breach-and-clear slam).
 *
 * Vault has two modes, evaluated in order for a chosen direction `(dx, dy)`:
 *
 * **Hop (cover vault):** hops a single COVER tile and lands two squares away.
 * The hopped tile must be COVER; the landing tile must be passable and
 * in-bounds. Diagonal vaults use the same Chebyshev rule as movement.
 *
 * If a hostile occupies the landing tile, the Merc body-checks them:
 *   - The hostile takes `VAULT_DAMAGE` (2).
 *   - The hostile is knocked back 1 tile in the vault direction.
 *   - The Merc lands on the tile the hostile vacated.
 *
 * An empty landing (or walk-onto consumable only) is pure repositioning.
 *
 * **Shove (adjacent body-check):** when the hop path fails because there is
 * no cover to vault over, Break can still fire if a hostile occupies the
 * adjacent tile `(x+dx, y+dy)`. The Merc deals `VAULT_DAMAGE`, knocks the
 * hostile back one tile in the same direction, and steps back one tile in
 * the opposite direction when that retreat lane is clear. Blocked knockback
 * destination means denial; blocked retreat still commits the shove.
 *
 * Vault is repeatable (no one-shot gate) — AP cost is the only limit.
 */
export class Merc extends Crew {
  override archetype = 'Merc';

  override get rangedDamage(): number {
    return MERC_RANGED_DAMAGE;
  }

  constructor(props: CrewInit) {
    super({ baseHitChance: MERC_DEFAULT_HIT_CHANCE, ...props, glyph: '@' });
  }

  canVault(world: World, dx: number, dy: number): VaultCheck {
    if (dx === 0 && dy === 0) {
      return { ok: false, reason: 'no-op' };
    }
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      return { ok: false, reason: 'too-far' };
    }
    if (!this.canAfford(AP_COST.VAULT)) {
      return { ok: false, reason: 'insufficient-ap' };
    }

    const hop = this.#canVaultHop(world, dx, dy);
    if (hop.ok) return hop;
    // Only fall through to adjacent shove when cover blocked the hop — a hop
    // denied for knockback, allies, OOB, etc. is authoritative.
    if (hop.reason !== 'no-cover') return hop;

    return this.#canVaultShove(world, dx, dy);
  }

  #canVaultHop(world: World, dx: number, dy: number): VaultCheck {
    const hopX = this.x + dx;
    const hopY = this.y + dy;
    const landX = this.x + 2 * dx;
    const landY = this.y + 2 * dy;

    // The hopped tile must be COVER. Floor would mean nothing to vault over;
    // wall means the hop is physically impossible.
    if (!world.grid.inBounds(hopX, hopY) || world.grid.tileAt(hopX, hopY) !== TILE.COVER) {
      return { ok: false, reason: 'no-cover' };
    }

    if (!world.grid.inBounds(landX, landY)) {
      return { ok: false, reason: 'out-of-bounds' };
    }
    // Landing must match normal movement passability — not cover/wall. Pickups
    // can spawn on hazard/smoke tiles; vault must reach them like a walk.
    if (!world.grid.isPassable(landX, landY)) {
      return { ok: false, reason: 'blocked' };
    }

    let occupant = world.entityAt(landX, landY);
    if (!occupant && world.consumablePickupAt(landX, landY)) {
      return { ok: true, mode: 'hop', occupant: null };
    }
    if (occupant) {
      if (occupant.faction === this.faction) {
        // Can't body-check an ally.
        return { ok: false, reason: 'friendly-occupied' };
      }
      if (occupant.passable || world.consumablePickupAt(landX, landY)) {
        // Walk-onto floor props — land and collect, no body-check.
        occupant = null;
      } else if (occupant.faction === FACTION.NEUTRAL) {
        // Impassable neutrals (objective props, terminals) aren't knockback
        // targets; they simply block the landing tile.
        return { ok: false, reason: 'blocked' };
      } else {
        // Hostile on the landing tile — need a clear knockback lane.
        const knockback = canKnockbackByOffset(world, occupant, dx, dy);
        if (!knockback.ok) return { ok: false, reason: knockback.reason };
      }
    }

    return { ok: true, mode: 'hop', occupant: occupant ?? null };
  }

  #canVaultShove(world: World, dx: number, dy: number): VaultCheck {
    const adjX = this.x + dx;
    const adjY = this.y + dy;

    if (!world.grid.inBounds(adjX, adjY)) {
      return { ok: false, reason: 'no-target' };
    }

    const occupant = world.entityAt(adjX, adjY);
    if (!occupant) {
      return { ok: false, reason: 'no-target' };
    }
    if (occupant.faction === this.faction) {
      return { ok: false, reason: 'friendly-occupied' };
    }
    if (occupant.passable || world.consumablePickupAt(adjX, adjY)) {
      return { ok: false, reason: 'no-target' };
    }
    if (occupant.faction === FACTION.NEUTRAL) {
      return { ok: false, reason: 'blocked' };
    }

    const knockback = canKnockbackByOffset(world, occupant, dx, dy);
    if (!knockback.ok) return { ok: false, reason: knockback.reason };

    return { ok: true, mode: 'shove', occupant };
  }

  /**
   * Execute the vault. Hop mode moves the Merc two tiles out; shove mode
   * knocks an adjacent hostile back and steps the Merc away when the retreat
   * lane is clear. Damage is applied by `applyIntent.doVault` (not here) so
   * Combat event wiring remains in the intent layer.
   *
   * Returns `{ occupant, mode }` — the entity knocked back (if any) and which
   * vault mode committed.
   */
  vault(world: World, dx: number, dy: number) {
    const check = this.canVault(world, dx, dy);
    if (!check.ok) {
      throw new Error(`Illegal vault for ${this.id}: ${check.reason}`);
    }

    const { occupant, mode } = check;

    // Knockback hostile before Merc lands (hop) or retreats (shove).
    // `relocateEntity` validates bounds/passability/occupancy and emits
    // ENTITY_MOVED — no silent bypasses. (#7 adversarial review)
    if (occupant) {
      world.relocateEntity(occupant, occupant.x + dx, occupant.y + dy, { allowCover: true });
    }

    this.spendAp(AP_COST.VAULT);

    if (mode === 'hop') {
      // Merc lands where the hostile was (or on the empty tile).
      world.relocateEntity(this, this.x + 2 * dx, this.y + 2 * dy);
    } else {
      this.#tryShoveRetreat(world, dx, dy);
    }

    return { occupant, mode };
  }

  /** Step back one tile opposite the shove direction when the lane is clear. */
  #tryShoveRetreat(world: World, dx: number, dy: number) {
    const rx = this.x - dx;
    const ry = this.y - dy;
    if (!world.grid.inBounds(rx, ry) || !world.grid.isPassable(rx, ry)) return;

    const blocker = world.entityAt(rx, ry);
    if (blocker && !blocker.passable && !world.consumablePickupAt(rx, ry)) return;

    world.relocateEntity(this, rx, ry);
  }
}
