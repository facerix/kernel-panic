import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACTION, SHOP_COST } from '../../../../src/game/constants.js';
import { Finn } from '../../../../src/game/hub/Finn.js';
import { ITEM_ID, ITEM_SCOPE, getShopCatalog, getItemById } from '../../../../src/game/items.js';
import { buildHub } from '../../../../src/game/hub/SafeSpace.js';

// ---------------------------------------------------------------------------
// Finn entity
// ---------------------------------------------------------------------------

test('Finn constructs with NEUTRAL faction, zero AP, glyph ¥', () => {
  const f = new Finn({ x: 5, y: 2 });
  assert.equal(f.faction, FACTION.NEUTRAL);
  assert.equal(f.maxAp, 0);
  assert.equal(f.glyph, '¥');
  assert.equal(f.x, 5);
  assert.equal(f.y, 2);
  assert.equal(f.alive, true);
});

test('Finn is immobile — refreshAp keeps AP at 0', () => {
  const f = new Finn();
  f.refreshAp();
  assert.equal(f.ap, 0);
  assert.equal(f.canAfford(1), false);
});

test('Finn.catalog returns the default consumable stock, no rep gate (P3.M6.2)', () => {
  const f = new Finn();
  const items = f.catalog();
  assert.ok(Array.isArray(items));
  const ids = items.map(i => i.id);
  assert.equal(items.length, 4);
  assert.ok(ids.includes(ITEM_ID.STIM));
  assert.ok(ids.includes(ITEM_ID.SMOKE_CHARGE));
  assert.ok(ids.includes(ITEM_ID.INCENDIARY));
  assert.ok(ids.includes(ITEM_ID.BREACHING_CHARGE));
});

test('Finn.catalog never surfaces a locked scoreable item', () => {
  const f = new Finn();
  const ids = f.catalog().map(i => i.id);
  // The former KNOWN-tier gear is now scoreable — locked until a Score unlock.
  assert.ok(!ids.includes(ITEM_ID.ARMOUR_PLATING));
  assert.ok(!ids.includes(ITEM_ID.TARGETING_CHIP));
  assert.ok(!ids.includes(ITEM_ID.REFLEX_WEAVE));
  assert.ok(!ids.includes(ITEM_ID.BALLISTICS_COIL));
});

test('Finn.catalog folds in unlocked scoreable blueprints from the meta-store', () => {
  const f = new Finn();
  const ids = f.catalog([ITEM_ID.ARMOUR_PLATING, ITEM_ID.MONOBLADE]).map(i => i.id);
  // Default stock still present.
  assert.ok(ids.includes(ITEM_ID.STIM));
  // Unlocked scoreable now stocked.
  assert.ok(ids.includes(ITEM_ID.ARMOUR_PLATING));
  assert.ok(ids.includes(ITEM_ID.MONOBLADE));
  // Still-locked scoreable stays hidden.
  assert.ok(!ids.includes(ITEM_ID.TARGETING_CHIP));
});

// ---------------------------------------------------------------------------
// Item catalog (pure functions)
// ---------------------------------------------------------------------------

test('getShopCatalog returns the four default items regardless of standing', () => {
  const items = getShopCatalog();
  assert.equal(items.length, 4);
});

test('getItemById returns the item for a valid id', () => {
  const item = getItemById(ITEM_ID.STIM);
  assert.equal(item.id, ITEM_ID.STIM);
  assert.equal(item.cost, SHOP_COST.STIM);
  assert.equal(item.scope, ITEM_SCOPE.JOB);
});

test('getItemById throws on unknown id', () => {
  assert.throws(() => getItemById('unobtanium'), /unknown item/i);
});

test('every catalog item has a valid scope', () => {
  const items = getShopCatalog();
  const validScopes = new Set(Object.values(ITEM_SCOPE));
  for (const item of items) {
    assert.ok(validScopes.has(item.scope), `item ${item.id} has unknown scope "${item.scope}"`);
  }
});

test('every catalog item has a positive integer cost', () => {
  const items = getShopCatalog();
  for (const item of items) {
    assert.ok(Number.isInteger(item.cost) && item.cost > 0, `item ${item.id} has invalid cost`);
  }
});

test('catalog item costs are priced in Creds', () => {
  assert.equal(getItemById(ITEM_ID.STIM).cost, 20);
  assert.equal(getItemById(ITEM_ID.SMOKE_CHARGE).cost, 30);
  assert.equal(getItemById(ITEM_ID.BREACHING_CHARGE).cost, SHOP_COST.BREACHING_CHARGE);
  assert.equal(getItemById(ITEM_ID.ARMOUR_PLATING).cost, 60);
  assert.equal(getItemById(ITEM_ID.TARGETING_CHIP).cost, 80);
  assert.equal(getItemById(ITEM_ID.REFLEX_WEAVE).cost, 80);
});

// ---------------------------------------------------------------------------
// SafeSpace integration
// ---------------------------------------------------------------------------

test('buildHub returns a finnSpawn on walkable floor, distinct from other NPCs', () => {
  const hub = buildHub();
  assert.ok(hub.finnSpawn, 'expected finnSpawn in buildHub() result');
  assert.equal(typeof hub.finnSpawn.x, 'number');
  assert.equal(typeof hub.finnSpawn.y, 'number');
  assert.equal(hub.grid.isPassable(hub.finnSpawn.x, hub.finnSpawn.y), true);
  const same = (a, b) => a.x === b.x && a.y === b.y;
  assert.ok(!same(hub.finnSpawn, hub.playerSpawn), 'finn overlaps player spawn');
  assert.ok(!same(hub.finnSpawn, hub.curatorSpawn), 'finn overlaps curator');
  assert.ok(!same(hub.finnSpawn, hub.terminalSpawn), 'finn overlaps terminal');
  assert.ok(!same(hub.finnSpawn, hub.exitTile), 'finn overlaps exit tile');
});

test('buildHub returns a clinicSpawn on walkable floor, distinct from other NPCs', () => {
  const hub = buildHub();
  const same = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    a.x === b.x && a.y === b.y;

  assert.ok(hub.clinicSpawn, 'expected clinicSpawn in buildHub() result');
  assert.equal(typeof hub.clinicSpawn.x, 'number');
  assert.equal(typeof hub.clinicSpawn.y, 'number');
  assert.equal(hub.grid.isPassable(hub.clinicSpawn.x, hub.clinicSpawn.y), true);
  assert.ok(!same(hub.clinicSpawn, hub.playerSpawn), 'clinic overlaps player spawn');
  assert.ok(!same(hub.clinicSpawn, hub.curatorSpawn), 'clinic overlaps curator');
  assert.ok(!same(hub.clinicSpawn, hub.finnSpawn), 'clinic overlaps finn');
  assert.ok(!same(hub.clinicSpawn, hub.terminalSpawn), 'clinic overlaps terminal');
  assert.ok(!same(hub.clinicSpawn, hub.exitTile), 'clinic overlaps exit tile');
});
