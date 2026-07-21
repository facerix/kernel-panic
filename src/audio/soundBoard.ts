// Production audio singleton: the one place that binds the vendored TONEBENCH
// engine to the AudioManager. Kept separate from AudioManager.ts so that module
// stays engine-free and unit-testable (see AudioManager.ts's SoundPlayer note).
//
// Wiring sites (shellRuntime, sceneListeners) import `audioManager` from here.

import { playSound } from '../vendor/tonebench/tonebenchEngine.js';
import { AudioManager } from './AudioManager.js';

export const audioManager = new AudioManager({ play: playSound });
