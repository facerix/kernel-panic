import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { Door } from '../../../src/game/entities/Door.js';
import { TILE } from '../../../src/game/constants.js';
import {
  explorationReachableKeys,
  isImpassablePlacementChokepoint,
  anchorPreservesExplorationReachability,
} from '../../../src/game/mapConnectivity.js';
import { reconEligibleCellKeys } from '../../../src/game/objectiveProgress.js';

function oneTileBridgeWorld(): {
  world: World;
  spawn: { x: number; y: number };
  bridge: { x: number; y: number };
} {
  const grid = new Grid(7, 5, TILE.WALL);
  for (const [x, y] of [
    [1, 1],
    [2, 1],
    [3, 1],
    [1, 2],
    [2, 2],
    [3, 2],
    [5, 3],
  ]) {
    grid.setTile(x, y, TILE.FLOOR);
  }
  grid.setTile(4, 2, TILE.FLOOR);
  const world = new World(grid);
  world.addEntity(new Merc({ id: 'crew-merc', x: 1, y: 1 }));
  return { world, spawn: { x: 1, y: 1 }, bridge: { x: 4, y: 2 } };
}

function pierSevenPocketWorld(): {
  world: World;
  spawn: { x: number; y: number };
  chokepoint: { x: number; y: number };
} {
  const grid = new Grid(24, 16, TILE.WALL);
  const floor = [
    [18, 5],
    [18, 4],
    [17, 4],
    [17, 5],
    [19, 4],
    [20, 4],
    [21, 4],
    [22, 4],
    [20, 3],
    [21, 3],
    [22, 3],
    [20, 5],
    [21, 5],
    [19, 11],
    [20, 11],
    [22, 11],
  ];
  for (const [x, y] of floor) grid.setTile(x, y, TILE.FLOOR);
  const world = new World(grid);
  world.addEntity(new Merc({ id: 'crew-merc', x: 18, y: 5 }));
  world.addEntity(
    new Door({
      id: 'door-entity-0',
      doorId: 'door-0',
      x: 19,
      y: 11,
    })
  );
  return { world, spawn: { x: 18, y: 5 }, chokepoint: { x: 19, y: 4 } };
}

describe('mapConnectivity', () => {
  it('counts only entity-reachable cells for recon eligibility', () => {
    const { world, spawn, bridge } = oneTileBridgeWorld();
    world.addEntity(
      new Terminal({
        id: 'terminal-bridge',
        x: bridge.x,
        y: bridge.y,
        label: 'Access terminal',
        unlocksId: 'door-0',
      })
    );

    const eligible = reconEligibleCellKeys(world);

    assert.equal(eligible.has('5,3'), false, 'sealed pocket must not count toward recon');
    assert.equal(eligible.size, explorationReachableKeys(world, spawn).size);
  });

  it('ignores entity blockers only when explicitly disabled', () => {
    const grid = new Grid(7, 5, TILE.WALL);
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [3, 1],
      [1, 2],
      [2, 2],
      [3, 2],
      [5, 3],
    ]) {
      grid.setTile(x, y, TILE.FLOOR);
    }
    const world = new World(grid);
    world.addEntity(new Merc({ id: 'crew-merc', x: 1, y: 1 }));
    const reachable = explorationReachableKeys(
      world,
      { x: 1, y: 1 },
      {
        respectEntityBlockers: false,
      }
    );
    assert.equal(reachable.size, 6);
    assert.equal(reachable.has('5,3'), false);
  });

  it('flags a one-tile bridge as an impassable placement chokepoint', () => {
    const { world, spawn, bridge } = oneTileBridgeWorld();
    assert.equal(isImpassablePlacementChokepoint(world, spawn, bridge), true);
    assert.equal(anchorPreservesExplorationReachability(world, spawn, bridge), false);
  });

  it('allows impassable placement in a non-bridge alcove', () => {
    const { world, spawn } = oneTileBridgeWorld();
    assert.equal(isImpassablePlacementChokepoint(world, spawn, { x: 2, y: 2 }), false);
  });

  it('detects the pier-7 debug pocket chokepoint at the unlock terminal tile', () => {
    const { world, spawn, chokepoint } = pierSevenPocketWorld();
    const before = explorationReachableKeys(world, spawn);
    const after = explorationReachableKeys(world, spawn, {
      extraBlockers: new Set([`${chokepoint.x},${chokepoint.y}`]),
    });
    assert.ok(before.has('21,3'), 'north-east pocket should be reachable before blocking');
    assert.equal(after.has('21,3'), false, 'blocking the chokepoint should seal the pocket');
    assert.equal(isImpassablePlacementChokepoint(world, spawn, chokepoint), true);
  });

  it('excludes impassable-entity pockets from recon required tiles', () => {
    const { world, chokepoint } = pierSevenPocketWorld();
    world.addEntity(
      new Terminal({
        id: 'terminal-unlock-0',
        x: chokepoint.x,
        y: chokepoint.y,
        label: 'Access terminal',
        unlocksId: 'door-0',
      })
    );

    const eligible = reconEligibleCellKeys(world);

    assert.equal(eligible.has('21,3'), false);
  });

  it('does not treat an already-blocked tile as a new chokepoint', () => {
    const { world, spawn, chokepoint } = pierSevenPocketWorld();
    world.addEntity(
      new Terminal({
        id: 'terminal-unlock-0',
        x: chokepoint.x,
        y: chokepoint.y,
        label: 'Access terminal',
        unlocksId: 'door-0',
      })
    );

    assert.equal(isImpassablePlacementChokepoint(world, spawn, chokepoint), false);
  });
});
