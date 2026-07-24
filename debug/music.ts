/**
 * Music test harness — the generative score driven by hand, with no game state.
 *
 * This is the primary tuning tool for `src/audio/music.ts`. The unit tests can
 * prove structural things (the bed has no holes, pitches stay in scale, layers
 * gate on tension) but not that the result is pleasant, so the defs get tuned by
 * ear here and the tests keep the invariants honest.
 *
 * It plays through the real `audioManager` (so the music bus, the shared FX and
 * the volume prefs are all the production ones) but drives its own
 * `MusicDirector` instead of the `musicDirector` singleton. That is deliberate:
 * the harness needs to observe every scheduled note, and tapping the singleton
 * would mean monkey-patching the sink the shell also uses. Composing a second
 * director over the same sink costs nothing — the director holds no state the
 * shell cares about — and keeps production wiring untouched.
 */
import { h } from '/src/domUtils.js';
import { audioManager } from '/src/audio/soundBoard.js';
import { MusicDirector } from '/src/audio/MusicDirector.js';
import {
  MUSIC_DEFS,
  TENSION_CONFIG,
  type MusicTension,
  type MusicPaletteName,
  type MusicVoiceName,
  type MusicModulation,
} from '/src/audio/music.js';
import {
  AUDIO_MUSIC_MUTED_PREF,
  AUDIO_MUSIC_VOLUME_PREF,
  AUDIO_MUTED_PREF,
  AUDIO_VOLUME_PREF,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_VOLUME,
  parseAudioPrefs,
} from '/src/audio/AudioManager.js';
import dataStore from '/src/DataStore.js';

const VOLUME_STEPS = 100;
/** Keep the log bounded — the bed emits continuously. */
const MUSIC_LOG_LIMIT = 300;

const TENSIONS: MusicTension[] = [0, 1, 2];
const TENSION_LABELS: Record<MusicTension, string> = {
  0: '0 — hub (pad only)',
  1: '1 — run baseline (full bed)',
  2: '2 — alarm (kinetic)',
};
const PALETTES: MusicPaletteName[] = ['meat', 'cyber'];

const VOICE_NAMES = Object.keys(MUSIC_DEFS) as MusicVoiceName[];

let muted = false;
let volume = DEFAULT_VOLUME;
let musicMuted = false;
let musicVolume = DEFAULT_MUSIC_VOLUME;

let statusEl: HTMLElement;
let logEl: HTMLElement;
let startBtn: HTMLButtonElement;
const tensionBtns = new Map<MusicTension, HTMLButtonElement>();
const paletteBtns = new Map<MusicPaletteName, HTMLButtonElement>();
const controls: Record<
  string,
  { btn: HTMLButtonElement; slider: HTMLInputElement; readout: HTMLElement }
> = {};

const logLines: string[] = [];
/** Re-reads each sweep slider from the bus — run after the director changes it. */
const sweepSyncs: (() => void)[] = [];

/**
 * Recovers a voice name from a scheduled def. The director re-pitches a base
 * def, so every field except the two frequencies still identifies the voice.
 */
function voiceOf(def: (typeof MUSIC_DEFS)[MusicVoiceName]): string {
  for (const name of VOICE_NAMES) {
    const base = MUSIC_DEFS[name];
    let matches = true;
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      if (key === 'freqStart' || key === 'freqEnd') continue;
      if (base[key] !== def[key]) {
        matches = false;
        break;
      }
    }
    if (matches) return name;
  }
  return '(unknown)';
}

function logNote(def: (typeof MUSIC_DEFS)[MusicVoiceName], when: number) {
  const rel = when - audioManager.currentTime;
  logLines.push(
    `${when.toFixed(3)}  (+${rel.toFixed(3)})  ${voiceOf(def).padEnd(14)} ${def.freqStart.toFixed(1)} Hz`
  );
  if (logLines.length > MUSIC_LOG_LIMIT) logLines.splice(0, logLines.length - MUSIC_LOG_LIMIT);
  logEl.textContent = logLines.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}

/** The harness's own director: real sink, real audio clock, observable notes. */
const musicDirector = new MusicDirector({
  emit: (def, when) => {
    audioManager.playMusicNote(def, when);
    logNote(def as (typeof MUSIC_DEFS)[MusicVoiceName], when);
  },
  modulate: modulation => audioManager.setMusicModulation(modulation),
  now: () => audioManager.currentTime,
  schedule: (fn, ms) => globalThis.setInterval(fn, ms) as unknown as number,
  cancel: id => globalThis.clearInterval(id),
  seed: 1234,
});

