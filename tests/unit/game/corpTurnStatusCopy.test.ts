import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  corpTurnStatusBody,
  countVisibleCorpEntities,
  formatCorpTurnStep,
  isCorpTurnStepLogVisibleToPlayer,
  isCorpTurnStepVisibleToPlayer,
  resetCorpTurnStatusCache,
} from '../../../src/game/corpTurnStatusCopy.js';
import { FACTION, TILE } from '../../../src/game/constants.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
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

test('countVisibleCorpEntities honors an explicit hostile faction (RIVAL)', () => {
  const entities = [
    { alive: true, faction: FACTION.RIVAL, x: 1, y: 1 },
    { alive: true, faction: FACTION.CORP, x: 1, y: 2 },
    { alive: true, faction: FACTION.RIVAL, x: 3, y: 3 },
  ];
  const visible = new Set(['1,1', '1,2']);
  const isTileVisible = (x, y) => visible.has(`${x},${y}`);
  assert.equal(countVisibleCorpEntities(entities, isTileVisible, FACTION.RIVAL), 1);
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
  assert.match(corpTurnStatusBody(1), /corp asset/i);
});

test('corpTurnStatusBody: several visible', () => {
  assert.match(corpTurnStatusBody(2), /Multiple hostiles/i);
  assert.match(corpTurnStatusBody(99), /Multiple hostiles/i);
});

test('resetCorpTurnStatusCache clears cached messages so turn 1 of a new run is fresh', () => {
  // Seed the cache with a message for turn 9999 (unlikely to collide).
  const first = corpTurnStatusBody(0, 9999);
  resetCorpTurnStatusCache();
  // After reset, turn 9999 should re-roll (may or may not match — but the
  // cache entry must be gone). We verify by checking .has internally via a
  // second call that would return the same string if the cache survived.
  // Run it enough times that at least one mismatch proves the cache was cleared
  // (12 possible messages, so P(same) ≈ 8.3% per trial).
  let sawDifferent = false;
  for (let i = 0; i < 50; i++) {
    resetCorpTurnStatusCache();
    if (corpTurnStatusBody(0, 9999) !== first) {
      sawDifferent = true;
      break;
    }
  }
  assert.ok(sawDifferent, 'cache should have been cleared — got the same message 50 times');
  resetCorpTurnStatusCache(); // clean up
});

function makeDroneWorld() {
  const grid = new Grid(6, 6);
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 6; y++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  const world = new World(grid);
  const drone = new Skirmisher({
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

test('isCorpTurnStepVisibleToPlayer: facility alarm repaints even when actor tile is unseen', () => {
  const { world } = makeDroneWorld();
  const step = { type: 'alarm' as const };
  assert.equal(
    isCorpTurnStepVisibleToPlayer(world, 'p1', 'd1', step, () => false),
    true
  );
});

test('isCorpTurnStepVisibleToPlayer: off-screen patrol matches log visibility', () => {
  const { world } = makeDroneWorld();
  const step = { type: 'move-patrol' as const, to: { x: 0, y: 0 } };
  assert.equal(
    isCorpTurnStepVisibleToPlayer(world, 'p1', 'd1', step, () => false),
    false
  );
});

test('formatCorpTurnStep narrates a lookout mark with the target label', () => {
  const line = formatCorpTurnStep('[Corp]Lookout', { type: 'spot', target: 'p1' }, () => 'you');
  assert.match(line, /\[Corp\]Lookout marks you/);
  assert.match(line, /converging/i);
});

test('formatCorpTurnStep narrates melee knockback when present', () => {
  const line = formatCorpTurnStep(
    '[Corp]Bruiser',
    {
      type: 'melee',
      target: 'crew-merc',
      knockback: { x: 4, y: 2 },
      result: {
        hit: true,
        dodged: false,
        roll: 0.99,
        dodgeThreshold: 0.2,
        inCover: false,
        damage: 3,
        killed: false,
      },
    },
    id => (id === 'crew-merc' ? 'Patch' : id)
  );
  assert.match(line, /Patch is shoved to \(4, 2\)/);
});

test('isCorpTurnStepLogVisibleToPlayer: a lookout mark on the player is felt even when unseen', () => {
  const { world } = makeDroneWorld();
  const step = { type: 'spot' as const, target: 'p1' };
  assert.equal(
    isCorpTurnStepLogVisibleToPlayer(world, 'p1', 'd1', step, () => false),
    true
  );
});

test('isCorpTurnStepLogVisibleToPlayer: a lookout mark on another target requires a visible lookout', () => {
  const { world } = makeDroneWorld();
  const step = { type: 'spot' as const, target: 'other' };
  assert.equal(
    isCorpTurnStepLogVisibleToPlayer(world, 'p1', 'd1', step, () => false),
    false
  );
});
