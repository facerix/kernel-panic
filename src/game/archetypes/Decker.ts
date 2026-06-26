import { Crew } from '../Crew.js';
import { canOverride, overrideDrone } from '../droneOverride.js';
import {
  DECKER_BASE_ICE_RESISTANCE,
  DECKER_BASE_INTRUSION,
  DECKER_BASE_RAM,
} from '../constants.js';
import type { CrewInit, CrewSnapshot } from '../Crew.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

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
 * Phase-3 perk: **Override**. Reaches across a clean LOS lane to hijack a corp
 * drone's allegiance for a few turns (`droneOverride.ts`). It is a *targeted*
 * perk — the intent layer resolves a drone along the aim ray, then calls
 * `overrideDrone`.
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
   * Pre-flight legality check for overriding `target`. Returns `{ ok }` or
   * `{ ok: false, reason }`, mirroring the other archetype perks. Delegates to
   * the shared `droneOverride` module so the rules live in one place.
   */
  canOverride(world: World, target: Entity | null) {
    return canOverride(world, this, target);
  }

  /**
   * Commit an override against `target`. Throws on illegal pre-conditions
   * (no AP burned); on a legal attempt, debits AP and either flips the drone
   * or trips the alarm depending on the roll. Returns the {@link OverrideResult}.
   */
  overrideDrone(world: World, target: Entity, rng: Rng) {
    return overrideDrone(world, this, target, rng);
  }
}
