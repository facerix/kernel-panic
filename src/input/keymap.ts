/**
 * Pure input dispatcher. Maps `(key, mode)` to `{ intent, nextMode }` so the
 * game loop is input-source agnostic — the same intent stream powers both
 * the keyboard controller and the M7 on-screen touch pad (which synthesizes
 * keystrokes via `src/input/touchpad.js`).
 *
 * The dispatcher is a small mode machine. IDLE is the default; pressing an
 * "aim" key (`f` for fire, `x` for the archetype-specific "special action")
 * enters an aiming mode where the next directional press
 * resolves into a targeted intent. Wait / pass turn is `.` in IDLE
 * (`end-turn` intent). Interact (Curator, Terminal, …) is Space in IDLE;
 * `i` is unbound (reserved for a future inventory milestone). `Q` emits
 * `quit-campaign` in IDLE only — the shell confirms, deletes the save, and
 * starts a new campaign (not routed through `applyIntent`).
 *
 * The archetype-specific perks — Merc's Vault, Razor's Slide, Tech's Deploy
 * Turret — collapse into a single `special` intent here at the dispatcher
 * layer (one key, one aim mode). `applyIntent.doSpecial` then routes the
 * intent to the right verb based on the player class. Rationale: one mental
 * model for the player ("press the perk key, pick a direction"), one set of
 * touch-pad buttons, no key-bind collisions with WASD movement.
 *
 * Intents are plain serializable objects so they can be replayed for tests,
 * undo, or networked play later.
 *
 * Letter bindings are **case-sensitive**: only the lower-case keys shown in
 * `DIRECTION_KEYS` and `dispatchIdle` are recognised. `KeyboardEvent.key` is
 * passed through as-is so Shift/Caps Lock upper-case letters do not alias to
 * gameplay verbs (touch-pad synthesis continues to use lower-case keys).
 */

export const MODE = Object.freeze({
  IDLE: 'IDLE',
  FIRE_AIM: 'FIRE_AIM',
  /**
   * Unified archetype-perk aim mode. Replaces the M1 `VAULT_AIM` and
   * `SLIDE_AIM` modes; the active player's class decides what `special`
   * resolves to at intent-apply time.
   */
  SPECIAL_AIM: 'SPECIAL_AIM',
});

export type Mode = (typeof MODE)[keyof typeof MODE];

const DIRECTION_KEYS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  q: [-1, -1],
  e: [1, -1],
  z: [-1, 1],
  c: [1, 1],
  // WASD as an alternative orthogonal scheme (per the M3 plan).
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};

const directionFor = (key: string) => DIRECTION_KEYS[key as keyof typeof DIRECTION_KEYS] ?? null;

const noChange = (mode: string) => ({ intent: null, nextMode: mode });

function dispatchIdle(key: string) {
  const dir = directionFor(key);
  if (dir) {
    return { intent: { type: 'move', dx: dir[0], dy: dir[1] }, nextMode: MODE.IDLE };
  }
  switch (key) {
    case 'Q':
      return { intent: { type: 'quit-campaign' }, nextMode: MODE.IDLE };
    case '.':
      // Wait / pass turn — same intent as the touch-pad WAIT button (`.`).
      return { intent: { type: 'end-turn' }, nextMode: MODE.IDLE };
    case ' ':
      // Interact — context-sensitive verb resolved by the shell (Hub Curator
      // → briefing, future terminals/items in combat). Keymap stays dumb;
      // the shell decides what `interact` means in the current Run.state.
      return { intent: { type: 'interact' }, nextMode: MODE.IDLE };
    case 'i':
      // Inventory — opens the consumable inventory during combat. The shell
      // presents `<item-inventory>` and handles `use-item` events. In the Hub
      // this is a no-op (Finn's shop uses Space-interact).
      return { intent: { type: 'inventory' }, nextMode: MODE.IDLE };
    case 'Escape':
      return { intent: { type: 'cancel' }, nextMode: MODE.IDLE };
    case 'f':
      return { intent: null, nextMode: MODE.FIRE_AIM };
    case 'x':
      // Unified archetype perk. The intent layer dispatches by class —
      // Merc → vault, Razor → slide, Tech → deploy. `x` is unused elsewhere
      // and avoids the WASD collision that would block `d` for deploy.
      return { intent: null, nextMode: MODE.SPECIAL_AIM };
    default:
      return noChange(MODE.IDLE);
  }
}

function dispatchFireAim(key: string) {
  if (key === 'Escape') {
    return { intent: { type: 'cancel' }, nextMode: MODE.IDLE };
  }
  const dir = directionFor(key);
  if (dir) {
    return { intent: { type: 'fire', dx: dir[0], dy: dir[1] }, nextMode: MODE.IDLE };
  }
  return noChange(MODE.FIRE_AIM);
}

function dispatchSpecialAim(key: string) {
  if (key === 'Escape') {
    return { intent: { type: 'cancel' }, nextMode: MODE.IDLE };
  }
  const dir = directionFor(key);
  if (dir) {
    return { intent: { type: 'special', dx: dir[0], dy: dir[1] }, nextMode: MODE.IDLE };
  }
  return noChange(MODE.SPECIAL_AIM);
}

export function dispatch(key: string, mode: string) {
  switch (mode) {
    case MODE.IDLE:
      return dispatchIdle(key);
    case MODE.FIRE_AIM:
      return dispatchFireAim(key);
    case MODE.SPECIAL_AIM:
      return dispatchSpecialAim(key);
    default:
      throw new Error(`keymap: unknown mode "${mode}"`);
  }
}
