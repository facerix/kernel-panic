/**
 * <crew-roster> — modal roster for viewing crew or choosing who deploys.
 *
 * Mode:
 *   - view: Terminal roster readout; rows are informational.
 *   - deploy: Curator job flow; Enter/click on a living row emits
 *     `deploy` with `{ memberId }`.
 */

import { h } from '/src/domUtils.js';

const CSS = `
:host {
  --roster-bg: rgba(7, 18, 16, 0.96);
  --roster-border: var(--accent-color, #00d9a5);
  --roster-text: #c5efdf;
  --roster-dim: #6ae8c8;
  --roster-accent: var(--accent-color, #00d9a5);
  --roster-danger: #ff5d73;
  --roster-row-hover: rgba(0, 217, 165, 0.08);
  --roster-row-active: rgba(0, 217, 165, 0.18);
  --roster-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  position: fixed;
  inset: 0;
  z-index: 50;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--roster-text);
}

:host([open]) {
  display: flex;
}

.panel {
  background: var(--roster-bg);
  border: 1px solid var(--roster-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.4rem;
  box-shadow: var(--roster-shadow);
  min-width: min(460px, 92vw);
  max-width: min(640px, 96vw);
}

.title {
  margin: 0 0 0.75rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--roster-accent);
  border-bottom: 1px dashed var(--roster-border);
  padding-bottom: 0.5rem;
}

.balance {
  margin: 0 0 0.75rem;
  text-align: center;
  color: var(--roster-dim);
  font-size: 0.9rem;
  letter-spacing: 0.08em;
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
  color: var(--roster-text);
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
  background: var(--roster-row-hover);
}

button.row:focus-visible,
button.row[aria-current='true'] {
  outline: none;
  border-color: var(--roster-accent);
  background: var(--roster-row-active);
}

.cursor {
  color: var(--roster-accent);
  font-weight: 700;
  visibility: hidden;
}

button.row:focus-visible .cursor,
button.row[aria-current='true'] .cursor {
  visibility: visible;
}

.name {
  color: var(--roster-accent);
  font-weight: 700;
  letter-spacing: 0.1em;
  overflow-wrap: anywhere;
}

.meta {
  color: var(--roster-dim);
  font-size: 0.88rem;
  grid-column: 2 / span 2;
}

.flag {
  color: var(--roster-danger);
  font-size: 0.82rem;
  letter-spacing: 0.1em;
}

.hint {
  text-align: center;
  font-size: 0.85rem;
  color: var(--roster-dim);
  letter-spacing: 0.1em;
  margin: 0.9rem 0 0;
}
`;

class CrewRoster extends HTMLElement {
  #crew = [];
  #mode = 'view';
  #salvage = 0;
  #ready = false;
  #rowsEl = null;
  #titleEl = null;
  #balanceEl = null;
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
    this.#balanceEl = h('p', { className: 'balance' });
    this.#rowsEl = h('div', { className: 'rows' });
    this.#hintEl = h('p', { className: 'hint' });
    const panel = h('section', { className: 'panel' }, [
      this.#titleEl,
      this.#balanceEl,
      this.#rowsEl,
      this.#hintEl,
    ]);
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

  setCrew(crew, { mode = 'view', salvage = 0 } = {}) {
    if (!Array.isArray(crew)) {
      throw new TypeError('<crew-roster>.setCrew requires an array');
    }
    if (mode !== 'view' && mode !== 'deploy') {
      throw new Error(`<crew-roster>.setCrew unknown mode "${mode}"`);
    }
    this.#crew = crew.map(member => ({
      id: member.id,
      callsign: member.callsign ?? member.id,
      archetype: member.constructor?.name ?? member.archetype ?? 'Crew',
      hp: member.hp,
      maxHp: member.maxHp,
      flatlined: !!member.flatlined,
    }));
    this.#mode = mode;
    this.#salvage = salvage;
    this.#selectedIndex = Math.max(
      0,
      this.#crew.findIndex(member => !member.flatlined)
    );
    if (this.#ready) this.#render();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
      const focused = this.#focusSelected();
      if (!focused) this.focus();
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
    this.#titleEl.textContent = this.#mode === 'deploy' ? '── DEPLOY CREW ──' : '── CREW ROSTER ──';
    this.#balanceEl.textContent = `SALVAGE ${this.#salvage}`;
    this.#hintEl.textContent =
      this.#mode === 'deploy' ? '[ ENTER deploy  ·  Esc dismiss ]' : '[ Esc dismiss ]';

    while (this.#rowsEl.firstChild) this.#rowsEl.removeChild(this.#rowsEl.firstChild);
    this.#buttons = [];

    for (let i = 0; i < this.#crew.length; i++) {
      const member = this.#crew[i];
      const disabled = member.flatlined || this.#mode === 'view';
      const row = h('button', {
        type: 'button',
        className: 'row',
        disabled,
        ariaCurrent: i === this.#selectedIndex ? 'true' : 'false',
      });
      row.dataset.index = String(i);
      row.addEventListener('click', () => this.#activate(i));
      row.append(
        h('span', { className: 'cursor', textContent: '>' }),
        h('span', { className: 'name', textContent: member.callsign }),
        h('span', {
          className: 'flag',
          textContent: member.flatlined ? 'FLATLINED' : this.#mode === 'deploy' ? 'READY' : '',
        }),
        h('span', {
          className: 'meta',
          textContent: `${member.archetype.toUpperCase()}  HP ${member.hp}/${member.maxHp}`,
        })
      );
      this.#rowsEl.appendChild(row);
      this.#buttons.push(row);
    }
  }

  #handleKey(evt) {
    if (!this.isOpen) return;
    evt.stopPropagation();
    if (evt.key === 'Escape') {
      evt.preventDefault();
      this.#emit('dismiss');
      return;
    }
    if (evt.key === 'ArrowDown' || evt.key.toLowerCase() === 's') {
      evt.preventDefault();
      this.#move(1);
      return;
    }
    if (evt.key === 'ArrowUp' || evt.key.toLowerCase() === 'w') {
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
    if (this.#crew.length === 0) return;
    let next = this.#selectedIndex;
    for (let i = 0; i < this.#crew.length; i++) {
      next = (next + delta + this.#crew.length) % this.#crew.length;
      if (this.#mode === 'view' || !this.#crew[next].flatlined) break;
    }
    this.#selectedIndex = next;
    this.#syncCurrent();
    this.#focusSelected();
  }

  #activate(index) {
    const member = this.#crew[index];
    if (!member || this.#mode !== 'deploy' || member.flatlined) return;
    this.#emit('deploy', { memberId: member.id });
  }

  #syncCurrent() {
    for (let i = 0; i < this.#buttons.length; i++) {
      this.#buttons[i].setAttribute('aria-current', i === this.#selectedIndex ? 'true' : 'false');
    }
  }

  #focusSelected() {
    const button = this.#buttons[this.#selectedIndex];
    if (!button || button.disabled) return false;
    button.focus();
    return true;
  }

  #emit(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

customElements.define('crew-roster', CrewRoster);

export default CrewRoster;
