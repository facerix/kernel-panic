import { Crew } from '../Crew.js';
import { TILE, AP_COST } from '../constants.js';
import { EVENT } from '../events.js';
import type { CrewInit } from '../Crew.js';
import type { World } from '../World.js';

/**
 * Curated callsign pool for the Merc archetype. `buildCrewMember` in
 * `archetypes/index.js` picks one of these using a campaign-scoped `Rng`;
 * `Campaign.buildCrew` (M2) filters out names already used by any living or
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
 * Vault hops a single COVER tile and lands two squares away in the same
 * direction. The hopped tile must be COVER (the whole point of the perk) and
 * the landing tile must be passable and in-bounds. Diagonal vaults are
 * allowed under the same Chebyshev rule the rest of movement uses.
 *
 * Vault is repeatable (no one-shot gate) — the AP cost is the only limit.
 *
 * If a hostile entity occupies the landing tile, the Merc body-checks them:
 *   - The hostile takes `VAULT_DAMAGE` (2).
 *   - The hostile is knocked back 1 tile in the vault direction.
 *   - The Merc lands on the tile the hostile vacated.
 *
 * Vault is denied when:
 *   - A hostile is on the landing tile but the knockback destination is
 *     blocked (wall, OOB, occupied) — the Merc needs a clear lane.
 *   - A friendly entity occupies the landing tile.
 *   - The landing tile is not walkable terrain (FLOOR or EXIT).
 *
 * If the landing tile is empty, vault is pure repositioning (no damage).
 */
export class Merc extends Crew {
  override archetype = 'Merc';
  override get baseHitChance(): number {
    return 0.8;
  }

  constructor(props: CrewInit) {
    super({ ...props, glyph: '@' });
  }

  canVault(world: World, dx: number, dy: number) {
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

    const occupant = world.entityAt(landX, landY);
    if (occupant) {
      if (occupant.faction === this.faction) {
        // Can't body-check an ally.
        return { ok: false, reason: 'friendly-occupied' };
      }
      // Hostile on the landing tile — need a clear knockback lane.
      const kbX = landX + dx;
      const kbY = landY + dy;
      if (!world.grid.inBounds(kbX, kbY)) {
        return { ok: false, reason: 'knockback-oob' };
      }
      const kbTile = world.grid.tileAt(kbX, kbY);
      if (kbTile !== TILE.FLOOR && kbTile !== TILE.EXIT && kbTile !== TILE.COVER) {
        return { ok: false, reason: 'knockback-blocked' };
      }
      if (world.entityAt(kbX, kbY)) {
        return { ok: false, reason: 'knockback-occupied' };
      }
    }

    return { ok: true, occupant: occupant ?? null };
  }

  /**
   * Execute the vault. Moves the Merc, and if a hostile occupies the landing
   * tile, knocks them back first. Damage is applied by `applyIntent.doVault`
   * (not here) so that Merc.vault stays a pure movement+knockback operation
   * and Combat event wiring remains in the intent layer.
   *
   * Returns `{ occupant }` — the entity that was knocked back, or null.
   * The caller uses this to apply VAULT_DAMAGE via the damage system.
   */
  vault(world: World, dx: number, dy: number) {
    const check = this.canVault(world, dx, dy);
    if (!check.ok) {
      throw new Error(`Illegal vault for ${this.id}: ${check.reason}`);
    }

    const from = { x: this.x, y: this.y };
    const occupant = check.occupant;

    // Knockback hostile before Merc lands.
    if (occupant) {
      const kbFrom = { x: occupant.x, y: occupant.y };
      occupant.x += dx;
      occupant.y += dy;
      world.events?.emit(EVENT.ENTITY_MOVED, {
        entity: occupant,
        from: kbFrom,
        to: { x: occupant.x, y: occupant.y },
      });
    }

    this.spendAp(AP_COST.VAULT);
    this.x += 2 * dx;
    this.y += 2 * dy;
    // Emit ENTITY_MOVED so vision recompute and AI hooks pick the vault up
    // like any other reposition.
    world.events?.emit(EVENT.ENTITY_MOVED, {
      entity: this,
      from,
      to: { x: this.x, y: this.y },
    });

    return { occupant };
  }
}
