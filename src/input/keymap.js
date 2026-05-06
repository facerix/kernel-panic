/**
 * Pure input dispatcher. Maps `(key, mode)` to `{ intent, nextMode }` so the
 * game loop is input-source agnostic — the same intent stream will work for
 * keyboard now and the on-screen touch pad in M8.
 *
 * The dispatcher is a small mode machine. IDLE is the default; pressing an
 * "aim" key (`v` for vault, `f` for fire in M4) enters an aiming mode where
 * the next directional press resolves into a targeted intent.
 *
 * Intents are plain serializable objects so they can be replayed for tests,
 * undo, or networked play later.
 */

export const MODE = Object.freeze({
  IDLE: 'IDLE',
  VAULT_AIM: 'VAULT_AIM',
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
    case 'v':
    case 'V':
      return { intent: null, nextMode: MODE.VAULT_AIM };
    default:
      return noChange(MODE.IDLE);
  }
}

function dispatchVaultAim(key) {
  if (key === 'Escape') {
    return { intent: { type: 'cancel' }, nextMode: MODE.IDLE };
  }
  const dir = directionFor(key);
  if (dir) {
    return { intent: { type: 'vault', dx: dir[0], dy: dir[1] }, nextMode: MODE.IDLE };
  }
  // Stay in aim mode on noise — user pressed something that wasn't a direction
  // or escape. Better than silently dropping out of aim mode.
  return noChange(MODE.VAULT_AIM);
}

export function dispatch(key, mode) {
  switch (mode) {
    case MODE.IDLE:
      return dispatchIdle(key);
    case MODE.VAULT_AIM:
      return dispatchVaultAim(key);
    default:
      throw new Error(`keymap: unknown mode "${mode}"`);
  }
}
