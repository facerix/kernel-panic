import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Entity } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { TILE, FACTION, AP_COST } from '../../../src/game/constants.js';

const makeWorld = ({ grid, mercAt = [3, 3], extraEntities = [] } = {}) => {
  const g = grid ?? new Grid(8, 8);
  const w = new World(g);
  const merc = new Merc({ id: 'merc', x: mercAt[0], y: mercAt[1], glyph: '@' });
  w.addEntity(merc);
  for (const e of extraEntities) w.addEntity(e);
  return { world: w, merc };
};

test('Merc inherits from Entity and is faction PLAYER by default', () => {
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.ok(m instanceof Entity);
  assert.equal(m.faction, FACTION.PLAYER);
});

test('Merc.canVault rejects (0,0) as no-op', () => {
  const { world, merc } = makeWorld();
  assert.equal(merc.canVault(world, 0, 0).reason, 'no-op');
});

test('Merc.canVault rejects steps larger than 1 (Chebyshev)', () => {
  const { world, merc } = makeWorld();
  assert.equal(merc.canVault(world, 2, 0).reason, 'too-far');
  assert.equal(merc.canVault(world, 0, -2).reason, 'too-far');
});

test('Merc.canVault rejects when AP < VAULT cost', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  const { world, merc } = makeWorld({ grid: g });
  merc.spendAp(merc.ap - (AP_COST.VAULT - 1)); // leave AP one short
  assert.equal(merc.canVault(world, 1, 0).reason, 'insufficient-ap');
});

test('Merc.canVault rejects if the hopped tile is FLOOR (nothing to vault)', () => {
  const { world, merc } = makeWorld(); // all floor
  assert.equal(merc.canVault(world, 1, 0).reason, 'no-cover');
});

test('Merc.canVault rejects if the hopped tile is a WALL', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.WALL);
  const { world, merc } = makeWorld({ grid: g });
  assert.equal(merc.canVault(world, 1, 0).reason, 'no-cover');
});

test('Merc.canVault rejects if the landing tile is out of bounds', () => {
  const g = new Grid(5, 5);
  g.setTile(4, 3, TILE.COVER);
  const { world, merc } = makeWorld({ grid: g, mercAt: [3, 3] });
  // Landing would be (5,3) — out of bounds.
  assert.equal(merc.canVault(world, 1, 0).reason, 'out-of-bounds');
});

test('Merc.canVault rejects if the landing tile is a WALL', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  g.setTile(5, 3, TILE.WALL);
  const { world, merc } = makeWorld({ grid: g });
  assert.equal(merc.canVault(world, 1, 0).reason, 'blocked');
});

test('Merc.canVault rejects if the landing tile is COVER (no double-hop)', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  g.setTile(5, 3, TILE.COVER);
  const { world, merc } = makeWorld({ grid: g });
  assert.equal(merc.canVault(world, 1, 0).reason, 'blocked');
});

test('Merc.canVault rejects if the landing tile is occupied', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  const drone = new Entity({ id: 'd', x: 5, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const { world, merc } = makeWorld({ grid: g, extraEntities: [drone] });
  assert.equal(merc.canVault(world, 1, 0).reason, 'occupied');
});

test('Merc.canVault accepts a clean orthogonal hop over cover onto floor', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  const { world, merc } = makeWorld({ grid: g });
  assert.equal(merc.canVault(world, 1, 0).ok, true);
});

test('Merc.canVault accepts a diagonal hop with cover diagonally adjacent', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 4, TILE.COVER);
  const { world, merc } = makeWorld({ grid: g });
  assert.equal(merc.canVault(world, 1, 1).ok, true);
});

test('Merc.vault commits position by (2*dx, 2*dy) and debits VAULT AP', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  const { world, merc } = makeWorld({ grid: g });
  const apBefore = merc.ap;
  merc.vault(world, 1, 0);
  assert.equal(merc.x, 5);
  assert.equal(merc.y, 3);
  assert.equal(merc.ap, apBefore - AP_COST.VAULT);
});

test('Merc.vault throws on illegal vault and leaves state untouched', () => {
  const { world, merc } = makeWorld(); // no cover anywhere
  const apBefore = merc.ap;
  const xBefore = merc.x;
  const yBefore = merc.y;
  assert.throws(() => merc.vault(world, 1, 0), /Illegal vault/);
  assert.equal(merc.x, xBefore);
  assert.equal(merc.y, yBefore);
  assert.equal(merc.ap, apBefore);
});
