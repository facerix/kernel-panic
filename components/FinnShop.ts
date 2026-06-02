/**
 * <finn-shop> — modal shop for purchasing items from Finn.
 *
 * M5.2: Tabbed UI with SELL and BUY tabs. The SELL tab shows per-type salvage
 * rows with differentiated pricing; the BUY tab shows consumables and gear
 * grouped by scope. Keyboard-navigable (←/→ or Tab to switch tabs, ↑/↓ to
 * browse within, Enter to buy/sell, Esc to close).
 *
 * Events:
 *   - `purchase`      — `{ itemId, targetMemberId? }` — player confirmed a buy.
 *   - `sell-salvage`  — `{ quantity, type }` — player sold N units of a specific type.
 *   - `dismiss`       — player pressed Esc / clicked backdrop.
 */

import { h } from '/src/domUtils.js';
import { SALVAGE_SELL_RATE } from '/src/game/constants.js';
import {
  SALVAGE_TYPES,
  emptySalvage,
  type TypedSalvage,
  type SalvageType,
} from '/src/game/salvage.js';
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
  atMaxRangedDamage: boolean;
};

const SALVAGE_TYPE_LABELS: Record<SalvageType, string> = {
  scrap: 'Scrap',
  chips: 'Chips',
  bio: 'Bio',
  data: 'Data',
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

.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  margin: 0 0 0.75rem;
  border: 1px solid var(--shop-border);
  border-radius: 4px;
  overflow: hidden;
}

button.tab {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--shop-dim);
  border: none;
  border-right: 1px solid var(--shop-border);
  padding: 0.5rem 0.6rem;
  font: inherit;
  font-size: 0.82rem;
  letter-spacing: 0.14em;
  cursor: pointer;
  text-transform: uppercase;
  min-height: 36px;
}

button.tab:last-child {
  border-right: none;
}

button.tab[aria-selected='true'] {
  background: var(--shop-row-active);
  color: var(--shop-accent);
  font-weight: 700;
}

button.tab:not([aria-selected='true']):hover {
  background: var(--shop-row-hover);
}

.sell-row {
  display: grid;
  grid-template-columns: 5.5em 3em minmax(0, 1fr) max-content max-content;
  gap: 0.3rem 0.5rem;
  align-items: center;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px dashed rgba(0, 217, 165, 0.2);
}

.sell-row:last-child {
  border-bottom: none;
}

.sell-type-label {
  color: var(--shop-accent);
  font-weight: 700;
  letter-spacing: 0.06em;
  font-size: 0.85rem;
}

.sell-stock {
  color: var(--shop-text);
  font-size: 0.85rem;
  text-align: right;
}

.sell-rate {
  color: var(--shop-dim);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
}

button.sell-button {
  appearance: none;
  -webkit-appearance: none;
  background: rgba(0, 217, 165, 0.08);
  color: var(--shop-text);
  border: 1px solid rgba(0, 217, 165, 0.45);
  border-radius: 4px;
  padding: 0.35rem 0.5rem;
  font: inherit;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  cursor: pointer;
  min-height: 30px;
  white-space: nowrap;
}

button.sell-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

