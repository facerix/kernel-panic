/**
 * <item-inventory> — inventory overlay for salvage + consumables.
 *
 * Shows two sections:
 *
 *   1. **SALVAGE** — typed-salvage wallet rendered with full bucket names
 *      (Scrap / Chips / Bio / Data). Per design feedback, the compact
 *      `S:N C:N B:N D:N` status-bar tag was too dense — players want to read
 *      the bucket they own, not decode an initial. Also extended this
 *      overlay to be the Hub's wallet surface so the player can audit
 *      typed totals without opening the shop.
 *   2. **CONSUMABLES** — the deployed crew member's item list (Stim, Smoke
 *      Charge, …). Only populated mid-combat. Hub state shows an empty
 *      section so the chrome stays consistent.
 *
 * Navigation: ↑/↓ moves the cursor across consumable rows (salvage is
 * informational only). Enter activates a consumable, Esc dismisses.
 * Emits `use-item` with `{ itemId }` on confirm.
 *
 * If both sections are empty, shows a "nothing carried" message with a
 * dismiss hint.
 */

import { h } from '/src/domUtils.js';
import {
  SALVAGE_TYPES,
  emptySalvage,
  totalSalvage,
  type SalvageType,
  type TypedSalvage,
} from '/src/game/salvage.js';
import { KEYCARD_GLYPH } from '/src/game/constants.js';
import type { Item } from '/src/game/items.js';
import type { KeyItemView } from '/src/shell/domTypes.js';

type ItemInventoryItem = Omit<Item, 'scope' | 'cost' | 'description' | 'needsTarget'> & {
  count: number;
};

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

.section-label {
  margin: 0.9rem 0 0.4rem;
  font-size: 0.8rem;
  letter-spacing: 0.18em;
  color: var(--inv-dim);
  text-transform: uppercase;
}

.section-label:first-of-type {
  margin-top: 0;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.salvage-rows {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-bottom: 0.4rem;
}

.salvage-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.25rem 0.6rem;
  border: 1px solid transparent;
  border-radius: 4px;
  min-height: 1.6rem;
}

.salvage-row.zero {
  opacity: 0.45;
}

.salvage-row .bucket-name {
  color: var(--inv-text);
  letter-spacing: 0.06em;
}

.salvage-row .bucket-count {
  color: var(--inv-accent);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.salvage-row.zero .bucket-count {
  color: var(--inv-dim);
  font-weight: 400;
}

.key-item-rows {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-bottom: 0.4rem;
}

.key-item-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid transparent;
  border-radius: 4px;
  min-height: 1.6rem;
}

.key-item-row .key-glyph {
  color: var(--inv-accent);
  font-weight: 700;
}

.key-item-row .key-label {
  color: var(--inv-text);
  letter-spacing: 0.06em;
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
  'breaching-charge': 'Breaching Charge',
};

/**
 * Human-readable labels for typed-salvage buckets. Matches the P2.5.M4.2 docs:
 * Scrap = mechanical, Chips = electronics, Bio = organic, Data = informational.
 */
const SALVAGE_LABELS: Record<SalvageType, string> = {
  scrap: 'Scrap',
  chips: 'Chips',
  bio: 'Bio',
  data: 'Data',
};

