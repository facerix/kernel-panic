/**
 * Shop item catalog for Finn's shop.
 *
 * Items are plain descriptor objects — no class hierarchy. The catalog is a
 * static array; meta upgrades were removed in P2.5.M5.1 (Rep tiers replace them).
 *
 * Two persistence scopes:
 *   - `job`      — consumable, stored in `Crew.inventory.consumables`,
 *                   lost when the job ends.
 *   - `campaign` — gear bonus applied to a specific crew member, survives
 *                   across jobs, lost on campaign wipe.
 *
 * Item effects are interpreted by the purchaser (`Campaign.purchase`) and
 * by the user (`Crew.useConsumable`, `Combat.resolveRanged`). This module
 * is pure data — no mutations, no DOM.
 */

import {
  SHOP_COST,
  STIM_HEAL,
  SMOKE_RADIUS,
  INCENDIARY_THROW_DIST,
  BREACHING_CHARGE_RANGE,
  TARGETING_BONUS,
  DODGE_BONUS,
  RANGED_DAMAGE_BONUS,
  REP_TIER,
  repTierForRep,
  type RepTierId,
} from './constants.js';

export type Item = {
  id: string;
  label: string;
  scope: string;
  cost: number;
  description: string;
  /**
   * Purchase target — `true` for items that apply to a specific crew member
   * (gear, single-use stim, etc.); `false` for campaign-wide unlocks. Used
   * by `<finn-shop>` to gate the purchase confirmation flow.
   */
  needsTarget: boolean;
  /**
   * In-combat aim flag. `true` for thrown consumables that resolve along a
   * (dx, dy) direction selected via `MODE.AIM` / `aimKind: 'use-item'`.
   * Default `false` — stim self-targets, smoke auto-centers on the thrower.
   * The inventory overlay reads this to decide whether to emit a plain
   * `use-item` event or hand control to direction picking.
   */
  needsAim?: boolean;
  /**
   * Minimum Rep tier required for this item to appear in Finn's shop (P2.5.M5.2).
   * Items below the player's current tier are hidden. Progression:
   *   BURNED  → Stim only
   *   UNKNOWN → + Smoke Charge, Incendiary Bomb
   *   KNOWN   → + Armour Plating, Targeting Chip, Reflex Weave
   *   TRUSTED → all (future expansion)
   *
   * Optional on the type because inventory-stored items (consumable records)
   * don't carry shop metadata.
   */
  minRepTier?: RepTierId;
  unique?: boolean;
  metaGate?: string;
};

export const ITEM_SCOPE = Object.freeze({
  JOB: 'job',
  CAMPAIGN: 'campaign',
  META: 'meta',
});

export const ITEM_ID = Object.freeze({
  STIM: 'stim',
  SMOKE_CHARGE: 'smoke-charge',
  INCENDIARY: 'incendiary',
  BREACHING_CHARGE: 'breaching-charge',
  ARMOUR_PLATING: 'armour-plating',
  TARGETING_CHIP: 'targeting-chip',
  REFLEX_WEAVE: 'reflex-weave',
  BALLISTICS_COIL: 'ballistics-coil',
});

/**
 * Full item catalog. Each entry is a frozen descriptor:
 *   - `id`          — unique key, matches ITEM_ID
 *   - `label`       — display name for the shop UI
 *   - `scope`       — ITEM_SCOPE value
 *   - `cost`        — Cred price
 *   - `description` — one-line effect summary for the shop
 *   - `needsTarget` — true if purchase requires a target crew member
 *   - `metaGate`    — if set, item only appears when `meta[metaGate]` is truthy
 *   - `unique`      — if true, can only be purchased once (meta-scope items)
 */
