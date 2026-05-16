/**
 * <crew-roster> — Terminal crew readout. Two-pane modal: <crew-list> on the
 * left, detail pane on the right showing the selected member's stats, gear,
 * and consumables.
 *
 * View-only — no deploy mode. The Curator's deploy flow lives in
 * <run-briefing>, which embeds its own <crew-list>.
 *
 * Usage:
 *   rosterEl.setCrew(campaign.crew, { salvage: campaign.salvage });
 *   rosterEl.show();
 */

import { h } from '/src/domUtils.js';
import '/components/CrewList.js';

/** Human-readable labels for item IDs (mirrors ItemInventory). */
const ITEM_LABELS = {
  stim: 'Stim',
  'smoke-charge': 'Smoke Charge',
};

/** Human-readable labels for gear bonuses. */
function gearLines(gear) {
  if (!gear) return [];
  const lines = [];
  if (gear.maxHpBonus > 0) lines.push(`Armour Plating  +${gear.maxHpBonus} HP`);
  if (gear.hitBonus > 0) lines.push(`Targeting Chip  +${(gear.hitBonus * 100).toFixed(0)}%`);
  return lines;
}

/** Aggregate consumables into "Label x2" lines. */
function consumableLines(consumables) {
  if (!consumables || consumables.length === 0) return [];
  const counts = new Map();
  for (const c of consumables) {
    counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  }
  const lines = [];
  for (const [id, count] of counts) {
    const label = ITEM_LABELS[id] ?? id;
    lines.push(count > 1 ? `${label} x${count}` : label);
  }
  return lines;
}

