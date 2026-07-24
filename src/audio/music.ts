// Kernel Panic ambient music — the note palette and tension model.
//
// Pure data, in the same spirit as `sounds.ts`: this module names and shapes the
// music voices, `MusicDirector` decides *when* to play them, and `AudioManager`
// owns the context and routing. Nothing here touches Web Audio, so it loads
// under `node --test`.
//
// Three engine constraints from `src/vendor/tonebench/tonebenchEngine.js` govern
// every def below — see `tests/audio/musicDefs.test.ts`, which enforces them:
//
//   1. `reverbMix` MUST be 0. The engine builds a fresh stereo impulse response
//      (`sampleRate × reverbDecay` samples) per hit. Acceptable for a UI blip
//      fired a few times a minute; ruinous at several notes per second. The
//      music bus carries one shared convolver instead.
//   2. `distortion` MUST be 0. Allocates a 44,100-sample shaper curve per hit.
//   3. `delayMix` MUST be 0, for the same reason — the bus owns one shared delay.
//
// A fourth constraint is structural rather than numeric: `waveType: 'noise'`
// allocates a buffer of `sampleRate × duration`, so it is confined to short
// percussive voices and never used for pads (an 8-second noise pad would
// allocate ~350k floats on every retrigger).
//
// The engine also offers no intra-note modulation — filter cutoff is set once
// and pitch does a single ramp across the note. Movement therefore comes from
// two places, neither of which is inside a note:
//
//   - LAYERING, for the pads: several detuned voices with different cutoffs and
//     staggered entries (see each palette's `pad` stack).
//   - The BUS SWEEP, for tension: a resonant lowpass on the whole music bus,
//     swept by an LFO (see `MusicModulation`). The per-note limitation does not
//     apply at the bus, where one oscillator modulates everything at once for a
//     fixed one-time cost. This is what carries the alarm.

import type { SynthParams } from '../vendor/tonebench/tonebenchEngine.js';

/**
 * The music voices. Long, quiet, and dry by design — these are beds, not events,
 * so every def sits well below the SFX defs in `KERNEL_PANIC_DEFS` in volume.
 *
 * `satisfies Record<string, SynthParams>` validates each entry against the
 * vendored param type at compile time, exactly as the sound table does.
 */
