import { Interactable, type InteractableInit, type InteractResult } from './Interactable.js';
import { SYNC_PAD_GLYPH } from '../constants.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

export interface SyncPadInit extends Omit<InteractableInit, 'glyph' | 'label' | 'secured'> {
  label?: string;
  synced?: boolean;
}

/** M6.2: SyncPad snapshot `extra`. */
export type SyncPadSnapshot = {
  label: string;
  synced: boolean;
  armed: boolean;
};

export class SyncPad extends Interactable {
  synced: boolean;

  constructor({ label = 'Sync pad', synced = false, armed, ...props }: SyncPadInit) {
    super({
      ...props,
      glyph: SYNC_PAD_GLYPH,
      label,
      secured: synced,
      armed: armed ?? !synced,
    });
    this.synced = !!synced;
  }

  override interact(world: World, actor: Entity): InteractResult {
    if (this.synced) {
      return { ok: false, reason: 'already-synced', message: `${this.label}: already synced.` };
    }
    const result = super.interact(world, actor);
    if (!result.ok) return result;
    this.synced = true;
    return { ok: true, message: `${this.label}: sync complete.` };
  }
}
