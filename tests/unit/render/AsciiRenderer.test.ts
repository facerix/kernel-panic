import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AsciiRenderer } from '../../../src/render/AsciiRenderer.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { FACTION } from '../../../src/game/constants.js';

type DrawCall = {
  op: 'rect' | 'text';
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  char?: string;
  px?: number;
  py?: number;
  fillStyle: string;
  shadowColor?: string;
  font?: string;
  textAlign?: string;
};
type TestCanvas = HTMLCanvasElement & { _drawCalls: DrawCall[] };

/**
 * Minimal canvas + 2D-context stub. Records every text draw so tests can
 * inspect (a) how many full frames have been drawn and (b) which flash
 * overlays got painted on top. We don't need pixel fidelity — only the
 * sequence of calls.
 */
function makeCanvas(): TestCanvas {
  const drawCalls: DrawCall[] = [];
  const ctx = {
    fillStyle: '',
    shadowBlur: 0,
    shadowColor: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect(x: number, y: number, w: number, h: number) {
      drawCalls.push({ op: 'rect', x, y, w, h, fillStyle: ctx.fillStyle });
    },
    fillText(char: string, px: number, py: number) {
      drawCalls.push({
        op: 'text',
        char,
        px,
        py,
        fillStyle: ctx.fillStyle,
        shadowColor: ctx.shadowColor,
        font: ctx.font,
        textAlign: ctx.textAlign,
      });
    },
    measureText: (text: string) => ({ width: String(text).length * 7 }),
    save: () => {},
    restore: () => {},
  };
  return {
    width: 640,
    height: 400,
    getContext: () => ctx,
    _drawCalls: drawCalls,
  } as unknown as TestCanvas;
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
  // @ts-expect-error Runtime validation must reject a non-numeric coordinate.
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
  assert.ok(flashOp);
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
  assert.ok(chip);
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
    .find(c => c.char === c.char?.toUpperCase?.() && String(c.char).length > 1);
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
  assert.equal(phase?.px, 30);
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

test('draw() preserves recon progress tags when the objective title is long', () => {
  const canvas = makeCanvas();
  const r = new AsciiRenderer(canvas, { now: () => 0 });
  const { world, player } = makeWorld();

  r.draw(world, player, {
    combatHud: {
      cyber: false,
      objective: {
        title: 'Map the full district water board facility layout',
        done: true,
        progress: { label: 'MAP', current: 42, total: 120 },
      },
      identity: { callsign: 'Patch', archetype: 'tech', stealthed: false },
      hp: { hp: 2, maxHp: 3 },
      ap: { ap: 2, maxAp: 4 },
      turn: { currentFaction: FACTION.PLAYER, turnNumber: 12 },
    },
  });

  const textOps = canvas._drawCalls.filter(c => c.op === 'text');
  const objective = textOps.find(c => String(c.char).includes('[MAP:42/120]'));
  assert.ok(objective, 'MAP progress stays visible instead of truncating to [MAP...');
  assert.match(String(objective?.char), /\[DONE\] \[MAP:42\/120\]$/);
});

test('draw() paints structured combat HUD rows in the planned canvas corners', () => {
  const canvas = makeCanvas();
  const r = new AsciiRenderer(canvas, { now: () => 0 });
  const { world, player } = makeWorld();

  r.draw(world, player, {
    locationLabel: 'Vuong Holdings server farm',
    combatHud: {
      cyber: false,
      objective: { title: 'Sentinel window', done: false, turnsRemaining: 4 },
      identity: { callsign: 'Patch', archetype: 'tech', stealthed: true },
      hp: { hp: 2, maxHp: 3 },
      defense: { armor: 1, shield: { current: 1, capacity: 1 } },
      ap: { ap: 2, maxAp: 4 },
      turn: { currentFaction: FACTION.PLAYER, turnNumber: 12 },
    },
  });

  const textOps = canvas._drawCalls.filter(c => c.op === 'text');
  const objective = textOps.find(c => c.char === 'OBJ Sentinel window [TODO] [TURN:4]');
  const identity = textOps.find(c => c.char === 'Patch [TECH] [CLOAKED]');
  const hpPrefix = textOps.find(c => c.char === 'HP ');
  const shield = textOps.find(c => c.char === '◆');
  const armor = textOps.find(c => c.char === 'ARM 1');
  const turn = textOps.find(c => c.char === 'TURN 12');

  assert.equal(objective?.px, 6, 'objective row sits left');
  assert.equal(objective?.py, 30, 'objective row sits below the location label');
  assert.equal(identity?.px, canvas.width - 6, 'identity row sits right');
  assert.equal(identity?.py, 5, 'identity row is the top-right first row');
  assert.equal(identity?.textAlign, 'right');
  assert.equal(hpPrefix?.py, 30, 'HP row shares top-right row 1');
  assert.equal(shield?.py, 30, 'charged shield shares the HP row');
  assert.equal(armor?.py, 30, 'persistent armor shares the HP row');
  assert.equal(turn?.px, 30, 'turn row sits bottom-left clear of the canvas frame corner');
  assert.equal(turn?.py, canvas.height - 18);
});

test('draw() paints combat HUD HP and AP glyphs with per-state colors', () => {
  const canvas = makeCanvas();
  const r = new AsciiRenderer(canvas, { now: () => 0 });
  const { world, player } = makeWorld();
  const GLOW_COLOR = '#6ae8c8';
  const CORP_COLOR = '#ff7a66';

  r.draw(world, player, {
    combatHud: {
      cyber: false,
      objective: { title: 'Sentinel window', done: false },
      identity: { callsign: 'Patch', archetype: 'tech', stealthed: false },
      hp: { hp: 1, maxHp: 3 },
      defense: { armor: 1, shield: { current: 0, capacity: 1 } },
      ap: { ap: 2, maxAp: 4 },
      turn: { currentFaction: FACTION.CORP, turnNumber: 12 },
    },
  });

  const textOps = canvas._drawCalls.filter(c => c.op === 'text');
  const hpGlyphs = textOps.filter(c => (c.char === '□' || c.char === '■') && c.py === 30);
  assert.deepEqual(
    hpGlyphs.map(c => [c.char, c.fillStyle]),
    [
      ['□', GLOW_COLOR],
      ['□', GLOW_COLOR],
      ['■', GLOW_COLOR],
    ]
  );

  const spentShield = textOps.find(c => c.char === '◇' && c.py === 30);
  const armor = textOps.find(c => c.char === 'ARM 1' && c.py === 30);
  assert.ok(spentShield, 'spent shield remains visible as an empty diamond');
  assert.ok(armor, 'armor remains a numeric modifier rather than a pip');

  const apGlyphs = textOps.filter(c => (c.char === '○' || c.char === '●') && c.py === 55);
  assert.deepEqual(
    apGlyphs.map(c => [c.char, c.fillStyle]),
    [
      ['○', GLOW_COLOR],
      ['○', GLOW_COLOR],
      ['●', GLOW_COLOR],
      ['●', GLOW_COLOR],
    ]
  );

  const corpTurn = textOps.find(c => c.char === 'HOSTILES ACTIVE');
  assert.equal(corpTurn?.fillStyle, CORP_COLOR);
});

test('draw() omits combat HUD rows when combatHud is null', () => {
  const canvas = makeCanvas();
  const r = new AsciiRenderer(canvas, { now: () => 0 });
  const { world, player } = makeWorld();

  r.draw(world, player, { combatHud: null });

  const hudText = canvas._drawCalls
    .filter(c => c.op === 'text')
    .filter(c =>
      ['OBJ ', 'HP ', 'TURN', 'HOSTILES'].some(prefix => String(c.char).startsWith(prefix))
    );
  assert.equal(hudText.length, 0);
});

test('draw() with an explicit camera offsets the map relative to followTarget', () => {
  const canvas = makeCanvas();
  const r = new AsciiRenderer(canvas, { now: () => 0, cellSize: 10 });
  const { world, player } = makeWorld();

  r.draw(world, player, {
    camera: { x: player.x - 2, y: player.y - 2, width: 6, height: 4 },
  });
  const playerGlyph = canvas._drawCalls.find(c => c.op === 'text' && c.char === '@');
  assert.ok(playerGlyph);
  // Player is at world (16,10); camera top-left (14,8) → screen cell (2,2) → px center 25,25.
  assert.equal(playerGlyph.px, 25);
  assert.equal(playerGlyph.py, 25);
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
