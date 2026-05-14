import { Entity } from './Entity.js';
import { AP_COST } from './constants.js';

/**
 * Crew — the base class for every player-controlled archetype.
 *
 * Sits between `Entity` (generic grid-resident actor) and the archetype
 * classes (`Merc`, `Razor`, `Tech`). Adds the fields that distinguish a named
 * crew member from a generic entity:
 *
 *   - `callsign` — the in-fiction name a player remembers ("Glitch", "Cipher").
 *     Picked from each archetype's curated `CALLSIGNS` list by
 *     `buildCrewMember(archetypeId, spawn, rng)` in M1; deduplicated against
 *     campaign history by `Campaign.buildCrew` in M2. Defaults to `null` here
 *     so bare constructor tests can still exercise defaults; Campaign-created
 *     crew should always have a callsign.
 *   - `flatlined` — campaign-permanent death flag. `Entity.alive` is job-
 *     scoped (resets when a crew member is redeployed on a new job);
 *     `flatlined` is the persistent twin that says "this crew member is gone
 *     for good." Phase-2 design lock: a flatlined crew member is never
 *     deployed again, and `Campaign` ends when every member is flatlined.
 *     `M2` is when `Campaign.onJobEnd` flips this; for now it's a default-
 *     `false` stub the tests can assert on.
 *   - `inventory` / `gear` — stub fields reserved for M3 (`inventory.salvage`
 *     plus `consumables`) and M4 (Finn's shop applies gear bonuses). Both
 *     default to `null` so we don't leak shape decisions into Phase 2 code
 *     before M3/M4 lock them in; the no-silent-fallback rule means a caller
 *     that touches `crew.inventory.salvage` today will crash legibly with a
 *     null-deref, which is the failure mode we want before the schema lands.
 *
 * Why a base class, not a mixin? `Entity`'s class shape already carries
 * factional and combat invariants; the archetype subclasses extend that with
 * perk-specific verbs (`Merc.vault`, `Razor.slide`, future `Tech.deployTurret`).
 * Slotting `Crew` between the two keeps that single-inheritance chain clean
 * (`Entity → Crew → [Merc | Razor | Tech]`) and gives the perk methods
 * unambiguous access to crew-only state like `inventory` without leaking it
 * onto `Entity`. Drones, civilians, turrets, and Hub NPCs stay on `Entity`
 * and never see crew fields.
 */
export class Crew extends Entity {
  constructor({ callsign = null, flatlined = false, inventory = null, gear = null, ...rest } = {}) {
    super(rest);
    if (callsign !== null && (typeof callsign !== 'string' || callsign.length === 0)) {
      throw new TypeError(`Crew callsign must be a non-empty string or null, got ${callsign}`);
    }
    if (typeof flatlined !== 'boolean') {
      throw new TypeError(`Crew flatlined must be a boolean, got ${typeof flatlined}`);
    }
    this.callsign = callsign;
    this.flatlined = flatlined;
    /**
     * Inventory — `{ salvage: number, consumables: Item[] }` once
     * `initInventory()` has been called (at job deploy time in `Run`).
     * `null` before initialisation; callers that touch `.salvage` on a
     * null inventory crash legibly, which is the failure mode we want.
     */
    this.inventory = inventory;
    /** Stub for M4 — `{ maxHpBonus, hitBonus, … }` once Finn's shop lands. */
    this.gear = gear;
  }

  /**
   * Lock in the inventory schema. Idempotent — safe to call at the top of
   * every job deploy without clobbering mid-campaign state (e.g. salvage
   * accumulated but not yet extracted). Called by `Run.#makePlayer`.
   */
  initInventory() {
    if (this.inventory !== null) return;
    this.inventory = { salvage: 0, consumables: [] };
  }

  /**
   * Loot salvage from an adjacent corpse. Costs `AP_COST.INTERACT`.
   *
   * Pre-conditions (all throw on violation — crash > silent fallback):
   *   - `this.inventory` is initialised
   *   - crew member can afford INTERACT AP
   *   - `targetEntity` is not alive (must be a corpse)
   *   - `targetEntity` has a `loot` object with `salvage > 0`
   *   - `targetEntity` is Chebyshev-adjacent (distance ≤ 1) to this crew member
   *
   * On commit: debits AP, transfers loot.salvage to `this.inventory.salvage`,
   * zeroes `targetEntity.loot.salvage`.
   */
  collectSalvage(world, targetEntity) {
    if (!this.inventory) {
      throw new Error(`collectSalvage: inventory not initialised for ${this.id}`);
    }
    if (!this.canAfford(AP_COST.INTERACT)) {
      throw new Error(`collectSalvage: insufficient AP for ${this.id}`);
    }
    if (targetEntity.alive) {
      throw new Error(`collectSalvage: target ${targetEntity.id} is still alive`);
    }
    if (!targetEntity.loot || !targetEntity.loot.salvage || targetEntity.loot.salvage <= 0) {
      throw new Error(`collectSalvage: no salvage loot on ${targetEntity.id}`);
    }
    const dx = Math.abs(targetEntity.x - this.x);
    const dy = Math.abs(targetEntity.y - this.y);
    if (Math.max(dx, dy) > 1) {
      throw new Error(
        `collectSalvage: ${targetEntity.id} is not adjacent to ${this.id} (Chebyshev ${Math.max(dx, dy)})`
      );
    }
    this.spendAp(AP_COST.INTERACT);
    this.inventory.salvage += targetEntity.loot.salvage;
    targetEntity.loot.salvage = 0;
  }
}
