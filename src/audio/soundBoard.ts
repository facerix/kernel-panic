// Production audio singletons: the one place that binds the vendored TONEBENCH
// engine and the browser's timers to the audio model. Kept separate from
// AudioManager.ts / MusicDirector.ts so those modules stay engine-free and
// unit-testable (see AudioManager.ts's SoundPlayer note).
//
// Wiring sites (shellRuntime, sceneListeners) import from here.

import { playSound } from '../vendor/tonebench/tonebenchEngine.js';
import { AudioManager } from './AudioManager.js';
import { MusicDirector } from './MusicDirector.js';

export const audioManager = new AudioManager({ play: playSound });

/**
 * The generative score. Notes go out through the manager's music bus, and the
 * beat clock reads the same AudioContext the manager owns — the director must
 * schedule against the audio clock, never `Date.now()`, or notes drift audibly
 * against playback.
 *
 * Seeded from the wall clock so each session's bed differs. Reproducibility is a
 * test-time concern (`reseed`), not a gameplay one: nothing depends on the score
 * being the same twice, and a fixed seed would make every session identical.
 */
export const musicDirector = new MusicDirector({
  emit: (def, when) => audioManager.playMusicNote(def, when),
  modulate: modulation => audioManager.setMusicModulation(modulation),
  now: () => audioManager.currentTime,
  schedule: (fn, ms) => globalThis.setInterval(fn, ms) as unknown as number,
  cancel: id => globalThis.clearInterval(id),
  seed: Date.now() >>> 0,
});
