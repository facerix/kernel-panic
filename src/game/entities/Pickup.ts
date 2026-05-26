import { Interactable, type InteractableInit, type InteractResult } from './Interactable.js';
import { PICKUP_GLYPH } from '../constants.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

export interface PickupInit extends Omit<InteractableInit, 'glyph' | 'label'> {
  label?: string;
}

export class Pickup extends Interactable {
  constructor({ label = 'Objective pickup', ...props }: PickupInit) {
    super({
      ...props,
      glyph: PICKUP_GLYPH,
      label,
    });
  }

  override interact(world: World, actor: Entity): InteractResult {
    if (this.secured) {
      return { ok: false, reason: 'already-secured', message: `${this.label}: already secured.` };
    }
    const result = super.interact(world, actor);
    if (result.ok) {
      world.recordSecuredPickup(this.id);
      world.removeEntity(this.id);
    }
    return result;
  }
}
