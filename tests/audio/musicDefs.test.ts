import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MUSIC_DEFS,
  MUSIC_PALETTES,
  TENSION_CONFIG,
  MAX_NOTE_DURATION,
  degreeToFreq,
  resolveModulation,
  type MusicVoiceName,
  type MusicPaletteName,
  type MusicTension,
} from '../../src/audio/music.js';

// Same vendored bounds as soundDefs.test.ts, hardcoded for the same reason: the
// test must not depend on the vendored .js being loadable under node --test.
const WAVE_TYPES = ['sine', 'square', 'sawtooth', 'triangle', 'noise'];
const FILTER_TYPES = ['none', 'lowpass', 'highpass', 'bandpass', 'notch'];
const FREQ_MIN = 20;
const FREQ_MAX = 4000;
const CUTOFF_MIN = 40;
const CUTOFF_MAX = 14000;

const VOICE_NAMES = Object.keys(MUSIC_DEFS) as MusicVoiceName[];
const PALETTE_NAMES = Object.keys(MUSIC_PALETTES) as MusicPaletteName[];
const TENSIONS: MusicTension[] = [0, 1, 2];

function inRange(v: number, min: number, max: number): boolean {
  return Number.isFinite(v) && v >= min && v <= max;
}

function duration(p: { attack: number; decay: number; sustainTime: number; release: number }) {
  return p.attack + p.decay + p.sustainTime + p.release;
}

// --- The engine-cost constraints ---------------------------------------------
// These are the tests that matter most. Music fires notes orders of magnitude
// more often than SFX, and three TONEBENCH features allocate a large buffer PER
// HIT. A def that reintroduces one would degrade gradually under load rather
// than fail outright — exactly the kind of bug a type check cannot catch.

for (const name of VOICE_NAMES) {
  test(`music voice "${name}" allocates no per-note buffers`, () => {
    const p = MUSIC_DEFS[name];

    // Builds a stereo impulse response of sampleRate × reverbDecay per hit.
    // The music bus carries one shared convolver instead.
    assert.equal(p.reverbMix, 0, 'reverb belongs on the shared music bus, not the note');

    // Allocates a 44,100-sample waveshaper curve per hit.
    assert.equal(p.distortion, 0, 'distortion allocates a shaper curve per note');

    // Builds a delay + feedback graph per hit; the bus owns one shared delay.
    assert.equal(p.delayMix, 0, 'delay belongs on the shared music bus, not the note');
  });
}

test('no pad voice uses noise (it would allocate sampleRate × duration per retrigger)', () => {
  for (const paletteName of PALETTE_NAMES) {
    for (const spec of MUSIC_PALETTES[paletteName].pad) {
      const p = MUSIC_DEFS[spec.voice];
      assert.notEqual(p.waveType, 'noise', `${paletteName} pad voice ${spec.voice}`);
    }
  }
});

test('every voice plays out within MAX_NOTE_DURATION', () => {
  // The scheduler uses this bound to know when a stopped director has gone
  // quiet; a longer def would leave notes ringing past it.
  for (const name of VOICE_NAMES) {
    assert.ok(
      duration(MUSIC_DEFS[name]) <= MAX_NOTE_DURATION,
      `${name} ${duration(MUSIC_DEFS[name])}`
    );
  }
});

// --- Design intent ------------------------------------------------------------

test('music sits below the SFX palette in volume — it is a bed, not an event', () => {
  for (const name of VOICE_NAMES) {
    assert.ok(MUSIC_DEFS[name].volume <= 0.35, `${name} volume ${MUSIC_DEFS[name].volume}`);
  }
});

test('pads are long and slow-attacking so consecutive retriggers crossfade', () => {
  for (const paletteName of PALETTE_NAMES) {
    for (const spec of MUSIC_PALETTES[paletteName].pad) {
      const p = MUSIC_DEFS[spec.voice];
      assert.ok(p.attack >= 1.5, `${spec.voice} attack ${p.attack} — must bloom, not strike`);
      assert.ok(p.release >= 1.5, `${spec.voice} release ${p.release} — must tail into the next`);
      assert.ok(duration(p) >= 6, `${spec.voice} duration ${duration(p)}`);
    }
  }
});

