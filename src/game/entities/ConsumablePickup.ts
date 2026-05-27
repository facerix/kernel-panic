/**
 * Walk-onto consumable pickup (M4.3). A loose item dropped on the combat
 * grid that the player auto-collects by stepping on its tile. Distinct from
 * the M2.5 objective `Pickup` (glyph `!`, walk-onto secure for retrieve
 * objectives): consumables are flavor / loot, never gated by
 * extraction, and don't appear in `isObjectiveSatisfied`.
 *
 * Key shape choices:
 *   - `passable: true` — actors walk over it; `World.entityAt` and
 *     `blockerKeys` skip it. The pickup itself does not obstruct pathing
 *     or LOS, matching its fiction (a small canister on the floor).
 *   - NEUTRAL faction — drones do not target it. Stays inert until the
 *     player crosses its tile.
 *   - Holds a `consumableId` (an `ITEM_ID` value) — what the inventory
 *     gains on pickup. Resolved by `applyIntent.doMove` calling
 *     `Crew.addConsumable(consumableId)`.
 *
 * Placement: `Run.enterCombat` rolls 0–2 per run, uniform across the three
 * shipped consumables (stim / smoke charge / incendiary). M5 owns
 * tier/recipe-aware refinements.
 *
 * Glyph: `'*'` — distinct from the objective Pickup `!`, Contact `&`,
 * SyncPad `§`, RelayNode `~`, and DenyTarget `X` glyphs already in use.
 */

import { Entity, type EntityInit } from '../Entity.js';
import { FACTION } from '../constants.js';

export const CONSUMABLE_PICKUP_GLYPH = '*';

export interface ConsumablePickupInit extends Omit<
  EntityInit,
  'faction' | 'glyph' | 'maxAp' | 'maxHp' | 'passable'
> {
  /** Item id from `ITEM_ID` — what the player gains when stepping onto the tile. */
  consumableId: string;
  /** Display label used for log lines and the snapshot. */
  label: string;
}

export class ConsumablePickup extends Entity {
  consumableId: string;
  label: string;

  constructor({ consumableId, label, ...props }: ConsumablePickupInit) {
    if (typeof consumableId !== 'string' || consumableId.length === 0) {
      throw new TypeError('ConsumablePickup requires a non-empty consumableId');
    }
    if (typeof label !== 'string' || label.length === 0) {
      throw new TypeError('ConsumablePickup requires a non-empty label');
    }
    super({
      ...props,
      faction: FACTION.NEUTRAL,
      glyph: CONSUMABLE_PICKUP_GLYPH,
      // Pickups have no AP and a single HP — they're not combat targets,
      // but a positive maxHp keeps Entity's invariant happy.
      maxAp: 0,
      maxHp: 1,
      passable: true,
    });
    this.consumableId = consumableId;
    this.label = label;
  }
}
