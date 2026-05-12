/**
 * Player-facing status copy while the CORP faction is taking its turn.
 * Counts how many live corp units sit on a tile the viewer currently sees.
 */

import { FACTION } from './constants.js';

/**
 * @param {Iterable<{ alive?: boolean, faction?: string, x: number, y: number }>} entities
 * @param {(x: number, y: number) => boolean} isTileVisible
 * @returns {number}
 */
export function countVisibleCorpEntities(entities, isTileVisible) {
  let n = 0;
  for (const e of entities) {
    if (!e?.alive || e.faction !== FACTION.CORP) continue;
    if (isTileVisible(e.x, e.y)) n++;
  }
  return n;
}

/**
 * Plain-text line body after the "CORP" label (no HTML).
 *
 * @param {number} visibleCorpCount
 * @returns {string}
 */
export function corpTurnStatusBody(visibleCorpCount) {
  if (visibleCorpCount >= 2) {
    return 'Multiple hostiles in sight — units repositioning.';
  }
  if (visibleCorpCount === 1) {
    return 'A security drone moves in your sightline.';
  }
  return 'You hear movement nearby.';
}
