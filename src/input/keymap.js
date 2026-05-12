/**
 * Pure input dispatcher. Maps `(key, mode)` to `{ intent, nextMode }` so the
 * game loop is input-source agnostic — the same intent stream powers both
 * the keyboard controller and the M7 on-screen touch pad (which synthesizes
 * keystrokes via `src/input/touchpad.js`).
 *
 * The dispatcher is a small mode machine. IDLE is the default; pressing an
 * "aim" key (`f` for fire, `m` for melee, `x` for the archetype-specific
 * "special action") enters an aiming mode where the next directional press
 * resolves into a targeted intent.
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
 */

export const MODE = Object.freeze({
  IDLE: 'IDLE',
  FIRE_AIM: 'FIRE_AIM',
  MELEE_AIM: 'MELEE_AIM',
  /**
   * Unified archetype-perk aim mode. Replaces the M1 `VAULT_AIM` and
   * `SLIDE_AIM` modes; the active player's class decides what `special`
   * resolves to at intent-apply time.
   */
  SPECIAL_AIM: 'SPECIAL_AIM',
});

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

const directionFor = key => DIRECTION_KEYS[key] ?? DIRECTION_KEYS[key?.toLowerCase?.()] ?? null;

const noChange = mode => ({ intent: null, nextMode: mode });

function dispatchIdle(key) {
  const dir = directionFor(key);
  if (dir) {
    return { intent: { type: 'move', dx: dir[0], dy: dir[1] }, nextMode: MODE.IDLE };
  }
  switch (key) {
    case ' ':
      return { intent: { type: 'end-turn' }, nextMode: MODE.IDLE };
    case '.':
      return { intent: { type: 'wait' }, nextMode: MODE.IDLE };
    case 'Escape':
      return { intent: { type: 'cancel' }, nextMode: MODE.IDLE };
    case 'f':
    case 'F':
      return { intent: null, nextMode: MODE.FIRE_AIM };
    case 'm':
    case 'M':
      return { intent: null, nextMode: MODE.MELEE_AIM };
    case 'x':
    case 'X':
      // Unified archetype perk. The intent layer dispatches by class —
      // Merc → vault, Razor → slide, Tech → deploy. `x` is unused elsewhere
      // and avoids the WASD collision that would block `d` for deploy.
      return { intent: null, nextMode: MODE.SPECIAL_AIM };
    case 'i':
    case 'I':
      // Interact — context-sensitive verb resolved by the shell (Hub Curator
      // → briefing, future terminals/items in combat). Keymap stays dumb;
      // the shell decides what `interact` means in the current Run.state.
      return { intent: { type: 'interact' }, nextMode: MODE.IDLE };
    default:
      return noChange(MODE.IDLE);
  }
}

function dispatchFireAim(key) {
  if (key === 'Escape') {
    return { intent: { type: 'cancel' }, nextMode: MODE.IDLE };
  }
  const dir = directionFor(key);
  if (dir) {
    return { intent: { type: 'fire', dx: dir[0], dy: dir[1] }, nextMode: MODE.IDLE };
  }
  return noChange(MODE.FIRE_AIM);
}

function dispatchMeleeAim(key) {
  if (key === 'Escape') {
    return { intent: { type: 'cancel' }, nextMode: MODE.IDLE };
  }
  const dir = directionFor(key);
  if (dir) {
    return { intent: { type: 'melee', dx: dir[0], dy: dir[1] }, nextMode: MODE.IDLE };
  }
  return noChange(MODE.MELEE_AIM);
}

function dispatchSpecialAim(key) {
  if (key === 'Escape') {
    return { intent: { type: 'cancel' }, nextMode: MODE.IDLE };
  }
  const dir = directionFor(key);
  if (dir) {
    return { intent: { type: 'special', dx: dir[0], dy: dir[1] }, nextMode: MODE.IDLE };
  }
  return noChange(MODE.SPECIAL_AIM);
}

export function dispatch(key, mode) {
  switch (mode) {
    case MODE.IDLE:
      return dispatchIdle(key);
    case MODE.FIRE_AIM:
      return dispatchFireAim(key);
    case MODE.MELEE_AIM:
      return dispatchMeleeAim(key);
    case MODE.SPECIAL_AIM:
      return dispatchSpecialAim(key);
    default:
      throw new Error(`keymap: unknown mode "${mode}"`);
  }
}
