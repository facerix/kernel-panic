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
 * D-pad hold-repeat:
 *   Direction buttons fire once on `pointerdown`, then repeat every
 *   `DPAD_REPEAT_INTERVAL_MS` until `pointerup` / `pointercancel`. Action
 *   buttons stay single-tap. `setPointerCapture` keeps release events even
 *   if the thumb slides off the cell.
 *
 * Delivery: `pointerdown` is registered on the **host** with `{ capture: true }`
 * (not on `shadowRoot`) so mobile WebKit delivers the event reliably. With a
 * host listener, `event.target` can be retargeted, so we resolve `[data-button]`
 * via `composedPath()` and `shadowRoot.contains(...)`.
 */

import { h } from '/src/domUtils.js';
import { AIM_KIND, MODE, aimKindLabel } from '/src/input/keymap.js';
import { dispatchTouchAction, TOUCHPAD_DIRECTIONS } from '/src/input/touchpad.js';
import type { AimKind, Mode } from '/src/input/keymap.js';

const FORCE_SHOW_PARAM = 'touch';
const FORCE_SHOW_VALUE = 'force';

/** Milliseconds between repeated d-pad moves while a direction is held. */
const DPAD_REPEAT_INTERVAL_MS = 200;

type IsBlockedPredicate = () => boolean;

/** Same object for `addEventListener` / `removeEventListener` parity. */
const POINTER_DOWN_OPTS = { capture: true };
const POINTER_RELEASE_OPTS = { capture: true };

const DPAD_DIRECTION_IDS = new Set<string>(TOUCHPAD_DIRECTIONS);

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
  // One button for the archetype perk — same `special` intent for Vault,
  // Slide, and Deploy. The status banner / on-screen log spells out which
  // verb actually resolves, so the player still sees their kit's flavour.
  { id: 'special', label: 'SPECIAL', shortcut: 'x' },
  { id: 'interact', label: 'INTERACT', shortcut: '␣' },
  { id: 'jack-out', label: 'JACK OUT', shortcut: 'j' },
  { id: 'look', label: 'LOOK', shortcut: 'l' },
  { id: 'inventory', label: 'ITEMS', shortcut: 'i' },
  { id: 'end-turn', label: 'WAIT', shortcut: '.' },
  { id: 'cancel', label: 'CANCEL', shortcut: 'esc' },
]);

const META_BUTTONS = Object.freeze([{ id: 'quit-campaign', label: 'QUIT', shortcut: 'Q' }]);

const AIM_KIND_LABEL = Object.freeze({
  [AIM_KIND.FIRE]: 'FIRE — pick a direction',
  [AIM_KIND.SPECIAL]: 'SPECIAL — pick a direction',
  [AIM_KIND.USE_ITEM]: 'THROW — pick a direction',
});

