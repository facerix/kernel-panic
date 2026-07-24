import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AudioManager,
  parseAudioPrefs,
  AUDIO_MUTED_PREF,
  AUDIO_VOLUME_PREF,
  AUDIO_MUSIC_MUTED_PREF,
  AUDIO_MUSIC_VOLUME_PREF,
  DEFAULT_VOLUME,
  DEFAULT_MUSIC_VOLUME,
  type PrefsSource,
  type SoundPlayer,
} from '../../src/audio/AudioManager.js';
import { MUSIC_DEFS, type MusicModulation } from '../../src/audio/music.js';
import { KERNEL_PANIC_DEFS, type SoundName } from '../../src/audio/sounds.js';

// --- Fakes: node has no Web Audio, so we stub the context + gain graph. -------

/**
 * Stand-in for an AudioParam. `linearRampToValueAtTime` lands `value` on the
 * target immediately — the fake models the ramp's *destination*, since without a
 * running audio clock there is nothing to interpolate along. Each call is
 * recorded so tests can assert that a change was ramped rather than stepped.
 */
class FakeParam {
  value = NaN;
  ramps: { target: number; endTime: number }[] = [];
  cancelCalls = 0;
  setValueCalls = 0;
  cancelScheduledValues(_when: number) {
    this.cancelCalls++;
  }
  setValueAtTime(value: number, _when: number) {
    this.setValueCalls++;
    this.value = value;
  }
  linearRampToValueAtTime(target: number, endTime: number) {
    this.ramps.push({ target, endTime });
    this.value = target;
  }
}

class FakeGain {
  gain = new FakeParam();
  /** Last destination connected to — what the pre-music tests assert on. */
  connectedTo: unknown = null;
  /** Every destination, since the music bus fans one gain out to several. */
  connections: unknown[] = [];
  connect(dest: unknown) {
    this.connectedTo = dest;
    this.connections.push(dest);
  }
}

class FakeBiquad {
  type = '';
  frequency = new FakeParam();
  Q = new FakeParam();
  detune = new FakeParam();
  connections: unknown[] = [];
  connect(dest: unknown) {
    this.connections.push(dest);
  }
}

class FakeOscillator {
  type = '';
  frequency = new FakeParam();
  started = 0;
  connections: unknown[] = [];
  connect(dest: unknown) {
    this.connections.push(dest);
  }
  start() {
    this.started++;
  }
}

class FakeDelay {
  delayTime = { value: 0 };
  connections: unknown[] = [];
  connect(dest: unknown) {
    this.connections.push(dest);
  }
}

class FakeConvolver {
  buffer: unknown = null;
  connections: unknown[] = [];
  connect(dest: unknown) {
    this.connections.push(dest);
  }
}

class FakeContext {
  destination = { id: 'destination' };
  state = 'suspended';
  currentTime = 100;
  // Deliberately low so the fake impulse-response buffer stays cheap to build.
  sampleRate = 8000;
  resumeCalls = 0;
  createdGains: FakeGain[] = [];
  createdDelays: FakeDelay[] = [];
  createdConvolvers: FakeConvolver[] = [];
  createdFilters: FakeBiquad[] = [];
  createdOscillators: FakeOscillator[] = [];
  createdBuffers = 0;
  createGain(): FakeGain {
    const g = new FakeGain();
    this.createdGains.push(g);
    return g;
  }
  createDelay(): FakeDelay {
    const d = new FakeDelay();
    this.createdDelays.push(d);
    return d;
  }
  createConvolver(): FakeConvolver {
    const c = new FakeConvolver();
    this.createdConvolvers.push(c);
    return c;
  }
  createBiquadFilter(): FakeBiquad {
    const f = new FakeBiquad();
    this.createdFilters.push(f);
    return f;
  }
  createOscillator(): FakeOscillator {
    const o = new FakeOscillator();
    this.createdOscillators.push(o);
    return o;
  }
  createBuffer(channels: number, length: number) {
    this.createdBuffers++;
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (ch: number) => data[ch] };
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }
}

class FakePrefs extends EventTarget implements PrefsSource {
  prefs: Record<string, string | number | boolean | object> = {};
  set(key: string, value: string | number | boolean | object) {
    this.prefs = { ...this.prefs, [key]: value };
  }
  emitChange(key = 'prefs') {
    const evt = new Event('change');
    (evt as Event & { detail: unknown }).detail = { key };
    this.dispatchEvent(evt);
  }
}

