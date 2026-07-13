import { Entity } from './Entity.js';
import {
  AP_COST,
  BASE_HIT_CHANCE,
  DODGE_BONUS,
  DODGE_CHANCE,
  MELEE_DAMAGE,
  RANGED_DAMAGE,
  FACTION,
  STIM_HEAL,
  SMOKE_RADIUS,
  INCENDIARY_THROW_DIST,
  BREACHING_CHARGE_RANGE,
  TARGETING_BONUS,
  TURRET_DAMAGE,
  TURRET_MAX_HP,
  RANGED_DAMAGE_BONUS,
  RANGED_MAX_DAMAGE_BONUS,
  MELEE_DAMAGE_BONUS,
  MELEE_MAX_DAMAGE_BONUS,
  ARMOR_BONUS,
  MAX_ARMOR_BONUS,
  AP_BONUS,
  MAX_AP_BONUS,
  SHIELD_REGEN,
  MAX_SHIELD_REGEN,
  HP_REGEN,
  MAX_HP_REGEN,
  type FactionId,
} from './constants.js';
import { ITEM_ID } from './items.js';
import type { Item } from './items.js';
import type { World } from './World.js';
import type { EntityInit, LootableEntity } from './Entity.js';
import { emptySalvage, addSalvage, totalSalvage, type TypedSalvage } from './salvage.js';

export type Inventory = {
  salvage: TypedSalvage;
  consumables: Item[];
};

export type Gear = {
  maxHpBonus: number;
  hitBonus: number;
  dodgeBonus: number;
  rangedDamageBonus: number;
  /**
   * Net-new scoreable channels (P3.M6.2). Optional so pre-M6.2 gear snapshots
   * (which lack them) restore cleanly; consumers read `?? 0`.
   *   - `meleeDamageBonus` — Monoblade; added in {@link Crew.meleeAttackDamage}.
   *   - `armorBonus`       — Subdermal Plating; tracks the value applied to
   *                          `damageReduction` (the live combat stat).
   *   - `apBonus`          — Adrenal Spike; tracks the value added to `maxAp`.
   *   - `shieldRegen`      — Phase Shield; `shieldHp` re-granted each turn in
   *                          {@link Crew.refreshAp}.
   *   - `hpRegen`          — Regen Mesh; HP healed each turn in the same hook.
   * `armorBonus`/`apBonus` mirror `maxHpBonus`: the live stat is the source of
   * truth in combat, the bonus field exists for cap-clamping on restore.
   * `shieldRegen`/`hpRegen` are pure per-turn effect rates (no live-stat twin).
   */
  meleeDamageBonus?: number;
  armorBonus?: number;
  apBonus?: number;
  shieldRegen?: number;
  hpRegen?: number;
};

/**
 * P2.7.M6.2: shared crew snapshot `extra`. Merc/Razor carry exactly this; the
 * Tech extends it with `turretReady`. Bag-hygienic — `null`, never `undefined`.
 */
export type CrewSnapshot = {
  callsign: string | null;
  flatlined: boolean;
  inventory: Inventory | null;
  gear: Gear | null;
};

const createDefaultInventory = (): Inventory => ({ salvage: emptySalvage(), consumables: [] });
const createDefaultGear = (): Gear => ({
  maxHpBonus: 0,
  hitBonus: 0,
  dodgeBonus: 0,
  rangedDamageBonus: 0,
  meleeDamageBonus: 0,
  armorBonus: 0,
  apBonus: 0,
  shieldRegen: 0,
  hpRegen: 0,
});

