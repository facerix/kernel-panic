import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Entity } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { Hostile } from '../../../src/game/Hostile.js';
import { World } from '../../../src/game/World.js';
import { CorpDrone } from '../../../src/game/ai/CorpDrone.js';
import { FACTION } from '../../../src/game/constants.js';
import type { Rng } from '../../../src/rng.js';

class TestHostile extends Hostile {
  override takeTurn(_world: World, _rng: Rng) {
    return [];
  }
}

const makeHostile = (overrides = {}) =>
  new TestHostile({
    id: 'h',
    x: 1,
    y: 1,
    faction: FACTION.CORP,
    glyph: 'h',
    ...overrides,
  });

test('Hostile extends Entity and CorpDrone extends Hostile', () => {
  const hostile = makeHostile();
  const drone = new CorpDrone({ id: 'd', x: 2, y: 2 });

  assert.ok(hostile instanceof Entity);
  assert.ok(drone instanceof Hostile);
  assert.ok(drone instanceof Entity);
});

test('Hostile.acquireTarget selects the nearest visible different-faction entity', () => {
  const world = new World(new Grid(12, 6));
  const hostile = makeHostile({ x: 1, y: 1 });
  const farTarget = new Entity({ id: 'far', x: 8, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  const nearTarget = new Entity({ id: 'near', x: 3, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  const teammate = new Entity({ id: 'ally', x: 2, y: 1, faction: FACTION.CORP, glyph: 'a' });

  world.addEntity(hostile);
  world.addEntity(farTarget);
  world.addEntity(nearTarget);
  world.addEntity(teammate);

  assert.equal(hostile.acquireTarget(world), nearTarget);
});

test('Hostile.acquireTarget honours stealth spotting rules', () => {
  const world = new World(new Grid(12, 6));
  const hostile = makeHostile({ x: 1, y: 1 });
  const target = new Entity({ id: 'p', x: 4, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  target.stealthed = true;

  world.addEntity(hostile);
  world.addEntity(target);

  assert.equal(hostile.acquireTarget(world), null);
  target.x = 2;
  assert.equal(hostile.acquireTarget(world), target);
});

test('Hostile rejects an invalid sightRange', () => {
  assert.throws(() => makeHostile({ sightRange: -1 }), RangeError);
  assert.throws(() => makeHostile({ sightRange: 1.5 }), RangeError);
});
