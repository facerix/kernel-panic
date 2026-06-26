import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACTION } from '../../../../src/game/constants.js';
import {
  ArchiveTerminal,
  ARCHIVE_TERMINAL_GLYPH,
} from '../../../../src/game/hub/ArchiveTerminal.js';
import { buildHub } from '../../../../src/game/hub/SafeSpace.js';

test('ArchiveTerminal constructs with NEUTRAL faction, zero AP, glyph £', () => {
  const archive = new ArchiveTerminal({ x: 10, y: 2 });
  assert.equal(archive.faction, FACTION.NEUTRAL);
  assert.equal(archive.maxAp, 0);
  assert.equal(archive.glyph, ARCHIVE_TERMINAL_GLYPH);
  assert.equal(archive.x, 10);
  assert.equal(archive.y, 2);
  assert.equal(archive.alive, true);
});

test('ArchiveTerminal has a stable default id for shell routing', () => {
  const archive = new ArchiveTerminal({ x: 0, y: 0 });
  assert.equal(archive.id, 'archive-terminal');
});

test('buildHub returns an archiveTerminalSpawn on walkable floor, distinct from other hub fixtures', () => {
  const hub = buildHub();
  const same = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    a.x === b.x && a.y === b.y;

  assert.ok(hub.archiveTerminalSpawn, 'expected archiveTerminalSpawn in buildHub() result');
  assert.equal(typeof hub.archiveTerminalSpawn.x, 'number');
  assert.equal(typeof hub.archiveTerminalSpawn.y, 'number');
  assert.equal(hub.grid.isPassable(hub.archiveTerminalSpawn.x, hub.archiveTerminalSpawn.y), true);
  assert.ok(!same(hub.archiveTerminalSpawn, hub.playerSpawn), 'archive overlaps player spawn');
  assert.ok(!same(hub.archiveTerminalSpawn, hub.curatorSpawn), 'archive overlaps curator');
  assert.ok(!same(hub.archiveTerminalSpawn, hub.finnSpawn), 'archive overlaps finn');
  assert.ok(!same(hub.archiveTerminalSpawn, hub.clinicSpawn), 'archive overlaps clinic');
  assert.ok(!same(hub.archiveTerminalSpawn, hub.terminalSpawn), 'archive overlaps terminal');
  assert.ok(!same(hub.archiveTerminalSpawn, hub.exitTile), 'archive overlaps exit tile');
});
