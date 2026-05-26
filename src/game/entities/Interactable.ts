import { AP_COST, FACTION } from '../constants.js';
import { Entity, type EntityInit } from '../Entity.js';
import type { World } from '../World.js';

export type InteractResult =
  | { ok: true; message: string }
  | { ok: false; reason: string; message: string };

export interface InteractableInit extends Omit<EntityInit, 'faction' | 'maxAp' | 'glyph'> {
  glyph: string;
  label: string;
  secured?: boolean;
  armed?: boolean;
}

export class Interactable extends Entity {
  label: string;
  secured: boolean;
  armed: boolean;

  constructor({
    glyph,
    label,
    secured = false,
    armed = true,
    maxHp = 1,
    ...props
  }: InteractableInit) {
    super({
      ...props,
      faction: FACTION.NEUTRAL,
      glyph,
      maxAp: 0,
      maxHp,
    });
    if (typeof label !== 'string' || label.length === 0) {
      throw new TypeError('Interactable requires a non-empty label');
    }
    this.label = label;
    this.secured = !!secured;
    this.armed = !!armed;
  }

  canInteract(actor: Entity): { ok: true } | { ok: false; reason: string } {
    if (!this.alive) return { ok: false, reason: 'inactive' };
    if (!actor.alive) return { ok: false, reason: 'actor-dead' };
    if (!actor.canAfford(AP_COST.INTERACT)) return { ok: false, reason: 'insufficient-ap' };
    if (!isChebyshevAdjacent(actor, this)) return { ok: false, reason: 'not-adjacent' };
    return { ok: true };
  }

  interact(_world: World, actor: Entity): InteractResult {
    const check = this.canInteract(actor);
    if (!check.ok) {
      return {
        ok: false,
        reason: check.reason,
        message: `${this.label}: ${check.reason}.`,
      };
    }
    actor.spendAp(AP_COST.INTERACT);
    this.secured = true;
    this.armed = false;
    return { ok: true, message: `${this.label} secured.` };
  }
}

function isChebyshevAdjacent(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
}
