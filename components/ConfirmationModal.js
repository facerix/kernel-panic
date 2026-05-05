/**
 * ConfirmationModal Web Component
 * Generic-styled confirmation dialog. Uses CSS variables for theming.
 *
 * Usage:
 *   const modal = document.querySelector('confirmation-modal');
 *   modal.addEventListener('confirm', () => { ... });
 *   modal.addEventListener('cancel', () => { ... });
 *   modal.showModal('Are you sure you want to delete this?', { optionalContext });
 *
 * CSS variables for customization (set on :host or a parent):
 *   --confirmation-primary: #4a4a4a
 *   --confirmation-border: rgba(0, 0, 0, 0.12)
 *   --confirmation-focus: rgba(74, 74, 74, 0.4)
 *   --confirmation-bg: #ffffff
 *   --confirmation-header-bg: #f5f5f5
 */

import { h, CreateSvg } from '../src/domUtils.js';

const closeIconSvg = CreateSvg(
  '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  '24',
  '24'
);

const CSS = `
:host {
  --confirmation-primary: #4a4a4a;
  --confirmation-border: rgba(0, 0, 0, 0.12);
  --confirmation-focus: rgba(74, 74, 74, 0.4);
  --confirmation-bg: #ffffff;
  --confirmation-header-bg: #f5f5f5;

  dialog[open] {
    display: flex;
    flex-direction: column;
    min-width: 0;
    max-width: min(480px, calc(100vw - 24px));
    width: min(90vw, calc(100vw - 24px));
    margin: auto;
    box-sizing: border-box;
    padding: 0;
    border: 1px solid var(--confirmation-border);
    border-radius: 8px;
    background-color: var(--confirmation-bg);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  }

  ::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  header {
    padding: 1em 1.5em;
    background-color: var(--confirmation-header-bg);
    border-bottom: 1px solid var(--confirmation-border);
    display: flex;
    justify-content: space-between;
    align-items: center;

    h3 {
      margin: 0;
      font-size: 1.25em;
      color: var(--confirmation-primary);
      font-weight: 500;
    }

    #close-modal {
      background: none;
      border: none;
      padding: 0;
      width: 1.5em;
      height: 1.5em;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--confirmation-primary);
    }

    #close-modal:hover {
      opacity: 0.7;
    }

    #close-modal:focus {
      outline: none;
    }

    #close-modal:focus-visible {
      outline: 2px solid var(--confirmation-focus);
      outline-offset: 2px;
    }
  }

  form {
    flex: 1;
    padding: 1.5em;
    display: flex;
    flex-direction: column;
    gap: 1.25em;

    #message {
      margin: 0;
      color: #303030;
      font-size: 1em;
      line-height: 1.5;
    }

    .actions {
      display: flex;
      gap: 0.75em;
      justify-content: flex-end;
      margin-top: 0.25em;
    }

    input[type="button"],
    input[type="submit"] {
      padding: 0.5em 1.25em;
      border: 1px solid var(--confirmation-border);
      border-radius: 6px;
      font-size: 0.95em;
      font-family: inherit;
      cursor: pointer;
      font-weight: 500;
      transition: background-color 0.2s ease, border-color 0.2s ease;
    }

    input:focus {
      outline: none;
    }

    input:focus-visible {
      outline: 2px solid var(--confirmation-focus);
      outline-offset: 2px;
    }

    #btnCancel {
      background-color: transparent;
      color: var(--confirmation-primary);
    }

    #btnCancel:hover {
      background-color: rgba(0, 0, 0, 0.05);
      border-color: var(--confirmation-primary);
    }

    #btnOk {
      background-color: var(--confirmation-primary);
      color: white;
      border: none;
    }

    #btnOk:hover {
      opacity: 0.9;
    }

    #btnOk:active {
      transform: scale(0.98);
    }
  }

  dialog,
  ::backdrop {
    transition: opacity 0.25s allow-discrete;
    opacity: 0;
  }

  dialog[open],
  dialog[open]::backdrop {
    opacity: 1;
  }

  @starting-style {
    dialog[open],
    dialog[open]::backdrop {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    @starting-style {
      dialog[open] {
        transform: translateY(-12px);
      }

      dialog[open],
      dialog[open]::backdrop {
        opacity: 0;
      }
    }

    dialog[open] {
      animation: confirmationSlideIn 0.25s ease;
    }
  }

  @keyframes confirmationSlideIn {
    from {
      transform: translateY(-12px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @media (max-width: 420px) {
    dialog[open] {
      width: calc(100vw - 16px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));
      max-width: none;
    }

    form .actions {
      flex-direction: column-reverse;
      align-items: stretch;
    }

    form .actions input {
      width: 100%;
    }
  }
}
`;

class ConfirmationModal extends HTMLElement {
  #ready = false;
  #message = '';
  #context = null;
  #modal = null;

  constructor() {
    super();
  }

  connectedCallback() {
    const shadow = this.attachShadow({ mode: 'open' });
    const styles = document.createElement('style');
    styles.innerHTML = CSS;
    shadow.appendChild(styles);

    const closeIcon = closeIconSvg.cloneNode(true);

    this.#modal = h('dialog', { closedby: 'any' }, [
      h('header', {}, [
        h('h3', { innerText: 'Confirmation' }),
        h('button', { id: 'close-modal' }, [closeIcon])
      ]),
      h('form', { method: 'dialog', autocomplete: 'off' }, [
        h('p', { id: 'message', innerText: 'Are you sure?' }),
        h('div', { className: 'actions' }, [
          h('input', { type: 'button', id: 'btnCancel', value: 'Cancel' }),
          h('input', { type: 'submit', id: 'btnOk', value: 'OK' })
        ])
      ])
    ]);
    shadow.appendChild(this.#modal);
  }

  #onClose(evt) {
    evt.preventDefault();
    this.#emit('cancel');
    this.#modal?.close();
  }

  #init() {
    const closeHandler = this.#onClose.bind(this);
    this.shadowRoot.querySelector('#close-modal').addEventListener('click', closeHandler);
    this.shadowRoot.querySelector('#btnCancel').addEventListener('click', closeHandler);

    this.shadowRoot.querySelector('dialog form').addEventListener('submit', evt => {
      if (evt.submitter?.id === 'btnOk') {
        this.#emit('confirm');
      }
      this.#modal?.close();
    });
    this.#ready = true;
  }

  #emit(eventName, detail = {}) {
    const payload = { ...detail };
    if (this.#context !== null) {
      payload.context = this.#context;
    }
    this.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  }

  render() {
    if (this.#ready) {
      this.shadowRoot.querySelector('#message').innerText = this.#message;
    }
  }

  /**
   * Show the confirmation modal
   * @param {string} message - The confirmation message to display
   * @param {*} [context] - Optional context passed to confirm/cancel event detail
   */
  showModal(message, context) {
    this.#message = message;
    this.#context = context ?? null;
    if (!this.#ready) {
      this.#init();
    }
    this.render();
    this.#modal?.showModal();
  }
}

customElements.define('confirmation-modal', ConfirmationModal);

export default ConfirmationModal;
