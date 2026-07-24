import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { SynthParams } from '../../src/vendor/tonebench/tonebenchEngine.js';
import {
  MusicDirector,
  pitched,
  LOOKAHEAD_SECONDS,
  RESYNC_THRESHOLD_SECONDS,
} from '../../src/audio/MusicDirector.js';
import {
  MUSIC_DEFS,
  MUSIC_PALETTES,
  TENSION_CONFIG,
  degreeToFreq,
  resolveModulation,
  type MusicModulation,
  type MusicPaletteName,
  type MusicTension,
  type MusicVoiceName,
} from '../../src/audio/music.js';

// --- Harness ------------------------------------------------------------------
// Node has no Web Audio and no wall clock we want to wait on, so both the audio
// clock and the timer are driven by hand. `advance()` moves the clock and fires
// exactly one scheduler tick, which is what a real interval does.

const START_TIME = 100;

interface Emitted {
  def: SynthParams;
  when: number;
}

function harness(seed = 42) {
  let now = START_TIME;
  const emitted: Emitted[] = [];
  const modulations: MusicModulation[] = [];
  let tickFn: (() => void) | null = null;
  let scheduleCalls = 0;

  const director = new MusicDirector({
    emit: (def, when) => emitted.push({ def, when }),
    modulate: modulation => modulations.push(modulation),
    now: () => now,
    schedule: fn => {
      tickFn = fn;
      scheduleCalls++;
      return 1;
    },
    cancel: () => {
      tickFn = null;
    },
    seed,
  });

  return {
    director,
    emitted,
    modulations,
    get now() {
      return now;
    },
    get scheduleCalls() {
      return scheduleCalls;
    },
    /** Move the clock forward and fire one tick, as a live interval would. */
    advance(seconds: number) {
      now += seconds;
      tickFn?.();
    },
    /** Jump the clock without ticking — models a suspended/backgrounded tab. */
    jump(seconds: number) {
      now += seconds;
    },
    tick() {
      tickFn?.();
    },
  };
}

const VOICE_NAMES = Object.keys(MUSIC_DEFS) as MusicVoiceName[];

/**
 * Recovers which voice def a scheduled note came from. Notes are spread copies
 * with only the two frequency fields rewritten, so every other field still
 * identifies the source voice.
 */
function voiceOf(def: SynthParams): MusicVoiceName {
  for (const name of VOICE_NAMES) {
    const base = MUSIC_DEFS[name];
    let matches = true;
    for (const key of Object.keys(base) as (keyof SynthParams)[]) {
      if (key === 'freqStart' || key === 'freqEnd') continue;
      if (base[key] !== def[key]) {
        matches = false;
        break;
      }
    }
    if (matches) return name;
  }
  throw new Error(`no voice matches scheduled def: ${JSON.stringify(def)}`);
}

function voicesIn(emitted: Emitted[]): Set<MusicVoiceName> {
  return new Set(emitted.map(e => voiceOf(e.def)));
}

/** Every frequency the palette can legitimately produce, rounded for lookup. */
function allowedPitches(paletteName: MusicPaletteName): Set<number> {
  const palette = MUSIC_PALETTES[paletteName];
  const out = new Set<number>();
  for (const degree of palette.padDegrees) {
    for (const spec of palette.pad) {
      out.add(Math.round(degreeToFreq(palette, degree, spec.semitone, spec.cents) * 1e6));
    }
  }
  for (const degree of palette.bassDegrees) {
    out.add(Math.round(degreeToFreq(palette, degree, palette.bassOctave) * 1e6));
  }
  for (let degree = 0; degree < palette.scale.length; degree++) {
    out.add(Math.round(degreeToFreq(palette, degree, palette.arpOctave) * 1e6));
  }
  return out;
}

/** The largest pad stagger across all palettes — the scheduling tail. */
const MAX_STAGGER = Math.max(
  ...(Object.keys(MUSIC_PALETTES) as MusicPaletteName[]).flatMap(name =>
    MUSIC_PALETTES[name].pad.map(spec => spec.when)
  )
);

