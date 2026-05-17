/**
 * <crew-list> — navigable list of crew members, extracted from the old
 * monolithic <crew-roster>. Pure reusable list with no modal chrome.
 *
 * Emits:
 *   - `select` — highlight changed. `detail: { member }` (snapshot object).
 *
 * The parent component owns the modal backdrop, title, and any detail pane.
 * This component is just the row list + keyboard nav.
 */

import { h } from '/src/domUtils.js';
import type { Crew as CrewMember } from '/src/game/Crew.js';

type CrewSummary = {
  id: string;
  callsign: string;
  archetype: string;
  hp: number;
  maxHp: number;
  flatlined: boolean;
};

const CSS = `
:host {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--cl-text, #c5efdf);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

button.row {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--cl-text, #c5efdf);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0.6rem 0.75rem;
  text-align: left;
  font: inherit;
  cursor: pointer;
  min-height: 48px;
  display: grid;
  grid-template-columns: 1.3em minmax(0, 1fr) max-content;
  gap: 0.35rem 0.65rem;
  align-items: center;
}

button.row:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

button.row:not(:disabled):hover {
  background: var(--cl-row-hover, rgba(0, 217, 165, 0.08));
}

button.row:focus-visible,
button.row[aria-current='true'] {
  outline: none;
  border-color: var(--cl-accent, #00d9a5);
  background: var(--cl-row-active, rgba(0, 217, 165, 0.18));
}

.cursor {
  color: var(--cl-accent, #00d9a5);
  font-weight: 700;
  visibility: hidden;
}

button.row:focus-visible .cursor,
button.row[aria-current='true'] .cursor {
  visibility: visible;
}

.name {
  color: var(--cl-accent, #00d9a5);
  font-weight: 700;
  letter-spacing: 0.1em;
  overflow-wrap: anywhere;
}

.meta {
  color: var(--cl-dim, #6ae8c8);
  font-size: 0.88rem;
  grid-column: 2 / span 2;
}

.flag {
  color: var(--cl-danger, #ff5d73);
  font-size: 0.82rem;
  letter-spacing: 0.1em;
}
`;

class CrewList extends HTMLElement {
  #crew: CrewSummary[] = [];
  #ready = false;
  #rowsEl: HTMLElement | null = null;
  #buttons: HTMLButtonElement[] = [];
  #selectedIndex = 0;
  #onKeyDown: ((this: HTMLElement, ev: KeyboardEvent) => void) | null = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#rowsEl = h('div', { className: 'rows' });
    shadow.appendChild(this.#rowsEl);

    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);

    this.#ready = true;
    this.#render();
  }

  /**
   * @param {Array} crew — array of crew member objects (or snapshots).
   */
  setCrew(crew: CrewMember[]) {
    if (!Array.isArray(crew)) {
      throw new TypeError('<crew-list>.setCrew requires an array');
    }
    this.#crew = crew.map(member => ({
      id: member.id,
      callsign: member.callsign ?? member.id,
      archetype: member.constructor?.name ?? member.archetype ?? 'Crew',
      hp: member.hp,
      maxHp: member.maxHp,
      flatlined: !!member.flatlined,
    }));
    this.#selectedIndex = Math.max(
      0,
      this.#crew.findIndex(member => !member.flatlined)
    );
    if (this.#ready) this.#render();
    // Emit initial selection so the parent can populate the detail pane.
    if (this.#crew.length > 0) {
      this.#emitSelect();
    }
  }

  /** Focus the currently selected row (if any). Returns true if focused. */
  focusSelected() {
    const button = this.#buttons[this.#selectedIndex];
    if (!button || button.disabled) return false;
    button.focus();
    return true;
  }

  get selectedMember() {
    return this.#crew[this.#selectedIndex] ?? null;
  }

  disconnectedCallback() {
    if (this.#onKeyDown) this.removeEventListener('keydown', this.#onKeyDown);
  }

  #render() {
    if (!this.#ready) return;

    while (this.#rowsEl!.firstChild) this.#rowsEl!.removeChild(this.#rowsEl!.firstChild);
    this.#buttons = [];

    for (let i = 0; i < this.#crew.length; i++) {
      const member = this.#crew[i];
      // Only flatlined members are disabled; living rows stay focusable for
      // keyboard navigation and click-to-select.
      const disabled = member.flatlined;
      const row = h('button', {
        type: 'button',
        className: 'row',
        disabled,
        ariaCurrent: i === this.#selectedIndex ? 'true' : 'false',
      }) as HTMLButtonElement;
      row.dataset.index = String(i);
      row.addEventListener('click', () => this.#onRowClick(i));
      row.append(
        h('span', { className: 'cursor', textContent: '>' }),
        h('span', { className: 'name', textContent: member.callsign }),
        h('span', {
          className: 'flag',
          textContent: member.flatlined ? 'FLATLINED' : '',
        }),
        h('span', {
          className: 'meta',
          textContent: `${member.archetype.toUpperCase()}  HP ${member.hp}/${member.maxHp}`,
        })
      );
      this.#rowsEl!.appendChild(row);
      this.#buttons.push(row);
    }
  }

  #handleKey(evt: KeyboardEvent) {
    if (evt.key === 'ArrowDown' || evt.key.toLowerCase() === 's') {
      evt.preventDefault();
      evt.stopPropagation();
      this.#move(1);
      return;
    }
    if (evt.key === 'ArrowUp' || evt.key.toLowerCase() === 'w') {
      evt.preventDefault();
      evt.stopPropagation();
      this.#move(-1);
      return;
    }
  }

  #move(delta: number) {
    if (this.#crew.length === 0) return;
    let next = this.#selectedIndex;
    for (let i = 0; i < this.#crew.length; i++) {
      next = (next + delta + this.#crew.length) % this.#crew.length;
      if (!this.#crew[next].flatlined) break;
    }
    this.#selectedIndex = next;
    this.#syncCurrent();
    this.focusSelected();
    this.#emitSelect();
  }

  #onRowClick(index: number) {
    const member = this.#crew[index];
    if (!member || member.flatlined) return;
    // Update selection to clicked row.
    this.#selectedIndex = index;
    this.#syncCurrent();
    this.#emitSelect();
  }

  #emitSelect() {
    const member = this.#crew[this.#selectedIndex];
    if (member) {
      this.dispatchEvent(new CustomEvent('select', { detail: { member } }));
    }
  }

  #syncCurrent() {
    for (let i = 0; i < this.#buttons.length; i++) {
      this.#buttons[i].setAttribute('aria-current', i === this.#selectedIndex ? 'true' : 'false');
    }
  }
}

customElements.define('crew-list', CrewList);

export default CrewList;
