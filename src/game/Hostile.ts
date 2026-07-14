import { Entity, type EntityInit } from './Entity.js';
import { EscortNpc } from './entities/EscortNpc.js';
import { FACTION, SIGHT_RANGE, type FactionId } from './constants.js';
import { hasLineOfSight, withinRange } from './LineOfSight.js';
import type { Rng } from '../rng.js';
import type { TurnActionStep } from '../types.js';
import type { World } from './World.js';

export interface HostileInit extends EntityInit {
  sightRange?: number;
}

/**
 * Abstract base for enemies that actively oppose another faction.
 *
 * This class deliberately does not mean "corp": future hostiles can carry
 * their own faction while sharing the same visibility and stealth-aware target
 * acquisition rules.
 */
export abstract class Hostile extends Entity {
  sightRange: number;

  /**
   * Mind-influence/override state (P3.M2; renamed/rehomed P3.5.M4). While
   * `overrideTurnsRemaining > 0` this hostile has been dominated: its
   * `faction` is temporarily the operator's (PLAYER) and
   * `factionBeforeOverride` records the allegiance to restore when the
   * influence lapses. Both default to the not-overridden state so every
   * existing hostile is unaffected. Field names are deliberately unchanged by
   * the M4 rename — they're shared bookkeeping for both the Adept's Meatspace
   * Influence and the CyberAvatar's cyber-grid Override against ICE. The
   * countdown is ticked once per player turn by `stepInfluencedHostiles` (see
   * `mindInfluence.ts`).
   */
  overrideTurnsRemaining: number;
  factionBeforeOverride: FactionId | null;

  constructor({ sightRange = SIGHT_RANGE, ...props }: HostileInit) {
    if (!Number.isInteger(sightRange) || sightRange < 0) {
      throw new RangeError(`Hostile sightRange must be a non-negative integer, got ${sightRange}`);
    }
    super(props);
    this.sightRange = sightRange;
    this.overrideTurnsRemaining = 0;
    this.factionBeforeOverride = null;
  }

  /** Whether this hostile is currently flipped to the player's side. */
  get isOverridden(): boolean {
    return this.overrideTurnsRemaining > 0;
  }

  abstract override takeTurn(world: World, rng: Rng): void | TurnActionStep[];

  isHostileTo(entity: Entity): boolean {
    // NEUTRAL entities are bystanders — never valid targets for hostiles.
    if (entity.faction === FACTION.NEUTRAL) return false;
    // Escort allies are player-aligned but non-combatants for corp AI.
    if (entity instanceof EscortNpc) return false;
    return entity.faction !== this.faction;
  }

  canAcquireTarget(world: World, target: Entity): boolean {
    if (!target.alive || !this.isHostileTo(target)) return false;
    if (!withinRange(this.x, this.y, target.x, target.y, this.sightRange)) return false;
    if (
      !hasLineOfSight(world.grid, this.x, this.y, target.x, target.y, {
        blockers: world.blockerKeys(),
      })
    ) {
      return false;
    }
    return target.isSpottableBy(this);
  }

  /**
   * Acquire the closest visible hostile (different faction). Squared-distance
   * comparison avoids `Math.sqrt`; exact distance is irrelevant.
   */
  acquireTarget(world: World): Entity | null {
    let best: Entity | null = null;
    let bestD2 = Infinity;
    for (const entity of world.entities.values()) {
      if (!this.canAcquireTarget(world, entity)) continue;
      const dx = entity.x - this.x;
      const dy = entity.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = entity;
      }
    }
    return best;
  }
}
