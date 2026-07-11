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
 *   - **Campaign-scoped** (`principalId` set): collected into
 *     `Campaign.keyItems` (persistent across runs, M7.2). Scoped to the
 *     owning *principal* (corp/org), so one card opens that owner's door at
 *     every site they control (P3.1-balance).
 *   - **Run-scoped** (no `principalId`): collected into `Run.keyItems` and
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
   * Optional principal (owner) id. When set, the keycard is *campaign-scoped* —
   * it persists in `Campaign.keyItems` across runs (P2.5.M7.2 location memory)
   * and opens the owning principal's door at *every* site they control
   * (P3.1-balance). When absent the keycard is *run-scoped* and lives only in
   * `Run.keyItems`.
   */
  principalId?: string;
}

/** P2.7.M6.2: KeyCard snapshot `extra`. Bag-hygienic — `principalId` is `null`, not absent. */
export type KeyCardSnapshot = {
  doorId: string;
  label: string;
  principalId: string | null;
};

/**
 * Canonical keycard id. The principal id is baked in so two sites that share
 * the stable objective `doorId` (`door-0` on every generated map) but belong to
 * *different* owners still get distinct ids, while two sites of the *same* owner
 * collapse to one shared card (P3.1-balance principal scoping). Run-scoped cards
 * (no principalId) keep the bare `keycard-<doorId>` form; they are discarded at
 * run end so there is only ever one live, hence no collision.
 */
export function keycardIdFor(doorId: string, principalId?: string | null): string {
  return principalId ? `keycard-${doorId}-${principalId}` : `keycard-${doorId}`;
}

/**
 * Migrate a legacy save's bare `keycard-<doorId>` id to the principal-unique
 * form. Only the exact legacy shape *with* a principalId is rewritten —
 * post-fix ids, run-scoped ids (no principalId), and custom test ids are left
 * untouched, so the transform is idempotent and safe to run on every restore.
 * Note: the site→principal backfill (which resolves `principalId` from a legacy
 * `siteId` via the roster) happens upstream in the normalize step; by the time
 * an item reaches here it already carries its `principalId`.
 */
export function migrateLegacyKeycardId<
  T extends { id: string; doorId: string; principalId?: string },
>(item: T): T {
  if (item.principalId && item.id === `keycard-${item.doorId}`) {
    return { ...item, id: keycardIdFor(item.doorId, item.principalId) };
  }
  return item;
}

export class KeyCard extends Entity {
  doorId: string;
  label: string;
  principalId: string | null;

  constructor({ doorId, label, principalId, ...props }: KeyCardInit) {
    if (typeof doorId !== 'string' || doorId.length === 0) {
      throw new TypeError('KeyCard requires a non-empty doorId');
    }
    if (typeof label !== 'string' || label.length === 0) {
      throw new TypeError('KeyCard requires a non-empty label');
    }
    if (principalId !== undefined && principalId !== null) {
      if (typeof principalId !== 'string' || principalId.length === 0) {
        throw new TypeError('KeyCard principalId must be a non-empty string when set');
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
    this.principalId = principalId ?? null;
  }

  override isHazardImmune(): boolean {
    return true;
  }
}