// --- pitched ------------------------------------------------------------------

test('pitched retunes a def while preserving its drift ratio', () => {
  const base = MUSIC_DEFS.padHigh; // 220 -> 219, a deliberate downward sag
  const note = pitched(base, 440);
  assert.equal(note.freqStart, 440);
  assert.ok(Math.abs(note.freqEnd - 440 * (219 / 220)) < 1e-9, `freqEnd ${note.freqEnd}`);
  // Everything else is carried through untouched.
  assert.equal(note.waveType, base.waveType);
  assert.equal(note.filterCutoff, base.filterCutoff);
  assert.equal(note.volume, base.volume);
});

test('pitched leaves a flat def flat', () => {
  const note = pitched(MUSIC_DEFS.bassPulse, 100); // 55 -> 55
  assert.equal(note.freqStart, 100);
  assert.ok(Math.abs(note.freqEnd - 100) < 1e-9);
});

// --- Scheduling contract ------------------------------------------------------

test('start schedules immediately rather than waiting for the first interval', () => {
  const h = harness();
  h.director.start();
  assert.ok(h.emitted.length > 0, 'the bed begins on the gesture, not TICK_MS later');
  assert.equal(h.director.running, true);
});

test('start is idempotent — no double-scheduling', () => {
  const h = harness();
  h.director.start();
  const after = h.scheduleCalls;
  h.director.start();
  h.director.start();
  assert.equal(h.scheduleCalls, after, 'timer installed exactly once');
});

test('no note is scheduled in the past or past the lookahead horizon', () => {
  const h = harness();
  h.director.setTension(2); // all three layers active
  h.director.start();
  for (let i = 0; i < 20; i++) h.advance(0.25);

  const ceiling = h.now + LOOKAHEAD_SECONDS + MAX_STAGGER;
  for (const note of h.emitted) {
    assert.ok(note.when >= START_TIME, `scheduled in the past: ${note.when}`);
    assert.ok(note.when <= ceiling, `beyond horizon: ${note.when} > ${ceiling}`);
  }
});

test('each voice is scheduled in non-decreasing time order', () => {
  // Across layers the emission order interleaves (a pad's staggered tail can be
  // emitted before an arp note that sounds earlier), but within a single voice
  // time must never go backwards.
  const h = harness();
  h.director.setTension(2);
  h.director.start();
  for (let i = 0; i < 20; i++) h.advance(0.25);

  const last = new Map<MusicVoiceName, number>();
  for (const note of h.emitted) {
    const voice = voiceOf(note.def);
    const prev = last.get(voice);
    if (prev !== undefined) {
      assert.ok(note.when >= prev, `${voice} went backwards: ${prev} -> ${note.when}`);
    }
    last.set(voice, note.when);
  }
});

test('the bed is continuous — pads retrigger before the previous one ends', () => {
  const h = harness();
  h.director.start();
  for (let i = 0; i < 60; i++) h.advance(0.25);

  const padVoice = MUSIC_PALETTES.meat.pad[0].voice;
  const padTimes = h.emitted.filter(e => voiceOf(e.def) === padVoice).map(e => e.when);
  assert.ok(padTimes.length >= 2, `expected repeated pads, got ${padTimes.length}`);

  const padDuration =
    MUSIC_DEFS[padVoice].attack +
    MUSIC_DEFS[padVoice].decay +
    MUSIC_DEFS[padVoice].sustainTime +
    MUSIC_DEFS[padVoice].release;
  for (let i = 1; i < padTimes.length; i++) {
    const gap = padTimes[i] - padTimes[i - 1];
    assert.ok(gap > 0 && gap < padDuration, `pad gap ${gap}s vs duration ${padDuration}s`);
  }
});

// --- Tension gating -----------------------------------------------------------