type PlayCall = { def: unknown; when: number | undefined; dest: unknown };

function harness(prefs: Record<string, string | number | boolean | object> = {}) {
  const ctx = new FakeContext();
  const store = new FakePrefs();
  store.prefs = { ...prefs };
  const calls: PlayCall[] = [];
  // Every scheduled note gets a stoppable handle, mirroring the real engine's
  // `{ source, duration }`, so stopMusic() has something to cut.
  const stopped: number[] = [];
  const play: SoundPlayer = (_ctx, def, when, dest) => {
    const index = calls.length;
    calls.push({ def, when, dest });
    return { source: { stop: () => stopped.push(index) } };
  };
  const manager = new AudioManager({
    play,
    createContext: () => ctx as unknown as BaseAudioContext,
    store,
  });
  return { manager, ctx, store, calls, stopped };
}

// --- parseAudioPrefs ----------------------------------------------------------

test('parseAudioPrefs defaults when unset', () => {
  assert.deepEqual(parseAudioPrefs({}), {
    muted: false,
    volume: DEFAULT_VOLUME,
    musicMuted: false,
    musicVolume: DEFAULT_MUSIC_VOLUME,
  });
});

test('parseAudioPrefs reads the music channel independently of SFX', () => {
  const parsed = parseAudioPrefs({
    [AUDIO_MUTED_PREF]: false,
    [AUDIO_VOLUME_PREF]: 0.9,
    [AUDIO_MUSIC_MUTED_PREF]: true,
    [AUDIO_MUSIC_VOLUME_PREF]: 0.2,
  });
  assert.deepEqual(parsed, { muted: false, volume: 0.9, musicMuted: true, musicVolume: 0.2 });
});

test('parseAudioPrefs clamps and validates the music channel too', () => {
  assert.equal(parseAudioPrefs({ [AUDIO_MUSIC_VOLUME_PREF]: 4 }).musicVolume, 1);
  assert.equal(parseAudioPrefs({ [AUDIO_MUSIC_VOLUME_PREF]: -1 }).musicVolume, 0);
  assert.equal(
    parseAudioPrefs({ [AUDIO_MUSIC_VOLUME_PREF]: 'loud' }).musicVolume,
    DEFAULT_MUSIC_VOLUME
  );
  assert.equal(parseAudioPrefs({ [AUDIO_MUSIC_MUTED_PREF]: 'yes' }).musicMuted, false);
});

test('music defaults quieter than SFX — a bed, not an event', () => {
  assert.ok(DEFAULT_MUSIC_VOLUME < DEFAULT_VOLUME);
});

test('parseAudioPrefs clamps volume into 0..1', () => {
  assert.equal(parseAudioPrefs({ [AUDIO_VOLUME_PREF]: 5 }).volume, 1);
  assert.equal(parseAudioPrefs({ [AUDIO_VOLUME_PREF]: -2 }).volume, 0);
  assert.equal(parseAudioPrefs({ [AUDIO_VOLUME_PREF]: 0.4 }).volume, 0.4);
});

test('parseAudioPrefs falls back on invalid volume and coerces muted', () => {
  assert.equal(parseAudioPrefs({ [AUDIO_VOLUME_PREF]: 'loud' }).volume, DEFAULT_VOLUME);
  assert.equal(parseAudioPrefs({ [AUDIO_MUTED_PREF]: 'yes' }).muted, false);
  assert.equal(parseAudioPrefs({ [AUDIO_MUTED_PREF]: true }).muted, true);
});

// --- AudioManager contract ----------------------------------------------------

test('play is a no-op before the first resume (no context yet)', () => {
  const { manager, calls } = harness();
  manager.play('alarm');
  assert.equal(calls.length, 0);
  assert.equal(manager.ready, false);
});

test('resume builds the context + master gain exactly once', () => {
  const { manager, ctx } = harness();
  manager.resume();
  manager.resume();
  assert.equal(manager.ready, true);
  assert.equal(ctx.createdGains.length, 1, 'master gain created once');
  assert.equal(ctx.createdGains[0].connectedTo, ctx.destination, 'master → destination');
});

