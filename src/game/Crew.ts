import { Entity } from './Entity.js';
import {
  AP_COST,
  BASE_HIT_CHANCE,
  DODGE_BONUS,
  DODGE_CHANCE,
  FACTION,
  STIM_HEAL,
  SMOKE_RADIUS,
  TARGETING_BONUS,
  type FactionId,
} from './constants.js';
import { ITEM_ID } from './items.js';
import type { Item } from './items.js';
import type { World } from './World.js';
import type { EntityInit, LootableEntity } from './Entity.js';

export type Inventory = {
  salvage: number;
  consumables: Item[];
};

export type Gear = {
  maxHpBonus: number;
  hitBonus: number;
  dodgeBonus: number;
};

const createDefaultInventory = (): Inventory => ({ salvage: 0, consumables: [] });
const createDefaultGear = (): Gear => ({ maxHpBonus: 0, hitBonus: 0, dodgeBonus: 0 });

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

/** Player crew omit `faction` — it defaults to {@link FACTION.PLAYER} in `Crew`. */
export interface CrewInit extends Omit<EntityInit, 'faction'> {
  faction?: FactionId;
  callsign?: string | null;
  flatlined?: boolean;
  inventory?: Inventory | null;
  gear?: Gear | null;
}

export class Crew extends Entity {
  callsign: string | null;
  flatlined: boolean;
  inventory: Inventory | null;
  gear: Gear | null;
  archetype: string = 'CrewMember';

  /**
   * Base ranged hit probability for this crew member, before gear bonuses.
   * Overridden per archetype: Merc 0.8, Tech 0.75, Razor 0.7. Falls back to
   * `BASE_HIT_CHANCE` (the universal drone/turret default) so a bare `Crew`
   * in tests behaves sensibly.
   */
  get baseHitChance(): number {
    return BASE_HIT_CHANCE;
  }

  /**
   * Base melee dodge probability for this crew member (before cover bonus).
   * Overridden on Razor; other archetypes use {@link DODGE_CHANCE}.
   */
  get baseDodgeChance(): number {
    return DODGE_CHANCE;
  }

  /** Maximum gear hit bonus this crew member can accumulate (= 1 − baseHitChance). */
  get maxHitBonus(): number {
    return 1 - this.baseHitChance;
  }

  /** Maximum gear dodge bonus this crew member can accumulate (= 1 − baseDodgeChance). */
  get maxDodgeBonus(): number {
    return 1 - this.baseDodgeChance;
  }

  constructor({
    callsign = null,
    flatlined = false,
    inventory = null,
    gear = null,
    ...rest
  }: CrewInit) {
    super({
      ...rest,
      faction: rest.faction ?? FACTION.PLAYER,
    });
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
    /**
     * Permanent gear bonuses purchased from Finn's shop (campaign-scoped).
     * `{ maxHpBonus, hitBonus, dodgeBonus }`. Defaults to `null` until
     * the first gear purchase; `initGear()` locks in the schema. Combat and
     * persistence read `gear?.hitBonus ?? 0` etc. so `null` is safe.
     */
    this.gear = gear;
  }

  /**
   * Lock in the inventory schema. Idempotent — safe to call at the top of
   * every job deploy without clobbering mid-campaign state (e.g. salvage
   * accumulated but not yet extracted). Called by `Run.#makePlayer`.
   */
  initInventory() {
    if (this.inventory !== null) return;
    this.inventory = createDefaultInventory();
  }

  /**
   * Ensure the gear schema is set. Idempotent — safe to call before every
   * gear-modifying operation. Called by `Campaign.purchase` on the first
   * crew-gear purchase.
   */
  initGear() {
    if (this.gear !== null) return;
    this.gear = createDefaultGear();
  }

  /**
   * Apply a campaign-scoped gear bonus. Mutates both `this.gear` (tracking)
   * and the underlying stat (`maxHp`, etc.) so the bonus is immediately
   * effective. Throws on unknown gear items — crash over silent fallback.
   */
  applyGear(itemId: string) {
    this.initGear();
    switch (itemId) {
      case ITEM_ID.ARMOUR_PLATING:
        this.gear!.maxHpBonus += 1;
        this.maxHp += 1;
        this.hp += 1; // immediate benefit — no need to heal it
        break;
      case ITEM_ID.TARGETING_CHIP:
        this.gear!.hitBonus = Math.min(this.gear!.hitBonus + TARGETING_BONUS, this.maxHitBonus);
        break;
      case ITEM_ID.REFLEX_WEAVE:
        this.gear!.dodgeBonus = Math.min(
          (this.gear!.dodgeBonus ?? 0) + DODGE_BONUS,
          this.maxDodgeBonus
        );
        break;
      default:
        throw new Error(`Crew.applyGear: unknown gear item "${itemId}"`);
    }
  }

  /**
   * Add a consumable to inventory for the next job. Initialises inventory if
   * null (purchase can happen before deploy). The consumable is a plain
   * `{ id }` record — enough for `useConsumable` to dispatch on.
   */
  addConsumable(itemId: string) {
    this.initInventory();
    this.inventory!.consumables.push({
      id: itemId,
      label: '',
      scope: '',
      cost: 0,
      description: '',
      needsTarget: false,
    });
  }

  /**
   * Use a consumable from inventory during combat. Costs `AP_COST.INTERACT`.
   * Returns a result descriptor so the shell can apply world effects (smoke).
   *
   * Pre-conditions (all throw):
   *   - inventory is initialised
   *   - crew member can afford INTERACT AP
   *   - consumable exists in inventory
   *
   * On commit: debits AP, removes the consumable from inventory, applies
   * immediate effects (Stim heals HP). Smoke placement is returned as a
   * result for the shell to apply to the grid (keeping Crew pure of World).
   */
  useConsumable(itemId: string) {
    if (!this.inventory) {
      throw new Error(`useConsumable: inventory not initialised for ${this.id}`);
    }
    if (!this.canAfford(AP_COST.INTERACT)) {
      throw new Error(`useConsumable: insufficient AP for ${this.id}`);
    }
    const idx = this.inventory.consumables.findIndex(c => c.id === itemId);
    if (idx === -1) {
      throw new Error(`useConsumable: ${this.id} does not have "${itemId}"`);
    }
    this.spendAp(AP_COST.INTERACT);
    this.inventory.consumables.splice(idx, 1);

    switch (itemId) {
      case ITEM_ID.STIM: {
        const healed = Math.min(STIM_HEAL, this.maxHp - this.hp);
        this.hp += healed;
        return { type: 'stim', healed };
      }
      case ITEM_ID.SMOKE_CHARGE:
        // Smoke placement is a world mutation — return a descriptor so the
        // shell can place SMOKE tiles on the grid. The crew member's position
        // is the center; radius comes from constants.
        return { type: 'smoke', cx: this.x, cy: this.y, radius: SMOKE_RADIUS };
      default:
        throw new Error(`useConsumable: unknown consumable "${itemId}"`);
    }
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
  collectSalvage(world: World, targetEntity: LootableEntity) {
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
