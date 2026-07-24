import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { TILE, FACTION } from '../../../src/game/constants.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { VisionField } from '../../../src/game/Vision.js';

test('VisionField marks the viewer tile and adjacent open floor as visible', () => {
  const g = new Grid(8, 8);
  const v = new VisionField();
  v.recompute(g, { x: 4, y: 4 }, 3);
  assert.equal(v.isVisible(4, 4), true, 'viewer tile');
  assert.equal(v.isVisible(5, 4), true, 'east neighbour');
  assert.equal(v.isVisible(5, 5), true, 'diagonal neighbour');
});

test('VisionField range cap leaves far cells invisible', () => {
  const g = new Grid(20, 20);
  const v = new VisionField();
  v.recompute(g, { x: 10, y: 10 }, 3);
  assert.equal(v.isVisible(15, 10), false, '5 east of viewer with range 3');
});

test('VisionField does not see past a wall', () => {
  const g = new Grid(10, 10);
  // Build a vertical wall at x=4.
  for (let y = 0; y < 10; y++) g.setTile(4, y, TILE.WALL);
  const v = new VisionField();
  v.recompute(g, { x: 2, y: 5 }, 8);
  // The wall surface is visible — that's how the player sees the room edge.
  // What we care about is that nothing *past* the wall leaks through.
  assert.equal(v.isVisible(4, 5), true, 'wall surface visible');
  assert.equal(v.isVisible(5, 5), false, 'first tile past the wall hidden');
  assert.equal(v.isVisible(6, 5), false, 'second tile past the wall hidden');
});

test('VisionField sees through cover (cover does not block sight)', () => {
  const g = new Grid(10, 10);
  g.setTile(4, 5, TILE.COVER);
  const v = new VisionField();
  v.recompute(g, { x: 2, y: 5 }, 8);
  assert.equal(v.isVisible(6, 5), true, 'cover passes sight through');
});

test('VisionField.seen accumulates across recomputes (memory persists)', () => {
  const g = new Grid(10, 10);
  const v = new VisionField();
  v.recompute(g, { x: 1, y: 1 }, 2);
  assert.equal(v.hasSeen(2, 1), true);

  v.recompute(g, { x: 8, y: 8 }, 2);
  assert.equal(v.isVisible(2, 1), false, 'no longer in LOS');
  assert.equal(v.hasSeen(2, 1), true, 'still remembered');
});

test('VisionField.recompute clears stale visibility but keeps memory', () => {
  const g = new Grid(10, 10);
  const v = new VisionField();
  v.recompute(g, { x: 1, y: 1 }, 2);
  v.recompute(g, { x: 8, y: 8 }, 2);
  assert.equal(v.visible.has('2,1'), false, 'old visible entries dropped');
});

test('VisionField rejects an out-of-bounds viewer (data-corruption guard)', () => {
  const g = new Grid(5, 5);
  const v = new VisionField();
  assert.throws(() => v.recompute(g, { x: -1, y: 0 }, 3), RangeError);
  assert.throws(() => v.recompute(g, { x: 5, y: 5 }, 3), RangeError);
});

test('VisionField rejects a negative range', () => {
  const g = new Grid(5, 5);
  const v = new VisionField();
  assert.throws(() => v.recompute(g, { x: 2, y: 2 }, -1), RangeError);
});

// --- M3: corpse memorisation -----------------------------------------------

test('VisionField.memoriseCorpse stores a glyph record at the corpse key', () => {
  const v = new VisionField();
  const corpse = { x: 4, y: 3, faction: FACTION.CORP, glyph: '%' };
  v.memoriseCorpse(corpse);
  assert.ok(v.memorisedCorpses.has('4,3'), 'corpse key should be memorised');
  const rec = v.memorisedCorpses.get('4,3');
  assert.ok(rec);
  assert.equal(rec.x, 4);
  assert.equal(rec.y, 3);
  assert.equal(rec.faction, FACTION.CORP);
});

test('VisionField.clearCorpseMemory wipes all memorised corpses', () => {
  const v = new VisionField();
  v.memoriseCorpse({ x: 1, y: 1, faction: FACTION.CORP, glyph: '%' });
  v.memoriseCorpse({ x: 2, y: 3, faction: FACTION.CORP, glyph: '%' });
  assert.equal(v.memorisedCorpses.size, 2);
  v.clearCorpseMemory();
  assert.equal(v.memorisedCorpses.size, 0);
});

test('VisionField.forgetCorpse drops a single memorised corpse', () => {
  const v = new VisionField();
  const corpse = { x: 4, y: 3, faction: FACTION.CORP, glyph: '%' };
  v.memoriseCorpse(corpse);
  v.memoriseCorpse({ x: 1, y: 1, faction: FACTION.CORP, glyph: '%' });
  v.forgetCorpse(corpse);
  assert.equal(v.memorisedCorpses.size, 1);
  assert.ok(!v.memorisedCorpses.has('4,3'));
  assert.ok(v.memorisedCorpses.has('1,1'));
});

test('VisionField.resetFogState clears visible, seen, and memorised corpses', () => {
  const g = new Grid(8, 8);
  const viewer = new Entity({ id: 'p', x: 2, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const v = new VisionField();
  v.recompute(g, viewer, 4);
  v.memoriseCorpse({ x: 5, y: 5, faction: FACTION.CORP, glyph: '%' });
  assert.ok(v.visible.size > 0);
  assert.ok(v.seen.size > 0);
  assert.equal(v.memorisedCorpses.size, 1);
  v.resetFogState();
  assert.equal(v.visible.size, 0);
  assert.equal(v.seen.size, 0);
  assert.equal(v.memorisedCorpses.size, 0);
});

test('VisionField does not see past an entity blocker on the line', () => {
  // M4 review fix: a body on the line breaks the sightline, just like a wall.
  const g = new Grid(10, 10);
  const w = new World(g);
  const viewer = new Entity({ id: 'p', x: 1, y: 5, faction: FACTION.PLAYER, glyph: '@' });
  const blocker = new Entity({ id: 'h', x: 4, y: 5, faction: FACTION.NEUTRAL, glyph: 'h' });
  w.addEntity(viewer);
  w.addEntity(blocker);
  const v = new VisionField();
  v.recompute(g, viewer, 8, { blockers: w.blockerKeys() });

  assert.equal(v.isVisible(4, 5), true, 'blocker tile itself is visible');
  assert.equal(v.isVisible(5, 5), false, 'tile past the blocker is hidden');
  assert.equal(v.isVisible(7, 5), false, 'still hidden further past');
});