export const MUSIC_DEFS = {
  // --- Meatspace: warm, analog, slightly detuned -------------------------

  // Pad voice A — the fundamental. ~9.5s total so consecutive retriggers
  // overlap into a continuous bed rather than pulsing.
  padLow: {
    waveType: 'triangle',
    freqStart: 110,
    freqEnd: 110,
    attack: 2.6,
    decay: 1.4,
    sustainLevel: 0.62,
    sustainTime: 3,
    release: 2.5,
    filterType: 'lowpass',
    filterCutoff: 520,
    filterQ: 0.7,
    distortion: 0,
    delayTime: 0,
    delayFeedback: 0,
    delayMix: 0,
    reverbDecay: 0,
    reverbMix: 0,
    volume: 0.22,
  },
  // Pad voice B — a brighter, quieter partner. Different cutoff is what makes
  // the stack shimmer as the two envelopes drift against each other.
  padHigh: {
    waveType: 'sine',
    freqStart: 220,
    freqEnd: 219,
    attack: 3.4,
    decay: 1.6,
    sustainLevel: 0.5,
    sustainTime: 2.6,
    release: 3,
    filterType: 'lowpass',
    filterCutoff: 1400,
    filterQ: 0.5,
    distortion: 0,
    delayTime: 0,
    delayFeedback: 0,
    delayMix: 0,
    reverbDecay: 0,
    reverbMix: 0,
    volume: 0.13,
  },
  // Bass pulse — the heartbeat. Short, soft attack so it reads as a pulse
  // rather than a kick (the SFX palette owns percussive transients).
  bassPulse: {
    waveType: 'triangle',
    freqStart: 55,
    freqEnd: 55,
    attack: 0.02,
    decay: 0.2,
    sustainLevel: 0.3,
    sustainTime: 0.06,
    release: 0.18,
    filterType: 'lowpass',
    filterCutoff: 320,
    filterQ: 1,
    distortion: 0,
    delayTime: 0,
    delayFeedback: 0,
    delayMix: 0,
    reverbDecay: 0,
    reverbMix: 0,
    volume: 0.3,
  },
  // Arp blip — sparse high accents. Deliberately quiet: this layer's job is tension,
  // not melody, and it must never compete with combat SFX for attention.
  arpBlip: {
    waveType: 'square',
    freqStart: 880,
    freqEnd: 880,
    attack: 0.005,
    decay: 0.07,
    sustainLevel: 0.2,
    sustainTime: 0.02,
    release: 0.1,
    filterType: 'lowpass',
    filterCutoff: 2400,
    filterQ: 1.4,
    distortion: 0,
    delayTime: 0,
    delayFeedback: 0,
    delayMix: 0,
    reverbDecay: 0,
    reverbMix: 0,
    volume: 0.12,
  },

  // --- Cyberspace: colder, thinner, more synthetic -----------------------

  // Sawtooth + tight lowpass reads as "machine" against meatspace's triangle.
  cyberPadLow: {
    waveType: 'sawtooth',
    freqStart: 110,
    freqEnd: 110,
    attack: 2.2,
    decay: 1.8,
    sustainLevel: 0.55,
    sustainTime: 3.2,
    release: 2.6,
    filterType: 'lowpass',
    filterCutoff: 420,
    filterQ: 1.6,
    distortion: 0,
    delayTime: 0,
    delayFeedback: 0,
    delayMix: 0,
    reverbDecay: 0,
    reverbMix: 0,
    volume: 0.18,
  },
  cyberPadHigh: {
    waveType: 'square',
    freqStart: 220,
    freqEnd: 220,
    attack: 3.8,
    decay: 1.4,
    sustainLevel: 0.42,
    sustainTime: 2.4,
    release: 3.2,
    filterType: 'lowpass',
    filterCutoff: 1100,
    filterQ: 0.9,
    distortion: 0,
    delayTime: 0,
    delayFeedback: 0,
    delayMix: 0,
    reverbDecay: 0,
    reverbMix: 0,
    volume: 0.09,
  },
  cyberBass: {
    waveType: 'square',
    freqStart: 55,
    freqEnd: 55,
    attack: 0.01,
    decay: 0.16,
    sustainLevel: 0.26,
    sustainTime: 0.04,
    release: 0.14,
    filterType: 'lowpass',
    filterCutoff: 260,
    filterQ: 2,
    distortion: 0,
    delayTime: 0,
    delayFeedback: 0,
    delayMix: 0,
    reverbDecay: 0,
    reverbMix: 0,
    volume: 0.26,
  },
  cyberBlip: {
    waveType: 'sawtooth',
    freqStart: 880,
    freqEnd: 1320,
    attack: 0.002,
    decay: 0.05,
    sustainLevel: 0.15,
    sustainTime: 0.01,
    release: 0.07,
    filterType: 'highpass',
    filterCutoff: 700,
    filterQ: 1,
    distortion: 0,
    delayTime: 0,
    delayFeedback: 0,
    delayMix: 0,
    reverbDecay: 0,
    reverbMix: 0,
    volume: 0.1,
  },
} satisfies Record<string, SynthParams>;

/** The music voices, by name — derived from `MUSIC_DEFS`. */
export type MusicVoiceName = keyof typeof MUSIC_DEFS;

// --- Palettes ----------------------------------------------------------------

/** Which sonic world the director is scoring. */
export type MusicPaletteName = 'meat' | 'cyber';

/**
 * One pad voice in the stack. Pads are built from several of these fired
 * together: `semitone` stacks a chord tone over the chosen scale degree,
 * `cents` detunes it slightly so the voices beat against each other, and `when`
 * staggers the entry so the stack blooms instead of arriving as a block. Since
 * the engine cannot modulate within a note, this layering is the pads' only
 * *internal* movement — the bus sweep moves them from outside — so these offsets
 * carry real weight.
 */
export interface PadVoiceSpec {
  voice: MusicVoiceName;
  semitone: number;
  cents: number;
  when: number;
}

export interface MusicPalette {
  /** Tonic, in Hz, for the middle register. */
  root: number;
  /** Scale degrees as semitone offsets from the tonic. */
  scale: readonly number[];
  /** The pad stack fired on each pad retrigger. */
  pad: readonly PadVoiceSpec[];
  bass: MusicVoiceName;
  arp: MusicVoiceName;
  /**
   * Scale degrees the pad may settle on. Deliberately a narrow, consonant
   * subset rather than the whole scale — with no chord model, an unconstrained
   * pad root wanders and the bed stops sounding intentional.
   */
  padDegrees: readonly number[];
  /** Scale degrees the bass may walk to. Narrower still; mostly the tonic. */
  bassDegrees: readonly number[];
  /**
   * Multiplier on the bus sweep's depth for this palette.
   *
   * Evens out a real asymmetry: a filter sweep is only as audible as the
   * harmonics it has to move. Cyber's sawtooth/square pads are harmonically
   * rich and sweep dramatically; meat's triangle/sine pads have far less above
   * the fundamental, so the same depth reads as a much smaller gesture. Meat
   * therefore gets a wider sweep to land in the same place perceptually.
   */
  padDepthScale: number;
  /** Semitone shift applied to each layer's notes, relative to `root`. */
  bassOctave: number;
  arpOctave: number;
}