const CATALOG: readonly Item[] = Object.freeze([
  Object.freeze({
    id: ITEM_ID.STIM,
    label: 'Stim',
    scope: ITEM_SCOPE.JOB,
    cost: SHOP_COST.STIM,
    description: `Restores ${STIM_HEAL} HP to the deployed crew member. Single use.`,
    needsTarget: true,
    minRepTier: REP_TIER.BURNED,
  }),
  Object.freeze({
    id: ITEM_ID.SMOKE_CHARGE,
    label: 'Smoke Charge',
    scope: ITEM_SCOPE.JOB,
    cost: SHOP_COST.SMOKE_CHARGE,
    description: `Blocks LOS in radius ${SMOKE_RADIUS} for 1 turn. Single use.`,
    needsTarget: true,
    minRepTier: REP_TIER.UNKNOWN,
  }),
  Object.freeze({
    id: ITEM_ID.INCENDIARY,
    label: 'Incendiary Bomb',
    scope: ITEM_SCOPE.JOB,
    cost: SHOP_COST.INCENDIARY,
    description: `Throw ${INCENDIARY_THROW_DIST} tiles in a chosen direction; ignites a persistent hazard cluster. Single use.`,
    needsTarget: true,
    needsAim: true,
    minRepTier: REP_TIER.UNKNOWN,
  }),
  Object.freeze({
    id: ITEM_ID.BREACHING_CHARGE,
    label: 'Breaching Charge',
    scope: ITEM_SCOPE.JOB,
    cost: SHOP_COST.BREACHING_CHARGE,
    description: `Destroy a wall, locked door, or reinforced objective within ${BREACHING_CHARGE_RANGE} tile. Single use.`,
    needsTarget: true,
    needsAim: true,
    minRepTier: REP_TIER.UNKNOWN,
  }),
  Object.freeze({
    id: ITEM_ID.REFLEX_WEAVE,
    label: 'Reflex Weave',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.REFLEX_WEAVE,
    description: `+${(DODGE_BONUS * 100).toFixed(0)}% melee dodge chance.`,
    needsTarget: true,
    minRepTier: REP_TIER.KNOWN,
  }),
  Object.freeze({
    id: ITEM_ID.TARGETING_CHIP,
    label: 'Targeting Chip',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.TARGETING_CHIP,
    description: `+${(TARGETING_BONUS * 100).toFixed(0)}% ranged hit chance.`,
    needsTarget: true,
    minRepTier: REP_TIER.KNOWN,
  }),
  Object.freeze({
    id: ITEM_ID.ARMOUR_PLATING,
    label: 'Armour Plating',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.ARMOUR_PLATING,
    description: "+1 max HP (Tech's turrets deploy at that max HP).",
    needsTarget: true,
    minRepTier: REP_TIER.KNOWN,
  }),
  Object.freeze({
    id: ITEM_ID.BALLISTICS_COIL,
    label: 'Ballistics Coil',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.BALLISTICS_COIL,
    description: `+${RANGED_DAMAGE_BONUS} ranged damage (Tech's turrets inherit the bonus).`,
    needsTarget: true,
    minRepTier: REP_TIER.KNOWN,
  }),
]);

/**
 * Rep tier ordering for comparison — index 0 is lowest tier. Used by
 * `getShopCatalog` to filter items whose `minRepTier` exceeds the player's
 * current tier.
 */
const TIER_ORDER: readonly RepTierId[] = [
  REP_TIER.BURNED,
  REP_TIER.UNKNOWN,
  REP_TIER.KNOWN,
  REP_TIER.TRUSTED,
];

/**
 * Return the shop catalog filtered by the player's current Rep. Items whose
 * `minRepTier` exceeds the player's tier are hidden — the shop grows as
 * standing improves.
 *
 * @param rep — campaign Rep value (0–100). Defaults to REP.START (20) so
 *   callers that omit it see the UNKNOWN-tier catalog.
 */
export function getShopCatalog(rep: number = 20) {
  const currentTier = repTierForRep(rep);
  const currentIndex = TIER_ORDER.indexOf(currentTier.id);
  return CATALOG.filter(item => {
    const itemTier = item.minRepTier ?? REP_TIER.BURNED;
    const itemIndex = TIER_ORDER.indexOf(itemTier);
    return itemIndex <= currentIndex;
  });
}

/**
 * Look up a single item descriptor by id. Throws on unknown id — no silent
 * fallback for a typo in a purchase call.
 */
export function getItemById(itemId: string) {
  const item = CATALOG.find(i => i.id === itemId);
  if (!item) {
    throw new Error(`getItemById: unknown item "${itemId}"`);
  }
  return item;
}

/**
 * Map an item ID to its meta-state key. P2.5.M5.1 removed all meta-scope items
 * (Rep tiers replace them), so this always returns `undefined`. Retained for
 * backward compat with `Campaign.purchase` — a future meta item would add
 * a case here.
 */
export function metaKeyFor(_itemId: string) {
  return undefined;
}
