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
    ITEM_ID.BONE_LACING,
    ITEM_ID.TARGETING_CHIP,
    ITEM_ID.GHOST_WEAVE,
    ITEM_ID.RIP_ROUNDS,
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
// getShopCatalog — P3.M6.3 shop rework: DEFAULT_ITEMS + unlocked scoreable
// ---------------------------------------------------------------------------

test('getShopCatalog with an empty meta-store returns exactly the default items', () => {
  const catalog = getShopCatalog([]);
  assert.deepEqual(catalog.map(i => i.id).sort(), DEFAULT_ITEMS.map(i => i.id).sort());
});

test('getShopCatalog defaults to default-only stock when called with no arg', () => {
  assert.deepEqual(
    getShopCatalog()
      .map(i => i.id)
      .sort(),
    DEFAULT_ITEMS.map(i => i.id).sort()
  );
});

test('getShopCatalog folds in unlocked scoreable items as they accrue', () => {
  const oneUnlock = getShopCatalog([ITEM_ID.MONOBLADE]);
  const ids = oneUnlock.map(i => i.id);
  // All default items still present...
  for (const item of DEFAULT_ITEMS) assert.ok(ids.includes(item.id));
  // ...plus exactly the one unlocked scoreable.
  assert.ok(ids.includes(ITEM_ID.MONOBLADE));
  assert.equal(oneUnlock.length, DEFAULT_ITEMS.length + 1);

  const twoUnlocks = getShopCatalog([ITEM_ID.MONOBLADE, ITEM_ID.BONE_LACING]);
  assert.equal(twoUnlocks.length, DEFAULT_ITEMS.length + 2);
  assert.ok(twoUnlocks.some(i => i.id === ITEM_ID.BONE_LACING));
});

test('getShopCatalog never renders a locked scoreable item', () => {
  // Unlock only the Monoblade — every other scoreable stays hidden.
  const ids = new Set(getShopCatalog([ITEM_ID.MONOBLADE]).map(i => i.id));
  for (const item of SCOREABLE_ITEMS) {
    if (item.id === ITEM_ID.MONOBLADE) continue;
    assert.ok(!ids.has(item.id), `locked scoreable "${item.id}" should not render`);
  }
});

test('getShopCatalog ignores an unlocked id that is not a known scoreable item', () => {
  // A retired / forward-version blueprint can't be rendered; it must not crash
  // or leak a phantom entry — the store owns earned-data integrity, not the shop.
  const catalog = getShopCatalog([ITEM_ID.MONOBLADE, 'ghost-blueprint', ITEM_ID.STIM]);
  const ids = catalog.map(i => i.id);
  assert.ok(!ids.includes('ghost-blueprint'));
  // STIM is a default item, not scoreable — passing it as "unlocked" doesn't
  // duplicate it (default items are added once, unconditionally).
  assert.equal(ids.filter(id => id === ITEM_ID.STIM).length, 1);
  assert.ok(ids.includes(ITEM_ID.MONOBLADE));
});

test('getShopCatalog stock depends only on unlocks, never on rep (no rep param)', () => {
  // Structural decoupling: there is no rep argument. Same unlocks → same stock.
  assert.deepEqual(
    getShopCatalog([ITEM_ID.MONOBLADE]).map(i => i.id),
    getShopCatalog([ITEM_ID.MONOBLADE]).map(i => i.id)
  );
  // Returns a fresh array each call — callers may mutate without corrupting source.
  assert.notEqual(getShopCatalog([]), getShopCatalog([]));
});

test('getItemById resolves across both catalogs and throws on unknown', () => {
  assert.equal(getItemById(ITEM_ID.STIM).id, ITEM_ID.STIM); // default
  assert.equal(getItemById(ITEM_ID.MONOBLADE).id, ITEM_ID.MONOBLADE); // scoreable net-new
  assert.equal(getItemById(ITEM_ID.BONE_LACING).id, ITEM_ID.BONE_LACING); // scoreable original
  assert.throws(() => getItemById('unobtanium'), /unknown item/i);
});
