import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACTION } from '../../../src/game/constants.js';
import { RUN_STATE } from '../../../src/game/Run.js';
import { CAMPAIGN_STATE } from '../../../src/game/Campaign.js';
import { MODE } from '../../../src/input/keymap.js';
import {
  escapeHtml,
  formatAlertTag,
  formatHazardTag,
  formatStatusLine,
  hostileMoodTag,
  joinStatusParts,
  stateLabelForSceneState,
} from '../../../src/shell/statusLine.js';

test('stateLabelForSceneState maps hub and combat', () => {
  assert.equal(stateLabelForSceneState(CAMPAIGN_STATE.HUB), '[HUB]');
  assert.equal(stateLabelForSceneState(RUN_STATE.COMBAT), '[COMBAT]');
});

test('formatAlertTag renders ALERT and COOL phases', () => {
  assert.match(formatAlertTag({ phase: 'alert', holdTurnsRemaining: 3 }), /ALERT 3/);
  assert.match(formatAlertTag({ phase: 'cooldown', cooldownTurnsRemaining: 2 }), /COOL 2/);
  assert.equal(formatAlertTag({ phase: 'quiet' }), '');
});

test('formatHazardTag renders hazard warning when standing on hazard tile', () => {
  assert.match(formatHazardTag(true), /HAZARD/);
  assert.equal(formatHazardTag(false), '');
});

test('formatStatusLine renders hub identity and arc context', () => {
  const { html } = formatStatusLine({
    stateLabel: '[HUB]',
    sceneState: CAMPAIGN_STATE.HUB,
    input: { mode: MODE.IDLE, aimKind: null },
    hasPlayer: true,
    hasQueue: true,
    contextHtml: joinStatusParts(['Act 1 — casing']),
    hubIdentity: 'CREW 2/3 CREDS 100 REP 55 (NEUTRAL)',
    actionHistory: ['Curator acknowledged.'],
    pendingActionCount: 0,
  });
  assert.match(html, /game-shell__stats.*CREW 2\/3/);
  assert.match(html, /Act 1 — casing/);
  assert.match(html, /Curator acknowledged/);
});

test('formatStatusLine renders combat a11y summary and alert tag', () => {
  const { html } = formatStatusLine({
    stateLabel: '[COMBAT]',
    sceneState: RUN_STATE.COMBAT,
    input: { mode: MODE.IDLE, aimKind: null },
    hasPlayer: true,
    hasQueue: true,
    combatHud: {
      identity: { callsign: 'Patch', archetype: 'decker', stealthed: false },
      hp: { hp: 3, maxHp: 3 },
      ap: { ap: 4, maxAp: 4 },
      turn: { currentFaction: FACTION.PLAYER, turnNumber: 1 },
    },
    contextHtml: joinStatusParts([formatAlertTag({ phase: 'alert', holdTurnsRemaining: 2 })]),
    actionHistory: [],
    pendingActionCount: 0,
  });
  assert.match(html, /u-sr-only.*Combat status/);
  assert.match(html, /alert-tag.*ALERT 2/);
});

test('formatStatusLine prefers proximity hint over corp mood', () => {
  const { html } = formatStatusLine({
    stateLabel: '[COMBAT]',
    sceneState: RUN_STATE.COMBAT,
    input: { mode: MODE.IDLE, aimKind: null },
    hasPlayer: true,
    hasQueue: true,
    contextHtml: '',
    proximityHint: 'FINN — press [Space] to shop.',
    corpMood: { hostileTag: 'CORP', body: 'hostiles closing' },
    actionHistory: [],
    pendingActionCount: 0,
  });
  assert.match(html, /hint.*FINN/);
  assert.doesNotMatch(html, /hostiles closing/);
});

test('formatStatusLine latches corp mood on player slice', () => {
  const hostile = formatStatusLine({
    stateLabel: '[COMBAT]',
    sceneState: RUN_STATE.COMBAT,
    input: { mode: MODE.IDLE, aimKind: null },
    hasPlayer: true,
    hasQueue: true,
    contextHtml: '',
    corpMood: { hostileTag: 'ICE', body: 'probes converging' },
    actionHistory: [],
    pendingActionCount: 0,
  });
  assert.equal(hostile.nextCorpMoodBody, 'probes converging');
  assert.match(hostile.html, /ICE.*probes converging/);

  const playerSlice = formatStatusLine({
    stateLabel: '[COMBAT]',
    sceneState: RUN_STATE.COMBAT,
    input: { mode: MODE.IDLE, aimKind: null },
    hasPlayer: true,
    hasQueue: true,
    contextHtml: '',
    latchedCorpMood: { hostileTag: 'ICE', body: 'probes converging' },
    actionHistory: ['> moved north'],
    pendingActionCount: 1,
  });
  assert.match(playerSlice.html, /ICE.*probes converging/);
  assert.equal(playerSlice.nextCorpMoodBody, null);
});

test('hostileMoodTag reads ICE while jacked in', () => {
  assert.equal(hostileMoodTag(true, FACTION.RIVAL), 'ICE');
  assert.equal(hostileMoodTag(false, FACTION.RIVAL), 'RIVAL');
});

test('escapeHtml encodes markup characters', () => {
  assert.equal(escapeHtml('<script>&"'), '&lt;script&gt;&amp;&quot;');
});
