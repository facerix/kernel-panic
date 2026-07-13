import { Crew } from '../Crew.js';
import { canEmp, detonateEmp } from '../empBlast.js';
import {
  DECKER_BASE_ICE_RESISTANCE,
  DECKER_BASE_INTRUSION,
  DECKER_BASE_RAM,
} from '../constants.js';
import type { CrewInit, CrewSnapshot } from '../Crew.js';
import type { World } from '../World.js';

/**
 * Curated callsign pool for the Decker archetype. See `Merc.js` CALLSIGNS for
 * the design rationale. Decker names lean console-cowboy / matrix-jockey to
 * match the Cyberspace specialist fantasy (Phase 3).
 */
export const CALLSIGNS = Object.freeze([
  'Phreak',
  'Jack',
  'Flatline',
  'Blitz',
  'Is0bel',
  'Bytesize',
  'AcidBurn',
  'Ang3l',
  'Z0ne',
  'Tr1nity',
]);

/**
 * Decker — Cyberspace specialist (P3.M2), recruited mid-campaign rather than
 * picked at start. In Meatspace they are *viable but not optimised*: baseline
 * ranged kit with a slightly lower hit chance than the combat archetypes
 * (Merc 0.8, Tech 0.75, Razor 0.7). Their real edge is digital — and, on the
 * physical grid, the signature **Drone Override Hack**.
 *
 * Meatspace perk (P3.5.M2): **EMP**. A self-centered neural-shock blast that
 * stuns everyone alive in radius — friend, foe, and the Decker themselves — for
 * one activation (`empBlast.ts`). No aim ray, no target: the intent layer calls
 * `detonateEmp` directly. (This replaced the old Drone Override Hack, which
 * moved to the Adept archetype as "Influence" in M4.)
 *
 * Cyberspace attributes (P3.M3.3) are named stats with real effects: `ram`
 * is the avatar HP pool, `intrusionStrength` the slice progress per data-node
 * interact, `iceResistance` the avatar's `damageReduction`. They persist
 * through both crew paths (campaign crew snapshot + run-entity extra).
 */

export interface DeckerInit extends CrewInit {
  ram?: number;
  intrusionStrength?: number;
  iceResistance?: number;
}

/** P2.7.M6.2-style snapshot `extra` for the Decker — crew slice + cyber stats. */
export type DeckerSnapshot = CrewSnapshot & {
  ram: number;
  intrusionStrength: number;
  iceResistance: number;
};

export class Decker extends Crew {
  override archetype = 'Decker';

  /**
   * P3.M3.2: capability sniffed by `JackInPoint.interact` — only an actor
   * carrying a cyberdeck can open the digital layer.
   */
  readonly canJackIn = true;

  /** Avatar HP pool on the cyber grid (P3.M3.3). */
  ram: number;
  /** Slice progress per data-node interact (P3.M3.4 consumes it). */
  intrusionStrength: number;
  /** Avatar `damageReduction` against ICE (P3.M3.3). */
  iceResistance: number;

  override get baseHitChance(): number {
    return 0.7;
  }

  constructor({
    ram = DECKER_BASE_RAM,
    intrusionStrength = DECKER_BASE_INTRUSION,
    iceResistance = DECKER_BASE_ICE_RESISTANCE,
    ...props
  }: DeckerInit) {
    super({ ...props, glyph: '@' });
    if (!Number.isInteger(ram) || ram <= 0) {
      throw new RangeError(`Decker ram must be a positive integer, got ${ram}`);
    }
    if (!Number.isInteger(intrusionStrength) || intrusionStrength <= 0) {
      throw new RangeError(
        `Decker intrusionStrength must be a positive integer, got ${intrusionStrength}`
      );
    }
    if (!Number.isInteger(iceResistance) || iceResistance < 0) {
      throw new RangeError(
        `Decker iceResistance must be a non-negative integer, got ${iceResistance}`
      );
    }
    this.ram = ram;
    this.intrusionStrength = intrusionStrength;
    this.iceResistance = iceResistance;
  }

  /**
   * Pre-flight legality check for detonating an EMP. Returns `{ ok }` or
   * `{ ok: false, reason }`, mirroring the other archetype perks. Delegates to
   * the shared `empBlast` module so the rules live in one place.
   */
  canEmp() {
    return canEmp(this);
  }

  /**
   * Detonate the EMP. Throws on illegal pre-conditions (no AP burned); on a
   * legal attempt, debits AP once and stuns every alive entity in radius
   * (including this Decker). Returns the stunned entities.
   */
  detonateEmp(world: World) {
    return detonateEmp(world, this);
  }
}
