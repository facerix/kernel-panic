/**
 * <update-notification> — blocking, release-aware service-worker update dialog.
 * The shell owns persistence and activation; this component owns presentation
 * and emits acknowledgement events.
 */

import { h } from '/src/domUtils.js';
import type { UpdateAvailableDetail } from '/src/ServiceWorkerManager.js';
import type { UpdateRelease } from '/src/updateRelease.js';

const CSS = `
:host {
  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --update-accent: var(--accent-color, #00d9a5);
  --update-bg: #071210;
  --update-border: #2a4a42;
  --update-text: #c5efdf;
  --update-dim: #6ae8c8;
  --update-danger: #ff8a9a;
}

dialog[open] {
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 24px));
  max-height: min(680px, calc(100vh - 24px));
  box-sizing: border-box;
  margin: auto;
  padding: 0;
  overflow: hidden;
  color: var(--update-text);
  background: linear-gradient(155deg, #0a100e 0%, var(--update-bg) 55%, #0d1815 100%);
  border: 1px solid var(--update-border);
  border-radius: 8px;
  box-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.55);
}

dialog.required {
  border-color: var(--update-accent);
}

dialog::backdrop {
  background: rgba(2, 4, 3, 0.78);
  backdrop-filter: blur(2px);
}

header {
  padding: 1rem 1.25rem;
  border-bottom: 1px dashed var(--update-border);
}

h2 {
  margin: 0;
  color: var(--update-accent);
  font-family: var(--font-heading, Silkscreen, ui-monospace, monospace);
  font-size: 1rem;
  font-weight: 400;
  letter-spacing: 0.08em;
}

.version {
  display: block;
  margin-top: 0.45rem;
  color: var(--update-dim);
  font-size: 0.78rem;
  letter-spacing: 0.12em;
}

.body {
  overflow-y: auto;
  padding: 1.15rem 1.25rem 0.5rem;
}

.message {
  margin: 0 0 1rem;
  line-height: 1.5;
}

ul {
  margin: 0;
  padding-left: 1.3rem;
}

li {
  margin: 0.55rem 0;
  line-height: 1.45;
}

.status {
  display: none;
  margin: 1rem 0 0;
  color: var(--update-dim);
  line-height: 1.45;
}

.status.visible {
  display: block;
}

.status.error {
  color: var(--update-danger);
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 0.55rem;
  vertical-align: -2px;
  border: 2px solid color-mix(in srgb, var(--update-accent) 35%, transparent);
  border-top-color: var(--update-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.25rem 1.25rem;
}

button {
  min-height: 44px;
  padding: 0.6rem 1rem;
  border-radius: 5px;
  cursor: pointer;
  font-family: var(--font-heading, Silkscreen, ui-monospace, monospace);
  font-size: 0.82rem;
  font-weight: 700;
}

button.primary {
  color: #020403;
  background: var(--update-accent);
  border: 1px solid var(--update-accent);
}

button.secondary {
  color: var(--update-text);
  background: transparent;
  border: 1px solid var(--update-border);
}

button:hover:not(:disabled),
button:focus-visible:not(:disabled) {
  outline: 2px solid var(--update-accent);
  outline-offset: 2px;
}

button:disabled {
  cursor: wait;
  opacity: 0.55;
}

[hidden] {
  display: none !important;
}
`;

class UpdateNotification extends HTMLElement {
  #dialog: HTMLDialogElement | null = null;
  #title: HTMLElement | null = null;
  #version: HTMLElement | null = null;
  #message: HTMLElement | null = null;
  #notes: HTMLUListElement | null = null;
  #status: HTMLElement | null = null;
  #primary: HTMLButtonElement | null = null;
  #later: HTMLButtonElement | null = null;
  #update: UpdateAvailableDetail | null = null;
  #required = false;
  #restartOnly = false;
  #ready = false;

