import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AsciiRenderer } from '../../../src/render/AsciiRenderer.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { FACTION } from '../../../src/game/constants.js';

/**
 * Minimal canvas + 2D-context stub. Records every text draw so tests can
 * inspect (a) how many full frames have been drawn and (b) which flash
 * overlays got painted on top. We don't need pixel fidelity — only the
 * sequence of calls.
 */
function makeCanvas() {
  const drawCalls = [];
  const ctx = {
    fillStyle: '',
    shadowBlur: 0,
    shadowColor: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: () => drawCalls.push({ op: 'rect' }),
    fillText(char, px, py) {
      drawCalls.push({ op: 'text', char, px, py, fillStyle: ctx.fillStyle, font: ctx.font });
    },
    save: () => {},
    restore: () => {},
  };
  return {
    width: 640,
    height: 400,
    getContext: () => ctx,
    _drawCalls: drawCalls,
  };
}

/** A tiny world: 32×20 grid with a player at (16, 10) so the camera centers. */
function makeWorld() {
  const grid = new Grid(32, 20);
  const world = new World(grid);
  const player = new Entity({ id: 'p', x: 16, y: 10, faction: FACTION.PLAYER, glyph: '@' });
  world.addEntity(player);
  return { world, player };
}

test('flashCell rejects non-integer coords', () => {
  const r = new AsciiRenderer(makeCanvas(), { now: () => 0 });
  assert.throws(() => r.flashCell(1.5, 0), /integers/);
  assert.throws(() => r.flashCell(0, 'x'), /integers/);
});

test('flashCell rejects negative or non-finite duration', () => {
  const r = new AsciiRenderer(makeCanvas(), { now: () => 0 });
  assert.throws(() => r.flashCell(0, 0, { duration: -1 }), /non-negative/);
  assert.throws(() => r.flashCell(0, 0, { duration: NaN }), /non-negative/);
});

test('flashCell registers a flash with a future expiry', () => {
  const r = new AsciiRenderer(makeCanvas(), { now: () => 1000 });
  r.flashCell(5, 5, { duration: 100 });
  assert.equal(r.activeFlashes.length, 1);
  assert.equal(r.activeFlashes[0].expiresAt, 1100);
});

test('draw() paints registered flashes on top of the regular frame', () => {
  const canvas = makeCanvas();
  let t = 0;
  const r = new AsciiRenderer(canvas, { now: () => t });
  const { world, player } = makeWorld();

  // No flash yet — draw and snapshot how many text ops happened.
  r.draw(world, player);
  const baselineTextOps = canvas._drawCalls.filter(c => c.op === 'text').length;

  // Register a flash on the player's tile and re-draw.
  canvas._drawCalls.length = 0;
  r.flashCell(player.x, player.y, { duration: 100, char: '*', color: '#abcdef' });
  r.draw(world, player);
  const textOps = canvas._drawCalls.filter(c => c.op === 'text');
  assert.equal(textOps.length, baselineTextOps + 1, 'one extra text op for the flash overlay');
  // The last text op should be the flash overlay (drawn after the frame).
  const flashOp = textOps.at(-1);
  assert.equal(flashOp.char, '*');
  assert.equal(flashOp.fillStyle, '#abcdef');
});

test('draw() drops flashes whose expiry has passed', () => {
  const canvas = makeCanvas();
  let t = 0;
  const r = new AsciiRenderer(canvas, { now: () => t });
  const { world, player } = makeWorld();

  r.flashCell(player.x, player.y, { duration: 100, char: '*' });
  t = 50;
  r.draw(world, player);
  assert.equal(r.activeFlashes.length, 1, 'flash still active mid-window');

  t = 200;
  canvas._drawCalls.length = 0;
  r.draw(world, player);
  assert.equal(r.activeFlashes.length, 0, 'expired flash should be filtered out');
  const flashOps = canvas._drawCalls.filter(c => c.op === 'text' && c.char === '*');
  assert.equal(flashOps.length, 0, 'no flash overlay should paint after expiry');
});

test('flashes outside the camera are silently skipped (but stay registered)', () => {
  const canvas = makeCanvas();
  const r = new AsciiRenderer(canvas, { now: () => 0 });
  const { world, player } = makeWorld();
  r.draw(world, player); // establishes camera centred on player
  canvas._drawCalls.length = 0;

  // 100 tiles east — well outside any sane camera viewport.
  r.flashCell(player.x + 100, player.y, { duration: 1000, char: '*' });
  r.draw(world, player);
  const flashOps = canvas._drawCalls.filter(c => c.op === 'text' && c.char === '*');
  assert.equal(flashOps.length, 0, 'off-camera flash should not paint');
  assert.equal(r.activeFlashes.length, 1, 'but the entry should still be tracked until expiry');
});
