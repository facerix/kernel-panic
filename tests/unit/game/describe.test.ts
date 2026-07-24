import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeTileAt } from '../../../src/game/describe.js';
import { Entity } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { FACTION, TILE } from '../../../src/game/constants.js';
import { Door } from '../../../src/game/entities/Door.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { Curator } from '../../../src/game/hub/Curator.js';
import { VisionField } from '../../../src/game/Vision.js';
import { makeSalvage } from '../../../src/game/salvage.js';

const worldWithPlayer = () => {
  const grid = new Grid(8, 6);
  const world = new World(grid);
  const player = new Entity({ id: 'player', x: 1, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  world.addEntity(player);
  return { grid, world, player };
};

test('describeTileAt identifies rubble with AP cost', () => {
  const { grid, world } = worldWithPlayer();
  grid.setTile(3, 2, TILE.RUBBLE);
  const line = describeTileAt(world, 3, 2);
  assert.ok(line);
  assert.match(line, /Rubble.+2 AP to enter/);
});

test('describeTileAt returns null for plain floor', () => {
  const { world } = worldWithPlayer();
  assert.equal(describeTileAt(world, 2, 2), null);
});

test('describeTileAt identifies live entities without corpse state', () => {
  const { world } = worldWithPlayer();
  const drone = new Entity({ id: 'drone-1', x: 3, y: 2, faction: FACTION.CORP, glyph: 'd' });
  world.addEntity(drone);
  const line = describeTileAt(world, 3, 2);
  assert.equal(line, '[Corp] Drone');
  assert.ok(!line?.includes('corpse'));
});

test('describeTileAt uses the principal alias and spaces the bracket', () => {
  const { world } = worldWithPlayer();
  const auditor = new Entity({
    id: 'drone-1',
    x: 3,
    y: 2,
    faction: FACTION.CORP,
    glyph: 'k',
    displayName: 'Auditor',
    principalTag: 'Matsuda',
  });
  world.addEntity(auditor);
  assert.equal(describeTileAt(world, 3, 2), '[Matsuda] Auditor');
});

test('describeTileAt identifies salvageable corpses with compact salvage', () => {
  const { world } = worldWithPlayer();
  const drone = new Entity({ id: 'drone-1', x: 3, y: 2, faction: FACTION.CORP, glyph: 'd' });
  world.addEntity(drone);
  drone.alive = false;
  drone.loot = { salvage: makeSalvage({ scrap: 2, chips: 1 }) };
  const line = describeTileAt(world, 3, 2);
  assert.ok(line);
  assert.match(line, /\[Corp\] Drone corpse — salvageable/);
  assert.match(line, /S:2 C:1 B:0 D:0/);
});

test('describeTileAt identifies stripped corpses', () => {
  const { world } = worldWithPlayer();
  const drone = new Entity({ id: 'drone-1', x: 3, y: 2, faction: FACTION.CORP, glyph: 'd' });
  world.addEntity(drone);
  drone.alive = false;
  assert.equal(describeTileAt(world, 3, 2), '[Corp] Drone corpse — stripped');
});

test('describeTileAt refuses never-seen coords under vision', () => {
  const { world, player } = worldWithPlayer();
  const vision = new VisionField();
  vision.recompute(world.grid, player, 1);
  assert.equal(describeTileAt(world, 7, 5, { vision }), "You haven't seen that tile.");
});

test('describeTileAt reports memorised corpse in memory without salvage detail', () => {
  const { world, player } = worldWithPlayer();
  const drone = new Entity({ id: 'drone-1', x: 5, y: 4, faction: FACTION.CORP, glyph: 'd' });
  world.addEntity(drone);
  drone.alive = false;
  drone.loot = { salvage: makeSalvage({ scrap: 2 }) };
  const vision = new VisionField();
  vision.seen.add('5,4');
  vision.memoriseCorpse(drone);
  vision.recompute(world.grid, player, 1);
  assert.equal(describeTileAt(world, 5, 4, { vision }), '[Corp] Drone corpse (memory)');
});

test('describeTileAt falls through to terrain when memorised corpse is gone', () => {
  const { grid, world, player } = worldWithPlayer();
  grid.setTile(5, 4, TILE.RUBBLE);
  const vision = new VisionField();
  vision.seen.add('5,4');
  vision.memoriseCorpse({ x: 5, y: 4, faction: FACTION.CORP, glyph: '%' });
  vision.recompute(world.grid, player, 1);
  const line = describeTileAt(world, 5, 4, { vision });
  assert.ok(line);
  assert.match(line, /Rubble/);
});

test('describeTileAt identifies door and terminal state clauses', () => {
  const { world } = worldWithPlayer();
  const door = new Door({ id: 'door-1', doorId: 'door-1', x: 3, y: 2 });
  const terminal = new Terminal({ id: 'terminal-1', x: 4, y: 2, sliced: true });
  world.addEntity(door);
  world.addEntity(terminal);
  assert.equal(describeTileAt(world, 3, 2), '[Neutral] Door — locked');
  assert.equal(describeTileAt(world, 4, 2), '[Neutral] Terminal — sliced');
  door.unlock();
  assert.equal(describeTileAt(world, 3, 2), '[Neutral] Door — open');
});

test('describeTileAt identifies hub Curator tile', () => {
  const { world } = worldWithPlayer();
  const curator = new Curator({ id: 'curator', x: 3, y: 2 });
  world.addEntity(curator);
  assert.equal(describeTileAt(world, 3, 2), 'Curator');
});
