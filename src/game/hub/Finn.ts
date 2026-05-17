/**
 * Finn — Hub fence NPC who trades salvage for gear, consumables, and upgrades.
 *
 * A nod to Gibson's fence archetype: Finn accepts salvage and sells items
 * from a catalog that grows as the player purchases meta-upgrades. Placed in
 * the Hub grid; the player approaches and presses Space (interact) to open
 * the `<finn-shop>` web component.
 *
 * Like the Curator and Terminal, Finn is NEUTRAL faction, immobile, zero AP,
 * and one HP. The interaction is entirely mediated by the shell — Finn's game-
 * logic interface is just `catalog(meta)` which returns the filtered item
 * list the shop UI presents.
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
   * Return the shop catalog filtered by the campaign's meta-upgrade state.
   * The shell passes this to `<finn-shop>.setCatalog()`.
   *
   * @param {{ expandedCatalog?: boolean }} meta
   */
  catalog(meta = {}) {
    return getShopCatalog(meta);
  }
}
