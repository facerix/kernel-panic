import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../../../../src/rng.js';
import { FACTION, TILE } from '../../../../src/game/constants.js';
import { Curator, OBJECTIVES, isObjective } from '../../../../src/game/hub/Curator.js';
import { buildHub } from '../../../../src/game/hub/SafeSpace.js';

test('Curator constructs with NEUTRAL faction and zero AP', () => {
  const c = new Curator({ x: 2, y: 3 });
  assert.equal(c.faction, FACTION.NEUTRAL);
  assert.equal(c.maxAp, 0);
  assert.equal(c.glyph, 'C');
  assert.equal(c.x, 2);
  assert.equal(c.y, 3);
  assert.equal(c.alive, true);
});

test('generateContract is deterministic for the same Rng state', () => {
  const a = new Curator().generateContract(new Rng(123));
  const b = new Curator().generateContract(new Rng(123));
  assert.deepEqual(a, b);
});

test('contract objective is in the known set and threatCount > 0', () => {
  const contract = new Curator().generateContract(new Rng(0xdeadbeef));
  assert.ok(isObjective(contract.objective), `unknown objective ${contract.objective}`);
  assert.equal(contract.objective, OBJECTIVES.REACH_EXIT);
  assert.ok(contract.threatCount > 0);
  assert.ok(typeof contract.label === 'string' && contract.label.length > 0);
  assert.ok(Number.isInteger(contract.seed) && contract.seed >= 0);
});

test('different Rng states yield different seeds (no constant return)', () => {
  // Pull two contracts from different streams; with five labels + 2³¹ seeds
  // the seeds collision probability is negligible, so two distinct rngs
  // producing identical seeds would be a sign generateContract isn't
  // actually consuming randomness.
  const a = new Curator().generateContract(new Rng(1));
  const b = new Curator().generateContract(new Rng(2));
  assert.notEqual(a.seed, b.seed, 'expected different seeds from different rngs');
});

test('generateContract throws on missing rng', () => {
  assert.throws(() => new Curator().generateContract(null), /requires an Rng/);
});

test('Curator is immobile — refreshAp keeps ap at 0', () => {
  const c = new Curator();
  c.refreshAp();
  assert.equal(c.ap, 0);
  assert.equal(c.canAfford(1), false);
});

test('buildHub places spawn and curator on FLOOR; exit on TILE.EXIT', () => {
  const hub = buildHub();
  assert.equal(hub.grid.isPassable(hub.playerSpawn.x, hub.playerSpawn.y), true);
  assert.equal(hub.grid.isPassable(hub.curatorSpawn.x, hub.curatorSpawn.y), true);
  assert.equal(hub.grid.isPassable(hub.exitTile.x, hub.exitTile.y), true);
  assert.equal(hub.grid.tileAt(hub.exitTile.x, hub.exitTile.y), TILE.EXIT);
});

test('buildHub returns a stable layout (idempotent)', () => {
  const a = buildHub();
  const b = buildHub();
  assert.deepEqual(Array.from(a.grid.tiles), Array.from(b.grid.tiles));
  assert.deepEqual(a.playerSpawn, b.playerSpawn);
  assert.deepEqual(a.curatorSpawn, b.curatorSpawn);
  assert.deepEqual(a.exitTile, b.exitTile);
});
