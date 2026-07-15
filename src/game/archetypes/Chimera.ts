import { Crew } from '../Crew.js';
import { canConvertScrap, convertScrapToHp } from '../nanoRepair.js';
import { CHIMERA_DEFAULT_HIT_CHANCE, CHIMERA_DEFAULT_DODGE_CHANCE } from '../constants.js';
import type { CrewInit } from '../Crew.js';
import type { NaniteHealCheck } from '../nanoRepair.js';

/**
 * Curated callsign pool for the Chimera archetype. See `Merc.ts` CALLSIGNS
 * for the design rationale. Deliberately unplaceable, human-or-machine names —
 * matching the archetype's unresolved fiction — checked against every other
 * pool for collisions.
 */
export const CALLSIGNS = Object.freeze([
  'Vessel',
  'Husk',
  'Chrysalis',
  'Relic',
  'Doll',
  'Ghost',
  'Null',
  'Sigil',
  'Mesh',
  'Splice',
  'Cocoon',
  'Effigy',
]);

/**
 * Chimera — sustain operative (P3.5.M5). Perk: **Nanite Repair**, converting
 * scrap salvage into HP on demand (`nanoRepair.ts`), mirroring Tech's
 * improvised-turret resource-gate shape (repeatable every turn as long as the
 * shared scrap pool allows, no per-job cap).
 *
 * Fiction is deliberately unresolved: nobody in-world knows for certain
 * whether this is a human running a semi-sentient nanite swarm or an awakened
 * AI in an android chassis. Flavor and log text should never resolve it
 * either way.
 */
export class Chimera extends Crew {
  override archetype = 'Chimera';

  constructor(props: CrewInit) {
    super({
      baseHitChance: CHIMERA_DEFAULT_HIT_CHANCE,
      baseDodgeChance: CHIMERA_DEFAULT_DODGE_CHANCE,
      ...props,
      glyph: '@',
    });
  }

  /**
   * Pre-flight legality check for converting scrap into HP. Returns
   * `{ ok, reason }`, mirroring the other archetype perks. Delegates to the
   * shared `nanoRepair` module so the rules live in one place.
   */
  canConvertScrap(): NaniteHealCheck {
    return canConvertScrap(this);
  }

  /**
   * Convert `SALVAGE_PER_NANITE_HEAL` scrap into `NANITE_HEAL_AMOUNT` HP.
   * Throws on illegal pre-conditions (no AP burned, no scrap spent).
   */
  convertScrapToHp(): number {
    return convertScrapToHp(this);
  }
}
