/**
 * Archive terminal — the Hub's diegetic Chronicle access point.
 *
 * Fictionally this is the safe house ledger where the crew reviews the live
 * Chronicle and prior campaign archives. Mechanically it matches the other
 * Hub fixtures: NEUTRAL faction, immobile, no AI hooks. The shell wires
 * `interact` adjacent to an ArchiveTerminal → open the <chronicle-archive>
 * modal.
 *
 * Glyph `'L'` — ASCII-safe "ledger/log" shorthand distinct from the crew
 * terminal's `‡`.
 */

import { Entity } from '../Entity.js';
import { FACTION } from '../constants.js';
import type { EntityInit } from '../Entity.js';

export const ARCHIVE_TERMINAL_GLYPH = '£';

type ArchiveTerminalInit = Omit<
  EntityInit,
  'faction' | 'glyph' | 'maxAp' | 'maxHp' | 'id' | 'x' | 'y'
> & {
  id?: string;
  x?: number;
  y?: number;
};

export class ArchiveTerminal extends Entity {
  constructor(props: ArchiveTerminalInit = {}) {
    super({
      id: props.id ?? 'archive-terminal',
      x: props.x ?? 0,
      y: props.y ?? 0,
      faction: FACTION.NEUTRAL,
      glyph: ARCHIVE_TERMINAL_GLYPH,
      maxAp: 0,
      maxHp: 1,
    });
  }
}
