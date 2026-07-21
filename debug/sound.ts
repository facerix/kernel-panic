/**
 * Sound test harness — every def in `src/audio/sounds.ts`, playable on demand
 * through the real `AudioManager` (soundBoard's production singleton, wired to
 * the vendored TONEBENCH engine). No game state: this is a synth palette
 * browser, not a scenario harness like index.ts/map.ts.
 *
 * `KERNEL_PANIC_DEFS` is sounds.ts's own single source of truth (see its
 * docstring), so the sound grid is generated from `Object.keys()` rather than
 * a hand-maintained list here — add a sound there and it appears here for free.
 *
 * Sequences/chains (`playSequence`, `playChain`) re-pitch or chain a base def
 * rather than defining a new one, so they're listed separately with their
 * step data rather than mixed into the flat sound grid.
 */
import { h } from '/src/domUtils.js';
import { audioManager } from '/src/audio/soundBoard.js';
import {
  KERNEL_PANIC_DEFS,
  EXTRACTION_MOTIF,
  TRANSACTION_MOTIF,
  type SoundName,
  type SequenceStep,
} from '/src/audio/sounds.js';
import {
  AUDIO_MUTED_PREF,
  AUDIO_VOLUME_PREF,
  DEFAULT_VOLUME,
  parseAudioPrefs,
} from '/src/audio/AudioManager.js';
import dataStore from '/src/DataStore.js';

const VOLUME_STEPS = 100;

const soundNames = Object.keys(KERNEL_PANIC_DEFS) as SoundName[];

/** Turret deploy's two-beat chain, matching sceneListeners.ts's TURRET_DEPLOYED handler. */
const DEPLOY_CHAIN: readonly { name: SoundName; when: number }[] = [
  { name: 'deploy', when: 0 },
  { name: 'deployOnline', when: 0.09 },
];

let muted = false;
let volume = DEFAULT_VOLUME;
let soundBtn: HTMLButtonElement;
let volumeInput: HTMLInputElement;
let volumeReadout: HTMLElement;
let statusEl: HTMLElement;
let paramsEl: HTMLElement;
let playCount = 0;

function timestamp() {
  return new Date().toLocaleTimeString(undefined, { hour12: false });
}

function setStatus(label: string) {
  playCount += 1;
  statusEl.textContent = `> [${timestamp()}] #${playCount} played: ${label}${muted ? '  (muted — no sound)' : ''}`;
}

function setParams(value: unknown) {
  paramsEl.textContent = JSON.stringify(value, null, 2);
}

function markActive(grid: HTMLElement, btn: HTMLButtonElement) {
  for (const child of Array.from(grid.children)) {
    if (child instanceof HTMLButtonElement) child.setAttribute('aria-pressed', 'false');
  }
  btn.setAttribute('aria-pressed', 'true');
}

function playSound(name: SoundName, grid: HTMLElement, btn: HTMLButtonElement) {
  audioManager.resume();
  audioManager.play(name);
  markActive(grid, btn);
  setStatus(`"${name}"`);
  setParams(KERNEL_PANIC_DEFS[name]);
}

function playMotif(
  label: string,
  base: SoundName,
  steps: readonly SequenceStep[],
  grid: HTMLElement,
  btn: HTMLButtonElement
) {
  audioManager.resume();
  audioManager.playSequence(base, steps);
  markActive(grid, btn);
  setStatus(`"${label}" (playSequence base="${base}")`);
  setParams({ base, steps });
}

function playChain(
  label: string,
  steps: readonly { name: SoundName; when: number }[],
  grid: HTMLElement,
  btn: HTMLButtonElement
) {
  audioManager.resume();
  audioManager.playChain(steps);
  markActive(grid, btn);
  setStatus(`"${label}" (playChain)`);
  setParams({ steps });
}

function buildSoundGrid() {
  const grid = document.getElementById('sound-grid') as HTMLElement;
  const buttons = soundNames.map(name => {
    const btn = h('button', {
      type: 'button',
      className: 'sound-btn',
      'aria-pressed': 'false',
      textContent: name,
    }) as HTMLButtonElement;
    btn.addEventListener('click', () => playSound(name, grid, btn));
    return btn;
  });
  grid.append(...buttons);
}

function buildSequenceGrid() {
  const grid = document.getElementById('sequence-grid') as HTMLElement;

  const extractionBtn = h('button', {
    type: 'button',
    className: 'sound-btn',
    'aria-pressed': 'false',
    textContent: 'extracted (EXTRACTION_MOTIF)',
  }) as HTMLButtonElement;
  extractionBtn.addEventListener('click', () =>
    playMotif('EXTRACTION_MOTIF', 'extracted', EXTRACTION_MOTIF, grid, extractionBtn)
  );

  const transactionBtn = h('button', {
    type: 'button',
    className: 'sound-btn',
    'aria-pressed': 'false',
    textContent: 'transaction (TRANSACTION_MOTIF)',
  }) as HTMLButtonElement;
  transactionBtn.addEventListener('click', () =>
    playMotif('TRANSACTION_MOTIF', 'transaction', TRANSACTION_MOTIF, grid, transactionBtn)
  );

  const deployChainBtn = h('button', {
    type: 'button',
    className: 'sound-btn',
    'aria-pressed': 'false',
    textContent: 'deploy → deployOnline (chain)',
  }) as HTMLButtonElement;
  deployChainBtn.addEventListener('click', () =>
    playChain('turret deploy chain', DEPLOY_CHAIN, grid, deployChainBtn)
  );

  grid.append(extractionBtn, transactionBtn, deployChainBtn);
}

function renderAudioControls() {
  if (soundBtn) soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
  if (soundBtn) soundBtn.textContent = muted ? 'OFF' : 'ON';
  if (volumeInput) {
    volumeInput.value = String(Math.round(volume * VOLUME_STEPS));
    volumeInput.disabled = muted;
  }
  if (volumeReadout) volumeReadout.textContent = `${Math.round(volume * 100)}%`;
}

function buildAudioControls() {
  const container = document.getElementById('audio-controls') as HTMLElement;

  soundBtn = h('button', {
    type: 'button',
    className: 'control',
    'aria-pressed': 'false',
  }) as HTMLButtonElement;
  soundBtn.addEventListener('click', () => {
    muted = !muted;
    dataStore.setPref(AUDIO_MUTED_PREF, muted);
    renderAudioControls();
  });

  volumeInput = h('input', {
    type: 'range',
    min: '0',
    max: String(VOLUME_STEPS),
    step: '1',
    'aria-label': 'Volume',
  }) as HTMLInputElement;
  volumeInput.addEventListener('input', () => {
    volume = Math.min(1, Math.max(0, Number(volumeInput.value) / VOLUME_STEPS));
    dataStore.setPref(AUDIO_VOLUME_PREF, volume);
    renderAudioControls();
  });

  volumeReadout = h('span', { className: 'readout' });

  container.append(
    h('label', {}, [h('span', { textContent: 'Sound' }), soundBtn]),
    h('label', {}, [h('span', { textContent: 'Volume' }), volumeInput, volumeReadout])
  );
}

statusEl = document.getElementById('sound-status') as HTMLElement;
paramsEl = document.getElementById('sound-params') as HTMLElement;

// Read persisted prefs once at load; the settings modal (if opened in another
// tab) isn't listened for here — this page's own controls are the source of
// truth for the rest of this session, matching its read-once-per-open pattern.
({ muted, volume } = parseAudioPrefs(dataStore.prefs));

buildAudioControls();
buildSoundGrid();
buildSequenceGrid();
renderAudioControls();
