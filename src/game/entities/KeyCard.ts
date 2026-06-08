/**
 * Walk-onto KeyCard pickup (P2.5.M6.2). A passable neutral entity placed on
 * the combat grid as an alternative to unlock terminals. The player
 * auto-collects it by stepping onto its tile (same pattern as
 * ConsumablePickup / Pickup).
 *
 * Key shape choices:
 *   - `passable: true` — actors walk over it; `World.entityAt` and
 *     `blockerKeys` skip it.
 *   - NEUTRAL faction — drones do not target it.
 *   - Holds a `doorId` — references the locked Door this card opens.
 *   - **Campaign-scoped** (`siteId` set): collected into
 *     `Campaign.keyItems` (persistent across runs, M7.2).
 *   - **Run-scoped** (no `siteId`): collected into `Run.keyItems` and
 *     discarded at the end of the run.
 *
 * Glyph: `'κ'` (kappa) — distinct from other objective/pickup glyphs.
 */

import { Entity, type EntityInit } from '../Entity.js';
import { FACTION, KEYCARD_GLYPH } from '../constants.js';

export interface KeyCardInit extends Omit<
  EntityInit,
  'faction' | 'glyph' | 'maxAp' | 'maxHp' | 'passable'
> {
  /** Stable door id this keycard unlocks. */
  doorId: string;
  /** Display label used for log lines and the snapshot. */
  label: string;
  /**
   * Optional site id. When set, the keycard is *campaign-scoped* — it persists
   * in `Campaign.keyItems` across runs (P2.5.M7.2 location memory). When absent the
   * keycard is *run-scoped* and lives only in `Run.keyItems`.
   */
  siteId?: string;
}

/** P2.7.M6.2: KeyCard snapshot `extra`. Bag-hygienic — `siteId` is `null`, not absent. */
export type KeyCardSnapshot = {
  doorId: string;
  label: string;
  siteId: string | null;
};

export class KeyCard extends Entity {
  doorId: string;
  label: string;
  siteId: string | null;

  constructor({ doorId, label, siteId, ...props }: KeyCardInit) {
    if (typeof doorId !== 'string' || doorId.length === 0) {
      throw new TypeError('KeyCard requires a non-empty doorId');
    }
    if (typeof label !== 'string' || label.length === 0) {
      throw new TypeError('KeyCard requires a non-empty label');
    }
    if (siteId !== undefined && siteId !== null) {
      if (typeof siteId !== 'string' || siteId.length === 0) {
        throw new TypeError('KeyCard siteId must be a non-empty string when set');
      }
    }
    super({
      ...props,
      faction: FACTION.NEUTRAL,
      glyph: KEYCARD_GLYPH,
      maxAp: 0,
      maxHp: 1,
      passable: true,
    });
    this.doorId = doorId;
    this.label = label;
    this.siteId = siteId ?? null;
  }

  override isHazardImmune(): boolean {
    return true;
  }
}
