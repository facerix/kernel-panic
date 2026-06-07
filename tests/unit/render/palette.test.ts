import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  glyphForTile,
  glyphForEntity,
  glyphForCorpse,
  CORPSE_GLYPH_CHAR,
  CORPSE_DIM,
  MEMORY_DIM,
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

test('glyphForTile without principalId keeps the default terrain colours', () => {
  assert.equal(glyphForTile(TILE.FLOOR).fg, '#1f4d44');
  assert.equal(glyphForTile(TILE.WALL).fg, '#5fbcd4');
  assert.equal(glyphForTile(TILE.COVER).fg, '#d49a3a');
  assert.equal(glyphForTile(TILE.RUBBLE).fg, '#5fbcd4');
});

test('glyphForTile with principalId tints floor/wall/cover; rubble follows wall', () => {
  const floor = glyphForTile(TILE.FLOOR, 'chrome-choir');
  const wall = glyphForTile(TILE.WALL, 'chrome-choir');
  const rubble = glyphForTile(TILE.RUBBLE, 'chrome-choir');
  assert.notEqual(floor.fg, '#1f4d44');
  assert.equal(rubble.fg, wall.fg);
  assert.equal(glyphForTile(TILE.EXIT, 'chrome-choir').fg, '#eed5fa', 'exit stays global');
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

test('a RIVAL hostile shares the role glyph but renders a distinct allegiance hue', () => {
  // Same archetype (skirmisher 'k'), different allegiance → same char, different fg.
  const corp = new Entity({ id: 'drone-0', x: 0, y: 0, faction: FACTION.CORP, glyph: 'k' });
  const rival = new Entity({ id: 'drone-1', x: 0, y: 0, faction: FACTION.RIVAL, glyph: 'k' });

  assert.equal(
    glyphForEntity(corp).char,
    glyphForEntity(rival).char,
    'glyph encodes role, not side'
  );
  assert.notEqual(
    glyphForEntity(corp).fg,
    glyphForEntity(rival).fg,
    'allegiance must read by colour'
  );
});

test('glyphForCorpse preserves the rival allegiance hue (dimmed)', () => {
  const rival = new Entity({ id: 'drone-1', x: 0, y: 0, faction: FACTION.RIVAL, glyph: 'k' });
  const corpse = glyphForCorpse(rival);
  assert.equal(corpse.char, CORPSE_GLYPH_CHAR);
  // Dimmed rival hue stays distinct from a dimmed corp hue.
  const corp = new Entity({ id: 'drone-0', x: 0, y: 0, faction: FACTION.CORP, glyph: 'k' });
  assert.notEqual(corpse.fg, glyphForCorpse(corp).fg);
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

test('glyphForCorpse uses the corpse char and dims the faction colour', () => {
  const drone = new Entity({ id: 'd', x: 0, y: 0, faction: FACTION.CORP, glyph: 'd' });
  const c = glyphForCorpse(drone);
  assert.equal(c.char, CORPSE_GLYPH_CHAR);
  // Same hue as the live glyph (so factions read), just dimmed.
  const live = glyphForEntity(drone).fg;
  assert.equal(c.fg, dimColor(live, CORPSE_DIM));
  assert.notEqual(c.fg, live, 'corpse must be visibly dimmer than the live glyph');
});

test('glyphForCorpse uses the corpse char even when the entity glyph differs', () => {
  // The entity might be a Merc with glyph "@"; corpses are still "%".
  const merc = new Entity({ id: 'm', x: 0, y: 0, faction: FACTION.PLAYER, glyph: '@' });
  assert.equal(glyphForCorpse(merc).char, CORPSE_GLYPH_CHAR);
});

test('glyphForCorpse throws on an unknown faction', () => {
  const ghost = new Entity({ id: 'g', x: 0, y: 0, faction: 'mystery', glyph: '?' });
  assert.throws(() => glyphForCorpse(ghost), /unknown faction/i);
});

test('CORPSE_DIM sits between MEMORY_DIM and full brightness', () => {
  // Corpses are currently observed (not memory), so they should be brighter
  // than remembered terrain. Sanity check on the relative tuning — if these
  // ever invert, a corpse would read as more "ghostly" than the floor under
  // it, which defeats the point.
  assert.ok(
    CORPSE_DIM > MEMORY_DIM,
    `CORPSE_DIM (${CORPSE_DIM}) must exceed MEMORY_DIM (${MEMORY_DIM})`
  );
  assert.ok(CORPSE_DIM < 1, 'CORPSE_DIM must dim something');
});
