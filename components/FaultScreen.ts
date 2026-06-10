/**
 * <fault-screen> — the top-level error boundary's user-facing surface.
 *
 * This is deliberately **non-diegetic**, and that distinction matters. The
 * sibling `<crash-dump>` / `<game-over>` are in-fiction: per-job debrief and
 * terminal campaign loss — normal, authored game outcomes. Routing a real
 * software bug through that screen would disguise the bug as an in-universe
 * death (the player shrugs and hits "new run"), which is exactly the silent
 * failure the project's error doctrine forbids (see `AGENTS.md` → "Error
 * handling — fail loud, but recover").
 *
 * So a genuine tier-1 fault gets its own screen that breaks the fiction on
 * purpose: this is the *deck/tooling* failing, not your character. It states
 * plainly that something went wrong, reassures the player their campaign is
 * safe, and offers a single way out — back to the Hub.
 *
 *   SYSTEM FAULT
 *   Something glitched in the deck.
 *   Your campaign is safe — the last checkpoint is intact.
 *   [ RETURN TO HUB ]
 *
 * Usage (wired by the shell):
 *   const fault = document.querySelector('fault-screen');
 *   fault.addEventListener('return-to-hub', () => degradeToHub());
 *   fault.show({ code: 'unhandledrejection' }); // optional support ref
 *
 * Visual verification via the shell — same rule as <crash-dump> / <touch-pad>.
 */

import { h } from '/src/domUtils.js';

const CSS = `
:host {
  /* Amber 'system notice' palette — intentionally NOT the accent-green of the
     live game nor the death-red of <crash-dump>; this is an out-of-band fault. */
  --fault-bg: rgba(14, 11, 4, 0.97);
  --fault-text: #f4e9cf;
  --fault-dim: #d9b66a;
  --fault-accent: #ffb347;
  --fault-shadow: 0 0 32px rgba(255, 179, 71, 0.18), 0 12px 36px rgba(0, 0, 0, 0.6);

  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--fault-text);
}

:host([open]) {
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel {
  background: var(--fault-bg);
  border: 1px solid var(--fault-accent);
  border-radius: 6px;
  padding: 1.5rem 1.75rem 1.75rem;
  box-shadow: var(--fault-shadow);
  min-width: min(420px, 92vw);
  max-width: min(560px, 96vw);
  text-align: center;
}

.title {
  margin: 0 0 1rem;
  font-size: 1rem;
  letter-spacing: 0.2em;
  color: var(--fault-accent);
  border-bottom: 1px dashed var(--fault-accent);
  padding-bottom: 0.5rem;
}

.headline {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
}

.reassure {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
  color: var(--fault-dim);
}

.code {
  margin: 0 0 1.25rem;
  font-size: 0.8rem;
  color: var(--fault-dim);
  opacity: 0.8;
  word-break: break-word;
}

.code:empty {
  display: none;
  margin-bottom: 0;
}

.actions {
  display: flex;
  justify-content: center;
}

button.return {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--fault-accent);
  border: 1px solid var(--fault-accent);
  padding: 0.55em 2em;
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  letter-spacing: 0.16em;
  cursor: pointer;
  min-height: 44px;
  transition: background 0.15s ease, color 0.15s ease;
}

button.return:hover,
button.return:focus-visible {
  background: var(--fault-accent);
  color: #1a1203;
  outline: none;
}

button.return:active { transform: scale(0.98); }
`;

type FaultDetail = {
  /** Optional short support ref (e.g. the fault source) for the player to quote. */
  code?: string;
};

class FaultScreen extends HTMLElement {
  #ready = false;
  #codeEl: HTMLElement | null = null;
  /** Code captured by show() before connectedCallback built the DOM. */
  #pendingCode: string | null = null;

  connectedCallback() {
    if (this.#ready) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const codeEl = h('p', { className: 'code' });
    const returnBtn = h('button', {
      type: 'button',
      className: 'return',
      textContent: '[ RETURN TO HUB ]',
    }) as HTMLButtonElement;
    returnBtn.addEventListener('click', () => this.#emit('return-to-hub'));

    const panel = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: 'SYSTEM FAULT' }),
      h('p', { className: 'headline', textContent: 'Something glitched in the deck.' }),
      h('p', {
        className: 'reassure',
        textContent: 'Your campaign is safe — the last checkpoint is intact.',
      }),
      codeEl,
      h('div', { className: 'actions' }, [returnBtn]),
    ]);
    shadow.appendChild(panel);

    this.#codeEl = codeEl;
    this.#ready = true;
    // A show() that ran before we were connected stashed its code; apply it now.
    if (this.hasAttribute('open')) this.#renderCode(this.#pendingCode);
  }

  /**
   * Reveal the fault screen. Optional `detail.code` surfaces a short support ref
   * the player can quote; the full error already went to the dev channel via the
   * error boundary's `onSignal`, not here.
   */
  show(detail: FaultDetail = {}) {
    const code = detail.code ?? null;
    if (this.#ready) {
      this.#renderCode(code);
    } else {
      this.#pendingCode = code;
    }
    this.setAttribute('open', '');
    queueMicrotask(() => {
      (this.shadowRoot?.querySelector('button.return') as HTMLButtonElement)?.focus();
    });
  }

  hide() {
    this.removeAttribute('open');
  }

  get isOpen() {
    return this.hasAttribute('open');
  }

  #renderCode(code: string | null) {
    if (this.#codeEl) this.#codeEl.textContent = code ? `ref: ${code}` : '';
  }

  #emit(eventName: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

customElements.define('fault-screen', FaultScreen);

export default FaultScreen;
