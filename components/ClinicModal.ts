/**
 * <clinic-modal> — Patch's clinic for restoring crew HP between runs.
 *
 * Events:
 *   - `heal`    — `{ memberId }` — player confirmed a patch-up.
 *   - `dismiss` — player pressed Esc / clicked backdrop.
 */

import { h } from '/src/domUtils.js';
import { ARCHETYPES } from '/src/game/archetypes/index.js';
import { CLINIC_COST_PER_HP } from '/src/game/constants.js';
import type { Crew as CrewMember } from '/src/game/Crew.js';

type PatientSnapshot = {
  id: string;
  callsign: string;
  archetype: string;
  hp: number;
  maxHp: number;
  flatlined: boolean;
};

type PatientRow = {
  member: PatientSnapshot;
  cost: number;
  status: 'healable' | 'full' | 'flatlined' | 'healed' | 'insufficient';
  label: string;
};

const CSS = `
:host {
  --clinic-bg: rgba(7, 18, 16, 0.96);
  --clinic-border: var(--accent-color, #00d9a5);
  --clinic-text: #c5efdf;
  --clinic-dim: #6ae8c8;
  --clinic-accent: var(--accent-color, #00d9a5);
  --clinic-gold: #f0c040;
  --clinic-row-hover: rgba(0, 217, 165, 0.08);
  --clinic-row-active: rgba(0, 217, 165, 0.18);
  --clinic-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  position: fixed;
  inset: 0;
  z-index: 50;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--clinic-text);
}

:host([open]) {
  display: flex;
}

.panel {
  background: var(--clinic-bg);
  border: 1px solid var(--clinic-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.4rem;
  box-shadow: var(--clinic-shadow);
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
  color: var(--clinic-accent);
  border-bottom: 1px dashed var(--clinic-border);
  padding-bottom: 0.5rem;
}

.balance {
  margin: 0 0 0.75rem;
  text-align: center;
  color: var(--clinic-gold);
  font-size: 0.9rem;
  letter-spacing: 0.08em;
}

.patient-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content max-content;
  gap: 0.35rem 0.75rem;
  align-items: center;
  padding: 0.45rem 0.5rem;
  border-bottom: 1px dashed rgba(0, 217, 165, 0.2);
}

.patient-row:last-child {
  border-bottom: none;
}

.patient-row[aria-current='true'] {
  background: var(--clinic-row-active);
}

.patient-info {
  min-width: 0;
}

.patient-name {
  color: var(--clinic-accent);
  font-weight: 700;
  letter-spacing: 0.06em;
  font-size: 0.85rem;
}

.patient-meta {
  color: var(--clinic-dim);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
}

.patient-cost {
  color: var(--clinic-gold);
  font-size: 0.82rem;
  white-space: nowrap;
}

button.patch-button {
  appearance: none;
  -webkit-appearance: none;
  background: rgba(0, 217, 165, 0.08);
  color: var(--clinic-text);
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

button.patch-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

button.patch-button:not(:disabled):hover,
button.patch-button:focus-visible {
  outline: none;
  border-color: var(--clinic-accent);
  background: var(--clinic-row-active);
}

.hint {
  margin: 0.85rem 0 0;
  text-align: center;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  color: var(--clinic-dim);
}

.empty {
  margin: 0;
  text-align: center;
  color: var(--clinic-dim);
  font-size: 0.82rem;
  letter-spacing: 0.06em;
}
`;

function archetypeLabel(archetypeId: string): string {
  const info = ARCHETYPES[archetypeId as keyof typeof ARCHETYPES];
  return info?.name ?? archetypeId;
}

function buildPatientRows(
  crew: PatientSnapshot[],
  credits: number,
  healedMemberIds: Set<string>
): PatientRow[] {
  return crew.map(member => {
    if (member.flatlined) {
      return { member, cost: 0, status: 'flatlined', label: 'FLATLINED' };
    }
    if (member.hp >= member.maxHp) {
      return { member, cost: 0, status: 'full', label: 'FULL HP' };
    }
    if (healedMemberIds.has(member.id)) {
      return { member, cost: 0, status: 'healed', label: 'HEALED' };
    }
    const cost = (member.maxHp - member.hp) * CLINIC_COST_PER_HP;
    if (credits < cost) {
      return { member, cost, status: 'insufficient', label: 'INSUFFICIENT CREDS' };
    }
    return { member, cost, status: 'healable', label: 'PATCH UP' };
  });
}

