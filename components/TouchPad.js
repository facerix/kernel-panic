/**
 * <touch-pad> Web Component — on-screen keypad overlay for coarse-pointer
 * devices. Same intent stream as KeyboardController so the game loop is
 * input-source agnostic; both inputs share the keymap state machine via
 * `src/input/touchpad.js`.
 *
 * Usage:
 *   const pad = document.querySelector('touch-pad');
 *   pad.addEventListener('intent', evt => applyIntent(evt.detail));
 *   pad.addEventListener('mode-change', evt => onModeChange(evt.detail.mode));
 *   pad.setMode(MODE.IDLE);   // optional — keep pad mode in sync with reset
 *
 * Visibility:
 *   Hidden by default on fine pointers. Override on desktop for testing
 *   with `?touch=force` in the URL or by setting the `force-show` attribute.
 *
 * Why pointerdown over click:
 *   Skips the synthetic 300ms tap delay on legacy mobile browsers and lets
 *   us suppress the emulated mouse events that would otherwise double-fire
 *   the same button.
 *
 * Delivery: `pointerdown` is registered on the **host** with `{ capture: true }`
 * (not on `shadowRoot`) so mobile WebKit delivers the event reliably. With a
 * host listener, `event.target` can be retargeted, so we resolve `[data-button]`
 * via `composedPath()` and `shadowRoot.contains(...)`.
 */

import { h } from '/src/domUtils.js';
import { MODE } from '/src/input/keymap.js';
import { dispatchTouchAction } from '/src/input/touchpad.js';

const FORCE_SHOW_PARAM = 'touch';
const FORCE_SHOW_VALUE = 'force';

/** Same object for `addEventListener` / `removeEventListener` parity. */
const POINTER_DOWN_OPTS = { capture: true };

const DIRECTION_LABELS = Object.freeze({
  N: '↑',
  S: '↓',
  W: '←',
  E: '→',
  NW: '↖',
  NE: '↗',
  SW: '↙',
  SE: '↘',
});

// Order matters: this is the visual layout of the 3×3 d-pad. Centre slot is
// reserved for the thumb that drives movement (centre is unused — Wait is
// the action column).
const DPAD_SLOTS = Object.freeze(['NW', 'N', 'NE', 'W', null, 'E', 'SW', 'S', 'SE']);

// Action buttons live in a separate column. Order tuned for thumb reach on
// a right-handed grip — most-used first.
const ACTION_BUTTONS = Object.freeze([
  { id: 'fire', label: 'FIRE', shortcut: 'f' },
  { id: 'melee', label: 'MELEE', shortcut: 'm' },
  // One button for the archetype perk — same `special` intent for Vault,
  // Slide, and Deploy. The status banner / on-screen log spells out which
  // verb actually resolves, so the player still sees their kit's flavour.
  { id: 'special', label: 'SPECIAL', shortcut: 'x' },
  { id: 'interact', label: 'INTERACT', shortcut: 'i' },
  { id: 'end-turn', label: 'WAIT', shortcut: '.' },
  { id: 'cancel', label: 'CANCEL', shortcut: 'esc' },
]);

const AIM_MODE_LABEL = Object.freeze({
  [MODE.IDLE]: '',
  [MODE.FIRE_AIM]: 'FIRE — pick a direction',
  [MODE.MELEE_AIM]: 'MELEE — pick a direction',
  [MODE.SPECIAL_AIM]: 'SPECIAL — pick a direction',
});

const AIM_MODE_ACTION = Object.freeze({
  [MODE.FIRE_AIM]: 'fire',
  [MODE.MELEE_AIM]: 'melee',
  [MODE.SPECIAL_AIM]: 'special',
});

