/**
 * Terminal — the Hub's "loadout kiosk" entity.
 *
 * Fictionally, the terminal is where the operator picks which body they're
 * jacking into for the next contract. Mechanically, it's a Curator-shaped
 * sibling: NEUTRAL faction, immobile, no AI hooks. The shell wires `interact`
 * adjacent to a Terminal → re-open the <character-select> modal.
 *
 * Glyph `'‡'` (double dagger) — distinct from any letter the renderer uses
 * for actors, prints in the neutral palette next to the Curator's `'C'`.
 */

import { Entity } from '../Entity.js';
import { FACTION } from '../constants.js';

const TERMINAL_GLYPH = '‡';

export class Terminal extends Entity {
  constructor(props = {}) {
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
