/**
 * <crew-roster> — Terminal crew readout. Two-pane modal: <crew-list> on the
 * left, detail pane on the right showing the selected member's stats, gear,
 * and consumables.
 *
 * M6: Extended with an "Available Recruits" section below the crew list.
 * When recruits are available and the player hasn't recruited this visit,
 * recruit rows appear with a RECRUIT confirmation button. Emits `recruit`
 * CustomEvent with `{ recruitId }` on confirmation.
 *
 * Usage:
 *   rosterEl.setCrew(campaign.crew, {
 *     salvage: campaign.salvage,
 *     availableRecruits: campaign.availableRecruits,
 *     recruitedThisVisit: campaign.recruitedThisVisit,
 *   });
 *   rosterEl.show();
 */

import { h } from '/src/domUtils.js';
import CrewList from '/components/CrewList.js';
import {
  emptySalvage,
  formatSalvageCompact,
  totalSalvage,
  type TypedSalvage,
} from '/src/game/salvage.js';
import type { Crew as CrewMember, Gear } from '/src/game/Crew.js';
import type { Item } from '/src/game/items.js';

/** Human-readable labels for item IDs (mirrors ItemInventory). */
const ITEM_LABELS = {
  stim: 'Stim',
  'smoke-charge': 'Smoke Charge',
  'breaching-charge': 'Breaching Charge',
};

/** Human-readable labels for gear bonuses. */
function gearLines(gear: Gear) {
  if (!gear) return [];
  const lines: string[] = [];
  if (gear.maxHpBonus > 0) lines.push(`Armour Plating  +${gear.maxHpBonus} HP`);
  if (gear.hitBonus > 0) lines.push(`Targeting Chip  +${(gear.hitBonus * 100).toFixed(0)}%`);
  if ((gear.dodgeBonus ?? 0) > 0)
    lines.push(`Reflex Weave  +${((gear.dodgeBonus ?? 0) * 100).toFixed(0)}%`);
  return lines;
}

/** Aggregate consumables into "Label x2" lines. */
function consumableLines(consumables: Item[]) {
  if (!consumables || consumables.length === 0) return [];
  const counts = new Map();
  for (const c of consumables) {
    counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  }
  const lines = [];
  for (const [id, count] of counts) {
    const label = ITEM_LABELS[id as keyof typeof ITEM_LABELS] ?? id;
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
  margin: 0.1rem;
}

.flatlined-label {
  color: var(--roster-danger);
  letter-spacing: 0.1em;
  font-size: 0.9rem;
}

.recruit-section {
  margin-top: 0.75rem;
  border-top: 1px dashed var(--roster-border);
  padding-top: 0.6rem;
}

.recruit-title {
  margin: 0 0 0.5rem;
  text-align: center;
  font-size: 0.88rem;
  letter-spacing: 0.16em;
  color: var(--roster-accent);
}

.recruit-rows {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

button.recruit-row {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--roster-text);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0.5rem 0.7rem;
  text-align: left;
  font: inherit;
  cursor: pointer;
  min-height: 44px;
  display: grid;
  grid-template-columns: 1.3em minmax(0, 1fr) max-content;
  gap: 0.3rem 0.6rem;
  align-items: center;
}

button.recruit-row:hover {
  background: var(--roster-row-hover, rgba(0, 217, 165, 0.08));
}

button.recruit-row:focus-visible,
button.recruit-row[aria-current='true'] {
  outline: none;
  border-color: var(--roster-accent);
  background: rgba(0, 217, 165, 0.18);
}

button.recruit-row .cursor {
  color: var(--roster-accent);
  font-weight: 700;
  visibility: hidden;
}

button.recruit-row:focus-visible .cursor,
button.recruit-row[aria-current='true'] .cursor {
  visibility: visible;
}

button.recruit-row .name {
  color: var(--roster-accent);
  font-weight: 700;
  letter-spacing: 0.1em;
}

button.recruit-row .meta {
  color: var(--roster-dim);
  font-size: 0.88rem;
}

.recruit-action {
  margin-top: 0.6rem;
  text-align: center;
}

button.recruit-btn {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--roster-accent);
  border: 1px solid var(--roster-accent);
  border-radius: 4px;
  padding: 0.5rem 1.5rem;
  font: inherit;
  font-size: 0.92rem;
  letter-spacing: 0.18em;
  cursor: pointer;
}

