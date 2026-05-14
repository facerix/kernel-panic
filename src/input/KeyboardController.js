import { dispatch, MODE } from './keymap.js';

/**
 * DOM-side input wrapper. Listens for keydown on a target element (defaults
 * to `document`), runs the pure `dispatch` machine, and notifies a callback
 * with each intent it produces. The callback is also told about mode changes
 * so the UI can show "VAULT — pick a direction" prompts.
 *
 * Modifier-key combos (ctrl/meta/alt) are ignored so we don't fight browser
 * shortcuts.
 *
 * Optional `isBlocked()` predicate gates *all* keydown handling. The M0
 * combat-feedback animations use this to lock input for ~300ms while a
 * shake/reddening plays — the controller early-returns before consulting
 * the keymap so mode transitions can't queue up during the lockout either.
 *
 * `evt.key` is forwarded case-sensitively into `dispatch` — only lower-case
 * letter bindings in the keymap produce gameplay intents.
 */
export class KeyboardController {
  constructor({ target = document, onIntent, onModeChange, isBlocked } = {}) {
    if (typeof onIntent !== 'function') {
      throw new TypeError('KeyboardController requires an onIntent callback');
    }
    if (isBlocked !== undefined && typeof isBlocked !== 'function') {
      throw new TypeError('KeyboardController: isBlocked must be a function when supplied');
    }
    this.target = target;
    this.onIntent = onIntent;
    this.onModeChange = onModeChange ?? (() => {});
    this.isBlocked = isBlocked ?? (() => false);
    this.mode = MODE.IDLE;
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

  handleKeyDown(evt) {
    if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
    // Input lockout — see class docstring. Checked *before* the keymap so
    // a key pressed mid-animation can't sneak a mode transition through.
    if (this.isBlocked()) return;
    const previousMode = this.mode;
    const { intent, nextMode } = dispatch(evt.key, this.mode);
    if (intent || nextMode !== previousMode) evt.preventDefault();
    if (nextMode !== previousMode) {
      this.mode = nextMode;
      this.onModeChange(nextMode, previousMode);
    }
    if (intent) this.onIntent(intent);
  }
}
