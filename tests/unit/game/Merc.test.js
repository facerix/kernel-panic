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

test('Merc.canVault rejects if the landing tile has a friendly entity', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  const ally = new Entity({ id: 'a', x: 5, y: 3, faction: FACTION.PLAYER, glyph: 't' });
  const { world, merc } = makeWorld({ grid: g, extraEntities: [ally] });
  assert.equal(merc.canVault(world, 1, 0).reason, 'friendly-occupied');
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

// ---------------------------------------------------------------------------
// Vault body-check + knockback
// ---------------------------------------------------------------------------

test('Merc.canVault allows landing on a hostile when knockback lane is clear', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  const drone = new Entity({ id: 'd', x: 5, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const { world, merc } = makeWorld({ grid: g, extraEntities: [drone] });
  const check = merc.canVault(world, 1, 0);
  assert.equal(check.ok, true);
  assert.equal(check.occupant, drone);
});

test('Merc.canVault rejects hostile landing when knockback tile is OOB', () => {
  // 6-wide grid: merc at (3,3), cover at (4,3), drone at (5,3).
  // Knockback destination (6,3) is OOB.
  const g = new Grid(6, 5);
  g.setTile(4, 3, TILE.COVER);
  const drone = new Entity({ id: 'd', x: 5, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const { world, merc } = makeWorld({ grid: g, mercAt: [3, 3], extraEntities: [drone] });
  assert.equal(merc.canVault(world, 1, 0).reason, 'knockback-oob');
});

test('Merc.canVault rejects hostile landing when knockback tile is a wall', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  g.setTile(6, 3, TILE.WALL);
  const drone = new Entity({ id: 'd', x: 5, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const { world, merc } = makeWorld({ grid: g, extraEntities: [drone] });
  assert.equal(merc.canVault(world, 1, 0).reason, 'knockback-blocked');
});

test('Merc.canVault rejects hostile landing when knockback tile is occupied', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  const drone1 = new Entity({ id: 'd1', x: 5, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const drone2 = new Entity({ id: 'd2', x: 6, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const { world, merc } = makeWorld({ grid: g, extraEntities: [drone1, drone2] });
  assert.equal(merc.canVault(world, 1, 0).reason, 'knockback-occupied');
});

test('Merc.canVault allows knockback into COVER tiles (hostile lands behind cover)', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER); // hop tile
  g.setTile(6, 3, TILE.COVER); // knockback destination — passable for entities
  const drone = new Entity({ id: 'd', x: 5, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const { world, merc } = makeWorld({ grid: g, extraEntities: [drone] });
  assert.equal(merc.canVault(world, 1, 0).ok, true);
});

test('Merc.vault knocks hostile back and lands on vacated tile', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  const drone = new Entity({ id: 'd', x: 5, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const { world, merc } = makeWorld({ grid: g, extraEntities: [drone] });
  const { occupant } = merc.vault(world, 1, 0);
  assert.equal(occupant, drone);
  assert.equal(merc.x, 5, 'Merc lands where the hostile was');
  assert.equal(merc.y, 3);
  assert.equal(drone.x, 6, 'Hostile knocked back 1 tile in vault direction');
  assert.equal(drone.y, 3);
});

test('Merc.vault returns null occupant when landing tile is empty', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  const { world, merc } = makeWorld({ grid: g });
  const { occupant } = merc.vault(world, 1, 0);
  assert.equal(occupant, null);
});

test('Merc.vault is repeatable (no one-shot gate)', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  g.setTile(6, 3, TILE.COVER);
  const merc = new Merc({ id: 'merc', x: 3, y: 3, glyph: '@', maxAp: 8 });
  merc.ap = 8; // enough for two vaults
  const world = new World(g);
  world.addEntity(merc);
  merc.vault(world, 1, 0); // hop over (4,3), land at (5,3)
  assert.equal(merc.x, 5);
  merc.vault(world, 1, 0); // hop over (6,3), land at (7,3)
  assert.equal(merc.x, 7);
  assert.equal(merc.ap, 8 - 2 * AP_COST.VAULT);
});
