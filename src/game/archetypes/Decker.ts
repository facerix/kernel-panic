import { Crew } from '../Crew.js';
import { canOverride, overrideDrone } from '../droneOverride.js';
import type { CrewInit } from '../Crew.js';
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
 * `overrideDrone`. Cyberspace attributes (RAM, intrusion strength, ICE
 * resistance) are deferred to P3.M3, when the Cyberspace grid consumes them.
 */
export class Decker extends Crew {
  override archetype = 'Decker';

  override get baseHitChance(): number {
    return 0.7;
  }

  constructor(props: CrewInit) {
    super({ ...props, glyph: '@' });
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
