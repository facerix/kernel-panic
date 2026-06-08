import { AP_COST, DOOR_LOCKED_GLYPH, DOOR_OPEN_GLYPH } from '../constants.js';
import { Interactable, type InteractableInit, type InteractResult } from './Interactable.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';
import type { KeyItem } from '../../types.js';

export interface DoorInit extends Omit<InteractableInit, 'glyph' | 'maxAp' | 'label'> {
  doorId: string;
  locked?: boolean;
  label?: string;
}

/** P2.7.M6.2: Door snapshot `extra` — glyph reflects `locked` (validated on restore). */
export type DoorSnapshot = {
  doorId: string;
  locked: boolean;
};

export class Door extends Interactable {
  doorId: string;
  locked: boolean;

  constructor({ doorId, locked = true, label = 'Door', ...props }: DoorInit) {
    if (typeof doorId !== 'string' || doorId.length === 0) {
      throw new TypeError('Door requires a non-empty doorId');
    }
    super({
      ...props,
      label,
      glyph: locked ? DOOR_LOCKED_GLYPH : DOOR_OPEN_GLYPH,
      maxHp: 1,
      passable: !locked,
      armed: false,
    });
    this.doorId = doorId;
    this.locked = !!locked;
    this.#syncPhysicalState();
  }

  unlock(): boolean {
    if (!this.locked) return false;
    this.locked = false;
    this.#syncPhysicalState();
    return true;
  }

  lock(): void {
    this.locked = true;
    this.#syncPhysicalState();
  }

  /**
   * Interact with the door. If locked and the actor's campaign inventory
   * contains a matching keycard, spend AP and unlock. Otherwise report
   * the locked/open status.
   *
   * @param keyItems Campaign key-item inventory — passed by the shell or
   *   tests. If omitted, the keycard path is skipped (backward compat with
   *   existing interaction flows that don't carry campaign context).
   */
  override interact(_world: World, actor: Entity, keyItems?: KeyItem[]): InteractResult {
    if (!this.alive) {
      return { ok: false, reason: 'inactive', message: `${this.label}: inactive.` };
    }
    if (this.locked) {
      // Check for a matching keycard in campaign key-item inventory (P2.5.M6.2).
      if (keyItems) {
        const match = keyItems.find(k => k.doorId === this.doorId);
        if (match) {
          const check = this.canInteract(actor);
          if (!check.ok) {
            return { ok: false, reason: check.reason, message: `${this.label}: ${check.reason}.` };
          }
          actor.spendAp(AP_COST.INTERACT);
          this.unlock();
          return {
            ok: true,
            message: `${this.label}: unlocked with ${match.label}.`,
          };
        }
      }
      return {
        ok: false,
        reason: 'locked',
        message: `${this.label}: locked — find an access terminal or keycard.`,
      };
    }
    return { ok: false, reason: 'open', message: `${this.label}: open.` };
  }

  #syncPhysicalState(): void {
    this.passable = !this.locked;
    this.glyph = this.locked ? DOOR_LOCKED_GLYPH : DOOR_OPEN_GLYPH;
  }
}