class ClinicModal extends HTMLElement {
  #crew: PatientSnapshot[] = [];
  #credits = 0;
  #healedMemberIds = new Set<string>();
  #ready = false;
  #panelEl: HTMLElement | null = null;
  #titleEl: HTMLElement | null = null;
  #balanceEl: HTMLElement | null = null;
  #bodyEl: HTMLElement | null = null;
  #hintEl: HTMLElement | null = null;
  #rows: { el: HTMLButtonElement; row: PatientRow }[] = [];
  #selectedIndex = 0;

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
    this.#onBackdrop = evt => {
      if (!evt.composedPath().includes(this.#panelEl as EventTarget)) this.#emit('dismiss');
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    this.#render();
  }

  setPatients(crew: CrewMember[], balances: { credits: number; healedMemberIds?: string[] }) {
    this.#crew = crew.map(member => ({
      id: member.id,
      callsign: member.callsign ?? member.id,
      archetype: member.archetype ?? 'unknown',
      hp: member.hp,
      maxHp: member.maxHp,
      flatlined: !!member.flatlined,
    }));
    this.#credits = balances.credits ?? 0;
    this.#healedMemberIds = new Set(balances.healedMemberIds ?? []);
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
    this.#titleEl!.textContent = '── PATCH CLINIC ──';
    this.#balanceEl!.textContent = `CREDS ${this.#credits}`;
    this.#hintEl!.textContent = '↑↓ select · Enter patch · Esc close';

    const rows = buildPatientRows(this.#crew, this.#credits, this.#healedMemberIds);

    if (rows.length === 0) {
      this.#rows = [];
      this.#bodyEl!.replaceChildren(
        h('p', { className: 'empty', textContent: 'No patients need care.' })
      );
      return;
    }

    this.#rows = [];
    const listEl = h('div');
    for (const row of rows) {
      const btn = h('button', {
        type: 'button',
        className: 'patch-button',
        textContent: row.label,
        disabled: row.status !== 'healable',
      }) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        if (row.status === 'healable') this.#emit('heal', { memberId: row.member.id });
      });

      const rowEl = h(
        'div',
        {
          className: 'patient-row',
          'aria-current': 'false',
        },
        [
          h('div', { className: 'patient-info' }, [
            h('div', { className: 'patient-name', textContent: row.member.callsign }),
            h('div', {
              className: 'patient-meta',
              textContent: `${archetypeLabel(row.member.archetype)} · HP ${row.member.hp}/${row.member.maxHp}`,
            }),
          ]),
          h('span', {
            className: 'patient-cost',
            textContent: row.cost > 0 ? `${row.cost} Cr` : '—',
          }),
          btn,
        ]
      );
      listEl.appendChild(rowEl);
      this.#rows.push({ el: btn, row });
    }

    this.#bodyEl!.replaceChildren(listEl);
    if (this.#selectedIndex >= this.#rows.length) this.#selectedIndex = 0;
    this.#syncCurrent();
  }

  #handleKey(evt: KeyboardEvent) {
    if (!this.isOpen) return;
    if (evt.key === 'Escape') {
      evt.preventDefault();
      this.#emit('dismiss');
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
      const entry = this.#rows[this.#selectedIndex];
      if (entry && entry.row.status === 'healable') {
        this.#emit('heal', { memberId: entry.row.member.id });
      }
    }
  }

  #move(delta: number) {
    if (this.#rows.length === 0) return;
    let next = this.#selectedIndex;
    for (let i = 0; i < this.#rows.length; i++) {
      next = (next + delta + this.#rows.length) % this.#rows.length;
      if (!this.#rows[next].el.disabled) break;
    }
    this.#selectedIndex = next;
    this.#syncCurrent();
    this.#focusSelected();
  }

  #syncCurrent() {
    const rowEls = this.#bodyEl?.querySelectorAll('.patient-row');
    rowEls?.forEach((el, i) => {
      el.setAttribute('aria-current', i === this.#selectedIndex ? 'true' : 'false');
    });
  }

  #focusSelected() {
    const entry = this.#rows[this.#selectedIndex];
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

customElements.define('clinic-modal', ClinicModal);

export default ClinicModal;
