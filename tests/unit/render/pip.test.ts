import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { FACTION } from '../../../src/game/constants.js';
import {
  pipCameraFor,
  pipChrome,
  pipFeedFor,
  pipMeatFollow,
  pipViewport,
  pipWorldOf,
  pipFollowTargetOf,
  shouldShowPip,
  PIP_VIEWPORT_TILES,
} from '../../../src/render/pip.js';

function makeEntity(id: string, x: number, y: number, hp = 5, maxHp = 8) {
  const grid = new Grid(28, 18);
  const world = new World(grid);
  const ent = new Entity({ id, x, y, faction: FACTION.PLAYER, glyph: '@', maxHp });
  ent.hp = hp;
  world.addEntity(ent);
  return { world, ent };
}

/** A dual-deploy run viewing Cyberspace: PIP should show the meat feed. */
function viewingCyber() {
  const { world: meatWorld, ent: body } = makeEntity('body', 5, 6);
  const { world: cyberWorld, ent: avatar } = makeEntity('avatar', 10, 4, 6, 6);
  const partner = new Entity({
    id: 'partner',
    x: 7,
    y: 8,
    faction: FACTION.PLAYER,
    glyph: 'R',
    maxHp: 6,
  });
  meatWorld.addEntity(partner);
  return {
    cyberspace: { phase: 'active' as const, layer: { world: cyberWorld, avatar } },
    world: meatWorld,
    player: body,
    partnerMember: partner,
    activeLayer: 'cyber' as const,
    body,
    avatar,
    partner,
  };
}

test('pipFeedFor renders the inactive layer (opposite of the active view)', () => {
  const run = viewingCyber();
  assert.equal(pipFeedFor(run), 'meat');
  assert.equal(pipFeedFor({ ...run, activeLayer: 'meat' }), 'cyber');
  // Solo / legacy (no activeLayer) defaults to the meat feed, as in M3.7.
  assert.equal(pipFeedFor({ ...run, activeLayer: undefined }), 'meat');
  assert.equal(pipFeedFor({ ...run, cyberspace: { phase: 'dormant' } }), null);
  assert.equal(pipFeedFor(null), null);
});

test('shouldShowPip requires the inactive layer to have a world and operator', () => {
  const run = viewingCyber();
  assert.equal(shouldShowPip(run), true);
  assert.equal(shouldShowPip({ ...run, activeLayer: 'meat' }), true);
  assert.equal(shouldShowPip({ ...run, cyberspace: { phase: 'dormant' } }), false);
  assert.equal(shouldShowPip({ ...run, world: null }), false);
  assert.equal(shouldShowPip(null), false);
});

test('viewing cyber: PIP follows the meat feed (living partner over the body)', () => {
  const run = viewingCyber();
  assert.equal(pipWorldOf(run), run.world);
  assert.equal(pipFollowTargetOf(run), run.partner);
});

test('viewing cyber: PIP falls back to the Decker body once the partner flatlines', () => {
  const run = viewingCyber();
  run.partner.alive = false;
  assert.equal(pipMeatFollow(run), run.body);
  assert.equal(pipFollowTargetOf(run), run.body);
});

test('solo Decker (no partner): meat feed follows the body', () => {
  const run = viewingCyber();
  const solo = { ...run, partnerMember: null };
  assert.equal(pipFollowTargetOf(solo), solo.body);
});

test('viewing meat: PIP shows the cyber grid and follows the avatar', () => {
  const run = { ...viewingCyber(), activeLayer: 'meat' as const };
  assert.equal(pipWorldOf(run), run.cyberspace.layer.world);
  assert.equal(pipFollowTargetOf(run), run.avatar);
});

test('pipViewport matches pip canvas tile footprint', () => {
  assert.deepEqual(pipViewport(), PIP_VIEWPORT_TILES);
});

test('pipCameraFor centers on the followed operator', () => {
  const { world, ent } = makeEntity('body', 14, 9);
  const camera = pipCameraFor(ent, world);
  assert.equal(camera.width, 16);
  assert.equal(camera.height, 10);
  assert.equal(camera.x, ent.x - Math.floor(16 / 2));
  assert.equal(camera.y, ent.y - Math.floor(10 / 2));
});

test('pipCameraFor clamps near map edges', () => {
  const { world, ent } = makeEntity('body', 1, 1);
  const camera = pipCameraFor(ent, world);
  assert.equal(camera.x, 0);
  assert.equal(camera.y, 0);
});

test('pipChrome labels the meat feed by followed operator', () => {
  const run = viewingCyber();
  const partnerRows = pipChrome(run);
  assert.equal(partnerRows[0]?.text, '// CCTV //');
  assert.match(partnerRows[1]?.text ?? '', /^PARTNER /);

  run.partner.alive = false;
  const bodyRows = pipChrome(run);
  assert.match(bodyRows[1]?.text ?? '', /^BODY /);
});

test('pipChrome labels the cyber feed on two rows (GRID caption, RAM vitals)', () => {
  const run = { ...viewingCyber(), activeLayer: 'meat' as const };
  const rows = pipChrome(run);
  assert.equal(rows[0]?.text, '// GRID //');
  assert.equal(rows[0]?.anchor, 'top-left');
  assert.equal(rows[0]?.row, 0);
  assert.match(rows[1]?.text ?? '', /^RAM /);
  assert.equal(rows[1]?.anchor, 'top-right');
  assert.equal(rows[1]?.row, 3);
});

test('pipChrome stacks meat feed caption and vitals on separate rows', () => {
  const run = viewingCyber();
  const rows = pipChrome(run);
  assert.equal(rows[0]?.row, 0);
  assert.equal(rows[1]?.row, 3);
});
