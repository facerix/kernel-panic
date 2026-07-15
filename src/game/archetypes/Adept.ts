import { Crew } from '../Crew.js';
import { canInfluence, influenceTarget } from '../mindInfluence.js';
import { ADEPT_DEFAULT_HIT_CHANCE, ADEPT_DEFAULT_DODGE_CHANCE } from '../constants.js';
import type { CrewInit } from '../Crew.js';
import type { World } from '../World.js';
import type { Entity } from '../Entity.js';
import type { Rng } from '../../rng.js';

/**
 * Curated callsign pool for the Adept archetype. See `Merc.ts` CALLSIGNS for
 * the design rationale. Adept names lean mentalist/psychic to match the
 * "dominates a hostile's will" fantasy — checked against every other pool for
 * collisions.
 */
export const CALLSIGNS = Object.freeze([
  'Oracle',
  'Mirage',
  'Sibyl',
  'Whisper',
  'Halo',
  'Delphi',
  'Thrall',
  'Mendel',
  'Wisp',
  'Seer',
  'Aura',
  'Puppet',
]);

/**
 * Adept — mind-control specialist (P3.5.M4). Inherits the old Decker "Drone
 * Override Hack" mechanic wholesale, unchanged in behavior — same aim-sector
 * target picker, same range/duration/success-chance/alarm-on-fail risk shape,
 * same countdown-and-revert lifecycle (`mindInfluence.ts`, deliberately *not*
 * migrated onto the generic status-effect channel — see P3.5.M1's "do not
 * migrate" list). Only the name and fictional framing change: **Influence**
 * is psychic domination of a hostile's will, not a firmware hack.
 *
 * A deliberately weaker combatant than the other archetypes — you bring an
 * Adept for Influence, not for their aim.
 */
export class Adept extends Crew {
  override archetype = 'Adept';

  constructor(props: CrewInit) {
    super({
      baseHitChance: ADEPT_DEFAULT_HIT_CHANCE,
      baseDodgeChance: ADEPT_DEFAULT_DODGE_CHANCE,
      ...props,
      glyph: '@',
    });
  }

  /**
   * Pre-flight legality check for a psychic domination attempt. Returns
   * `{ ok }` or `{ ok: false, reason }`, mirroring the other archetype perks.
   * Delegates to the shared `mindInfluence` module so the rules live in one
   * place (also used by the CyberAvatar's cyber-grid Override).
   */
  canInfluence(world: World, target: Entity | null) {
    return canInfluence(world, this, target);
  }

  /**
   * Attempt to dominate `target`'s will. Throws on illegal pre-conditions (no
   * AP burned); on a legal attempt, debits AP once and rolls the success
   * chance — a failure still costs AP and may trip the alarm.
   */
  influenceTarget(world: World, target: Entity, rng: Rng) {
    return influenceTarget(world, this, target, rng);
  }
}
