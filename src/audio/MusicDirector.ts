// Generative ambient score — decides WHAT plays WHEN.
//
// The director owns a musical clock (beats → bars) and three layer generators
// that turn a beat position into notes. It never touches Web Audio: notes go out
// through the injected `emit` sink (`AudioManager.playMusicNote` in production),
// which is what lets the whole contract be exercised under `node --test`, where
// Web Audio does not exist. Same rationale as `AudioManager`'s injectable deps.
//
// ## Why a lookahead scheduler
//
// `setInterval` is far too jittery to place notes on: a few milliseconds of drift
// per beat is audible as a stumbling pulse. So the timer never plays anything —
// it only *schedules*. Each tick walks the beat clock forward and hands every
// note falling inside a lookahead window to the audio clock, which is
// sample-accurate. This is the standard "Tale of Two Clocks" split, and it also
// buys resilience: a tick can be late by nearly the whole lookahead window
// without producing a single gap.
//
// That headroom matters here specifically because background tabs throttle
// timers to roughly 1Hz. `LOOKAHEAD_SECONDS` is sized well past that interval so
// a backgrounded game keeps its bed intact rather than tearing.
//
// ## Why tension changes wait for a bar
//
// Layer/tempo changes land on bar boundaries, never mid-bar. Switching tempo
// between beats would shift the pulse under the player, and swapping the palette
// mid-pad-bloom cuts a 10-second note against a new key. Deferring costs at most
// one bar of latency (~1.8s at full tension) and is the difference between the
// score reacting and the score glitching.

import type { SynthParams } from '../vendor/tonebench/tonebenchEngine.js';
import { Rng } from '../rng.js';
import {
  MUSIC_DEFS,
  MUSIC_PALETTES,
  TENSION_CONFIG,
  degreeToFreq,
  resolveModulation,
  type MusicModulation,
  type MusicPalette,
  type MusicPaletteName,
  type MusicTension,
} from './music.js';

/** How often the scheduler wakes to look ahead. */
export const TICK_MS = 250;

/**
 * How far ahead of the audio clock notes are scheduled. Must comfortably exceed
 * the background-tab timer floor (~1s) or a backgrounded game tears.
 */
export const LOOKAHEAD_SECONDS = 1.5;

/**
 * If the beat clock falls further than this behind the audio clock, the
 * scheduler re-anchors to "now" instead of backfilling.
 *
 * This is the suspended-context case: a tab backgrounded for a minute leaves the
 * beat clock a minute in the past. Without this guard the next tick would try to
 * catch up by emitting every missed beat at once — a burst of hundreds of
 * simultaneous notes. Silence, then a re-anchor, is the correct recovery.
 */
export const RESYNC_THRESHOLD_SECONDS = 2;

/** The note sink and clock the director schedules against. */
export interface MusicDirectorDeps {
  /** Receives one scheduled note. `when` is an absolute audio-clock time. */
  emit: (def: SynthParams, when: number) => void;
  /** The audio clock — `ctx.currentTime` in production. */
  now: () => number;
  /** Repeating timer, `setInterval`-shaped. */
  schedule: (fn: () => void, ms: number) => number;
  cancel: (id: number) => void;
  /**
   * Receives the bus filter sweep whenever the sounding tension or palette
   * changes. Required, not optional: a missing sink would silently cost the
   * alarm its primary signal, which is exactly the failure that would go
   * unnoticed until someone wondered why alarms felt flat.
   */
  modulate: (modulation: MusicModulation) => void;
  /** Seeds note choice. Same seed + same tension sequence → same score. */
  seed?: number;
}

/**
 * Re-pitches a voice def to `freq`, preserving the def's own pitch drift.
 *
 * Defs encode drift as a ratio between `freqStart` and `freqEnd` (e.g. padHigh's
 * 220→219 sag). Carrying that ratio across rather than flattening the note keeps
 * the tuning intent in the def table where it is editable, instead of burying it
 * in the scheduler.
 */
export function pitched(def: SynthParams, freq: number): SynthParams {
  const driftRatio = def.freqStart > 0 ? def.freqEnd / def.freqStart : 1;
  return { ...def, freqStart: freq, freqEnd: freq * driftRatio };
}

