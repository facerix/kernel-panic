import { Crew } from '../Crew.js';
import {
  CRASH_AP_PENALTY,
  CRASH_DURATION,
  CRASH_HIT_PENALTY,
  STATUS_EFFECT,
  SURGE_AP_BONUS,
  SURGE_DAMAGE_BONUS,
} from '../constants.js';
import { canSurge, doSurge } from '../surge.js';
import type { CrewInit } from '../Crew.js';

export const CALLSIGNS = Object.freeze([
  'Fury',
  'Havoc',
  'Grit',
  'Maul',
  'Wrath',
  'Torque',
  'Riptide',
  'Ember',
  'Thresh',
  'Brawn',
  'Ronin',
  'Ashwalker',
]);

/** Berserk — volatile assault archetype. Surge always resolves into Crash. */
export class Berserk extends Crew {
  override archetype = 'Berserk';

  override get baseHitChance(): number {
    return 0.75 - (this.hasEffect(STATUS_EFFECT.CRASH) ? CRASH_HIT_PENALTY : 0);
  }

  override get baseDodgeChance(): number {
    return 0.2;
  }

  constructor(props: CrewInit) {
    super({ ...props, glyph: '@' });
  }

  canSurge() {
    return canSurge(this);
  }

  surge(): void {
    doSurge(this);
  }

  override rangedAttackDamage(): number {
    return (
      super.rangedAttackDamage() + (this.hasEffect(STATUS_EFFECT.SURGE) ? SURGE_DAMAGE_BONUS : 0)
    );
  }

  override meleeAttackDamage(): number {
    return (
      super.meleeAttackDamage() + (this.hasEffect(STATUS_EFFECT.SURGE) ? SURGE_DAMAGE_BONUS : 0)
    );
  }

  override refreshAp(): void {
    const wasSurging = this.hasEffect(STATUS_EFFECT.SURGE);
    const wasStunned = this.hasEffect(STATUS_EFFECT.STUN);
    super.refreshAp();

    if (wasSurging && !this.hasEffect(STATUS_EFFECT.SURGE)) {
      this.applyEffect(STATUS_EFFECT.CRASH, CRASH_DURATION);
    }

    // Entity.refreshAp owns the stun invariant: a stunned activation has 0 AP.
    // Surge/Crash modifiers must never reopen that deliberately closed budget.
    if (wasStunned) return;

    if (this.hasEffect(STATUS_EFFECT.SURGE)) {
      this.ap += SURGE_AP_BONUS;
    } else if (this.hasEffect(STATUS_EFFECT.CRASH)) {
      this.ap = Math.max(0, this.ap - CRASH_AP_PENALTY);
    }
  }
}
