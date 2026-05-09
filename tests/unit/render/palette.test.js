import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  glyphForTile,
  glyphForEntity,
  OOB_GLYPH,
  UNSEEN_GLYPH,
  dimColor,
  dimGlyph,
} from '../../../src/render/palette.js';
import { TILE, FACTION } from '../../../src/game/constants.js';
import { Entity } from '../../../src/game/Entity.js';

test('glyphForTile maps every defined tile to a glyph', () => {
  for (const tile of Object.values(TILE)) {
    const g = glyphForTile(tile);
    assert.ok(
      g && typeof g.char === 'string' && g.char.length === 1,
      `tile ${tile} -> ${JSON.stringify(g)}`
    );
    assert.ok(
      typeof g.fg === 'string' && g.fg.startsWith('#'),
      `tile ${tile} fg should be a hex colour`
    );
  }
});

test('glyphForTile throws on an unknown tile id (crash over silent fallback)', () => {
  assert.throws(() => glyphForTile(99), /unknown tile/i);
});

test('glyphForEntity uses the entity glyph and a faction-derived colour', () => {
  const player = new Entity({ id: 'p', x: 0, y: 0, faction: FACTION.PLAYER, glyph: '@' });
  const drone = new Entity({ id: 'd', x: 0, y: 0, faction: FACTION.CORP, glyph: 'd' });
  const civ = new Entity({ id: 'c', x: 0, y: 0, faction: FACTION.NEUTRAL, glyph: 'h' });

  assert.equal(glyphForEntity(player).char, '@');
  assert.equal(glyphForEntity(drone).char, 'd');
  assert.equal(glyphForEntity(civ).char, 'h');

  // Different factions must render in distinguishable colours, otherwise the
  // player can't tell friend from foe at a glance.
  const colours = new Set([
    glyphForEntity(player).fg,
    glyphForEntity(drone).fg,
    glyphForEntity(civ).fg,
  ]);
  assert.equal(colours.size, 3, 'each faction should have a distinct foreground colour');
});

test('glyphForEntity throws on an unknown faction', () => {
  const ghost = new Entity({ id: 'g', x: 0, y: 0, faction: 'unknown-faction', glyph: '?' });
  assert.throws(() => glyphForEntity(ghost), /unknown faction/i);
});

test('OOB_GLYPH is well-formed', () => {
  assert.ok(OOB_GLYPH && typeof OOB_GLYPH.char === 'string' && OOB_GLYPH.char.length === 1);
  assert.ok(typeof OOB_GLYPH.fg === 'string');
});

test('UNSEEN_GLYPH is well-formed and uses a paintable sentinel char', () => {
  // Must NOT be a space — AsciiRenderer's "skip space" branch would drop
  // the foreground and the never-seen color would be invisible (M4 review).
  assert.ok(UNSEEN_GLYPH && typeof UNSEEN_GLYPH.char === 'string');
  assert.equal(UNSEEN_GLYPH.char.length, 1);
  assert.notEqual(UNSEEN_GLYPH.char, ' ', 'must paint, not get skipped');
  assert.match(UNSEEN_GLYPH.fg, /^#[0-9a-f]{6}$/i, 'fg is a hex colour');
});

test('dimColor scales each channel by the factor', () => {
  assert.equal(dimColor('#ffffff', 0.5), '#808080');
  assert.equal(dimColor('#102030', 0.5), '#081018');
  assert.equal(dimColor('#abcdef', 1), '#abcdef');
  assert.equal(dimColor('#abcdef', 0), '#000000');
});

test('dimColor crashes on malformed input (no silent fallback)', () => {
  assert.throws(() => dimColor('not-a-colour', 0.5), /expected #rrggbb/);
  assert.throws(() => dimColor('#abc', 0.5), /expected #rrggbb/);
  assert.throws(() => dimColor('#ffffff', -0.1), RangeError);
  assert.throws(() => dimColor('#ffffff', 1.5), RangeError);
});

test('dimGlyph keeps the char and dims the fg', () => {
  const dim = dimGlyph({ char: '#', fg: '#ffffff' }, 0.5);
  assert.equal(dim.char, '#');
  assert.equal(dim.fg, '#808080');
});