class ItemInventory extends HTMLElement {
  #items: ItemInventoryItem[] = [];
  #salvage: TypedSalvage = emptySalvage();
  #keyItems: KeyItemView[] = [];
  #ready = false;
  #bodyEl: HTMLElement | null = null;
  #titleEl: HTMLElement | null = null;
  #panelEl: HTMLElement | null = null;
  #hintEl: HTMLElement | null = null;
  #buttons: HTMLButtonElement[] = [];
  #selectedIndex = 0;
  #onKeyDown: ((this: HTMLElement, ev: KeyboardEvent) => void) | null = null;
  #onBackdrop: ((this: HTMLElement, ev: PointerEvent) => void) | null = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#titleEl = h('h2', { className: 'title' });
    // Single body container; #render writes both the SALVAGE and CONSUMABLES
    // sections into it so the layout adapts to empty / full / Hub-vs-combat
    // states without juggling separate element refs.
    this.#bodyEl = h('div', { className: 'body' });
    this.#hintEl = h('p', { className: 'hint' });
    this.#panelEl = h('section', { className: 'panel' }, [
      this.#titleEl,
      this.#bodyEl,
      this.#hintEl,
    ]);
    shadow.appendChild(this.#panelEl);

    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);
    this.#onBackdrop = evt => {
      if (!evt.composedPath().includes(this.#panelEl as EventTarget)) this.#emit('dismiss');
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    this.#render();
  }

  /**
   * Combined contents API — both the typed-salvage wallet and the
   * consumables list. Callers always pass both; in Hub state consumables is
   * typically `[]` (no deployed crew member) but salvage is the campaign
   * wallet; in combat consumables is the deployed crew member's items and
   * salvage is their job-scoped pickup wallet.
   *
   * The salvage section is informational only — there's no per-bucket action
   * here yet. Cursor navigation skips the salvage rows and stays on the consumable list.
   */
  setContents({
    salvage = emptySalvage(),
    consumables = [] as Item[],
    keyItems = [] as KeyItemView[],
  }: {
    salvage?: TypedSalvage;
    consumables?: Item[];
    keyItems?: KeyItemView[];
  } = {}) {
    this.#salvage = salvage;
    this.#keyItems = keyItems;
    // Aggregate by id so duplicates show as "Stim x2".
    const counts = new Map<string, number>();
    for (const c of consumables) {
      counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    }
    this.#items = [];
    for (const [id, count] of counts) {
      this.#items.push({ id, label: ITEM_LABELS[id as keyof typeof ITEM_LABELS] ?? id, count });
    }
    this.#selectedIndex = 0;
    if (this.#ready) this.#render();
  }

  /**
   * Legacy single-arg API kept for back-compat with callers that only had a
   * consumables list. New callers should prefer `setContents`.
   */
  setItems(consumables: Item[]) {
    this.setContents({ consumables });
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
    this.#titleEl!.textContent = '── INVENTORY ──';

    // Wipe and rebuild body. #buttons is rebuilt alongside so the keyboard
    // cursor stays in sync with the DOM after every render.
    while (this.#bodyEl!.firstChild) this.#bodyEl!.removeChild(this.#bodyEl!.firstChild);
    this.#buttons = [];

    // ── SALVAGE section ──
    // Always rendered so the chrome is consistent across Hub / combat /
    // empty-wallet states. Zero-count rows are dimmed (not hidden) so the
    // player can see *which* bucket they're missing without parsing absence.
    this.#bodyEl!.appendChild(h('p', { className: 'section-label', textContent: 'SALVAGE' }));
    const salvageRows = h('div', { className: 'salvage-rows' });
    for (const t of SALVAGE_TYPES) {
      const count = this.#salvage[t];
      const row = h('div', {
        className: count > 0 ? 'salvage-row' : 'salvage-row zero',
      });
      row.append(
        h('span', { className: 'bucket-name', textContent: SALVAGE_LABELS[t] }),
        h('span', { className: 'bucket-count', textContent: String(count) })
      );
      salvageRows.appendChild(row);
    }
    this.#bodyEl!.appendChild(salvageRows);

    // ── KEY ITEMS section ──
    // Only rendered when the player is carrying keycards. Unlike salvage
    // (which always shows zero-count rows), key items are absence-hidden —
    // an empty "KEY ITEMS: (none)" section would just be visual noise for
    // the majority of runs that don't involve locked doors.
    if (this.#keyItems.length > 0) {
      this.#bodyEl!.appendChild(h('p', { className: 'section-label', textContent: 'KEY ITEMS' }));
      const keyRows = h('div', { className: 'key-item-rows' });
      for (const ki of this.#keyItems) {
        const row = h('div', { className: 'key-item-row' });
        row.append(
          h('span', { className: 'key-glyph', textContent: KEYCARD_GLYPH }),
          h('span', {
            className: 'key-label',
            textContent: ki.locationName ?? ki.label,
          })
        );
        keyRows.appendChild(row);
      }
      this.#bodyEl!.appendChild(keyRows);
    }

    // ── CONSUMABLES section ──
    this.#bodyEl!.appendChild(h('p', { className: 'section-label', textContent: 'CONSUMABLES' }));
    if (this.#items.length === 0) {
      this.#bodyEl!.appendChild(h('p', { className: 'empty', textContent: 'No consumables.' }));
    } else {
      const itemRows = h('div', { className: 'rows' });
      for (let i = 0; i < this.#items.length; i++) {
        const item = this.#items[i];
        const btn = h('button', {
          type: 'button',
          className: 'row',
          ariaCurrent: i === this.#selectedIndex ? 'true' : 'false',
        }) as HTMLButtonElement;
        btn.dataset.index = String(i);
        btn.addEventListener('click', () => this.#activate(i));
        btn.append(
          h('span', { className: 'cursor', textContent: '>' }),
          h('span', { className: 'item-name', textContent: item.label }),
          h('span', {
            className: 'item-count',
            textContent: item.count > 1 ? `x${item.count}` : '',
          })
        );
        itemRows.appendChild(btn);
        this.#buttons.push(btn);
      }
      this.#bodyEl!.appendChild(itemRows);
    }

    // Hint copy: only mention ENTER when there's something to use. Empty
    // wallets + empty consumables still get an Esc hint (the salvage view
    // is itself useful information even with no items to activate).
    const hasConsumables = this.#items.length > 0;
    const walletIsEmpty = totalSalvage(this.#salvage) === 0;
    const hasKeyItems = this.#keyItems.length > 0;
    if (hasConsumables) {
      this.#hintEl!.textContent = '[ ENTER use  ·  Esc close ]';
    } else if (walletIsEmpty && !hasKeyItems) {
      this.#hintEl!.textContent = 'Nothing carried. [ Esc close ]';
    } else {
      this.#hintEl!.textContent = '[ Esc close ]';
    }
  }

  #handleKey(evt: KeyboardEvent) {
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

  #move(delta: number) {
    if (this.#items.length === 0) return;
    this.#selectedIndex = (this.#selectedIndex + delta + this.#items.length) % this.#items.length;
    for (let i = 0; i < this.#buttons.length; i++) {
      this.#buttons[i].setAttribute('aria-current', i === this.#selectedIndex ? 'true' : 'false');
    }
    const btn = this.#buttons[this.#selectedIndex];
    if (btn) btn.focus();
  }

  #activate(index: number) {
    const item = this.#items[index];
    if (!item) return;
    this.#emit('use-item', { itemId: item.id });
  }

  #emit(eventName: string, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

customElements.define('item-inventory', ItemInventory);

export default ItemInventory;
