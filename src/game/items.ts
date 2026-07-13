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
  MELEE_DAMAGE_BONUS,
  ARMOR_BONUS,
  AP_BONUS,
  SHIELD_REGEN,
  HP_REGEN,
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
   * Heist fiction for a scoreable item — one line describing what was stolen
   * (P3.M6.2). Surfaced by the Score briefing copy in M6.4. Present on every
   * {@link SCOREABLE_ITEMS} entry, absent on default stock and consumable records.
   */
  flavor?: string;
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
  MOLOTOV: 'incendiary',
  BREACHING_CHARGE: 'breaching-charge',
  BONE_LACING: 'armour-plating',
  TARGETING_CHIP: 'targeting-chip',
  GHOST_WEAVE: 'reflex-weave',
  RIP_ROUNDS: 'ballistics-coil',
  // Net-new scoreable gear (P3.M6.2) — each fills a previously-untouched stat
  // channel (melee dmg, flat armour, AP, shield regen, HP regen).
  MONOBLADE: 'monoblade',
  SUBDERMAL_PLATING: 'subdermal-plating',
  ADRENAL_SPIKE: 'reflex-booster',
  PHASE_SHIELD: 'phase-shield',
  REGEN_MESH: 'regen-mesh',
});

/**
 * Two explicit catalogs replace the old single rep-gated list (P3.M6.2). Each
 * entry is a frozen descriptor:
 *   - `id`          — unique key, matches ITEM_ID
 *   - `label`       — display name for the shop UI
 *   - `scope`       — ITEM_SCOPE value
 *   - `cost`        — Cred price
 *   - `description` — one-line effect summary for the shop
 *   - `needsTarget` — true if purchase requires a target crew member
 *   - `needsAim`    — true if the consumable resolves along an aim direction
 *   - `flavor`      — (scoreable only) one line describing the stolen prototype
 *   - `metaGate`    — if set, item only appears when `meta[metaGate]` is truthy
 *   - `unique`      — if true, can only be purchased once (meta-scope items)
 *
 * **`DEFAULT_ITEMS`** — Finn's permanent stock. Always available from campaign
 * start, no condition, no gate (the old BURNED/UNKNOWN consumables).
 */
export const DEFAULT_ITEMS: readonly Item[] = Object.freeze([
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
    id: ITEM_ID.MOLOTOV,
    label: 'Molotov',
    scope: ITEM_SCOPE.JOB,
    cost: SHOP_COST.MOLOTOV,
    description: `Throw ${INCENDIARY_THROW_DIST} tiles in a chosen direction; ignites a persistent hazard cluster. Single use.`,
    needsTarget: true,
    needsAim: true,
  }),
  Object.freeze({
    id: ITEM_ID.BREACHING_CHARGE,
    label: 'Breaching Charge',
    scope: ITEM_SCOPE.JOB,
    cost: SHOP_COST.BREACHING_CHARGE,
    description: `Destroy a wall, locked door, or reinforced objective within ${BREACHING_CHARGE_RANGE} tile. Single use.`,
    needsTarget: true,
    needsAim: true,
  }),
]);

/**
 * **`SCOREABLE_ITEMS`** — each a distinct Score heist target, unlocked
 * permanently by stealing its blueprint (the unlock writes to the meta-store in
 * M6.4). Not shown in Finn's shop until acquired. The first four are the old
 * KNOWN-tier gear; the rest (P3.M6.2) are net-new prototypes that each fill a
 * stat channel existing gear never touched — melee damage, flat armour, AP,
 * shield regen, and HP regen.
 */
