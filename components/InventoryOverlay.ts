/**
 * <inventory-overlay> base — shared chrome for the two inventory surfaces:
 *
 *   - `<combat-inventory>`: the deployed operator's live, *interactive* kit —
 *     job-scoped salvage, held keycards, and a navigable consumables list.
 *   - `<crew-inventory>`: the Hub's *read-only* campaign stash — accumulated
 *     salvage and the STOLEN KEYCARDS trophy shelf. No consumables (those are
 *     operator-held, not a shared pool) and nothing to activate.
 *
 * The two diverged enough (interactivity, which sections exist) to be separate
 * elements, but share the overlay chrome, the SALVAGE table, and the keycard
 * list. That shared surface lives here; subclasses fill in `renderBody`,
 * `panelTitle`, `hintText`, and (optionally) extra key handling.
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
import type { KeyItemView } from '/src/shell/domTypes.js';

/**
 * Human-readable labels for typed-salvage buckets. Matches the P2.5.M4.2 docs:
 * Scrap = mechanical, Chips = electronics, Bio = organic, Data = informational.
 */
export const SALVAGE_LABELS: Record<SalvageType, string> = {
  scrap: 'Scrap',
  chips: 'Chips',
  bio: 'Bio',
  data: 'Data',
};

/** Shared overlay + SALVAGE + keycard styling. Interactive-list CSS is layered on by the combat surface. */
export const INVENTORY_CSS = `
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

.hint {
  text-align: center;
  font-size: 0.85rem;
  color: var(--inv-dim);
  letter-spacing: 0.1em;
  margin: 0.9rem 0 0;
}
`;

/**
 * Shared overlay behaviour. Not registered as a custom element itself —
 * `<combat-inventory>` and `<crew-inventory>` extend it.
 */
export abstract class InventoryOverlay extends HTMLElement {
  protected salvage: TypedSalvage = emptySalvage();
  protected keyItems: KeyItemView[] = [];
  #ready = false;
  protected titleEl!: HTMLElement;
  protected bodyEl!: HTMLElement;
  protected hintEl!: HTMLElement;
  #panelEl: HTMLElement | null = null;
  #onKeyDown: ((ev: KeyboardEvent) => void) | null = null;
  #onBackdrop: ((ev: PointerEvent) => void) | null = null;

  /** Full stylesheet for the shadow root. Subclasses append their own rules. */
  protected styleText(): string {
    return INVENTORY_CSS;
  }

  /** Centered panel title, e.g. `── INVENTORY ──`. */
  protected abstract panelTitle(): string;

  /** Append the surface-specific sections into `bodyEl` (already cleared). */
  protected abstract renderBody(): void;

  /** Footer hint copy. */
  protected abstract hintText(): string;

  /** Focus management once the overlay opens. Defaults to focusing the host. */
  protected onShown(): void {
    this.focus();
  }

  /** Subclass key handling beyond Escape. Return true when the key was consumed. */
  protected handleExtraKey(_evt: KeyboardEvent): boolean {
    return false;
  }

  /** Whether the shadow chrome has been built (guards early setContents calls). */
  protected get ready(): boolean {
    return this.#ready;
  }

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = this.styleText();
    shadow.appendChild(style);

    this.titleEl = h('h2', { className: 'title' });
    // Single body container; `renderBody` writes each section into it so the
    // layout adapts to empty / full states without juggling element refs.
    this.bodyEl = h('div', { className: 'body' });
    this.hintEl = h('p', { className: 'hint' });
    this.#panelEl = h('section', { className: 'panel' }, [this.titleEl, this.bodyEl, this.hintEl]);
    shadow.appendChild(this.#panelEl);

    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);
    this.#onBackdrop = evt => {
      if (!evt.composedPath().includes(this.#panelEl as EventTarget)) this.emit('dismiss');
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    this.render();
  }

  protected render() {
    if (!this.#ready) return;
    this.titleEl.textContent = this.panelTitle();
    while (this.bodyEl.firstChild) this.bodyEl.removeChild(this.bodyEl.firstChild);
    this.renderBody();
    this.hintEl.textContent = this.hintText();
  }

  /**
   * SALVAGE section — always rendered so the chrome stays consistent across
   * empty / full states. Zero-count rows are dimmed (not hidden) so the player
   * can see *which* bucket they're missing without parsing absence.
   */
  protected renderSalvageSection() {
    this.bodyEl.appendChild(h('p', { className: 'section-label', textContent: 'SALVAGE' }));
    const rows = h('div', { className: 'salvage-rows' });
    for (const t of SALVAGE_TYPES) {
      const count = this.salvage[t];
      const row = h('div', { className: count > 0 ? 'salvage-row' : 'salvage-row zero' });
      row.append(
        h('span', { className: 'bucket-name', textContent: SALVAGE_LABELS[t] }),
        h('span', { className: 'bucket-count', textContent: String(count) })
      );
      rows.appendChild(row);
    }
    this.bodyEl.appendChild(rows);
  }

  /**
   * Keycard section — absence-hidden (an empty section would be noise for the
   * majority of runs without locked doors). `title` and the per-row `labelOf`
   * differ by surface: combat shows the generic card, the Hub shows locations.
   */
  protected renderKeycardSection(title: string, labelOf: (ki: KeyItemView) => string) {
    if (this.keyItems.length === 0) return;
    this.bodyEl.appendChild(h('p', { className: 'section-label', textContent: title }));
    const rows = h('div', { className: 'key-item-rows' });
    for (const ki of this.keyItems) {
      const row = h('div', { className: 'key-item-row' });
      row.append(
        h('span', { className: 'key-glyph', textContent: KEYCARD_GLYPH }),
        h('span', { className: 'key-label', textContent: labelOf(ki) })
      );
      rows.appendChild(row);
    }
    this.bodyEl.appendChild(rows);
  }

  protected get salvageIsEmpty(): boolean {
    return totalSalvage(this.salvage) === 0;
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => this.onShown());
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

  #handleKey(evt: KeyboardEvent) {
    if (!this.isOpen) return;
    evt.stopPropagation();
    if (evt.key === 'Escape') {
      evt.preventDefault();
      this.emit('dismiss');
      return;
    }
    this.handleExtraKey(evt);
  }

  protected emit(eventName: string, detail: object = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}