test('play routes the named def through the master gain', () => {
  const { manager, ctx, calls } = harness({ [AUDIO_VOLUME_PREF]: 0.5 });
  manager.resume();
  manager.play('alarm', 1.25);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].def, KERNEL_PANIC_DEFS.alarm);
  assert.equal(calls[0].when, 1.25);
  assert.equal(calls[0].dest, ctx.createdGains[0], 'routed to master gain');
});

test('master gain tracks volume, and mute forces it to 0 without synthesizing', () => {
  const { manager, ctx, calls } = harness({ [AUDIO_VOLUME_PREF]: 0.5 });
  manager.resume();
  assert.equal(ctx.createdGains[0].gain.value, 0.5);

  const muted = harness({ [AUDIO_MUTED_PREF]: true, [AUDIO_VOLUME_PREF]: 0.9 });
  muted.manager.resume();
  assert.equal(muted.ctx.createdGains[0].gain.value, 0, 'muted → gain 0');
  muted.manager.play('fire');
  assert.equal(muted.calls.length, 0, 'muted → engine not invoked');

  // the unmuted harness still plays
  manager.play('fire');
  assert.equal(calls.length, 1);
});

test('reacts to a prefs change event (mute after resume drops gain to 0)', () => {
  const { manager, ctx, store, calls } = harness({ [AUDIO_VOLUME_PREF]: 0.8 });
  manager.resume();
  assert.equal(ctx.createdGains[0].gain.value, 0.8);

  store.set(AUDIO_MUTED_PREF, true);
  store.emitChange('prefs');
  assert.equal(manager.muted, true);
  assert.equal(ctx.createdGains[0].gain.value, 0);
  manager.play('alarm');
  assert.equal(calls.length, 0);
});

test('reacts to a whole-store reload event (key "*")', () => {
  const { manager, store } = harness();
  assert.equal(manager.volume, DEFAULT_VOLUME);
  store.set(AUDIO_VOLUME_PREF, 0.2);
  store.emitChange('*');
  assert.equal(manager.volume, 0.2);
});

test('play throws on an unknown sound name (fail loud)', () => {
  const { manager } = harness();
  manager.resume();
  assert.throws(() => manager.play('kaboom' as SoundName), /unknown sound/);
});

// --- playSequence: transposed arpeggio scheduling ----------------------------

test('playSequence schedules one transposed hit per step, offset from now', () => {
  const { manager, ctx, calls } = harness();
  manager.resume();

  const base = KERNEL_PANIC_DEFS.secured;
  manager.playSequence('secured', [
    { semitones: 0, when: 0 },
    { semitones: 7, when: 0.1 },
    { semitones: 12, when: 0.24 },
  ]);

  assert.equal(calls.length, 3, 'one engine call per step');

  const expected = [
    { ratio: 1, when: 0 },
    { ratio: 2 ** (7 / 12), when: 0.1 },
    { ratio: 2, when: 0.24 },
  ];
  for (let i = 0; i < expected.length; i++) {
    const def = calls[i].def as { freqStart: number; freqEnd: number };
    assert.ok(
      Math.abs(def.freqStart - base.freqStart * expected[i].ratio) < 1e-6,
      `freqStart[${i}] ${def.freqStart}`
    );
    assert.ok(
      Math.abs(def.freqEnd - base.freqEnd * expected[i].ratio) < 1e-6,
      `freqEnd[${i}] ${def.freqEnd}`
    );
    // Scheduled relative to the context clock, not from zero.
    assert.ok(
      Math.abs((calls[i].when as number) - (ctx.currentTime + expected[i].when)) < 1e-6,
      `when[${i}] ${calls[i].when}`
    );
    assert.equal(calls[i].dest, ctx.createdGains[0], 'routed to master gain');
  }
});

test('playSequence no-ops before resume and when muted', () => {
  const before = harness();
  before.manager.playSequence('secured', [{ semitones: 0, when: 0 }]);
  assert.equal(before.calls.length, 0, 'no context yet');

  const muted = harness({ [AUDIO_MUTED_PREF]: true });
  muted.manager.resume();
  muted.manager.playSequence('secured', [{ semitones: 0, when: 0 }]);
  assert.equal(muted.calls.length, 0, 'muted → engine not invoked');
});

test('playSequence throws on an unknown base sound name (fail loud)', () => {
  const { manager } = harness();
  manager.resume();
  assert.throws(
    () => manager.playSequence('kaboom' as SoundName, [{ semitones: 0, when: 0 }]),
    /unknown sound/
  );
});

