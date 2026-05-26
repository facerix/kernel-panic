/**
 * Finn — Hub fence NPC who trades salvage for gear and consumables.
 *
 * A nod to Gibson's fence archetype: Finn accepts salvage and sells items.
 * Placed in the Hub grid; the player approaches and presses Space (interact)
 * to open the `<finn-shop>` web component.
 *
 * Like the Curator and Terminal, Finn is NEUTRAL faction, immobile, zero AP,
 * and one HP. The interaction is entirely mediated by the shell — Finn's game-
 * logic interface is just `catalog()` which returns the item list the shop UI
 * presents. M5.1 removed meta upgrades (Rep tiers replace them).
 */

import { Entity } from '../Entity.js';
import { FACTION } from '../constants.js';
import { getShopCatalog } from '../items.js';
import type { EntityInit } from '../Entity.js';

const FINN_GLYPH = '¥';

type FinnInit = Omit<EntityInit, 'faction' | 'glyph' | 'maxAp' | 'maxHp' | 'id' | 'x' | 'y'> & {
  id?: string;
  x?: number;
  y?: number;
};
export class Finn extends Entity {
  constructor(props: FinnInit = {}) {
    super({
      id: props.id ?? 'finn',
      x: props.x ?? 0,
      y: props.y ?? 0,
      faction: FACTION.NEUTRAL,
      glyph: FINN_GLYPH,
      maxAp: 0,
      maxHp: 1,
    });
  }

  /**
   * Return the shop catalog filtered by the player's current Rep tier.
   * Higher Rep unlocks more items — see `getShopCatalog` for tier mapping.
   */
  catalog(rep: number = 20) {
    return getShopCatalog(rep);
  }
}
