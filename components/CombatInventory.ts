/**
 * <combat-inventory> — the deployed operator's live inventory overlay.
 *
 * Three sections:
 *   1. **SALVAGE** — the operator's job-scoped pickup wallet (informational).
 *   2. **KEY ITEMS** — held keycards, shown as the generic "Access keycard":
 *      the locked door is right in front of you, so the location is self-evident.
 *   3. **CONSUMABLES** — the operator's item list, navigable with ↑/↓ and
 *      activated with Enter. Emits `use-item` with `{ itemId }` on confirm.
 *
 * The Hub's read-only campaign stash is a separate element, `<crew-inventory>`.
 */

import { h } from '/src/domUtils.js';
import { emptySalvage, type TypedSalvage } from '/src/game/salvage.js';
import type { Item } from '/src/game/items.js';
import type { KeyItemView } from '/src/shell/domTypes.js';
import { INVENTORY_CSS, InventoryOverlay } from '/components/InventoryOverlay.js';

type CombatInventoryItem = Omit<Item, 'scope' | 'cost' | 'description' | 'needsTarget'> & {
  count: number;
};

/** Human-readable labels for item IDs. */
const ITEM_LABELS = {
  stim: 'Stim',
  'smoke-charge': 'Smoke Charge',
  'breaching-charge': 'Breaching Charge',
};

/** Interactive consumables-list styling layered on top of the shared chrome. */
const CONSUMABLE_CSS = `
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
`;

class CombatInventory extends InventoryOverlay {
  #items: CombatInventoryItem[] = [];
  #buttons: HTMLButtonElement[] = [];
  #selectedIndex = 0;

  setContents({
    salvage = emptySalvage(),
    consumables = [] as Item[],
    keyItems = [] as KeyItemView[],
  }: {
    salvage?: TypedSalvage;
    consumables?: Item[];
    keyItems?: KeyItemView[];
  } = {}) {
    this.salvage = salvage;
    this.keyItems = keyItems;
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
    if (this.ready) this.render();
  }

  protected override styleText(): string {
    return INVENTORY_CSS + CONSUMABLE_CSS;
  }

  protected panelTitle(): string {
    return '── INVENTORY ──';
  }

  protected renderBody(): void {
    this.#buttons = [];
    this.renderSalvageSection();
    this.renderKeycardSection('KEY ITEMS', ki => ki.label);

    this.bodyEl.appendChild(h('p', { className: 'section-label', textContent: 'CONSUMABLES' }));
    if (this.#items.length === 0) {
      this.bodyEl.appendChild(h('p', { className: 'empty', textContent: 'No consumables.' }));
      return;
    }
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
        h('span', { className: 'item-count', textContent: item.count > 1 ? `x${item.count}` : '' })
      );
      itemRows.appendChild(btn);
      this.#buttons.push(btn);
    }
    this.bodyEl.appendChild(itemRows);
  }

  protected hintText(): string {
    // Only mention ENTER when there's something to use. Empty wallets + empty
    // consumables still get an Esc hint (the salvage view is useful on its own).
    if (this.#items.length > 0) return '[ ENTER use  ·  Esc close ]';
    if (this.salvageIsEmpty && this.keyItems.length === 0) return 'Nothing carried. [ Esc close ]';
    return '[ Esc close ]';
  }

  protected override onShown(): void {
    const btn = this.#buttons[this.#selectedIndex];
    if (btn) btn.focus();
    else this.focus();
  }

  protected override handleExtraKey(evt: KeyboardEvent): boolean {
    if (evt.key === 'ArrowDown' || evt.key === 's') {
      evt.preventDefault();
      this.#move(1);
      return true;
    }
    if (evt.key === 'ArrowUp' || evt.key === 'w') {
      evt.preventDefault();
      this.#move(-1);
      return true;
    }
    if (evt.key === 'Enter' || evt.key === ' ') {
      evt.preventDefault();
      this.#activate(this.#selectedIndex);
      return true;
    }
    return false;
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
    this.emit('use-item', { itemId: item.id });
  }
}

customElements.define('combat-inventory', CombatInventory);

export default CombatInventory;