// --- playChain: timed multi-timbre stings ------------------------------------

test('playChain schedules each named def untransposed, offset from now', () => {
  const { manager, ctx, calls } = harness();
  manager.resume();

  manager.playChain([
    { name: 'deploy', when: 0 },
    { name: 'deployOnline', when: 0.09 },
  ]);

  assert.equal(calls.length, 2, 'one engine call per step');
  // Defs are passed through as-is (no transposition, unlike playSequence).
  assert.equal(calls[0].def, KERNEL_PANIC_DEFS.deploy);
  assert.equal(calls[1].def, KERNEL_PANIC_DEFS.deployOnline);
  // Scheduled relative to the context clock.
  assert.ok(
    Math.abs((calls[0].when as number) - ctx.currentTime) < 1e-6,
    `when[0] ${calls[0].when}`
  );
  assert.ok(
    Math.abs((calls[1].when as number) - (ctx.currentTime + 0.09)) < 1e-6,
    `when[1] ${calls[1].when}`
  );
  assert.equal(calls[0].dest, ctx.createdGains[0], 'routed to master gain');
});

test('playChain no-ops before resume and when muted', () => {
  const before = harness();
  before.manager.playChain([{ name: 'deploy', when: 0 }]);
  assert.equal(before.calls.length, 0, 'no context yet');

  const muted = harness({ [AUDIO_MUTED_PREF]: true });
  muted.manager.resume();
  muted.manager.playChain([{ name: 'deploy', when: 0 }]);
  assert.equal(muted.calls.length, 0, 'muted → engine not invoked');
});

test('playChain validates every name up front — one bad step plays nothing', () => {
  const { manager, calls } = harness();
  manager.resume();
  assert.throws(
    () =>
      manager.playChain([
        { name: 'deploy', when: 0 },
        { name: 'kaboom' as SoundName, when: 0.1 },
      ]),
    /unknown sound/
  );
  assert.equal(calls.length, 0, 'no partial playback before the throw');
});

// --- Music bus ---------------------------------------------------------------

const PAD = MUSIC_DEFS.padLow;

test('playMusicNote routes through a music gain, not straight to master', () => {
  const { manager, ctx, calls } = harness();
  manager.resume();
  assert.equal(manager.musicReady, false, 'bus is not built until a note needs it');

  manager.playMusicNote(PAD, 123);

  assert.equal(manager.musicReady, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].def, PAD, 'the def is passed by value, not looked up by name');
  assert.equal(calls[0].when, 123, 'absolute audio-clock time, passed straight through');

  // Chain is musicGain → filter → master (the filter carries the alarm sweep),
  // so the note lands on the music gain and reaches master one hop later.
  const master = ctx.createdGains[0];
  const filter = ctx.createdFilters[0];
  assert.notEqual(calls[0].dest, master, 'music must not bypass its own gain');
  assert.ok(
    (calls[0].dest as FakeGain).connections.includes(filter),
    'the music gain feeds the bus filter'
  );
  assert.ok(filter.connections.includes(master), 'and the filter feeds the master gain');
});

test('the shared music FX bus is built exactly once, however many notes play', () => {
  // The whole reason music defs are dry: one convolver and one delay for the
  // session instead of one per note.
  const { manager, ctx } = harness();
  manager.resume();
  for (let i = 0; i < 25; i++) manager.playMusicNote(PAD, 100 + i);

  assert.equal(ctx.createdConvolvers.length, 1, 'one shared convolver');
  assert.equal(ctx.createdDelays.length, 1, 'one shared delay');
  assert.equal(ctx.createdBuffers, 1, 'one impulse response for the session');
  assert.equal(ctx.createdConvolvers[0].buffer !== null, true, 'IR was installed');
});

test('a muted-music player never pays for the impulse response', () => {
  const { manager, ctx, calls } = harness({ [AUDIO_MUSIC_MUTED_PREF]: true });
  manager.resume();
  manager.playMusicNote(PAD, 100);

  assert.equal(calls.length, 0, 'muted → engine not invoked');
  assert.equal(manager.musicReady, false, 'no bus, no convolver, no IR buffer');
  assert.equal(ctx.createdBuffers, 0);
});

