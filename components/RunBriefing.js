/**
 * <run-briefing> — single-step Curator job modal. Shows the contract details
 * alongside an embedded <crew-list> for operative selection, with a JACK IN
 * button to confirm the deployment.
 *
 * Replaces the old two-step flow (pick crew in roster → show briefing → JACK
 * IN) with one modal that shows everything the player needs to decide.
 *
 * Emits:
 *   - `deploy` — player confirmed. `detail: { memberId, contract }`.
 *   - `dismiss` — player backed out (Esc / backdrop click).
 *
 * Usage:
 *   briefingEl.setContract(contract);
 *   briefingEl.setCrew(campaign.crew);
 *   briefingEl.show();
 *   briefingEl.addEventListener('deploy', evt => { ... });
 */

import { h } from '/src/domUtils.js';
import '/components/CrewList.js';

const OBJECTIVE_COPY = Object.freeze({
  'reach-exit': 'Reach exit tile',
});

const CSS = `
:host {
  --briefing-bg: rgba(7, 18, 16, 0.96);
  --briefing-border: var(--accent-color, #00d9a5);
  --briefing-text: #c5efdf;
  --briefing-dim: #6ae8c8;
  --briefing-accent: var(--accent-color, #00d9a5);
  --briefing-danger: #ff5d73;
  --briefing-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--briefing-text);
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
  background: var(--briefing-bg);
  border: 1px solid var(--briefing-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.5rem;
  box-shadow: var(--briefing-shadow);
  min-width: min(560px, 92vw);
  max-width: min(760px, 96vw);
}

.title {
  margin: 0 0 0.75rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--briefing-accent);
  border-bottom: 1px dashed var(--briefing-border);
  padding-bottom: 0.5rem;
}

.body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}

.contract-details {
  font-size: 0.95rem;
}

.contract-details dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1rem;
  row-gap: 0.25rem;
  margin: 0;
}

.contract-details dt {
  color: var(--briefing-dim);
  letter-spacing: 0.08em;
}

.contract-details dd {
  margin: 0;
  color: var(--briefing-text);
  word-break: break-word;
}

.deploy-section {
  border-left: 1px dashed var(--briefing-border);
  padding-left: 1rem;
}

.deploy-label {
  color: var(--briefing-accent);
  font-size: 0.82rem;
  letter-spacing: 0.12em;
  margin: 0 0 0.5rem;
}

/* Pass CSS custom properties down into the <crew-list> shadow. */
crew-list {
  --cl-text: var(--briefing-text);
  --cl-accent: var(--briefing-accent);
  --cl-dim: var(--briefing-dim);
  --cl-danger: var(--briefing-danger);
  --cl-row-hover: rgba(0, 217, 165, 0.08);
  --cl-row-active: rgba(0, 217, 165, 0.18);
}

.actions {
  display: flex;
  justify-content: center;
  margin-top: 0.75rem;
}

button.jack-in {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--briefing-accent);
  border: 1px solid var(--briefing-accent);
  padding: 0.55em 2em;
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  letter-spacing: 0.16em;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  min-height: 44px;
}

button.jack-in:hover,
button.jack-in:focus-visible {
  background: var(--briefing-accent);
  color: #020403;
  outline: none;
}

button.jack-in:active {
  transform: scale(0.98);
}

button.jack-in:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

button.jack-in:disabled:hover {
  background: transparent;
  color: var(--briefing-accent);
}

.hint {
  text-align: center;
  font-size: 0.85rem;
  color: var(--briefing-dim);
  letter-spacing: 0.1em;
  margin: 0.9rem 0 0;
}
`;

