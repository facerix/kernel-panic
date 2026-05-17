/**
 * <character-select> — modal overlay for picking the run's archetype.
 *
 *   ┌─────── SELECT OPERATOR ───────┐
 *   │ > MERC                        │
 *   │     ranged specialist         │
 *   │     perk: VAULT (v) — hop     │
 *   │           cover & fire        │
 *   │                               │
 *   │   RAZOR                       │
 *   │     stealth / melee           │
 *   │     perk: SLIDE (t) — silent  │
 *   │           dash                │
 *   │                               │
 *   │   [ ENTER to confirm  Esc ]   │
 *   └───────────────────────────────┘
 *
 * Usage:
 *   const select = document.querySelector('character-select');
 *   select.setArchetypes(ARCHETYPE_IDS.map(id => ARCHETYPES[id]));
 *   select.setCurrent('merc');             // highlight the prefs/default
 *   select.addEventListener('pick', evt => { … evt.detail.archetypeId … });
 *   select.addEventListener('dismiss', () => …);
 *   select.show();
 *
 * Keyboard:
 *   - ↑/↓ (and W/S) move the highlight
 *   - Enter / Space confirm
 *   - Esc dismisses (leaves the current archetype unchanged)
 *
 * Shadow-DOM scoped, same convention as <run-briefing> / <crash-dump>;
 * per the M8b plan the component itself is verified visually via the shell.
 */

import { h } from '/src/domUtils.js';
import type { ArchetypeInfo } from '/src/game/archetypes/index.js';

type ArchetypeStub = Omit<ArchetypeInfo, 'perks' | 'perkKey'>;

const CSS = `
:host {
  --select-bg: rgba(7, 18, 16, 0.96);
  --select-border: var(--accent-color, #00d9a5);
  --select-text: #c5efdf;
  --select-dim: #6ae8c8;
  --select-accent: var(--accent-color, #00d9a5);
  --select-row-hover: rgba(0, 217, 165, 0.08);
  --select-row-active: rgba(0, 217, 165, 0.18);
  --select-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  position: fixed;
  inset: 0;
  z-index: 50;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--select-text);
}

:host([open]) {
  display: flex;
}

.panel {
  background: var(--select-bg);
  border: 1px solid var(--select-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.4rem;
  box-shadow: var(--select-shadow);
  min-width: min(420px, 92vw);
  max-width: min(560px, 96vw);
}

.title {
  margin: 0 0 0.75rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--select-accent);
  border-bottom: 1px dashed var(--select-border);
  padding-bottom: 0.5rem;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.5rem 0 1rem;
}

button.option {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--select-text);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0.55em 0.8em;
  text-align: left;
  font: inherit;
  letter-spacing: 0.04em;
  cursor: pointer;
  min-height: 44px;
  display: grid;
  grid-template-columns: 1.3em 1fr;
  align-items: start;
  column-gap: 0.5em;
  row-gap: 0.15em;
  transition: background 0.12s ease, border-color 0.12s ease;
}

button.option:hover {
  background: var(--select-row-hover);
}

button.option:focus-visible,
button.option[aria-current='true'] {
  outline: none;
  border-color: var(--select-accent);
  background: var(--select-row-active);
}

.cursor {
  color: var(--select-accent);
  font-weight: 700;
  visibility: hidden;
  grid-row: 1;
  grid-column: 1;
}

button.option:focus-visible .cursor,
button.option[aria-current='true'] .cursor {
  visibility: visible;
}

.name {
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--select-accent);
  grid-row: 1;
  grid-column: 2;
}

.blurb,
.perk {
  font-size: 0.9rem;
  color: var(--select-text);
  grid-column: 2;
}

.perk {
  color: var(--select-dim);
}

.hint {
  text-align: center;
  font-size: 0.85rem;
  color: var(--select-dim);
  letter-spacing: 0.1em;
  margin-top: 0.25rem;
}
`;

class CharacterSelect extends HTMLElement {
  #archetypes: ArchetypeStub[] = [];
  #current: string | null = null;
  #ready = false;
  #optionsEl: HTMLElement | null = null;
  #panelEl: HTMLElement | null = null;
  #buttons: Map<string, HTMLElement> = new Map();
  #onKeyDown: ((this: HTMLElement, ev: KeyboardEvent) => void) | null = null;
  #onBackdrop: ((this: HTMLElement, ev: PointerEvent) => void) | null = null;

