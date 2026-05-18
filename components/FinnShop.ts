/**
 * <finn-shop> — modal shop for purchasing items from Finn.
 *
 * Catalog items are grouped by scope (Job / Campaign / Meta). Campaign-scoped
 * items require a target crew member selection. Keyboard-navigable (↑/↓ to
 * browse, Enter to buy, Esc to close).
 *
 * Events:
 *   - `purchase`  — `{ itemId, targetMemberId? }` — player confirmed a buy.
 *   - `dismiss`   — player pressed Esc / clicked backdrop.
 */

import { h } from '/src/domUtils.js';
import { ITEM_ID, ITEM_SCOPE } from '/src/game/items.js';
import type { Item } from '/src/game/items.js';
import type { Crew as CrewMember } from '/src/game/Crew.js';

type CrewMemberSnapshot = {
  id: string;
  callsign: string;
  archetype: string;
  hp: number;
  maxHp: number;
  flatlined: boolean;
  atMaxHit: boolean;
  atMaxDodge: boolean;
};

const CSS = `
:host {
  --shop-bg: rgba(7, 18, 16, 0.96);
  --shop-border: var(--accent-color, #00d9a5);
  --shop-text: #c5efdf;
  --shop-dim: #6ae8c8;
  --shop-accent: var(--accent-color, #00d9a5);
  --shop-danger: #ff5d73;
  --shop-gold: #f0c040;
  --shop-row-hover: rgba(0, 217, 165, 0.08);
  --shop-row-active: rgba(0, 217, 165, 0.18);
  --shop-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  position: fixed;
  inset: 0;
  z-index: 50;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--shop-text);
}

:host([open]) {
  display: flex;
}

.panel {
  background: var(--shop-bg);
  border: 1px solid var(--shop-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.4rem;
  box-shadow: var(--shop-shadow);
  min-width: min(480px, 92vw);
  max-width: min(640px, 96vw);
  max-height: 80vh;
  overflow-y: auto;
}

.title {
  margin: 0 0 0.75rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--shop-accent);
  border-bottom: 1px dashed var(--shop-border);
  padding-bottom: 0.5rem;
}

.balance {
  margin: 0 0 0.75rem;
  text-align: center;
  color: var(--shop-gold);
  font-size: 0.9rem;
  letter-spacing: 0.08em;
}

.section-label {
  margin: 0.75rem 0 0.3rem;
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  color: var(--shop-dim);
  text-transform: uppercase;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

button.row {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--shop-text);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0.5rem 0.6rem;
  text-align: left;
  font: inherit;
  cursor: pointer;
  min-height: 44px;
  display: grid;
  grid-template-columns: 1.3em minmax(0, 1fr) max-content;
  gap: 0.2rem 0.5rem;
  align-items: center;
}

button.row:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

button.row:not(:disabled):hover {
  background: var(--shop-row-hover);
}

button.row:focus-visible,
button.row[aria-current='true'] {
  outline: none;
  border-color: var(--shop-accent);
  background: var(--shop-row-active);
}

.cursor {
  color: var(--shop-accent);
  font-weight: 700;
  visibility: hidden;
}

button.row:focus-visible .cursor,
button.row[aria-current='true'] .cursor {
  visibility: visible;
}

.item-name {
  color: var(--shop-accent);
  font-weight: 700;
  letter-spacing: 0.08em;
}

.item-cost {
  color: var(--shop-gold);
  font-size: 0.88rem;
  white-space: nowrap;
}

.item-desc {
  color: var(--shop-dim);
  font-size: 0.82rem;
  grid-column: 2 / span 2;
}

.target-section {
  margin: 0.6rem 0 0;
  padding: 0.6rem 0 0;
  border-top: 1px dashed var(--shop-border);
}

.target-label {
  margin: 0 0 0.3rem;
  font-size: 0.82rem;
  letter-spacing: 0.12em;
  color: var(--shop-dim);
}

button.target-row {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--shop-text);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  text-align: left;
  font: inherit;
  cursor: pointer;
  min-height: 36px;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
}

button.target-row:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

button.target-row:not(:disabled):hover {
  background: var(--shop-row-hover);
}

button.target-row:focus-visible,
button.target-row[aria-current='true'] {
  outline: none;
  border-color: var(--shop-accent);
  background: var(--shop-row-active);
}

button.target-row .cursor {
  color: var(--shop-accent);
  font-weight: 700;
  visibility: hidden;
}

button.target-row:focus-visible .cursor,
button.target-row[aria-current='true'] .cursor {
  visibility: visible;
}

.hint {
  text-align: center;
  font-size: 0.85rem;
  color: var(--shop-dim);
  letter-spacing: 0.1em;
  margin: 0.9rem 0 0;
}
`;

const SCOPE_LABELS = {
  [ITEM_SCOPE.JOB]: 'CONSUMABLES',
  [ITEM_SCOPE.CAMPAIGN]: 'CREW GEAR',
  [ITEM_SCOPE.META]: 'HUB UPGRADES',
};

const SCOPE_ORDER = [ITEM_SCOPE.JOB, ITEM_SCOPE.CAMPAIGN, ITEM_SCOPE.META];

