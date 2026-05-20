/**
 * Terminal — the Hub's "loadout kiosk" entity. Glyph '‡', NEUTRAL faction,
 * immobile. Players `interact` adjacent to it to open <crew-roster>.
 *
 * The interact wiring lives in the shell (not on this class), so these tests
 * only cover the entity contract: a stationary Curator-shaped sibling that
 * the shell can detect by glyph or class.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Terminal } from '../../../../src/game/hub/Terminal.js';
import { FACTION } from '../../../../src/game/constants.js';

test('Terminal constructs with NEUTRAL faction, zero AP, glyph ‡', () => {
  const t = new Terminal({ x: 9, y: 3 });
  assert.equal(t.faction, FACTION.NEUTRAL);
  assert.equal(t.maxAp, 0);
  assert.equal(t.glyph, '‡');
  assert.equal(t.x, 9);
  assert.equal(t.y, 3);
  assert.equal(t.alive, true);
});

test('Terminal has a default id of "terminal" when none is supplied', () => {
  const t = new Terminal({ x: 0, y: 0 });
  assert.equal(t.id, 'terminal');
});

test('Terminal id can be overridden (snapshot/restore round-trip)', () => {
  const t = new Terminal({ id: 'hub-terminal-2', x: 1, y: 1 });
  assert.equal(t.id, 'hub-terminal-2');
});

test('Terminal is immobile — refreshAp keeps ap at 0', () => {
  const t = new Terminal({ x: 0, y: 0 });
  t.refreshAp();
  assert.equal(t.ap, 0);
  assert.equal(t.canAfford(1), false);
});