button.sell-button:not(:disabled):hover,
button.sell-button:focus-visible {
  outline: none;
  border-color: var(--shop-accent);
  background: var(--shop-row-active);
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

.empty-sell {
  text-align: center;
  color: var(--shop-dim);
  font-size: 0.82rem;
  padding: 0.8rem 0;
  letter-spacing: 0.08em;
}
`;

const SCOPE_LABELS: Record<string, string> = {
  [ITEM_SCOPE.JOB]: 'CONSUMABLES',
  [ITEM_SCOPE.CAMPAIGN]: 'CREW GEAR (Applies to a single crew member)',
};

const ITEM_CAP_LABELS: Record<string, string> = {
  [ITEM_ID.TARGETING_CHIP]: 'MAX HIT',
  [ITEM_ID.BALLISTICS_COIL]: 'MAX RANGED DMG',
  [ITEM_ID.REFLEX_WEAVE]: 'MAX DODGE',
};

const SCOPE_ORDER = [ITEM_SCOPE.JOB, ITEM_SCOPE.CAMPAIGN];

const TAB_SELL = 'sell';
const TAB_BUY = 'buy';
type TabId = typeof TAB_SELL | typeof TAB_BUY;

class FinnShop extends HTMLElement {
  #catalog: Item[] = [];
  #crew: CrewMemberSnapshot[] = [];
  #credits = 0;
  #salvage: TypedSalvage = emptySalvage();
  #ready = false;
  #panelEl: HTMLElement | null = null;
  #titleEl: HTMLElement | null = null;
  #balanceEl: HTMLElement | null = null;
  #tabsEl: HTMLElement | null = null;
  #bodyEl: HTMLElement | null = null;
  #hintEl: HTMLElement | null = null;

  // Navigation state
  #activeTab: TabId = TAB_SELL;
  #phase = 'browse'; // 'browse' | 'target'
  #flatItems: { el: HTMLButtonElement; item: Item }[] = [];
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
    this.#tabsEl = h('div', { className: 'tabs' });
    this.#bodyEl = h('div');
    this.#hintEl = h('p', { className: 'hint' });
    this.#panelEl = h('section', { className: 'panel' }, [
      this.#titleEl,
      this.#balanceEl,
      this.#tabsEl,
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
   * @param catalog — item descriptors from `Finn.catalog()`
   * @param crew — crew member snapshots
   * @param balances — campaign Cred + typed-salvage balances
   */
  setCatalog(
    catalog: Item[],
    crew: CrewMember[],
    balances: { credits: number; salvage: TypedSalvage }
  ) {
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
      atMaxRangedDamage: (member.gear?.rangedDamageBonus ?? 0) >= member.maxRangedDamageBonus,
    }));
    this.#credits = balances.credits ?? 0;
    this.#salvage = balances.salvage ?? emptySalvage();
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
    this.#balanceEl!.textContent = `CREDS ${this.#credits}`;

    // Render tabs
    while (this.#tabsEl!.firstChild) this.#tabsEl!.removeChild(this.#tabsEl!.firstChild);
    const sellTab = h('button', {
      type: 'button',
      className: 'tab',
      textContent: 'SELL',
      ariaSelected: this.#activeTab === TAB_SELL ? 'true' : 'false',
    }) as HTMLButtonElement;
    sellTab.addEventListener('click', () => this.#switchTab(TAB_SELL));
    const buyTab = h('button', {
      type: 'button',
      className: 'tab',
      textContent: 'BUY',
      ariaSelected: this.#activeTab === TAB_BUY ? 'true' : 'false',
    }) as HTMLButtonElement;
    buyTab.addEventListener('click', () => this.#switchTab(TAB_BUY));
    this.#tabsEl!.append(sellTab, buyTab);

    // Render body
    while (this.#bodyEl!.firstChild) this.#bodyEl!.removeChild(this.#bodyEl!.firstChild);
    this.#flatItems = [];

    if (this.#phase === 'target') {
      this.#renderTargetSelection();
      return;
    }

    if (this.#activeTab === TAB_SELL) {
      this.#renderSellTab();
    } else {
      this.#renderBuyTab();
    }
  }

  #renderSellTab() {
    const hasAnySalvage = SALVAGE_TYPES.some(t => this.#salvage[t] > 0);
    if (!hasAnySalvage) {
      this.#bodyEl!.appendChild(
        h('p', { className: 'empty-sell', textContent: 'No salvage to sell.' })
      );
      this.#hintEl!.textContent = '[ ←/→ tab  ·  Esc close ]';
      return;
    }

    for (const type of SALVAGE_TYPES) {
      const stock = this.#salvage[type];
      const rate = SALVAGE_SELL_RATE[type];
      const row = h('div', { className: 'sell-row' });
      row.append(
        h('span', { className: 'sell-type-label', textContent: SALVAGE_TYPE_LABELS[type] }),
        h('span', { className: 'sell-stock', textContent: String(stock) }),
        h('span', { className: 'sell-rate', textContent: `${rate} Cr/ea` }),
        this.#sellButton('SELL 1', 1, type, stock),
        this.#sellButton('ALL', stock, type, stock)
      );
      this.#bodyEl!.appendChild(row);
    }
    this.#hintEl!.textContent = '[ ←/→ tab  ·  Esc close ]';
  }

  #renderBuyTab() {
    for (const scope of SCOPE_ORDER) {
      const items = this.#catalog.filter(item => item.scope === scope);
      if (items.length === 0) continue;

      const label = h('p', { className: 'section-label', textContent: SCOPE_LABELS[scope] });
      const rows = h('div', { className: 'rows' });

      for (const item of items) {
        const canAfford = this.#credits >= item.cost;
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
          h('span', { className: 'item-cost', textContent: `${item.cost} Cr` }),
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

    this.#hintEl!.textContent = '[ ←/→ tab  ·  ENTER buy  ·  Esc close ]';
  }

  #sellButton(
    label: string,
    quantity: number,
    type: SalvageType,
    stock: number
  ): HTMLButtonElement {
    const btn = h('button', {
      type: 'button',
      className: 'sell-button',
      textContent: label,
      disabled: quantity <= 0 || stock < quantity,
    }) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      this.#emit('sell-salvage', { quantity, type });
    });
    return btn;
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
      this.#crew.findIndex(member => !this.#isTargetDisabled(member))
    );

    const isTargetingChip = item.id === ITEM_ID.TARGETING_CHIP;
    const isReflexWeave = item.id === ITEM_ID.REFLEX_WEAVE;
    const isBallisticsCoil = item.id === ITEM_ID.BALLISTICS_COIL;
    const rows = h('div', { className: 'rows' });
    for (let i = 0; i < this.#crew.length; i++) {
      const member = this.#crew[i];
      const atCap =
        (isTargetingChip && member.atMaxHit) ||
        (isReflexWeave && member.atMaxDodge) ||
        (isBallisticsCoil && member.atMaxRangedDamage);
      const disabled = this.#isTargetDisabled(member);
      const btn = h('button', {
        type: 'button',
        className: 'target-row',
        disabled,
        ariaCurrent: i === this.#targetIndex ? 'true' : 'false',
      }) as HTMLButtonElement;
      btn.dataset.targetIndex = String(i);
      btn.addEventListener('click', () => this.#confirmTarget(i));
      const capLabel = ITEM_CAP_LABELS[item.id] ?? '';
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

  #switchTab(tab: TabId) {
    if (tab === this.#activeTab) return;
    this.#activeTab = tab;
    this.#phase = 'browse';
    this.#pendingItem = null;
    this.#selectedIndex = 0;
    this.#render();
    queueMicrotask(() => this.#focusSelected());
  }

  #handleKey(evt: KeyboardEvent) {
    if (!this.isOpen) return;
    evt.stopPropagation();

    if (evt.key === 'Escape') {
      evt.preventDefault();
      if (this.#phase === 'target') {
        this.#phase = 'browse';
        this.#pendingItem = null;
        this.#render();
        queueMicrotask(() => this.#focusSelected());
      } else {
        this.#emit('dismiss');
      }
      return;
    }

    // Tab switching: ←/→ arrows or Tab key
    if (this.#phase === 'browse') {
      if (evt.key === 'ArrowLeft' || evt.key === 'a') {
        evt.preventDefault();
        this.#switchTab(TAB_SELL);
        return;
      }
      if (evt.key === 'ArrowRight' || evt.key === 'd') {
        evt.preventDefault();
        this.#switchTab(TAB_BUY);
        return;
      }
      if (evt.key === 'Tab') {
        evt.preventDefault();
        this.#switchTab(this.#activeTab === TAB_SELL ? TAB_BUY : TAB_SELL);
        return;
      }
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
      } else if (this.#activeTab === TAB_BUY) {
        this.#selectItem(this.#selectedIndex);
      }
    }
  }

  #move(delta: number) {
    if (this.#phase === 'target') {
      this.#moveTarget(delta);
      return;
    }
    if (this.#activeTab !== TAB_BUY) return; // sell tab has no keyboard-navigable list
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
      if (!this.#targetButtons[next].disabled) break;
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
      this.#phase = 'target';
      this.#pendingItem = item;
      this.#render();
      queueMicrotask(() => {
        const btn = this.#targetButtons[this.#targetIndex];
        if (btn && !btn.disabled) btn.focus();
      });
      return;
    }

    this.#emit('purchase', { itemId: item.id });
  }

  #confirmTarget(index: number) {
    const member = this.#crew[index];
    const btn = this.#targetButtons[index];
    if (!member || !btn || btn.disabled || !this.#pendingItem) return;
    this.#emit('purchase', {
      itemId: this.#pendingItem.id,
      targetMemberId: member.id,
    });
  }

  #isTargetDisabled(member: CrewMemberSnapshot) {
    if (member.flatlined || !this.#pendingItem) return true;
    switch (this.#pendingItem.id) {
      case ITEM_ID.TARGETING_CHIP:
        return member.atMaxHit;
      case ITEM_ID.REFLEX_WEAVE:
        return member.atMaxDodge;
      case ITEM_ID.BALLISTICS_COIL:
        return member.atMaxRangedDamage;
      default:
        return false;
    }
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
    if (this.#activeTab === TAB_BUY) {
      const entry = this.#flatItems[this.#selectedIndex];
      if (entry?.el && !entry.el.disabled) {
        entry.el.focus();
        return true;
      }
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