/**
 * Meatspace: natural minor. Dark but tonal — the street, not the machine.
 */
const MEAT_PALETTE: MusicPalette = {
  root: 110,
  scale: [0, 2, 3, 5, 7, 8, 10],
  pad: [
    { voice: 'padLow', semitone: 0, cents: 0, when: 0 },
    { voice: 'padLow', semitone: 7, cents: -6, when: 0.4 },
    { voice: 'padHigh', semitone: 12, cents: 5, when: 0.9 },
  ],
  bass: 'bassPulse',
  arp: 'arpBlip',
  // Tonic, subdominant, dominant, submediant — the consonant pillars of a minor key.
  padDegrees: [0, 3, 4, 5],
  bassDegrees: [0, 4],
  // Triangle + sine: little harmonic content for the filter to work on, so the
  // sweep is widened to compensate.
  padDepthScale: 1.3,
  bassOctave: -12,
  arpOctave: 24,
};

/**
 * Cyberspace: whole-tone. Deliberately rootless — no leading tone means no pull
 * toward resolution, which is what makes it read as inhuman next to the
 * meatspace minor.
 */
const CYBER_PALETTE: MusicPalette = {
  root: 116.54,
  scale: [0, 2, 4, 6, 8, 10],
  pad: [
    { voice: 'cyberPadLow', semitone: 0, cents: 0, when: 0 },
    { voice: 'cyberPadLow', semitone: 6, cents: 8, when: 0.55 },
    { voice: 'cyberPadHigh', semitone: 12, cents: -9, when: 1.1 },
  ],
  bass: 'cyberBass',
  arp: 'cyberBlip',
  // Whole-tone has no consonant pillars, so these are just evenly-spread
  // resting points — the ambiguity is the point.
  padDegrees: [0, 2, 4],
  bassDegrees: [0, 3],
  // Sawtooth + square: harmonically rich, so the sweep already bites.
  padDepthScale: 1,
  bassOctave: -12,
  arpOctave: 24,
};

export const MUSIC_PALETTES: Record<MusicPaletteName, MusicPalette> = {
  meat: MEAT_PALETTE,
  cyber: CYBER_PALETTE,
};

// --- Tension -----------------------------------------------------------------

/**
 * How wound-up the score is. Driven by game state, not by the music:
 *   0 — hub. Pad only: no run is underway, so there is nothing to pulse against.
 *   1 — a run underway, alarm quiet. The full bed — pad + bass + arp.
 *   2 — alarm raised or cooling down. The same bed, driven harder.
 *
 * Note that tension 1, not 2, is the *baseline* for a run: being inside a
 * facility at all is the tense state, and the score says so from the first turn.
 * Tension 2 is not "the layers arrive", it is "the same music, more kinetic" —
 * faster, denser, and subdivided finer. That leaves the alarm somewhere to
 * escalate *to* without the bed sounding empty before it fires.
 */
export type MusicTension = 0 | 1 | 2;

/**
 * The bus-level filter sweep — the alarm's real signal.
 *
 * A resonant lowpass on the music bus, its cutoff swept by an LFO. This is the
 * one kind of movement the vendored engine cannot produce per note (it sets
 * `filter.frequency` once and never touches it), but it costs nothing at the
 * bus: one oscillator for the session, no per-note work at all.
 *
 * Why a sweep rather than more notes: density escalation is quantitative and
 * ambiguous — "busier" could mean anything. Periodic modulation is what an alarm
 * actually *is*, it reads within a single LFO cycle instead of needing seconds
 * of notes to establish a tempo, and it occupies a channel (spectral movement)
 * that no SFX in the game uses, so it never competes with the cues on top of it.
 *
 * Two details carry the sound:
 *
 *   - **Resonance is mandatory, not decorative.** The meat pads are triangle and
 *     sine — a sine has no harmonics above its fundamental, so a gentle lowpass
 *     sweeping past it does almost nothing. With `q` up around 3 the filter's own
 *     resonant peak becomes audible as it travels, which is what makes the sweep
 *     legible on harmonically poor material. See `padDepthScale`.
 *   - **The bass is deliberately below the sweep.** Bass sits at 55–98 Hz and the
 *     cutoff floor stays well above it, so the pulse stays anchored and legible
 *     while everything above it breathes.
 */
export interface MusicModulation {
  /** Cutoff the sweep centres on, in Hz. High enough is effectively bypass. */
  baseCutoff: number;
  /** Filter resonance. Low is a gentle tilt; ~3 gives an audible moving peak. */
  q: number;
  /** Sweep depth in cents (1200 = one octave). 0 means no sweep at all. */
  depthCents: number;
  /** LFO rate in Hz. Derived from `sweepCyclesPerBar` and the tempo. */
  hz: number;
}

