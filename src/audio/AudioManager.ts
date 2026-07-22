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
import type { MusicModulation } from './music.js';
import dataStore from '../DataStore.js';

/** localStorage-backed pref keys. Shared with the settings UI. */
export const AUDIO_MUTED_PREF = 'audio.muted';
export const AUDIO_VOLUME_PREF = 'audio.volume';
export const DEFAULT_VOLUME = 0.7;

/**
 * Music gets its own mute + volume. It plays continuously rather than in
 * response to an action, so the tolerable level is different from SFX — and
 * "score off, effects on" is a common preference that a single control cannot
 * express. The music bus still hangs off the master gain, so the global mute
 * silences everything.
 */
export const AUDIO_MUSIC_MUTED_PREF = 'audio.music.muted';
export const AUDIO_MUSIC_VOLUME_PREF = 'audio.music.volume';
export const DEFAULT_MUSIC_VOLUME = 0.4;

/**
 * Shared music-bus effects. Music notes are synthesized dry (see the header of
 * `music.ts`) because TONEBENCH builds an impulse response and a delay graph per
 * hit — affordable a few times a minute, ruinous at several notes a second. One
 * bus-level instance of each gives the same wash for a fixed one-time cost.
 */
/**
 * Fade applied when music is suspended or resumed (window/tab focus changes).
 *
 * Not zero: the music bus carries sustained oscillators, so stepping its gain
 * instantaneously is a discontinuity in a signal that is mid-cycle — an audible
 * click. Short enough to read as "immediately", long enough to be silent.
 */
const MUSIC_FADE_SECONDS = 0.12;

/**
 * Cutoff the bus filter idles at — far above the highest fundamental any voice
 * produces (~880 Hz), so with no sweep the filter is effectively bypassed rather
 * than quietly dulling the bed.
 */
const MUSIC_FILTER_BYPASS_CUTOFF = 12000;

/**
 * Glide applied to filter/LFO changes. Long enough that a tension change slides
 * rather than jumps; short enough to still feel like a reaction.
 */
const MUSIC_MODULATION_GLIDE_SECONDS = 0.6;

const MUSIC_REVERB_DECAY = 2.5;
const MUSIC_REVERB_MIX = 0.22;
const MUSIC_DELAY_TIME = 0.375;
const MUSIC_DELAY_FEEDBACK = 0.3;
const MUSIC_DELAY_MIX = 0.16;

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

/**
 * The stoppable handle the engine hands back for a scheduled hit (`{ source }`).
 * Structural and optional-shaped because `SoundPlayer` is declared as returning
 * `unknown` — the manager only ever needs to cut a note short.
 */
export interface ScheduledSource {
  stop?: (when?: number) => void;
}

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

export interface AudioPrefs {
  muted: boolean;
  volume: number;
  musicMuted: boolean;
  musicVolume: number;
}

/** Shared coercion for one mute/volume pair. */
function parseChannel(
  prefs: PrefsSource['prefs'],
  mutedKey: string,
  volumeKey: string,
  defaultVolume: number
): { muted: boolean; volume: number } {
  const rawMuted = prefs[mutedKey];
  const muted = typeof rawMuted === 'boolean' ? rawMuted : false;

  const rawVolume = prefs[volumeKey];
  let volume = defaultVolume;
  if (typeof rawVolume === 'number' && Number.isFinite(rawVolume)) {
    volume = Math.min(1, Math.max(0, rawVolume));
  } else if (rawVolume !== undefined) {
    console.warn(
      `[audio] ignoring invalid ${volumeKey} pref (${String(rawVolume)}); using ${defaultVolume}`
    );
  }
  return { muted, volume };
}

/**
 * Coerces raw pref values into a valid `AudioPrefs`. Pure and exported so the
 * validation can be tested without a live context. Invalid stored values fall
 * back to defaults with a warning (tier-2 recoverable) rather than feeding junk
 * into playback.
 */
export function parseAudioPrefs(prefs: PrefsSource['prefs']): AudioPrefs {
  const sfx = parseChannel(prefs, AUDIO_MUTED_PREF, AUDIO_VOLUME_PREF, DEFAULT_VOLUME);
  const music = parseChannel(
    prefs,
    AUDIO_MUSIC_MUTED_PREF,
    AUDIO_MUSIC_VOLUME_PREF,
    DEFAULT_MUSIC_VOLUME
  );
  return {
    muted: sfx.muted,
    volume: sfx.volume,
    musicMuted: music.muted,
    musicVolume: music.volume,
  };
}

export class AudioManager {
  #createContext: () => BaseAudioContext;
  #play: SoundPlayer;
  #store: PrefsSource;

  #ctx: BaseAudioContext | null = null;
  #master: GainNode | null = null;
  #muted: boolean;
  #volume: number;

  /** Built lazily on the first music note — see `#ensureMusicBus`. */
  #musicGain: GainNode | null = null;
  #musicMuted: boolean;
  #musicVolume: number;
  /** Live music sources, retained so `stopMusic` can cut scheduled notes. */
  #musicSources: { source: ScheduledSource; endsAt: number }[] = [];
  /** Transient silence (window/tab unfocused) — distinct from the mute pref. */
  #musicSuspended = false;

