import { Interactable, type InteractableInit, type InteractResult } from './Interactable.js';
import { CONTACT_GLYPH } from '../constants.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

export interface ContactInit extends Omit<InteractableInit, 'glyph' | 'label' | 'secured'> {
  label?: string;
  handoffComplete?: boolean;
}

export class Contact extends Interactable {
  handoffComplete: boolean;

  constructor({ label = 'Contact', handoffComplete = false, armed, ...props }: ContactInit) {
    super({
      ...props,
      glyph: CONTACT_GLYPH,
      label,
      secured: handoffComplete,
      armed: armed ?? !handoffComplete,
    });
    this.handoffComplete = !!handoffComplete;
  }

  override interact(world: World, actor: Entity): InteractResult {
    if (this.handoffComplete) {
      return {
        ok: false,
        reason: 'handoff-complete',
        message: `${this.label}: handoff already complete.`,
      };
    }
    const result = super.interact(world, actor);
    if (!result.ok) return result;
    this.handoffComplete = true;
    return { ok: true, message: `${this.label}: handoff complete.` };
  }
}
