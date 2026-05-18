/**
 * <initial-recruit> — Full-screen overlay for campaign-start crew selection.
 * Presents 3 randomly-generated candidates; the player picks 2 of 3.
 *
 * Usage:
 *   recruitEl.setCandidates(candidates);   // array of 3 Crew instances
 *   recruitEl.show();
 *   recruitEl.addEventListener('recruited', evt => {
 *     const { memberIds } = evt.detail;    // string[] of 2 chosen IDs
 *   });
 *
 * Keyboard: ←/→ or A/D to navigate, Enter/Space to toggle selection,
 * Enter on CONFIRM when 2 selected.
 */

import { h } from '/src/domUtils.js';
import { ARCHETYPES } from '/src/game/archetypes/index.js';
import type { Crew as CrewMember } from '/src/game/Crew.js';

const PICKS_REQUIRED = 2;

const CSS = `
:host {
  --ir-bg: rgba(7, 18, 16, 0.96);
  --ir-border: var(--accent-color, #00d9a5);
  --ir-text: #c5efdf;
  --ir-dim: #6ae8c8;
  --ir-accent: var(--accent-color, #00d9a5);
  --ir-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);
  --ir-selected-bg: rgba(0, 217, 165, 0.18);
  --ir-selected-border: var(--accent-color, #00d9a5);
  --ir-hover-bg: rgba(0, 217, 165, 0.08);

  display: none;
  position: fixed;
  inset: 0;
  z-index: 55;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ir-text);
}

:host([open]) {
  display: flex;
}

.panel {
  background: var(--ir-bg);
  border: 1px solid var(--ir-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.5rem;
  box-shadow: var(--ir-shadow);
  min-width: min(520px, 92vw);
  max-width: min(680px, 96vw);
}

.title {
  margin: 0 0 0.4rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--ir-accent);
  border-bottom: 1px dashed var(--ir-border);
  padding-bottom: 0.5rem;
}

.subtitle {
  margin: 0 0 1rem;
  text-align: center;
  font-size: 0.85rem;
  color: var(--ir-dim);
  line-height: 1.45;
}

.candidates {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.6rem;
  margin-bottom: 1rem;
}

@media (max-width: 520px) {
  .candidates {
    grid-template-columns: 1fr;
  }
}

button.card {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--ir-text);
  border: 1px solid rgba(106, 232, 200, 0.25);
  border-radius: 6px;
  padding: 0.8rem 0.7rem;
  text-align: center;
  font: inherit;
  cursor: pointer;
  min-height: 110px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  transition: border-color 0.12s ease, background 0.12s ease;
}

button.card:hover:not([aria-pressed='true']) {
  background: var(--ir-hover-bg);
}

button.card:focus-visible {
  outline: 2px solid var(--ir-accent);
  outline-offset: 2px;
}

button.card[aria-pressed='true'] {
  border-color: var(--ir-selected-border);
  background: var(--ir-selected-bg);
}

.card-callsign {
  color: var(--ir-accent);
  font-weight: 700;
  font-size: 1.05rem;
  letter-spacing: 0.12em;
}

.card-archetype {
  color: var(--ir-dim);
  font-size: 0.85rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.card-stats {
  color: var(--ir-dim);
  font-size: 0.82rem;
  margin-top: 0.15rem;
}

.card-blurb {
  color: var(--ir-dim);
  font-size: 0.78rem;
  line-height: 1.4;
  margin-top: 0.3rem;
  opacity: 0.8;
}

.card-check {
  font-size: 0.9rem;
  color: var(--ir-accent);
  margin-top: 0.25rem;
  height: 1.2em;
}

.counter {
  text-align: center;
  font-size: 0.88rem;
  color: var(--ir-dim);
  letter-spacing: 0.1em;
  margin-bottom: 0.75rem;
}

.counter .filled {
  color: var(--ir-accent);
}

.actions {
  display: flex;
  justify-content: center;
}

button.confirm {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--ir-accent);
  border: 1px solid var(--ir-accent);
  padding: 0.55em 2em;
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  letter-spacing: 0.14em;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  min-height: 44px;
}

button.confirm:hover:not(:disabled),
button.confirm:focus-visible:not(:disabled) {
  background: var(--ir-accent);
  color: #020403;
  outline: none;
}

button.confirm:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.hint {
  text-align: center;
  font-size: 0.82rem;
  color: var(--ir-dim);
  letter-spacing: 0.08em;
  margin: 0.75rem 0 0;
}
`;