export class MusicDirector {
  #emit: MusicDirectorDeps['emit'];
  #now: MusicDirectorDeps['now'];
  #schedule: MusicDirectorDeps['schedule'];
  #cancel: MusicDirectorDeps['cancel'];

  #modulate: MusicDirectorDeps['modulate'];

  #rng: Rng;
  #seed: number;
  #timer: number | null = null;
  /** False until the first modulation is pushed, so `start()` always sends one. */
  #modulationSent = false;

  // Active values — only ever changed at a bar boundary.
  #tension: MusicTension = 0;
  #paletteName: MusicPaletteName = 'meat';
  // Requested values, awaiting the next bar boundary.
  #pendingTension: MusicTension = 0;
  #pendingPalette: MusicPaletteName = 'meat';

  /** Audio-clock time of the next beat still to be scheduled. */
  #nextBeatTime = 0;
  #beatInBar = 0;
  #bar = 0;

  constructor(deps: MusicDirectorDeps) {
    this.#emit = deps.emit;
    this.#now = deps.now;
    this.#schedule = deps.schedule;
    this.#cancel = deps.cancel;
    this.#modulate = deps.modulate;
    this.#seed = deps.seed ?? 0x5eed;
    this.#rng = new Rng(this.#seed);
  }

  get running(): boolean {
    return this.#timer !== null;
  }

  /** The tension currently sounding — not a pending request. */
  get tension(): MusicTension {
    return this.#tension;
  }

  /** The palette currently sounding — not a pending request. */
  get palette(): MusicPaletteName {
    return this.#paletteName;
  }

