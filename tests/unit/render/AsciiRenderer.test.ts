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
    fillRect(x, y, w, h) {
      drawCalls.push({ op: 'rect', x, y, w, h, fillStyle: ctx.fillStyle });
    },
    fillText(char, px, py) {
      drawCalls.push({
        op: 'text',
        char,
        px,
        py,
        fillStyle: ctx.fillStyle,
        font: ctx.font,
        textAlign: ctx.textAlign,
      });
    },
    measureText: text => ({ width: String(text).length * 7 }),
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

test('draw() paints the location chip (uppercased) on top when a label is given', () => {
  const canvas = makeCanvas();
  const r = new AsciiRenderer(canvas, { now: () => 0 });
  const { world, player } = makeWorld();

  r.draw(world, player, { locationLabel: 'Vuong Holdings server farm' });
  const textOps = canvas._drawCalls.filter(c => c.op === 'text');
  const chip = textOps.at(-1);
  assert.equal(chip.char, 'VUONG HOLDINGS SERVER FARM', 'chip painted last, uppercased');
  assert.equal(chip.px, 6, 'chip sits in the top-left padding');
});

test('draw() omits the location chip when no label is supplied', () => {
  const canvas = makeCanvas();
  const r = new AsciiRenderer(canvas, { now: () => 0 });
  const { world, player } = makeWorld();

  r.draw(world, player);
  const chip = canvas._drawCalls
    .filter(c => c.op === 'text')
    .find(c => c.char === c.char?.toUpperCase?.() && c.char.length > 1);
  assert.equal(chip, undefined, 'no multi-char label text op without a locationLabel');
});

test('draw() paints generic HUD rows with left and right anchoring', () => {
  const canvas = makeCanvas();
  const r = new AsciiRenderer(canvas, { now: () => 0 });
  const { world, player } = makeWorld();

  r.draw(world, player, {
    hudRows: [
      { text: 'OBJ Sentinel [TODO]', anchor: 'top-left', row: 1 },
      { text: 'Patch [TECH]', anchor: 'top-right', row: 0 },
    ],
  });

  const textOps = canvas._drawCalls.filter(c => c.op === 'text');
  const objective = textOps.find(c => c.char === 'OBJ Sentinel [TODO]');
  const identity = textOps.find(c => c.char === 'Patch [TECH]');
  assert.equal(objective?.px, 6, 'top-left row uses left padding');
  assert.equal(objective?.py, 30, 'row 1 sits below the location row band');
  assert.equal(objective?.textAlign, 'left');
  assert.equal(identity?.px, canvas.width - 6, 'top-right row uses right padding');
  assert.equal(identity?.py, 5, 'top-right row 0 starts at the top band');
  assert.equal(identity?.textAlign, 'right');

  const identityWidth = 'Patch [TECH]'.length * 7 + 12;
  const identityBacking = canvas._drawCalls.find(
    c => c.op === 'rect' && c.x === canvas.width - identityWidth && c.y === 0
  );
  assert.ok(identityBacking, 'right-anchored backing box should hug the canvas edge');
});

test('draw() anchors bottom HUD rows from the bottom edge', () => {
  const canvas = makeCanvas();
  const r = new AsciiRenderer(canvas, { now: () => 0 });
  const { world, player } = makeWorld();

  r.draw(world, player, {
    hudRows: [{ text: 'HOSTILES ACTIVE', anchor: 'bottom-left', row: 0 }],
  });

  const phase = canvas._drawCalls
    .filter(c => c.op === 'text')
    .find(c => c.char === 'HOSTILES ACTIVE');
  assert.equal(phase?.px, 6);
  assert.equal(phase?.py, canvas.height - 18, 'bottom row text sits inside the bottom band');
});

test('draw() truncates HUD rows to their max width before measuring the backing box', () => {
  const canvas = makeCanvas();
  const r = new AsciiRenderer(canvas, { now: () => 0 });
  const { world, player } = makeWorld();

  r.draw(world, player, {
    hudRows: [{ text: 'OBJECTIVE TITLE THAT WILL NOT FIT', anchor: 'top-left', maxWidth: 82 }],
  });

  const textOps = canvas._drawCalls.filter(c => c.op === 'text');
  const row = textOps.find(c => String(c.char).startsWith('OBJECTI'));
  assert.equal(row?.char, 'OBJECTI...');
  const backing = canvas._drawCalls.find(
    c => c.op === 'rect' && c.x === 0 && c.y === 0 && c.fillStyle === 'rgba(6, 9, 10, 0.72)'
  );
  assert.equal(backing?.w, 82, 'backing width matches the configured row max');
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
