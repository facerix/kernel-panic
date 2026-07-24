// Typed boundary for the vendored TONEBENCH synthesis engine.
//
// This declaration file is OURS (Kernel Panic) — it is the reviewed contract
// through which our strict-TypeScript code consumes the untyped, vendored
// `tonebenchEngine.js`. It lets `tsc` type-check callers WITHOUT enabling
// `allowJs` (the compiler reads this .d.ts and never looks inside the .js).
//
// Keep this in sync with the vendored engine's public exports. If a future
// re-vendor changes the engine's API, the mismatch should surface as a build
// error here — that is the point. Do NOT edit tonebenchEngine.js to match us;
// re-vendor from ToneBench and update this boundary instead. See README.md.

export type WaveType = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise';

export type FilterType = 'none' | 'lowpass' | 'highpass' | 'bandpass' | 'notch';

/** One synthesized hit: source + envelope + filter + distortion + delay + reverb. */
export interface SynthParams {
  waveType: WaveType;
  freqStart: number;
  freqEnd: number;
  attack: number;
  decay: number;
  sustainLevel: number;
  sustainTime: number;
  release: number;
  filterType: FilterType;
  filterCutoff: number;
  filterQ: number;
  distortion: number;
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  reverbDecay: number;
  reverbMix: number;
  volume: number;
}

export interface MutateOptions {
  jitterAmount?: number;
}

export const WAVE_TYPES: readonly WaveType[];
export const FREQ_MIN: number;
export const FREQ_MAX: number;
export const CUTOFF_MIN: number;
export const CUTOFF_MAX: number;

/** Maps a linear 0-100 slider position onto an exponential frequency range. */
export function sliderToFreq(v: number, min: number, max: number): number;

/** Inverse of sliderToFreq: frequency back onto a 0-100 slider position. */
export function freqToSlider(f: number, min: number, max: number): number;

/** Total play-out time: attack + decay + sustainTime + release. */
export function getDuration(p: SynthParams): number;

/**
 * Builds the full signal chain for one params object and schedules playback.
 * Safe against a live `AudioContext` or an `OfflineAudioContext`.
 * `when` defaults to `ctx.currentTime`; `destination` defaults to `ctx.destination`.
 */
export function playSound(
  ctx: BaseAudioContext,
  p: SynthParams,
  when?: number,
  destination?: AudioNode
): { source: AudioScheduledSourceNode; duration: number };

/** Encodes a rendered audio buffer as 16-bit PCM WAV bytes. */
export function bufferToWav(buffer: AudioBuffer): ArrayBuffer;

/**
 * Renders a hit through an `OfflineAudioContext` and returns WAV bytes.
 * Browser-only (needs a real Web Audio implementation).
 */
export function renderToWav(p: SynthParams, sampleRate?: number): Promise<ArrayBuffer>;

/** Returns a new params object with several fields randomly jittered. Pure. */
export function mutate(p: SynthParams, opts?: MutateOptions): SynthParams;