const CSS = `
:host {
  --roster-bg: rgba(7, 18, 16, 0.96);
  --roster-border: var(--accent-color, #00d9a5);
  --roster-text: #c5efdf;
  --roster-dim: #6ae8c8;
  --roster-accent: var(--accent-color, #00d9a5);
  --roster-danger: #ff5d73;
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
  min-width: min(560px, 92vw);
  max-width: min(760px, 96vw);
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

.body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}

/* Pass CSS custom properties down into the <crew-list> shadow. */
crew-list {
  --cl-text: var(--roster-text);
  --cl-accent: var(--roster-accent);
  --cl-dim: var(--roster-dim);
  --cl-danger: var(--roster-danger);
  --cl-row-hover: rgba(0, 217, 165, 0.08);
  --cl-row-active: rgba(0, 217, 165, 0.18);
}

.detail {
  border-left: 1px dashed var(--roster-border);
  padding-left: 1rem;
  min-height: 120px;
}

.detail-header {
  display: flex;
  align-items: baseline;
  gap: 0.15rem;
  margin: 0 0 0.5rem;
}

.detail-name {
  color: var(--roster-accent);
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.12em;
}

.detail-class {
  color: var(--roster-dim);
  font-size: 0.88rem;
  letter-spacing: 0.08em;
}

.detail-section {
  margin: 0.5rem 0 0;
  font-size: 0.88rem;
  color: var(--roster-dim);
  letter-spacing: 0.06em;
}

.detail-section-title {
  color: var(--roster-accent);
  font-size: 0.82rem;
  letter-spacing: 0.12em;
  margin-bottom: 0.15rem;
}

.detail-stat {
  color: var(--roster-text);
  margin: 0.1rem 0;
}

.detail-none {
  color: var(--roster-dim);
  font-style: italic;
}

.flatlined-label {
  color: var(--roster-danger);
  letter-spacing: 0.1em;
  font-size: 0.9rem;
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
  #crewRaw = []; // original crew references (for detail data)
  #salvage = 0;
  #ready = false;
  #listEl = null;
  #detailEl = null;
  #titleEl = null;
  #balanceEl = null;
  #hintEl = null;
  #panelEl = null;
  #onKeyDown = null;
  #onBackdrop = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#titleEl = h('h2', { className: 'title', textContent: '── CREW ROSTER ──' });
    this.#balanceEl = h('p', { className: 'balance' });

    this.#listEl = document.createElement('crew-list');
    this.#listEl.addEventListener('select', evt => this.#onSelect(evt.detail.member));

    this.#detailEl = h('div', { className: 'detail' });

    const body = h('div', { className: 'body' }, [this.#listEl, this.#detailEl]);
    this.#hintEl = h('p', { className: 'hint', textContent: '[ ↑/↓ navigate  ·  Esc dismiss ]' });
    this.#panelEl = h('section', { className: 'panel' }, [
      this.#titleEl,
      this.#balanceEl,
      body,
      this.#hintEl,
    ]);
    shadow.appendChild(this.#panelEl);

    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);
    this.#onBackdrop = evt => {
      // Clicks inside nested shadow trees (e.g. <crew-list> rows) retarget
      // `event.target` to this host, so `target === this` is not a safe
      // backdrop test — use the real event path instead.
      if (evt.composedPath().includes(this.#panelEl)) return;
      this.dispatchEvent(new CustomEvent('dismiss'));
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
  }

  /**
   * @param {Array} crew — array of Crew instances (or snapshot objects).
   * @param {{ salvage?: number }} options
   */
  setCrew(crew, { salvage = 0 } = {}) {
    if (!Array.isArray(crew)) {
      throw new TypeError('<crew-roster>.setCrew requires an array');
    }
    this.#crewRaw = crew;
    this.#salvage = salvage;
    this.#balanceEl.textContent = `SALVAGE ${this.#salvage}`;
    // Crew list handles its own rendering; selection triggers detail update.
    this.#listEl.setCrew(crew);
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
      // Focus the list so arrow keys work immediately.
      if (!this.#listEl.focusSelected()) this.focus();
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

  #handleKey(evt) {
    if (!this.isOpen) return;
    if (evt.key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      this.dispatchEvent(new CustomEvent('dismiss'));
    }
    // Arrow/WASD nav is handled by <crew-list> internally.
  }

  /**
   * Update the detail pane when the crew list selection changes.
   * @param {{ id: string, callsign: string, archetype: string, hp: number, maxHp: number, flatlined: boolean }} member
   */
  #onSelect(member) {
    // Find the full crew object to read gear/inventory.
    const full = this.#crewRaw.find(m => (m.id ?? m.callsign) === member.id) ?? member;

    while (this.#detailEl.firstChild) this.#detailEl.removeChild(this.#detailEl.firstChild);

    // Name + class header
    this.#detailEl.appendChild(
      h('p', { className: 'detail-header' }, [
        h('span', { className: 'detail-name', textContent: member.callsign }),
        h('span', {
          className: 'detail-class',
          textContent: ` [${member.archetype.toUpperCase()}]`,
        }),
      ])
    );

    if (member.flatlined) {
      this.#detailEl.appendChild(
        h('p', { className: 'flatlined-label', textContent: '[ FLATLINED ]' })
      );
      return;
    }

    // Stats
    const statsSection = h('div', { className: 'detail-section' });
    statsSection.appendChild(h('p', { className: 'detail-section-title', textContent: 'STATS' }));
    statsSection.appendChild(
      h('p', { className: 'detail-stat', textContent: `HP  ${member.hp}/${member.maxHp}` })
    );
    if (full.gear?.hitBonus > 0) {
      statsSection.appendChild(
        h('p', {
          className: 'detail-stat',
          textContent: `HIT  +${(full.gear.hitBonus * 100).toFixed(0)}%`,
        })
      );
    }
    this.#detailEl.appendChild(statsSection);

    // Gear
    const gLines = gearLines(full.gear);
    const gearSection = h('div', { className: 'detail-section' });
    gearSection.appendChild(h('p', { className: 'detail-section-title', textContent: 'GEAR' }));
    if (gLines.length === 0) {
      gearSection.appendChild(h('p', { className: 'detail-none', textContent: 'None' }));
    } else {
      for (const line of gLines) {
        gearSection.appendChild(h('p', { className: 'detail-stat', textContent: line }));
      }
    }
    this.#detailEl.appendChild(gearSection);

    // Consumables
    const consumables = full.inventory?.consumables ?? [];
    const cLines = consumableLines(consumables);
    const consSection = h('div', { className: 'detail-section' });
    consSection.appendChild(
      h('p', { className: 'detail-section-title', textContent: 'CONSUMABLES' })
    );
    if (cLines.length === 0) {
      consSection.appendChild(h('p', { className: 'detail-none', textContent: 'None' }));
    } else {
      for (const line of cLines) {
        consSection.appendChild(h('p', { className: 'detail-stat', textContent: line }));
      }
    }
    this.#detailEl.appendChild(consSection);
  }
}

customElements.define('crew-roster', CrewRoster);

export default CrewRoster;
