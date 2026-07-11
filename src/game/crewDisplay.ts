/**
 * Pure formatting for a crew member's roster readout — the STATS and GEAR
 * blocks of `<crew-roster>`'s detail pane. Kept apart from the component so the
 * stat/label mapping is unit-testable without a DOM, and so every combat stat
 * and every {@link Crew.applyGear} channel has a single, audited place to
 * surface.
 *
 * `gearLabels` names the equipment (what the player bought from Finn);
 * `statDisplays` maps each combat stat to its resulting display value (with any
 * gear contribution already folded in). The two are complementary: GEAR is the
 * loadout, STATS is the effect.
 */

import type { Gear } from './Crew.js';

/**
 * Minimal structural view of a crew member's combat stats. `Crew` instances
 * satisfy this via their getters/fields; plain objects can stand in for tests.
 * Effective damage bonuses are pre-capped by the `Crew` getters, so
 * `statDisplays` formats them verbatim rather than re-deriving the caps.
 */
export interface StatReadout {
  hp: number;
  maxHp: number;
  maxAp: number;
  baseHitChance: number;
  baseDodgeChance: number;
  rangedDamage: number;
  meleeDamage: number;
  effectiveRangedDamageBonus: number;
  effectiveMeleeDamageBonus: number;
  damageReduction: number;
  gear: Gear | null;
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/**
 * Map each combat stat to its display value with gear folded in. Keys `hp`,
 * `ap`, `aim`, `dodge`, `ranged`, `melee`, and `armor` are always present; the
 * `shield` and `regen` keys appear only when gear grants that per-turn effect.
 *
 * Bonuses are counted exactly once. Some stats are *live* (the gear delta is
 * already baked into the field by {@link Crew.applyGear}): `maxAp` and
 * `damageReduction`. Others are *base* and must have the effective bonus added
 * here: hit/dodge chance and ranged/melee damage. Mixing the two — e.g. adding
 * `apBonus` onto the already-boosted `maxAp` — double-counts the gear.
 */
export function statDisplays(stats: StatReadout): Record<string, string> {
  const hitBonus = stats.gear?.hitBonus ?? 0;
  const dodgeBonus = stats.gear?.dodgeBonus ?? 0;
  const rangedBonus = stats.effectiveRangedDamageBonus ?? 0;
  const meleeBonus = stats.effectiveMeleeDamageBonus ?? 0;
  const shieldRegen = stats.gear?.shieldRegen ?? 0;
  const hpRegen = stats.gear?.hpRegen ?? 0;

  const aim = Math.min(stats.baseHitChance + hitBonus, 1);
  const dodge = Math.min(stats.baseDodgeChance + dodgeBonus, 1);

  const labels: Record<string, string> = {
    hp: `${stats.hp}/${stats.maxHp}`,
    // `maxAp` is the live stat — the Reflex Booster delta is already baked in.
    ap: `${stats.maxAp}`,
    aim: `${pct(aim)}`,
    dodge: `${pct(dodge)}`,
    ranged: `${stats.rangedDamage + rangedBonus} dmg`,
    melee: `${stats.meleeDamage + meleeBonus} dmg`,
    armor: `${stats.damageReduction}`,
  };
  if (shieldRegen > 0) labels.shield = `+${shieldRegen}/turn`;
  if (hpRegen > 0) labels.regen = `+${hpRegen} HP/turn`;
  return labels;
}

/**
 * Format the active gear bonuses on `gear`, keyed by the gear ID. A channel only
 * appears when its bonus is positive, so a fresh operator (or one that maxed a
 * stat at 0) shows nothing for it. Returns `{}` for null/absent gear.
 *
 * Every branch here must mirror a case in {Crew.applyGear}; a purchase
 * that lands a bonus with no entry is the bug this module exists to prevent.
 */
export function gearLabels(gear: Gear | null | undefined): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!gear) return labels;
  if (gear.maxHpBonus > 0) labels.maxHpBonus = `Armor Plating  +${gear.maxHpBonus} HP`;
  if (gear.hitBonus > 0) labels.hitBonus = `Targeting Chip  +${pct(gear.hitBonus)} aim`;
  if ((gear.dodgeBonus ?? 0) > 0)
    labels.dodgeBonus = `Reflex Weave  +${pct(gear.dodgeBonus ?? 0)} dodge`;
  if ((gear.rangedDamageBonus ?? 0) > 0)
    labels.rangedDamageBonus = `Ballistics Coil  +${gear.rangedDamageBonus} ranged dmg`;
  if ((gear.meleeDamageBonus ?? 0) > 0)
    labels.meleeDamageBonus = `Monoblade  +${gear.meleeDamageBonus} melee dmg`;
  if ((gear.armorBonus ?? 0) > 0)
    labels.armorBonus = `Subdermal Plating  +${gear.armorBonus} armor`;
  if ((gear.apBonus ?? 0) > 0) labels.apBonus = `Reflex Booster  +${gear.apBonus} AP`;
  if ((gear.shieldRegen ?? 0) > 0)
    labels.shieldRegen = `Phase Shield  +${gear.shieldRegen} shield/turn`;
  if ((gear.hpRegen ?? 0) > 0) labels.hpRegen = `Regen Mesh  +${gear.hpRegen} HP/turn`;
  return labels;
}
