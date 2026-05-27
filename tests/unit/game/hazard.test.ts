/**
 * M2.3 — Environmental hazard tiles.
 *
 * Tests cover: grid passability, LOS transparency, movement cost, hazard
 * damage during player aftermath, snapshot round-trip, and hazard cluster
 * placement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import { TILE, FACTION, HAZARD_DAMAGE } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';
import {
  runPlayerAftermathSteps,
  formatPlayerAftermathStepLogLines,
  isPlayerAftermathStepLogVisible,
} from '../../../src/game/combatTurnPipeline.js';
import { placeHazardCluster } from '../../../src/game/Run.js';
import { hasLineOfSight } from '../../../src/game/LineOfSight.js';
import { Pickup } from '../../../src/game/entities/Pickup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHazardWorld(width = 8, height = 8) {
  const grid = new Grid(width, height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  const bus = new EventBus();
  return { grid, world: new World(grid, { events: bus }), bus };
}

function makeEntity(id: string, x: number, y: number, faction = FACTION.PLAYER, hp = 3) {
  return new Entity({ id, x, y, faction, glyph: '@', maxHp: hp });
}

// ---------------------------------------------------------------------------
// Grid: passability and LOS
// ---------------------------------------------------------------------------

test('HAZARD tile is passable', () => {
  const g = new Grid(3, 1);
  g.setTile(1, 0, TILE.HAZARD);
  assert.equal(g.isPassable(1, 0), true, 'HAZARD should be passable');
});

test('HAZARD tile does NOT block line of sight', () => {
  const g = new Grid(5, 1);
  g.setTile(2, 0, TILE.HAZARD);
  assert.equal(g.blocksLineOfSight(2, 0), false, 'HAZARD should not block LOS');
  assert.equal(hasLineOfSight(g, 0, 0, 4, 0), true, 'LOS through HAZARD tile');
});

test('HAZARD tile blocks movement as little as FLOOR does', () => {
  const { world } = makeHazardWorld(4, 1);
  world.grid.setTile(1, 0, TILE.HAZARD);
  const entity = makeEntity('e', 0, 0);
  world.addEntity(entity);
  const check = world.canMoveEntity(entity, 1, 0);
  assert.equal(check.ok, true, 'should be able to step onto HAZARD');
});

// ---------------------------------------------------------------------------
// Hazard damage during player aftermath
// ---------------------------------------------------------------------------

test('entity on HAZARD tile takes damage during player aftermath', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const entity = makeEntity('victim', 3, 3, FACTION.PLAYER, 3);
  world.addEntity(entity);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  const hazardSteps = steps.filter(s => s.type === 'hazard-damage');
  assert.equal(hazardSteps.length, 1);
  assert.equal(hazardSteps[0].type, 'hazard-damage');
  assert.equal(hazardSteps[0].damage, HAZARD_DAMAGE);
  assert.equal(hazardSteps[0].killed, false);
  assert.equal(entity.hp, 3 - HAZARD_DAMAGE);
  assert.equal(entity.alive, true);
});

test('entity on FLOOR tile takes no hazard damage', () => {
  const { world } = makeHazardWorld();
  const entity = makeEntity('safe', 2, 2, FACTION.PLAYER, 3);
  world.addEntity(entity);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  const hazardSteps = steps.filter(s => s.type === 'hazard-damage');
  assert.equal(hazardSteps.length, 0);
  assert.equal(entity.hp, 3);
});

test('hazard damage kills entity at 1 HP', () => {
  const { world, grid, bus } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const entity = makeEntity('doomed', 3, 3, FACTION.CORP, 1);
  world.addEntity(entity);

  const damagedPayloads: unknown[] = [];
  bus.on(EVENT.ENTITY_DAMAGED, p => damagedPayloads.push(p));

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  const hazardSteps = steps.filter(s => s.type === 'hazard-damage');
  assert.equal(hazardSteps.length, 1);
  assert.equal(hazardSteps[0].killed, true);
  assert.equal(entity.hp, 0);
  assert.equal(entity.alive, false);

  // ENTITY_DAMAGED event emitted with source: 'hazard'
  assert.equal(damagedPayloads.length, 1);
  const payload = damagedPayloads[0] as Record<string, unknown>;
  assert.equal(payload.source, 'hazard');
  assert.equal(payload.killed, true);
  assert.equal(payload.attacker, null);
});

test('HAZARD_DAMAGE event emitted on hazard tick', () => {
  const { world, grid, bus } = makeHazardWorld();
  grid.setTile(4, 4, TILE.HAZARD);
  const entity = makeEntity('burned', 4, 4, FACTION.PLAYER, 3);
  world.addEntity(entity);

  const hazardPayloads: unknown[] = [];
  bus.on(EVENT.HAZARD_DAMAGE, p => hazardPayloads.push(p));

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  assert.equal(steps.filter(s => s.type === 'hazard-damage').length, 1);
  assert.equal(hazardPayloads.length, 1);
  const payload = hazardPayloads[0] as Record<string, unknown>;
  assert.equal(payload.damage, HAZARD_DAMAGE);
  assert.equal(payload.x, 4);
  assert.equal(payload.y, 4);
});

test('objective Pickup on HAZARD tile is not damaged by hazard tick', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const pickup = new Pickup({ id: 'pickup-0', x: 3, y: 3, label: 'Clinic Records' });
  world.addEntity(pickup);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  assert.equal(steps.filter(s => s.type === 'hazard-damage').length, 0);
  assert.equal(pickup.hp, 1);
  assert.equal(pickup.alive, true);
});

test('dead entities on HAZARD do not take further damage', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(3, 3, TILE.HAZARD);
  const entity = makeEntity('corpse', 3, 3, FACTION.CORP, 1);
  world.addEntity(entity);
  entity.hp = 0;
  entity.alive = false;

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  const hazardSteps = steps.filter(s => s.type === 'hazard-damage');
  assert.equal(hazardSteps.length, 0, 'dead entity should not take hazard damage');
});

test('multiple entities on different HAZARD tiles all take damage', () => {
  const { world, grid } = makeHazardWorld();
  grid.setTile(1, 1, TILE.HAZARD);
  grid.setTile(5, 5, TILE.HAZARD);
  const a = makeEntity('a', 1, 1, FACTION.PLAYER, 3);
  const b = makeEntity('b', 5, 5, FACTION.CORP, 3);
  world.addEntity(a);
  world.addEntity(b);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  const hazardSteps = steps.filter(s => s.type === 'hazard-damage');
  assert.equal(hazardSteps.length, 2);
  assert.equal(a.hp, 3 - HAZARD_DAMAGE);
  assert.equal(b.hp, 3 - HAZARD_DAMAGE);
});

// ---------------------------------------------------------------------------
// Log formatting
// ---------------------------------------------------------------------------

test('formatPlayerAftermathStepLogLines produces hazard damage line', () => {
  const entity = makeEntity('player-0', 3, 3, FACTION.PLAYER, 3);
  const lines = formatPlayerAftermathStepLogLines({
    type: 'hazard-damage',
    entity,
    damage: 1,
    killed: false,
  });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('hazard damage'));
});

test('formatPlayerAftermathStepLogLines includes DOWN on kill', () => {
  const entity = makeEntity('drone-0', 3, 3, FACTION.CORP, 1);
  const lines = formatPlayerAftermathStepLogLines({
    type: 'hazard-damage',
    entity,
    damage: 1,
    killed: true,
  });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('DOWN'));
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

test('isPlayerAftermathStepLogVisible: hazard damage to player always visible', () => {
  const entity = makeEntity('player-0', 3, 3, FACTION.PLAYER, 3);
  const visible = isPlayerAftermathStepLogVisible(
    { type: 'hazard-damage', entity, damage: 1, killed: false },
    () => false, // tile not visible
    'player-0'
  );
  assert.equal(visible, true, 'player hazard damage always visible');
});

test('isPlayerAftermathStepLogVisible: hazard damage to non-player respects LOS', () => {
  const entity = makeEntity('drone-0', 3, 3, FACTION.CORP, 3);
  const notVisible = isPlayerAftermathStepLogVisible(
    { type: 'hazard-damage', entity, damage: 1, killed: false },
    () => false,
    'player-0'
  );
  assert.equal(notVisible, false);

  const isVisible = isPlayerAftermathStepLogVisible(
    { type: 'hazard-damage', entity, damage: 1, killed: false },
    () => true,
    'player-0'
  );
  assert.equal(isVisible, true);
});

// ---------------------------------------------------------------------------
// Hazard cluster placement
// ---------------------------------------------------------------------------

test('placeHazardCluster places HAZARD tiles around center', () => {
  const { world } = makeHazardWorld(10, 10);
  const center = { x: 5, y: 5 };
  const placed = placeHazardCluster(world, center, new Rng(42));

  assert.ok(placed >= 5, `should place at least center + 4 cardinals, got ${placed}`);
  assert.ok(placed <= 9, `should place at most 9 tiles, got ${placed}`);
  assert.equal(world.grid.tileAt(5, 5), TILE.HAZARD, 'center is HAZARD');
  // All cardinal neighbours should be hazard (all are FLOOR in a clean 10x10)
  assert.equal(world.grid.tileAt(4, 5), TILE.HAZARD, 'left');
  assert.equal(world.grid.tileAt(6, 5), TILE.HAZARD, 'right');
  assert.equal(world.grid.tileAt(5, 4), TILE.HAZARD, 'up');
  assert.equal(world.grid.tileAt(5, 6), TILE.HAZARD, 'down');
});

test('placeHazardCluster does not overwrite WALL tiles', () => {
  const { world } = makeHazardWorld(10, 10);
  world.grid.setTile(4, 5, TILE.WALL);
  const center = { x: 5, y: 5 };
  placeHazardCluster(world, center, new Rng(42));

  assert.equal(world.grid.tileAt(4, 5), TILE.WALL, 'wall should be preserved');
  assert.equal(world.grid.tileAt(5, 5), TILE.HAZARD, 'center still placed');
});

test('placeHazardCluster does not overwrite occupied tiles', () => {
  const { world } = makeHazardWorld(10, 10);
  const entity = makeEntity('e', 6, 5, FACTION.PLAYER, 3);
  world.addEntity(entity);
  const center = { x: 5, y: 5 };
  placeHazardCluster(world, center, new Rng(42));

  assert.equal(world.grid.tileAt(6, 5), TILE.FLOOR, 'occupied tile should stay FLOOR');
});

test('placeHazardCluster handles edge-of-map center gracefully', () => {
  const { world } = makeHazardWorld(6, 6);
  const center = { x: 0, y: 0 };
  const placed = placeHazardCluster(world, center, new Rng(1));
  assert.ok(placed >= 1, 'should place at least the center tile');
  assert.equal(world.grid.tileAt(0, 0), TILE.HAZARD);
});

// ---------------------------------------------------------------------------
// Snapshot round-trip (HAZARD tiles survive as grid tile type 5)
// ---------------------------------------------------------------------------

test('HAZARD tiles survive grid snapshot round-trip', () => {
  const { grid } = makeHazardWorld(4, 4);
  grid.setTile(2, 2, TILE.HAZARD);

  // Simulate snapshot: tiles become a plain number array
  const tilesArray = Array.from(grid.tiles);
  assert.equal(tilesArray[2 * 4 + 2], TILE.HAZARD);

  // Simulate restore: rebuild grid from array
  const restored = new Grid(4, 4);
  for (let i = 0; i < tilesArray.length; i++) {
    restored.tiles[i] = tilesArray[i] & 0xff;
  }
  assert.equal(restored.tileAt(2, 2), TILE.HAZARD);
  assert.equal(restored.isPassable(2, 2), true);
});

// ---------------------------------------------------------------------------
// Palette: HAZARD tile has a defined glyph (import test)
// ---------------------------------------------------------------------------

test('palette defines a glyph for HAZARD tile', async () => {
  const { glyphForTile } = await import('../../../src/render/palette.js');
  const glyph = glyphForTile(TILE.HAZARD);
  assert.equal(glyph.char, '▓');
  assert.ok(glyph.fg, 'HAZARD glyph must have a foreground color');
});