/**
 * Crew — the base class for every player-controlled archetype.
 *
 * Sits between `Entity` (generic grid-resident actor) and the archetype
 * classes (`Merc`, `Razor`, `Tech`). Adds the fields that distinguish a named
 * crew member from a generic entity:
 *
 *   - `callsign` — the in-fiction name a player remembers ("Glitch", "Cipher").
 *     Picked from each archetype's curated `CALLSIGNS` list by
 *     `buildCrewMember(archetypeId, spawn, rng)`; deduplicated against campaign
 *     history by `Campaign.buildCrew`. Defaults to `null` so bare constructor
 *     tests can still exercise defaults; Campaign-created crew should always
 *     have a callsign.
 *   - `flatlined` — campaign-permanent death flag. `Entity.alive` is job-
 *     scoped (resets when a crew member is redeployed on a new job);
 *     `flatlined` is the persistent twin that says "this crew member is gone
 *     for good." A flatlined crew member is never deployed again, and
 *     `Campaign` ends when every member is flatlined.
 *   - `inventory` (`inventory.salvage` + `consumables`) and `gear` (Finn's
 *     shop bonuses) default to `null` so tests can exercise Crew without a
 *     full shop/salvage setup; callers that access these fields before
 *     initializing them crash on null-deref rather than silently corrupting.
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
  // not a valid archetype; Crew is essentially an abstract base class for all player-controlled entities
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

  /**
   * Archetype base ranged damage (gear excluded). Overridden on Merc; Tech and
   * Razor use {@link RANGED_DAMAGE}. Outgoing shot damage is
   * {@link rangedAttackDamage} (base + RiP Rounds).
   */
  get rangedDamage(): number {
    return RANGED_DAMAGE;
  }

  /**
   * Flat melee damage for this crew member's blade/fists. Overridden on Razor;
   * Merc and Tech use {@link MELEE_DAMAGE}. Read by `Combat.resolveMelee` and
   * `applyIntent.doMelee`.
   */
  get meleeDamage(): number {
    return MELEE_DAMAGE;
  }

  /** Maximum gear hit bonus this crew member can accumulate (= 1 − baseHitChance). */
  get maxHitBonus(): number {
    return 1 - this.baseHitChance;
  }

  /** Maximum gear dodge bonus this crew member can accumulate (= 1 − baseDodgeChance). */
  get maxDodgeBonus(): number {
    return 1 - this.baseDodgeChance;
  }

  /** Cap for {@link ITEM_ID.RIP_ROUNDS} stacks on this operator. */
  get maxRangedDamageBonus(): number {
    return RANGED_MAX_DAMAGE_BONUS;
  }

  /** Capped RiP Rounds bonus for this operator's outgoing ranged damage. */
  get effectiveRangedDamageBonus(): number {
    return Math.min(this.gear?.rangedDamageBonus ?? 0, this.maxRangedDamageBonus);
  }

  /** Outgoing ranged damage for this crew member (archetype base + gear). */
  rangedAttackDamage(): number {
    return this.rangedDamage + this.effectiveRangedDamageBonus;
  }

  /** Cap for {@link ITEM_ID.MONOBLADE} melee-damage bonus on this operator. */
  get maxMeleeDamageBonus(): number {
    return MELEE_MAX_DAMAGE_BONUS;
  }

  /** Capped Monoblade bonus for this operator's outgoing melee damage. */
  get effectiveMeleeDamageBonus(): number {
    return Math.min(this.gear?.meleeDamageBonus ?? 0, this.maxMeleeDamageBonus);
  }

  /**
   * Outgoing melee damage for this crew member (archetype base + gear). Mirrors
   * {@link rangedAttackDamage}; `Combat.resolveMelee` prefers this method over
   * the bare `meleeDamage` getter so the Monoblade bonus lands without each
   * archetype having to re-implement its `meleeDamage` override.
   */
  meleeAttackDamage(): number {
    return this.meleeDamage + this.effectiveMeleeDamageBonus;
  }

  /** Cap for the {@link ITEM_ID.SUBDERMAL_PLATING} armour bonus. */
  get maxArmorBonus(): number {
    return MAX_ARMOR_BONUS;
  }

  /** Cap for the {@link ITEM_ID.ADRENAL_SPIKE} AP bonus. */
  get maxApBonus(): number {
    return MAX_AP_BONUS;
  }

  /** Cap for the {@link ITEM_ID.PHASE_SHIELD} per-turn shield regen. */
  get maxShieldRegen(): number {
    return MAX_SHIELD_REGEN;
  }

  /** Cap for the {@link ITEM_ID.REGEN_MESH} per-turn HP regen. */
  get maxHpRegen(): number {
    return MAX_HP_REGEN;
  }

  /**
   * Stats for a player turret this crew member deploys (Tech). HP is the
   * turret's own base (`TURRET_MAX_HP`) — a machine, so it does NOT inherit
   * owner body augments like Bone Lacing. Damage still inherits the owner's
   * ranged (RiP Rounds) bonus on the turret base (`TURRET_DAMAGE`).
   */
  turretDeployProfile(): { maxHp: number; attackDamage: number } {
    return {
      maxHp: TURRET_MAX_HP,
      attackDamage: TURRET_DAMAGE + this.effectiveRangedDamageBonus,
    };
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
      case ITEM_ID.BONE_LACING:
        this.gear!.maxHpBonus += 1;
        this.maxHp += 1;
        this.hp += 1; // immediate benefit — no need to heal it
        break;
      case ITEM_ID.TARGETING_CHIP:
        this.gear!.hitBonus = Math.min(this.gear!.hitBonus + TARGETING_BONUS, this.maxHitBonus);
        break;
      case ITEM_ID.GHOST_WEAVE:
        this.gear!.dodgeBonus = Math.min(
          (this.gear!.dodgeBonus ?? 0) + DODGE_BONUS,
          this.maxDodgeBonus
        );
        break;
      case ITEM_ID.RIP_ROUNDS:
        this.gear!.rangedDamageBonus = Math.min(
          (this.gear!.rangedDamageBonus ?? 0) + RANGED_DAMAGE_BONUS,
          this.maxRangedDamageBonus
        );
        break;
      case ITEM_ID.MONOBLADE:
        // Tracking-only bonus, read via `meleeAttackDamage`. Capped like RiP Rounds.
        this.gear!.meleeDamageBonus = Math.min(
          (this.gear!.meleeDamageBonus ?? 0) + MELEE_DAMAGE_BONUS,
          this.maxMeleeDamageBonus
        );
        break;
      case ITEM_ID.SUBDERMAL_PLATING: {
        // Mirror Bone Lacing: `damageReduction` is the live stat, `armorBonus`
        // tracks it. Delta-apply so a capped second purchase is a no-op.
        const next = Math.min((this.gear!.armorBonus ?? 0) + ARMOR_BONUS, this.maxArmorBonus);
        this.damageReduction += next - (this.gear!.armorBonus ?? 0);
        this.gear!.armorBonus = next;
        break;
      }
      case ITEM_ID.ADRENAL_SPIKE: {
        // `maxAp` is the live stat, `apBonus` tracks it. Immediate benefit: the
        // extra AP is available this turn too (matches Bone Lacing's +hp).
        const next = Math.min((this.gear!.apBonus ?? 0) + AP_BONUS, this.maxApBonus);
        const delta = next - (this.gear!.apBonus ?? 0);
        this.maxAp += delta;
        this.ap += delta;
        this.gear!.apBonus = next;
        break;
      }
      case ITEM_ID.PHASE_SHIELD:
        // Per-turn effect rate — applied in `refreshAp`, not a live stat here.
        this.gear!.shieldRegen = Math.min(
          (this.gear!.shieldRegen ?? 0) + SHIELD_REGEN,
          this.maxShieldRegen
        );
        break;
      case ITEM_ID.REGEN_MESH:
        this.gear!.hpRegen = Math.min((this.gear!.hpRegen ?? 0) + HP_REGEN, this.maxHpRegen);
        break;
      default:
        throw new Error(`Crew.applyGear: unknown gear item "${itemId}"`);
    }
  }

  /**
   * Whether this operator has already saturated a campaign-scoped gear item —
   * i.e. re-applying it would be a stat no-op (`applyGear` clamps every channel
   * with `Math.min`). This is the guardrail source of truth shared by
   * `Campaign.purchase` (which refuses the sale rather than silently pocketing
   * Creds) and the shop UI (which greys out an already-equipped operator).
   *
   * Every net-new P3.M6.2 item is limit-1 (`bonus === cap`), so one purchase
   * saturates it; the older stacking gear (Targeting Chip, Ghost Weave) reports
   * saturated only once fully stacked to its per-archetype cap. Bone Lacing is
   * unbounded (no cap) and therefore never saturates — it stays re-purchasable.
   *
   * Throws on a non-gear id: only CAMPAIGN-scope items reach here, and a typo
   * should crash rather than silently report "not at cap" (which would let a
   * broken caller waste Creds).
   */
  gearAtCap(itemId: string): boolean {
    const g = this.gear;
    switch (itemId) {
      case ITEM_ID.BONE_LACING:
        return false; // unbounded (+1 maxHp per purchase) — never saturates
      case ITEM_ID.TARGETING_CHIP:
        return (g?.hitBonus ?? 0) >= this.maxHitBonus;
      case ITEM_ID.GHOST_WEAVE:
        return (g?.dodgeBonus ?? 0) >= this.maxDodgeBonus;
      case ITEM_ID.RIP_ROUNDS:
        return (g?.rangedDamageBonus ?? 0) >= this.maxRangedDamageBonus;
      case ITEM_ID.MONOBLADE:
        return (g?.meleeDamageBonus ?? 0) >= this.maxMeleeDamageBonus;
      case ITEM_ID.SUBDERMAL_PLATING:
        return (g?.armorBonus ?? 0) >= this.maxArmorBonus;
      case ITEM_ID.ADRENAL_SPIKE:
        return (g?.apBonus ?? 0) >= this.maxApBonus;
      case ITEM_ID.PHASE_SHIELD:
        return (g?.shieldRegen ?? 0) >= this.maxShieldRegen;
      case ITEM_ID.REGEN_MESH:
        return (g?.hpRegen ?? 0) >= this.maxHpRegen;
      default:
        throw new Error(`Crew.gearAtCap: unknown gear item "${itemId}"`);
    }
  }

  /**
   * Refresh AP at the start of this crew member's turn, then apply per-turn
   * gear regen (P3.M6.2). `super.refreshAp` (Entity) zeroes `shieldHp`, so the
   * Phase Shield re-grant here tops the buffer back to `shieldRegen` each turn
   * — free and automatic, unlike the Medic's AP-costed top-up. Regen Mesh heals
   * real HP up to max. Both are guarded: a flatlined/dead body regenerates
   * nothing (`addShield`/`heal` would otherwise throw on a corpse).
   *
   * Razor overrides this to also clear stealth; its `super.refreshAp()` chains
   * through here, so the Razor benefits from regen gear too.
   */
  override refreshAp(): void {
    super.refreshAp();
    if (!this.alive || !this.gear) return;
    const hpRegen = this.gear.hpRegen ?? 0;
    if (hpRegen > 0) this.heal(hpRegen);
    const shieldRegen = this.gear.shieldRegen ?? 0;
    if (shieldRegen > 0) this.addShield(shieldRegen);
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
   * Returns a result descriptor so the shell can apply world effects (smoke,
   * incendiary cluster).
   *
   * Pre-conditions (all throw):
   *   - inventory is initialised
   *   - crew member can afford INTERACT AP
   *   - consumable exists in inventory
   *   - aim is supplied iff the consumable is aimed (incendiary). Mismatched
   *     aim presence is a programming error, not a player error.
   *
   * On commit: debits AP, removes the consumable from inventory, applies
   * immediate effects (Stim heals HP). World mutations (smoke, hazard) are
   * returned as descriptors so the shell can stamp tiles (keeping Crew pure
   * of World).
   *
   * @param itemId  consumable id from `ITEM_ID`
   * @param aim     `{ dx, dy }` unit vector for thrown items (e.g. incendiary, breaching charge).
   *                Omit for self-targeted items (stim, smoke).
   */
  useConsumable(itemId: string, aim?: { dx: number; dy: number }) {
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
    // Validate aim/no-aim symmetry before mutating state — a mismatched call
    // is a wiring bug in the shell, not a recoverable runtime condition.
    const isAimed = itemId === ITEM_ID.MOLOTOV || itemId === ITEM_ID.BREACHING_CHARGE;
    if (isAimed && !aim) {
      throw new Error(`useConsumable: "${itemId}" requires aim direction`);
    }
    if (!isAimed && aim) {
      throw new Error(`useConsumable: "${itemId}" does not accept aim direction`);
    }
    if (aim) {
      const { dx, dy } = aim;
      if (
        !Number.isInteger(dx) ||
        !Number.isInteger(dy) ||
        (dx === 0 && dy === 0) ||
        Math.abs(dx) > 1 ||
        Math.abs(dy) > 1
      ) {
        throw new Error(
          `useConsumable: invalid aim (${dx}, ${dy}) for "${itemId}" — must be a non-zero integer unit vector`
        );
      }
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
      case ITEM_ID.MOLOTOV: {
        // Thrown: target tile is `thrower + dir * INCENDIARY_THROW_DIST`.
        // LOS-clear-target validation is the shell's job (it owns the Grid /
        // World refs); Crew just reports the intended center. The shell may
        // refuse to stamp if LOS is blocked or the tile is out of bounds — in
        // that case Crew has already paid AP and consumed the charge, which
        // matches stim's "used up on commit" semantics. The shell should
        // gate before calling, not after.
        const { dx, dy } = aim!;
        const cx = this.x + dx * INCENDIARY_THROW_DIST;
        const cy = this.y + dy * INCENDIARY_THROW_DIST;
        return { type: 'incendiary', cx, cy };
      }
      case ITEM_ID.BREACHING_CHARGE: {
        const { dx, dy } = aim!;
        const tx = this.x + dx * BREACHING_CHARGE_RANGE;
        const ty = this.y + dy * BREACHING_CHARGE_RANGE;
        return { type: 'breach', tx, ty };
      }
      default:
        throw new Error(`useConsumable: unknown consumable "${itemId}"`);
    }
  }

  /**
   * Loot salvage from an adjacent corpse. Costs `AP_COST.INTERACT` by default.
   * Walk-onto salvage may pass `{ spendAp: false }` after movement has already
   * paid AP, matching consumable pickup semantics without weakening the
   * standalone interact cost.
   *
   * Pre-conditions (all throw on violation — crash > silent fallback):
   *   - `this.inventory` is initialised
   *   - crew member can afford INTERACT AP
   *   - `targetEntity` is not alive (must be a corpse)
   *   - `targetEntity` has a `loot` object with `salvage > 0`
   *   - `targetEntity` is Chebyshev-adjacent (distance ≤ 1) to this crew member
   *
   * On commit: debits AP unless `spendAp` is false, transfers loot.salvage to
   * `this.inventory.salvage`, then **removes the stripped corpse from the
   * world entirely** — no phantom tile, no zero-loot lingering corpse.
   * Closes the kaizen "corpse memory / lootability" line for drones; future
   * non-drone lootable entities (if introduced) inherit the same rule.
   */
  collectSalvage(world: World, targetEntity: LootableEntity, options: { spendAp?: boolean } = {}) {
    const spendAp = options.spendAp ?? true;
    if (!this.inventory) {
      throw new Error(`collectSalvage: inventory not initialised for ${this.id}`);
    }
    if (spendAp && !this.canAfford(AP_COST.INTERACT)) {
      throw new Error(`collectSalvage: insufficient AP for ${this.id}`);
    }
    if (targetEntity.alive) {
      throw new Error(`collectSalvage: target ${targetEntity.id} is still alive`);
    }
    if (!targetEntity.loot || !targetEntity.loot.salvage) {
      throw new Error(`collectSalvage: no salvage loot on ${targetEntity.id}`);
    }
    if (totalSalvage(targetEntity.loot.salvage) <= 0) {
      throw new Error(`collectSalvage: no salvage loot on ${targetEntity.id}`);
    }
    const dx = Math.abs(targetEntity.x - this.x);
    const dy = Math.abs(targetEntity.y - this.y);
    if (Math.max(dx, dy) > 1) {
      throw new Error(
        `collectSalvage: ${targetEntity.id} is not adjacent to ${this.id} (Chebyshev ${Math.max(dx, dy)})`
      );
    }
    if (spendAp) {
      this.spendAp(AP_COST.INTERACT);
    }
    // Fold the corpse's typed loot into the crew member's typed wallet, then
    // zero each bucket on the corpse before removing it.
    addSalvage(this.inventory.salvage, targetEntity.loot.salvage);
    targetEntity.loot.salvage = emptySalvage();
    // Strip the corpse from the world so the tile renders as empty and no
    // longer registers in `anyEntityAt` / `lootableCorpseAt`.
    world.removeEntity(targetEntity.id);
  }
}