test('tension 0 is pad-only', () => {
  const h = harness();
  h.director.setTension(0);
  h.director.start();
  for (let i = 0; i < 40; i++) h.advance(0.25);

  const voices = voicesIn(h.emitted);
  const palette = MUSIC_PALETTES.meat;
  assert.ok(voices.size > 0, 'something must play');
  assert.ok(!voices.has(palette.bass), 'no bass at rest');
  assert.ok(!voices.has(palette.arp), 'no arp at rest');
});

test('tension 1 is the full run baseline — all three layers, un-alarmed', () => {
  for (const paletteName of ['meat', 'cyber'] as MusicPaletteName[]) {
    const h = harness();
    h.director.setTension(1);
    h.director.setPalette(paletteName);
    h.director.start();
    for (let i = 0; i < 40; i++) h.advance(0.25);

    const voices = voicesIn(h.emitted);
    const palette = MUSIC_PALETTES[paletteName];
    assert.ok(voices.has(palette.pad[0].voice), `${paletteName} pad`);
    assert.ok(voices.has(palette.bass), `${paletteName} bass`);
    assert.ok(voices.has(palette.arp), `${paletteName} arp`);
  }
});

test('the alarm plays the same material as the run, not a note storm', () => {
  function sample(tension: MusicTension) {
    const h = harness();
    h.director.setTension(tension);
    h.director.start();
    for (let i = 0; i < 40; i++) h.advance(0.25);

    const span = Math.max(...h.emitted.map(e => e.when)) - START_TIME;
    const counts = new Map<MusicVoiceName, number>();
    for (const note of h.emitted) {
      const voice = voiceOf(note.def);
      counts.set(voice, (counts.get(voice) ?? 0) + 1);
    }
    return { counts, rate: h.emitted.length / span };
  }

  const run = sample(1);
  const alarm = sample(2);
  const palette = MUSIC_PALETTES.meat;

  // Same layers, at a comparable rate — the escalation lives in the sweep, so
  // if this ever balloons, the alarm has quietly gone back to being "busier".
  for (const voice of [palette.pad[0].voice, palette.bass, palette.arp]) {
    assert.ok(run.counts.has(voice), `run is missing ${voice}`);
    assert.ok(alarm.counts.has(voice), `alarm is missing ${voice}`);
  }
  assert.ok(
    alarm.rate < run.rate * 1.35,
    `alarm ${alarm.rate.toFixed(2)} notes/s vs run ${run.rate.toFixed(2)} notes/s`
  );
});

// --- Modulation ---------------------------------------------------------------

test('the sweep is pushed once on start, before any tension change', () => {
  const h = harness();
  h.director.start();
  assert.equal(h.modulations.length, 1, 'the bus is configured from the first bar');
  assert.deepEqual(h.modulations[0], resolveModulation(0, MUSIC_PALETTES.meat));
});

test('a tension change moves the sweep, and only on the bar', () => {
  const h = harness();
  h.director.start();
  const initial = h.modulations.length;

  h.director.setTension(2);
  assert.equal(h.modulations.length, initial, 'not the instant it is requested');

  const cfg = TENSION_CONFIG[0];
  const bar = cfg.secondsPerBeat * cfg.beatsPerBar;
  for (let i = 0; i < Math.ceil((bar * 2) / 0.25); i++) h.advance(0.25);

  const latest = h.modulations[h.modulations.length - 1];
  assert.ok(h.modulations.length > initial, 'the sweep followed the tension');
  assert.deepEqual(latest, resolveModulation(2, MUSIC_PALETTES.meat));
  assert.ok(latest.depthCents > 0, 'the alarm actually sweeps');
});

test('a palette change moves the sweep too — depth is palette-scaled', () => {
  const h = harness();
  h.director.setTension(2);
  h.director.start();
  const meatDepth = h.modulations[h.modulations.length - 1].depthCents;

  h.director.setPalette('cyber');
  for (let i = 0; i < 40; i++) h.advance(0.25);

  const cyberDepth = h.modulations[h.modulations.length - 1].depthCents;
  assert.notEqual(cyberDepth, meatDepth, 'the palette scale was applied');
  assert.deepEqual(
    h.modulations[h.modulations.length - 1],
    resolveModulation(2, MUSIC_PALETTES.cyber)
  );
});

