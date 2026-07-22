import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KERNEL_PANIC_DEFS,
  EXTRACTION_MOTIF,
  TRANSACTION_MOTIF,
  type SoundName,
} from '../../src/audio/sounds.js';

// Valid ranges mirror the vendored TONEBENCH engine's published bounds
// (src/vendor/tonebench/tonebenchEngine.d.ts). Hardcoded here so the test does
// not depend on the vendored .js being present at runtime — and so a re-vendor
// that changes the bounds is a deliberate, reviewed edit to these constants.
const WAVE_TYPES = ['sine', 'square', 'sawtooth', 'triangle', 'noise'];
const FILTER_TYPES = ['none', 'lowpass', 'highpass', 'bandpass', 'notch'];
const FREQ_MIN = 20;
const FREQ_MAX = 4000;
const CUTOFF_MIN = 40;
const CUTOFF_MAX = 14000;

// The sound set itself is the single source of truth (src/audio/sounds.ts):
// `SoundName` is derived from `KERNEL_PANIC_DEFS`'s keys, so we iterate those
// keys rather than re-listing the names here. This test validates that each
// def's *values* fall in the vendored engine's published ranges — something
// the `satisfies SynthParams` type check cannot enforce.
const SOUND_NAMES = Object.keys(KERNEL_PANIC_DEFS) as SoundName[];

function inRange(v: number, min: number, max: number): boolean {
  return Number.isFinite(v) && v >= min && v <= max;
}

test('KERNEL_PANIC_DEFS defines a non-empty sound set', () => {
  assert.ok(SOUND_NAMES.length > 0, 'expected at least one sound');
});

test('slash is a short bright close-combat hit rather than a ballistic thump', () => {
  const slash = KERNEL_PANIC_DEFS.slash;
  const duration = slash.attack + slash.decay + slash.sustainTime + slash.release;

  assert.equal(slash.waveType, 'noise');
  assert.equal(slash.filterType, 'bandpass');
  assert.ok(slash.filterCutoff >= 2000, `filterCutoff ${slash.filterCutoff}`);
  assert.ok(slash.attack > 0.001, `attack ${slash.attack}`);
  assert.ok(duration <= 0.15, `duration ${duration}`);
  assert.ok(slash.distortion <= 25, `distortion ${slash.distortion}`);
  assert.equal(slash.delayMix, 0);
  assert.ok(slash.reverbMix <= 0.03, `reverbMix ${slash.reverbMix}`);
});

test('secured is a compact warm confirmation rather than a long bright fanfare', () => {
  const secured = KERNEL_PANIC_DEFS.secured;
  const duration = secured.attack + secured.decay + secured.sustainTime + secured.release;

  assert.equal(secured.waveType, 'triangle');
  assert.ok(secured.freqEnd <= 1000, `freqEnd ${secured.freqEnd}`);
  assert.equal(secured.filterType, 'lowpass');
  assert.ok(secured.filterCutoff <= 3000, `filterCutoff ${secured.filterCutoff}`);
  assert.ok(duration <= 0.22, `duration ${duration}`);
  assert.ok(secured.reverbDecay <= 0.5, `reverbDecay ${secured.reverbDecay}`);
  assert.ok(secured.reverbMix <= 0.1, `reverbMix ${secured.reverbMix}`);
  assert.ok(secured.delayMix <= 0.05, `delayMix ${secured.delayMix}`);
});

test('flatline is a sustained cold monitor tone, not a percussive thud', () => {
  const flatline = KERNEL_PANIC_DEFS.flatline;

  // Pure sine — the clinical monitor trope, deliberately unlike the distorted
  // sawtooth `down` (enemy kill). An operator dying is not a satisfying thud.
  assert.equal(flatline.waveType, 'sine');
  assert.equal(flatline.distortion, 0, 'clinical, undistorted');

  // "Flat": start and end pitch are near-identical — only a tiny downward sag as
  // the signal dies (freqEnd just under freqStart), never a sweep.
  assert.ok(flatline.freqEnd <= flatline.freqStart, 'sags, never rises');
  assert.ok(
    flatline.freqStart - flatline.freqEnd <= 40,
    `near-flat: ${flatline.freqStart} -> ${flatline.freqEnd}`
  );

  // Clear of the UI band (uiClick 900-1200): a low mournful tone, not a beep.
  assert.ok(flatline.freqStart < 900, `below UI band: ${flatline.freqStart}`);

  // Held and cold: long sustain + generous reverb tail (the room going quiet).
  assert.ok(flatline.sustainTime >= 0.6, `sustained: ${flatline.sustainTime}`);
  assert.ok(flatline.reverbDecay >= 1.5, `reverb tail: ${flatline.reverbDecay}`);
});