test('music gain tracks the music volume pref, independently of SFX', () => {
  const { manager, ctx } = harness({
    [AUDIO_VOLUME_PREF]: 0.9,
    [AUDIO_MUSIC_VOLUME_PREF]: 0.25,
  });
  manager.resume();
  manager.playMusicNote(PAD, 100);

  const master = ctx.createdGains[0];
  const music = ctx.createdGains[1];
  assert.equal(master.gain.value, 0.9);
  assert.equal(music.gain.value, 0.25);
});

test('muting music leaves SFX audible, and vice versa', () => {
  const musicOff = harness({ [AUDIO_MUSIC_MUTED_PREF]: true });
  musicOff.manager.resume();
  musicOff.manager.playMusicNote(PAD, 100);
  musicOff.manager.play('alarm');
  assert.equal(musicOff.calls.length, 1, 'SFX still plays with music muted');

  const sfxOff = harness({ [AUDIO_MUTED_PREF]: true });
  sfxOff.manager.resume();
  sfxOff.manager.play('alarm');
  assert.equal(sfxOff.calls.length, 0);
  sfxOff.manager.playMusicNote(PAD, 100);
  assert.equal(sfxOff.calls.length, 0, 'the global mute silences music too');
});

test('a music-mute pref change after the bus exists drops music gain to 0', () => {
  const { manager, ctx, store, calls } = harness({ [AUDIO_MUSIC_VOLUME_PREF]: 0.5 });
  manager.resume();
  manager.playMusicNote(PAD, 100);
  const music = ctx.createdGains[1];
  assert.equal(music.gain.value, 0.5);

  store.set(AUDIO_MUSIC_MUTED_PREF, true);
  store.emitChange('prefs');
  assert.equal(manager.musicMuted, true);
  assert.equal(music.gain.value, 0, 'the ringing tail is silenced by the gain');

  const before = calls.length;
  manager.playMusicNote(PAD, 101);
  assert.equal(calls.length, before, 'and no further notes are synthesized');
});

test('playMusicNote is a no-op before the first gesture', () => {
  const { manager, calls } = harness();
  manager.playMusicNote(PAD, 100);
  assert.equal(calls.length, 0);
  assert.equal(manager.musicReady, false);
});

test('stopMusic cuts notes already handed to the audio clock', () => {
  // The director schedules ahead, so stopping it is not enough — those notes
  // would otherwise play out over a scene change.
  const { manager, stopped } = harness();
  manager.resume();
  manager.playMusicNote(PAD, 200);
  manager.playMusicNote(PAD, 201);
  assert.deepEqual(stopped, []);

  manager.stopMusic();
  assert.deepEqual(stopped, [0, 1], 'every scheduled source was stopped');

  manager.stopMusic();
  assert.deepEqual(stopped, [0, 1], 'idempotent — handles are released after cutting');
});

test('finished notes are pruned so the retained-source list cannot grow unbounded', () => {
  // The bed plays for the whole session; without pruning this list would retain
  // a handle per note forever.
  const { manager, ctx, stopped } = harness();
  manager.resume();

  const padDuration = PAD.attack + PAD.decay + PAD.sustainTime + PAD.release;
  manager.playMusicNote(PAD, ctx.currentTime);
  // Advance the clock well past that note's tail, then schedule another.
  ctx.currentTime += padDuration + 5;
  manager.playMusicNote(PAD, ctx.currentTime);

  manager.stopMusic();
  assert.deepEqual(stopped, [1], 'only the still-live note was retained');
});

// --- Focus suspension ---------------------------------------------------------
// Leaving the tab or the application silences the score. Kept distinct from the
// mute pref so it never looks like the player turned music off.

test('suspending music fades it out without touching the mute pref', () => {
  const { manager, ctx, store } = harness({ [AUDIO_MUSIC_VOLUME_PREF]: 0.5 });
  manager.resume();
  manager.playMusicNote(PAD, 100);
  const music = ctx.createdGains[1];

  manager.setMusicSuspended(true);

  assert.equal(manager.musicSuspended, true);
  assert.equal(music.gain.value, 0, 'bus is silent');
  assert.equal(manager.musicMuted, false, 'the player did not mute anything');
  assert.equal(store.prefs[AUDIO_MUSIC_MUTED_PREF], undefined, 'no pref was written');
});

