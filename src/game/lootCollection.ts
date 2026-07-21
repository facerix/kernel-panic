/**
 * Shared pickup-collection helpers.
 *
 * Both loot paths funnel through here so they stay in lock-step:
 *   - **walk-onto** (`applyIntent.collectTileLoot`) — the player's own tile,
 *     incidental to a move/vault/slide (salvage passes `spendAp: false`).
 *   - **interact** (`shellRuntime.handleCombatInteract`) — an adjacent tile, a
 *     deliberate action that spends INTERACT AP.
 *
 * Each helper performs the world/player mutation AND emits `ITEM_COLLECTED`, so
 * the `pickUp` sound (and any future observer) fires no matter which path ran.
 * Caller-specific concerns — AP accounting, log wording, vision bookkeeping,
 * keycard routing — stay with the callers.
 */

import { EVENT } from './events.js';
import { totalSalvage } from './salvage.js';
import type { World } from './World.js';
import type { LootableEntity } from './Entity.js';
import type { ConsumablePickup } from './entities/ConsumablePickup.js';
import type { KeyCard } from './entities/KeyCard.js';

/** Minimal player surface each helper needs (structural — avoids Crew coupling). */
interface ConsumableHolder {
  addConsumable(consumableId: string): void;
}
interface SalvageLooter {
  collectSalvage(world: World, corpse: LootableEntity, options?: { spendAp?: boolean }): void;
}

/**
 * A keycard handed to the caller's inventory router (campaign- or run-scoped).
 * `principalId` is bag-hygienic — always present, `null` (not absent) for
 * run-scoped cards.
 */
export interface CollectedKeycard {
  id: string;
  doorId: string;
  label: string;
  principalId: string | null;
}

/** Add a consumable charge to the player and clear the pickup. */
export function collectConsumablePickup(
  world: World,
  player: ConsumableHolder,
  pickup: ConsumablePickup
): void {
  player.addConsumable(pickup.consumableId);
  world.removeEntity(pickup.id);
  world.events?.emit(EVENT.ITEM_COLLECTED, { kind: 'consumable', entityId: pickup.id });
}

/** Remove a keycard from the world and route it via `onCollected`. */
export function collectKeycardPickup(
  world: World,
  keycard: KeyCard,
  onCollected: (kc: CollectedKeycard) => void
): void {
  world.removeEntity(keycard.id);
  onCollected({
    id: keycard.id,
    doorId: keycard.doorId,
    label: keycard.label,
    principalId: keycard.principalId ?? null,
  });
  world.events?.emit(EVENT.ITEM_COLLECTED, { kind: 'keycard', entityId: keycard.id });
}

/**
 * Strip salvage from an adjacent corpse. `spendAp` mirrors `Crew.collectSalvage`
 * (false after a move already paid; true for a standalone interact). Returns the
 * salvage total for the caller's log line.
 */
export function collectCorpseSalvage(
  world: World,
  player: SalvageLooter,
  corpse: LootableEntity,
  options: { spendAp: boolean }
): number {
  const amount = totalSalvage(corpse.loot!.salvage);
  player.collectSalvage(world, corpse, { spendAp: options.spendAp });
  world.events?.emit(EVENT.ITEM_COLLECTED, { kind: 'salvage', entityId: corpse.id });
  return amount;
}
