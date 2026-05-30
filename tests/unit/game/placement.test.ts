import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { Door } from '../../../src/game/entities/Door.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { TILE } from '../../../src/game/constants.js';
import {
  isValidBlockingPlacement,
  checkPlacementIntegrity,
  nearestEmptyFloorTile,
} from '../../../src/game/placement.js';
import { Entity } from '../../../src/game/Entity.js';
import { ConsumablePickup } from '../../../src/game/entities/ConsumablePickup.js';
import { FACTION } from '../../../src/game/constants.js';

/**
 * Build a simple two-room map connected by a 1-wide corridor:
 *
 *   #########
 *   #...#...#    rooms at y=1..3, connected at (4,2)
 *   #...C...#    C = corridor tile at (4,2)
 *   #...#...#
 *   #########
 */
function twoRoomWorld(): {
  world: World;
  spawn: { x: number; y: number };
  exitTile: { x: number; y: number };
  corridor: { x: number; y: number };
} {
  const grid = new Grid(9, 5, TILE.WALL);
  // Left room
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) grid.setTile(x, y, TILE.FLOOR);
  }
  // Right room
  for (let y = 1; y <= 3; y++) {
    for (let x = 5; x <= 7; x++) grid.setTile(x, y, TILE.FLOOR);
  }
  // Corridor
  grid.setTile(4, 2, TILE.FLOOR);
  const world = new World(grid);
  return {
    world,
    spawn: { x: 1, y: 2 },
    exitTile: { x: 7, y: 2 },
    corridor: { x: 4, y: 2 },
  };
}

/**
 * Two rooms connected by a wide (2-tile) corridor — blocking one tile
 * still leaves the other open.
 *
 *   #########
 *   #...#...#
 *   #...CC..#    corridor at (4,2) and (4,3)
 *   #...CC..#
 *   #########
 */
function wideCorridorWorld(): {
  world: World;
  spawn: { x: number; y: number };
  exitTile: { x: number; y: number };
} {
  const grid = new Grid(9, 5, TILE.WALL);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) grid.setTile(x, y, TILE.FLOOR);
  }
  for (let y = 1; y <= 3; y++) {
    for (let x = 5; x <= 7; x++) grid.setTile(x, y, TILE.FLOOR);
  }
  grid.setTile(4, 2, TILE.FLOOR);
  grid.setTile(4, 3, TILE.FLOOR);
  const world = new World(grid);
  return { world, spawn: { x: 1, y: 2 }, exitTile: { x: 7, y: 2 } };
}

describe('isValidBlockingPlacement', () => {
  it('rejects placement on a wall tile', () => {
    const { world, spawn, exitTile } = twoRoomWorld();
    assert.equal(isValidBlockingPlacement(world, spawn, exitTile, { x: 0, y: 0 }), false);
  });

  it('rejects placement on the spawn tile', () => {
    const { world, spawn, exitTile } = twoRoomWorld();
    assert.equal(isValidBlockingPlacement(world, spawn, exitTile, spawn), false);
  });

  it('rejects placement on the exit tile', () => {
    const { world, spawn, exitTile } = twoRoomWorld();
    assert.equal(isValidBlockingPlacement(world, spawn, exitTile, exitTile), false);
  });

  it('rejects placement on an occupied tile', () => {
    const { world, spawn, exitTile } = twoRoomWorld();
    world.addEntity(new Merc({ id: 'crew', x: 2, y: 2 }));
    assert.equal(isValidBlockingPlacement(world, spawn, exitTile, { x: 2, y: 2 }), false);
  });

  it('rejects placement on a reserved tile', () => {
    const { world, spawn, exitTile } = twoRoomWorld();
    const reserved = new Set(['2,2']);
    assert.equal(
      isValidBlockingPlacement(world, spawn, exitTile, { x: 2, y: 2 }, { reserved }),
      false
    );
  });

  it('rejects placement on a corridor chokepoint', () => {
    const { world, spawn, exitTile, corridor } = twoRoomWorld();
    // The single corridor tile is the only connection — blocking it seals the right room.
    assert.equal(isValidBlockingPlacement(world, spawn, exitTile, corridor), false);
  });

  it('accepts placement on a non-chokepoint room tile', () => {
    const { world, spawn, exitTile } = twoRoomWorld();
    // Interior room tile — plenty of alternate paths around it.
    assert.equal(isValidBlockingPlacement(world, spawn, exitTile, { x: 2, y: 2 }), true);
  });

  it('accepts placement beside a wide corridor (bypass exists)', () => {
    const { world, spawn, exitTile } = wideCorridorWorld();
    // Blocking one corridor tile leaves the other open (diagonal bypass via 8-way).
    assert.equal(isValidBlockingPlacement(world, spawn, exitTile, { x: 4, y: 2 }), true);
  });
});