export interface TensionConfig {
  /** Beat length in seconds. Shorter = more urgent. */
  secondsPerBeat: number;
  beatsPerBar: number;
  /** Bars between pad retriggers. Tuned so pads overlap rather than gap. */
  padIntervalBars: number;
  /** 0 disables the layer; otherwise the per-slot probability of a note. */
  bassDensity: number;
  arpDensity: number;
  /** Arp slots per beat — 2 is eighths against the bass's quarters. */
  arpSubdivisions: number;
  /** Bus filter shape at this tension, minus the LFO rate (derived from tempo). */
  sweep: Omit<MusicModulation, 'hz'>;
  /**
   * LFO cycles per bar. Synced to the bar rather than set in raw Hz: a sweep
   * drifting against the pulse sounds broken rather than intentional.
   */
  sweepCyclesPerBar: number;
}

/**
 * Per-tension shape.
 *
 * `padIntervalBars` is the load-bearing number: the shortest pad def runs ~9.5s,
 * and bar length is `secondsPerBeat × beatsPerBar`, so each row keeps the
 * retrigger interval below that duration — 8.0s at t0, 7.2s at t1, 7.2s at t2.
 * If you retune the tempo, re-check that product or the bed develops audible
 * holes; `tests/audio/musicDefs.test.ts` enforces it.
 */
export const TENSION_CONFIG: Readonly<Record<MusicTension, TensionConfig>> = {
  0: {
    secondsPerBeat: 1.0,
    beatsPerBar: 4,
    padIntervalBars: 2,
    bassDensity: 0,
    arpDensity: 0,
    arpSubdivisions: 2,
    // Cutoff far above anything the palettes produce (max ~880 Hz fundamental),
    // with no resonance — the filter is in the chain but effectively bypassed.
    sweep: { baseCutoff: 12000, q: 0.7, depthCents: 0 },
    sweepCyclesPerBar: 0.5,
  },
  // The run baseline: all three layers, and the bed breathing very slowly.
  1: {
    secondsPerBeat: 0.6,
    beatsPerBar: 4,
    padIntervalBars: 3,
    bassDensity: 0.85,
    arpDensity: 0.5,
    arpSubdivisions: 2,
    // ±0.5 octave once every two bars (~0.21 Hz): movement you notice only if
    // you listen for it. Unease, not alarm.
    sweep: { baseCutoff: 2400, q: 1.5, depthCents: 600 },
    sweepCyclesPerBar: 0.5,
  },
  // The alarm. Barely faster and barely denser than the run — the escalation is
  // carried almost entirely by the sweep opening up to ±2 octaves at ~0.9 Hz,
  // through a resonant filter. The bed starts searching.
  2: {
    secondsPerBeat: 0.56,
    beatsPerBar: 4,
    padIntervalBars: 3,
    bassDensity: 0.9,
    arpDensity: 0.55,
    arpSubdivisions: 2,
    sweep: { baseCutoff: 900, q: 3, depthCents: 2400 },
    sweepCyclesPerBar: 2,
  },
};

/**
 * Resolves a tension's sweep into the concrete modulation the audio bus wants,
 * folding in the tempo (for LFO rate) and the palette's depth scale.
 *
 * Pure, and exported so the mapping is testable without an AudioContext.
 */
export function resolveModulation(tension: MusicTension, palette: MusicPalette): MusicModulation {
  const cfg = TENSION_CONFIG[tension];
  const barSeconds = cfg.secondsPerBeat * cfg.beatsPerBar;
  return {
    baseCutoff: cfg.sweep.baseCutoff,
    q: cfg.sweep.q,
    depthCents: cfg.sweep.depthCents * palette.padDepthScale,
    hz: cfg.sweepCyclesPerBar / barSeconds,
  };
}

/**
 * Longest note any voice can produce, plus headroom — the scheduler's tail
 * allowance, used to know how long after `stop()` the bed is still ringing.
 * The tallest pad stack runs ~10.8s.
 */
export const MAX_NOTE_DURATION = 12;

/**
 * Converts a scale degree into a frequency. `degree` indexes `scale` and may run
 * past its end or below zero — it wraps, carrying an octave, so a generator can
 * walk a melodic line without bounds-checking. Exported for direct testing.
 */
export function degreeToFreq(
  palette: MusicPalette,
  degree: number,
  semitoneShift = 0,
  cents = 0
): number {
  const len = palette.scale.length;
  const octave = Math.floor(degree / len);
  const step = ((degree % len) + len) % len;
  const semitones = palette.scale[step] + octave * 12 + semitoneShift;
  return palette.root * 2 ** (semitones / 12 + cents / 1200);
}