button.recruit-btn:hover:not(:disabled) {
  background: rgba(0, 217, 165, 0.15);
}

button.recruit-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
  #crewRaw: CrewMember[] = []; // original crew references (for detail data)
  #recruitsRaw: CrewMember[] = []; // available recruit candidates
  #recruitedThisVisit = false;
  #salvage: TypedSalvage = emptySalvage();
  #ready = false;
  #listEl: CrewList | null = null;
  #detailEl: HTMLElement | null = null;
  #titleEl: HTMLElement | null = null;
  #balanceEl: HTMLElement | null = null;
  #hintEl: HTMLElement | null = null;
  #panelEl: HTMLElement | null = null;
  #recruitSectionEl: HTMLElement | null = null;
  #recruitRowsEl: HTMLElement | null = null;
  #recruitBtnEl: HTMLButtonElement | null = null;
  #recruitButtons: HTMLButtonElement[] = [];
  #selectedRecruitIndex = -1;
  #recruitFocused = false; // true when user is navigating the recruit section
  #onKeyDown: ((this: HTMLElement, ev: KeyboardEvent) => void) | null = null;
  #onBackdrop: ((this: HTMLElement, ev: PointerEvent) => void) | null = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#titleEl = h('h2', { className: 'title', textContent: '── CREW ROSTER ──' });
    this.#balanceEl = h('p', { className: 'balance' });

    this.#listEl = document.createElement('crew-list') as CrewList;
    this.#listEl.addEventListener('select', evt =>
      this.#onSelect((evt as CustomEvent<{ member: CrewMember }>).detail.member)
    );

    this.#detailEl = h('div', { className: 'detail' });

    const body = h('div', { className: 'body' }, [this.#listEl, this.#detailEl]);

    // Recruit section (hidden until recruits are set).
    this.#recruitRowsEl = h('div', { className: 'recruit-rows' });
    this.#recruitBtnEl = h('button', {
      type: 'button',
      className: 'recruit-btn',
      textContent: '[ RECRUIT ]',
      disabled: true,
    }) as HTMLButtonElement;
    this.#recruitBtnEl.addEventListener('click', () => this.#commitRecruit());
    this.#recruitSectionEl = h('div', { className: 'recruit-section' }, [
      h('p', { className: 'recruit-title', textContent: '── AVAILABLE RECRUITS ──' }),
      this.#recruitRowsEl,
      h('div', { className: 'recruit-action' }, [this.#recruitBtnEl]),
    ]);
    this.#recruitSectionEl.style.display = 'none';

    this.#hintEl = h('p', { className: 'hint', textContent: '[ ↑/↓ navigate  ·  Esc dismiss ]' });
    this.#panelEl = h('section', { className: 'panel' }, [
      this.#titleEl,
      this.#balanceEl,
      body,
      this.#recruitSectionEl,
      this.#hintEl,
    ]);
    shadow.appendChild(this.#panelEl);

    this.#onKeyDown = this.#handleKey.bind(this);
    // Capture phase: intercept ArrowDown at end of crew-list to jump into recruits.
    this.addEventListener('keydown', this.#handleCrewToRecruitTransition.bind(this), true);
    this.addEventListener('keydown', this.#onKeyDown);
    this.#onBackdrop = evt => {
      // Clicks inside nested shadow trees (e.g. <crew-list> rows) retarget
      // `event.target` to this host, so `target === this` is not a safe
      // backdrop test — use the real event path instead.
      if (evt.composedPath().includes(this.#panelEl as EventTarget)) return;
      this.dispatchEvent(new CustomEvent('dismiss'));
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
  }

  /**
   * @param crew — array of Crew instances (or snapshot objects).
   * @param options — salvage balance + optional M6 recruit data.
   */
  setCrew(
    crew: CrewMember[],
    {
      salvage = emptySalvage(),
      availableRecruits = [] as CrewMember[],
      recruitedThisVisit = false,
    }: {
      salvage?: TypedSalvage;
      availableRecruits?: CrewMember[];
      recruitedThisVisit?: boolean;
    } = {}
  ) {
    if (!Array.isArray(crew)) {
      throw new TypeError('<crew-roster>.setCrew requires an array');
    }
    this.#crewRaw = crew;
    this.#recruitsRaw = availableRecruits;
    this.#recruitedThisVisit = recruitedThisVisit;
    this.#salvage = salvage;
    // M4.2: show typed breakdown + total. Until M5 redesigns the shop, this
    // surface is information-only — there's no per-type sell flow here yet.
    const total = totalSalvage(this.#salvage);
    this.#balanceEl!.textContent = `SALVAGE ${total} · ${formatSalvageCompact(this.#salvage)}`;
    this.#recruitFocused = false;
    this.#selectedRecruitIndex = -1;
    // Crew list handles its own rendering; selection triggers detail update.
    this.#listEl!.setCrew(crew);
    this.#renderRecruits();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
      // Focus the list so arrow keys work immediately.
      if (!this.#listEl!.focusSelected()) this.focus();
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

  #handleKey(evt: KeyboardEvent) {
    if (!this.isOpen) return;
    if (evt.key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      this.dispatchEvent(new CustomEvent('dismiss'));
      return;
    }
    if (evt.key === 'Enter' && this.#recruitFocused && this.#selectedRecruitIndex >= 0) {
      evt.preventDefault();
      evt.stopPropagation();
      this.#commitRecruit();
      return;
    }
    // Arrow/WASD nav between crew list and recruit rows.
    if (this.#recruitButtons.length > 0) {
      const down = evt.key === 'ArrowDown' || evt.key.toLowerCase() === 's';
      const up = evt.key === 'ArrowUp' || evt.key.toLowerCase() === 'w';
      if (down && !this.#recruitFocused) {
        // If the crew-list is at the bottom, jump into recruits.
        // Rely on crew-list emitting the event; we check on next tick.
        // Actually, we intercept after crew-list has handled it.
      }
      if (up && this.#recruitFocused && this.#selectedRecruitIndex === 0) {
        evt.preventDefault();
        evt.stopPropagation();
        this.#recruitFocused = false;
        this.#selectedRecruitIndex = -1;
        this.#syncRecruitCurrent();
        this.#recruitBtnEl!.disabled = true;
        this.#listEl!.focusSelected();
        // Re-show crew detail for the selected crew member.
        const member = this.#listEl!.selectedMember;
        if (member) this.#onSelect(member as unknown as CrewMember);
        return;
      }
      if (this.#recruitFocused) {
        if (down) {
          evt.preventDefault();
          evt.stopPropagation();
          this.#moveRecruit(1);
          return;
        }
        if (up) {
          evt.preventDefault();
          evt.stopPropagation();
          this.#moveRecruit(-1);
          return;
        }
      }
    }
  }

  /**
   * Update the detail pane when the crew list selection changes.
   * @param {{ id: string, callsign: string, archetype: string, hp: number, maxHp: number, flatlined: boolean }} member
   */
  #onSelect(member: CrewMember) {
    // Find the full crew object to read gear/inventory.
    const full = this.#crewRaw.find(m => (m.id ?? m.callsign) === member.id) ?? member;

    while (this.#detailEl!.firstChild) this.#detailEl!.removeChild(this.#detailEl!.firstChild);

    // Name + class header
    this.#detailEl!.appendChild(
      h('p', { className: 'detail-header' }, [
        h('span', { className: 'detail-name', textContent: member.callsign }),
        h('span', {
          className: 'detail-class',
          textContent: ` [${member.archetype.toUpperCase()}]`,
        }),
      ])
    );

    if (member.flatlined) {
      this.#detailEl!.appendChild(
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
    const hitBonus = full.gear?.hitBonus ?? 0;
    const actualHit = Math.min(full.baseHitChance + hitBonus, 1);
    statsSection.appendChild(
      h('p', {
        className: 'detail-stat',
        textContent: `AIM  ${(actualHit * 100).toFixed(0)}%`,
      })
    );
    const dodgeBonus = full.gear?.dodgeBonus ?? 0;
    const actualDodge = Math.min(full.baseDodgeChance + dodgeBonus, 1);
    statsSection.appendChild(
      h('p', {
        className: 'detail-stat',
        textContent: `DODGE  ${(actualDodge * 100).toFixed(0)}%`,
      })
    );
    this.#detailEl!.appendChild(statsSection);

    // Gear
    const gLines = gearLines(full.gear ?? ({} as Gear));
    const gearSection = h('div', { className: 'detail-section' });
    gearSection.appendChild(h('p', { className: 'detail-section-title', textContent: 'GEAR' }));
    if (gLines.length === 0) {
      gearSection.appendChild(h('p', { className: 'detail-none', textContent: '-None-' }));
    } else {
      for (const line of gLines) {
        gearSection.appendChild(h('p', { className: 'detail-stat', textContent: line }));
      }
    }
    this.#detailEl!.appendChild(gearSection);

    // Consumables
    const consumables = full.inventory?.consumables ?? ([] as Item[]);
    const cLines = consumableLines(consumables);
    const consSection = h('div', { className: 'detail-section' });
    consSection.appendChild(
      h('p', { className: 'detail-section-title', textContent: 'CONSUMABLES' })
    );
    if (cLines.length === 0) {
      consSection.appendChild(h('p', { className: 'detail-none', textContent: '-None-' }));
    } else {
      for (const line of cLines) {
        consSection.appendChild(h('p', { className: 'detail-stat', textContent: line }));
      }
    }
    this.#detailEl!.appendChild(consSection);
  }

  // ─── Recruitment (M6) ─────────────────────────────────────────────────────

  #renderRecruits() {
    while (this.#recruitRowsEl!.firstChild) {
      this.#recruitRowsEl!.removeChild(this.#recruitRowsEl!.firstChild);
    }
    this.#recruitButtons = [];

    const showSection = this.#recruitsRaw.length > 0 && !this.#recruitedThisVisit;
    this.#recruitSectionEl!.style.display = showSection ? '' : 'none';
    if (!showSection) return;

    for (let i = 0; i < this.#recruitsRaw.length; i++) {
      const recruit = this.#recruitsRaw[i];
      const row = h('button', {
        type: 'button',
        className: 'recruit-row',
        ariaCurrent: 'false',
      }) as HTMLButtonElement;
      row.dataset.index = String(i);
      row.addEventListener('click', () => this.#onRecruitRowClick(i));
      row.append(
        h('span', { className: 'cursor', textContent: '>' }),
        h('span', { className: 'name', textContent: recruit.callsign ?? recruit.id }),
        h('span', {
          className: 'meta',
          textContent: `${(recruit.constructor?.name ?? recruit.archetype ?? 'Crew').toUpperCase()}  HP ${recruit.hp}/${recruit.maxHp}`,
        })
      );
      this.#recruitRowsEl!.appendChild(row);
      this.#recruitButtons.push(row);
    }
    this.#recruitBtnEl!.disabled = true;
  }

  #onRecruitRowClick(index: number) {
    this.#recruitFocused = true;
    this.#selectedRecruitIndex = index;
    this.#syncRecruitCurrent();
    this.#recruitBtnEl!.disabled = false;
    this.#recruitButtons[index]?.focus();
    // Show recruit details in the detail pane.
    this.#showRecruitDetail(this.#recruitsRaw[index]);
  }

  #moveRecruit(delta: number) {
    if (this.#recruitButtons.length === 0) return;
    const next = this.#selectedRecruitIndex + delta;
    if (next < 0 || next >= this.#recruitButtons.length) return;
    this.#selectedRecruitIndex = next;
    this.#syncRecruitCurrent();
    this.#recruitButtons[next]?.focus();
    this.#recruitBtnEl!.disabled = false;
    this.#showRecruitDetail(this.#recruitsRaw[next]);
  }

  #syncRecruitCurrent() {
    for (let i = 0; i < this.#recruitButtons.length; i++) {
      this.#recruitButtons[i].setAttribute(
        'aria-current',
        i === this.#selectedRecruitIndex ? 'true' : 'false'
      );
    }
  }

  #showRecruitDetail(recruit: CrewMember) {
    while (this.#detailEl!.firstChild) this.#detailEl!.removeChild(this.#detailEl!.firstChild);
    this.#detailEl!.appendChild(
      h('p', { className: 'detail-header' }, [
        h('span', { className: 'detail-name', textContent: recruit.callsign ?? recruit.id }),
        h('span', {
          className: 'detail-class',
          textContent: ` [${(recruit.constructor?.name ?? recruit.archetype ?? 'Crew').toUpperCase()}]`,
        }),
      ])
    );
    // Stats — recruits are fresh, no gear/consumables.
    const statsSection = h('div', { className: 'detail-section' });
    statsSection.appendChild(h('p', { className: 'detail-section-title', textContent: 'STATS' }));
    statsSection.appendChild(
      h('p', { className: 'detail-stat', textContent: `HP  ${recruit.hp}/${recruit.maxHp}` })
    );
    const hitChance = recruit.baseHitChance ?? 0.65;
    const dodgeChance = recruit.baseDodgeChance ?? 0.2;
    statsSection.appendChild(
      h('p', {
        className: 'detail-stat',
        textContent: `AIM  ${(hitChance * 100).toFixed(0)}%`,
      })
    );
    statsSection.appendChild(
      h('p', {
        className: 'detail-stat',
        textContent: `DODGE  ${(dodgeChance * 100).toFixed(0)}%`,
      })
    );
    this.#detailEl!.appendChild(statsSection);
  }

  /**
   * Capture-phase handler: intercept ArrowDown at the end of the crew-list
   * to transition focus into the recruit section.
   */
  #handleCrewToRecruitTransition(evt: KeyboardEvent) {
    if (!this.isOpen || this.#recruitFocused) return;
    if (this.#recruitButtons.length === 0) return;
    const down = evt.key === 'ArrowDown' || evt.key.toLowerCase() === 's';
    if (!down) return;

    // Check if crew-list is at the last selectable row.
    const selected = this.#listEl!.selectedMember;
    if (!selected) return;
    const nonFlatlined = this.#crewRaw.filter(m => !m.flatlined);
    const lastSelectable = nonFlatlined[nonFlatlined.length - 1];
    if (lastSelectable && selected.id === lastSelectable.id) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      this.#recruitFocused = true;
      this.#selectedRecruitIndex = 0;
      this.#syncRecruitCurrent();
      this.#recruitBtnEl!.disabled = false;
      this.#recruitButtons[0]?.focus();
      this.#showRecruitDetail(this.#recruitsRaw[0]);
    }
  }

  #commitRecruit() {
    if (this.#selectedRecruitIndex < 0) return;
    const recruit = this.#recruitsRaw[this.#selectedRecruitIndex];
    if (!recruit) return;
    this.dispatchEvent(new CustomEvent('recruit', { detail: { recruitId: recruit.id } }));
  }
}

customElements.define('crew-roster', CrewRoster);

export default CrewRoster;
