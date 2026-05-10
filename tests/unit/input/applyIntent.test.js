import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { TurnQueue } from '../../../src/game/TurnQueue.js';
import { EventBus } from '../../../src/game/events.js';
import { TILE, FACTION } from '../../../src/game/constants.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Razor } from '../../../src/game/archetypes/Razor.js';
import { CorpDrone } from '../../../src/game/ai/CorpDrone.js';
import { Rng } from '../../../src/rng.js';
import { applyIntent, pickFireTarget } from '../../../src/input/applyIntent.js';

function buildCtx({ archetype = 'merc', placeDrone = true } = {}) {
  const grid = new Grid(10, 6);
  // Walls around the perimeter so movement off-grid fails predictably.
  for (let x = 0; x < 10; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, 5, TILE.WALL);
  }
  for (let y = 0; y < 6; y++) {
    grid.setTile(0, y, TILE.WALL);
    grid.setTile(9, y, TILE.WALL);
  }
  // A cover tile to make Vault legal: place at (3,2) with landing at (4,2).
  grid.setTile(3, 2, TILE.COVER);

  const bus = new EventBus();
  const world = new World(grid, { events: bus });

  const player =
    archetype === 'merc'
      ? new Merc({ id: 'merc', x: 2, y: 2, maxAp: 4 })
      : new Razor({ id: 'razor', x: 2, y: 2, maxAp: 4 });
  world.addEntity(player);

  let drone = null;
  if (placeDrone) {
    drone = new CorpDrone({ id: 'd1', x: 7, y: 2, maxAp: 3 });
    world.addEntity(drone);
    drone.bindToBus(bus);
  }

  const queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
  const rng = new Rng(1);

  const log = [];
  const calls = { advanceTurn: 0, resetInputModes: 0 };
  const ctx = {
    world,
    player,
    queue,
    rng,
    log: line => log.push(line),
    advanceTurn: () => {
      calls.advanceTurn++;
      queue.endTurn(world);
    },
    resetInputModes: () => {
      calls.resetInputModes++;
    },
  };
  return { ctx, log, calls, drone, world, player, queue };
}

test('move intent commits and logs a move', () => {
  const { ctx, log, player } = buildCtx();
  // Move down — (2,3) is plain floor, while (3,2) holds the test's cover tile.
  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);
  assert.equal(player.x, 2);
  assert.equal(player.y, 3);
  assert.ok(log.some(l => l.includes('moved to')));
});

test('move into a wall is denied (logs MOVE DENIED, no mutation)', () => {
  const { ctx, log, player } = buildCtx();
  player.x = 1;
  player.y = 1;
  applyIntent({ type: 'move', dx: -1, dy: 0 }, ctx); // into the wall at x=0
  assert.equal(player.x, 1);
  assert.equal(player.y, 1);
  assert.ok(log.some(l => l.includes('MOVE DENIED')));
});

test('vault hops cover for the Merc and lands two tiles away', () => {
  const { ctx, player } = buildCtx({ archetype: 'merc' });
  // Cover is at (3,2); player at (2,2) — vault dx=1 should land at (4,2).
  applyIntent({ type: 'vault', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 4);
  assert.equal(player.y, 2);
});

test('vault refuses a non-Merc archetype', () => {
  const { ctx, log, player } = buildCtx({ archetype: 'razor' });
  applyIntent({ type: 'vault', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 2, 'Razor should not move on a vault');
  assert.ok(log.some(l => l.includes('only the Merc')));
});

test('slide moves the Razor 2 tiles and engages stealth', () => {
  const { ctx, player } = buildCtx({ archetype: 'razor' });
  // Player at (2,2). Slide dy=1 wants to land at (2,4) — but (3,2) is cover
  // so dy=1 (down) avoids it: step (2,3), land (2,4). Both should be FLOOR.
  applyIntent({ type: 'slide', dx: 0, dy: 1 }, ctx);
  assert.equal(player.x, 2);
  assert.equal(player.y, 4);
  assert.equal(player.stealthed, true);
});

test('end-turn invokes advanceTurn callback exactly once', () => {
  const { ctx, calls } = buildCtx();
  applyIntent({ type: 'end-turn' }, ctx);
  assert.equal(calls.advanceTurn, 1);
});

test('wait drains AP to 0 and ends the turn', () => {
  const { ctx, player, calls } = buildCtx();
  applyIntent({ type: 'wait' }, ctx);
  assert.equal(player.ap, 0);
  assert.equal(calls.advanceTurn, 1);
});

test('cancel calls resetInputModes and does not mutate state', () => {
  const { ctx, calls, player } = buildCtx();
  const beforeAp = player.ap;
  applyIntent({ type: 'cancel' }, ctx);
  assert.equal(calls.resetInputModes, 1);
  assert.equal(player.ap, beforeAp);
});

test('non-player turn refuses everything except cancel', () => {
  const { ctx, log, queue, calls } = buildCtx();
  queue.endTurn(ctx.world); // → CORP
  applyIntent({ type: 'move', dx: 1, dy: 0 }, ctx);
  assert.ok(log.some(l => l.includes('NOT YOUR TURN')));
  // Cancel still works even out of turn (per the M7 cross-input cancel rule).
  log.length = 0;
  applyIntent({ type: 'cancel' }, ctx);
  assert.equal(calls.resetInputModes, 1);
});

test('unknown intent type throws (closed enum guard)', () => {
  const { ctx } = buildCtx();
  assert.throws(() => applyIntent({ type: 'teleport' }, ctx), /unknown intent/);
  assert.throws(() => applyIntent(null, ctx), /unknown intent/);
});

test('pickFireTarget returns null when no hostile is in line', () => {
  const { ctx } = buildCtx({ placeDrone: false });
  assert.equal(pickFireTarget(ctx, 1, 0), null);
});

test('pickFireTarget finds the hostile drone in LOS', () => {
  const { ctx, drone } = buildCtx({ placeDrone: true });
  // Player at (2,2), drone at (7,2). Both on y=2, no walls between.
  const target = pickFireTarget(ctx, 1, 0);
  assert.equal(target, drone);
});

test('AP exhaustion triggers auto-end-turn during a move', () => {
  const { ctx, player, calls } = buildCtx();
  player.ap = 1; // one move's worth — should bottom out and auto-end.
  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);
  assert.equal(player.ap, 0);
  assert.equal(calls.advanceTurn, 1);
});
