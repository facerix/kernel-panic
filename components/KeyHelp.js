/**
 * <key-help> — overlay listing the active keybindings.
 *
 *   ┌──────────── KEYS ────────────┐
 *   │  MOVE                        │
 *   │   W A S D / arrows  step     │
 *   │  ACTION                      │
 *   │   f    fire                  │
 *   │   v    vault                 │
 *   │   t    slide                 │
 *   │   i    interact              │
 *   │  SYSTEM                      │
 *   │   ?    this help             │
 *   │   Esc  cancel                │
 *   └──────────────────────────────┘
 *
 * Reads `describeKeymap(scope)` from `/src/input/keyHelp.js` so the rendered
 * list is the same source of truth a unit test ties to the keymap itself —
 * if a future milestone adds a binding to `keymap.js` without an entry in
 * `HELP_ROWS`, the drift test fails before this panel can lie to the player.
 *
 * Usage:
 *   const help = document.querySelector('key-help');
 *   help.setScope('hub');     // or 'combat'
 *   help.show();              // help.hide() / help.toggle() also exist
 *
 * The host shell owns `?` and Esc routing (so the same `?` can also dismiss
 * other panels) — see /index.js.
 */

import { h } from '/src/domUtils.js';
import { describeKeymap } from '/src/input/keyHelp.js';

const KEY_LABEL = Object.freeze({
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
});

const GROUPS = Object.freeze([
  { id: 'move', title: 'MOVE' },
  { id: 'action', title: 'ACTION' },
  { id: 'system', title: 'SYSTEM' },
]);

const CSS = `
:host {
  --help-bg: rgba(7, 18, 16, 0.96);
  --help-border: var(--accent-color, #00d9a5);
  --help-text: #c5efdf;
  --help-dim: #6ae8c8;
  --help-accent: var(--accent-color, #00d9a5);
  --help-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  position: fixed;
  inset: 0;
  z-index: 45;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--help-text);
}

:host([open]) {
  display: flex;
}

.panel {
  background: var(--help-bg);
  border: 1px solid var(--help-border);
  border-radius: 6px;
  padding: 1rem 1.4rem 1.25rem;
  box-shadow: var(--help-shadow);
  min-width: min(380px, 92vw);
  max-width: min(520px, 96vw);
}

.title {
  margin: 0 0 0.5rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--help-accent);
  border-bottom: 1px dashed var(--help-border);
  padding-bottom: 0.4rem;
}

section.group {
  margin: 0.6rem 0 0;
}

section.group h3 {
  margin: 0 0 0.25rem;
  font-size: 0.8rem;
  letter-spacing: 0.16em;
  color: var(--help-dim);
}

dl.rows {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1rem;
  row-gap: 0.18rem;
  margin: 0;
  font-size: 0.9rem;
}

dl.rows dt {
  color: var(--help-accent);
  white-space: nowrap;
}

dl.rows dd {
  margin: 0;
  color: var(--help-text);
}

.hint {
  text-align: center;
  font-size: 0.8rem;
  color: var(--help-dim);
  letter-spacing: 0.1em;
  margin-top: 0.8rem;
}
`;

function labelForKey(key) {
  return KEY_LABEL[key] ?? key;
}

function joinKeys(keys) {
  return keys.map(labelForKey).join(' ');
}

class KeyHelp extends HTMLElement {
  #scope = 'combat';
  #ready = false;
  #body = null;
  #onBackdrop = null;

  connectedCallback() {
    if (this.#ready) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#body = h('div');
    const panel = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: '── KEYS ──' }),
      this.#body,
      h('p', { className: 'hint', textContent: '[ ? or Esc to close ]' }),
    ]);
    shadow.appendChild(panel);

    // Backdrop click closes — matches <character-select>'s affordance.
    this.#onBackdrop = evt => {
      if (evt.target === this) this.#emit('dismiss');
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    this.#render();
  }

  /**
   * Filter the rows shown. Re-renders immediately if connected; throws on an
   * unknown scope to match the crash-over-silent-fallback rule (a typo
   * elsewhere would otherwise render an empty help panel).
   */
  setScope(scope) {
    this.#scope = scope;
    if (this.#ready) this.#render();
  }

  show() {
    this.setAttribute('open', '');
  }

  hide() {
    this.removeAttribute('open');
  }

  toggle() {
    if (this.isOpen) this.hide();
    else this.show();
    return this.isOpen;
  }

  get isOpen() {
    return this.hasAttribute('open');
  }

  disconnectedCallback() {
    if (this.#onBackdrop) this.removeEventListener('click', this.#onBackdrop);
  }

  // ---- internal ---------------------------------------------------------

  #render() {
    if (!this.#body) return;
    while (this.#body.firstChild) this.#body.removeChild(this.#body.firstChild);
    // `describeKeymap` throws on a bad scope — propagate, don't paper over.
    const rows = describeKeymap(this.#scope);
    for (const group of GROUPS) {
      const groupRows = rows.filter(r => r.group === group.id);
      if (groupRows.length === 0) continue;
      const dl = h('dl', { className: 'rows' });
      for (const r of groupRows) {
        dl.appendChild(h('dt', { textContent: joinKeys(r.keys) }));
        dl.appendChild(h('dd', { textContent: r.label }));
      }
      this.#body.appendChild(
        h('section', { className: 'group' }, [h('h3', { textContent: group.title }), dl])
      );
    }
  }

  #emit(eventName, detail) {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail: detail ?? {},
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define('key-help', KeyHelp);

export default KeyHelp;
