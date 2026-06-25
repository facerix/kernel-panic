import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ITEMS,
  SCOREABLE_ITEMS,
  SCOREABLE_ITEM_IDS,
  ITEM_ID,
  ITEM_SCOPE,
  getShopCatalog,
  getItemById,
  type Item,
} from '../../../src/game/items.js';

// ---------------------------------------------------------------------------
// P3.M6.2 — Item catalog split (DEFAULT_ITEMS vs SCOREABLE_ITEMS)
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: (keyof Item)[] = [
  'id',
  'label',
  'scope',
  'cost',
  'description',
  'needsTarget',
];

function assertWellFormed(item: Item) {
  for (const field of REQUIRED_FIELDS) {
    assert.ok(
      item[field] !== undefined && item[field] !== null,
      `item "${item.id}" missing required field "${field}"`
    );
  }
  assert.equal(typeof item.id, 'string');
  assert.ok(item.id.length > 0, `item has empty id`);
  assert.equal(typeof item.label, 'string');
  assert.ok(item.label.length > 0, `item "${item.id}" has empty label`);
  assert.equal(typeof item.cost, 'number');
  assert.ok(Number.isInteger(item.cost) && item.cost > 0, `item "${item.id}" cost must be > 0`);
  assert.equal(typeof item.needsTarget, 'boolean');
  assert.ok(
    Object.values(ITEM_SCOPE).includes(item.scope),
    `item "${item.id}" has invalid scope "${item.scope}"`
  );
}

test('every DEFAULT_ITEMS entry is well-formed', () => {
  assert.ok(DEFAULT_ITEMS.length > 0);
  for (const item of DEFAULT_ITEMS) assertWellFormed(item);
});

test('every SCOREABLE_ITEMS entry is well-formed', () => {
  assert.ok(SCOREABLE_ITEMS.length > 0);
  for (const item of SCOREABLE_ITEMS) assertWellFormed(item);
});

test('no item id is duplicated within or across the two catalogs', () => {
  const all = [...DEFAULT_ITEMS, ...SCOREABLE_ITEMS].map(i => i.id);
  const unique = new Set(all);
  assert.equal(unique.size, all.length, `duplicate item id(s): ${all.join(', ')}`);
});

test('the two catalogs are disjoint (no item is both default and scoreable)', () => {
  const defaultIds = new Set(DEFAULT_ITEMS.map(i => i.id));
  for (const item of SCOREABLE_ITEMS) {
    assert.ok(!defaultIds.has(item.id), `"${item.id}" appears in both catalogs`);
  }
});

test('scoreable pool has at least 5 net-new items beyond the original KNOWN gear', () => {
  // The original rep-gated KNOWN gear that became scoreable.
  const ORIGINAL_KNOWN = new Set([
    ITEM_ID.ARMOUR_PLATING,
    ITEM_ID.TARGETING_CHIP,
    ITEM_ID.REFLEX_WEAVE,
    ITEM_ID.BALLISTICS_COIL,
  ]);
  const netNew = SCOREABLE_ITEMS.filter(i => !ORIGINAL_KNOWN.has(i.id));
  assert.ok(netNew.length >= 5, `expected >= 5 net-new scoreable items, found ${netNew.length}`);
  // Pool sized for multi-campaign variety (plan: 8–12 total).
  assert.ok(SCOREABLE_ITEMS.length >= 8 && SCOREABLE_ITEMS.length <= 12);
});

test('every scoreable item carries a heist flavor line; default items do not', () => {
  for (const item of SCOREABLE_ITEMS) {
    assert.equal(typeof item.flavor, 'string', `scoreable "${item.id}" missing flavor`);
    assert.ok(item.flavor!.length > 0, `scoreable "${item.id}" has empty flavor`);
  }
  for (const item of DEFAULT_ITEMS) {
    assert.equal(item.flavor, undefined, `default "${item.id}" should not carry heist flavor`);
  }
});

test('SCOREABLE_ITEM_IDS matches the SCOREABLE_ITEMS pool exactly', () => {
  assert.equal(SCOREABLE_ITEM_IDS.size, SCOREABLE_ITEMS.length);
  for (const item of SCOREABLE_ITEMS) {
    assert.ok(SCOREABLE_ITEM_IDS.has(item.id), `id set missing "${item.id}"`);
  }
});

// ---------------------------------------------------------------------------
// getShopCatalog — rep no longer gates; only DEFAULT_ITEMS until M6.3
// ---------------------------------------------------------------------------

test('getShopCatalog returns exactly the default items (no rep gate)', () => {
  const catalog = getShopCatalog();
  assert.deepEqual(catalog.map(i => i.id).sort(), DEFAULT_ITEMS.map(i => i.id).sort());
});

test('getShopCatalog never surfaces a scoreable item (locked until unlocked)', () => {
  const shopIds = new Set(getShopCatalog().map(i => i.id));
  for (const item of SCOREABLE_ITEMS) {
    assert.ok(!shopIds.has(item.id), `scoreable "${item.id}" leaked into default shop stock`);
  }
});

test('getShopCatalog takes no rep argument and is independent of standing', () => {
  // Signature regression guard: the rep-gated overload is gone. Calling with a
  // stray argument is a no-op rather than a tier filter.
  assert.equal(getShopCatalog.length, 0);
  const a = getShopCatalog();
  const b = (getShopCatalog as (rep?: number) => Item[])(100);
  assert.deepEqual(
    a.map(i => i.id),
    b.map(i => i.id)
  );
  // Returns a fresh array each call — callers may mutate without corrupting source.
  assert.notEqual(a, b);
});

test('getItemById resolves across both catalogs and throws on unknown', () => {
  assert.equal(getItemById(ITEM_ID.STIM).id, ITEM_ID.STIM); // default
  assert.equal(getItemById(ITEM_ID.MONOBLADE).id, ITEM_ID.MONOBLADE); // scoreable net-new
  assert.equal(getItemById(ITEM_ID.ARMOUR_PLATING).id, ITEM_ID.ARMOUR_PLATING); // scoreable original
  assert.throws(() => getItemById('unobtanium'), /unknown item/i);
});
