/**
 * P3.M3.4 — DataNode: the slice target on the cyber grid.
 *
 * Interact accumulates the actor's `intrusionStrength` toward
 * `sliceDifficulty` (scope decision #4: named stats with real effects).
 * Only the avatar can slice (capability sniff on `isCyberAvatar`); the
 * threshold scales with contract difficulty.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DataNode, sliceDifficultyFor } from '../../../../src/game/cyber/DataNode.js';
import { CyberAvatar } from '../../../../src/game/cyber/CyberAvatar.js';
import { Grid } from '../../../../src/game/Grid.js';
import { World } from '../../../../src/game/World.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { AP_COST } from '../../../../src/game/constants.js';
import { Rng } from '../../../../src/rng.js';

function makeWorld() {
  return new World(new Grid(7, 7));
}

function makeAvatar(x = 1, y = 1, intrusionStrength = 2) {
  return new CyberAvatar({
    id: 'cyber-avatar-0',
    x,
    y,
    ram: 8,
    intrusionStrength,
    iceResistance: 1,
  });
}

function makeNode(sliceDifficulty = 3, overrides = {}) {
  return new DataNode({ id: 'data-node-0', x: 2, y: 1, sliceDifficulty, ...overrides });
}

// --- difficulty table ---------------------------------------------------------------

test('sliceDifficultyFor maps contract difficulty to the slice threshold', () => {
  assert.equal(sliceDifficultyFor('standard'), 2);
  assert.equal(sliceDifficultyFor('elevated'), 3);
  assert.equal(sliceDifficultyFor('critical'), 4);
});

test('sliceDifficultyFor throws on an unknown difficulty', () => {
  assert.throws(() => sliceDifficultyFor('apocalyptic' as never), /difficulty/);
});

// --- construction ---------------------------------------------------------------------

test('ctor validates sliceDifficulty and sliceProgress', () => {
  assert.throws(() => makeNode(0), /sliceDifficulty/);
  assert.throws(() => makeNode(-2), /sliceDifficulty/);
  assert.throws(() => makeNode(1.5), /sliceDifficulty/);
  // An absent threshold must throw, not default (no silent fallback).
  assert.throws(
    () =>
      new DataNode({
        id: 'data-node-0',
        x: 2,
        y: 1,
        sliceDifficulty: undefined as unknown as number,
      }),
    /sliceDifficulty/
  );
  assert.throws(() => makeNode(3, { sliceProgress: -1 }), /sliceProgress/);
  assert.throws(() => makeNode(3, { sliceProgress: 0.5 }), /sliceProgress/);
});

test('a fresh node starts unsliced and armed', () => {
  const node = makeNode(3);
  assert.equal(node.sliceProgress, 0);
  assert.equal(node.sliced, false);
  assert.equal(node.secured, false);
  assert.equal(node.armed, true);
});

test('a node restored at threshold is sliced and secured', () => {
  const node = makeNode(3, { sliceProgress: 4 });
  assert.equal(node.sliced, true);
  assert.equal(node.secured, true);
  assert.equal(node.armed, false);
});

// --- interact -------------------------------------------------------------------------

test('avatar interact debits AP and adds intrusionStrength to progress', () => {
  const world = makeWorld();
  const avatar = makeAvatar();
  const node = makeNode(3);
  world.addEntity(avatar);
  world.addEntity(node);

  const result = node.interact(world, avatar);
  assert.equal(result.ok, true);
  assert.equal(avatar.ap, avatar.maxAp - AP_COST.INTERACT);
  assert.equal(node.sliceProgress, 2);
  assert.equal(node.sliced, false, 'below threshold stays unsliced');
  assert.match(result.message, /2\s*\/\s*3/, 'message reports intrusion progress');
});

test('reaching the threshold slices the node', () => {
  const world = makeWorld();
  const avatar = makeAvatar();
  const node = makeNode(3);
  world.addEntity(avatar);
  world.addEntity(node);

  node.interact(world, avatar);
  const result = node.interact(world, avatar);
  assert.equal(result.ok, true);
  assert.equal(node.sliceProgress, 4, 'progress is raw, not clamped');
  assert.equal(node.sliced, true);
  assert.equal(node.secured, true);
  assert.equal(node.armed, false);
  assert.match(result.message, /sliced/i);
});

test('an already-sliced node refuses without burning AP', () => {
  const world = makeWorld();
  const avatar = makeAvatar(1, 1, 4);
  const node = makeNode(3);
  world.addEntity(avatar);
  world.addEntity(node);

  assert.equal(node.interact(world, avatar).ok, true);
  assert.equal(node.sliced, true);
  const apBefore = avatar.ap;
  const repeat = node.interact(world, avatar);
  assert.equal(repeat.ok, false);
  assert.equal((repeat as { reason: string }).reason, 'already-sliced');
  assert.equal(avatar.ap, apBefore);
});

test('a non-avatar is refused without burning AP — even a Decker', () => {
  const world = makeWorld();
  // The Decker carries intrusionStrength too — the sniff must be the
  // isCyberAvatar capability flag, not the stat.
  const decker = buildCrewMember('decker', { x: 1, y: 1 }, new Rng(7), { id: 'crew-decker' });
  const node = makeNode(3);
  world.addEntity(decker);
  world.addEntity(node);
  decker.refreshAp();

  const apBefore = decker.ap;
  const result = node.interact(world, decker);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'not-an-avatar');
  assert.equal(decker.ap, apBefore);
  assert.equal(node.sliceProgress, 0);
});

test('standard adjacency and AP gates apply', () => {
  const world = makeWorld();
  const far = makeAvatar(5, 5);
  const node = makeNode(3);
  world.addEntity(far);
  world.addEntity(node);

  const notAdjacent = node.interact(world, far);
  assert.equal(notAdjacent.ok, false);
  assert.equal((notAdjacent as { reason: string }).reason, 'not-adjacent');

  const broke = makeAvatar(2, 2);
  broke.spendAp(broke.ap);
  const noAp = node.interact(world, broke);
  assert.equal(noAp.ok, false);
  assert.equal((noAp as { reason: string }).reason, 'insufficient-ap');
});
