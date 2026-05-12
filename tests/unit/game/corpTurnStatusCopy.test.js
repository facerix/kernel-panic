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

test('corpTurnStatusBody: unseen hostiles', () => {
  assert.match(corpTurnStatusBody(0), /movement nearby/i);
});

test('corpTurnStatusBody: one visible', () => {
  assert.match(corpTurnStatusBody(1), /drone/i);
});

test('corpTurnStatusBody: several visible', () => {
  assert.match(corpTurnStatusBody(2), /Multiple hostiles/i);
  assert.match(corpTurnStatusBody(99), /Multiple hostiles/i);
});
