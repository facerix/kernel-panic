/**
 * Terminal — the Hub's "loadout kiosk" entity.
 *
 * Fictionally, the terminal is where the operator picks which body they're
 * jacking into for the next contract. Mechanically, it's a Curator-shaped
 * sibling: NEUTRAL faction, immobile, no AI hooks. The shell wires `interact`
 * adjacent to a Terminal → open the <crew-roster> modal.
 *
 * Glyph `'‡'` (double dagger) — distinct from any letter the renderer uses
 * for actors, prints in the neutral palette next to the Curator's `'C'`.
 */

import { Entity } from '../Entity.js';
import { FACTION } from '../constants.js';
import type { EntityInit } from '../Entity.js';

const TERMINAL_GLYPH = '‡';

type TerminalInit = Omit<EntityInit, 'faction' | 'glyph' | 'maxAp' | 'maxHp' | 'id' | 'x' | 'y'> & {
  id?: string;
  x?: number;
  y?: number;
};
export class Terminal extends Entity {
  constructor(props: TerminalInit = {}) {
    super({
      id: props.id ?? 'terminal',
      x: props.x ?? 0,
      y: props.y ?? 0,
      faction: FACTION.NEUTRAL,
      glyph: TERMINAL_GLYPH,
      // Like the Curator: zero AP so the TurnQueue doesn't try to schedule it,
      // minimum positive HP so it satisfies the Entity contract.
      maxAp: 0,
      maxHp: 1,
    });
  }
}
