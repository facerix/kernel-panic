/**
 * Pure touch-pad dispatcher. Translates an on-screen button identifier into
 * a synthetic keymap keystroke and runs it through the existing `dispatch`
 * mode machine, so the touch input shares one source of truth with the
 * keyboard. The DOM-side `<touch-pad>` component is a thin wrapper around
 * this module — same architecture split as render/.
 *
 * Button identifiers:
 *   - Directions (8): N, NE, E, SE, S, SW, W, NW
 *   - Actions: fire, special, interact, jack-out, look, inventory, flip,
 *     end-turn, cancel
 *   - Shell (not `applyIntent`): quit-campaign → synthetic `Q`
 *
 * The `special` action covers each archetype's perk verb (Merc Vault, Razor
 * Slide, Tech Deploy) — same unified-perk-key design as the keyboard layer.
 * `interact` synthesizes a Space keystroke (keyboard parity with the keymap).
 *
 * Unknown buttons throw — silently dropping a button press would mask UI
 * wiring bugs.
 */

import { dispatch } from './keymap.js';
import type { AimKind, DispatchResult, Mode, PerkAim } from './keymap.js';

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
  special: 'x',
  interact: ' ',
  'jack-out': 'j',
  inventory: 'i',
  look: 'l',
  // P3.M4.3: simstim flip — Tab swaps active control between operators.
  flip: 'Tab',
  'end-turn': '.',
  cancel: 'Escape',
});

const SHELL_KEYS = Object.freeze({
  'quit-campaign': 'Q',
});

export const TOUCHPAD_DIRECTIONS = Object.freeze(Object.keys(DIRECTION_KEYS));
export const TOUCHPAD_ACTIONS = Object.freeze(Object.keys(ACTION_KEYS));
export const TOUCHPAD_SHELL_ACTIONS = Object.freeze(Object.keys(SHELL_KEYS));

/**
 * Resolve a touch-pad button id to the synthetic key the keymap expects.
 * Exported so the component can label buttons consistently with the keyboard
 * shortcut shown in the debug harness ("FIRE (f)" etc.).
 */
export function syntheticKeyFor(buttonId: string): string {
  if (Object.hasOwn(DIRECTION_KEYS, buttonId as keyof typeof DIRECTION_KEYS))
    return DIRECTION_KEYS[buttonId as keyof typeof DIRECTION_KEYS];
  if (Object.hasOwn(ACTION_KEYS, buttonId as keyof typeof ACTION_KEYS))
    return ACTION_KEYS[buttonId as keyof typeof ACTION_KEYS];
  if (Object.hasOwn(SHELL_KEYS, buttonId as keyof typeof SHELL_KEYS))
    return SHELL_KEYS[buttonId as keyof typeof SHELL_KEYS];
  throw new Error(`touchpad: unknown button "${buttonId}"`);
}

/**
 * Dispatch a touch-pad button press through the shared keymap state machine.
 * Returns the same `{ intent, nextMode }` shape `dispatch` returns, so the
 * harness can reuse its existing applyIntent/onModeChange paths verbatim.
 */
export function dispatchTouchAction(
  buttonId: string,
  mode: Mode,
  aimKind: AimKind | null = null,
  specialAim: PerkAim = 'directional'
): DispatchResult {
  return dispatch(syntheticKeyFor(buttonId), mode, aimKind, specialAim);
}
