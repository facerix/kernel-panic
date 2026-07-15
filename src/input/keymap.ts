/**
 * Pure input dispatcher. Maps `(key, mode, aimKind)` to `{ intent, nextMode, aimKind }`
 * so the game loop is input-source agnostic — the same intent stream powers both
 * the keyboard controller and the on-screen touch pad (which synthesizes
 * keystrokes via `src/input/touchpad.js`).
 *
 * The dispatcher is a small mode machine. IDLE is the default; pressing an
 * "aim" key (`f` for fire, `x` for the archetype-specific "special action")
 * enters `MODE.AIM` with an `aimKind` tag that decides which targeted intent
 * the next directional press resolves into. Thrown consumables enter the same
 * aim mode programmatically (`aimKind: 'use-item'`). Wait / pass turn is `.`
 * in IDLE (`end-turn` intent). Interact (Curator, Terminal, …) is Space in IDLE;
 * `i` opens inventory; `j` requests explicit jack-out while linked to
 * Cyberspace. `Q` emits `quit-campaign` in IDLE only — the shell confirms,
 * deletes the save, and starts a new campaign (not routed through
 * `applyIntent`).
 *
 * The archetype-specific perks — Merc's Vault, Razor's Slide, Tech's Deploy
 * Turret — share one `aimKind: 'special'` here at the dispatcher layer (one
 * key, one aim mode). `applyIntent.doSpecial` then routes the intent to the
 * right verb based on the player class. Rationale: one mental model for the
 * player ("press the perk key, pick a direction"), one set of touch-pad
 * buttons, no key-bind collisions with WASD movement.
 *
 * Intents are plain serializable objects so they can be replayed for tests,
 * undo, or networked play later.
 *
 * Letter bindings are **case-sensitive**: only the lower-case keys shown in
 * `DIRECTION_KEYS` and `dispatchIdle` are recognised. `KeyboardEvent.key` is
 * passed through as-is so Shift/Caps Lock upper-case letters do not alias to
 * gameplay verbs (touch-pad synthesis continues to use lower-case keys).
 */

import type { Intent } from './applyIntent.js';

export const MODE = Object.freeze({
  IDLE: 'IDLE',
  /**
   * Unified directional aim mode. Replaces the separate `FIRE_AIM`,
   * `SPECIAL_AIM`, and `ITEM_AIM` modes — `aimKind` selects which targeted
   * intent a direction press emits. Entered from IDLE via `f` / `x`, or
   * programmatically by the shell when an inventory item needs a direction.
   */
  AIM: 'AIM',
  LOOK: 'LOOK',
});

export type Mode = (typeof MODE)[keyof typeof MODE];

/** Which targeted intent `MODE.AIM` resolves into. Values match intent `type`. */
export const AIM_KIND = Object.freeze({
  FIRE: 'fire',
  SPECIAL: 'special',
  USE_ITEM: 'use-item',
});

export type AimKind = (typeof AIM_KIND)[keyof typeof AIM_KIND];

/**
 * How the active archetype's `special` perk resolves its target:
 *   - `'directional'` — needs a direction; the perk key enters `MODE.AIM`
 *     (Merc Vault, Razor Slide, Tech Deploy, CyberAvatar Override).
 *   - `'self'` — self-centered, no direction; the perk key fires immediately
 *     (Decker EMP, Berserk Surge, Chimera Nanite Repair).
 * Supplied per-press by the input owner (which knows the live archetype); the
 * keymap itself stays archetype-agnostic and just honours the flag.
 */
export type PerkAim = 'directional' | 'self';

export type DispatchResult = {
  intent: Intent | null;
  nextMode: Mode;
  aimKind: AimKind | null;
};

const DIRECTION_KEYS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  q: [-1, -1],
  e: [1, -1],
  z: [-1, 1],
  c: [1, 1],
  // WASD as an alternative orthogonal scheme.
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};

const directionFor = (key: string) => DIRECTION_KEYS[key as keyof typeof DIRECTION_KEYS] ?? null;

const idle = (): DispatchResult => ({ intent: null, nextMode: MODE.IDLE, aimKind: null });

const stayAim = (aimKind: AimKind): DispatchResult => ({
  intent: null,
  nextMode: MODE.AIM,
  aimKind,
});

const stayLook = (): DispatchResult => ({ intent: null, nextMode: MODE.LOOK, aimKind: null });

