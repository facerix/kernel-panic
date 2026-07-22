/**
 * Pure formatting for Finn's shop target-selection rows.
 *
 * When the player picks an item and is asked *which operator gets it*, each
 * crew row should answer the only question that matters at that moment: "what
 * does this operator already have of this?" For a consumable that's the held
 * quantity; for gear it's the stat the gear moves, with any existing bonus
 * already folded in.
 *
 * Kept apart from `<finn-shop>` so the item → stat mapping is unit-testable
 * without a DOM, and so a newly stocked item fails a test until someone
 * deliberately chooses what it previews. Derived stat values come from
 * {@link statDisplays} so the shop and the crew roster can never disagree.
 */

import { ITEM_ID } from './items.js';
import { statDisplays, type StatReadout } from './crewDisplay.js';

/**
 * Structural view of an operator for preview purposes: their combat stats plus
 * the consumables they are already carrying. `Crew` instances satisfy this
 * directly (`inventory` is `null` until `initInventory`), and plain objects can
 * stand in for tests.
 */
export interface OperatorReadout extends StatReadout {
  inventory?: { consumables: readonly { id: string }[] } | null;
}

/** A single "what you already have" readout for one operator + one item. */
export type ItemPreview = {
  /** Short uppercase caption, e.g. `HELD` or `MELEE`. */
  label: string;
  /** Formatted value, e.g. `2` or `4 dmg`. */
  value: string;
};

/**
 * Consumables preview held quantity rather than a stat — they stack in
 * `inventory.consumables` and have no persistent effect to show.
 */
const CONSUMABLE_IDS: ReadonlySet<string> = Object.freeze(
  new Set<string>([ITEM_ID.STIM, ITEM_ID.SMOKE_CHARGE, ITEM_ID.MOLOTOV, ITEM_ID.BREACHING_CHARGE])
) as ReadonlySet<string>;

/**
 * Campaign gear → the {@link statDisplays} key it moves. Every CAMPAIGN-scope
 * entry in `items.ts` must appear here; `itemPreview` throws otherwise.
 */
const GEAR_STAT_KEY: Readonly<Record<string, string>> = Object.freeze({
  [ITEM_ID.BONE_LACING]: 'hp',
  [ITEM_ID.TARGETING_CHIP]: 'aim',
  [ITEM_ID.GHOST_WEAVE]: 'dodge',
  [ITEM_ID.RIP_ROUNDS]: 'ranged',
  [ITEM_ID.MONOBLADE]: 'melee',
  [ITEM_ID.SUBDERMAL_PLATING]: 'armor',
  [ITEM_ID.ADRENAL_SPIKE]: 'ap',
  [ITEM_ID.PHASE_SHIELD]: 'shield',
  [ITEM_ID.REGEN_MESH]: 'regen',
});

/** Row captions for each stat key. */
const STAT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  hp: 'HP',
  ap: 'MAX AP',
  aim: 'AIM',
  dodge: 'DODGE',
  ranged: 'RANGED',
  melee: 'MELEE',
  armor: 'ARMOR',
  shield: 'SHIELD',
  regen: 'REGEN',
});

/**
 * `statDisplays` omits the per-turn regen keys when the operator has no such
 * gear; the shop still needs a row value, so zero reads explicitly as `none`
 * rather than a blank the player would have to interpret.
 */
const ZERO_STAT_VALUES: Readonly<Record<string, string>> = Object.freeze({
  shield: 'none',
  regen: 'none',
});

/** How many of `itemId` this operator is already carrying. */
export function heldConsumableCount(operator: OperatorReadout, itemId: string): number {
  const consumables = operator.inventory?.consumables;
  if (!consumables) return 0;
  return consumables.reduce((n, c) => (c.id === itemId ? n + 1 : n), 0);
}

/**
 * The relevant "already have" readout for `itemId` on `operator`.
 *
 * Throws on an unknown item id — an item the player can buy but whose preview
 * nobody chose is a gap in the catalog wiring, not a runtime condition to paper
 * over with a blank row.
 */
export function itemPreview(itemId: string, operator: OperatorReadout): ItemPreview {
  if (CONSUMABLE_IDS.has(itemId)) {
    return { label: 'HELD', value: String(heldConsumableCount(operator, itemId)) };
  }
  const key = GEAR_STAT_KEY[itemId];
  if (!key) throw new Error(`itemPreview: no preview mapping for item "${itemId}"`);
  const value = statDisplays(operator)[key] ?? ZERO_STAT_VALUES[key];
  if (value === undefined) {
    throw new Error(`itemPreview: statDisplays produced no "${key}" value for item "${itemId}"`);
  }
  return { label: STAT_LABELS[key], value };
}
