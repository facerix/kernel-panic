/**
 * Relay node — a destructible CORP-faction entity used as a sweep-objective
 * target. Has HP, can be destroyed by player ranged or melee attacks, but
 * has no AI and never acts. Not a `Hostile` — player turrets won't waste
 * shots on it (turrets target `Hostile` instances), and drones don't need to
 * interact with it.
 *
 * Glyph: `'~'` (distinct from terminals, corp turrets, and drones).
 *
 * Placed by `Run.enterCombat` when the contract objective is `sweep` with
 * a relay-node–style `params.target`. Destruction is tracked by
 * `isObjectiveSatisfied` (sweep quota).
 */

import { Entity, type EntityInit } from '../Entity.js';
import { FACTION } from '../constants.js';
import { RELAY_NODE_HP } from '../constants.js';

export const RELAY_NODE_GLYPH = '~';

export interface RelayNodeInit extends Omit<EntityInit, 'faction' | 'glyph' | 'maxAp'> {
  label?: string;
}

/** M6.2: RelayNode snapshot `extra`. */
export type RelayNodeSnapshot = {
  label: string;
};

export class RelayNode extends Entity {
  label: string;
  /** Stationary infrastructure cannot dodge melee. */
  readonly baseDodgeChance = 0;

  constructor({ label = 'Relay node', maxHp = RELAY_NODE_HP, ...props }: RelayNodeInit) {
    super({
      ...props,
      faction: FACTION.CORP,
      glyph: RELAY_NODE_GLYPH,
      maxAp: 0,
      maxHp,
      anchored: true,
    });
    this.label = label;
  }
}
