// Runtime owner of the game's audio.
//
// Holds the single shared AudioContext and a master GainNode through which every
// sound is routed — so mute/volume is one gain, without touching the vendored
// TONEBENCH engine (which already accepts a `destination` node per call).
//
// Web Audio policy: a context can't produce sound until created/resumed after a
// user gesture. `resume()` is called from the first keydown/pointerdown in
// `shellRuntime.boot()`. Before that, `play()` is a safe no-op.
//
// Testability (per project memory: guard the model contract, not shell wiring):
// every environment dependency — the context factory, the synth function, and
// the prefs source — is injectable, so the contract is unit-testable under
// `node --test` where Web Audio does not exist.

import type { SynthParams } from '../vendor/tonebench/tonebenchEngine.js';
import { KERNEL_PANIC_DEFS, type SoundName, type SequenceStep } from './sounds.js';
import dataStore from '../DataStore.js';

/** localStorage-backed pref keys. Shared with the settings UI. */
export const AUDIO_MUTED_PREF = 'audio.muted';
export const AUDIO_VOLUME_PREF = 'audio.volume';
export const DEFAULT_VOLUME = 0.7;

/**
 * Structural signature of the vendored engine's `playSound`, declared here so
 * this module type-checks against the engine WITHOUT a runtime import of it.
 * That keeps the AudioManager contract loadable under `node --test` (no Web
 * Audio, no vendored `.js` needed); the real engine is wired in `soundBoard.ts`.
 */
export type SoundPlayer = (
  ctx: BaseAudioContext,
  p: SynthParams,
  when?: number,
  destination?: AudioNode
) => unknown;

/** Minimal slice of DataStore the manager needs — an EventTarget with prefs. */
export interface PrefsSource extends EventTarget {
  readonly prefs: Record<string, string | number | boolean | object>;
}

export interface AudioManagerDeps {
  /** Synth entry point — the vendored engine's `playSound` in production. */
  play: SoundPlayer;
  /** Creates the AudioContext lazily on first `resume()`. Defaults to `new AudioContext()`. */
  createContext?: () => BaseAudioContext;
  /** Where mute/volume prefs live. Defaults to the app DataStore singleton. */
  store?: PrefsSource;
}

/**
 * Coerces raw pref values into a valid `{ muted, volume }`. Pure and exported so
 * the validation can be tested without a live context. Invalid stored values
 * fall back to defaults with a warning (tier-2 recoverable) rather than feeding
 * junk into playback.
 */
export function parseAudioPrefs(prefs: PrefsSource['prefs']): { muted: boolean; volume: number } {
  const rawMuted = prefs[AUDIO_MUTED_PREF];
  const muted = typeof rawMuted === 'boolean' ? rawMuted : false;

  const rawVolume = prefs[AUDIO_VOLUME_PREF];
  let volume = DEFAULT_VOLUME;
  if (typeof rawVolume === 'number' && Number.isFinite(rawVolume)) {
    volume = Math.min(1, Math.max(0, rawVolume));
  } else if (rawVolume !== undefined) {
    console.warn(
      `[audio] ignoring invalid ${AUDIO_VOLUME_PREF} pref (${String(rawVolume)}); using ${DEFAULT_VOLUME}`
    );
  }
  return { muted, volume };
}

export class AudioManager {
  #createContext: () => BaseAudioContext;
  #play: SoundPlayer;
  #store: PrefsSource;

  #ctx: BaseAudioContext | null = null;
  #master: GainNode | null = null;
  #muted: boolean;
  #volume: number;