const AIM_KIND_ACTION = Object.freeze({
  [AIM_KIND.FIRE]: 'fire',
  [AIM_KIND.SPECIAL]: 'special',
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

  /* Cyberspace palette (mirrors CYBER_ACCENT in src/render/pip.ts) — the
     simstim FLIP fab borrows it so the gesture reads as "the cyber layer". */
  --touchpad-cyber: #ff8ad8;
  --touchpad-cyber-glow: #ff5cc6;
  --touchpad-cyber-soft: rgba(255, 92, 198, 0.18);
  --touchpad-cyber-bg: rgba(28, 8, 22, 0.82);

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

.meta-row {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  pointer-events: auto;
}

.meta-btn {
  min-width: 72px;
  border-color: #5a3030;
  color: #f0c0c0;
}

.meta-btn .shortcut {
  opacity: 0.75;
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

/* Simstim FLIP — pulled out of the action block and pinned to the right edge
   near the vertical centre, so the layer-swap gesture lives apart from the
   per-turn verbs. Hidden until the shell reports a flip target exists
   (dual-deploy / post-jack-out), via the flip-available attribute. */
.flip-fab {
  position: fixed;
  right: max(8px, env(safe-area-inset-right, 0px));
  top: 50%;
  transform: translateY(-50%);
  display: none;
  flex-direction: column;
  gap: 1px;
  min-width: 58px;
  min-height: 58px;
  padding: 8px 6px;
  pointer-events: auto;
  background: var(--touchpad-cyber-bg);
  border: 1px solid var(--touchpad-cyber);
  border-radius: 10px;
  color: var(--touchpad-cyber);
  text-shadow: 0 0 6px var(--touchpad-cyber-glow);
  box-shadow: 0 0 12px var(--touchpad-cyber-soft);
}

:host([flip-available]) .flip-fab { display: flex; }

.flip-fab .label { font-weight: 700; letter-spacing: 0.08em; }
.flip-fab .shortcut { color: var(--touchpad-cyber); opacity: 0.7; }
.flip-fab:active {
  background: var(--touchpad-cyber-soft);
  border-color: var(--touchpad-cyber-glow);
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
  #mode: Mode = MODE.IDLE;
  #aimKind: AimKind | null = null;
  #buttonsById = new Map();
  #banner: HTMLElement | null = null;
  #boundOnPointerDown: ((evt: PointerEvent) => void) | null = null;
  #boundOnPointerRelease: ((evt: PointerEvent) => void) | null = null;
  #dpadRepeatTimer: ReturnType<typeof setInterval> | null = null;
  #dpadRepeatPointerId: number | null = null;
  #ready = false;
  /**
   * Optional input lockout. The prototype's combat-feedback animations set this to
   * the shell's animation-lock checker; `pointerdown` early-returns while
   * it returns true so a held thumb can't queue actions mid-shake. Defaults
   * to a no-op so unit tests and non-animating callers don't have to wire it.
   */
  #isBlocked: IsBlockedPredicate = () => false;

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
    const metaRow = this.#buildMetaActions();
    const actions = this.#buildActions();
    shadow.appendChild(
      h('div', { className: 'shell' }, [this.#banner, metaRow, dpad, h('div'), actions])
    );
    // The simstim FLIP fab lives outside `.shell` — it's pinned to the
    // viewport's right edge, not laid out with the d-pad / action columns.
    shadow.appendChild(this.#buildFlipFab());

    this.#boundOnPointerDown = this.#onPointerDown.bind(this);
    this.#boundOnPointerRelease = this.#onPointerRelease.bind(this);
    this.addEventListener('pointerdown', this.#boundOnPointerDown, POINTER_DOWN_OPTS);
    this.addEventListener('pointerup', this.#boundOnPointerRelease, POINTER_RELEASE_OPTS);
    this.addEventListener('pointercancel', this.#boundOnPointerRelease, POINTER_RELEASE_OPTS);
    this.#ready = true;
    this.#renderMode();
  }

  disconnectedCallback() {
    this.#stopDpadRepeat();
    if (this.#boundOnPointerDown) {
      this.removeEventListener('pointerdown', this.#boundOnPointerDown, POINTER_DOWN_OPTS);
      this.#boundOnPointerDown = null;
    }
    if (this.#boundOnPointerRelease) {
      this.removeEventListener('pointerup', this.#boundOnPointerRelease, POINTER_RELEASE_OPTS);
      this.removeEventListener('pointercancel', this.#boundOnPointerRelease, POINTER_RELEASE_OPTS);
      this.#boundOnPointerRelease = null;
    }
  }

  /**
   * Sync the touch pad's mode externally — useful when the harness rebuilds
   * the scenario (reset) and wants aim state cleared.
   */
  setMode(mode: Mode, aimKind: AimKind | null = null) {
    if (!Object.values(MODE).includes(mode)) {
      throw new Error(`<touch-pad>: unknown mode "${mode}"`);
    }
    const nextAimKind = mode === MODE.AIM ? aimKind : null;
    if (mode === MODE.AIM && !nextAimKind) {
      throw new Error('<touch-pad>: MODE.AIM requires an aimKind');
    }
    if (this.#mode === mode && this.#aimKind === nextAimKind) return;
    const previousMode = this.#mode;
    const previousAimKind = this.#aimKind;
    this.#mode = mode;
    this.#aimKind = nextAimKind;
    this.#renderMode();
    this.#emit('mode-change', { mode, aimKind: nextAimKind, previousMode, previousAimKind });
  }

  get mode() {
    return this.#mode;
  }

  get aimKind() {
    return this.#aimKind;
  }

  /**
   * Install (or replace) the input-lockout predicate. Pass `null` to clear.
   * See `#isBlocked` for the motivation. Validated so a typo'd assignment
   * crashes loudly instead of silently bypassing the lock.
   */
  setBlocked(predicate: IsBlockedPredicate | null): void {
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
      btn.textContent = DIRECTION_LABELS[slot as keyof typeof DIRECTION_LABELS] ?? slot;
      this.#buttonsById.set(slot, btn);
      return btn;
    });
    return h('div', { className: 'dpad', role: 'group', ariaLabel: 'Movement directions' }, cells);
  }

  #buildMetaActions() {
    const buttons = META_BUTTONS.map(({ id, label, shortcut }) => {
      const btn = h(
        'button',
        {
          className: 'meta-btn',
          type: 'button',
          ariaLabel: `${label} campaign`,
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
    return h('div', { className: 'meta-row', role: 'group', ariaLabel: 'Campaign' }, buttons);
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

  #buildFlipFab() {
    const btn = h(
      'button',
      {
        className: 'flip-fab',
        type: 'button',
        ariaLabel: 'Simstim flip — switch operator',
      },
      [
        h('span', { className: 'label', textContent: 'FLIP' }),
        h('span', { className: 'shortcut', textContent: '⇥' }),
      ]
    );
    btn.dataset.button = 'flip';
    this.#buttonsById.set('flip', btn);
    return btn;
  }

  /**
   * P3.M4.3: show or hide the simstim FLIP fab. The shell calls this from its
   * paint loop with `run.canFlip()`, so the fab only appears when a second
   * operator can actually take control (dual-deploy, or the two meat operators
   * post-jack-out). Mirrors the keyboard `Tab` gate — never a dead button.
   */
  setFlipAvailable(available: boolean): void {
    if (available) this.setAttribute('flip-available', '');
    else this.removeAttribute('flip-available');
  }

  #findDataButton(evt: PointerEvent) {
    const root = this.shadowRoot;
    if (!root) return null;
    for (const node of evt.composedPath()) {
      if (node === root) break;
      if (node instanceof HTMLElement && root.contains(node) && node.dataset?.button) return node;
    }
    return null;
  }

  #onPointerDown(evt: PointerEvent) {
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

    this.#dispatchButtonPress(buttonId);

    if (DPAD_DIRECTION_IDS.has(buttonId)) {
      this.#startDpadRepeat(buttonId, evt.pointerId, btn);
    } else {
      this.#stopDpadRepeat();
    }
  }

  #onPointerRelease(evt: PointerEvent) {
    if (this.#dpadRepeatPointerId === null) return;
    if (evt.pointerId !== this.#dpadRepeatPointerId) return;
    this.#stopDpadRepeat();
  }

  #startDpadRepeat(buttonId: string, pointerId: number, captureTarget: HTMLElement) {
    this.#stopDpadRepeat();
    this.#dpadRepeatPointerId = pointerId;
    try {
      captureTarget.setPointerCapture(pointerId);
    } catch {
      // Ignore — repeat still stops on pointerup at the host.
    }
    this.#dpadRepeatTimer = setInterval(() => {
      if (this.#isBlocked()) return;
      this.#dispatchButtonPress(buttonId);
    }, DPAD_REPEAT_INTERVAL_MS);
  }

  #stopDpadRepeat() {
    if (this.#dpadRepeatTimer !== null) {
      clearInterval(this.#dpadRepeatTimer);
      this.#dpadRepeatTimer = null;
    }
    this.#dpadRepeatPointerId = null;
  }

  #dispatchButtonPress(buttonId: string) {
    const previousMode = this.#mode;
    const previousAimKind = this.#aimKind;
    const { intent, nextMode, aimKind } = dispatchTouchAction(buttonId, this.#mode, this.#aimKind);

    if (nextMode !== previousMode || aimKind !== previousAimKind) {
      this.#mode = nextMode;
      this.#aimKind = aimKind;
      this.#renderMode();
      this.#emit('mode-change', { mode: nextMode, aimKind, previousMode, previousAimKind });
    }
    if (intent) this.#emit('intent', intent);
  }

  #modePresentation(): { banner: string; activeAction: string | null } {
    if (this.#mode === MODE.AIM && this.#aimKind) {
      return {
        banner:
          AIM_KIND_LABEL[this.#aimKind] ?? `${aimKindLabel(this.#aimKind)} — pick a direction`,
        activeAction: AIM_KIND_ACTION[this.#aimKind as keyof typeof AIM_KIND_ACTION] ?? null,
      };
    }
    if (this.#mode === MODE.LOOK) {
      return {
        banner: 'LOOK — move cursor (Esc to cancel)',
        activeAction: 'look',
      };
    }
    return { banner: '', activeAction: null };
  }

  #renderMode() {
    if (!this.#ready) return;
    const { banner, activeAction } = this.#modePresentation();
    if (this.#banner) this.#banner.textContent = banner;
    for (const [id, btn] of this.#buttonsById) {
      if (!btn) continue;
      const isActive = id === activeAction;
      if (isActive) btn.dataset.active = 'true';
      else delete btn.dataset.active;
    }
  }

  #emit(eventName: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true }));
  }
}

customElements.define('touch-pad', TouchPad);

export default TouchPad;
