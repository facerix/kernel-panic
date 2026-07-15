import { Crew } from '../Crew.js';
import {
  CRASH_AP_PENALTY,
  CRASH_DURATION,
  CRASH_HIT_PENALTY,
  STATUS_EFFECT,
  SURGE_AP_BONUS,
  SURGE_ARMOR_BONUS,
  SURGE_DAMAGE_BONUS,
  BERSERK_DEFAULT_HIT_CHANCE,
  BERSERK_DEFAULT_DODGE_CHANCE,
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

  /**
   * P3.5.M6: `super.baseHitChance` reads the constructor-settable pristine
   * value (rolled or `BERSERK_DEFAULT_HIT_CHANCE`) — this getter layers the
   * live Crash penalty on top without a second mutable field, so expiry and
   * restore can never over-/under-correct the stat (see the M3 as-built note).
   */
  override get baseHitChance(): number {
    return super.baseHitChance - (this.hasEffect(STATUS_EFFECT.CRASH) ? CRASH_HIT_PENALTY : 0);
  }

  /**
   * Live combat armor: base `damageReduction` plus Surge's flat bonus while it
   * is active. Computed on read, never stored — `damageReduction` stays the
   * pristine persisted base, so the transient buff cannot leak into a save even
   * if a run ends mid-Surge (`run.player` *is* the campaign crew object). Combat
   * mitigation and the HUD read this; snapshots keep reading `damageReduction`.
   */
  override get effectiveDamageReduction(): number {
    return this.damageReduction + (this.hasEffect(STATUS_EFFECT.SURGE) ? SURGE_ARMOR_BONUS : 0);
  }

  constructor(props: CrewInit) {
    super({
      baseHitChance: BERSERK_DEFAULT_HIT_CHANCE,
      baseDodgeChance: BERSERK_DEFAULT_DODGE_CHANCE,
      ...props,
      glyph: '@',
    });
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