test('an unchanged tension does not re-push the sweep every bar', () => {
  // So a hand-dialled setting in the debug harness survives between changes.
  const h = harness();
  h.director.setTension(1);
  h.director.start();
  const after = h.modulations.length;
  for (let i = 0; i < 60; i++) h.advance(0.25);
  assert.equal(h.modulations.length, after, 'no redundant modulation pushes');
});

test('the director reports the sweep its current state resolves to', () => {
  const h = harness();
  h.director.setTension(2);
  h.director.setPalette('cyber');
  assert.deepEqual(h.director.modulation, resolveModulation(2, MUSIC_PALETTES.cyber));
});

test('tension changes land on a bar boundary, never mid-bar', () => {
  const h = harness();
  h.director.start();
  assert.equal(h.director.tension, 0);

  h.director.setTension(2);
  assert.equal(h.director.tension, 0, 'not adopted the instant it is requested');

  // A bar at tension 0 is secondsPerBeat × beatsPerBar. Advance past one and
  // the change must have been taken up.
  const cfg = TENSION_CONFIG[0];
  const bar = cfg.secondsPerBeat * cfg.beatsPerBar;
  for (let i = 0; i < Math.ceil((bar * 2) / 0.25); i++) h.advance(0.25);
  assert.equal(h.director.tension, 2, 'adopted by the next bar');
});

test('tension set before start applies immediately (nothing is silently dropped)', () => {
  const h = harness();
  h.director.setTension(2);
  assert.equal(h.director.tension, 2, 'no bar boundary is coming while stopped');
});

test('setTension rejects an unknown level (fail loud)', () => {
  const h = harness();
  assert.throws(() => h.director.setTension(7 as MusicTension), /unknown tension/);
});

// --- Palette ------------------------------------------------------------------

test('every scheduled pitch belongs to the active palette', () => {
  for (const paletteName of ['meat', 'cyber'] as MusicPaletteName[]) {
    const h = harness();
    h.director.setTension(2);
    h.director.setPalette(paletteName);
    h.director.start();
    for (let i = 0; i < 40; i++) h.advance(0.25);

    const allowed = allowedPitches(paletteName);
    assert.ok(h.emitted.length > 0, `${paletteName}: nothing played`);
    for (const note of h.emitted) {
      assert.ok(
        allowed.has(Math.round(note.def.freqStart * 1e6)),
        `${paletteName}: off-scale pitch ${note.def.freqStart}`
      );
    }
  }
});

test('the palette switch changes which voices sound', () => {
  const meat = harness();
  meat.director.setTension(2);
  meat.director.start();
  for (let i = 0; i < 20; i++) meat.advance(0.25);

  const cyber = harness();
  cyber.director.setTension(2);
  cyber.director.setPalette('cyber');
  cyber.director.start();
  for (let i = 0; i < 20; i++) cyber.advance(0.25);

  const meatVoices = voicesIn(meat.emitted);
  const cyberVoices = voicesIn(cyber.emitted);
  for (const voice of cyberVoices) {
    assert.ok(!meatVoices.has(voice), `${voice} leaked across palettes`);
  }
});

test('setPalette rejects an unknown palette (fail loud)', () => {
  const h = harness();
  assert.throws(() => h.director.setPalette('astral' as MusicPaletteName), /unknown palette/);
});

// --- Determinism --------------------------------------------------------------

test('same seed and same tension sequence produce an identical score', () => {
  function run(seed: number) {
    const h = harness(seed);
    h.director.setTension(2);
    h.director.start();
    for (let i = 0; i < 40; i++) h.advance(0.25);
    return h.emitted.map(
      e => `${voiceOf(e.def)}@${e.when.toFixed(6)}:${e.def.freqStart.toFixed(6)}`
    );
  }
  const a = run(1234);
  const b = run(1234);
  assert.deepEqual(a, b, 'the score must be reproducible from its seed');
  assert.ok(a.length > 0);
});

