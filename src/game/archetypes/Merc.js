import { Entity } from '../Entity.js';
import { TILE, FACTION, AP_COST } from '../constants.js';

/**
 * Merc — ranged-combat archetype. Phase-1 perk: **Vault**.
 *
 * Vault hops a single COVER tile and lands two squares away in the same
 * direction. The hopped tile must be COVER (the whole point of the perk) and
 * the landing tile must be passable, in-bounds, and unoccupied. Diagonal
 * vaults are allowed under the same Chebyshev rule the rest of movement uses.
 *
 * In M4 a vault will *also* count as a fire action — we'll fold ranged
 * resolution in there. For M3 it's purely a movement perk.
 */
export class Merc extends Entity {
  constructor(props) {
    super({ faction: FACTION.PLAYER, glyph: '@', ...props });
  }

  canVault(world, dx, dy) {
    if (dx === 0 && dy === 0) {
      return { ok: false, reason: 'no-op' };
    }
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      return { ok: false, reason: 'too-far' };
    }
    if (!this.canAfford(AP_COST.VAULT)) {
      return { ok: false, reason: 'insufficient-ap' };
    }

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
    // Landing must be plain floor — no chaining vaults across two cover tiles
    // and no landing on top of a wall.
    if (world.grid.tileAt(landX, landY) !== TILE.FLOOR) {
      return { ok: false, reason: 'blocked' };
    }
    if (world.entityAt(landX, landY)) {
      return { ok: false, reason: 'occupied' };
    }

    return { ok: true };
  }

  vault(world, dx, dy) {
    const check = this.canVault(world, dx, dy);
    if (!check.ok) {
      throw new Error(`Illegal vault for ${this.id}: ${check.reason}`);
    }
    this.spendAp(AP_COST.VAULT);
    this.x += 2 * dx;
    this.y += 2 * dy;
    // M4 TODO: emit a fire action here so vault-while-firing resolves a shot.
  }
}