  /**
   * Begin scheduling. Idempotent: calling `start()` on a running director does
   * nothing rather than double-scheduling (the shell calls it from a gesture
   * handler that may fire more than once).
   *
   * The beat clock anchors to `now()` and the first tick runs immediately, so
   * the bed starts on the gesture rather than up to `TICK_MS` later.
   */
  start(palette?: MusicPaletteName): void {
    if (palette) {
      this.#pendingPalette = palette;
      this.#paletteName = palette;
    }
    if (this.#timer !== null) return;

    this.#nextBeatTime = this.#now();
    this.#beatInBar = 0;
    this.#bar = 0;
    this.#timer = this.#schedule(() => this.#tick(), TICK_MS);
    this.#tick();
  }

  /**
   * Stop scheduling further notes. Notes already handed to the audio clock keep
   * playing out — silencing those is `AudioManager.stopMusic`'s job, since only
   * it holds the source handles.
   */
  stop(): void {
    if (this.#timer === null) return;
    this.#cancel(this.#timer);
    this.#timer = null;
  }

  /**
   * Request a tension level. Takes effect at the next bar boundary; read back
   * `tension` to see what is actually sounding. No-op if already requested.
   */
  setTension(tension: MusicTension): void {
    if (!(tension in TENSION_CONFIG)) {
      throw new Error(`[music] unknown tension level: ${String(tension)}`);
    }
    this.#pendingTension = tension;
    // While stopped there is no bar boundary coming, so apply immediately —
    // otherwise a tension set before start() would be silently dropped.
    if (this.#timer === null) this.#tension = tension;
  }

  /** Request a palette. Same bar-boundary deferral as `setTension`. */
  setPalette(palette: MusicPaletteName): void {
    if (!(palette in MUSIC_PALETTES)) {
      throw new Error(`[music] unknown palette: ${String(palette)}`);
    }
    this.#pendingPalette = palette;
    if (this.#timer === null) this.#paletteName = palette;
  }

  /**
   * Reset note choice to a known point. Two directors reseeded alike produce
   * identical scores given identical tension sequences — the property the
   * determinism test pins.
   */
  reseed(seed: number): void {
    this.#seed = seed;
    this.#rng = new Rng(seed);
  }

  /** Pushes the sweep for whatever is currently sounding. */
  #sendModulation(): void {
    this.#modulate(resolveModulation(this.#tension, MUSIC_PALETTES[this.#paletteName]));
    this.#modulationSent = true;
  }

  /** The sweep the current tension + palette resolve to. Exposed for harnesses. */
  get modulation(): MusicModulation {
    return resolveModulation(this.#tension, MUSIC_PALETTES[this.#paletteName]);
  }

  #tick(): void {
    const now = this.#now();

    // Recover from a long stall (suspended context, backgrounded tab) by
    // re-anchoring rather than emitting every missed beat at once.
    if (this.#nextBeatTime < now - RESYNC_THRESHOLD_SECONDS) {
      this.#nextBeatTime = now;
      this.#beatInBar = 0;
    }

    const horizon = now + LOOKAHEAD_SECONDS;
    while (this.#nextBeatTime < horizon) {
      this.#nextBeatTime += this.#scheduleBeat(this.#nextBeatTime);
    }
  }

  /** Schedules one beat's notes. Returns the length of that beat in seconds. */
  #scheduleBeat(when: number): number {
    // Bar boundary: adopt any pending tension/palette before generating.
    if (this.#beatInBar === 0) {
      const changed =
        this.#tension !== this.#pendingTension || this.#paletteName !== this.#pendingPalette;
      this.#tension = this.#pendingTension;
      this.#paletteName = this.#pendingPalette;
      // The sweep changes with the music, on the bar — not the instant the game
      // asks for it. Only on an actual change, so a debug harness (or anything
      // else) can hold the bus at a hand-tuned setting between tension changes.
      if (changed || !this.#modulationSent) this.#sendModulation();
    }

    const cfg = TENSION_CONFIG[this.#tension];
    const palette = MUSIC_PALETTES[this.#paletteName];

    if (this.#beatInBar === 0 && this.#bar % cfg.padIntervalBars === 0) {
      this.#schedulePad(palette, when);
    }
    if (cfg.bassDensity > 0) {
      this.#scheduleBass(palette, cfg.bassDensity, when, this.#beatInBar);
    }
    if (cfg.arpDensity > 0) {
      this.#scheduleArp(palette, cfg.arpDensity, when, cfg.secondsPerBeat, cfg.arpSubdivisions);
    }

    this.#beatInBar++;
    if (this.#beatInBar >= cfg.beatsPerBar) {
      this.#beatInBar = 0;
      this.#bar++;
    }
    return cfg.secondsPerBeat;
  }

  /**
   * The pad stack: one chosen scale degree, voiced by every spec in the
   * palette's stack — detuned and staggered so the retrigger blooms.
   */
  #schedulePad(palette: MusicPalette, when: number): void {
    const degree = this.#rng.pick(palette.padDegrees);
    for (const spec of palette.pad) {
      const freq = degreeToFreq(palette, degree, spec.semitone, spec.cents);
      this.#emit(pitched(MUSIC_DEFS[spec.voice], freq), when + spec.when);
    }
  }

  /**
   * The pulse. The downbeat is unconditional — density only governs the
   * off-beats, so the bar never loses its anchor even at low density.
   */
  #scheduleBass(palette: MusicPalette, density: number, when: number, beatInBar: number): void {
    const onDownbeat = beatInBar === 0;
    if (!onDownbeat && !this.#rng.chance(density)) return;
    // The downbeat holds the tonic; off-beats may walk.
    const degree = onDownbeat ? palette.bassDegrees[0] : this.#rng.pick(palette.bassDegrees);
    const freq = degreeToFreq(palette, degree, palette.bassOctave);
    this.#emit(pitched(MUSIC_DEFS[palette.bass], freq), when);
  }

  /**
   * High accents spread across the beat's subdivisions. Free to roam the whole
   * scale: this layer is agitation rather than melody, so wandering reads as
   * nerves.
   *
   * `subdivisions` is how the alarm gets its kinetic lift — doubling it turns
   * eighths into sixteenths against an unchanged bass, so the pulse subdivides
   * rather than merely speeding up.
   */
  #scheduleArp(
    palette: MusicPalette,
    density: number,
    when: number,
    secondsPerBeat: number,
    subdivisions: number
  ): void {
    if (subdivisions < 1) {
      throw new Error(`[music] arpSubdivisions must be >= 1, got ${subdivisions}`);
    }
    const step = secondsPerBeat / subdivisions;
    for (let slot = 0; slot < subdivisions; slot++) {
      if (!this.#rng.chance(density)) continue;
      const degree = this.#rng.intRange(0, palette.scale.length);
      const freq = degreeToFreq(palette, degree, palette.arpOctave);
      this.#emit(pitched(MUSIC_DEFS[palette.arp], freq), when + slot * step);
    }
  }
}
