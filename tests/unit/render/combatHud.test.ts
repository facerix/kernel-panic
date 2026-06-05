import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACTION } from '../../../src/game/constants.js';
import {
  fitObjectiveHudLine,
  formatApPips,
  formatCombatHudA11ySummary,
  formatHpSegments,
  formatIdentityHud,
  formatObjectiveHud,
  formatTurnLabel,
} from '../../../src/render/combatHud.js';

const charWidth = (text: string) => text.length * 7;

test('formatObjectiveHud returns an empty row when no contract objective is available', () => {
  assert.equal(formatObjectiveHud(null), '');
  assert.equal(formatObjectiveHud(undefined), '');
});

test('formatObjectiveHud formats TODO and DONE objective state', () => {
  assert.equal(
    formatObjectiveHud({ title: 'Sentinel window', done: false }),
    'OBJ Sentinel window [TODO]'
  );
  assert.equal(
    formatObjectiveHud({ title: 'Sentinel window', done: true }),
    'OBJ Sentinel window [DONE]'
  );
});

test('formatObjectiveHud carries active turn limits and progress suffixes', () => {
  assert.equal(
    formatObjectiveHud({
      title: 'Map the floor',
      done: false,
      turnsRemaining: 4,
      progress: { label: 'MAP', current: 7, total: 12 },
    }),
    'OBJ Map the floor [TODO] [TURN:4] [MAP:7/12]'
  );
});

test('fitObjectiveHudLine keeps MAP and SWEEP tags when the title must shrink', () => {
  const line = 'OBJ Map site layout [DONE] [MAP:42/120]';
  const fitted = fitObjectiveHudLine(line.toUpperCase(), charWidth, 248);
  assert.match(fitted, /\[MAP:42\/120\]$/);
  assert.match(fitted, /\.\.\./);
  assert.doesNotMatch(fitted, /\[MAP\.\.\.$/);
});

test('fitObjectiveHudLine keeps turn budget and progress tags together', () => {
  const line = formatObjectiveHud({
    title: 'Sweep the relay cluster for salvage tags',
    done: false,
    turnsRemaining: 3,
    progress: { label: 'SWEEP', current: 2, total: 5 },
  });
  const fitted = fitObjectiveHudLine(line.toUpperCase(), charWidth, 300);
  assert.match(fitted, /\[TODO\] \[TURN:3\] \[SWEEP:2\/5\]$/);
});

test('formatObjectiveHud omits turn limits after completion but keeps progress context', () => {
  assert.equal(
    formatObjectiveHud({
      title: 'Map the floor',
      done: true,
      turnsRemaining: 0,
      progress: { label: 'MAP', current: 12, total: 12 },
    }),
    'OBJ Map the floor [DONE] [MAP:12/12]'
  );
});

test('formatIdentityHud formats callsign, archetype, and stealth state', () => {
  assert.equal(
    formatIdentityHud({ callsign: 'Patch', archetype: 'tech', stealthed: false }),
    'Patch [TECH]'
  );
  assert.equal(
    formatIdentityHud({ callsign: 'Ghost', archetype: 'razor', stealthed: true }),
    'Ghost [RAZOR] [CLOAKED]'
  );
});

test('formatIdentityHud falls back to archetype when callsign is missing', () => {
  assert.equal(formatIdentityHud({ callsign: '', archetype: 'merc', stealthed: false }), 'MERC');
  assert.equal(formatIdentityHud({ archetype: 'tech', stealthed: true }), 'TECH [CLOAKED]');
});

test('formatHpSegments right-fills live HP segments', () => {
  assert.equal(formatHpSegments({ hp: 3, maxHp: 3 }), 'HP ■■■');
  assert.equal(formatHpSegments({ hp: 2, maxHp: 3 }), 'HP □■■');
  assert.equal(formatHpSegments({ hp: 1, maxHp: 3 }), 'HP □□■');
  assert.equal(formatHpSegments({ hp: 0, maxHp: 3 }), 'HP □□□');
});

test('formatApPips right-fills available AP pips', () => {
  assert.equal(formatApPips({ ap: 4, maxAp: 4 }), '●●●●');
  assert.equal(formatApPips({ ap: 2, maxAp: 4 }), '○○●●');
  assert.equal(formatApPips({ ap: 0, maxAp: 4 }), '○○○○');
});

test('vital formatters reject invalid counts instead of hiding impossible state', () => {
  assert.throws(() => formatHpSegments({ hp: -1, maxHp: 3 }), /hp/);
  assert.throws(() => formatHpSegments({ hp: 4, maxHp: 3 }), /hp/);
  assert.throws(() => formatApPips({ ap: 5, maxAp: 4 }), /ap/);
  assert.throws(() => formatApPips({ ap: 1.5, maxAp: 4 }), /ap/);
});

test('formatTurnLabel distinguishes player and hostile phases', () => {
  assert.equal(formatTurnLabel({ currentFaction: FACTION.PLAYER, turnNumber: 12 }), 'TURN 12');
  assert.equal(
    formatTurnLabel({ currentFaction: FACTION.CORP, turnNumber: 12 }),
    'HOSTILES ACTIVE'
  );
  assert.equal(
    formatTurnLabel({ currentFaction: FACTION.RIVAL, turnNumber: 12 }),
    'HOSTILES ACTIVE'
  );
});

test('formatCombatHudA11ySummary preserves moved HUD facts in readable text', () => {
  assert.equal(
    formatCombatHudA11ySummary({
      objective: { title: 'Sentinel window', done: false, turnsRemaining: 4 },
      identity: { callsign: 'Patch', archetype: 'tech', stealthed: false },
      hp: { hp: 2, maxHp: 3 },
      ap: { ap: 2, maxAp: 4 },
      turn: { currentFaction: FACTION.PLAYER, turnNumber: 12 },
    }),
    'Patch, TECH, 2 of 3 HP, 2 of 4 AP, turn 12, objective Sentinel window TODO, 4 turns remaining'
  );
});