class InitialRecruit extends HTMLElement {
  #ready = false;
  #candidates: CrewMember[] = [];
  #selected: Set<string> = new Set();
  #focusIndex = 0;
  #cardButtons: HTMLButtonElement[] = [];
  #candidatesEl: HTMLElement | null = null;
  #counterEl: HTMLElement | null = null;
  #confirmBtn: HTMLButtonElement | null = null;
  #onKeyDown: ((this: HTMLElement, ev: KeyboardEvent) => void) | null = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#candidatesEl = h('div', { className: 'candidates' });
    this.#counterEl = h('p', { className: 'counter' });
    this.#confirmBtn = h('button', {
      type: 'button',
      className: 'confirm',
      textContent: '[ CONFIRM CREW ]',
      disabled: true,
    }) as HTMLButtonElement;
    this.#confirmBtn.addEventListener('click', () => this.#commit());

    const panel = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: '── RECRUITMENT ──' }),
      h('p', {
        className: 'subtitle',
        textContent:
          'CURATOR — Pick two operatives for your crew. ' +
          'Choose wisely; the third walks.',
      }),
      this.#candidatesEl,
      this.#counterEl,
      h('div', { className: 'actions' }, [this.#confirmBtn]),
      h('p', {
        className: 'hint',
        textContent: '[ ←/→ navigate  ·  Enter/Space select  ·  Enter confirm ]',
      }),
    ]);
    shadow.appendChild(panel);

    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);

    this.#ready = true;
  }

  setCandidates(candidates: CrewMember[]) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new TypeError('<initial-recruit>.setCandidates requires a non-empty array');
    }
    this.#candidates = candidates;
    this.#selected = new Set();
    this.#focusIndex = 0;
    this.#render();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
      if (this.#cardButtons[0]) this.#cardButtons[0].focus();
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
  }

  #render() {
    if (!this.#candidatesEl) return;
    while (this.#candidatesEl.firstChild) {
      this.#candidatesEl.removeChild(this.#candidatesEl.firstChild);
    }
    this.#cardButtons = [];

    for (let i = 0; i < this.#candidates.length; i++) {
      const c = this.#candidates[i];
      const isSelected = this.#selected.has(c.id);
      const card = h('button', {
        type: 'button',
        className: 'card',
        ariaPressed: isSelected ? 'true' : 'false',
      }) as HTMLButtonElement;
      card.dataset.index = String(i);
      card.addEventListener('click', () => this.#toggle(i));
      const archetypeName = (c.constructor?.name ?? c.archetype ?? 'Crew').toLowerCase();
      const info = ARCHETYPES[archetypeName as keyof typeof ARCHETYPES];
      card.append(
        h('span', { className: 'card-callsign', textContent: c.callsign ?? c.id }),
        h('span', {
          className: 'card-archetype',
          textContent: (info?.name ?? archetypeName.toUpperCase()),
        }),
        h('span', {
          className: 'card-stats',
          textContent: `HP ${c.hp}/${c.maxHp}  ·  AIM ${((c.baseHitChance ?? 0.65) * 100).toFixed(0)}%`,
        }),
        h('span', {
          className: 'card-blurb',
          textContent: info?.blurb ?? '',
        }),
        h('span', {
          className: 'card-check',
          textContent: isSelected ? '✓ SELECTED' : '',
        })
      );
      this.#candidatesEl.appendChild(card);
      this.#cardButtons.push(card);
    }
    this.#updateCounter();
  }

  #toggle(index: number) {
    const c = this.#candidates[index];
    if (!c) return;
    if (this.#selected.has(c.id)) {
      this.#selected.delete(c.id);
    } else if (this.#selected.size < PICKS_REQUIRED) {
      this.#selected.add(c.id);
    }
    // Update cards without full re-render.
    for (let i = 0; i < this.#candidates.length; i++) {
      const btn = this.#cardButtons[i];
      const sel = this.#selected.has(this.#candidates[i].id);
      btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
      const checkEl = btn.querySelector('.card-check');
      if (checkEl) checkEl.textContent = sel ? '✓ SELECTED' : '';
    }
    this.#focusIndex = index;
    this.#cardButtons[index]?.focus();
    this.#updateCounter();
  }

  #updateCounter() {
    if (!this.#counterEl || !this.#confirmBtn) return;
    const count = this.#selected.size;
    this.#counterEl.innerHTML = '';
    this.#counterEl.appendChild(
      h('span', {
        className: count === PICKS_REQUIRED ? 'filled' : '',
        textContent: `${count}/${PICKS_REQUIRED} SELECTED`,
      })
    );
    this.#confirmBtn.disabled = count !== PICKS_REQUIRED;
  }

  #handleKey(evt: KeyboardEvent) {
    if (!this.isOpen) return;
    const { key } = evt;
    if (key === 'ArrowRight' || key.toLowerCase() === 'd') {
      evt.preventDefault();
      this.#moveFocus(1);
      return;
    }
    if (key === 'ArrowLeft' || key.toLowerCase() === 'a') {
      evt.preventDefault();
      this.#moveFocus(-1);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      evt.preventDefault();
      // If confirm button is focused and enabled, commit.
      if (
        this.shadowRoot?.activeElement === this.#confirmBtn &&
        !this.#confirmBtn!.disabled
      ) {
        this.#commit();
        return;
      }
      // Otherwise toggle the focused card.
      this.#toggle(this.#focusIndex);
      return;
    }
  }

  #moveFocus(delta: number) {
    const len = this.#cardButtons.length;
    if (len === 0) return;
    this.#focusIndex = (this.#focusIndex + delta + len) % len;
    this.#cardButtons[this.#focusIndex]?.focus();
  }

  #commit() {
    if (this.#selected.size !== PICKS_REQUIRED) return;
    this.dispatchEvent(
      new CustomEvent('recruited', {
        detail: { memberIds: [...this.#selected] },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define('initial-recruit', InitialRecruit);

export default InitialRecruit;
