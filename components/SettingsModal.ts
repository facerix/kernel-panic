/**
 * <settings-modal> — player preferences. The app's first real DataStore.prefs
 * UI; audio (mute + volume) is the pathfinder consumer, and future prefs plug
 * in here.
 *
 * Data flow is one-way: this modal writes prefs to DataStore; AudioManager is
 * subscribed to DataStore's `change` event and reacts (updates the master gain).
 * The modal never talks to AudioManager directly. It reads current values from
 * DataStore.prefs each time it opens.
 *
 * Events:
 *   - `dismiss` — player pressed Esc / clicked the backdrop / hit CLOSE.
 */

import { h } from '/src/domUtils.js';
import dataStore from '/src/DataStore.js';
import {
  AUDIO_MUTED_PREF,
  AUDIO_VOLUME_PREF,
  DEFAULT_VOLUME,
  parseAudioPrefs,
} from '/src/audio/AudioManager.js';

const CSS = `
:host {
  --settings-bg: rgba(7, 18, 16, 0.96);
  --settings-border: var(--accent-color, #00d9a5);
  --settings-text: #c5efdf;
  --settings-dim: #6ae8c8;
  --settings-accent: var(--accent-color, #00d9a5);
  --settings-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  position: fixed;
  inset: 0;
  z-index: 50;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--settings-text);
}

:host([open]) {
  display: flex;
}

.panel {
  background: var(--settings-bg);
  border: 1px solid var(--settings-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.4rem;
  box-shadow: var(--settings-shadow);
  min-width: min(420px, 92vw);
  max-width: min(520px, 96vw);
}

.title {
  margin: 0 0 1rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--settings-accent);
  border-bottom: 1px dashed var(--settings-border);
  padding-bottom: 0.5rem;
}

.section-label {
  margin: 0 0 0.6rem;
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  color: var(--settings-dim);
}

.row {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.75rem 1rem;
  align-items: center;
  margin-bottom: 0.9rem;
}

.row-name {
  font-size: 0.82rem;
  letter-spacing: 0.06em;
  color: var(--settings-text);
}

button.control,
button.close {
  appearance: none;
  -webkit-appearance: none;
  background: rgba(0, 217, 165, 0.08);
  color: var(--settings-text);
  border: 1px solid rgba(0, 217, 165, 0.45);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  font: inherit;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  cursor: pointer;
  min-height: 32px;
}

button.control[aria-pressed='true'] {
  border-color: var(--settings-accent);
  background: rgba(0, 217, 165, 0.2);
  color: var(--settings-accent);
}

button.control:hover,
button.control:focus-visible,
button.close:hover,
button.close:focus-visible {
  outline: none;
  border-color: var(--settings-accent);
  background: rgba(0, 217, 165, 0.18);
}

.volume-cell {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

input[type='range'] {
  flex: 1;
  accent-color: var(--settings-accent);
  cursor: pointer;
  min-width: 0;
}

input[type='range']:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.volume-readout {
  font-size: 0.78rem;
  color: var(--settings-dim);
  min-width: 3ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.footer {
  margin-top: 1rem;
  display: flex;
  justify-content: center;
}

.hint {
  margin: 0.85rem 0 0;
  text-align: center;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  color: var(--settings-dim);
}
`;

/** Volume slider granularity: 0–100 integer, mapped to the 0–1 pref. */
const VOLUME_STEPS = 100;

class SettingsModal extends HTMLElement {
  #ready = false;
  #panelEl: HTMLElement | null = null;
  #soundBtn: HTMLButtonElement | null = null;
  #volumeInput: HTMLInputElement | null = null;
  #volumeReadout: HTMLElement | null = null;

  #muted = false;
  #volume = DEFAULT_VOLUME;