function setStatus(message: string) {
  const cfg = TENSION_CONFIG[musicDirector.tension];
  const bar = (cfg.secondsPerBeat * cfg.beatsPerBar).toFixed(2);
  statusEl.textContent =
    `> ${message} — ${musicDirector.running ? 'RUNNING' : 'STOPPED'}, ` +
    `palette ${musicDirector.palette}, tension ${musicDirector.tension} ` +
    `(beat ${cfg.secondsPerBeat}s, bar ${bar}s)` +
    `${musicMuted ? '  [music muted — no sound]' : ''}` +
    `${muted ? '  [all audio muted]' : ''}`;
}

function render() {
  startBtn.textContent = musicDirector.running ? 'STOP' : 'START';
  startBtn.setAttribute('aria-pressed', musicDirector.running ? 'true' : 'false');
  for (const [tension, btn] of tensionBtns) {
    // Reflects what is actually sounding, which lags a requested change by up
    // to one bar — that deferral is the behaviour worth being able to see.
    btn.setAttribute('aria-pressed', musicDirector.tension === tension ? 'true' : 'false');
  }
  for (const [palette, btn] of paletteBtns) {
    btn.setAttribute('aria-pressed', musicDirector.palette === palette ? 'true' : 'false');
  }

  const sfx = controls.sfx;
  sfx.btn.setAttribute('aria-pressed', muted ? 'false' : 'true');
  sfx.btn.textContent = muted ? 'OFF' : 'ON';
  sfx.slider.value = String(Math.round(volume * VOLUME_STEPS));
  sfx.slider.disabled = muted;
  sfx.readout.textContent = `${Math.round(volume * 100)}%`;

  const music = controls.music;
  music.btn.setAttribute('aria-pressed', musicMuted ? 'false' : 'true');
  music.btn.textContent = musicMuted ? 'OFF' : 'ON';
  music.slider.value = String(Math.round(musicVolume * VOLUME_STEPS));
  music.slider.disabled = musicMuted;
  music.readout.textContent = `${Math.round(musicVolume * 100)}%`;

  for (const sync of sweepSyncs) sync();
}

function toggleRunning() {
  audioManager.resume();
  if (musicDirector.running) {
    musicDirector.stop();
    audioManager.stopMusic();
    setStatus('stopped');
  } else {
    musicDirector.start();
    setStatus('started');
  }
  render();
}

function buildTransport() {
  const container = document.getElementById('music-controls') as HTMLElement;

  startBtn = h('button', { type: 'button', className: 'control' }) as HTMLButtonElement;
  startBtn.addEventListener('click', toggleRunning);

  const tensionRow = h('span', { className: 'btn-row' });
  for (const tension of TENSIONS) {
    const btn = h('button', {
      type: 'button',
      className: 'control',
      'aria-pressed': 'false',
      textContent: TENSION_LABELS[tension],
    }) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      musicDirector.setTension(tension);
      // Deliberately not re-rendering the active state immediately: the change
      // lands on the next bar, and the buttons show what is sounding.
      setStatus(`tension ${tension} requested (lands next bar)`);
      render();
    });
    tensionBtns.set(tension, btn);
    tensionRow.append(btn);
  }

  const paletteRow = h('span', { className: 'btn-row' });
  for (const palette of PALETTES) {
    const btn = h('button', {
      type: 'button',
      className: 'control',
      'aria-pressed': 'false',
      textContent: palette,
    }) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      musicDirector.setPalette(palette);
      setStatus(`palette ${palette} requested (lands next bar)`);
      render();
    });
    paletteBtns.set(palette, btn);
    paletteRow.append(btn);
  }

  const seedInput = h('input', {
    type: 'number',
    value: '1234',
    'aria-label': 'Seed',
  }) as HTMLInputElement;
  const reseedBtn = h('button', {
    type: 'button',
    className: 'control',
    textContent: 'RESEED',
  }) as HTMLButtonElement;
  reseedBtn.addEventListener('click', () => {
    const seed = Number(seedInput.value);
    if (!Number.isFinite(seed)) {
      setStatus('seed must be a finite number');
      return;
    }
    musicDirector.reseed(seed >>> 0);
    setStatus(`reseeded to ${seed >>> 0}`);
  });

  const clearBtn = h('button', {
    type: 'button',
    className: 'control',
    textContent: 'CLEAR LOG',
  }) as HTMLButtonElement;
  clearBtn.addEventListener('click', () => {
    logLines.length = 0;
    logEl.textContent = '(cleared)';
  });

  container.append(
    h('label', {}, [h('span', { textContent: 'Transport' }), startBtn]),
    h('label', {}, [h('span', { textContent: 'Tension' }), tensionRow]),
    h('label', {}, [h('span', { textContent: 'Palette' }), paletteRow]),
    h('label', {}, [h('span', { textContent: 'Seed' }), seedInput, reseedBtn]),
    ...buildSweepControls(),
    buildChannel('sfx', 'Sound', AUDIO_MUTED_PREF, AUDIO_VOLUME_PREF),
    buildChannel('music', 'Music', AUDIO_MUSIC_MUTED_PREF, AUDIO_MUSIC_VOLUME_PREF),
    h('label', {}, [clearBtn])
  );
}

