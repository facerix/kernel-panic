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
 * Vault doubles as a fire action — "hop over cover while firing" per the
 * blueprint. The shot is resolved by `applyIntent.doVault` (free shot from
 * the landing position in the vault direction, normal hit/cover math, no
 * extra AP cost). If no hostile is in the vault vector, the hop still
 * succeeds as a pure movement perk.
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
    // Emit ENTITY_MOVED so vision recompute and AI hooks pick the vault up
    // like any other reposition. The shot (if any) is resolved by the intent
    // handler *after* this method returns — Merc.vault stays a pure movement
    // perk; Combat.resolveRanged emits its own NOISE event for the gunshot.
    world.events?.emit(EVENT.ENTITY_MOVED, {
      entity: this,
      from,
      to: { x: this.x, y: this.y },
    });
  }
}
