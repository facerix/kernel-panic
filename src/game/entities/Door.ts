import { DOOR_LOCKED_GLYPH, DOOR_OPEN_GLYPH } from '../constants.js';
import { Interactable, type InteractableInit, type InteractResult } from './Interactable.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

export interface DoorInit extends Omit<InteractableInit, 'glyph' | 'maxAp' | 'label'> {
  doorId: string;
  locked?: boolean;
  label?: string;
}

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

  override interact(_world: World, _actor: Entity): InteractResult {
    if (!this.alive) {
      return { ok: false, reason: 'inactive', message: `${this.label}: inactive.` };
    }
    if (this.locked) {
      return {
        ok: false,
        reason: 'locked',
        message: `${this.label}: locked — find an access terminal.`,
      };
    }
    return { ok: false, reason: 'open', message: `${this.label}: open.` };
  }

  #syncPhysicalState(): void {
    this.passable = !this.locked;
    this.glyph = this.locked ? DOOR_LOCKED_GLYPH : DOOR_OPEN_GLYPH;
  }
}