/**
 * Live controls for the bus filter sweep — the alarm's signal.
 *
 * These write straight to `AudioManager`, bypassing the tension table, so the
 * values can be found by ear. The director only pushes modulation when the
 * sounding tension or palette actually *changes*, so a hand-dialled setting
 * survives until you press a tension button — at which point it snaps back to
 * whatever `TENSION_CONFIG` says, which is also how you A/B a candidate against
 * the committed value.
 */
function buildSweepControls(): HTMLElement[] {
  const spec: {
    key: keyof MusicModulation;
    label: string;
    min: number;
    max: number;
    step: number;
    unit: string;
  }[] = [
    { key: 'baseCutoff', label: 'Cutoff', min: 200, max: 12000, step: 50, unit: 'Hz' },
    { key: 'q', label: 'Resonance', min: 0.5, max: 12, step: 0.1, unit: 'Q' },
    { key: 'depthCents', label: 'Depth', min: 0, max: 4800, step: 50, unit: '¢' },
    { key: 'hz', label: 'LFO rate', min: 0.05, max: 6, step: 0.05, unit: 'Hz' },
  ];

  const current = () => audioManager.musicModulation ?? musicDirector.modulation;
  const rows: HTMLElement[] = [];

  for (const field of spec) {
    const slider = h('input', {
      type: 'range',
      min: String(field.min),
      max: String(field.max),
      step: String(field.step),
      'aria-label': field.label,
    }) as HTMLInputElement;
    const readout = h('span', { className: 'readout' });

    const sync = () => {
      const value = current()[field.key];
      slider.value = String(value);
      readout.textContent = `${Math.round(value * 100) / 100} ${field.unit}`;
    };
    slider.addEventListener('input', () => {
      audioManager.setMusicModulation({ ...current(), [field.key]: Number(slider.value) });
      sync();
    });
    sweepSyncs.push(sync);
    rows.push(h('label', {}, [h('span', { textContent: field.label }), slider, readout]));
  }
  return rows;
}

function buildChannel(
  key: string,
  label: string,
  mutedPref: string,
  volumePref: string
): HTMLElement {
  const btn = h('button', {
    type: 'button',
    className: 'control',
    'aria-pressed': 'false',
  }) as HTMLButtonElement;
  btn.addEventListener('click', () => {
    if (key === 'sfx') {
      muted = !muted;
      dataStore.setPref(mutedPref, muted);
    } else {
      musicMuted = !musicMuted;
      dataStore.setPref(mutedPref, musicMuted);
    }
    render();
  });

  const slider = h('input', {
    type: 'range',
    min: '0',
    max: String(VOLUME_STEPS),
    step: '1',
    'aria-label': `${label} volume`,
  }) as HTMLInputElement;
  slider.addEventListener('input', () => {
    const value = Math.min(1, Math.max(0, Number(slider.value) / VOLUME_STEPS));
    if (key === 'sfx') volume = value;
    else musicVolume = value;
    dataStore.setPref(volumePref, value);
    render();
  });

  const readout = h('span', { className: 'readout' });
  controls[key] = { btn, slider, readout };
  return h('label', {}, [h('span', { textContent: label }), btn, slider, readout]);
}

statusEl = document.getElementById('music-status') as HTMLElement;
logEl = document.getElementById('music-log') as HTMLElement;

({ muted, volume, musicMuted, musicVolume } = parseAudioPrefs(dataStore.prefs));

buildTransport();
render();
setStatus('ready — press START (Web Audio needs a gesture first)');
