import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  corpTurnStatusBody,
  countVisibleCorpEntities,
} from '../../../src/game/corpTurnStatusCopy.js';
import { FACTION } from '../../../src/game/constants.js';

test('countVisibleCorpEntities counts only alive corp on visible tiles', () => {
  const entities = [
    { alive: true, faction: FACTION.CORP, x: 1, y: 1 },
    { alive: false, faction: FACTION.CORP, x: 2, y: 2 },
    { alive: true, faction: FACTION.PLAYER, x: 1, y: 2 },
    { alive: true, faction: FACTION.CORP, x: 3, y: 3 },
  ];
  const visible = new Set(['1,1']);
  const isTileVisible = (x, y) => visible.has(`${x},${y}`);
  assert.equal(countVisibleCorpEntities(entities, isTileVisible), 1);
});

test('corpTurnStatusBody: random message on unseen corp activity', () => {
  assert.doesNotMatch(corpTurnStatusBody(0), /security drone/i);
  assert.doesNotMatch(corpTurnStatusBody(0), /Multiple hostiles/i);
});

test('corpTurnStatusBody: random message is stable for full turn', () => {
  const turn1Message1 = corpTurnStatusBody(0, 1);
  const turn1Message2 = corpTurnStatusBody(0, 1);
  const turn1Message3 = corpTurnStatusBody(0, 1);
  assert.equal(turn1Message1, turn1Message2);
  assert.equal(turn1Message1, turn1Message3);
});

test('corpTurnStatusBody: one visible', () => {
  assert.match(corpTurnStatusBody(1), /drone/i);
});

test('corpTurnStatusBody: several visible', () => {
  assert.match(corpTurnStatusBody(2), /Multiple hostiles/i);
  assert.match(corpTurnStatusBody(99), /Multiple hostiles/i);
});
