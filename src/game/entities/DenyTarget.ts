/**
 * Deny target — a destructible CORP-faction objective prop.
 *
 * It has HP and can be destroyed by the player's normal ranged/melee combat,
 * but has no AI and never acts. Keeping it CORP-faction means combat rules
 * can target it without adding a side-channel "attack neutral prop" exception.
 */

import { Entity, type EntityInit } from '../Entity.js';
import { DENY_TARGET_GLYPH, DENY_TARGET_HP, FACTION } from '../constants.js';

export interface DenyTargetInit extends Omit<EntityInit, 'faction' | 'glyph' | 'maxAp'> {
  label?: string;
}

export class DenyTarget extends Entity {
  label: string;
  /** Stationary infrastructure cannot dodge melee. */
  readonly baseDodgeChance = 0;

  constructor({ label = 'Deny target', maxHp = DENY_TARGET_HP, ...props }: DenyTargetInit) {
    super({
      ...props,
      faction: FACTION.CORP,
      glyph: DENY_TARGET_GLYPH,
      maxAp: 0,
      maxHp,
    });
    this.label = label;
  }
}
