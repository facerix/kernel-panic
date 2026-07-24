/**
 * Nanite Repair (P3.5.M5) — the Chimera's signature sustain perk: convert
 * scrap salvage into HP. Mirrors `Tech.improviseTurret`'s resource-gate shape
 * exactly — repeatable every turn as long as the shared scrap pool allows, no
 * per-job cap, no cooldown.
 *
 * Fiction is deliberately unresolved (see `archetypes/Chimera.ts`): whether
 * this is a nanite swarm stitching flesh back together or an android chassis
 * re-fabricating its own plating is never confirmed, in dialogue or in code
 * comments. Log/flavor copy at every call site should preserve that
 * ambiguity rather than pick a side.
 *
 * Pure verbs, mirroring `surge.ts`/`empBlast.ts`: the archetype class stays a
 * thin delegator, the intent layer a thin caller.
 */

import { AP_COST, NANITE_HEAL_AMOUNT, SALVAGE_PER_NANITE_HEAL } from './constants.js';
import type { Crew } from './Crew.js';

/** Pre-flight legality verdict, mirroring the other archetype perks. */
export type NaniteHealCheck =
  | { ok: true; reason?: never }
  | {
      ok: false;
      reason: 'dead' | 'insufficient-ap' | 'no-inventory' | 'insufficient-salvage';
    };

/**
 * Pure legality check for converting scrap into HP. Never mutates. No
 * "already at full HP" gate — matches the existing STIM item precedent
 * (`Crew.useConsumable`'s `ITEM_ID.STIM` case), which also lets a player burn
 * a heal at full health rather than crash or silently no-op; wasting your own
 * resource is a player mistake, not a state we need to police.
 */
export function canConvertScrap(chimera: Crew): NaniteHealCheck {
  if (!chimera.alive) return { ok: false, reason: 'dead' };
  if (!chimera.canAfford(AP_COST.NANITE_HEAL)) return { ok: false, reason: 'insufficient-ap' };
  if (!chimera.inventory) return { ok: false, reason: 'no-inventory' };
  if (chimera.inventory.salvage.scrap < SALVAGE_PER_NANITE_HEAL) {
    return { ok: false, reason: 'insufficient-salvage' };
  }
  return { ok: true };
}

/**
 * Commit a scrap-to-HP conversion. Throws on any illegal pre-condition (no AP
 * burned, no scrap spent). On a legal attempt: debits `AP_COST.NANITE_HEAL`
 * AP and `SALVAGE_PER_NANITE_HEAL` scrap, heals the Chimera by
 * `NANITE_HEAL_AMOUNT` (clamped at maxHp by `Entity.heal`), and returns the
 * HP actually restored.
 */
export function convertScrapToHp(chimera: Crew): number {
  const check = canConvertScrap(chimera);
  if (!check.ok) {
    throw new Error(`Illegal nanite conversion for ${chimera.id}: ${check.reason}`);
  }
  chimera.spendAp(AP_COST.NANITE_HEAL);
  chimera.inventory!.salvage.scrap -= SALVAGE_PER_NANITE_HEAL;
  return chimera.heal(NANITE_HEAL_AMOUNT);
}
