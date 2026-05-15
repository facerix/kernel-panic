/**
 * <item-inventory> — combat inventory overlay for using consumables.
 *
 * Shows the deployed crew member's consumable list. Player navigates with
 * ↑/↓, confirms with Enter, and dismisses with Esc. Emits `use-item` with
 * `{ itemId }` on confirm.
 *
 * If the inventory is empty, shows a "no items" message with dismiss hint.
 */

import { h } from '/src/domUtils.js';

const CSS = `
:host {
  --inv-bg: rgba(7, 18, 16, 0.96);
  --inv-border: var(--accent-color, #00d9a5);
  --inv-text: #c5efdf;
  --inv-dim: #6ae8c8;
  --inv-accent: var(--accent-color, #00d9a5);
  --inv-row-hover: rgba(0, 217, 165, 0.08);
  --inv-row-active: rgba(0, 217, 165, 0.18);
  --inv-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  position: fixed;
  inset: 0;
  z-index: 50;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--inv-text);
}

:host([open]) {
  display: flex;
}

.panel {
  background: var(--inv-bg);
  border: 1px solid var(--inv-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.4rem;
  box-shadow: var(--inv-shadow);
  min-width: min(360px, 88vw);
  max-width: min(480px, 96vw);
}

.title {
  margin: 0 0 0.75rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--inv-accent);
  border-bottom: 1px dashed var(--inv-border);
  padding-bottom: 0.5rem;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.empty {
  text-align: center;
  color: var(--inv-dim);
  font-size: 0.85rem;
  padding: 0.5rem 0;
}

button.row {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--inv-text);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0.5rem 0.6rem;
  text-align: left;
  font: inherit;
  cursor: pointer;
  min-height: 40px;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

button.row:not(:disabled):hover {
  background: var(--inv-row-hover);
}

button.row:focus-visible,
button.row[aria-current='true'] {
  outline: none;
  border-color: var(--inv-accent);
  background: var(--inv-row-active);
}

.cursor {
  color: var(--inv-accent);
  font-weight: 700;
  visibility: hidden;
}

button.row:focus-visible .cursor,
button.row[aria-current='true'] .cursor {
  visibility: visible;
}

.item-name {
  color: var(--inv-accent);
  font-weight: 700;
  letter-spacing: 0.08em;
}

.item-count {
  color: var(--inv-dim);
  font-size: 0.85rem;
}

.hint {
  text-align: center;
  font-size: 0.85rem;
  color: var(--inv-dim);
  letter-spacing: 0.1em;
  margin: 0.9rem 0 0;
}
`;

/** Human-readable labels for item IDs. */
const ITEM_LABELS = {
  stim: 'Stim',
  'smoke-charge': 'Smoke Charge',
};

class ItemInventory extends HTMLElement {
  #items = []; // [{ id, label, count }]
  #ready = false;
  #rowsEl = null;
  #titleEl = null;
  #hintEl = null;
  #buttons = [];
  #selectedIndex = 0;
  #onKeyDown = null;
  #onBackdrop = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#titleEl = h('h2', { className: 'title' });
    this.#rowsEl = h('div', { className: 'rows' });
    this.#hintEl = h('p', { className: 'hint' });
    const panel = h('section', { className: 'panel' }, [this.#titleEl, this.#rowsEl, this.#hintEl]);
    shadow.appendChild(panel);

    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);
    this.#onBackdrop = evt => {
      if (evt.target === this) this.#emit('dismiss');
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    this.#render();
  }

  /**
   * @param {Array<{ id: string }>} consumables — crew inventory consumables
   */
  setItems(consumables) {
    // Aggregate by id so duplicates show as "Stim x2".
    const counts = new Map();
    for (const c of consumables) {
      counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    }
    this.#items = [];
    for (const [id, count] of counts) {
      this.#items.push({ id, label: ITEM_LABELS[id] ?? id, count });
    }
    this.#selectedIndex = 0;
    if (this.#ready) this.#render();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
      const btn = this.#buttons[this.#selectedIndex];
      if (btn) btn.focus();
      else this.focus();
    });
  }

  hide() {
    this.removeAttribute('open');
  }

  get isOpen() {
    return this.hasAttribute('open');
  }

  disconnectedCallback() {
    if (this.#onKeyDown) this.removeEventListener('keydown', this.#onKeyDown);
    if (this.#onBackdrop) this.removeEventListener('click', this.#onBackdrop);
  }

  #render() {
    if (!this.#ready) return;
    this.#titleEl.textContent = '── INVENTORY ──';

    while (this.#rowsEl.firstChild) this.#rowsEl.removeChild(this.#rowsEl.firstChild);
    this.#buttons = [];

    if (this.#items.length === 0) {
      this.#rowsEl.appendChild(h('p', { className: 'empty', textContent: 'No consumables.' }));
      this.#hintEl.textContent = '[ Esc close ]';
      return;
    }

    for (let i = 0; i < this.#items.length; i++) {
      const item = this.#items[i];
      const btn = h('button', {
        type: 'button',
        className: 'row',
        ariaCurrent: i === this.#selectedIndex ? 'true' : 'false',
      });
      btn.dataset.index = String(i);
      btn.addEventListener('click', () => this.#activate(i));
      btn.append(
        h('span', { className: 'cursor', textContent: '>' }),
        h('span', { className: 'item-name', textContent: item.label }),
        h('span', { className: 'item-count', textContent: item.count > 1 ? `x${item.count}` : '' })
      );
      this.#rowsEl.appendChild(btn);
      this.#buttons.push(btn);
    }

    this.#hintEl.textContent = '[ ENTER use  ·  Esc close ]';
  }

  #handleKey(evt) {
    if (!this.isOpen) return;
    evt.stopPropagation();
    if (evt.key === 'Escape') {
      evt.preventDefault();
      this.#emit('dismiss');
      return;
    }
    if (evt.key === 'ArrowDown' || evt.key === 's') {
      evt.preventDefault();
      this.#move(1);
      return;
    }
    if (evt.key === 'ArrowUp' || evt.key === 'w') {
      evt.preventDefault();
      this.#move(-1);
      return;
    }
    if (evt.key === 'Enter' || evt.key === ' ') {
      evt.preventDefault();
      this.#activate(this.#selectedIndex);
    }
  }

  #move(delta) {
    if (this.#items.length === 0) return;
    this.#selectedIndex = (this.#selectedIndex + delta + this.#items.length) % this.#items.length;
    for (let i = 0; i < this.#buttons.length; i++) {
      this.#buttons[i].setAttribute('aria-current', i === this.#selectedIndex ? 'true' : 'false');
    }
    const btn = this.#buttons[this.#selectedIndex];
    if (btn) btn.focus();
  }

  #activate(index) {
    const item = this.#items[index];
    if (!item) return;
    this.#emit('use-item', { itemId: item.id });
  }

  #emit(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

customElements.define('item-inventory', ItemInventory);

export default ItemInventory;
