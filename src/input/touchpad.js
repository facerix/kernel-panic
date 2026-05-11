/**
 * Pure touch-pad dispatcher. Translates an on-screen button identifier into
 * a synthetic keymap keystroke and runs it through the existing `dispatch`
 * mode machine, so the touch input shares one source of truth with the
 * keyboard. The DOM-side `<touch-pad>` component is a thin wrapper around
 * this module — same architecture split as render/.
 *
 * Button identifiers:
 *   - Directions (8): N, NE, E, SE, S, SW, W, NW
 *   - Actions: fire, melee, vault, slide, interact, wait, end-turn, cancel
 *
 * Unknown buttons throw — silently dropping a button press would mask UI
 * wiring bugs.
 */

import { dispatch } from './keymap.js';

const DIRECTION_KEYS = Object.freeze({
  N: 'ArrowUp',
  S: 'ArrowDown',
  W: 'ArrowLeft',
  E: 'ArrowRight',
  NW: 'q',
  NE: 'e',
  SW: 'z',
  SE: 'c',
});

const ACTION_KEYS = Object.freeze({
  fire: 'f',
  melee: 'm',
  vault: 'v',
  slide: 't',
  interact: 'i',
  wait: '.',
  'end-turn': ' ',
  cancel: 'Escape',
});

export const TOUCHPAD_DIRECTIONS = Object.freeze(Object.keys(DIRECTION_KEYS));
export const TOUCHPAD_ACTIONS = Object.freeze(Object.keys(ACTION_KEYS));

/**
 * Resolve a touch-pad button id to the synthetic key the keymap expects.
 * Exported so the component can label buttons consistently with the keyboard
 * shortcut shown in the debug harness ("FIRE (f)" etc.).
 */
export function syntheticKeyFor(buttonId) {
  if (Object.hasOwn(DIRECTION_KEYS, buttonId)) return DIRECTION_KEYS[buttonId];
  if (Object.hasOwn(ACTION_KEYS, buttonId)) return ACTION_KEYS[buttonId];
  throw new Error(`touchpad: unknown button "${buttonId}"`);
}

/**
 * Dispatch a touch-pad button press through the shared keymap state machine.
 * Returns the same `{ intent, nextMode }` shape `dispatch` returns, so the
 * harness can reuse its existing applyIntent/onModeChange paths verbatim.
 */
export function dispatchTouchAction(buttonId, mode) {
  return dispatch(syntheticKeyFor(buttonId), mode);
}
