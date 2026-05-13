/**
 * <system-start> — Full-screen overlay on a **new** campaign only (not resume).
 * Boot-style telemetry plus Curator voice; dismiss to play in the Hub.
 *
 *   ── SYSTEM START ──
 *   [preformatted boot lines]
 *   Curator copy…
 *   SESSION  0x1A4F22B9
 *   [ ENTER HUB ]
 */

import { h } from '/src/domUtils.js';

const CSS = `
:host {
  --start-bg: rgba(7, 18, 16, 0.96);
  --start-border: var(--accent-color, #00d9a5);
  --start-text: #c5efdf;
  --start-dim: #6ae8c8;
  --start-accent: var(--accent-color, #00d9a5);
  --start-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--start-text);
}

:host([open]) {
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel {
  background: var(--start-bg);
  border: 1px solid var(--start-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.5rem;
  box-shadow: var(--start-shadow);
  min-width: min(420px, 92vw);
  max-width: min(560px, 96vw);
}

.title {
  margin: 0 0 0.85rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--start-accent);
  border-bottom: 1px dashed var(--start-border);
  padding-bottom: 0.5rem;
}

.boot {
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(106, 232, 200, 0.18);
  border-radius: 4px;
  font-size: 0.82rem;
  line-height: 1.45;
  white-space: pre;
  overflow-x: auto;
  color: var(--start-text);
}

.curator {
  margin: 0 0 1rem;
  font-size: 0.88rem;
  line-height: 1.5;
  color: var(--start-dim);
  border-left: 2px solid rgba(0, 217, 165, 0.35);
  padding-left: 0.75rem;
}

.session {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1rem;
  row-gap: 0.2rem;
  font-size: 0.9rem;
  margin: 0 0 1.25rem;
}

.session dt {
  color: var(--start-dim);
  letter-spacing: 0.08em;
}

.session dd {
  margin: 0;
  word-break: break-word;
}

.actions {
  display: flex;
  justify-content: center;
}

button.enter-hub {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--start-accent);
  border: 1px solid var(--start-accent);
  padding: 0.55em 2em;
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  letter-spacing: 0.14em;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  min-height: 44px;
}

button.enter-hub:hover,
button.enter-hub:focus-visible {
  background: var(--start-accent);
  color: #020403;
  outline: none;
}

button.enter-hub:active {
  transform: scale(0.98);
}
`;

const BOOT_LINES = [
  'handshake_ok ........................ OK',
  'meatspace_link ...................... OK',
  'crew_buffer ......................... 3 slots',
  'safe_partition ...................... mounted',
  'curator_channel ..................... standby',
].join('\n');

const CURATOR_COPY =
  'CURATOR — You are cleared into the safe house. Crew is on the board; ' +
  'when you want work, find me adjacent and open a contract. No heroics on ' +
  'the carpet.';

function hexSeed(seed) {
  if (!Number.isFinite(seed)) return '?';
  const n = (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `0x${n}`;
}

class SystemStart extends HTMLElement {
  #ready = false;
  #seedCell = null;
  #session = null;

  connectedCallback() {
    if (this.#ready) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const boot = h('pre', { className: 'boot', textContent: BOOT_LINES });
    const curator = h('p', { className: 'curator', textContent: CURATOR_COPY });
    const seed = h('dd', { id: 'session-seed' });
    this.#seedCell = seed;

    const enterHub = h('button', {
      type: 'button',
      className: 'enter-hub',
      textContent: '[ ENTER HUB ]',
    });
    enterHub.addEventListener('click', () => this.#emitHubEnter());

    const panel = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: '── SYSTEM START ──' }),
      boot,
      curator,
      h('dl', { className: 'session' }, [h('dt', { textContent: 'SESSION' }), seed]),
      h('div', { className: 'actions' }, [enterHub]),
    ]);
    shadow.appendChild(panel);
    this.#ready = true;
    if (this.#session) this.#render();
  }

  /**
   * @param {{ seed: number }} session
   */
  setSession(session) {
    if (!session || typeof session !== 'object' || !Number.isFinite(session.seed)) {
      throw new TypeError('<system-start>.setSession requires { seed: number }');
    }
    this.#session = { seed: session.seed >>> 0 };
    if (this.#ready) this.#render();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
      this.shadowRoot?.querySelector('button.enter-hub')?.focus();
    });
  }

  hide() {
    this.removeAttribute('open');
  }

  get isOpen() {
    return this.hasAttribute('open');
  }

  #render() {
    if (!this.#seedCell) return;
    const s = this.#session;
    this.#seedCell.textContent = s ? hexSeed(s.seed) : '?';
  }

  #emitHubEnter() {
    this.dispatchEvent(new CustomEvent('hub-enter', { bubbles: true, composed: true }));
  }
}

customElements.define('system-start', SystemStart);

export default SystemStart;
