/**
 * Walk-onto objective pickup. Passable — the player steps onto the tile to
 * secure it; Vault and Slide landings collect the same way via
 * `collectTileLoot`. Space-adjacent interact also works.
 */

import { Interactable, type InteractableInit, type InteractResult } from './Interactable.js';
import { PICKUP_GLYPH } from '../constants.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

export interface PickupInit extends Omit<InteractableInit, 'glyph' | 'label' | 'passable'> {
  label?: string;
  detail?: string;
}

/** P2.7.M6.2: Pickup snapshot `extra`. `detail` added P3.M6.4 (Score flavor). */
export type PickupSnapshot = {
  label: string;
  secured: boolean;
  armed: boolean;
  detail?: string;
};

export class Pickup extends Interactable {
  /**
   * Optional flavor line surfaced when the pickup is secured (P3.M6.4) — e.g.
   * the stolen Score blueprint's `flavor`. `collectTileLoot` logs it as a
   * second beat after the secure message. Absent on ordinary pickups.
   */
  detail?: string;

  constructor({ label = 'Objective pickup', detail, ...props }: PickupInit) {
    super({
      ...props,
      glyph: PICKUP_GLYPH,
      label,
      passable: true,
    });
    this.detail = detail;
  }

  /**
   * Walk-onto secure — no INTERACT AP; called from `collectTileLoot` after
   * a move, vault, or slide lands on this tile.
   */
  secureWalkOnto(world: World): string {
    if (this.secured) {
      throw new Error(`Pickup.secureWalkOnto: "${this.id}" is already secured`);
    }
    this.#commitSecure(world);
    return `${this.label} secured.`;
  }

  override interact(world: World, actor: Entity): InteractResult {
    if (this.secured) {
      return { ok: false, reason: 'already-secured', message: `${this.label}: already secured.` };
    }
    const result = super.interact(world, actor);
    if (result.ok) {
      this.#commitSecure(world);
    }
    return result;
  }

  #commitSecure(world: World): void {
    this.secured = true;
    this.armed = false;
    world.recordSecuredPickup(this.id);
    world.removeEntity(this.id);
  }
}
