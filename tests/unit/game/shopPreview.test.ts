import { test } from 'node:test';
import assert from 'node:assert/strict';

import { itemPreview, heldConsumableCount } from '../../../src/game/shopPreview.js';
import { statDisplays } from '../../../src/game/crewDisplay.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Razor } from '../../../src/game/archetypes/Razor.js';
import { DEFAULT_ITEMS, SCOREABLE_ITEMS, ITEM_ID } from '../../../src/game/items.js';

// ---------------------------------------------------------------------------
// Coverage guard — every purchasable item must preview something, so stocking a
// new item without deciding what its shop rows show fails here rather than
// silently rendering a blank span.
// ---------------------------------------------------------------------------

test('every catalog item has a preview mapping', () => {
  for (const item of [...DEFAULT_ITEMS, ...SCOREABLE_ITEMS]) {
    const crew = new Merc({ id: 'merc', x: 0, y: 0 });
    const preview = itemPreview(item.id, crew);
    assert.ok(preview.label.length > 0, `${item.id} produced an empty label`);
    assert.ok(preview.value.length > 0, `${item.id} produced an empty value`);
  }
});

test('itemPreview throws on an unknown item id', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  assert.throws(() => itemPreview('not-an-item', crew), /no preview mapping/);
});

// ---------------------------------------------------------------------------
// Consumables — held quantity.
// ---------------------------------------------------------------------------

test('consumables preview the held quantity of that same item', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  assert.deepEqual(itemPreview(ITEM_ID.STIM, crew), { label: 'HELD', value: '0' });

  crew.addConsumable(ITEM_ID.STIM);
  crew.addConsumable(ITEM_ID.STIM);
  crew.addConsumable(ITEM_ID.MOLOTOV);

  assert.deepEqual(itemPreview(ITEM_ID.STIM, crew), { label: 'HELD', value: '2' });
  assert.deepEqual(itemPreview(ITEM_ID.MOLOTOV, crew), { label: 'HELD', value: '1' });
  assert.deepEqual(itemPreview(ITEM_ID.SMOKE_CHARGE, crew), { label: 'HELD', value: '0' });
});

test('heldConsumableCount treats an uninitialised inventory as zero', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  assert.equal(crew.inventory, null);
  assert.equal(heldConsumableCount(crew, ITEM_ID.STIM), 0);
});

// ---------------------------------------------------------------------------
// Gear — the stat the item moves, with existing bonuses folded in.
// ---------------------------------------------------------------------------

test('gear previews the stat that gear moves', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  const stats = statDisplays(crew);
  assert.deepEqual(itemPreview(ITEM_ID.MONOBLADE, crew), { label: 'MELEE', value: stats.melee });
  assert.deepEqual(itemPreview(ITEM_ID.RIP_ROUNDS, crew), { label: 'RANGED', value: stats.ranged });
  assert.deepEqual(itemPreview(ITEM_ID.TARGETING_CHIP, crew), { label: 'AIM', value: stats.aim });
  assert.deepEqual(itemPreview(ITEM_ID.GHOST_WEAVE, crew), { label: 'DODGE', value: stats.dodge });
  assert.deepEqual(itemPreview(ITEM_ID.SUBDERMAL_PLATING, crew), {
    label: 'ARMOR',
    value: stats.armor,
  });
  assert.deepEqual(itemPreview(ITEM_ID.ADRENAL_SPIKE, crew), { label: 'MAX AP', value: stats.ap });
  assert.deepEqual(itemPreview(ITEM_ID.BONE_LACING, crew), { label: 'HP', value: stats.hp });
});

test('per-turn regen gear reads "none" before purchase and a rate after', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  assert.deepEqual(itemPreview(ITEM_ID.PHASE_SHIELD, crew), { label: 'SHIELD', value: 'none' });
  assert.deepEqual(itemPreview(ITEM_ID.REGEN_MESH, crew), { label: 'REGEN', value: 'none' });

  crew.applyGear(ITEM_ID.PHASE_SHIELD);
  crew.applyGear(ITEM_ID.REGEN_MESH);
  assert.notEqual(itemPreview(ITEM_ID.PHASE_SHIELD, crew).value, 'none');
  assert.notEqual(itemPreview(ITEM_ID.REGEN_MESH, crew).value, 'none');
});

test('a purchased bonus is reflected in the next preview', () => {
  const before = itemPreview(ITEM_ID.MONOBLADE, new Merc({ id: 'a', x: 0, y: 0 })).value;
  const crew = new Merc({ id: 'b', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.MONOBLADE);
  assert.notEqual(itemPreview(ITEM_ID.MONOBLADE, crew).value, before);
});

test('previews are archetype-aware', () => {
  const merc = new Merc({ id: 'merc', x: 0, y: 0 });
  const razor = new Razor({ id: 'razor', x: 0, y: 0 });
  assert.notEqual(
    itemPreview(ITEM_ID.MONOBLADE, merc).value,
    itemPreview(ITEM_ID.MONOBLADE, razor).value,
    'Razor melee damage should differ from Merc'
  );
});
