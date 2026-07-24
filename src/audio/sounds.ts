// Kernel Panic sound set.
//
// OUR glue over the vendored TONEBENCH engine (src/vendor/tonebench/). Each
// entry is a `SynthParams` hit the engine synthesizes live — there are no audio
// asset files. `AudioManager` owns the AudioContext and volume routing; this
// module just names and shapes the sounds.

import type { SynthParams } from '../vendor/tonebench/tonebenchEngine.js';

/**
 * Synthesis params per sound, tuned in ToneBench. This object is the single
 * source of truth for the sound set: `SoundName` is derived from its keys
 * (below), so adding or removing a sound here is the only edit required.
 * `satisfies Record<string, SynthParams>` validates every def against the
 * vendored `SynthParams` at compile time — a missing or mistyped field fails
 * the build.
 */
export const KERNEL_PANIC_DEFS = {
  fire: {
    waveType: 'noise',
    freqStart: 47.94021141721707,
    freqEnd: 37.57098361754177,
    attack: 0.42,
    decay: 0.512,
    sustainLevel: 0.45,
    sustainTime: 0.171,
    release: 0.414,
    filterType: 'bandpass',
    filterCutoff: 70.1924697629702,
    filterQ: 0.5,
    distortion: 20,
    delayTime: 0.1,
    delayFeedback: 0.1,
    delayMix: 0.45608635014429655,
    reverbDecay: 2.2,
    reverbMix: 0.31,
    volume: 0.9,
  },
  alarm: {
    waveType: 'square',
    freqStart: 75.21206186172788,
    freqEnd: 64.84233636087376,
    attack: 0.135,
    decay: 0.154,
    sustainLevel: 0.8,
    sustainTime: 0.3,
    release: 0.2,
    filterType: 'bandpass',
    filterCutoff: 798.1394216649605,
    filterQ: 8,
    distortion: 25,
    delayTime: 0.1,
    delayFeedback: 0.1,
    delayMix: 0,
    reverbDecay: 0.8,
    reverbMix: 0.1,
    volume: 0.8,
  },
  pickUp: {
    waveType: 'sine',
    freqStart: 139.06152063493485,
    freqEnd: 390.75795062653236,
    attack: 0.069,
    decay: 0.07,
    sustainLevel: 0.06,
    sustainTime: 0.01,
    release: 0.03,
    filterType: 'none',
    filterCutoff: 4000,
    filterQ: 1,
    distortion: 0,
    delayTime: 0.1,
    delayFeedback: 0.1,
    delayMix: 0,
    reverbDecay: 0.5,
    reverbMix: 0,
    volume: 0.5,
  },
  explosion: {
    waveType: 'noise',
    freqStart: 100,
    freqEnd: 100,
    attack: 0.001,
    decay: 0.205,
    sustainLevel: 0.32,
    sustainTime: 0.219,
    release: 0.599,
    filterType: 'lowpass',
    filterCutoff: 300.0678030409465,
    filterQ: 0.1,
    distortion: 43,
    delayTime: 0.22,
    delayFeedback: 0.27,
    delayMix: 0.22,
    reverbDecay: 2,
    reverbMix: 0.35,
    volume: 0.9,
  },
  slash: {
    waveType: 'noise',
    freqStart: 220,
    freqEnd: 60,
    // A tiny ramp gives the blade some travel before contact. Keep this cue
    // bright, dry, and lightly driven so it cannot collapse into rangedShot's
    // low-passed ballistic thump.
    attack: 0.008,
    decay: 0.042,
    sustainLevel: 0.16,
    sustainTime: 0.016,
    release: 0.052,
    filterType: 'bandpass',
    filterCutoff: 2450,
    filterQ: 0.75,
    distortion: 18,
    delayTime: 0.08,
    delayFeedback: 0.1,
    delayMix: 0,
    reverbDecay: 0.18,
    reverbMix: 0.02,
    volume: 0.72,
  },
  down: {
    waveType: 'sawtooth',
    freqStart: 220,
    freqEnd: 60,
    attack: 0.001,
    decay: 0.05,
    sustainLevel: 0.3,
    sustainTime: 0.02,
    release: 0.1,
    filterType: 'lowpass',
    filterCutoff: 1200,
    filterQ: 3,
    distortion: 40,
    delayTime: 0.1,
    delayFeedback: 0.1,
    delayMix: 0,
    reverbDecay: 0.6,
    reverbMix: 0.05,
    volume: 0.8,
  },
  uiClick: {
    waveType: 'sine',
    freqStart: 1200,
    freqEnd: 900,
    attack: 0.001,
    decay: 0.02,
    sustainLevel: 0.2,
    sustainTime: 0.01,
    release: 0.03,
    filterType: 'none',
    filterCutoff: 4000,
    filterQ: 1,
    distortion: 0,
    delayTime: 0.1,
    delayFeedback: 0.1,
    delayMix: 0,
    reverbDecay: 0.5,
    reverbMix: 0,
    volume: 0.5,
  },
  modalOpen: {
    waveType: 'sine',
    freqStart: 546,
    freqEnd: 432,
    attack: 0.001,
    decay: 0.02,
    sustainLevel: 0.2,
    sustainTime: 0.01,
    release: 0.03,
    filterType: 'none',
    filterCutoff: 4000,
    filterQ: 1,
    distortion: 0,
    delayTime: 0.1,
    delayFeedback: 0.1,
    delayMix: 0,
    reverbDecay: 0.5,
    reverbMix: 0,
    volume: 0.5,
  },
  modalClosed: {
    waveType: 'sine',
    freqStart: 335,
    freqEnd: 432,
    attack: 0.001,
    decay: 0.02,
    sustainLevel: 0.2,
    sustainTime: 0.01,
    release: 0.03,
    filterType: 'none',
    filterCutoff: 4000,
    filterQ: 1,
    distortion: 0,
    delayTime: 0.1,
    delayFeedback: 0.1,
    delayMix: 0,
    reverbDecay: 0.5,
    reverbMix: 0,
    volume: 0.5,
  },
  secured: {
    // A restrained upward confirmation: triangle keeps the success cue tonal
    // without the square wave's hard upper harmonics, while the lower sweep
    // and short effects tails keep it from blooming into a fanfare.
    waveType: 'triangle',
    freqStart: 160,
    freqEnd: 780,
    attack: 0.008,
    decay: 0.08,
    sustainLevel: 0.35,
    sustainTime: 0.04,
    release: 0.07,
    filterType: 'lowpass',
    filterCutoff: 2200,
    filterQ: 0.8,
    distortion: 0,
    delayTime: 0.08,
    delayFeedback: 0.12,
    delayMix: 0.04,
    reverbDecay: 0.45,
    reverbMix: 0.08,
    volume: 0.62,
  },
  // Partial-progress cue for multi-step objectives (dual-site: first site
  // touched; escort: contact linked up) — kin to `secured` (same triangle
  // family, same role: objective-state confirmation) but deliberately
  // unresolved: half the pitch travel, no filter bloom, shorter release,
  // quieter. Reads as "logged," not "done" — `secured`/`extracted` stay the
  // only cues that resolve all the way up.
  checkpoint: {
    waveType: 'triangle',
    freqStart: 160,
    freqEnd: 420,
    attack: 0.006,
    decay: 0.05,
    sustainLevel: 0.28,
    sustainTime: 0.02,
    release: 0.04,
    filterType: 'lowpass',
    filterCutoff: 1400,
    filterQ: 0.8,
    distortion: 0,
    delayTime: 0.06,
    delayFeedback: 0.08,
    delayMix: 0.02,
    reverbDecay: 0.25,
    reverbMix: 0.04,
    volume: 0.45,
  },
  rangedShot: {
    waveType: 'noise',
    freqStart: 150,
    freqEnd: 150,
    attack: 0.001,
    decay: 0.045,
    sustainLevel: 0.13,
    sustainTime: 0.012,
    release: 0.1,
    filterType: 'lowpass',
    filterCutoff: 1850,
    filterQ: 0.8,
    distortion: 68,
    delayTime: 0.08,
    delayFeedback: 0.1,
    delayMix: 0,
    reverbDecay: 0.38,
    reverbMix: 0.075,
    volume: 0.82,
  },
  flatline: {
    // The operator dying: a cardiac-monitor flatline pulled into the deck. A
    // pure held sine that sags a hair as the signal dies, then bleeds into a
    // long cold reverb tail (the room going quiet). Deliberately NOT the
    // distorted descending sawtooth of `down` — an operator's death is not a
    // satisfying kill thud. Pitched below the UI band (uiClick 900-1200) so it
    // reads mournful, never like a stuck beep.
    waveType: 'sine',
    freqStart: 828,
    freqEnd: 812,
    attack: 0.02,
    decay: 0.05,
    sustainLevel: 0.5,
    sustainTime: 0.9,
    release: 0.5,
    filterType: 'lowpass',
    filterCutoff: 2000,
    filterQ: 0.7,
    distortion: 0,
    delayTime: 0.1,
    delayFeedback: 0.1,
    delayMix: 0,
    reverbDecay: 2.6,
    reverbMix: 0.28,
    volume: 0.5,
  },
  extracted: {
    // The run-complete payoff — a single stable, warm bell note. The *rise*
    // comes from EXTRACTION_MOTIF transposing this note into a resolving
    // arpeggio, so the base pitch is deliberately flat (no sweep) and rings out
    // with a real reverb tail. Warmer and more final than the restrained,
    // per-objective `secured` cue.
    waveType: 'triangle',
    freqStart: 440,
    freqEnd: 440,
    attack: 0.006,
    decay: 0.1,
    sustainLevel: 0.35,
    sustainTime: 0.06,
    release: 0.28,
    filterType: 'lowpass',
    filterCutoff: 3200,
    filterQ: 0.7,
    distortion: 0,
    delayTime: 0.14,
    delayFeedback: 0.2,
    delayMix: 0.12,
    reverbDecay: 1.6,
    reverbMix: 0.22,
    volume: 0.6,
  },

  // --- Operator perks --------------------------------------------------------
  // One distinct fiction per signature perk, split by texture: cybernetic verbs
  // read synthetic (saw/square, driven, resonant), body verbs read percussive or
  // airy. Each is tuned to sit clear of the combat SFX (slash/rangedShot/down)
  // and of its neighbours. Volumes ride at combat weight (~0.6-0.85).

  // Merc BREAK: a breach-and-clear body slam. Low, dull, percussive — weightier
  // than rangedShot's ballistic crack and shorter than `explosion`.
  vault: {
    waveType: 'noise',
    freqStart: 90,
    freqEnd: 55,
    attack: 0.001,
    decay: 0.09,
    sustainLevel: 0.28,
    sustainTime: 0.02,
    release: 0.14,
    filterType: 'lowpass',
    filterCutoff: 420,
    filterQ: 1.2,
    distortion: 30,
    delayTime: 0.1,
    delayFeedback: 0.1,
    delayMix: 0,
    reverbDecay: 0.5,
    reverbMix: 0.12,
    volume: 0.85,
  },
  // Razor SLIDE: a swift airy whoosh that ducks into silence — the "go silent"
  // read as a fast fade to nothing. Bandpassed noise in a low, resonant band
  // with a slow-ish attack/decay so it swells and tails off (rather than
  // ticking), keeping it clear of `slash`'s bright, dry, instant transient.
  slide: {
    waveType: 'noise',
    freqStart: 1200,
    freqEnd: 1200,
    attack: 0.025,
    decay: 0.16,
    sustainLevel: 0.08,
    sustainTime: 0.02,
    release: 0.2,
    filterType: 'bandpass',
    filterCutoff: 900,
    filterQ: 1.1,
    distortion: 0,
    delayTime: 0.12,
    delayFeedback: 0.15,
    delayMix: 0.1,
    reverbDecay: 0.7,
    reverbMix: 0.18,
    volume: 0.68,
  },
  // Decker EMP: a bright electric crack collapsing into a descending whine as
  // systems brown out. The most overtly digital cue — driven sawtooth, resonant
  // bandpass, a hard downward sweep (unlike `alarm`'s steady square).
  emp: {
    waveType: 'sawtooth',
    freqStart: 1600,
    freqEnd: 120,
    attack: 0.001,
    decay: 0.14,
    sustainLevel: 0.3,
    sustainTime: 0.03,
    release: 0.18,
    filterType: 'bandpass',
    filterCutoff: 1200,
    filterQ: 4,
    distortion: 55,
    delayTime: 0.09,
    delayFeedback: 0.25,
    delayMix: 0.15,
    reverbDecay: 0.8,
    reverbMix: 0.14,
    volume: 0.85,
  },
  // --- Cyberspace combat --------------------------------------------------
  // The grid's own ranged/melee SFX (P3.6). Both read as electric/digital
  // rather than physical — the avatar and ICE are code, not bodies — but
  // stay clear of the Decker's `emp` (a one-off detonation sting) since they
  // fire on every shot/swing instead.

  // Cyber ranged fire: a quick digital zap-crack, kin to `emp`'s family
  // (sawtooth, bandpass, driven, hard downward sweep) but sized like
  // `rangedShot` — a short, repeatable per-shot transient, not `emp`'s
  // one-off detonation (less distortion, far less delay/reverb tail).
  zap: {
    waveType: 'sawtooth',
    freqStart: 1400,
    freqEnd: 300,
    attack: 0.001,
    decay: 0.05,
    sustainLevel: 0.18,
    sustainTime: 0.015,
    release: 0.09,
    filterType: 'bandpass',
    filterCutoff: 1600,
    filterQ: 3,
    distortion: 45,
    delayTime: 0.06,
    delayFeedback: 0.12,
    delayMix: 0.05,
    reverbDecay: 0.3,
    reverbMix: 0.06,
    volume: 0.75,
  },
  // Cyber melee: a short electric-crackle contact hit, distinct from the
  // physical `slash` (noise/bandpass, blade-like). Square + highpass gives
  // it a bright, driven "spark arcing on contact" texture with almost no
  // travel and no tail — snappier and more digital than `slash`.
  jolt: {
    waveType: 'square',
    freqStart: 900,
    freqEnd: 200,
    attack: 0.001,
    decay: 0.03,
    sustainLevel: 0.12,
    sustainTime: 0.008,
    release: 0.05,
    filterType: 'highpass',
    filterCutoff: 2200,
    filterQ: 2,
    distortion: 35,
    delayTime: 0.05,
    delayFeedback: 0.1,
    delayMix: 0.04,
    reverbDecay: 0.2,
    reverbMix: 0.03,
    volume: 0.7,
  },
  // Berserk SURGE: an aggressive rising, distorted power swell.
  surge: {
    waveType: 'sawtooth',
    freqStart: 110,
    freqEnd: 440,
    attack: 0.02,
    decay: 0.1,
    sustainLevel: 0.5,
    sustainTime: 0.12,
    release: 0.16,
    filterType: 'lowpass',
    filterCutoff: 1600,
    filterQ: 2,
    distortion: 45,
    delayTime: 0.1,
    delayFeedback: 0.15,
    delayMix: 0.08,
    reverbDecay: 0.7,
    reverbMix: 0.12,
    volume: 0.85,
  },
  // Berserk CRASH: the comedown a few turns later — SURGE inverted. Descending,
  // duller (lower cutoff), longer release: a tired deflation.
  surgeCrash: {
    waveType: 'sawtooth',
    freqStart: 300,
    freqEnd: 70,
    attack: 0.01,
    decay: 0.18,
    sustainLevel: 0.35,
    sustainTime: 0.06,
    release: 0.3,
    filterType: 'lowpass',
    filterCutoff: 900,
    filterQ: 1.5,
    distortion: 30,
    delayTime: 0.12,
    delayFeedback: 0.2,
    delayMix: 0.1,
    reverbDecay: 1,
    reverbMix: 0.16,
    volume: 0.7,
  },
  // Adept INFLUENCE — success: an eerie resonant shimmer that rises and locks in
  // (the mind dominated). High-Q bandpass, heavy delay/reverb, no distortion —
  // "psychic," unlike anything else in the palette.
  influence: {
    waveType: 'sine',
    freqStart: 330,
    freqEnd: 660,
    attack: 0.04,
    decay: 0.14,
    sustainLevel: 0.4,
    sustainTime: 0.1,
    release: 0.4,
    filterType: 'bandpass',
    filterCutoff: 900,
    filterQ: 6,
    distortion: 0,
    delayTime: 0.18,
    delayFeedback: 0.35,
    delayMix: 0.22,
    reverbDecay: 1.8,
    reverbMix: 0.3,
    volume: 0.75,
  },
  // Adept INFLUENCE — resisted: the same shimmer, but falling and quieter (the
  // mind slips away, unresolved).
  influenceResist: {
    waveType: 'sine',
    freqStart: 480,
    freqEnd: 300,
    attack: 0.04,
    decay: 0.12,
    sustainLevel: 0.3,
    sustainTime: 0.05,
    release: 0.3,
    filterType: 'bandpass',
    filterCutoff: 700,
    filterQ: 7,
    distortion: 0,
    delayTime: 0.18,
    delayFeedback: 0.3,
    delayMix: 0.2,
    reverbDecay: 1.4,
    reverbMix: 0.26,
    volume: 0.6,
  },
  // Shared HP-restored cue: a soft rising heal shimmer with a granular,
  // bubbly delay tail (the swarm knitting tissue). The gentlest cue in the
  // game — undriven, warm, the opposite of the harsh combat set. Plays for
  // every way HP comes back: the Chimera's NANITE REPAIR perk (bus-driven,
  // via EVENT.NANITE_HEALED — see sceneListeners.ts), the STIM consumable,
  // and Patch's clinic heal (both direct `audioManager.play` calls in
  // shellRuntime.ts, since neither routes through a Run's event bus).
  heal: {
    waveType: 'triangle',
    freqStart: 520,
    freqEnd: 780,
    attack: 0.03,
    decay: 0.1,
    sustainLevel: 0.3,
    sustainTime: 0.08,
    release: 0.26,
    filterType: 'lowpass',
    filterCutoff: 2600,
    filterQ: 0.8,
    distortion: 0,
    delayTime: 0.07,
    delayFeedback: 0.35,
    delayMix: 0.25,
    reverbDecay: 1.2,
    reverbMix: 0.2,
    volume: 0.7,
  },
  // Tech DEPLOY — beat 1: a short mechanical ka-chunk as the turret drops.
  deploy: {
    waveType: 'noise',
    freqStart: 200,
    freqEnd: 140,
    attack: 0.001,
    decay: 0.05,
    sustainLevel: 0.2,
    sustainTime: 0.01,
    release: 0.05,
    filterType: 'lowpass',
    filterCutoff: 800,
    filterQ: 2,
    distortion: 20,
    delayTime: 0.1,
    delayFeedback: 0.1,
    delayMix: 0,
    reverbDecay: 0.3,
    reverbMix: 0.05,
    volume: 0.8,
  },
  // Tech DEPLOY — beat 2: a small rising "online" chirp as the turret powers on.
  // Scheduled ~90ms after `deploy` via AudioManager.playChain.
  deployOnline: {
    waveType: 'square',
    freqStart: 660,
    freqEnd: 990,
    attack: 0.002,
    decay: 0.04,
    sustainLevel: 0.25,
    sustainTime: 0.02,
    release: 0.05,
    filterType: 'lowpass',
    filterCutoff: 3000,
    filterQ: 1,
    distortion: 0,
    delayTime: 0.08,
    delayFeedback: 0.12,
    delayMix: 0.05,
    reverbDecay: 0.3,
    reverbMix: 0.05,
    volume: 0.6,
  },

  // --- Economy -----------------------------------------------------------
  // Finn's shop: one shared cue for both BUY and SELL — the fiction is "a
  // transaction cleared," not who paid whom. Square wave + bandpass gives it a
  // bright metallic "register" quality found nowhere else in the palette (the
  // other confirmation cues — `secured`, `heal`, `pickUp` — are sine/triangle
  // and warm/soft by design, so this reads distinctly transactional rather
  // than heroic or medical). Stable pitch, no sweep: like `extracted`, the
  // "cha-ching" rise comes from `TRANSACTION_MOTIF` re-pitching this hit via
  // `playSequence`, not from the def itself. Kept short and quiet (UI weight,
  // not combat weight) since it fires on every buy and every sell.
  transaction: {
    waveType: 'square',
    freqStart: 720,
    freqEnd: 720,
    attack: 0.002,
    decay: 0.06,
    sustainLevel: 0.22,
    sustainTime: 0.015,
    release: 0.05,
    filterType: 'bandpass',
    filterCutoff: 2800,
    filterQ: 2.2,
    distortion: 0,
    delayTime: 0.07,
    delayFeedback: 0.15,
    delayMix: 0.1,
    reverbDecay: 0.4,
    reverbMix: 0.08,
    volume: 0.55,
  },
} satisfies Record<string, SynthParams>;

