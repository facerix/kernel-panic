import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  corpTurnStatusBody,
  countVisibleCorpEntities,
  isCorpTurnStepLogVisibleToPlayer,
} from '../../../src/game/corpTurnStatusCopy.js';
import { FACTION, TILE } from '../../../src/game/constants.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { CorpDrone } from '../../../src/game/ai/CorpDrone.js';
import { Turret } from '../../../src/game/Turret.js';

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

function makeDroneWorld() {
  const grid = new Grid(6, 6);
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 6; y++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  const world = new World(grid);
  const drone = new CorpDrone({
    id: 'd1',
    x: 2,
    y: 2,
    maxAp: 3,
    patrolWaypoints: [{ x: 2, y: 2 }],
  });
  world.addEntity(drone);
  return { world, drone };
}

const sampleFireResult = {
  hit: true,
  roll: 0.5,
  threshold: 0.2,
  inCover: false,
  damage: 1,
  killed: false,
};

test('isCorpTurnStepLogVisibleToPlayer: fire at player is logged even when shooter tile is unseen', () => {
  const { world } = makeDroneWorld();
  const step = { type: 'fire' as const, target: 'p1', result: sampleFireResult };
  assert.equal(
    isCorpTurnStepLogVisibleToPlayer(world, 'p1', 'd1', step, () => false),
    true
  );
});

test('isCorpTurnStepLogVisibleToPlayer: fire at other target requires visible shooter', () => {
  const { world } = makeDroneWorld();
  const step = { type: 'fire' as const, target: 'other', result: sampleFireResult };
  assert.equal(
    isCorpTurnStepLogVisibleToPlayer(world, 'p1', 'd1', step, () => false),
    false
  );
  assert.equal(
    isCorpTurnStepLogVisibleToPlayer(world, 'p1', 'd1', step, (x, y) => x === 2 && y === 2),
    true
  );
});

test('isCorpTurnStepLogVisibleToPlayer: killing player-owned turret is logged even when shooter unseen', () => {
  const { world } = makeDroneWorld();
  const turr = new Turret({
    id: 'tech0-turret',
    x: 3,
    y: 2,
    ownerId: 'tech0',
  });
  world.addEntity(turr);
  const step = {
    type: 'fire' as const,
    target: 'tech0-turret',
    result: { ...sampleFireResult, killed: true },
  };
  assert.equal(
    isCorpTurnStepLogVisibleToPlayer(world, 'tech0', 'd1', step, () => false),
    true
  );
});

test('isCorpTurnStepLogVisibleToPlayer: hit on turret that survives still requires visible shooter', () => {
  const { world } = makeDroneWorld();
  const turr = new Turret({
    id: 'tech0-turret',
    x: 3,
    y: 2,
    ownerId: 'tech0',
  });
  world.addEntity(turr);
  const step = {
    type: 'fire' as const,
    target: 'tech0-turret',
    result: { ...sampleFireResult, killed: false },
  };
  assert.equal(
    isCorpTurnStepLogVisibleToPlayer(world, 'tech0', 'd1', step, () => false),
    false
  );
});
