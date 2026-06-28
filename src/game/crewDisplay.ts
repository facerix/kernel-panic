/**
 * Pure formatting for a crew member's roster readout — the STATS and GEAR
 * blocks of `<crew-roster>`'s detail pane. Kept apart from the component so the
 * stat/label mapping is unit-testable without a DOM, and so every combat stat
 * and every {@link Crew.applyGear} channel has a single, audited place to
 * surface.
 *
 * `gearLines` names the equipment (what the player bought from Finn);
 * `statLines` shows the resulting combat numbers with each gear contribution
 * annotated inline. The two are complementary: GEAR is the loadout, STATS is
 * the effect.
 */

import type { Gear } from './Crew.js';

/**
 * Minimal structural view of a crew member's combat stats. `Crew` instances
 * satisfy this via their getters/fields; plain objects can stand in for tests.
 * Effective damage bonuses are pre-capped by the `Crew` getters, so `statLines`
 * formats them verbatim rather than re-deriving the caps.
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
 * Format a crew member's combat stats as display lines. The seven core stats
 * (HP, AP, AIM, DODGE, RANGED, MELEE, ARMOUR) always appear so the pane reads
 * like a character sheet; the two per-turn regen effects only appear when a
 * piece of gear grants them (a `+0/turn` row would be noise). Gear-boosted
 * stats carry an inline `(+N)` so the bonus is legible without cross-checking
 * the GEAR block.
 */
export function statLines(stats: StatReadout): string[] {
  const hitBonus = stats.gear?.hitBonus ?? 0;
  const dodgeBonus = stats.gear?.dodgeBonus ?? 0;
  const apBonus = stats.gear?.apBonus ?? 0;
  const rangedBonus = stats.effectiveRangedDamageBonus ?? 0;
  const meleeBonus = stats.effectiveMeleeDamageBonus ?? 0;
  const shieldRegen = stats.gear?.shieldRegen ?? 0;
  const hpRegen = stats.gear?.hpRegen ?? 0;

  const aim = Math.min(stats.baseHitChance + hitBonus, 1);
  const dodge = Math.min(stats.baseDodgeChance + dodgeBonus, 1);

  const lines = [
    `HP  ${stats.hp}/${stats.maxHp}`,
    `AP  ${stats.maxAp}${apBonus > 0 ? ` (+${apBonus})` : ''}`,
    `AIM  ${pct(aim)}${hitBonus > 0 ? ` (+${pct(hitBonus)})` : ''}`,
    `DODGE  ${pct(dodge)}${dodgeBonus > 0 ? ` (+${pct(dodgeBonus)})` : ''}`,
    `RANGED  ${stats.rangedDamage + rangedBonus} dmg${rangedBonus > 0 ? ` (+${rangedBonus})` : ''}`,
    `MELEE  ${stats.meleeDamage + meleeBonus} dmg${meleeBonus > 0 ? ` (+${meleeBonus})` : ''}`,
    `ARMOUR  ${stats.damageReduction}`,
  ];
  if (shieldRegen > 0) lines.push(`SHIELD  +${shieldRegen}/turn`);
  if (hpRegen > 0) lines.push(`REGEN  +${hpRegen} HP/turn`);
  return lines;
}

/**
 * Format the active gear bonuses on `gear` as display lines. A channel only
 * appears when its bonus is positive, so a fresh operator (or one that maxed a
 * stat at 0) shows nothing for it. Returns `[]` for null/absent gear.
 *
 * Every branch here must mirror a case in {@link Crew.applyGear}; a purchase
 * that lands a bonus with no line is the bug this module exists to prevent
 * (P3.M6 gear was invisible on the roster).
 */
export function gearLines(gear: Gear | null | undefined): string[] {
  if (!gear) return [];
  const lines: string[] = [];
  if (gear.maxHpBonus > 0) lines.push(`Armour Plating  +${gear.maxHpBonus} HP`);
  if (gear.hitBonus > 0) lines.push(`Targeting Chip  +${pct(gear.hitBonus)}`);
  if ((gear.dodgeBonus ?? 0) > 0) lines.push(`Reflex Weave  +${pct(gear.dodgeBonus ?? 0)}`);
  if ((gear.rangedDamageBonus ?? 0) > 0)
    lines.push(`Ballistics Coil  +${gear.rangedDamageBonus} ranged dmg`);
  if ((gear.meleeDamageBonus ?? 0) > 0)
    lines.push(`Monoblade  +${gear.meleeDamageBonus} melee dmg`);
  if ((gear.armorBonus ?? 0) > 0) lines.push(`Subdermal Plating  +${gear.armorBonus} armour`);
  if ((gear.apBonus ?? 0) > 0) lines.push(`Reflex Booster  +${gear.apBonus} AP`);
  if ((gear.shieldRegen ?? 0) > 0) lines.push(`Phase Shield  +${gear.shieldRegen} shield/turn`);
  if ((gear.hpRegen ?? 0) > 0) lines.push(`Regen Mesh  +${gear.hpRegen} HP/turn`);
  return lines;
}
