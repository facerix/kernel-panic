import { ESCORT_NPC_GLYPH, FACTION } from '../constants.js';
import { Interactable, type InteractableInit, type InteractResult } from './Interactable.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

export type EscortFollowStep =
  | { type: 'escort-follow'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: 'escort-wait'; reason: 'inactive' | 'no-player' | 'adjacent' | 'blocked' };

export interface EscortNpcInit extends Omit<InteractableInit, 'glyph' | 'label' | 'secured'> {
  label?: string;
  activated?: boolean;
}

export class EscortNpc extends Interactable {
  activated: boolean;

  constructor({ label = 'Extractee', activated = false, armed, ...props }: EscortNpcInit) {
    super({
      ...props,
      glyph: ESCORT_NPC_GLYPH,
      label,
      secured: activated,
      armed: armed ?? !activated,
      maxHp: props.maxHp ?? 2,
    });
    this.faction = FACTION.PLAYER;
    this.activated = !!activated;
  }

  override interact(world: World, actor: Entity): InteractResult {
    if (this.activated) {
      return {
        ok: false,
        reason: 'escort-active',
        message: `${this.label}: already moving.`,
      };
    }
    const result = super.interact(world, actor);
    if (!result.ok) return result;
    this.activated = true;
    return { ok: true, message: `${this.label}: escort linked. Keep them close.` };
  }
}
