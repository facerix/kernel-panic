import { dispatch, MODE } from './keymap.js';
import type { Intent } from './applyIntent.js';
import type { AimKind, Mode, PerkAim } from './keymap.js';

/**
 * DOM-side input wrapper. Listens for keydown on a target element (defaults
 * to `document`), runs the pure `dispatch` machine, and notifies a callback
 * with each intent it produces. The callback is also told about mode changes
 * so the UI can show "VAULT — pick a direction" prompts.
 *
 * Modifier-key combos (ctrl/meta/alt) are ignored so we don't fight browser
 * shortcuts.
 *
 * Optional `isBlocked()` predicate gates *all* keydown handling. The
 * combat-feedback animations use this to lock input for ~300ms while a
 * shake/reddening plays — the controller early-returns before consulting
 * the keymap so mode transitions can't queue up during the lockout either.
 *
 * `evt.key` is forwarded case-sensitively into `dispatch` — only lower-case
 * letter bindings in the keymap produce gameplay intents.
 */
type KeyboardControllerInit = {
  target?: Document;
  onIntent: (intent: Intent) => void;
  onModeChange: (mode: Mode) => void;
  isBlocked?: () => boolean;
  /**
   * Resolve the *current* archetype's perk-aim so the `x` key fires a
   * self-centered perk (EMP, self-buffs) immediately instead of entering aim
   * mode. Called per keypress — the active archetype can change (simstim flip,
   * partner swap). Defaults to `'directional'` (the historical behavior).
   */
  getSpecialAim?: () => PerkAim;
};
export class KeyboardController {
  target: Document;
  onIntent: (intent: Intent) => void;
  onModeChange: (mode: Mode) => void;
  isBlocked: () => boolean;
  getSpecialAim: () => PerkAim;
  mode: Mode;
  /** Active when `mode === MODE.AIM`; selects fire / special / use-item. */
  aimKind: AimKind | null;
  attached: boolean;

  constructor({
    target = document,
    onIntent,
    onModeChange,
    isBlocked,
    getSpecialAim,
  }: KeyboardControllerInit) {
    if (typeof onIntent !== 'function') {
      throw new TypeError('KeyboardController requires an onIntent callback');
    }
    if (isBlocked !== undefined && typeof isBlocked !== 'function') {
      throw new TypeError('KeyboardController: isBlocked must be a function when supplied');
    }
    if (getSpecialAim !== undefined && typeof getSpecialAim !== 'function') {
      throw new TypeError('KeyboardController: getSpecialAim must be a function when supplied');
    }
    this.target = target;
    this.onIntent = onIntent;
    this.onModeChange = onModeChange ?? (() => {});
    this.isBlocked = isBlocked ?? (() => false);
    this.getSpecialAim = getSpecialAim ?? (() => 'directional');
    this.mode = MODE.IDLE;
    this.aimKind = null;
    this.attached = false;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  attach() {
    if (this.attached) return;
    this.target.addEventListener('keydown', this.handleKeyDown);
    this.attached = true;
  }

  detach() {
    if (!this.attached) return;
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.attached = false;
  }

  handleKeyDown(evt: KeyboardEvent) {
    if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
    // Input lockout — see class docstring. Checked *before* the keymap so
    // a key pressed mid-animation can't sneak a mode transition through.
    if (this.isBlocked()) return;
    const previousMode = this.mode;
    const previousAimKind = this.aimKind;
    const { intent, nextMode, aimKind } = dispatch(
      evt.key,
      this.mode,
      this.aimKind,
      this.getSpecialAim()
    );
    if (intent || nextMode !== previousMode || aimKind !== previousAimKind) evt.preventDefault();
    if (nextMode !== previousMode || aimKind !== previousAimKind) {
      this.mode = nextMode;
      this.aimKind = aimKind;
      this.onModeChange(nextMode);
    }
    if (intent) this.onIntent(intent);
  }
}
