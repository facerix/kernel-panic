import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { FACTION } from '../../../src/game/constants.js';
import {
  pipCameraFor,
  pipChrome,
  pipViewport,
  pipWorldOf,
  pipFollowTargetOf,
  shouldShowPip,
  PIP_VIEWPORT_TILES,
} from '../../../src/render/pip.js';

function makeBody(x: number, y: number, hp = 5, maxHp = 8) {
  const grid = new Grid(28, 18);
  const world = new World(grid);
  const body = new Entity({
    id: 'body',
    x,
    y,
    faction: FACTION.PLAYER,
    glyph: '@',
    maxHp,
    hp,
  });
  world.addEntity(body);
  return { world, body };
}

test('shouldShowPip is true only while cyberspace is active with world and player', () => {
  const run = {
    cyberspace: { phase: 'active' as const },
    world: {},
    player: {},
  };
  assert.equal(shouldShowPip(run), true);
  assert.equal(shouldShowPip({ ...run, cyberspace: { phase: 'dormant' } }), false);
  assert.equal(shouldShowPip({ ...run, cyberspace: { phase: 'resolved' } }), false);
  assert.equal(shouldShowPip({ ...run, world: null }), false);
  assert.equal(shouldShowPip(null), false);
});

test('pipWorldOf and pipFollowTargetOf gate on shouldShowPip', () => {
  const { world, body } = makeBody(5, 6);
  const active = { cyberspace: { phase: 'active' as const }, world, player: body };
  assert.equal(pipWorldOf(active), world);
  assert.equal(pipFollowTargetOf(active), body);
  assert.equal(pipWorldOf({ cyberspace: { phase: 'dormant' }, world, player: body }), null);
});

test('pipViewport matches pip canvas tile footprint', () => {
  assert.deepEqual(pipViewport(), PIP_VIEWPORT_TILES);
});

test('pipCameraFor centers on the body', () => {
  const { world, body } = makeBody(14, 9);
  const camera = pipCameraFor(body, world);
  assert.equal(camera.width, 16);
  assert.equal(camera.height, 10);
  assert.equal(camera.x, body.x - Math.floor(16 / 2));
  assert.equal(camera.y, body.y - Math.floor(10 / 2));
});

test('pipCameraFor clamps near map edges', () => {
  const { world, body } = makeBody(1, 1);
  const camera = pipCameraFor(body, world);
  assert.equal(camera.x, 0);
  assert.equal(camera.y, 0);
});

test('pipChrome labels the feed and body HP', () => {
  const { body } = makeBody(0, 0, 3, 8);
  const rows = pipChrome(body);
  assert.equal(rows[0]?.text, '// CCTV //');
  assert.equal(rows[0]?.anchor, 'top-left');
  assert.match(rows[1]?.text ?? '', /^BODY /);
  assert.equal(rows[1]?.anchor, 'top-right');
});
