/**
 * P3.M3.3 — Cyberspace map generation.
 *
 * `buildCyberMap` carves a rooms-as-nodes lattice (data nodes linked by
 * 1-tile data lines through firewall) using only FLOOR/WALL tile ids, so
 * Grid passability / LOS / A* / VisionField all work unchanged. Deterministic
 * per rng seed; every node tile must be reachable from the entry tile.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCyberMap } from '../../../../src/game/cyber/cyberMapBuild.js';
import { World } from '../../../../src/game/World.js';
import { explorationReachableKeys, coordKey } from '../../../../src/game/mapConnectivity.js';
import {
  TILE,
  CONTRACT_DIFFICULTY,
  type ContractDifficulty,
} from '../../../../src/game/constants.js';
import { Rng } from '../../../../src/rng.js';

const build = (seed = 1, difficulty: ContractDifficulty = CONTRACT_DIFFICULTY.STANDARD) =>
  buildCyberMap({ rng: new Rng(seed), difficulty });

test('equal seeds build identical cyber maps', () => {
  const a = build(7);
  const b = build(7);
  assert.deepEqual(Array.from(a.grid.tiles), Array.from(b.grid.tiles));
  assert.deepEqual(a.entryTile, b.entryTile);
  assert.deepEqual(a.portTile, b.portTile);
  assert.deepEqual(a.nodeTiles, b.nodeTiles);
  assert.deepEqual(a.patrolRings, b.patrolRings);
});

test('different seeds diverge', () => {
  const base = Array.from(build(1).grid.tiles).join(',');
  const variants = [2, 3, 4, 5].map(seed => Array.from(build(seed).grid.tiles).join(','));
  assert.ok(
    variants.some(tiles => tiles !== base),
    'expected at least one divergent layout across seeds 2-5'
  );
});

test('cyber maps carry only FLOOR and WALL tile ids', () => {
  for (const difficulty of Object.values(CONTRACT_DIFFICULTY)) {
    const { grid } = build(11, difficulty);
    for (const tile of grid.tiles) {
      assert.ok(
        tile === TILE.FLOOR || tile === TILE.WALL,
        `unexpected tile id ${tile} on a ${difficulty} cyber map`
      );
    }
  }
});

test('entry, port, and every node tile are mutually reachable', () => {
  for (const difficulty of Object.values(CONTRACT_DIFFICULTY)) {
    for (let seed = 1; seed <= 10; seed++) {
      const map = build(seed, difficulty);
      assert.ok(map.grid.isPassable(map.entryTile.x, map.entryTile.y), 'entry tile passable');
      const reachable = explorationReachableKeys(new World(map.grid), map.entryTile);
      assert.ok(reachable.has(coordKey(map.portTile.x, map.portTile.y)), 'port reachable');
      for (const node of map.nodeTiles) {
        assert.ok(
          reachable.has(coordKey(node.x, node.y)),
          `node (${node.x}, ${node.y}) reachable from entry (seed ${seed}, ${difficulty})`
        );
      }
    }
  }
});

test('the exit port sits adjacent to the entry tile', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const map = build(seed);
    const cheb = Math.max(
      Math.abs(map.portTile.x - map.entryTile.x),
      Math.abs(map.portTile.y - map.entryTile.y)
    );
    assert.equal(cheb, 1);
    assert.ok(map.grid.isPassable(map.portTile.x, map.portTile.y));
  }
});

test('node count scales with contract difficulty', () => {
  const standard = build(3, CONTRACT_DIFFICULTY.STANDARD).nodeTiles.length;
  const critical = build(3, CONTRACT_DIFFICULTY.CRITICAL).nodeTiles.length;
  assert.ok(standard >= 2, `standard maps need slice targets, got ${standard}`);
  assert.ok(critical > standard, `critical (${critical}) must out-node standard (${standard})`);
});

test('each non-entry node carries a non-empty passable patrol ring', () => {
  const map = build(9, CONTRACT_DIFFICULTY.CRITICAL);
  assert.equal(map.patrolRings.length, map.nodeTiles.length);
  for (const ring of map.patrolRings) {
    assert.ok(ring.length > 0);
    for (const wp of ring) {
      assert.ok(map.grid.isPassable(wp.x, wp.y), `waypoint (${wp.x}, ${wp.y}) passable`);
    }
  }
});

test('unknown difficulty throws', () => {
  // @ts-expect-error Verify runtime validation of an unknown difficulty.
  assert.throws(() => buildCyberMap({ rng: new Rng(1), difficulty: 'impossible' }), /difficulty/);
});
