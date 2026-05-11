/**
 * <run-briefing> — DOM overlay shown while `Run.state === BRIEFING`. Renders
 * the contract the Curator just rolled and exposes a single JACK IN button
 * the shell listens to before flipping the Run into COMBAT.
 *
 *   ┌────────── CONTRACT ──────────┐
 *   │ TARGET:  Sublevel 3 cache    │
 *   │ SEED:    0x1A4F22B9          │
 *   │ THREAT:  2 drones            │
 *   │ OBJ:     Reach exit tile     │
 *   │         [ JACK IN ]          │
 *   └──────────────────────────────┘
 *
 * Usage:
 *   const briefing = document.querySelector('run-briefing');
 *   briefing.addEventListener('jack-in', () => run.enterCombat());
 *   briefing.setContract({ seed, label, threatCount, objective });
 *   briefing.show();   // briefing.hide() to dismiss
 *
 * Shadow-DOM scoped so the ASCII frame doesn't leak. Per the M8 plan the
 * component itself is verified visually via the shell — same rule the M7
 * `<touch-pad>` follows.
 */

import { h } from '/src/domUtils.js';

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
  --briefing-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--briefing-text);
}

:host([open]) {
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel {
  background: var(--briefing-bg);
  border: 1px solid var(--briefing-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.5rem;
  box-shadow: var(--briefing-shadow);
  min-width: min(420px, 92vw);
  max-width: min(560px, 96vw);
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

.rows {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1.25rem;
  row-gap: 0.25rem;
  font-size: 0.95rem;
  margin: 0.5rem 0 1.25rem;
}

.rows dt {
  color: var(--briefing-dim);
  letter-spacing: 0.08em;
}

.rows dd {
  margin: 0;
  color: var(--briefing-text);
  word-break: break-word;
}

.actions {
  display: flex;
  justify-content: center;
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
  #ready = false;
  #cells = null;

  connectedCallback() {
    if (this.#ready) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const target = h('dd', { id: 'target' });
    const seed = h('dd', { id: 'seed' });
    const threat = h('dd', { id: 'threat' });
    const objective = h('dd', { id: 'objective' });
    this.#cells = { target, seed, threat, objective };

    const jackIn = h('button', {
      type: 'button',
      className: 'jack-in',
      textContent: '[ JACK IN ]',
    });
    jackIn.addEventListener('click', () => this.#emit('jack-in'));

    const panel = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: '── CONTRACT ──' }),
      h('dl', { className: 'rows' }, [
        h('dt', { textContent: 'TARGET' }),
        target,
        h('dt', { textContent: 'SEED' }),
        seed,
        h('dt', { textContent: 'THREAT' }),
        threat,
        h('dt', { textContent: 'OBJ' }),
        objective,
      ]),
      h('div', { className: 'actions' }, [jackIn]),
    ]);
    shadow.appendChild(panel);
    this.#ready = true;
    if (this.#contract) this.#render();
  }

  /**
   * Set the contract to display. Stored even if the component isn't connected
   * yet so the shell can race-free mount and call `setContract` in any order.
   */
  setContract(contract) {
    if (!contract || typeof contract !== 'object') {
      throw new TypeError('<run-briefing>.setContract requires a contract object');
    }
    this.#contract = { ...contract };
    if (this.#ready) this.#render();
  }

  show() {
    this.setAttribute('open', '');
    // Move focus to the JACK IN button so a keyboard player can press Enter
    // without grabbing the mouse. Guarded — the button doesn't exist until
    // the component is connected.
    queueMicrotask(() => {
      this.shadowRoot?.querySelector('button.jack-in')?.focus();
    });
  }

  hide() {
    this.removeAttribute('open');
  }

  get isOpen() {
    return this.hasAttribute('open');
  }

  #render() {
    if (!this.#cells) return;
    const c = this.#contract ?? {};
    this.#cells.target.textContent = c.label ?? '?';
    this.#cells.seed.textContent = hexSeed(c.seed);
    this.#cells.threat.textContent = threatCopy(c.threatCount);
    this.#cells.objective.textContent = objectiveCopy(c.objective);
  }

  #emit(eventName, detail) {
    this.dispatchEvent(
      new CustomEvent(eventName, { detail: detail ?? { contract: { ...this.#contract } } })
    );
  }
}

customElements.define('run-briefing', RunBriefing);

export default RunBriefing;
