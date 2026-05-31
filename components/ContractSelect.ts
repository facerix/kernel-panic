/**
 * <contract-select> — Curator job board. Presents the three contracts rolled
 * for this Hub visit, then emits the selected contract so the shell can move
 * to operative selection.
 */

import { h } from '/src/domUtils.js';
import { cloneObjective } from '/src/game/hub/Curator.js';
import type { Contract } from '/src/game/hub/Curator.js';

const DIFFICULTY_LABEL: Record<string, string> = Object.freeze({
  standard: 'STANDARD',
  elevated: 'ELEVATED',
  critical: 'CRITICAL',
});

const CSS = `
:host {
  --board-bg: rgba(7, 18, 16, 0.96);
  --board-border: var(--accent-color, #00d9a5);
  --board-text: #c5efdf;
  --board-dim: #6ae8c8;
  --board-accent: var(--accent-color, #00d9a5);
  --board-warn: #ffd166;
  --board-danger: #ff5d73;
  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--board-text);
}

:host([open]) {
  display: flex;
  position: fixed;
  inset: 0;
  z-index: 50;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.panel {
  width: min(860px, 96vw);
  max-height: 92vh;
  overflow: auto;
  background: var(--board-bg);
  border: 1px solid var(--board-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.5rem;
  box-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);
}

.title {
  margin: 0 0 0.75rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--board-accent);
  border-bottom: 1px dashed var(--board-border);
  padding-bottom: 0.5rem;
}

.list {
  display: grid;
  gap: 0.65rem;
}

.job {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  gap: 0.75rem;
  align-items: center;
  min-height: 88px;
  background: rgba(0, 217, 165, 0.04);
  color: inherit;
  border: 1px solid rgba(0, 217, 165, 0.28);
  border-radius: 6px;
  padding: 0.75rem 0.9rem;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.job[selected] {
  border-color: var(--board-accent);
  background: rgba(0, 217, 165, 0.14);
}

.job:focus-visible {
  outline: 2px solid var(--board-accent);
  outline-offset: 2px;
}

.primary {
  min-width: 0;
}

.name {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
  margin-bottom: 0.35rem;
}

.target {
  color: var(--board-text);
  word-break: break-word;
}

.badge {
  color: #020403;
  background: var(--board-accent);
  border-radius: 3px;
  padding: 0.12rem 0.35rem;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
}

.badge.elevated {
  background: var(--board-warn);
}

.badge.critical {
  background: var(--board-danger);
}

.known {
  color: var(--board-dim);
  border: 1px solid rgba(106, 232, 200, 0.45);
  border-radius: 3px;
  padding: 0.1rem 0.4rem;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.meta {
  color: var(--board-dim);
  font-size: 0.84rem;
  letter-spacing: 0.04em;
}

.objective {
  color: var(--board-text);
  font-size: 0.86rem;
  margin-top: 0.2rem;
}

.take {
  color: var(--board-accent);
  border-left: 1px dashed rgba(0, 217, 165, 0.45);
  padding-left: 0.75rem;
  letter-spacing: 0.1em;
  white-space: nowrap;
}

.hint {
  margin: 0.9rem 0 0;
  color: var(--board-dim);
  text-align: center;
  font-size: 0.85rem;
  letter-spacing: 0.1em;
}

@media (max-width: 640px) {
  .job {
    grid-template-columns: 1fr;
  }

  .take {
    border-left: 0;
    padding-left: 0;
  }
}
`;