test('resuming restores the player volume, not a default', () => {
  const { manager, ctx } = harness({ [AUDIO_MUSIC_VOLUME_PREF]: 0.33 });
  manager.resume();
  manager.playMusicNote(PAD, 100);
  const music = ctx.createdGains[1];

  manager.setMusicSuspended(true);
  manager.setMusicSuspended(false);

  assert.equal(manager.musicSuspended, false);
  assert.equal(music.gain.value, 0.33);
});

test('the suspend fade is ramped, never stepped', () => {
  // A step on a bus full of sustained oscillators is an audible click.
  const { manager, ctx } = harness();
  manager.resume();
  manager.playMusicNote(PAD, 100);
  const music = ctx.createdGains[1];
  const before = music.gain.ramps.length;

  manager.setMusicSuspended(true);

  const ramp = music.gain.ramps[before];
  assert.ok(ramp, 'the change went through a ramp');
  assert.equal(ramp.target, 0);
  assert.ok(ramp.endTime > ctx.currentTime, `ramp must take time: ${ramp.endTime}`);
  // Anchoring at the live value first is what stops a mid-ramp change jumping.
  assert.ok(music.gain.cancelCalls > 0, 'pending automation was cancelled');
  assert.ok(music.gain.setValueCalls > 0, 'ramp was anchored at the current value');
});

test('suspending stops new notes being synthesized', () => {
  const { manager, calls } = harness();
  manager.resume();
  manager.playMusicNote(PAD, 100);
  const before = calls.length;

  manager.setMusicSuspended(true);
  manager.playMusicNote(PAD, 101);
  assert.equal(calls.length, before, 'nothing is synthesized into a silent bus');

  manager.setMusicSuspended(false);
  manager.playMusicNote(PAD, 102);
  assert.equal(calls.length, before + 1, 'and it resumes afterwards');
});

test('setMusicSuspended is idempotent — repeat calls do not re-ramp', () => {
  const { manager, ctx } = harness();
  manager.resume();
  manager.playMusicNote(PAD, 100);
  const music = ctx.createdGains[1];

  manager.setMusicSuspended(true);
  const after = music.gain.ramps.length;
  manager.setMusicSuspended(true);
  assert.equal(music.gain.ramps.length, after, 'no redundant automation');
});

test('suspending before the music bus exists still applies once it is built', () => {
  // Focus can be lost before the player has heard a single note.
  const { manager, ctx, calls } = harness();
  manager.resume();
  manager.setMusicSuspended(true);
  assert.equal(manager.musicReady, false, 'no bus built while silent');

  manager.playMusicNote(PAD, 100);
  assert.equal(calls.length, 0, 'still silent');

  manager.setMusicSuspended(false);
  manager.playMusicNote(PAD, 101);
  assert.equal(calls.length, 1);
  assert.equal(ctx.createdGains[1].gain.value, DEFAULT_MUSIC_VOLUME, 'built at the right level');
});

test('a mute pref change while suspended keeps the bus silent', () => {
  // The two silencers are independent; clearing one must not override the other.
  const { manager, ctx, store } = harness({ [AUDIO_MUSIC_VOLUME_PREF]: 0.6 });
  manager.resume();
  manager.playMusicNote(PAD, 100);
  const music = ctx.createdGains[1];

  manager.setMusicSuspended(true);
  store.set(AUDIO_MUSIC_MUTED_PREF, true);
  store.emitChange('prefs');
  assert.equal(music.gain.value, 0);

  store.set(AUDIO_MUSIC_MUTED_PREF, false);
  store.emitChange('prefs');
  assert.equal(music.gain.value, 0, 'unmuting does not defeat the focus suspension');

  manager.setMusicSuspended(false);
  assert.equal(music.gain.value, 0.6, 'and clearing both restores sound');
});

// --- Filter sweep -------------------------------------------------------------
// The alarm's primary signal: a resonant lowpass on the bus, swept by an LFO.

const SWEEP: MusicModulation = { baseCutoff: 900, q: 3, depthCents: 2400, hz: 0.9 };

test('the bus carries one swept filter and one LFO, however many notes play', () => {
  const { manager, ctx } = harness();
  manager.resume();
  for (let i = 0; i < 20; i++) manager.playMusicNote(PAD, 100 + i);

  assert.equal(ctx.createdFilters.length, 1, 'one shared filter');
  assert.equal(ctx.createdOscillators.length, 1, 'one LFO for the session');
  assert.equal(ctx.createdFilters[0].type, 'lowpass');
  assert.equal(ctx.createdOscillators[0].started, 1, 'LFO runs continuously');
});