  constructor(deps: AudioManagerDeps) {
    this.#createContext = deps.createContext ?? (() => new AudioContext());
    this.#play = deps.play;
    this.#store = deps.store ?? dataStore;

    ({ muted: this.#muted, volume: this.#volume } = parseAudioPrefs(this.#store.prefs));
    this.#store.addEventListener('change', this.#onStoreChange);
  }

  get muted(): boolean {
    return this.#muted;
  }

  get volume(): number {
    return this.#volume;
  }

  /** True once a context exists (i.e. after the first user gesture). */
  get ready(): boolean {
    return this.#ctx !== null;
  }

  /**
   * Create/resume the shared context on a user gesture. Idempotent — the context
   * and master gain are built exactly once; later calls only resume a suspended
   * context (e.g. after the tab is backgrounded).
   */
  resume(): void {
    if (!this.#ctx) {
      const ctx = this.#createContext();
      const master = ctx.createGain();
      master.connect(ctx.destination);
      this.#ctx = ctx;
      this.#master = master;
      this.#applyGain();
    }
    // A freshly-created context can start `suspended` until the gesture resolves.
    const ctx = this.#ctx as BaseAudioContext & { state?: string; resume?: () => Promise<void> };
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      void ctx.resume();
    }
  }

  /**
   * Play a named sound. No-op when muted or before the first gesture (no context
   * yet). Throws on an unknown name — a typo'd sound is the silent-fallback bug
   * class we surface loudly, matching the event bus's known-types-only rule.
   */
  play(name: SoundName, when?: number): void {
    const def = KERNEL_PANIC_DEFS[name];
    if (!def) {
      throw new Error(`[audio] unknown sound: ${String(name)}`);
    }
    if (this.#muted || !this.#ctx || !this.#master) return;
    this.#play(this.#ctx, def, when, this.#master);
  }

  /**
   * Play a named sound as a transposed arpeggio: each step re-pitches the base
   * def by `2 ** (semitones / 12)` and schedules it at `ctx.currentTime + when`.
   * Same guards as `play` — no-op when muted or before the first gesture, and
   * throws on an unknown base name (fail loud, not silent). Used for multi-note
   * flourishes (e.g. the extraction motif) without cluttering the def table.
   */
  playSequence(name: SoundName, steps: readonly SequenceStep[]): void {
    const base = KERNEL_PANIC_DEFS[name];
    if (!base) {
      throw new Error(`[audio] unknown sound: ${String(name)}`);
    }
    if (this.#muted || !this.#ctx || !this.#master) return;
    const now = this.#ctx.currentTime;
    for (const step of steps) {
      const ratio = 2 ** (step.semitones / 12);
      const def: SynthParams = {
        ...base,
        freqStart: base.freqStart * ratio,
        freqEnd: base.freqEnd * ratio,
      };
      this.#play(this.#ctx, def, now + step.when, this.#master);
    }
  }

  /**
   * Play a timed chain of *different* named sounds, each scheduled at
   * `ctx.currentTime + when` — the heterogeneous sibling of `playSequence`
   * (which re-pitches a single def). Used for multi-timbre stings like the
   * turret's mechanical clunk + boot chirp. Every name is validated up front, so
   * an unknown name in any step throws before *any* sound plays (no partial
   * playback). No-op when muted or before the first gesture.
   */
  playChain(steps: readonly { name: SoundName; when: number }[]): void {
    const defs = steps.map(step => {
      const def = KERNEL_PANIC_DEFS[step.name];
      if (!def) {
        throw new Error(`[audio] unknown sound: ${String(step.name)}`);
      }
      return { def, when: step.when };
    });
    if (this.#muted || !this.#ctx || !this.#master) return;
    const now = this.#ctx.currentTime;
    for (const { def, when } of defs) {
      this.#play(this.#ctx, def, now + when, this.#master);
    }
  }

  #applyGain(): void {
    if (this.#master) {
      this.#master.gain.value = this.#muted ? 0 : this.#volume;
    }
  }

  #onStoreChange = (evt: Event): void => {
    // `prefs` — a setPref() update. `*` — a whole-store init()/import() reload,
    // which also swaps in the persisted prefs (so a saved mute survives a page
    // reload). Both must re-read.
    const detail = (evt as CustomEvent<{ key?: string }>).detail;
    if (detail?.key !== 'prefs' && detail?.key !== '*') return;
    ({ muted: this.#muted, volume: this.#volume } = parseAudioPrefs(this.#store.prefs));
    this.#applyGain();
  };
}
