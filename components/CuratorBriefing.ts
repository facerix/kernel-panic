/**
 * <curator-briefing> — Full-screen Curator voice overlay for diegetic intros.
 *
 * Reused for progressive Hub reveals (M5.4) and any future one-shot briefing
 * copy the shell wants to foreground beyond the status line.
 *
 * Events:
 *   - `dismiss` — player acknowledged (button, Enter, or Esc).
 *
 *   setBriefing({ title, lines })
 *   show() / hide()
 */

import { h } from '/src/domUtils.js';

export type CuratorBriefingContent = {
  title: string;
  lines: readonly string[];
};

const CSS = `
:host {
  --brief-bg: rgba(7, 18, 16, 0.96);
  --brief-border: var(--accent-color, #00d9a5);
  --brief-text: #c5efdf;
  --brief-dim: #6ae8c8;
  --brief-accent: var(--accent-color, #00d9a5);
  --brief-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--brief-text);
}

:host([open]) {
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel {
  background: var(--brief-bg);
  border: 1px solid var(--brief-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.5rem;
  box-shadow: var(--brief-shadow);
  min-width: min(420px, 92vw);
  max-width: min(560px, 96vw);
  max-height: 80vh;
  overflow-y: auto;
}

.title {
  margin: 0 0 0.85rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--brief-accent);
  border-bottom: 1px dashed var(--brief-border);
  padding-bottom: 0.5rem;
}

.body {
  margin: 0 0 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.curator-line {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.5;
  color: var(--brief-dim);
  border-left: 2px solid rgba(0, 217, 165, 0.35);
  padding-left: 0.75rem;
}

.curator-line::before {
  content: 'CURATOR';
  display: block;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  color: var(--brief-accent);
  margin-bottom: 0.25rem;
}

.actions {
  display: flex;
  justify-content: center;
}

button.continue {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--brief-accent);
  border: 1px solid var(--brief-accent);
  padding: 0.55em 2em;
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  letter-spacing: 0.14em;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  min-height: 44px;
}

button.continue:hover,
button.continue:focus-visible {
  background: var(--brief-accent);
  color: #020403;
  outline: none;
}

button.continue:active {
  transform: scale(0.98);
}
`;

const CURATOR_PREFIX = /^CURATOR:\s*/i;

function formatLine(raw: string): string {
  return raw.replace(CURATOR_PREFIX, '').trim();
}

class CuratorBriefing extends HTMLElement {
  #ready = false;
  #titleEl: HTMLElement | null = null;
  #bodyEl: HTMLElement | null = null;
  #content: CuratorBriefingContent | null = null;

  #onKeyDown: ((this: HTMLElement, ev: KeyboardEvent) => void) | null = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#titleEl = h('h2', { className: 'title' });
    this.#bodyEl = h('div', { className: 'body' });

    const continueBtn = h('button', {
      type: 'button',
      className: 'continue',
      textContent: '[ CONTINUE ]',
    });
    continueBtn.addEventListener('click', () => this.#emitDismiss());

    const panel = h('section', { className: 'panel' }, [
      this.#titleEl,
      this.#bodyEl,
      h('div', { className: 'actions' }, [continueBtn]),
    ]);
    shadow.appendChild(panel);

    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);

    this.#ready = true;
    if (this.#content) this.#render();
  }

  setBriefing(content: CuratorBriefingContent) {
    if (!content || typeof content !== 'object') {
      throw new TypeError('<curator-briefing>.setBriefing requires a content object');
    }
    if (typeof content.title !== 'string' || !content.title.trim()) {
      throw new TypeError('<curator-briefing>.setBriefing requires a non-empty title');
    }
    if (!Array.isArray(content.lines) || content.lines.length === 0) {
      throw new TypeError('<curator-briefing>.setBriefing requires at least one line');
    }
    for (const line of content.lines) {
      if (typeof line !== 'string') {
        throw new TypeError('<curator-briefing>.setBriefing lines must be strings');
      }
    }
    this.#content = {
      title: content.title.trim(),
      lines: content.lines.map(line => line.trim()).filter(Boolean),
    };
    if (this.#content.lines.length === 0) {
      throw new TypeError('<curator-briefing>.setBriefing requires at least one non-empty line');
    }
    if (this.#ready) this.#render();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
      (this.shadowRoot?.querySelector('button.continue') as HTMLButtonElement | null)?.focus();
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
  }

  #render() {
    if (!this.#titleEl || !this.#bodyEl || !this.#content) return;
    this.#titleEl.textContent = this.#content.title;
    this.#bodyEl.replaceChildren(
      ...this.#content.lines.map(line =>
        h('p', { className: 'curator-line', textContent: formatLine(line) })
      )
    );
  }

  #handleKey(ev: KeyboardEvent) {
    if (!this.isOpen) return;
    if (ev.key === 'Escape' || ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      this.#emitDismiss();
    }
  }

  #emitDismiss() {
    this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, composed: true }));
  }
}

customElements.define('curator-briefing', CuratorBriefing);

export default CuratorBriefing;