test('pad retrigger interval stays below pad duration at every tension (no holes in the bed)', () => {
  // The load-bearing tuning invariant. If a tempo change pushes the retrigger
  // interval past the note duration, the bed develops audible gaps — which is
  // hard to spot by ear at low tension and obvious at high.
  for (const paletteName of PALETTE_NAMES) {
    const palette = MUSIC_PALETTES[paletteName];
    const shortestPad = Math.min(...palette.pad.map(spec => duration(MUSIC_DEFS[spec.voice])));
    for (const tension of TENSIONS) {
      const cfg = TENSION_CONFIG[tension];
      const interval = cfg.secondsPerBeat * cfg.beatsPerBar * cfg.padIntervalBars;
      assert.ok(
        interval < shortestPad,
        `${paletteName} t${tension}: retrigger ${interval}s >= pad ${shortestPad}s`
      );
    }
  }
});

test('tension escalates monotonically: never slower, never thinner', () => {
  const cfgs = TENSIONS.map(t => TENSION_CONFIG[t]);
  for (let i = 1; i < cfgs.length; i++) {
    assert.ok(
      cfgs[i].secondsPerBeat < cfgs[i - 1].secondsPerBeat,
      `tempo must rise: t${i} ${cfgs[i].secondsPerBeat} vs t${i - 1} ${cfgs[i - 1].secondsPerBeat}`
    );
    assert.ok(cfgs[i].bassDensity >= cfgs[i - 1].bassDensity, `bass density t${i}`);
    assert.ok(cfgs[i].arpDensity >= cfgs[i - 1].arpDensity, `arp density t${i}`);
    assert.ok(cfgs[i].arpSubdivisions >= cfgs[i - 1].arpSubdivisions, `arp subdivisions t${i}`);
  }
});

test('the hub is pad-only — nothing to pulse against with no run underway', () => {
  assert.equal(TENSION_CONFIG[0].bassDensity, 0);
  assert.equal(TENSION_CONFIG[0].arpDensity, 0);
});

test('a run carries the full bed from its first turn, not only once alarmed', () => {
  // Being inside a facility at all is the tense state. If the arp only arrived
  // with the alarm, an un-alarmed run would sound like the hub with a pulse.
  assert.ok(TENSION_CONFIG[1].bassDensity > 0, 'bass plays on a quiet run');
  assert.ok(TENSION_CONFIG[1].arpDensity > 0, 'arp plays on a quiet run');
});

test('the alarm escalates through the sweep, not through note density', () => {
  const run = TENSION_CONFIG[1];
  const alarm = TENSION_CONFIG[2];

  // The design decision this pins: density escalation reads as merely "busier",
  // which is ambiguous. The alarm is carried by modulation instead — so the note
  // material must stay close to the run's, and the sweep must do the work.
  const noteRate = (cfg: typeof run) =>
    (cfg.bassDensity + cfg.arpDensity * cfg.arpSubdivisions) / cfg.secondsPerBeat;
  assert.ok(
    noteRate(alarm) < noteRate(run) * 1.35,
    `alarm must not become a note storm: ${noteRate(alarm).toFixed(2)}/s vs ${noteRate(run).toFixed(2)}/s`
  );

  // And the sweep must escalate hard on every axis that makes it legible.
  assert.ok(alarm.sweep.depthCents >= run.sweep.depthCents * 3, 'sweep opens up dramatically');
  assert.ok(alarm.sweepCyclesPerBar > run.sweepCyclesPerBar, 'and moves faster');
  assert.ok(alarm.sweep.q > run.sweep.q, 'with more resonance to make it audible');
  assert.ok(alarm.sweep.baseCutoff < run.sweep.baseCutoff, 'centred lower, so it has room to open');
});

test('tension 0 leaves the bus filter effectively bypassed', () => {
  // The filter is always in the chain, so at rest it must not colour the bed.
  // Every voice fundamental is at or below ~880 Hz (see the arp defs).
  const rest = TENSION_CONFIG[0].sweep;
  assert.equal(rest.depthCents, 0, 'no sweep at rest');
  assert.ok(rest.baseCutoff >= 8000, `cutoff must sit clear of the material: ${rest.baseCutoff}`);
  assert.ok(rest.q <= 1, `no resonant colouring at rest: ${rest.q}`);
});

test('the sweep escalates monotonically with tension', () => {
  const cfgs = TENSIONS.map(t => TENSION_CONFIG[t]);
  for (let i = 1; i < cfgs.length; i++) {
    assert.ok(
      cfgs[i].sweep.depthCents >= cfgs[i - 1].sweep.depthCents,
      `sweep depth must not shrink at t${i}`
    );
  }
});

