import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { Entity } from '../../../src/game/Entity.js';
import { World } from '../../../src/game/World.js';
import { TILE, FACTION, AP_COST } from '../../../src/game/constants.js';

const makePlayer = (x, y, overrides = {}) =>
  new Entity({ id: 'p', x, y, faction: FACTION.PLAYER, glyph: '@', ...overrides });

test('World.addEntity rejects duplicate ids', () => {
  const w = new World(new Grid(5, 5));
  w.addEntity(makePlayer(0, 0));
  assert.throws(() => w.addEntity(makePlayer(1, 1)), /Duplicate/);
});

test('World.addEntity rejects placement on impassable tile', () => {
  const g = new Grid(5, 5);
  g.setTile(2, 2, TILE.WALL);
  const w = new World(g);
  assert.throws(() => w.addEntity(makePlayer(2, 2)), /impassable/i);
});

test('World.addEntity rejects placement on an occupied tile', () => {
  const w = new World(new Grid(5, 5));
  w.addEntity(makePlayer(1, 1));
  const drone = new Entity({ id: 'd', x: 1, y: 1, faction: FACTION.CORP, glyph: 'd' });
  assert.throws(() => w.addEntity(drone), /occupied/i);
});

test('World.entityAt finds an entity or returns null', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 3);
  w.addEntity(p);
  assert.equal(w.entityAt(2, 3), p);
  assert.equal(w.entityAt(0, 0), null);
});

test('World.canMoveEntity rejects step further than 1 tile (Chebyshev)', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, 2, 0).ok, false);
  assert.equal(w.canMoveEntity(p, 0, 2).ok, false);
});

test('World.canMoveEntity allows orthogonal and diagonal single steps', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, 1, 0).ok, true);
  assert.equal(w.canMoveEntity(p, 1, 1).ok, true);
  assert.equal(w.canMoveEntity(p, -1, -1).ok, true);
});

test('World.canMoveEntity rejects no-op (0,0)', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  w.addEntity(p);
  const r = w.canMoveEntity(p, 0, 0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-op');
});

test('World.canMoveEntity rejects move out of bounds', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(0, 0);
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, -1, 0).reason, 'out-of-bounds');
});

test('World.canMoveEntity rejects move into a wall', () => {
  const g = new Grid(5, 5);
  g.setTile(3, 2, TILE.WALL);
  const w = new World(g);
  const p = makePlayer(2, 2);
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, 1, 0).reason, 'blocked');
});

test('World.canMoveEntity rejects move into cover (Vault is the only way through)', () => {
  const g = new Grid(5, 5);
  g.setTile(3, 2, TILE.COVER);
  const w = new World(g);
  const p = makePlayer(2, 2);
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, 1, 0).reason, 'blocked');
});

test('World.canMoveEntity rejects move into occupied tile', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  const d = new Entity({ id: 'd', x: 3, y: 2, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(p);
  w.addEntity(d);
  assert.equal(w.canMoveEntity(p, 1, 0).reason, 'occupied');
});

test('World.canMoveEntity rejects move with insufficient AP', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2, { maxAp: 0 });
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, 1, 0).reason, 'insufficient-ap');
});

test('World.moveEntity debits AP and updates position', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2, { maxAp: 4 });
  w.addEntity(p);
  w.moveEntity(p, 1, 0);
  assert.equal(p.x, 3);
  assert.equal(p.y, 2);
  assert.equal(p.ap, 4 - AP_COST.MOVE);
});

test('World.moveEntity throws on illegal move and leaves state untouched', () => {
  const g = new Grid(5, 5);
  g.setTile(3, 2, TILE.WALL);
  const w = new World(g);
  const p = makePlayer(2, 2);
  w.addEntity(p);
  const apBefore = p.ap;
  assert.throws(() => w.moveEntity(p, 1, 0), /Illegal move/);
  assert.equal(p.x, 2);
  assert.equal(p.y, 2);
  assert.equal(p.ap, apBefore);
});
