import { Interactable, type InteractableInit, type InteractResult } from './Interactable.js';
import { AP_COST, TERMINAL_GLYPH } from '../constants.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

export interface TerminalInit extends Omit<InteractableInit, 'glyph' | 'label'> {
  label?: string;
  sliced?: boolean;
  raisesAlarm?: boolean;
  unlocksId?: string | null;
}

/** M6.2: Terminal snapshot `extra`. */
export type TerminalSnapshot = {
  label: string;
  sliced: boolean;
  armed: boolean;
  raisesAlarm: boolean;
  unlocksId: string | null;
};

export class Terminal extends Interactable {
  sliced: boolean;
  raisesAlarm: boolean;
  unlocksId: string | null;

  constructor({
    label = 'Terminal',
    sliced = false,
    raisesAlarm = true,
    unlocksId = null,
    armed,
    ...props
  }: TerminalInit) {
    super({
      ...props,
      glyph: TERMINAL_GLYPH,
      label,
      secured: sliced,
      armed: armed ?? !sliced,
    });
    this.sliced = !!sliced;
    this.raisesAlarm = !!raisesAlarm;
    if (unlocksId !== null && unlocksId !== undefined) {
      if (typeof unlocksId !== 'string' || unlocksId.length === 0) {
        throw new TypeError('Terminal.unlocksId must be a non-empty string when set');
      }
      this.unlocksId = unlocksId;
    } else {
      this.unlocksId = null;
    }
  }

  override interact(world: World, actor: Entity): InteractResult {
    if (this.sliced) {
      return { ok: false, reason: 'already-sliced', message: `${this.label}: already sliced.` };
    }
    const check = this.canInteract(actor);
    if (!check.ok) {
      return {
        ok: false,
        reason: check.reason,
        message: `${this.label}: ${check.reason}.`,
      };
    }

    if (this.unlocksId) {
      world.unlockDoor(this.unlocksId);
    }
    actor.spendAp(AP_COST.INTERACT);
    this.sliced = true;
    this.secured = true;
    const alarmRaised =
      this.armed && this.raisesAlarm
        ? world.raiseAlarm({ source: this, target: actor, origin: { x: this.x, y: this.y } })
        : false;
    this.armed = false;
    return {
      ok: true,
      message: alarmRaised ? `${this.label} sliced — alarm tripped.` : `${this.label} sliced.`,
    };
  }
}
