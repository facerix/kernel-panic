/**
 * Truly neutral civilian — bystanders in the combat zone. NEUTRAL faction,
 * no weapons. Behaviour scales with the campaign's Rep meter:
 *
 *   rep ≥ 70 (NEUTRAL_IDLE_THRESHOLD)  → idle; trusts the operator.
 *   30 ≤ rep < 70                       → flees one tile away from player.
 *   rep < 30 (NEUTRAL_FLEE_THRESHOLD)   → panics, emits noise that draws
 *                                         drone investigation.
 *
 * Never fights under any condition. Killing a NeutralCivilian triggers
 * `civilian:harmed` → Rep penalty (wired in Run + shell).
 *
 * Acts during the **player aftermath** phase (between turret autofire and
 * corp AI), not during the corp turn. This is deliberate: the neutral
 * civilian reacts to the player's action, not to corp commands.
 *
 * `takeTurn(world, rng, { rep })` accepts the current campaign rep as
 * context so the entity stays testable without a Campaign reference.
 */

import { Entity, type EntityInit } from '../Entity.js';
import { FACTION, SIGHT_RANGE, REP, NOISE_RADIUS } from '../constants.js';
import { EVENT } from '../events.js';
import { withinRange } from '../LineOfSight.js';
import type { NeutralCivilianTurnStep } from '../../types.js';
import type { World } from '../World.js';
import type { Rng } from '../../rng.js';

export type NeutralCivilianTurnContext = {
  rep: number;
};

export interface NeutralCivilianInit extends Omit<
  EntityInit,
  'faction' | 'glyph' | 'maxAp' | 'maxHp'
> {
  sightRange?: number;
}

export class NeutralCivilian extends Entity {
  sightRange: number;

  constructor({ sightRange = SIGHT_RANGE, ...props }: NeutralCivilianInit) {
    super({
      ...props,
      faction: FACTION.NEUTRAL,
      glyph: 'n',
      maxAp: 1,
      maxHp: 1,
    });
    if (!Number.isInteger(sightRange) || sightRange < 0) {
      throw new RangeError(
        `NeutralCivilian sightRange must be a non-negative integer, got ${sightRange}`
      );
    }
    this.sightRange = sightRange;
  }

  /**
   * Neutral turn — the aftermath-phase equivalent of `takeTurnSteps`.
   *
   * Named separately because the signature differs: NeutralCivilian needs
   * campaign `rep` context (the corp AI methods don't), and the return is
   * a single step-or-null rather than a generator. The pipeline calls this
   * during Phase 2 of `runPlayerAftermathSteps`.
   *
   * @param context.rep — current campaign Rep value, passed by the pipeline.
   */
  takeAftermathStep(
    world: World,
    rng: Rng,
    { rep }: NeutralCivilianTurnContext
  ): NeutralCivilianTurnStep | null {
    if (!this.alive) return null;
    if (!Number.isFinite(rep)) {
      throw new TypeError(`NeutralCivilian.act: rep must be a finite number, got ${rep}`);
    }

    const player = this.#findPlayer(world);
    if (!player) return null; // no player visible — idle regardless of rep

    if (rep >= REP.NEUTRAL_IDLE_THRESHOLD) {
      // Trusts the operator — stand still.
      return { type: 'neutral-idle' };
    }

    if (rep >= REP.NEUTRAL_FLEE_THRESHOLD) {
      // Nervous — move one tile away from the player.
      return this.#flee(world, player);
    }

    // Panicked — emit noise to draw drone attention.
    world.events?.emit(EVENT.NOISE, {
      origin: { x: this.x, y: this.y },
      radius: NOISE_RADIUS.RANGED,
      source: this,
      kind: 'civilian-panic',
    });
    return { type: 'neutral-panic' };
  }

  /**
   * Greedy one-step flee: pick the passable, unoccupied neighbor that
   * maximizes Chebyshev distance from the threat. Ties broken by rng (not
   * used currently — first-found wins). If cornered, stay put.
   */
  #flee(world: World, threat: Entity): NeutralCivilianTurnStep {
    let bestDist = -1;
    let bestDx = 0;
    let bestDy = 0;
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        if (dx === 0 && dy === 0) continue;
        const nx = this.x + dx;
        const ny = this.y + dy;
        if (!world.grid.inBounds(nx, ny)) continue;
        if (!world.grid.isPassable(nx, ny)) continue;
        if (world.entityAt(nx, ny)) continue;
        const dist = Math.max(Math.abs(nx - threat.x), Math.abs(ny - threat.y));
        if (dist > bestDist) {
          bestDist = dist;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
    if (bestDist <= 0) {
      // Cornered — nowhere to flee.
      return { type: 'neutral-cornered' };
    }
    // Free movement — no AP cost. `relocateEntity` validates bounds,
    // passability, and occupancy atomically, preventing two civilians from
    // fleeing to the same tile (the old direct-mutation was a TOCTOU).
    world.relocateEntity(this, this.x + bestDx, this.y + bestDy);
    return { type: 'neutral-flee', to: { x: this.x, y: this.y } };
  }

  /** Find the closest visible PLAYER-faction entity. */
  #findPlayer(world: World): Entity | null {
    let best: Entity | null = null;
    let bestD2 = Infinity;
    for (const entity of world.entities.values()) {
      if (!entity.alive || entity.faction !== FACTION.PLAYER) continue;
      if (!withinRange(this.x, this.y, entity.x, entity.y, this.sightRange)) continue;
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