test('the LFO drives filter detune, never the music gain', () => {
  // The trap this guards: an AudioParam is its automation timeline PLUS any
  // connected signal, and the mute path only cancels the timeline. An LFO wired
  // to musicGain.gain would keep injecting after a mute — audible music while
  // "muted". It must terminate on the filter instead.
  const { manager, ctx } = harness();
  manager.resume();
  manager.playMusicNote(PAD, 100);

  const filter = ctx.createdFilters[0];
  const lfo = ctx.createdOscillators[0];
  const musicGain = ctx.createdGains[1];

  const depthGain = lfo.connections[0] as FakeGain;
  assert.ok(depthGain instanceof FakeGain, 'LFO runs through a depth gain');
  assert.ok(depthGain.connections.includes(filter.detune), 'depth lands on filter.detune');

  for (const target of [...lfo.connections, ...depthGain.connections]) {
    assert.notEqual(target, musicGain.gain, 'the LFO must never reach the music gain');
    assert.notEqual(target, musicGain, 'nor the music gain node itself');
  }
});

test('the sweep sits ahead of the sends, so the wet paths are swept too', () => {
  // If delay/reverb tapped the pre-filter signal they would carry an unswept
  // copy of the bed and wash the sweep out.
  const { manager, ctx } = harness();
  manager.resume();
  manager.playMusicNote(PAD, 100);

  const musicGain = ctx.createdGains[1];
  const filter = ctx.createdFilters[0];
  const delay = ctx.createdDelays[0];
  const convolver = ctx.createdConvolvers[0];

  assert.ok(musicGain.connections.includes(filter), 'music gain feeds the filter');
  assert.ok(filter.connections.includes(delay), 'delay is fed post-filter');
  assert.ok(filter.connections.includes(convolver), 'reverb is fed post-filter');
  assert.ok(!musicGain.connections.includes(delay), 'and not pre-filter');
  assert.ok(!musicGain.connections.includes(convolver), 'and not pre-filter');
});

test('setMusicModulation ramps every parameter rather than stepping', () => {
  const { manager, ctx } = harness();
  manager.resume();
  manager.playMusicNote(PAD, 100);

  manager.setMusicModulation(SWEEP);

  const filter = ctx.createdFilters[0];
  const lfo = ctx.createdOscillators[0];
  const depthGain = lfo.connections[0] as FakeGain;

  assert.equal(filter.frequency.value, SWEEP.baseCutoff);
  assert.equal(filter.Q.value, SWEEP.q);
  assert.equal(depthGain.gain.value, SWEEP.depthCents);
  assert.equal(lfo.frequency.value, SWEEP.hz);

  for (const [name, param] of [
    ['cutoff', filter.frequency],
    ['Q', filter.Q],
    ['depth', depthGain.gain],
    ['rate', lfo.frequency],
  ] as const) {
    const ramp = param.ramps[param.ramps.length - 1];
    assert.ok(ramp, `${name} was ramped`);
    assert.ok(ramp.endTime > ctx.currentTime, `${name} ramp takes time`);
  }
  assert.deepEqual(manager.musicModulation, SWEEP);
});

test('modulation requested before the bus exists is applied once it is built', () => {
  // The director sets tension on start, which can precede the first note.
  const { manager, ctx } = harness();
  manager.resume();
  manager.setMusicModulation(SWEEP);
  assert.equal(manager.musicReady, false, 'no bus yet');

  manager.playMusicNote(PAD, 100);

  const filter = ctx.createdFilters[0];
  assert.equal(filter.frequency.value, SWEEP.baseCutoff, 'the stored request was replayed');
  assert.equal(filter.Q.value, SWEEP.q);
});

test('with no modulation set the filter idles clear of every voice', () => {
  // The filter is always in the chain; at rest it must not colour the bed.
  const { manager, ctx } = harness();
  manager.resume();
  manager.playMusicNote(PAD, 100);

  const filter = ctx.createdFilters[0];
  const depthGain = ctx.createdOscillators[0].connections[0] as FakeGain;
  assert.ok(filter.frequency.value >= 8000, `effectively bypassed: ${filter.frequency.value}`);
  assert.equal(depthGain.gain.value, 0, 'no sweep until asked for');
});
