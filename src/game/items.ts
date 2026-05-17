/**
 * Shop item catalog for Finn's shop (M4).
 *
 * Items are plain descriptor objects — no class hierarchy. The catalog is a
 * static array filtered at query time by the campaign's `meta` state (the
 * `expandedCatalog` flag gates a future "rare" tier but no rare items exist
 * yet in Phase 2).
 *
 * Three persistence scopes:
 *   - `job`      — consumable, stored in `Crew.inventory.consumables`,
 *                   lost when the job ends.
 *   - `campaign` — gear bonus applied to a specific crew member, survives
 *                   across jobs, lost on campaign wipe.
 *   - `meta`     — permanent unlock (Hub upgrade), survives campaign wipe.
 *
 * Item effects are interpreted by the purchaser (`Campaign.purchase`) and
 * by the user (`Crew.useConsumable`, `Combat.resolveRanged`). This module
 * is pure data — no mutations, no DOM.
 */

import { SHOP_COST, STIM_HEAL, SMOKE_RADIUS, TARGETING_BONUS } from './constants.js';

export type Item = {
  id: string;
  label: string;
  scope: string;
  cost: number;
  description: string;
  needsTarget: boolean;
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
  ARMOUR_PLATING: 'armour-plating',
  TARGETING_CHIP: 'targeting-chip',
  EXPANDED_CATALOG: 'expanded-catalog',
});

/**
 * Full item catalog. Each entry is a frozen descriptor:
 *   - `id`          — unique key, matches ITEM_ID
 *   - `label`       — display name for the shop UI
 *   - `scope`       — ITEM_SCOPE value
 *   - `cost`        — salvage price
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
  }),
  Object.freeze({
    id: ITEM_ID.SMOKE_CHARGE,
    label: 'Smoke Charge',
    scope: ITEM_SCOPE.JOB,
    cost: SHOP_COST.SMOKE_CHARGE,
    description: `Blocks LOS in radius ${SMOKE_RADIUS} for 1 turn. Single use.`,
    needsTarget: true,
  }),
  Object.freeze({
    id: ITEM_ID.ARMOUR_PLATING,
    label: 'Armour Plating',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.ARMOUR_PLATING,
    description: '+1 max HP on target crew member.',
    needsTarget: true,
  }),
  Object.freeze({
    id: ITEM_ID.TARGETING_CHIP,
    label: 'Targeting Chip',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.TARGETING_CHIP,
    description: `+${(TARGETING_BONUS * 100).toFixed(0)}% ranged hit chance for target crew member.`,
    needsTarget: true,
  }),
  Object.freeze({
    id: ITEM_ID.EXPANDED_CATALOG,
    label: 'Expanded Catalog',
    scope: ITEM_SCOPE.META,
    cost: SHOP_COST.EXPANDED_CATALOG,
    description: 'Unlocks rare item tier in the shop.',
    needsTarget: false,
    unique: true,
  }),
]);

/**
 * Return the shop catalog filtered by the campaign's current meta state.
 * Meta items already purchased (and marked `unique`) are excluded.
 *
 * @param {{ expandedCatalog?: boolean }} meta — campaign meta-upgrade state
 * @returns {ReadonlyArray<Readonly<object>>}
 */
export function getShopCatalog(meta = {}) {
  return CATALOG.filter(item => {
    // Hide unique meta items that are already purchased.
    const metaKey = metaKeyFor(item.id);
    if (
      metaKey &&
      item.unique &&
      item.scope === ITEM_SCOPE.META &&
      meta[metaKey as keyof typeof meta]
    ) {
      return false;
    }
    // Future: items gated behind `metaGate` would check meta[item.metaGate].
    if (item.metaGate && !meta[item.metaGate as keyof typeof meta]) return false;
    return true;
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
 * Map an item ID to its meta-state key. Only meta-scope items have a
 * meaningful key; calling with a non-meta item returns `undefined`.
 */
export function metaKeyFor(itemId: string) {
  switch (itemId) {
    case ITEM_ID.EXPANDED_CATALOG:
      return 'expandedCatalog';
    default:
      return undefined;
  }
}
