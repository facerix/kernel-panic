/**
 * Source of truth for the `<key-help>` panel.
 *
 * `keymap.js` uses switch blocks (not a data table) so its bindings can't be
 * introspected directly. `HELP_ROWS` is the hand-authored mirror; a unit test
 * (`tests/unit/input/keyHelp.test.js`) verifies every advertised key is
 * actually handled by `dispatch(key, MODE.IDLE)` and that a sentinel of known
 * keymap keys is present here. When a future milestone adds a binding to
 * `keymap.js`, the sentinel test fails until this list catches up. Letter
 * keys in the keymap are lower-case only (case-sensitive dispatch).
 *
 * Scope semantics:
 *   - `'hub'`     — visible in the Hub only (no combat verbs)
 *   - `'combat'`  — visible during COMBAT only (perks, attacks)
 *   - `'both'`    — visible everywhere the help overlay can mount
 *
 * `?` itself is a UI-level binding (handled in the shell, not in
 * `keymap.js`); the test skips its keymap-dispatch check.
 */

export const HELP_ROWS = Object.freeze([
  // --- movement ---------------------------------------------------------
  {
    keys: Object.freeze(['w', 'a', 's', 'd']),
    label: 'Move (WASD)',
    scope: 'both',
    group: 'move',
  },
  {
    keys: Object.freeze(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']),
    label: 'Move (arrows)',
    scope: 'both',
    group: 'move',
  },
  {
    keys: Object.freeze(['q', 'e', 'z', 'c']),
    label: 'Move (diagonals)',
    scope: 'both',
    group: 'move',
  },
  // --- action -----------------------------------------------------------
  {
    keys: Object.freeze(['f']),
    label: 'Fire — ranged attack',
    scope: 'combat',
    group: 'action',
  },
  {
    // Unified archetype perk: Merc → Vault, Razor → Slide, Tech → Deploy.
    // Single key, single touch button, single help row — the live verb is
    // determined by the player's class at intent-apply time.
    keys: Object.freeze(['x']),
    label: 'Special action ({perkName})',
    scope: 'combat',
    group: 'action',
  },
  {
    keys: Object.freeze([' ']),
    label: 'Interact (Finn, Curator, pick up salvage, etc)',
    scope: 'both',
    group: 'action',
  },
  {
    // Inventory is available in both Hub and combat. In Hub it shows the
    // campaign salvage wallet (no consumables); in combat it shows the
    // deployed crew member's job-scoped wallet + their consumables.
    keys: Object.freeze(['i']),
    label: 'Inventory (salvage + consumables)',
    scope: 'both',
    group: 'action',
  },
  {
    keys: Object.freeze(['l']),
    label: 'Look — inspect map (move cursor, Esc to exit)',
    scope: 'both',
    group: 'action',
  },
  {
    // P3.M4.3 simstim flip — swap control between the Meatspace operator and
    // the Decker's Cyberspace avatar (only on a dual-deploy jack-in).
    keys: Object.freeze(['Tab']),
    label: 'Flip — switch Meatspace / Cyberspace control',
    scope: 'combat',
    group: 'action',
  },
  // --- system -----------------------------------------------------------
  {
    keys: Object.freeze(['.']),
    label: 'Wait (pass turn)',
    scope: 'combat',
    group: 'system',
  },
  {
    keys: Object.freeze(['Q']),
    label: 'Quit campaign (delete save, confirm)',
    scope: 'both',
    group: 'system',
  },
  {
    keys: Object.freeze(['Escape']),
    label: 'Cancel / close',
    scope: 'both',
    group: 'system',
  },
  {
    keys: Object.freeze(['?']),
    label: 'Toggle this help',
    scope: 'both',
    group: 'system',
  },
]);

const KNOWN_SCOPES = new Set(['hub', 'combat']);

/**
 * Return the help rows visible in the given Run-state scope. Combines `scope`
 * with `'both'`. Throws on unknown scope — the help panel feeds in
 * `Run.state`, and a typo there should crash rather than render a blank list.
 */
export function describeKeymap(scope: string) {
  if (!KNOWN_SCOPES.has(scope)) {
    throw new Error(`describeKeymap: unknown scope "${scope}"`);
  }
  return HELP_ROWS.filter(r => r.scope === scope || r.scope === 'both');
}