test('the sweep floor stays above the bass, so the pulse keeps its anchor', () => {
  // Bass sits at 55-98 Hz. If the cutoff swept down through it the pulse would
  // vanish at the bottom of every cycle and the bar would lose its anchor.
  for (const tension of TENSIONS) {
    const cfg = TENSION_CONFIG[tension];
    if (cfg.sweep.depthCents === 0) continue;
    for (const paletteName of PALETTE_NAMES) {
      const palette = MUSIC_PALETTES[paletteName];
      const mod = resolveModulation(tension, palette);
      // The LFO is bipolar, so the cutoff floor is base transposed *down* by
      // the full depth.
      const floor = mod.baseCutoff * 2 ** (-mod.depthCents / 1200);
      const bassTop = Math.max(
        ...palette.bassDegrees.map(d => degreeToFreq(palette, d, palette.bassOctave))
      );
      assert.ok(
        floor > bassTop,
        `${paletteName} t${tension}: sweep floor ${floor.toFixed(0)}Hz would swallow bass at ${bassTop.toFixed(0)}Hz`
      );
    }
  }
});

test('meat sweeps wider than cyber to offset its harmonically poor pads', () => {
  // A lowpass can only move harmonics that exist. Meat's triangle+sine pads have
  // far less above the fundamental than cyber's saw+square, so identical depth
  // would read as a much smaller gesture there.
  assert.ok(MUSIC_PALETTES.meat.padDepthScale > MUSIC_PALETTES.cyber.padDepthScale);
  const meat = resolveModulation(2, MUSIC_PALETTES.meat);
  const cyber = resolveModulation(2, MUSIC_PALETTES.cyber);
  assert.ok(meat.depthCents > cyber.depthCents);
  assert.equal(meat.hz, cyber.hz, 'rate is tempo-derived, so it must not vary by palette');
});

test('resolveModulation syncs the LFO to the bar', () => {
  // An unsynced sweep drifting against the pulse sounds broken, not intentional.
  for (const tension of TENSIONS) {
    const cfg = TENSION_CONFIG[tension];
    const barSeconds = cfg.secondsPerBeat * cfg.beatsPerBar;
    const mod = resolveModulation(tension, MUSIC_PALETTES.meat);
    assert.ok(
      Math.abs(mod.hz * barSeconds - cfg.sweepCyclesPerBar) < 1e-9,
      `t${tension}: ${mod.hz}Hz over a ${barSeconds}s bar is not ${cfg.sweepCyclesPerBar} cycles`
    );
  }
});

test('the two palettes are audibly distinct, not one palette transposed', () => {
  const meat = MUSIC_PALETTES.meat;
  const cyber = MUSIC_PALETTES.cyber;

  // Different scales — cyber is whole-tone (no semitone steps), which is what
  // makes it read as rootless/inhuman next to the meatspace minor.
  assert.notDeepEqual(meat.scale, cyber.scale);
  const cyberSteps = cyber.scale.slice(1).map((s, i) => s - cyber.scale[i]);
  assert.ok(
    cyberSteps.every(step => step === 2),
    `cyber scale should be whole-tone, got steps ${cyberSteps.join(',')}`
  );
  assert.ok(meat.scale.includes(3), 'meat scale should carry a minor third');

  // Different timbres, not just different notes.
  assert.notEqual(MUSIC_DEFS[meat.pad[0].voice].waveType, MUSIC_DEFS[cyber.pad[0].voice].waveType);
});

test('pad stacks are detuned and staggered — the only source of pad movement', () => {
  // The engine cannot modulate within a note (static filter, single pitch ramp),
  // so if the stack ever collapses to unison-and-simultaneous the pad goes dead
  // flat. These assertions pin that design constraint.
  for (const paletteName of PALETTE_NAMES) {
    const pad = MUSIC_PALETTES[paletteName].pad;
    assert.ok(pad.length >= 3, `${paletteName} pad needs a stack, got ${pad.length}`);
    assert.ok(
      pad.some(spec => spec.cents !== 0),
      `${paletteName} pad voices must be detuned against each other`
    );
    assert.ok(
      new Set(pad.map(spec => spec.when)).size === pad.length,
      `${paletteName} pad entries must be staggered, not simultaneous`
    );
    assert.equal(pad[0].when, 0, `${paletteName} pad's first voice enters immediately`);
    // Every voice must still be inside the note it is stacked under, or the
    // stagger becomes a gap rather than a bloom.
    for (const spec of pad) {
      assert.ok(spec.when < duration(MUSIC_DEFS[spec.voice]), `${spec.voice} enters too late`);
    }
  }
});

// --- degreeToFreq -------------------------------------------------------------