function dispatchIdle(key: string, specialAim: PerkAim): DispatchResult {
  const dir = directionFor(key);
  if (dir) {
    return {
      intent: { type: 'move', dx: dir[0], dy: dir[1] },
      nextMode: MODE.IDLE,
      aimKind: null,
    };
  }
  switch (key) {
    case 'Q':
      return { intent: { type: 'quit-campaign' }, nextMode: MODE.IDLE, aimKind: null };
    case '.':
      // Wait / pass turn — same intent as the touch-pad WAIT button (`.`).
      return { intent: { type: 'end-turn' }, nextMode: MODE.IDLE, aimKind: null };
    case ' ':
      // Interact — context-sensitive verb resolved by the shell (Hub Curator
      // → briefing, future terminals/items in combat). Keymap stays dumb;
      // the shell decides what `interact` means in the current Run.state.
      return { intent: { type: 'interact' }, nextMode: MODE.IDLE, aimKind: null };
    case 'i':
      // Inventory — the shell presents `<combat-inventory>` during combat
      // (handling `use-item` events) and the read-only `<crew-inventory>`
      // stash in the Hub.
      return { intent: { type: 'inventory' }, nextMode: MODE.IDLE, aimKind: null };
    case 'j':
      // Explicit jack-out — shell gates it to active Cyberspace and confirms
      // neural shock before calling Run.requestJackOut().
      return { intent: { type: 'jack-out' }, nextMode: MODE.IDLE, aimKind: null };
    case 'l':
      return stayLook();
    case 'Tab':
      // P3.M4.3: simstim flip — swap active control between the Meatspace
      // operator and the Decker's Cyberspace avatar (or, post-jack-out, the
      // two meat operators). The keymap stays dumb; the shell decides whether
      // a flip is currently possible and flashes a deny otherwise.
      return { intent: { type: 'flip' }, nextMode: MODE.IDLE, aimKind: null };
    case 'Escape':
      return { intent: { type: 'cancel' }, nextMode: MODE.IDLE, aimKind: null };
    case 'f':
      return stayAim(AIM_KIND.FIRE);
    case 'x':
      // Unified archetype perk. The intent layer dispatches by class —
      // Merc → vault, Razor → slide, Tech → deploy, Decker → EMP. `x` is
      // unused elsewhere and avoids the WASD collision that would block `d`
      // for deploy. A `'self'` perk (EMP, and future self-buffs) needs no
      // direction, so it fires immediately instead of entering aim mode.
      if (specialAim === 'self') {
        return { intent: { type: 'special', dx: 0, dy: 0 }, nextMode: MODE.IDLE, aimKind: null };
      }
      return stayAim(AIM_KIND.SPECIAL);
    default:
      return idle();
  }
}

function dispatchAim(key: string, aimKind: AimKind): DispatchResult {
  if (key === 'Escape') {
    return { intent: { type: 'cancel' }, nextMode: MODE.IDLE, aimKind: null };
  }
  const dir = directionFor(key);
  if (dir) {
    if (aimKind === AIM_KIND.USE_ITEM) {
      // The shell pairs this with its stashed `pendingAimItemId`; the keymap
      // stays dumb about which consumable is being thrown.
      return {
        intent: { type: 'use-item', dx: dir[0], dy: dir[1] },
        nextMode: MODE.IDLE,
        aimKind: null,
      };
    }
    return {
      intent: { type: aimKind, dx: dir[0], dy: dir[1] },
      nextMode: MODE.IDLE,
      aimKind: null,
    };
  }
  return stayAim(aimKind);
}

function dispatchLook(key: string): DispatchResult {
  if (key === 'Escape') {
    return { intent: { type: 'cancel' }, nextMode: MODE.IDLE, aimKind: null };
  }
  const dir = directionFor(key);
  if (dir) {
    return {
      intent: { type: 'look-move', dx: dir[0], dy: dir[1] },
      nextMode: MODE.LOOK,
      aimKind: null,
    };
  }
  return stayLook();
}

/** Player-facing status / banner label for an active aim kind. */
export function aimKindLabel(aimKind: AimKind): string {
  switch (aimKind) {
    case AIM_KIND.FIRE:
      return 'FIRE';
    case AIM_KIND.SPECIAL:
      return 'SPECIAL';
    case AIM_KIND.USE_ITEM:
      return 'THROW';
    default:
      throw new Error(`keymap: unknown aimKind "${aimKind as string}"`);
  }
}

export function dispatch(
  key: string,
  mode: Mode,
  aimKind: AimKind | null = null,
  specialAim: PerkAim = 'directional'
): DispatchResult {
  switch (mode) {
    case MODE.IDLE:
      return dispatchIdle(key, specialAim);
    case MODE.AIM:
      if (!aimKind) {
        throw new Error('keymap: MODE.AIM requires an aimKind');
      }
      return dispatchAim(key, aimKind);
    case MODE.LOOK:
      return dispatchLook(key);
    default:
      throw new Error(`keymap: unknown mode "${mode as string}"`);
  }
}