function hexSeed(seed) {
  if (!Number.isFinite(seed)) return '?';
  const n = (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `0x${n}`;
}

function objectiveCopy(objective) {
  return OBJECTIVE_COPY[objective] ?? objective ?? '?';
}

function threatCopy(count) {
  if (!Number.isInteger(count)) return '?';
  if (count === 0) return 'No hostiles detected';
  return `${count} ${count === 1 ? 'drone' : 'drones'}`;
}

class RunBriefing extends HTMLElement {
  #contract = null;
  #selectedMember = null;
  #ready = false;
  #cells = null;
  #listEl = null;
  #jackInBtn = null;
  #onKeyDown = null;
  #onBackdrop = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    // Contract detail cells.
    const target = h('dd', { id: 'target' });
    const seed = h('dd', { id: 'seed' });
    const threat = h('dd', { id: 'threat' });
    const objective = h('dd', { id: 'objective' });
    this.#cells = { target, seed, threat, objective };

    const contractPane = h('div', { className: 'contract-details' }, [
      h('dl', {}, [
        h('dt', { textContent: 'TARGET' }),
        target,
        h('dt', { textContent: 'SEED' }),
        seed,
        h('dt', { textContent: 'THREAT' }),
        threat,
        h('dt', { textContent: 'OBJ' }),
        objective,
      ]),
    ]);

    // Crew list pane — select highlights, JACK IN commits.
    this.#listEl = document.createElement('crew-list');
    this.#listEl.addEventListener('select', evt => {
      this.#selectedMember = evt.detail.member;
      if (this.#jackInBtn) {
        this.#jackInBtn.disabled = !this.#selectedMember || this.#selectedMember.flatlined;
      }
    });
    // Double-click / Enter on a list row also confirms (convenience).
    this.#listEl.addEventListener('activate', evt => {
      this.#selectedMember = evt.detail.member;
      this.#commit();
    });

    this.#jackInBtn = h('button', {
      type: 'button',
      className: 'jack-in',
      textContent: '[ JACK IN ]',
      disabled: true,
    });
    this.#jackInBtn.addEventListener('click', () => this.#commit());

    const deployPane = h('div', { className: 'deploy-section' }, [
      h('p', { className: 'deploy-label', textContent: 'DEPLOY OPERATIVE' }),
      this.#listEl,
      h('div', { className: 'actions' }, [this.#jackInBtn]),
    ]);

    const body = h('div', { className: 'body' }, [contractPane, deployPane]);
    const hint = h('p', { className: 'hint', textContent: '[ ↑/↓ select  ·  ENTER jack in  ·  Esc dismiss ]' });

    const panel = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: '── CONTRACT ──' }),
      body,
      hint,
    ]);
    shadow.appendChild(panel);

    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);
    this.#onBackdrop = evt => {
      if (evt.target === this) {
        this.dispatchEvent(new CustomEvent('dismiss'));
      }
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    if (this.#contract) this.#renderContract();
  }

  /**
   * Set the contract to display.
   */
  setContract(contract) {
    if (!contract || typeof contract !== 'object') {
      throw new TypeError('<run-briefing>.setContract requires a contract object');
    }
    this.#contract = { ...contract };
    if (this.#ready) this.#renderContract();
  }

  /**
   * Set the crew for the operative selection pane.
   * @param {Array} crew
   */
  setCrew(crew) {
    if (!Array.isArray(crew)) {
      throw new TypeError('<run-briefing>.setCrew requires an array');
    }
    this.#selectedMember = null;
    if (this.#jackInBtn) this.#jackInBtn.disabled = true;
    this.#listEl.setCrew(crew, { selectable: true });
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
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

  #renderContract() {
    if (!this.#cells) return;
    const c = this.#contract ?? {};
    this.#cells.target.textContent = c.label ?? '?';
    this.#cells.seed.textContent = hexSeed(c.seed);
    this.#cells.threat.textContent = threatCopy(c.threatCount);
    this.#cells.objective.textContent = objectiveCopy(c.objective);
  }

  #handleKey(evt) {
    if (!this.isOpen) return;
    if (evt.key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      this.dispatchEvent(new CustomEvent('dismiss'));
    }
    // Arrow/WASD + Enter are handled by <crew-list> internally.
    // Enter on a selected crew member triggers `activate`, which calls #commit.
  }

  #commit() {
    if (!this.#contract || !this.#selectedMember || this.#selectedMember.flatlined) return;
    this.dispatchEvent(
      new CustomEvent('deploy', {
        detail: { memberId: this.#selectedMember.id, contract: { ...this.#contract } },
      })
    );
  }
}

customElements.define('run-briefing', RunBriefing);

export default RunBriefing;
