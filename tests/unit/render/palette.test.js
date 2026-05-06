import { test } from 'node:test';
import assert from 'node:assert/strict';

import { glyphForTile, glyphForEntity, OOB_GLYPH } from '../../../src/render/palette.js';
import { TILE, FACTION } from '../../../src/game/constants.js';
import { Entity } from '../../../src/game/Entity.js';

test('glyphForTile maps every defined tile to a glyph', () => {
  for (const tile of Object.values(TILE)) {
    const g = glyphForTile(tile);
    assert.ok(g && typeof g.char === 'string' && g.char.length === 1, `tile ${tile} -> ${JSON.stringify(g)}`);
    assert.ok(typeof g.fg === 'string' && g.fg.startsWith('#'), `tile ${tile} fg should be a hex colour`);
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