  connectedCallback() {
    if (this.#ready) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#optionsEl = h('div', { className: 'options' });

    this.#panelEl = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: '── SELECT OPERATOR ──' }),
      this.#optionsEl,
      h('p', { className: 'hint', textContent: '[ ENTER confirm  ·  Esc dismiss ]' }),
    ]) as HTMLElement;
    shadow.appendChild(this.#panelEl);

    // The keydown listener lives on the host so arrow nav works even when the
    // focus has drifted between option buttons. Backdrop click also dismisses
    // — same affordance as <confirmation-modal>'s native dialog backdrop.
    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);

    this.#onBackdrop = evt => {
      if (!evt.composedPath().includes(this.#panelEl as EventTarget)) this.#emit('dismiss');
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    if (this.#archetypes.length > 0) this.#render();
  }

  /**
   * Provide the list of archetypes (in display order). Each item: { id, name,
   * blurb, perkLabel }. Stored even when disconnected so the shell can call
   * setArchetypes + setCurrent in any order pre-show().
   */
  setArchetypes(list: ArchetypeInfo[]) {
    if (!Array.isArray(list) || list.length === 0) {
      throw new TypeError('<character-select>.setArchetypes requires a non-empty array');
    }
    this.#archetypes = list.map(a => ({
      id: a.id,
      name: a.name ?? '???',
      blurb: a.blurb ?? '',
      perkLabel: a.perkLabel ?? '',
    }));
    if (this.#ready) this.#render();
  }

  /**
   * Mark `id` as the highlighted/default archetype. The first show() after a
   * setCurrent will move focus to that button; on Enter it becomes the pick.
   */
  setCurrent(id: string | null) {
    this.#current = id ?? null;
    if (this.#ready) this.#syncCurrent();
  }

  show() {
    this.setAttribute('open', '');
    // Move focus to the current archetype (or the first one) so Enter resolves
    // a pick. queueMicrotask lets the open attribute apply before focus.
    queueMicrotask(() => {
      const target = (this.#current && this.#buttons.get(this.#current)) || this.#firstButton();
      target?.focus();
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

  // ---- internal ---------------------------------------------------------

  #render() {
    if (!this.#optionsEl) return;
    while (this.#optionsEl.firstChild) this.#optionsEl.removeChild(this.#optionsEl.firstChild);
    this.#buttons.clear();

    for (const a of this.#archetypes) {
      const btn = h('button', {
        type: 'button',
        className: 'option',
        // data-* via JS API per AGENTS.md guidance (h() doesn't take dataset).
      });
      btn.dataset.archetypeId = a.id;
      btn.appendChild(h('span', { className: 'cursor', textContent: '>' }));
      btn.appendChild(h('span', { className: 'name', textContent: a.name }));
      if (a.blurb) btn.appendChild(h('span', { className: 'blurb', textContent: a.blurb }));
      if (a.perkLabel)
        btn.appendChild(h('span', { className: 'perk', textContent: `perk: ${a.perkLabel}` }));
      btn.addEventListener('click', () => this.#confirm(a.id));
      this.#optionsEl.appendChild(btn);
      this.#buttons.set(a.id, btn);
    }
    this.#syncCurrent();
  }

  #syncCurrent() {
    for (const [id, btn] of this.#buttons) {
      if (id === this.#current) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    }
  }

  #handleKey(evt: KeyboardEvent) {
    if (!this.isOpen) return;
    const key = evt.key;
    if (key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      this.#emit('dismiss');
      return;
    }
    if (key === 'Enter' || key === ' ') {
      const focused = this.shadowRoot?.activeElement;
      const id = (focused as HTMLElement)?.dataset?.archetypeId;
      if (id) {
        evt.preventDefault();
        evt.stopPropagation();
        this.#confirm(id);
      }
      return;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
      evt.preventDefault();
      evt.stopPropagation();
      this.#moveFocus(1);
      return;
    }
    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
      evt.preventDefault();
      evt.stopPropagation();
      this.#moveFocus(-1);
      return;
    }
  }

  #moveFocus(delta: number) {
    const ids: string[] = this.#archetypes.map(a => a.id);
    if (ids.length === 0) return;
    const focused = (this.shadowRoot?.activeElement as HTMLElement)?.dataset?.archetypeId;
    const idx = focused ? ids.indexOf(focused) : ids.indexOf(this.#current ?? '');
    const safeIdx = idx === -1 ? 0 : idx;
    const next = (safeIdx + delta + ids.length) % ids.length;
    this.#buttons.get(ids[next])?.focus();
  }

  #firstButton() {
    const first = this.#archetypes[0];
    return first ? this.#buttons.get(first.id) : null;
  }

  #confirm(archetypeId: string) {
    this.#emit('pick', { archetypeId });
  }

  #emit(eventName: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail: { ...detail },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define('character-select', CharacterSelect);

export default CharacterSelect;