const CSS = `
:host {
  --touchpad-bg: rgba(7, 18, 16, 0.78);
  --touchpad-border: #2a4a42;
  --touchpad-text: #c5efdf;
  --touchpad-accent: #00d9a5;
  --touchpad-accent-soft: rgba(0, 217, 165, 0.18);
  --touchpad-btn-bg: #0a1614;
  --touchpad-btn-active: rgba(0, 217, 165, 0.32);

  display: none;
  position: fixed;
  left: 0;
  right: 0;
  bottom: max(8px, env(safe-area-inset-bottom, 0px));
  padding: 8px max(8px, env(safe-area-inset-right, 0px)) 8px max(8px, env(safe-area-inset-left, 0px));
  z-index: 50;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--touchpad-text);
  pointer-events: none;
}

@media (pointer: coarse) {
  :host { display: block; }
}

:host([force-show]) { display: block; }

.shell {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: end;
  gap: 8px;
  pointer-events: none;
}

.aim-banner {
  grid-column: 1 / -1;
  text-align: center;
  font-size: 0.85rem;
  letter-spacing: 0.04em;
  color: var(--touchpad-accent);
  min-height: 1.1em;
  pointer-events: none;
  text-shadow: 0 0 6px rgba(0, 217, 165, 0.45);
}

.dpad {
  display: grid;
  grid-template-columns: repeat(3, minmax(48px, 56px));
  grid-template-rows: repeat(3, minmax(48px, 56px));
  gap: 4px;
  pointer-events: auto;
  background: var(--touchpad-bg);
  border: 1px solid var(--touchpad-border);
  border-radius: 8px;
  padding: 6px;
}

.actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(72px, 1fr));
  gap: 4px;
  pointer-events: auto;
  background: var(--touchpad-bg);
  border: 1px solid var(--touchpad-border);
  border-radius: 8px;
  padding: 6px;
  align-self: end;
}

button {
  appearance: none;
  -webkit-appearance: none;
  background: var(--touchpad-btn-bg);
  border: 1px solid var(--touchpad-border);
  border-radius: 6px;
  color: var(--touchpad-text);
  font-family: inherit;
  font-size: 1rem;
  padding: 0;
  min-height: 44px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

button .label { font-weight: 600; letter-spacing: 0.05em; }
button .shortcut {
  font-size: 0.65rem;
  opacity: 0.55;
  margin-top: 2px;
  letter-spacing: 0.02em;
}

button.dpad-cell { font-size: 1.4rem; }
button.dpad-cell[disabled],
button[data-active="true"] {
  background: var(--touchpad-accent-soft);
  border-color: var(--touchpad-accent);
  color: var(--touchpad-accent);
}

button.dpad-cell.center {
  background: transparent;
  border-color: transparent;
  cursor: default;
  pointer-events: none;
  visibility: hidden;
}

button:active { background: var(--touchpad-btn-active); border-color: var(--touchpad-accent); }

button:focus { outline: none; }
button:focus-visible {
  outline: 2px solid var(--touchpad-accent);
  outline-offset: 2px;
}

@media (max-width: 480px) {
  .actions { grid-template-columns: repeat(2, minmax(64px, 1fr)); }
  button { min-height: 40px; font-size: 0.9rem; }
  button.dpad-cell { font-size: 1.25rem; }
  .dpad {
    grid-template-columns: repeat(3, minmax(44px, 52px));
    grid-template-rows: repeat(3, minmax(44px, 52px));
  }
}
`;

class TouchPad extends HTMLElement {
  #mode = MODE.IDLE;
  #buttonsById = new Map();
  #banner = null;
  #boundOnPointerDown = null;
  #ready = false;
  /**
   * Optional input lockout. The M0 combat-feedback animations set this to
   * the shell's animation-lock checker; `pointerdown` early-returns while
   * it returns true so a held thumb can't queue actions mid-shake. Defaults
   * to a no-op so unit tests and non-animating callers don't have to wire it.
   */
  #isBlocked = () => false;

  static get observedAttributes() {
    return ['force-show'];
  }

