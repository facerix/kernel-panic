/**
 * P3.M3.3 — the Decker's avatar on the Cyberspace grid.
 *
 * A plain `Entity` (NOT a `Crew` — no inventory or gear): the cyber grid has
 * its own verbs, including the Decker's Override signature against ICE. Pools
 * derive from the Decker's named cyber stats:
 *
 *   - `maxHp = decker.ram` — ICE damage burns RAM; zero RAM = flatline
 *     (avatar death routes through the existing DEATH path; scope decision #3).
 *   - `damageReduction = decker.iceResistance` — the existing min-1
 *     mitigation in `Combat.ts` applies unchanged.
 *   - `intrusionStrength` — slice progress per data-node interact (P3.M3.4).
 *
 * `baseHitChance` rides the capability sniff in `Combat.resolveRanged`
 * (`'baseHitChance' in attacker`), so the avatar fights with zero combat-code
 * changes. `isCyberAvatar` is the capability `EntryPort` sniffs — `Decker`
 * also carries `intrusionStrength`, so a flag (not the stat) marks the avatar.
 */
import { Entity } from '../Entity.js';
import { canOverride, overrideDrone } from '../droneOverride.js';
import { CYBER_AVATAR_HIT_CHANCE, CYBER_AVATAR_MAX_AP, FACTION } from '../constants.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export type CyberAvatarInit = {
  id: string;
  x: number;
  y: number;
  /** Avatar HP pool — the owning Decker's RAM. */
  ram: number;
  intrusionStrength: number;
  /** Avatar `damageReduction` — the owning Decker's ICE resistance. */
  iceResistance: number;
  callsign?: string | null;
  maxAp?: number;
};

/**
 * P2.7.M6.2: avatar snapshot `extra`. Current RAM rides the base entity
 * record (`hp`/`maxHp`/`damageReduction`); only the non-Entity fields live here.
 */
export type CyberAvatarSnapshot = {
  intrusionStrength: number;
  callsign: string | null;
};

export class CyberAvatar extends Entity {
  /** Capability sniffed by `EntryPort.interact` — only the avatar routes out. */
  readonly isCyberAvatar = true;

  intrusionStrength: number;
  callsign: string | null;

  get baseHitChance(): number {
    return CYBER_AVATAR_HIT_CHANCE;
  }

  /** Alias for the HP pool in cyber terms. */
  get ram(): number {
    return this.maxHp;
  }

  /** Alias for `damageReduction` in cyber terms. */
  get iceResistance(): number {
    return this.damageReduction;
  }

  /** Decker Override translated into the digital layer: ICE is hostile code. */
  canOverride(world: World, target: Entity | null) {
    return canOverride(world, this, target);
  }

  /** Attempt to flip ICE to the avatar's faction for the normal override duration. */
  overrideDrone(world: World, target: Entity, rng: Rng) {
    return overrideDrone(world, this, target, rng);
  }

  constructor({
    id,
    x,
    y,
    ram,
    intrusionStrength,
    iceResistance,
    callsign = null,
    maxAp = CYBER_AVATAR_MAX_AP,
  }: CyberAvatarInit) {
    if (!Number.isInteger(ram) || ram <= 0) {
      throw new RangeError(`CyberAvatar ram must be a positive integer, got ${ram}`);
    }
    if (!Number.isInteger(intrusionStrength) || intrusionStrength <= 0) {
      throw new RangeError(
        `CyberAvatar intrusionStrength must be a positive integer, got ${intrusionStrength}`
      );
    }
    if (!Number.isInteger(iceResistance) || iceResistance < 0) {
      throw new RangeError(
        `CyberAvatar iceResistance must be a non-negative integer, got ${iceResistance}`
      );
    }
    if (callsign !== null && (typeof callsign !== 'string' || callsign.length === 0)) {
      throw new TypeError(`CyberAvatar callsign must be a non-empty string or null`);
    }
    super({
      id,
      x,
      y,
      faction: FACTION.PLAYER,
      glyph: '@',
      maxAp,
      maxHp: ram,
      damageReduction: iceResistance,
    });
    this.intrusionStrength = intrusionStrength;
    this.callsign = callsign;
  }
}
