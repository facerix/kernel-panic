/**
 * Player-facing status copy while the CORP faction is taking its turn.
 * Counts how many live corp units sit on a tile the viewer currently sees.
 */

import { FACTION } from './constants.js';

const GENERIC_STATUS_MESSAGES = [
  'You hear movement nearby.',
  'A dull thud echoes through the ductwork — then silence.',
  'Distant servos cycle; a status LED strobes somewhere you cannot see.',
  'Your comms burp with clipped traffic — encrypted, wrong subnet.',
  'Cold air pushes past — climate control routing around a sealed zone.',
  'Footfalls on grated decking, then nothing. Wrong rhythm for civ traffic.',
  'A PA line crackles with a truncated all-clear.',
  'Magnetic locks chatter in sequence down the corridor.',
  'The lights dip — load shedding, or heavy gear cycling out of frame.',
  'A camera motor whines; the lens hunts a sector you are not in.',
  'Your HUD throws a ghost tag: proximity, no fix.',
  'The floor thrums once — low frequency, something massive repositioning.',
];

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

const corpNoiseForTurn = new Map();
/**
 * Plain-text line body after the "CORP" label (no HTML).
 * If any corp entities are visible, we show a specific status text.
 * Otherwise, we select a generic tone-setting message once that will be displayed for that full turn.
 *
 * @param {number} visibleCorpCount
 * @param {number} turnNumber
 * @returns {string}
 */
export function corpTurnStatusBody(visibleCorpCount, turnNumber) {
  if (visibleCorpCount >= 2) {
    return 'Multiple hostiles in sight — units repositioning.';
  }
  if (visibleCorpCount === 1) {
    return 'A security drone moves in your sightline.';
  }

  if (corpNoiseForTurn.has(turnNumber)) {
    return corpNoiseForTurn.get(turnNumber);
  }
  // not using Rng here because which message is shown doesn't need to be re-playable for a given seed.
  const messageForUnseenCorp =
    GENERIC_STATUS_MESSAGES[Math.floor(Math.random() * GENERIC_STATUS_MESSAGES.length)];
  corpNoiseForTurn.set(turnNumber, messageForUnseenCorp);
  return messageForUnseenCorp;
}
