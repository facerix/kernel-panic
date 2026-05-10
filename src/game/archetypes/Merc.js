import { Entity } from '../Entity.js';
import { TILE, FACTION, AP_COST } from '../constants.js';
import { EVENT } from '../events.js';

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
    // Landing must be walkable terrain (floor or exit), not cover/wall — no
    // chaining vaults across two cover tiles.
    const landTile = world.grid.tileAt(landX, landY);
    if (landTile !== TILE.FLOOR && landTile !== TILE.EXIT) {
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
    const from = { x: this.x, y: this.y };
    this.spendAp(AP_COST.VAULT);
    this.x += 2 * dx;
    this.y += 2 * dy;
    // Closes the M5 deferred fix: emit ENTITY_MOVED so vision recompute and
    // AI hooks pick the vault up like any other reposition. No NOISE event —
    // a vault is loud (clambering over cover) but that's *also* a missing
    // call we'll add when the vault-while-firing combo lands; today the
    // omission is conservative (no false alarms for sentries).
    world.events?.emit(EVENT.ENTITY_MOVED, {
      entity: this,
      from,
      to: { x: this.x, y: this.y },
    });
    // M4 TODO: emit a fire action here so vault-while-firing resolves a shot.
  }
}