  connectedCallback() {
    if (this.#ready) return;
    if (this.#shouldForceShow()) this.setAttribute('force-show', '');

    const shadow = this.attachShadow({ mode: 'open' });
    const styles = h('style');
    styles.textContent = CSS;
    shadow.appendChild(styles);

    this.#banner = h('div', { className: 'aim-banner', role: 'status' });
    const dpad = this.#buildDpad();
    const actions = this.#buildActions();
    shadow.appendChild(h('div', { className: 'shell' }, [this.#banner, dpad, h('div'), actions]));

    this.#boundOnPointerDown = this.#onPointerDown.bind(this);
    this.addEventListener('pointerdown', this.#boundOnPointerDown, POINTER_DOWN_OPTS);
    this.#ready = true;
    this.#renderMode();
  }

  disconnectedCallback() {
    if (this.#boundOnPointerDown) {
      this.removeEventListener('pointerdown', this.#boundOnPointerDown, POINTER_DOWN_OPTS);
      this.#boundOnPointerDown = null;
    }
  }

  /**
   * Sync the touch pad's mode externally — useful when the harness rebuilds
   * the scenario (reset) and wants aim state cleared.
   */
  setMode(mode) {
    if (!Object.values(MODE).includes(mode)) {
      throw new Error(`<touch-pad>: unknown mode "${mode}"`);
    }
    if (this.#mode === mode) return;
    const previousMode = this.#mode;
    this.#mode = mode;
    this.#renderMode();
    this.#emit('mode-change', { mode, previousMode });
  }

  get mode() {
    return this.#mode;
  }

  /**
   * Install (or replace) the input-lockout predicate. Pass `null` to clear.
   * See `#isBlocked` for the motivation. Validated so a typo'd assignment
   * crashes loudly instead of silently bypassing the lock.
   */
  setBlocked(predicate) {
    if (predicate === null || predicate === undefined) {
      this.#isBlocked = () => false;
      return;
    }
    if (typeof predicate !== 'function') {
      throw new TypeError('<touch-pad>.setBlocked: expected a function or null');
    }
    this.#isBlocked = predicate;
  }

  #shouldForceShow() {
    if (this.hasAttribute('force-show')) return true;
    try {
      const params = new URLSearchParams(globalThis.location?.search || '');
      return params.get(FORCE_SHOW_PARAM) === FORCE_SHOW_VALUE;
    } catch {
      return false;
    }
  }

  #buildDpad() {
    const cells = DPAD_SLOTS.map(slot => {
      if (slot === null) {
        return h('button', {
          className: 'dpad-cell center',
          type: 'button',
          tabIndex: -1,
          ariaHidden: 'true',
        });
      }
      const btn = h('button', {
        className: 'dpad-cell',
        type: 'button',
        ariaLabel: `Direction ${slot}`,
      });
      btn.dataset.button = slot;
      btn.textContent = DIRECTION_LABELS[slot] ?? slot;
      this.#buttonsById.set(slot, btn);
      return btn;
    });
    return h('div', { className: 'dpad', role: 'group', ariaLabel: 'Movement directions' }, cells);
  }

  #buildActions() {
    const buttons = ACTION_BUTTONS.map(({ id, label, shortcut }) => {
      const btn = h(
        'button',
        {
          className: `action-btn action-${id}`,
          type: 'button',
          ariaLabel: label,
        },
        [
          h('span', { className: 'label', textContent: label }),
          h('span', { className: 'shortcut', textContent: shortcut }),
        ]
      );
      btn.dataset.button = id;
      this.#buttonsById.set(id, btn);
      return btn;
    });
    return h('div', { className: 'actions', role: 'group', ariaLabel: 'Actions' }, buttons);
  }

  #findDataButton(evt) {
    const root = this.shadowRoot;
    if (!root) return null;
    for (const node of evt.composedPath()) {
      if (node === root) break;
      if (node instanceof Element && root.contains(node) && node.dataset?.button) return node;
    }
    return null;
  }

  #onPointerDown(evt) {
    const btn = this.#findDataButton(evt);
    if (!btn) return;
    const buttonId = btn.dataset.button;
    if (!buttonId) return;
    // Block emulated mouse events that follow a touch — otherwise we'd
    // double-fire the same button.
    evt.preventDefault();
    // Input lockout — checked after preventDefault so a tap during a
    // damage shake still suppresses the emulated mouse fallback, but no
    // intent gets dispatched. Matches the KeyboardController contract.
    if (this.#isBlocked()) return;

    const previousMode = this.#mode;
    const { intent, nextMode } = dispatchTouchAction(buttonId, this.#mode);

    if (nextMode !== previousMode) {
      this.#mode = nextMode;
      this.#renderMode();
      this.#emit('mode-change', { mode: nextMode, previousMode });
    }
    if (intent) this.#emit('intent', intent);
  }

  #renderMode() {
    if (!this.#ready) return;
    if (this.#banner) {
      this.#banner.textContent = AIM_MODE_LABEL[this.#mode] ?? '';
    }
    const activeAction = AIM_MODE_ACTION[this.#mode] ?? null;
    for (const [id, btn] of this.#buttonsById) {
      if (!btn) continue;
      const isActive = id === activeAction;
      if (isActive) btn.dataset.active = 'true';
      else delete btn.dataset.active;
    }
  }

  #emit(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true }));
  }
}

customElements.define('touch-pad', TouchPad);

export default TouchPad;
