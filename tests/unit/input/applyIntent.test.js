import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { TurnQueue } from '../../../src/game/TurnQueue.js';
import { EventBus } from '../../../src/game/events.js';
import { TILE, FACTION } from '../../../src/game/constants.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Razor } from '../../../src/game/archetypes/Razor.js';
import { Tech } from '../../../src/game/archetypes/Tech.js';
import { Turret } from '../../../src/game/Turret.js';
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
      : archetype === 'tech'
        ? new Tech({ id: 'tech', x: 2, y: 2, maxAp: 4 })
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
  const calls = { advanceTurn: 0, resetInputModes: 0, interact: 0 };
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
    onInteract: () => {
      calls.interact++;
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

test('special intent routes to Vault on a Merc and lands two tiles away', () => {
  // Cover is at (3,2); player at (2,2) — special dx=1 should land at (4,2).
  // applyIntent.doSpecial dispatches by capability check on the live player.
  const { ctx, player } = buildCtx({ archetype: 'merc' });
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 4);
  assert.equal(player.y, 2);
});

test('special intent routes to Deploy on a Tech and places a Turret adjacent', () => {
  // Player at (2,2). Special dy=1 (south) targets (2,3) — plain floor in the
  // shared `buildCtx` grid, so the deploy is legal.
  const { ctx, world, player } = buildCtx({ archetype: 'tech', placeDrone: false });
  applyIntent({ type: 'special', dx: 0, dy: 1 }, ctx);
  const placed = world.entityAt(2, 3);
  assert.ok(placed instanceof Turret, 'expected a Turret placed south of the Tech');
  assert.equal(placed.faction, FACTION.PLAYER);
  assert.equal(player.turretReady, false, 'Tech.turretReady consumed on commit');
});

test('special intent routes to Slide on a Razor (moves 2 tiles, engages stealth)', () => {
  const { ctx, player } = buildCtx({ archetype: 'razor' });
  // Player at (2,2). Special dy=1 wants to land at (2,4) — but (3,2) is cover
  // so dy=1 (down) avoids it: step (2,3), land (2,4). Both should be FLOOR.
  applyIntent({ type: 'special', dx: 0, dy: 1 }, ctx);
  assert.equal(player.x, 2);
  assert.equal(player.y, 4);
  assert.equal(player.stealthed, true);
});

test('end-turn drains AP to 0, logs wait, and invokes advanceTurn once', () => {
  const { ctx, player, calls, log } = buildCtx();
  applyIntent({ type: 'end-turn' }, ctx);
  assert.equal(player.ap, 0);
  assert.equal(calls.advanceTurn, 1);
  assert.ok(
    log.some(l => l.includes('waits')),
    'combat log should mention waiting'
  );
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

test('interact intent fires the shell-supplied onInteract callback once', () => {
  const { ctx, calls } = buildCtx();
  applyIntent({ type: 'interact' }, ctx);
  assert.equal(calls.interact, 1);
});

test('interact intent crashes when ctx.onInteract is missing (no silent no-op)', () => {
  const { ctx } = buildCtx();
  delete ctx.onInteract;
  assert.throws(() => applyIntent({ type: 'interact' }, ctx), /onInteract/);
});

// --- Vault-while-firing (via the unified `special` intent) ---------------

test('special on a Merc resolves a free shot at the first hostile in the vault direction', () => {
  const { ctx, log, player } = buildCtx({ archetype: 'merc' });
  // Player at (2,2), cover at (3,2), land at (4,2), drone at (7,2).
  // Special east on a Merc should land AND fire at the drone.
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 4, 'player landed at vault destination');
  assert.ok(
    log.some(l => l.includes('fires at')),
    'log mentions the shot'
  );
  // The shot was attempted — HP may or may not have changed depending on RNG,
  // but the intent handler must not have thrown.
});

test('vault-while-fire does not debit extra AP beyond the vault cost', () => {
  const { ctx, player } = buildCtx({ archetype: 'merc' });
  const apBefore = player.ap; // 4
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  // Vault costs 3 AP; no additional AP for the shot.
  assert.equal(player.ap, apBefore - 3, 'only vault AP spent, shot is free');
});

test('vault succeeds without a shot when no hostile is in the vault direction', () => {
  const { ctx, log, player } = buildCtx({ archetype: 'merc', placeDrone: false });
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 4, 'vault still lands');
  assert.ok(
    log.some(l => l.includes('vaulted to')),
    'log mentions the vault'
  );
  assert.ok(!log.some(l => l.includes('fires at')), 'no shot logged');
});

test('AP exhaustion triggers auto-end-turn during a move', () => {
  const { ctx, player, calls } = buildCtx();
  player.ap = 1; // one move's worth — should bottom out and auto-end.
  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);
  assert.equal(player.ap, 0);
  assert.equal(calls.advanceTurn, 1);
});
