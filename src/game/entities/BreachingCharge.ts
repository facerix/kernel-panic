import { BREACHING_CHARGE_GLYPH, FACTION } from '../constants.js';
import { Entity, type EntityInit } from '../Entity.js';

export interface BreachingChargeInit extends Omit<
  EntityInit,
  'faction' | 'glyph' | 'maxAp' | 'maxHp'
> {
  glyph?: string;
}

/**
 * Armed breaching charge on the combat grid. Detonates during player aftermath
 * (see `detonateBreachingCharge` in `breachBlast.js`).
 */
export class BreachingCharge extends Entity {
  constructor({ glyph = BREACHING_CHARGE_GLYPH, ...props }: BreachingChargeInit) {
    super({
      ...props,
      faction: FACTION.NEUTRAL,
      glyph,
      maxAp: 0,
      maxHp: 1,
      passable: false,
      anchored: true,
    });
  }

  override isBlastDamageable(): boolean {
    return false;
  }

  override isHazardImmune(): boolean {
    return true;
  }
}