export const SCOREABLE_ITEMS: readonly Item[] = Object.freeze([
  Object.freeze({
    id: ITEM_ID.BONE_LACING,
    label: 'Bone Lacing',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.BONE_LACING,
    description: '+1 max HP.',
    needsTarget: true,
    flavor: 'Black-clinic skeletal reinforcement, laced in straight off a fabrication line.',
  }),
  Object.freeze({
    id: ITEM_ID.TARGETING_CHIP,
    label: 'Targeting Chip',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.TARGETING_CHIP,
    description: `+${(TARGETING_BONUS * 100).toFixed(0)}% ranged hit chance.`,
    needsTarget: true,
    flavor: 'A smartgun targeting co-processor, pulled still-warm from a test rig.',
  }),
  Object.freeze({
    id: ITEM_ID.GHOST_WEAVE,
    label: 'Ghost Weave',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.GHOST_WEAVE,
    description: `+${(DODGE_BONUS * 100).toFixed(0)}% melee dodge chance.`,
    needsTarget: true,
    flavor:
      "Subdermal ghosting mesh, cut from an exec's private medbay — gone before the blow lands.",
  }),
  Object.freeze({
    id: ITEM_ID.RIP_ROUNDS,
    label: 'RiP Rounds',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.RIP_ROUNDS,
    description: `+${RANGED_DAMAGE_BONUS} ranged damage (Tech's turrets inherit the bonus).`,
    needsTarget: true,
    flavor: 'Hand-loaded, overcharged rounds — factory spec be damned.',
  }),
  Object.freeze({
    id: ITEM_ID.MONOBLADE,
    label: 'Monoblade',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.MONOBLADE,
    description: `+${MELEE_DAMAGE_BONUS} melee damage.`,
    needsTarget: true,
    flavor: 'A monomolecular blade schematic — an edge that never dulls.',
  }),
  Object.freeze({
    id: ITEM_ID.SUBDERMAL_PLATING,
    label: 'Subdermal Plating',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.SUBDERMAL_PLATING,
    description: `+${ARMOR_BONUS} armour — reduces every incoming hit (minimum 1 damage).`,
    needsTarget: true,
    flavor: 'Military subdermal armour, woven from layered impact ceramics.',
  }),
  Object.freeze({
    id: ITEM_ID.ADRENAL_SPIKE,
    label: 'Adrenal Spike',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.ADRENAL_SPIKE,
    description: `+${AP_BONUS} max AP. One per operator.`,
    needsTarget: true,
    flavor: 'A black-clinic adrenal spike — the world slows when it hits.',
  }),
  Object.freeze({
    id: ITEM_ID.PHASE_SHIELD,
    label: 'Phase Shield Prototype',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.PHASE_SHIELD,
    description: `Regenerates +${SHIELD_REGEN} shield at the start of each turn (absorbs damage before HP).`,
    needsTarget: true,
    flavor: 'A phase-shield emitter that bleeds incoming kinetic force into a flicker field.',
  }),
  Object.freeze({
    id: ITEM_ID.REGEN_MESH,
    label: 'Regen Mesh',
    scope: ITEM_SCOPE.CAMPAIGN,
    cost: SHOP_COST.REGEN_MESH,
    description: `Regenerates +${HP_REGEN} HP at the start of each turn (up to max HP).`,
    needsTarget: true,
    flavor: 'A subdermal nanite mesh that knits wounds closed mid-firefight.',
  }),
]);

/** Frozen id set for the scoreable pool — O(1) membership checks (M6.4). */
export const SCOREABLE_ITEM_IDS: ReadonlySet<string> = Object.freeze(
  new Set(SCOREABLE_ITEMS.map(item => item.id))
) as ReadonlySet<string>;

/** Every descriptor, both catalogs — backing store for {@link getItemById}. */
const CATALOG: readonly Item[] = Object.freeze([...DEFAULT_ITEMS, ...SCOREABLE_ITEMS]);

/**
 * Return Finn's purchasable stock (P3.M6.3): the always-available
 * {@link DEFAULT_ITEMS} plus any {@link SCOREABLE_ITEMS} the meta-crew has
 * unlocked across all campaigns. Rep no longer gates anything — the only
 * variance is which blueprints have been stolen.
 *
 * @param unlockedScoreableIds — item ids from the meta-progression store
 *   (`DataStore.unlockedScoreableItems`). Defaults to empty: a fresh meta-crew
 *   sees default stock only. Ids not present in `SCOREABLE_ITEMS` are ignored
 *   (a retired/forward-version blueprint can't be rendered) rather than thrown —
 *   the store, not the shop, owns earned-data integrity. Locked scoreable items
 *   are never included, so the shop never renders a placeholder.
 */
export function getShopCatalog(unlockedScoreableIds: readonly string[] = []): Item[] {
  const unlocked = new Set(unlockedScoreableIds);
  return [...DEFAULT_ITEMS, ...SCOREABLE_ITEMS.filter(item => unlocked.has(item.id))];
}

/**
 * Look up a single item descriptor by id, across both catalogs. Throws on
 * unknown id — no silent fallback for a typo in a purchase call.
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