class FinnShop extends HTMLElement {
  #catalog: Item[] = [];
  #crew: CrewMemberSnapshot[] = [];
  #salvage = 0;
  #ready = false;
  #panelEl: HTMLElement | null = null;
  #titleEl: HTMLElement | null = null;
  #balanceEl: HTMLElement | null = null;
  #bodyEl: HTMLElement | null = null;
  #hintEl: HTMLElement | null = null;

  // Navigation state
  #phase = 'browse'; // 'browse' | 'target'
  #flatItems: { el: HTMLButtonElement; item: Item }[] = []; // flattened list of purchasable items (for browse nav)
  #selectedIndex = 0;
  #pendingItem: Item | null = null;
  #targetButtons: HTMLButtonElement[] = [];
  #targetIndex = 0;

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
    this.#balanceEl = h('p', { className: 'balance' });
    this.#bodyEl = h('div');
    this.#hintEl = h('p', { className: 'hint' });
    this.#panelEl = h('section', { className: 'panel' }, [
      this.#titleEl,
      this.#balanceEl,
      this.#bodyEl,
      this.#hintEl,
    ]);
    shadow.appendChild(this.#panelEl);

    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);
    // Clicks inside the shadow tree retarget `evt.target` to the host, so
    // `evt.target === this` would dismiss on every panel click. Use composedPath.
    this.#onBackdrop = evt => {
      if (!evt.composedPath().includes(this.#panelEl as EventTarget)) this.#emit('dismiss');
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    this.#render();
  }

  /**
   * @param {Array} catalog — item descriptors from `Finn.catalog(meta)`
   * @param {Array} crew — crew member snapshots `{ id, callsign, archetype, hp, maxHp, flatlined }`
   * @param {number} salvage — campaign salvage balance
   */
  setCatalog(catalog: Item[], crew: CrewMember[], salvage: number) {
    this.#catalog = catalog;
    this.#crew = crew.map(member => ({
      id: member.id,
      callsign: member.callsign ?? member.id,
      archetype: member.constructor?.name ?? member.archetype ?? 'Crew',
      hp: member.hp,
      maxHp: member.maxHp,
      flatlined: !!member.flatlined,
      atMaxHit: (member.gear?.hitBonus ?? 0) >= member.maxHitBonus,
      atMaxDodge: (member.gear?.dodgeBonus ?? 0) >= member.maxDodgeBonus,
    }));
    this.#salvage = salvage;
    this.#phase = 'browse';
    this.#pendingItem = null;
    this.#selectedIndex = 0;
    if (this.#ready) this.#render();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
      this.#focusSelected();
    });
  }

  hide() {
    this.removeAttribute('open');
    this.#phase = 'browse';
    this.#pendingItem = null;
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
    this.#titleEl!.textContent = "── FINN'S SHOP ──";
    this.#balanceEl!.textContent = `SALVAGE ${this.#salvage}`;

    while (this.#bodyEl!.firstChild) this.#bodyEl!.removeChild(this.#bodyEl!.firstChild);
    this.#flatItems = [];

    if (this.#phase === 'target') {
      this.#renderTargetSelection();
      return;
    }

    // Group catalog by scope.
    for (const scope of SCOPE_ORDER) {
      const items = this.#catalog.filter(item => item.scope === scope);
      if (items.length === 0) continue;

      const label = h('p', { className: 'section-label', textContent: SCOPE_LABELS[scope] });
      const rows = h('div', { className: 'rows' });

      for (const item of items) {
        const canAfford = this.#salvage >= item.cost;
        const flatIndex = this.#flatItems.length;
        const btn = h('button', {
          type: 'button',
          className: 'row',
          disabled: !canAfford,
          ariaCurrent: flatIndex === this.#selectedIndex ? 'true' : 'false',
        });
        btn.dataset.flatIndex = String(flatIndex);
        btn.addEventListener('click', () => this.#selectItem(flatIndex));
        btn.append(
          h('span', { className: 'cursor', textContent: '>' }),
          h('span', { className: 'item-name', textContent: item.label }),
          h('span', { className: 'item-cost', textContent: `${item.cost} SAL` }),
          h('span', { className: 'item-desc', textContent: item.description })
        );
        rows.appendChild(btn);
        this.#flatItems.push({ el: btn as HTMLButtonElement, item });
      }
      this.#bodyEl!.appendChild(label);
      this.#bodyEl!.appendChild(rows);
    }

    if (this.#flatItems.length === 0) {
      this.#bodyEl!.appendChild(
        h('p', {
          className: 'section-label',
          textContent: 'No items available.',
          style: 'text-align: center; margin-top: 1rem;',
        })
      );
    }

    this.#hintEl!.textContent = '[ ENTER buy  ·  Esc close ]';
  }

  #renderTargetSelection() {
    const item = this.#pendingItem;
    if (!item) return;

    const label = h('p', {
      className: 'target-label',
      textContent: `${item.label} — choose crew member:`,
    });
    this.#bodyEl!.appendChild(label);
    this.#targetButtons = [] as HTMLButtonElement[];
    this.#targetIndex = Math.max(
      0,
      this.#crew.findIndex(m => !m.flatlined)
    );

    const isTargetingChip = item.id === ITEM_ID.TARGETING_CHIP;
    const isReflexWeave = item.id === ITEM_ID.REFLEX_WEAVE;
    const rows = h('div', { className: 'rows' });
    for (let i = 0; i < this.#crew.length; i++) {
      const member = this.#crew[i];
      const atCap =
        (isTargetingChip && member.atMaxHit) || (isReflexWeave && member.atMaxDodge);
      const btn = h('button', {
        type: 'button',
        className: 'target-row',
        disabled: member.flatlined || atCap,
        ariaCurrent: i === this.#targetIndex ? 'true' : 'false',
      }) as HTMLButtonElement;
      btn.dataset.targetIndex = String(i);
      btn.addEventListener('click', () => this.#confirmTarget(i));
      const capLabel = isTargetingChip ? 'MAX HIT' : isReflexWeave ? 'MAX DODGE' : '';
      const suffix = member.flatlined ? ' FLATLINED' : atCap ? ` ${capLabel}` : '';
      btn.append(
        h('span', { className: 'cursor', textContent: '>' }),
        h('span', {
          className: 'item-name',
          textContent: member.callsign,
        }),
        h('span', {
          className: 'item-desc',
          textContent: `${member.archetype.toUpperCase()} HP ${member.hp}/${member.maxHp}${suffix}`,
        })
      );
      rows.appendChild(btn);
      this.#targetButtons.push(btn);
    }
    this.#bodyEl!.appendChild(rows);
    this.#hintEl!.textContent = '[ ENTER confirm  ·  Esc back ]';
  }

  #handleKey(evt: KeyboardEvent) {
    if (!this.isOpen) return;
    evt.stopPropagation();

    if (evt.key === 'Escape') {
      evt.preventDefault();
      if (this.#phase === 'target') {
        // Back to browse.
        this.#phase = 'browse';
        this.#pendingItem = null;
        this.#render();
        queueMicrotask(() => this.#focusSelected());
      } else {
        this.#emit('dismiss');
      }
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
      if (this.#phase === 'target') {
        this.#confirmTarget(this.#targetIndex);
      } else {
        this.#selectItem(this.#selectedIndex);
      }
    }
  }

  #move(delta: number) {
    if (this.#phase === 'target') {
      this.#moveTarget(delta);
      return;
    }
    if (this.#flatItems.length === 0) return;
    let next = this.#selectedIndex;
    for (let i = 0; i < this.#flatItems.length; i++) {
      next = (next + delta + this.#flatItems.length) % this.#flatItems.length;
      if (!this.#flatItems[next].el.disabled) break;
    }
    this.#selectedIndex = next;
    this.#syncCurrent();
    this.#focusSelected();
  }

  #moveTarget(delta: number) {
    if (this.#targetButtons.length === 0) return;
    let next = this.#targetIndex;
    for (let i = 0; i < this.#crew.length; i++) {
      next = (next + delta + this.#crew.length) % this.#crew.length;
      if (!this.#crew[next].flatlined) break;
    }
    this.#targetIndex = next;
    for (let i = 0; i < this.#targetButtons.length; i++) {
      this.#targetButtons[i].setAttribute(
        'aria-current',
        i === this.#targetIndex ? 'true' : 'false'
      );
    }
    const btn = this.#targetButtons[this.#targetIndex];
    if (btn && !btn.disabled) btn.focus();
  }

  #selectItem(index: number) {
    const entry = this.#flatItems[index];
    if (!entry || entry.el.disabled) return;
    const item = entry.item;

    if (item.needsTarget) {
      // Transition to target selection phase.
      this.#phase = 'target';
      this.#pendingItem = item;
      this.#render();
      queueMicrotask(() => {
        const btn = this.#targetButtons[this.#targetIndex];
        if (btn && !btn.disabled) btn.focus();
      });
      return;
    }

    // No target needed — purchase immediately (meta upgrades).
    this.#emit('purchase', { itemId: item.id });
  }

  #confirmTarget(index: number) {
    const member = this.#crew[index];
    if (!member || member.flatlined || !this.#pendingItem) return;
    this.#emit('purchase', {
      itemId: this.#pendingItem.id,
      targetMemberId: member.id,
    });
  }

  #syncCurrent() {
    for (let i = 0; i < this.#flatItems.length; i++) {
      this.#flatItems[i].el.setAttribute(
        'aria-current',
        i === this.#selectedIndex ? 'true' : 'false'
      );
    }
  }

  #focusSelected() {
    if (this.#phase === 'target') {
      const btn = this.#targetButtons[this.#targetIndex];
      if (btn && !btn.disabled) {
        btn.focus();
        return true;
      }
      return false;
    }
    const entry = this.#flatItems[this.#selectedIndex];
    if (entry?.el && !entry.el.disabled) {
      entry.el.focus();
      return true;
    }
    this.focus();
    return false;
  }

  #emit(eventName: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

customElements.define('finn-shop', FinnShop);

export default FinnShop;