test('extracted is a stable resolving note (the motif provides the rise)', () => {
  const extracted = KERNEL_PANIC_DEFS.extracted;

  // The rise comes from EXTRACTION_MOTIF transposing this note, so the base note
  // itself must be stable — a sweep here would fight the arpeggio.
  assert.equal(extracted.freqStart, extracted.freqEnd, 'stable pitch, not a sweep');
  assert.equal(extracted.waveType, 'triangle');
  assert.equal(extracted.distortion, 0);

  // Warmer and more final than `secured`: it rings out with a real reverb tail.
  assert.ok(extracted.reverbDecay >= 1.0, `reverb ring: ${extracted.reverbDecay}`);
});

test('EXTRACTION_MOTIF is a rising arpeggio that stays in the engine band', () => {
  assert.ok(EXTRACTION_MOTIF.length >= 3, 'at least three notes');

  const base = KERNEL_PANIC_DEFS.extracted;
  let prevSemitones = -Infinity;
  let prevWhen = -Infinity;
  for (const step of EXTRACTION_MOTIF) {
    assert.ok(step.semitones > prevSemitones, `pitch rises: ${step.semitones}`);
    assert.ok(step.when > prevWhen || step.when === 0, `time advances: ${step.when}`);
    prevSemitones = step.semitones;
    prevWhen = step.when;

    // Transposed top note must not clip past the engine's ceiling.
    const top = base.freqEnd * 2 ** (step.semitones / 12);
    assert.ok(inRange(top, FREQ_MIN, FREQ_MAX), `transposed pitch ${top}`);
  }
  assert.equal(EXTRACTION_MOTIF[0].when, 0, 'first note plays immediately');
});

test('transaction is a stable bright register hit (the motif provides the rise)', () => {
  const transaction = KERNEL_PANIC_DEFS.transaction;

  // Stable pitch — like `extracted`, the "cha-ching" rise is TRANSACTION_MOTIF's
  // job, not a sweep baked into the def.
  assert.equal(transaction.freqStart, transaction.freqEnd, 'stable pitch, not a sweep');

  // Square + bandpass is a metallic "register" timbre distinct from every other
  // confirmation cue in the palette (secured/extracted/heal are sine/triangle).
  assert.equal(transaction.waveType, 'square');
  assert.equal(transaction.filterType, 'bandpass');
  assert.equal(transaction.distortion, 0, 'clean, not driven — economy, not violence');

  // UI weight, not combat weight: short and quieter than the perk/combat cues.
  const duration =
    transaction.attack + transaction.decay + transaction.sustainTime + transaction.release;
  assert.ok(duration <= 0.15, `short: ${duration}`);
  assert.ok(transaction.volume <= 0.6, `UI weight: ${transaction.volume}`);
});

test('TRANSACTION_MOTIF is a quick two-note "cha-ching" that stays in the engine band', () => {
  assert.equal(TRANSACTION_MOTIF.length, 2, 'two notes — a hop, not an arpeggio');

  const base = KERNEL_PANIC_DEFS.transaction;
  const [first, second] = TRANSACTION_MOTIF;
  assert.equal(first.when, 0, 'first note plays immediately');
  assert.ok(second.semitones > first.semitones, 'pitch rises');
  assert.ok(second.when > first.when, 'time advances');

  // Quick enough not to slow down rapid repeat sells (e.g. mashing SELL 1).
  assert.ok(second.when <= 0.08, `snappy: ${second.when}`);

  const top = base.freqEnd * 2 ** (second.semitones / 12);
  assert.ok(inRange(top, FREQ_MIN, FREQ_MAX), `transposed pitch ${top}`);
});

// --- Operator perk cues ------------------------------------------------------
// Each signature perk gets a distinct sonic fiction. These tests pin the design
// *intent* (direction, timbre family, distortion) so a retune can't silently
// collapse a perk into a neighbour or into the combat SFX.

test('every signature perk has a sound def', () => {
  for (const name of [
    'vault', // Merc BREAK
    'slide', // Razor SLIDE
    'emp', // Decker EMP
    'surge', // Berserk SURGE
    'surgeCrash', // Berserk CRASH (the comedown)
    'influence', // Adept INFLUENCE — success
    'influenceResist', // Adept INFLUENCE — resisted
    'heal', // Chimera NANITE REPAIR / Stim / clinic
    'deploy', // Tech DEPLOY — mechanical clunk
    'deployOnline', // Tech DEPLOY — power-on chirp
  ] as const) {
    assert.ok(KERNEL_PANIC_DEFS[name], `missing perk sound: ${name}`);
  }
});
