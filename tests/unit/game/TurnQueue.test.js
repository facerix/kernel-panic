import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { Entity } from '../../../src/game/Entity.js';
import { World } from '../../../src/game/World.js';
import { TurnQueue } from '../../../src/game/TurnQueue.js';
import { FACTION } from '../../../src/game/constants.js';

test('TurnQueue requires a non-empty faction order', () => {
  assert.throws(() => new TurnQueue([]), TypeError);
  assert.throws(() => new TurnQueue(null), TypeError);
});

test('TurnQueue starts on the first faction with turnNumber 1', () => {
  const q = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
  assert.equal(q.currentFaction, FACTION.PLAYER);
  assert.equal(q.turnNumber, 1);
});

test('TurnQueue.endTurn rotates to the next faction', () => {
  const w = new World(new Grid(3, 3));
  const q = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
  q.endTurn(w);
  assert.equal(q.currentFaction, FACTION.CORP);
  q.endTurn(w);
  assert.equal(q.currentFaction, FACTION.PLAYER);
});

test('TurnQueue.endTurn refreshes AP only for the incoming faction', () => {
  const w = new World(new Grid(3, 3));
  const player = new Entity({ id: 'p', x: 0, y: 0, faction: FACTION.PLAYER, glyph: '@', maxAp: 4 });
  const drone = new Entity({ id: 'd', x: 2, y: 2, faction: FACTION.CORP, glyph: 'd', maxAp: 3 });
  w.addEntity(player);
  w.addEntity(drone);
  player.spendAp(4);
  drone.spendAp(3);

  const q = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
  // Currently PLAYER is up. Ending the turn hands off to CORP, so CORP refreshes.
  q.endTurn(w);
  assert.equal(drone.ap, 3, 'drone (incoming) refreshed');
  assert.equal(player.ap, 0, 'player (outgoing) NOT refreshed');

  // Hand back to PLAYER — player should now refresh.
  q.endTurn(w);
  assert.equal(player.ap, 4, 'player refreshed on return to player turn');
});

test('TurnQueue.endTurn skips dead entities when refreshing AP', () => {
  const w = new World(new Grid(3, 3));
  const player = new Entity({ id: 'p', x: 0, y: 0, faction: FACTION.PLAYER, glyph: '@', maxAp: 4 });
  player.spendAp(4);
  player.alive = false;
  w.addEntity(player);
  const q = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
  q.endTurn(w); // -> CORP
  q.endTurn(w); // -> PLAYER, would refresh living players
  assert.equal(player.ap, 0, 'dead player not refreshed');
});

test('TurnQueue.turnNumber increments after a full round', () => {
  const w = new World(new Grid(3, 3));
  const q = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
  assert.equal(q.turnNumber, 1);
  q.endTurn(w); // PLAYER -> CORP, still round 1
  assert.equal(q.turnNumber, 1);
  q.endTurn(w); // CORP -> PLAYER, new round
  assert.equal(q.turnNumber, 2);
});