  #onKeyDown: ((this: HTMLElement, ev: KeyboardEvent) => void) | null = null;
  #onBackdrop: ((this: HTMLElement, ev: MouseEvent) => void) | null = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#soundBtn = h('button', {
      type: 'button',
      className: 'control',
      'aria-pressed': 'false',
    }) as HTMLButtonElement;
    this.#soundBtn.addEventListener('click', () => this.#toggleMuted());

    this.#volumeInput = h('input', {
      type: 'range',
      min: '0',
      max: String(VOLUME_STEPS),
      step: '1',
      'aria-label': 'Volume',
    }) as HTMLInputElement;
    // `input` fires continuously as the player drags — write each step so the
    // master gain tracks live via DataStore → AudioManager.
    this.#volumeInput.addEventListener('input', () => this.#onVolumeInput());

    this.#volumeReadout = h('span', { className: 'volume-readout' });

    const closeBtn = h('button', {
      type: 'button',
      className: 'close',
      textContent: 'CLOSE',
    }) as HTMLButtonElement;
    closeBtn.addEventListener('click', () => this.#emit('dismiss'));

    this.#panelEl = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: '── OPTIONS ──' }),
      h('p', { className: 'section-label', textContent: 'AUDIO' }),
      h('div', { className: 'row' }, [
        h('span', { className: 'row-name', textContent: 'Sound' }),
        this.#soundBtn,
      ]),
      h('div', { className: 'row' }, [
        h('span', { className: 'row-name', textContent: 'Volume' }),
        h('div', { className: 'volume-cell' }, [this.#volumeInput, this.#volumeReadout]),
      ]),
      h('div', { className: 'footer' }, [closeBtn]),
      h('p', { className: 'hint', textContent: 'Esc close' }),
    ]);
    shadow.appendChild(this.#panelEl);

    this.#onKeyDown = evt => {
      if (!this.isOpen) return;
      if (evt.key === 'Escape') {
        evt.preventDefault();
        this.#emit('dismiss');
      }
    };
    this.addEventListener('keydown', this.#onKeyDown);
    this.#onBackdrop = evt => {
      if (!evt.composedPath().includes(this.#panelEl as EventTarget)) this.#emit('dismiss');
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    this.#render();
  }

  disconnectedCallback() {
    if (this.#onKeyDown) this.removeEventListener('keydown', this.#onKeyDown);
    if (this.#onBackdrop) this.removeEventListener('click', this.#onBackdrop);
  }

  show() {
    // Pull the latest persisted values every open — the store is the source of truth.
    ({ muted: this.#muted, volume: this.#volume } = parseAudioPrefs(dataStore.prefs));
    this.setAttribute('open', '');
    this.#render();
    queueMicrotask(() => this.#soundBtn?.focus());
  }

  hide() {
    this.removeAttribute('open');
  }

  get isOpen() {
    return this.hasAttribute('open');
  }

  #toggleMuted() {
    this.#muted = !this.#muted;
    dataStore.setPref(AUDIO_MUTED_PREF, this.#muted);
    this.#render();
  }

  #onVolumeInput() {
    if (!this.#volumeInput) return;
    const steps = Number(this.#volumeInput.value);
    this.#volume = Math.min(1, Math.max(0, steps / VOLUME_STEPS));
    dataStore.setPref(AUDIO_VOLUME_PREF, this.#volume);
    this.#syncVolumeReadout();
  }

  #render() {
    if (!this.#ready) return;
    if (this.#soundBtn) {
      this.#soundBtn.setAttribute('aria-pressed', this.#muted ? 'false' : 'true');
      this.#soundBtn.textContent = this.#muted ? 'OFF' : 'ON';
    }
    if (this.#volumeInput) {
      this.#volumeInput.value = String(Math.round(this.#volume * VOLUME_STEPS));
      this.#volumeInput.disabled = this.#muted;
    }
    this.#syncVolumeReadout();
  }

  #syncVolumeReadout() {
    if (this.#volumeReadout) {
      this.#volumeReadout.textContent = `${Math.round(this.#volume * 100)}%`;
    }
  }

  #emit(eventName: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

customElements.define('settings-modal', SettingsModal);

export default SettingsModal;