describe('nearestEmptyFloorTile', () => {
  it('returns the anchor when it is empty', () => {
    const { world } = twoRoomWorld();
    assert.deepEqual(nearestEmptyFloorTile(world, 2, 2), { x: 2, y: 2 });
  });

  it('walks through occupied tiles to find empty floor beyond a ring', () => {
    const { world } = twoRoomWorld();
    world.addEntity(new Merc({ id: 'crew', x: 2, y: 2 }));
    for (const [x, y] of [
      [1, 2],
      [3, 2],
      [2, 1],
      [2, 3],
    ]) {
      world.addEntity(
        new Entity({ id: `block-${x}-${y}`, x, y, faction: FACTION.CORP, glyph: 'x' })
      );
    }
    assert.deepEqual(nearestEmptyFloorTile(world, 2, 2), { x: 1, y: 1 });
  });

  it('treats passable props as occupied and finds the next empty tile', () => {
    const { world } = twoRoomWorld();
    world.addEntity(
      new ConsumablePickup({
        id: 'consumable-pickup-0',
        x: 2,
        y: 2,
        consumableId: 'stim',
        label: 'Stim',
      })
    );
    assert.deepEqual(nearestEmptyFloorTile(world, 2, 2), { x: 1, y: 2 });
  });

  it('returns null when every floor tile is occupied', () => {
    const grid = new Grid(3, 3);
    const world = new World(grid);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        world.addEntity(
          new Entity({ id: `block-${x}-${y}`, x, y, faction: FACTION.CORP, glyph: 'x' })
        );
      }
    }
    assert.equal(nearestEmptyFloorTile(world, 1, 1), null);
  });
});

describe('checkPlacementIntegrity', () => {
  it('returns true for an empty map (no blocking entities)', () => {
    const { world, spawn } = twoRoomWorld();
    assert.equal(checkPlacementIntegrity(world, spawn), true);
  });

  it('returns true when anchored entities are safely placed', () => {
    const { world, spawn } = twoRoomWorld();
    world.addEntity(
      new Terminal({
        id: 'terminal-0',
        x: 2,
        y: 2,
        label: 'Test terminal',
      })
    );
    assert.equal(checkPlacementIntegrity(world, spawn), true);
  });

  it('returns false when an anchored entity seals a corridor', () => {
    const { world, spawn, corridor } = twoRoomWorld();
    world.addEntity(
      new Terminal({
        id: 'terminal-0',
        x: corridor.x,
        y: corridor.y,
        label: 'Test terminal',
      })
    );
    assert.equal(checkPlacementIntegrity(world, spawn), false);
  });

  it('ignores doors (they can be unlocked)', () => {
    const { world, spawn, corridor } = twoRoomWorld();
    world.addEntity(
      new Door({
        id: 'door-entity-0',
        doorId: 'door-0',
        x: corridor.x,
        y: corridor.y,
      })
    );
    // Door on the corridor seals it, but doors are excluded from the check.
    assert.equal(checkPlacementIntegrity(world, spawn), true);
  });

  it('ignores mobile entities (non-anchored)', () => {
    const { world, spawn, corridor } = twoRoomWorld();
    // A merc (not anchored) on the corridor — mobile, can walk off.
    world.addEntity(new Merc({ id: 'crew', x: corridor.x, y: corridor.y }));
    assert.equal(checkPlacementIntegrity(world, spawn), true);
  });

  it('restores door lock state after checking', () => {
    const { world, spawn, corridor } = twoRoomWorld();
    const door = new Door({
      id: 'door-entity-0',
      doorId: 'door-0',
      x: corridor.x,
      y: corridor.y,
    });
    world.addEntity(door);
    assert.equal(door.locked, true);
    checkPlacementIntegrity(world, spawn);
    assert.equal(door.locked, true, 'door should still be locked after check');
  });
});
