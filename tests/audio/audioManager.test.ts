import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AudioManager,
  parseAudioPrefs,
  AUDIO_MUTED_PREF,
  AUDIO_VOLUME_PREF,
  DEFAULT_VOLUME,
  type PrefsSource,
  type SoundPlayer,
} from '../../src/audio/AudioManager.js';
import { KERNEL_PANIC_DEFS, type SoundName } from '../../src/audio/sounds.js';

// --- Fakes: node has no Web Audio, so we stub the context + gain graph. -------

class FakeGain {
  gain = { value: NaN };
  connectedTo: unknown = null;
  connect(dest: unknown) {
    this.connectedTo = dest;
  }
}

class FakeContext {
  destination = { id: 'destination' };
  state = 'suspended';
  currentTime = 100;
  resumeCalls = 0;
  createdGains: FakeGain[] = [];
  createGain(): FakeGain {
    const g = new FakeGain();
    this.createdGains.push(g);
    return g;
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
  const play: SoundPlayer = (_ctx, def, when, dest) => {
    calls.push({ def, when, dest });
  };
  const manager = new AudioManager({
    play,
    createContext: () => ctx as unknown as BaseAudioContext,
    store,
  });
  return { manager, ctx, store, calls };
}

// --- parseAudioPrefs ----------------------------------------------------------

test('parseAudioPrefs defaults when unset', () => {
  assert.deepEqual(parseAudioPrefs({}), { muted: false, volume: DEFAULT_VOLUME });
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