/** The sounds Kernel Panic can play, by name — derived from `KERNEL_PANIC_DEFS`. */
export type SoundName = keyof typeof KERNEL_PANIC_DEFS;

/**
 * One note of a scheduled arpeggio: a semitone transposition of a base sound
 * def and a start offset (seconds) from the moment the sequence is fired.
 * `AudioManager.playSequence` transposes the def's `freqStart`/`freqEnd` by
 * `2 ** (semitones / 12)` and schedules each hit at `now + when`.
 */
export interface SequenceStep {
  semitones: number;
  when: number;
}

/**
 * The run-complete flourish: `extracted` (root, 440 Hz) rising through its fifth
 * to the octave — a compact "extraction confirmed" resolution. Kept as data (not
 * three near-identical defs) so it stays retunable and the def table meaningful.
 */
export const EXTRACTION_MOTIF: readonly SequenceStep[] = [
  { semitones: 0, when: 0 },
  { semitones: 7, when: 0.11 },
  { semitones: 12, when: 0.24 },
];

/**
 * The "cha-ching": `transaction` (root) hopping up a fifth in ~50ms — quick
 * enough to not slow down rapid-fire selling (e.g. repeated SELL 1 taps), but
 * with enough of a gap to read as two distinct notes rather than a glitch.
 */
export const TRANSACTION_MOTIF: readonly SequenceStep[] = [
  { semitones: 0, when: 0 },
  { semitones: 7, when: 0.05 },
];