  connectedCallback(): void {
    if (this.#ready) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;

    this.#title = h('h2');
    this.#version = h('span', { className: 'version' });
    this.#message = h('p', { className: 'message' });
    this.#notes = h('ul') as HTMLUListElement;
    this.#status = h('p', { className: 'status', ariaLive: 'polite' });
    this.#primary = h('button', {
      className: 'primary',
      type: 'button',
      textContent: 'Update & Restart',
    }) as HTMLButtonElement;
    this.#later = h('button', {
      className: 'secondary',
      type: 'button',
      textContent: 'Later',
    }) as HTMLButtonElement;

    this.#dialog = h('dialog', {}, [
      h('header', {}, [this.#title, this.#version]),
      h('div', { className: 'body' }, [this.#message, this.#notes, this.#status]),
      h('div', { className: 'actions' }, [this.#later, this.#primary]),
    ]) as HTMLDialogElement;

    this.#primary.addEventListener('click', () => this.#accept());
    this.#later.addEventListener('click', () => this.#dismiss());
    this.#dialog.addEventListener('cancel', event => {
      if (this.#required) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      this.#dismiss();
    });
    this.#dialog.addEventListener('click', event => {
      if (event.target === this.#dialog && !this.#required) this.#dismiss();
    });

    shadow.append(style, this.#dialog);
    this.#ready = true;
  }

  show(update: UpdateAvailableDetail): void {
    this.#ensureReady();
    this.#update = update;
    this.#required = update.required;
    this.#restartOnly = false;
    this.#renderRelease(update.pending);
    if (this.#message) {
      this.#message.textContent = update.required
        ? 'This app-shell update is required to continue safely. Your campaign will be saved before restart.'
        : 'A new version is installed and ready to use.';
    }
    if (this.#later) this.#later.hidden = update.required;
    this.#resetActions('Update & Restart');
    this.#open();
  }

  showRestartRequired(release: UpdateRelease | null): void {
    this.#ensureReady();
    this.#update = null;
    this.#required = true;
    this.#restartOnly = true;
    if (this.#title) this.#title.textContent = 'UPDATE INSTALLED';
    if (this.#version) this.#version.textContent = release ? `VERSION ${release.version}` : '';
    if (this.#message) {
      this.#message.textContent =
        'Another tab installed an update. Restart this session before continuing.';
    }
    this.#renderNotes(release?.highlights ?? []);
    if (this.#later) this.#later.hidden = true;
    this.#resetActions('Restart');
    this.#open();
  }

  showUnavailable(message: string): void {
    this.#ensureReady();
    this.#update = null;
    this.#required = false;
    this.#restartOnly = false;
    if (this.#title) this.#title.textContent = 'UPDATE UNAVAILABLE';
    if (this.#version) this.#version.textContent = '';
    if (this.#message) this.#message.textContent = message;
    this.#renderNotes([]);
    if (this.#primary) this.#primary.hidden = true;
    if (this.#later) {
      this.#later.hidden = false;
      this.#later.textContent = 'Continue Current Version';
    }
    this.#clearStatus();
    this.#open();
  }

  showUpdating(status = 'Activating the new version…'): void {
    if (this.#primary) this.#primary.disabled = true;
    if (this.#later) this.#later.disabled = true;
    if (this.#status) {
      this.#status.className = 'status visible';
      this.#status.replaceChildren(
        h('span', { className: 'spinner', ariaHidden: 'true' }),
        document.createTextNode(status)
      );
    }
  }

  showFailure(message: string): void {
    if (this.#status) {
      this.#status.className = 'status visible error';
      this.#status.textContent = message;
    }
    if (this.#primary) {
      this.#primary.disabled = false;
      this.#primary.hidden = false;
      this.#primary.textContent = this.#restartOnly ? 'Retry Restart' : 'Retry Update';
      this.#primary.focus();
    }
    if (this.#later) this.#later.disabled = false;
  }

  hide(): void {
    if (this.#dialog?.open) this.#dialog.close();
    this.style.display = 'none';
  }

  get isOpen(): boolean {
    return Boolean(this.#dialog?.open);
  }

  get pendingWorkerInstance(): ServiceWorker | null {
    return this.#update?.pendingWorker ?? null;
  }

  #ensureReady(): void {
    if (!this.#ready) this.connectedCallback();
  }

  #renderRelease(release: UpdateRelease): void {
    if (this.#title) this.#title.textContent = `WHAT'S NEW // ${release.title}`;
    if (this.#version) this.#version.textContent = `VERSION ${release.version}`;
    this.#renderNotes(release.highlights);
  }

  #renderNotes(highlights: readonly string[]): void {
    this.#notes?.replaceChildren(...highlights.map(text => h('li', { textContent: text })));
    if (this.#notes) this.#notes.hidden = highlights.length === 0;
  }

  #resetActions(primaryLabel: string): void {
    this.#clearStatus();
    if (this.#primary) {
      this.#primary.hidden = false;
      this.#primary.disabled = false;
      this.#primary.textContent = primaryLabel;
    }
    if (this.#later) {
      this.#later.disabled = false;
      this.#later.textContent = 'Later';
    }
  }

  #clearStatus(): void {
    if (!this.#status) return;
    this.#status.className = 'status';
    this.#status.replaceChildren();
  }

  #open(): void {
    if (!this.#dialog) return;
    this.style.display = 'block';
    this.#dialog.classList.toggle('required', this.#required);
    if (!this.#dialog.open) this.#dialog.showModal();
    this.#primary?.focus();
  }

  #accept(): void {
    this.showUpdating(this.#restartOnly ? 'Restarting with the installed version…' : undefined);
    this.dispatchEvent(
      new CustomEvent(this.#restartOnly ? 'update-restart-requested' : 'update-accepted', {
        detail: this.#update ? { pendingWorker: this.#update.pendingWorker } : undefined,
        bubbles: true,
        composed: true,
      })
    );
  }

  #dismiss(): void {
    this.dispatchEvent(new CustomEvent('update-dismissed', { bubbles: true, composed: true }));
    this.hide();
  }
}

customElements.define('update-notification', UpdateNotification);

export default UpdateNotification;
