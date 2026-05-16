import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TILE } from '../../../../src/game/constants.js';
import { PREFABS, parsePrefab } from '../../../../src/game/procgen/prefabs/index.js';

const KNOWN_TILES = new Set(Object.values(TILE));

test('every registered prefab parses with consistent dimensions', () => {
  for (const [name, prefab] of Object.entries(PREFABS)) {
    assert.ok(prefab.id, `${name} prefab missing id`);
    assert.ok(prefab.w > 0 && prefab.h > 0, `${name} prefab has zero dimension`);
    assert.equal(prefab.tiles.length, prefab.w * prefab.h, `${name} prefab tiles length mismatch`);
  }
});

test('every prefab tile byte is a known TILE value', () => {
  for (const prefab of Object.values(PREFABS)) {
    for (let i = 0; i < prefab.tiles.length; i++) {
      assert.ok(
        KNOWN_TILES.has(prefab.tiles[i]),
        `${prefab.id} byte ${i} = ${prefab.tiles[i]} not in TILE`
      );
    }
  }
});

test('declared anchors lie inside the prefab bounds', () => {
  for (const prefab of Object.values(PREFABS)) {
    for (const a of prefab.anchors.drones) {
      assert.ok(a.x >= 0 && a.x < prefab.w);
      assert.ok(a.y >= 0 && a.y < prefab.h);
      for (const wp of a.waypoints ?? []) {
        assert.ok(wp.x >= 0 && wp.x < prefab.w, `${prefab.id} waypoint out of bounds`);
        assert.ok(wp.y >= 0 && wp.y < prefab.h, `${prefab.id} waypoint out of bounds`);
      }
    }
    for (const a of prefab.anchors.cover) {
      assert.ok(a.x >= 0 && a.x < prefab.w);
      assert.ok(a.y >= 0 && a.y < prefab.h);
    }
    for (const a of prefab.anchors.exit) {
      assert.ok(a.x >= 0 && a.x < prefab.w);
      assert.ok(a.y >= 0 && a.y < prefab.h);
    }
  }
});

test('cover anchors line up with COVER tiles in the parsed grid', () => {
  for (const prefab of Object.values(PREFABS)) {
    for (const a of prefab.anchors.cover) {
      const byte = prefab.tiles[a.y * prefab.w + a.x];
      assert.equal(
        byte,
        TILE.COVER,
        `${prefab.id}: cover anchor (${a.x},${a.y}) is not a COVER tile (got ${byte})`
      );
    }
  }
});

test('parsePrefab throws on unknown glyphs', () => {
  assert.throws(() => parsePrefab('...\n.X.\n...', { id: 'broken' }), /unknown glyph "X"/);
});

test('parsePrefab throws on inconsistent row width', () => {
  assert.throws(() => parsePrefab('....\n...\n....', { id: 'jagged' }), /length/);
});

test('parsePrefab throws on out-of-bounds anchor', () => {
  assert.throws(
    () =>
      parsePrefab('...\n...', {
        id: 'oob',
        anchors: { drones: [{ x: 9, y: 0 }] },
      }),
    /out of/
  );
});

test('parsePrefab throws on metadata vs ASCII size disagreement', () => {
  assert.throws(() => parsePrefab('....\n....', { id: 'liar', w: 5, h: 2 }), /disagrees/);
});
