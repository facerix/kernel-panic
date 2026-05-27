/**
 * Patch — Hub clinic NPC who restores crew HP for Creds.
 *
 * Placed in the Hub grid; the player approaches and presses Space (interact)
 * to open the `<clinic-modal>` web component.
 *
 * Like the Curator, Terminal, and Finn, Patch is NEUTRAL faction, immobile,
 * zero AP, and one HP. Interaction is entirely mediated by the shell.
 */

import { Entity } from '../Entity.js';
import { FACTION } from '../constants.js';
import type { EntityInit } from '../Entity.js';

const CLINIC_GLYPH = '⧰';

type ClinicInit = Omit<EntityInit, 'faction' | 'glyph' | 'maxAp' | 'maxHp' | 'id' | 'x' | 'y'> & {
  id?: string;
  x?: number;
  y?: number;
};

export class Clinic extends Entity {
  constructor(props: ClinicInit = {}) {
    super({
      id: props.id ?? 'clinic',
      x: props.x ?? 0,
      y: props.y ?? 0,
      faction: FACTION.NEUTRAL,
      glyph: CLINIC_GLYPH,
      maxAp: 0,
      maxHp: 1,
    });
  }
}