test('different seeds produce different scores', () => {
  function run(seed: number) {
    const h = harness(seed);
    h.director.setTension(2);
    h.director.start();
    for (let i = 0; i < 40; i++) h.advance(0.25);
    return h.emitted.map(
      e => `${voiceOf(e.def)}@${e.when.toFixed(6)}:${e.def.freqStart.toFixed(6)}`
    );
  }
  assert.notDeepEqual(run(1), run(999), 'seeding must actually vary note choice');
});

test('reseed makes a running director reproducible from a known point', () => {
  function run() {
    const h = harness(1);
    h.director.setTension(2);
    h.director.reseed(4242);
    h.director.start();
    for (let i = 0; i < 20; i++) h.advance(0.25);
    return h.emitted.map(e => `${e.when.toFixed(6)}:${e.def.freqStart.toFixed(6)}`);
  }
  assert.deepEqual(run(), run());
});

// --- Stop / resume ------------------------------------------------------------

test('stop halts scheduling', () => {
  const h = harness();
  h.director.setTension(2);
  h.director.start();
  for (let i = 0; i < 8; i++) h.advance(0.25);
  const count = h.emitted.length;

  h.director.stop();
  assert.equal(h.director.running, false);
  for (let i = 0; i < 20; i++) h.advance(0.25);
  assert.equal(h.emitted.length, count, 'no further notes after stop');
});

test('stop is idempotent', () => {
  const h = harness();
  h.director.start();
  h.director.stop();
  h.director.stop();
  assert.equal(h.director.running, false);
});

test('restarting after a long pause re-anchors instead of backfilling', () => {
  const h = harness();
  h.director.start();
  for (let i = 0; i < 4; i++) h.advance(0.25);
  h.director.stop();

  h.jump(300); // five minutes in a background tab
  const before = h.emitted.length;
  h.director.start();

  const fresh = h.emitted.slice(before);
  assert.ok(fresh.length > 0, 'restart resumes playing');
  for (const note of fresh) {
    assert.ok(note.when >= h.now, `backfilled a stale note at ${note.when} (now ${h.now})`);
  }
});

test('a stalled clock resyncs rather than dumping every missed beat at once', () => {
  // The failure this guards: a suspended context leaves the beat clock minutes
  // behind, and a naive catch-up loop emits hundreds of simultaneous notes —
  // an audible blast, and potentially hundreds of oscillators at once.
  const h = harness();
  h.director.setTension(2);
  h.director.start();
  const before = h.emitted.length;

  h.jump(600); // ten minutes
  h.tick();

  const burst = h.emitted.slice(before);
  const cfg = TENSION_CONFIG[2];
  const maxBeats = Math.ceil(LOOKAHEAD_SECONDS / cfg.secondsPerBeat) + 1;
  const maxNotes = maxBeats * (MUSIC_PALETTES.meat.pad.length + 1 + 2);
  assert.ok(
    burst.length <= maxNotes,
    `emitted ${burst.length} notes after a 600s stall (cap ${maxNotes})`
  );
  for (const note of burst) {
    assert.ok(note.when >= h.now, `stale note at ${note.when} (now ${h.now})`);
  }
});

test('a stall shorter than the resync threshold is absorbed without a gap', () => {
  // Tension 2, where every beat carries a bass note — at tension 0 the pad is
  // the only layer and fires every 8s, so "did the schedule advance" would be
  // unobservable inside the window under test.
  const h = harness();
  h.director.setTension(2);
  h.director.start();
  for (let i = 0; i < 4; i++) h.advance(0.25);
  const lastBefore = Math.max(...h.emitted.map(e => e.when));

  // Late tick, but inside the threshold: the schedule should continue from
  // where it was rather than re-anchoring (which would drop the pulse).
  h.jump(RESYNC_THRESHOLD_SECONDS - 0.5);
  h.tick();

  const lastAfter = Math.max(...h.emitted.map(e => e.when));
  assert.ok(lastAfter > lastBefore, 'the schedule advanced');
});