  /** Swept resonant lowpass + its LFO. Built with the bus. */
  #musicFilter: BiquadFilterNode | null = null;
  #musicLfo: OscillatorNode | null = null;
  #musicLfoDepth: GainNode | null = null;
  /** Last requested modulation, replayed if the bus is built later. */
  #musicModulation: MusicModulation | null = null;

  constructor(deps: AudioManagerDeps) {
    this.#createContext = deps.createContext ?? (() => new AudioContext());
    this.#play = deps.play;
    this.#store = deps.store ?? dataStore;

    ({
      muted: this.#muted,
      volume: this.#volume,
      musicMuted: this.#musicMuted,
      musicVolume: this.#musicVolume,
    } = parseAudioPrefs(this.#store.prefs));
    this.#store.addEventListener('change', this.#onStoreChange);
  }

  get muted(): boolean {
    return this.#muted;
  }

  get volume(): number {
    return this.#volume;
  }

  get musicMuted(): boolean {
    return this.#musicMuted;
  }

  get musicVolume(): number {
    return this.#musicVolume;
  }

  /** True once the shared music bus has been built (first audible music note). */
  get musicReady(): boolean {
    return this.#musicGain !== null;
  }

  /** True while music is faded out because the game lost the player's attention. */
  get musicSuspended(): boolean {
    return this.#musicSuspended;
  }

  /**
   * Fade the music bus out (or back in) without touching the player's prefs.
   *
   * This is the focus-loss path: leaving the tab or the application should
   * silence the score, but must not look like the player turned music off — so
   * it is a separate flag from `musicMuted`, and unmuting it later restores the
   * player's own volume rather than a default.
   *
   * Suspending does not stop already-scheduled notes. Cutting live oscillators
   * mid-sustain clicks, and the fade has already made them inaudible; they
   * expire on their own within one note's length. Stopping the *director* — so
   * no further notes are scheduled — is the caller's job.
   */
  setMusicSuspended(suspended: boolean): void {
    if (this.#musicSuspended === suspended) return;
    this.#musicSuspended = suspended;
    this.#applyGain();
  }

  /** True once a context exists (i.e. after the first user gesture). */
  get ready(): boolean {
    return this.#ctx !== null;
  }

  /**
   * The audio clock. 0 before the first gesture — the scheduler that reads this
   * is only started after `resume()`, so it never sees the placeholder.
   */
  get currentTime(): number {
    return this.#ctx?.currentTime ?? 0;
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

  /**
   * Play one scheduled music note into the music bus. Unlike `play`, the def is
   * passed by value rather than looked up by name: the director synthesizes each
   * note by re-pitching a voice, so there is no fixed name to validate. `when` is
   * an absolute audio-clock time, already computed by the director's scheduler.
   *
   * No-op when either mute is set or before the first gesture — the director
   * keeps its clock running regardless, so muting costs nothing but silence.
   */
  playMusicNote(def: SynthParams, when: number): void {
    if (this.#muted || this.#musicMuted || this.#musicSuspended) return;
    if (!this.#ctx || !this.#master) return;
    const bus = this.#ensureMusicBus();
    const played = this.#play(this.#ctx, def, when, bus);
    this.#retainMusicSource(played, def, when);
  }

  /**
   * Set the music bus's filter sweep — the alarm's signal.
   *
   * Every value is ramped over `MUSIC_MODULATION_GLIDE_SECONDS` rather than
   * stepped, so a tension change slides the bed into its new shape instead of
   * jumping. A stepped cutoff on a sustaining pad is an audible artefact, and a
   * stepped LFO rate produces a phase discontinuity in the sweep.
   *
   * Safe to call before the bus exists; the request is stored and applied when
   * it is built.
   */
  setMusicModulation(modulation: MusicModulation): void {
    this.#musicModulation = modulation;
    this.#applyModulation(modulation);
  }

  /** The modulation currently applied, for the debug harness and tests. */
  get musicModulation(): MusicModulation | null {
    return this.#musicModulation;
  }

  #applyModulation(m: MusicModulation): void {
    const filter = this.#musicFilter;
    const lfo = this.#musicLfo;
    const depth = this.#musicLfoDepth;
    if (!filter || !lfo || !depth) return;

    const now = this.#ctx?.currentTime ?? 0;
    const end = now + MUSIC_MODULATION_GLIDE_SECONDS;
    for (const [param, target] of [
      [filter.frequency, m.baseCutoff],
      [filter.Q, m.q],
      [depth.gain, m.depthCents],
      [lfo.frequency, m.hz],
    ] as const) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, end);
    }
  }

  /**
   * Silence the music immediately, including notes already handed to the audio
   * clock. The director schedules up to a couple of seconds ahead, so simply
   * stopping it would leave the tail playing over a scene change — this cuts the
   * sources the director cannot reach.
   */
  stopMusic(): void {
    for (const { source } of this.#musicSources) {
      // A source that has already finished throws nothing on stop(), but one
      // that was never started would — every source here came back from the
      // engine already scheduled, so this is safe.
      source.stop?.();
    }
    this.#musicSources = [];
  }

  /**
   * Builds the shared music FX bus on first use: dry path plus one delay and one
   * convolver, all feeding the master gain.
   *
   * Lazy on purpose. The impulse response is a stereo buffer of
   * `sampleRate × MUSIC_REVERB_DECAY` samples; a player who never unmutes music
   * should never pay for it, and `playMusicNote` returns before reaching here
   * when muted.
   */
  #ensureMusicBus(): GainNode {
    if (this.#musicGain) return this.#musicGain;
    const ctx = this.#ctx as BaseAudioContext;
    const master = this.#master as GainNode;

    const musicGain = ctx.createGain();

    // The swept resonant lowpass sits between the bus gain and every send, so
    // the sweep colours the dry signal AND what feeds the delay and reverb —
    // otherwise the wet paths would carry an unswept copy and wash it out.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = MUSIC_FILTER_BYPASS_CUTOFF;
    filter.Q.value = 0.7;
    musicGain.connect(filter);

    // LFO → depth → filter.detune. Modulating `detune` (cents) rather than
    // `frequency` (Hz) makes the sweep exponential, so it travels at a
    // perceptually even rate instead of racing through the top of its range.
    //
    // It must NOT be wired to `musicGain.gain`: an AudioParam's value is its
    // automation timeline PLUS any connected signal, and `#rampMusicGain`'s
    // `cancelScheduledValues` only clears the timeline. An LFO on that param
    // would keep injecting after a mute — audible music while "muted".
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.2;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0;
    lfo.connect(lfoDepth);
    lfoDepth.connect(filter.detune);
    lfo.start();

    filter.connect(master); // dry

    const delay = ctx.createDelay(1);
    delay.delayTime.value = MUSIC_DELAY_TIME;
    const feedback = ctx.createGain();
    feedback.gain.value = MUSIC_DELAY_FEEDBACK;
    const delayWet = ctx.createGain();
    delayWet.gain.value = MUSIC_DELAY_MIX;
    filter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(delayWet);
    delayWet.connect(master);

    const convolver = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * MUSIC_REVERB_DECAY);
    const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      }
    }
    convolver.buffer = impulse;
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = MUSIC_REVERB_MIX;
    filter.connect(convolver);
    convolver.connect(reverbWet);
    reverbWet.connect(master);

    this.#musicGain = musicGain;
    this.#musicFilter = filter;
    this.#musicLfo = lfo;
    this.#musicLfoDepth = lfoDepth;
    this.#applyGain();
    // Replay any modulation requested before the bus existed — the director sets
    // tension on start, which can precede the first audible note.
    if (this.#musicModulation) this.#applyModulation(this.#musicModulation);
    return musicGain;
  }

  /**
   * Keeps a handle on a scheduled note so `stopMusic` can cut it, dropping
   * handles whose notes have already played out. Without the prune this list
   * would grow for the whole session — the bed emits notes continuously.
   */
  #retainMusicSource(played: unknown, def: SynthParams, when: number): void {
    const source = (played as { source?: ScheduledSource } | null | undefined)?.source;
    if (!source || typeof source.stop !== 'function') return;

    const now = this.#ctx?.currentTime ?? 0;
    if (this.#musicSources.length > 0) {
      this.#musicSources = this.#musicSources.filter(entry => entry.endsAt > now);
    }
    const duration = def.attack + def.decay + def.sustainTime + def.release;
    this.#musicSources.push({ source, endsAt: when + duration });
  }

