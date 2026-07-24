import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HUB_PALETTE,
  HUB_TENSION,
  paletteForRun,
  tensionForAlarmPhase,
  tensionForAlarmTransition,
} from '../../../src/shell/musicScore.js';
import { ALARM_PHASE } from '../../../src/game/World.js';
import { MUSIC_PALETTES, TENSION_CONFIG } from '../../../src/audio/music.js';

test('the hub is scored calm, in meatspace', () => {
  assert.equal(HUB_TENSION, 0);
  assert.equal(HUB_PALETTE, 'meat');
});

// --- Palette ------------------------------------------------------------------

test('a run with no cyberspace component is scored meat', () => {
  assert.equal(paletteForRun({ cyberspace: null }), 'meat');
  assert.equal(paletteForRun({}), 'meat');
});

test('a cyber run is scored cyber through every cyberspace phase', () => {
  // The whole point of the change: the palette follows the *run*, not whether
  // the grid happens to be on screen. `dormant` is before the first jack-in and
  // `resolved` is after the last jack-out — both are still a net run.
  for (const phase of ['dormant', 'active', 'resolved']) {
    assert.equal(paletteForRun({ cyberspace: { phase } }), 'cyber', `phase ${phase}`);
  }
});

test('paletteForRun handles a missing scene rather than throwing', () => {
  assert.equal(paletteForRun(null), 'meat');
  assert.equal(paletteForRun(undefined), 'meat');
});

test('every palette the mapping can produce actually exists', () => {
  for (const palette of [HUB_PALETTE, paletteForRun(null), paletteForRun({ cyberspace: {} })]) {
    assert.ok(MUSIC_PALETTES[palette], `no palette named ${palette}`);
  }
});

// --- Tension ------------------------------------------------------------------

test('a quiet run sits at tension 1 — underway, not alarmed', () => {
  assert.equal(tensionForAlarmPhase(ALARM_PHASE.QUIET), 1);
});

test('alert and cooldown both score at full tension', () => {
  assert.equal(tensionForAlarmPhase(ALARM_PHASE.ALERT), 2);
  // Cooldown is still dangerous — hostiles are converging even though the
  // alarm has stopped escalating. Dropping here would signal safety early.
  assert.equal(tensionForAlarmPhase(ALARM_PHASE.COOLDOWN), 2);
});

test('a missing alarm phase reads as quiet, not as alarmed', () => {
  // Saves predating the alarm cadence have no phase. Guessing "alarmed" would
  // score a calm restored run as a firefight until the next transition.
  assert.equal(tensionForAlarmPhase(undefined), 1);
  assert.equal(tensionForAlarmPhase(null), 1);
  assert.equal(tensionForAlarmPhase(''), 1);
});

test('alarm transitions map onto the same tensions as the phases they produce', () => {
  // The event path and the state path must agree, or a mid-alarm save reloads
  // scored differently from the run it left.
  assert.equal(tensionForAlarmTransition('raised'), tensionForAlarmPhase(ALARM_PHASE.ALERT));
  assert.equal(tensionForAlarmTransition('cooldown'), tensionForAlarmPhase(ALARM_PHASE.COOLDOWN));
  assert.equal(tensionForAlarmTransition('quiet'), tensionForAlarmPhase(ALARM_PHASE.QUIET));
});

test('an unrecognized transition yields null so callers hold their current tension', () => {
  assert.equal(tensionForAlarmTransition('sideways'), null);
  assert.equal(tensionForAlarmTransition(undefined), null);
  assert.equal(tensionForAlarmTransition(null), null);
});

test('every tension the mapping can produce is a configured level', () => {
  const produced = [
    HUB_TENSION,
    tensionForAlarmPhase(ALARM_PHASE.QUIET),
    tensionForAlarmPhase(ALARM_PHASE.ALERT),
    tensionForAlarmPhase(ALARM_PHASE.COOLDOWN),
  ];
  for (const tension of produced) {
    assert.ok(TENSION_CONFIG[tension], `tension ${tension} has no config`);
  }
});