class ContractSelect extends HTMLElement {
  #contracts: Contract[] = [];
  #selectedIndex = 0;
  #ready = false;
  #listEl: HTMLElement | null = null;
  #panelEl: HTMLElement | null = null;
  #onKeyDown: ((evt: KeyboardEvent) => void) | null = null;
  #onBackdrop: ((evt: PointerEvent) => void) | null = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#listEl = h('div', { className: 'list' });
    this.#panelEl = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: '── JOB BOARD ──' }),
      this.#listEl,
      h('p', {
        className: 'hint',
        textContent: '[ ↑/↓ choose job  ·  Enter / TAKE THE JOB  ·  Esc dismiss ]',
      }),
    ]);
    shadow.appendChild(this.#panelEl);

    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);
    this.#onBackdrop = evt => {
      if (evt.composedPath().includes(this.#panelEl as EventTarget)) return;
      this.dispatchEvent(new CustomEvent('dismiss'));
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    this.#render();
  }

  setContracts(contracts: Contract[]) {
    if (!Array.isArray(contracts)) {
      throw new TypeError('<contract-select>.setContracts requires an array');
    }
    if (contracts.length === 0) {
      throw new Error('<contract-select>.setContracts requires at least one contract');
    }
    this.#contracts = contracts.map(cloneContract);
    this.#selectedIndex = 0;
    if (this.#ready) this.#render();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => this.#focusSelected());
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
    if (!this.#listEl) return;
    this.#listEl.replaceChildren();
    this.#contracts.forEach((contract, index) => {
      const button = h(
        'button',
        {
          type: 'button',
          className: 'job',
          ariaSelected: String(index === this.#selectedIndex),
        },
        [
          h('div', { className: 'primary' }, [
            h('div', { className: 'name' }, [
              h('span', {
                className: `badge ${contract.difficulty}`,
                textContent: difficultyLabel(contract),
              }),
              h('span', { className: 'target', textContent: contract.label }),
              // M7.2: flag contracts that revisit a remembered location so the
              // player can anticipate prior breach holes / mapped geometry.
              ...(contract.context.locationSiteId
                ? [h('span', { className: 'known', textContent: '// known site' })]
                : []),
            ]),
            h('div', { className: 'meta', textContent: rewardCopy(contract) }),
            h('div', { className: 'objective', textContent: objectiveCopy(contract) }),
          ]),
          h('div', { className: 'take', textContent: 'TAKE THE JOB' }),
        ]
      ) as HTMLButtonElement;
      if (index === this.#selectedIndex) button.setAttribute('selected', '');
      button.addEventListener('click', () => {
        this.#selectedIndex = index;
        this.#commit();
      });
      this.#listEl!.appendChild(button);
    });
  }

  #handleKey(evt: KeyboardEvent) {
    if (!this.isOpen) return;
    if (evt.key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      this.dispatchEvent(new CustomEvent('dismiss'));
      return;
    }
    if (evt.key === 'ArrowDown' || evt.key === 's' || evt.key === 'S') {
      evt.preventDefault();
      this.#move(1);
      return;
    }
    if (evt.key === 'ArrowUp' || evt.key === 'w' || evt.key === 'W') {
      evt.preventDefault();
      this.#move(-1);
      return;
    }
    if (evt.key === 'Enter') {
      evt.preventDefault();
      this.#commit();
    }
  }

  #move(delta: number) {
    if (this.#contracts.length === 0) return;
    this.#selectedIndex =
      (this.#selectedIndex + delta + this.#contracts.length) % this.#contracts.length;
    this.#render();
    this.#focusSelected();
  }

  #focusSelected() {
    const buttons = this.shadowRoot?.querySelectorAll<HTMLButtonElement>('button.job');
    buttons?.[this.#selectedIndex]?.focus();
  }

  #commit() {
    const contract = this.#contracts[this.#selectedIndex];
    if (!contract) return;
    this.dispatchEvent(
      new CustomEvent('contract-selected', {
        detail: { contract: cloneContract(contract) },
      })
    );
  }
}

function difficultyLabel(contract: Contract): string {
  return DIFFICULTY_LABEL[contract.difficulty] ?? contract.difficulty.toUpperCase();
}

function rewardCopy(contract: Contract): string {
  const recruit = contract.reward.recruit ? ' · recruit lead' : '';
  return `${contract.threatCount} hostiles · Cr +${contract.reward.credits} · REP +${contract.reward.repDelta}${recruit}`;
}

function objectiveCopy(contract: Contract): string {
  const turnLimit = contract.objective.params?.turnLimit;
  const window =
    Number.isInteger(turnLimit) && Number(turnLimit) > 0 ? ` · WINDOW ${turnLimit} turns` : '';
  return `OBJ ${contract.objective.title}${window}`;
}

function cloneContract(contract: Contract): Contract {
  return {
    ...contract,
    objective: cloneObjective(contract.objective),
    reward: { ...contract.reward },
  };
}

customElements.define('contract-select', ContractSelect);

export default ContractSelect;
