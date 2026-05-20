import { Interactable, type InteractableInit, type InteractResult } from './Interactable.js';
import { AP_COST, TERMINAL_GLYPH } from '../constants.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

export interface TerminalInit extends Omit<InteractableInit, 'glyph' | 'label'> {
  label?: string;
  sliced?: boolean;
  raisesAlarm?: boolean;
}

export class Terminal extends Interactable {
  sliced: boolean;
  raisesAlarm: boolean;

  constructor({
    label = 'Terminal',
    sliced = false,
    raisesAlarm = true,
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
