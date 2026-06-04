/**
 * Deny target — a destructible CORP-faction objective prop.
 *
 * It has HP and can be destroyed by the player's normal ranged/melee combat,
 * or via the breaching-charge consumable if hardened.
 * It has no AI and never acts. Keeping it CORP-faction means combat rules
 * can target it without adding a side-channel "attack neutral prop" exception.
 */

import { Entity, type EntityInit } from '../Entity.js';
import { DENY_TARGET_GLYPH, DENY_TARGET_HP, FACTION } from '../constants.js';

export interface DenyTargetInit extends Omit<EntityInit, 'faction' | 'glyph' | 'maxAp'> {
  label?: string;
  requiresBreach?: boolean;
}

/** M6.2: DenyTarget snapshot `extra`. */
export type DenyTargetSnapshot = {
  label: string;
  requiresBreach: boolean;
};

export class DenyTarget extends Entity {
  label: string;
  requiresBreach: boolean;
  /** Stationary infrastructure cannot dodge melee. */
  readonly baseDodgeChance = 0;

  constructor({
    label = 'Deny target',
    maxHp = DENY_TARGET_HP,
    requiresBreach = false,
    ...props
  }: DenyTargetInit) {
    super({
      ...props,
      faction: FACTION.CORP,
      glyph: DENY_TARGET_GLYPH,
      maxAp: 0,
      maxHp,
      anchored: true,
    });
    this.label = label;
    this.requiresBreach = !!requiresBreach;
  }

  override damage(amount: number): number {
    if (this.requiresBreach) {
      if (!Number.isInteger(amount) || amount < 0) {
        throw new RangeError(`damage amount must be a non-negative integer, got ${amount}`);
      }
      if (!this.alive) {
        throw new Error(`Cannot damage ${this.id}: already dead`);
      }
      return 0;
    }
    return super.damage(amount);
  }

  destroyByBreach(): void {
    if (!this.alive) {
      throw new Error(`Cannot breach ${this.id}: already dead`);
    }
    this.hp = 0;
    this.alive = false;
  }
}