  #applyGain(): void {
    // The master gain is stepped, not ramped: SFX are transients, so a level
    // change lands between hits where a step is inaudible.
    if (this.#master) {
      this.#master.gain.value = this.#muted ? 0 : this.#volume;
    }
    // The music bus is always sounding, so its changes are ramped.
    if (this.#musicGain) {
      const silent = this.#musicMuted || this.#musicSuspended;
      this.#rampMusicGain(silent ? 0 : this.#musicVolume);
    }
  }

  #rampMusicGain(target: number): void {
    if (!this.#musicGain) return;
    const param = this.#musicGain.gain;
    const now = this.#ctx?.currentTime ?? 0;
    // Anchor at the current value first: without it a ramp scheduled during an
    // earlier ramp interpolates from a stale start point and jumps.
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + MUSIC_FADE_SECONDS);
  }

  #onStoreChange = (evt: Event): void => {
    // `prefs` — a setPref() update. `*` — a whole-store init()/import() reload,
    // which also swaps in the persisted prefs (so a saved mute survives a page
    // reload). Both must re-read.
    const detail = (evt as CustomEvent<{ key?: string }>).detail;
    if (detail?.key !== 'prefs' && detail?.key !== '*') return;
    ({
      muted: this.#muted,
      volume: this.#volume,
      musicMuted: this.#musicMuted,
      musicVolume: this.#musicVolume,
    } = parseAudioPrefs(this.#store.prefs));
    this.#applyGain();
  };
}