test('degreeToFreq maps degree 0 to the palette root', () => {
  for (const name of PALETTE_NAMES) {
    const palette = MUSIC_PALETTES[name];
    assert.ok(Math.abs(degreeToFreq(palette, 0) - palette.root) < 1e-9);
  }
});

test('degreeToFreq wraps past the scale end, carrying an octave', () => {
  const meat = MUSIC_PALETTES.meat;
  const len = meat.scale.length;
  // One full scale above the tonic is exactly an octave.
  assert.ok(Math.abs(degreeToFreq(meat, len) - meat.root * 2) < 1e-9);
  // And negative degrees wrap downward rather than throwing or clamping.
  assert.ok(Math.abs(degreeToFreq(meat, -len) - meat.root / 2) < 1e-9);
  assert.ok(degreeToFreq(meat, -1) < meat.root, 'degree -1 sits below the tonic');
});

test('degreeToFreq applies semitone shift and cent detune', () => {
  const meat = MUSIC_PALETTES.meat;
  assert.ok(Math.abs(degreeToFreq(meat, 0, 12) - meat.root * 2) < 1e-9, 'octave shift');
  const detuned = degreeToFreq(meat, 0, 0, 100);
  assert.ok(Math.abs(detuned - meat.root * 2 ** (1 / 12)) < 1e-9, '100 cents == 1 semitone');
});

test('every reachable pitch stays inside the engine frequency band', () => {
  // Guards the layer registers: a bass octave pushed too low or an arp octave
  // too high would silently ramp outside what the engine can render.
  for (const paletteName of PALETTE_NAMES) {
    const palette = MUSIC_PALETTES[paletteName];
    for (let degree = 0; degree < palette.scale.length; degree++) {
      const pitches = [
        ...palette.pad.map(spec => degreeToFreq(palette, degree, spec.semitone, spec.cents)),
        degreeToFreq(palette, degree, palette.bassOctave),
        degreeToFreq(palette, degree, palette.arpOctave),
      ];
      for (const freq of pitches) {
        assert.ok(inRange(freq, FREQ_MIN, FREQ_MAX), `${paletteName} degree ${degree}: ${freq}`);
      }
    }
  }
});

// --- Param validity (mirrors soundDefs.test.ts) -------------------------------

test('MUSIC_DEFS defines a non-empty voice set', () => {
  assert.ok(VOICE_NAMES.length > 0);
});

test('every palette references voices that exist', () => {
  for (const paletteName of PALETTE_NAMES) {
    const palette = MUSIC_PALETTES[paletteName];
    for (const spec of palette.pad) {
      assert.ok(MUSIC_DEFS[spec.voice], `${paletteName} pad voice ${spec.voice}`);
    }
    assert.ok(MUSIC_DEFS[palette.bass], `${paletteName} bass ${palette.bass}`);
    assert.ok(MUSIC_DEFS[palette.arp], `${paletteName} arp ${palette.arp}`);
  }
});

for (const name of VOICE_NAMES) {
  test(`music voice "${name}" has valid synth params`, () => {
    const p = MUSIC_DEFS[name];

    assert.ok(WAVE_TYPES.includes(p.waveType), `waveType ${p.waveType}`);
    assert.ok(FILTER_TYPES.includes(p.filterType), `filterType ${p.filterType}`);

    assert.ok(inRange(p.freqStart, FREQ_MIN, FREQ_MAX), `freqStart ${p.freqStart}`);
    assert.ok(inRange(p.freqEnd, FREQ_MIN, FREQ_MAX), `freqEnd ${p.freqEnd}`);
    assert.ok(inRange(p.filterCutoff, CUTOFF_MIN, CUTOFF_MAX), `filterCutoff ${p.filterCutoff}`);

    for (const field of ['attack', 'decay', 'sustainTime', 'release'] as const) {
      assert.ok(inRange(p[field], 0, Infinity), `${field} ${p[field]}`);
    }
    for (const field of [
      'sustainLevel',
      'delayFeedback',
      'delayMix',
      'reverbMix',
      'volume',
    ] as const) {
      assert.ok(inRange(p[field], 0, 1), `${field} ${p[field]}`);
    }
    assert.ok(inRange(p.delayTime, 0, Infinity), `delayTime ${p.delayTime}`);
    assert.ok(inRange(p.reverbDecay, 0, Infinity), `reverbDecay ${p.reverbDecay}`);
    assert.ok(Number.isFinite(p.filterQ) && p.filterQ > 0, `filterQ ${p.filterQ}`);
  });
}
