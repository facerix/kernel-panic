/**
 * Curator NPC — the static figure who hands out contracts in the Hub.
 *
 * Role-wise the Curator is closer to a kiosk than a combatant: NEUTRAL
 * faction, immobile, no AI hooks. The player approaches and presses
 * `interact`; the Hub harness calls `generateContract(rng)` and feeds the
 * result into `<run-briefing>`.
 *
 * The contract stub today carries a single objective (`reach-exit`) and a
 * threat budget (drone count). Future quests (rescue / heist / sabotage)
 * extend the `objective` enum without changing the Curator's interface.
 *
 * `generateContract` is deterministic on the supplied Rng — the Curator
 * doesn't roll behind your back. That's what makes the M8 save flow
 * round-trippable: snapshot the rng state, restore, and the same contract
 * comes out.
 */

import { Entity } from '../Entity.js';
import { FACTION } from '../constants.js';
import type { Rng } from '../../rng.js';
import type { EntityInit } from '../Entity.js';

export const OBJECTIVES = Object.freeze({
  REACH_EXIT: 'reach-exit',
});

const KNOWN_OBJECTIVES = new Set(Object.values(OBJECTIVES));
type Objective = (typeof OBJECTIVES)[keyof typeof OBJECTIVES];

const CONTRACT_LABELS = Object.freeze([
  'Sublevel 3 cache',
  'Vuong Holdings server farm',
  'Black market dropoff — Pier 9',
  'Glassed clinic data dump',
  'Spinning Fox warehouse',
]);

const CURATOR_GLYPH = 'C';

export type Contract = {
  seed: number;
  objective: Objective;
  threatCount: number;
  label: string;
  /** M8: high-tier contracts may carry a recruitment reward. */
  reward?: { recruit?: boolean };
};

type CuratorInit = Omit<EntityInit, 'faction' | 'glyph' | 'maxAp' | 'maxHp' | 'id' | 'x' | 'y'> & {
  id?: string;
  x?: number;
  y?: number;
};
export class Curator extends Entity {
  constructor(props: CuratorInit = {}) {
    super({
      id: props.id ?? 'curator',
      x: props.x ?? 0,
      y: props.y ?? 0,
      faction: FACTION.NEUTRAL,
      glyph: CURATOR_GLYPH,
      // The Curator never spends AP — give her the bare minimum the Entity
      // contract requires (positive HP, zero AP).
      maxAp: 0,
      maxHp: 1,
    });
  }

  /**
   * Roll a contract. Pulls 2 numbers from the rng:
   *   - one for the random label (flavour),
   *   - one for the seed Combat will use.
   * Threat count is fixed at 2 in M8 (per the milestone plan). Future
   * objectives can override.
   */
  generateContract(rng: Rng): Contract {
    if (!rng || typeof rng.next !== 'function') {
      throw new TypeError('Curator.generateContract requires an Rng');
    }
    const label = rng.pick(CONTRACT_LABELS);
    const seed = rng.intRange(0, 0x7fffffff);
    return {
      seed,
      objective: OBJECTIVES.REACH_EXIT,
      threatCount: 2,
      label,
    };
  }
}

export function isObjective(value: string): value is Objective {
  return KNOWN_OBJECTIVES.has(value as Objective);
}
