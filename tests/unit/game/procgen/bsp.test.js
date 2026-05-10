import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../../../../src/rng.js';
import {
  splitRegion,
  leaves,
  internalNodes,
  BSP_TUNABLES,
} from '../../../../src/game/procgen/bsp.js';

const fullRegion = (width, height) => ({ x: 0, y: 0, width, height });

test('splitRegion is deterministic for the same seed', () => {
  const a = splitRegion(new Rng(42), fullRegion(24, 16));
  const b = splitRegion(new Rng(42), fullRegion(24, 16));
  assert.deepEqual(a, b, 'identical seeds must produce identical trees');
});

test('every leaf rect lies inside its parent and respects MIN_LEAF', () => {
  const root = splitRegion(new Rng(7), fullRegion(24, 16));
  const allLeaves = leaves(root);
  assert.ok(allLeaves.length >= 1, 'expected at least one leaf');
  for (const leaf of allLeaves) {
    assert.ok(
      leaf.region.width >= BSP_TUNABLES.MIN_LEAF,
      `leaf width ${leaf.region.width} below MIN_LEAF`
    );
    assert.ok(
      leaf.region.height >= BSP_TUNABLES.MIN_LEAF,
      `leaf height ${leaf.region.height} below MIN_LEAF`
    );
    // Containment in the original 24×16 region.
    assert.ok(leaf.region.x >= 0);
    assert.ok(leaf.region.y >= 0);
    assert.ok(leaf.region.x + leaf.region.width <= 24);
    assert.ok(leaf.region.y + leaf.region.height <= 16);
  }
});

test('children of an internal node tile its region with no overlap', () => {
  const root = splitRegion(new Rng(13), fullRegion(30, 20));
  for (const node of internalNodes(root)) {
    const { region, left, right, axis } = node;
    assert.ok(left && right, 'internal node should have both children');
    if (axis === 'v') {
      assert.equal(left.region.y, region.y);
      assert.equal(left.region.height, region.height);
      assert.equal(right.region.y, region.y);
      assert.equal(right.region.height, region.height);
      assert.equal(left.region.x + left.region.width, right.region.x);
      assert.equal(left.region.width + right.region.width, region.width);
    } else if (axis === 'h') {
      assert.equal(left.region.x, region.x);
      assert.equal(left.region.width, region.width);
      assert.equal(right.region.x, region.x);
      assert.equal(right.region.width, region.width);
      assert.equal(left.region.y + left.region.height, right.region.y);
      assert.equal(left.region.height + right.region.height, region.height);
    } else {
      assert.fail(`internal node has null axis (region ${JSON.stringify(region)})`);
    }
  }
});

test('region smaller than MIN_LEAF throws', () => {
  assert.throws(
    () => splitRegion(new Rng(1), fullRegion(BSP_TUNABLES.MIN_LEAF - 1, BSP_TUNABLES.MIN_LEAF)),
    /smaller than MIN_LEAF/
  );
});

test('non-integer region throws (data-corruption guard)', () => {
  assert.throws(() => splitRegion(new Rng(1), { x: 0, y: 0, width: 12.5, height: 10 }));
});

test('rng-less call throws TypeError', () => {
  assert.throws(() => splitRegion(null, fullRegion(20, 16)), TypeError);
});

test('a region right at MIN_LEAF returns a single leaf', () => {
  const region = fullRegion(BSP_TUNABLES.MIN_LEAF, BSP_TUNABLES.MIN_LEAF);
  const root = splitRegion(new Rng(99), region);
  assert.equal(root.left, null);
  assert.equal(root.right, null);
  assert.equal(root.axis, null);
  assert.equal(leaves(root).length, 1);
});
