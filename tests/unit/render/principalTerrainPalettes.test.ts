import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TERRAIN_PALETTE,
  terrainPaletteFor,
} from '../../../src/render/principalTerrainPalettes.js';
import { glyphForTile } from '../../../src/render/palette.js';
import { TILE } from '../../../src/game/constants.js';
import { CONTRACT_LEXICON } from '../../../src/game/hub/Curator.js';

const HEX = /^#[0-9a-f]{6}$/i;

/** Relative luminance (sRGB) for contrast ordering checks. */
function luminance(hex: string): number {
  const parse = (pair: string) => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = parse(hex.slice(1, 3));
  const g = parse(hex.slice(3, 5));
  const b = parse(hex.slice(5, 7));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Run `fn` with `console.warn` captured; returns the collected arg-lists. */
function captureWarnings(fn: () => void): unknown[][] {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

test('every lexicon principal has a curated terrain palette', () => {
  const warnings = captureWarnings(() => {
    for (const principal of CONTRACT_LEXICON.principals) {
      const palette = terrainPaletteFor(principal.id);
      assert.notDeepEqual(
        palette,
        DEFAULT_TERRAIN_PALETTE,
        `${principal.id} should not use the default palette`
      );
      for (const channel of ['floor', 'wall', 'cover'] as const) {
        assert.match(palette[channel], HEX, `${principal.id}.${channel} must be #rrggbb`);
      }
      assert.ok(
        luminance(palette.floor) < luminance(palette.wall),
        `${principal.id}: floor should be darker than wall`
      );
      assert.notEqual(
        palette.floor,
        palette.cover,
        `${principal.id}: cover should differ from floor`
      );
    }
  });
  assert.deepEqual(warnings, [], `unexpected fallback warnings: ${JSON.stringify(warnings)}`);
});

test('terrainPaletteFor warns and falls back for an unknown principal', () => {
  const warnings = captureWarnings(() => {
    const palette = terrainPaletteFor('unknown-principal');
    assert.deepEqual(palette, DEFAULT_TERRAIN_PALETTE);
  });
  assert.equal(warnings.length, 1);
});

test('glyphForTile: rubble fg always matches wall for a principal palette', () => {
  for (const principal of CONTRACT_LEXICON.principals) {
    const wall = glyphForTile(TILE.WALL, principal.id);
    const rubble = glyphForTile(TILE.RUBBLE, principal.id);
    assert.equal(rubble.char, '%');
    assert.equal(rubble.fg, wall.fg, `${principal.id}: rubble must inherit wall colour`);
  }
});

test('rival chrome-choir terrain differs from establishment kestrel-dynamics', () => {
  const choir = terrainPaletteFor('chrome-choir');
  const kestrel = terrainPaletteFor('kestrel-dynamics');
  const choirFloor = glyphForTile(TILE.FLOOR, 'chrome-choir').fg;
  const kestrelFloor = glyphForTile(TILE.FLOOR, 'kestrel-dynamics').fg;
  assert.notEqual(choirFloor, kestrelFloor);
  assert.notEqual(choir.wall, kestrel.wall);
});
