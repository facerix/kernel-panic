import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gearLines, statLines } from '../../../src/game/crewDisplay.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Razor } from '../../../src/game/archetypes/Razor.js';
import { ITEM_ID } from '../../../src/game/items.js';

// ---------------------------------------------------------------------------
// gearLines — roster gear readout. Every applyGear channel must surface a line
// so an operative's loadout is visible on the crew roster (P3.M6 gear bug).
// ---------------------------------------------------------------------------

test('gearLines returns [] for null/empty gear', () => {
  assert.deepEqual(gearLines(null), []);
  assert.deepEqual(
    gearLines({ maxHpBonus: 0, hitBonus: 0, dodgeBonus: 0, rangedDamageBonus: 0 }),
    []
  );
});

test('gearLines surfaces the four pre-M6 channels', () => {
  const lines = gearLines({
    maxHpBonus: 2,
    hitBonus: 0.1,
    dodgeBonus: 0.1,
    rangedDamageBonus: 1,
  });
  assert.ok(
    lines.some(l => l.includes('Armour Plating') && l.includes('+2 HP')),
    `expected Armour Plating line, got ${JSON.stringify(lines)}`
  );
  assert.ok(lines.some(l => l.includes('Targeting Chip') && l.includes('10%')));
  assert.ok(lines.some(l => l.includes('Reflex Weave') && l.includes('10%')));
  assert.ok(lines.some(l => l.includes('Ballistics Coil') && l.includes('+1')));
});

test('gearLines surfaces the five P3.M6.2 channels', () => {
  const lines = gearLines({
    maxHpBonus: 0,
    hitBonus: 0,
    dodgeBonus: 0,
    rangedDamageBonus: 0,
    meleeDamageBonus: 1,
    armorBonus: 1,
    apBonus: 1,
    shieldRegen: 1,
    hpRegen: 1,
  });
  assert.ok(
    lines.some(l => l.includes('Monoblade')),
    `missing Monoblade in ${JSON.stringify(lines)}`
  );
  assert.ok(lines.some(l => l.includes('Subdermal Plating')));
  assert.ok(lines.some(l => l.includes('Reflex Booster')));
  assert.ok(lines.some(l => l.includes('Phase Shield')));
  assert.ok(lines.some(l => l.includes('Regen Mesh')));
});

test('every applyGear item yields at least one roster line', () => {
  // Walk the live applyGear path so the readout can never silently drop a
  // channel a purchase can produce.
  for (const itemId of [
    ITEM_ID.ARMOUR_PLATING,
    ITEM_ID.TARGETING_CHIP,
    ITEM_ID.REFLEX_WEAVE,
    ITEM_ID.BALLISTICS_COIL,
    ITEM_ID.MONOBLADE,
    ITEM_ID.SUBDERMAL_PLATING,
    ITEM_ID.REFLEX_BOOSTER,
    ITEM_ID.PHASE_SHIELD,
    ITEM_ID.REGEN_MESH,
  ]) {
    const crew = new Merc({ id: 'merc', x: 0, y: 0 });
    crew.applyGear(itemId);
    assert.ok(gearLines(crew.gear).length >= 1, `applyGear(${itemId}) produced no roster line`);
  }
});

// ---------------------------------------------------------------------------
// statLines — roster STATS block. Core combat stats always show; gear bonuses
// surface inline; per-turn regen only when active.
// ---------------------------------------------------------------------------

test('statLines always shows the seven core stats, no regen rows by default', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  const lines = statLines(crew);
  for (const label of ['HP', 'AP', 'AIM', 'DODGE', 'RANGED', 'MELEE', 'ARMOUR']) {
    assert.ok(
      lines.some(l => l.startsWith(label + '  ') || l.startsWith(label + ' ')),
      `missing ${label} stat in ${JSON.stringify(lines)}`
    );
  }
  assert.ok(!lines.some(l => l.startsWith('SHIELD')), 'no shield regen row without gear');
  assert.ok(!lines.some(l => l.startsWith('REGEN')), 'no hp regen row without gear');
  // A bare operator shows no bonus annotations.
  assert.ok(
    !lines.some(l => l.includes('(+')),
    `unexpected bonus on bare crew: ${JSON.stringify(lines)}`
  );
});

test('statLines annotates each gear-boosted stat inline', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.TARGETING_CHIP);
  crew.applyGear(ITEM_ID.REFLEX_WEAVE);
  crew.applyGear(ITEM_ID.BALLISTICS_COIL);
  crew.applyGear(ITEM_ID.MONOBLADE);
  crew.applyGear(ITEM_ID.REFLEX_BOOSTER);
  crew.applyGear(ITEM_ID.SUBDERMAL_PLATING);
  const lines = statLines(crew);
  assert.ok(
    lines.some(l => l.startsWith('AIM') && l.includes('(+')),
    'AIM bonus'
  );
  assert.ok(
    lines.some(l => l.startsWith('DODGE') && l.includes('(+')),
    'DODGE bonus'
  );
  assert.ok(
    lines.some(l => l.startsWith('RANGED') && l.includes('(+')),
    'RANGED bonus'
  );
  assert.ok(
    lines.some(l => l.startsWith('MELEE') && l.includes('(+')),
    'MELEE bonus'
  );
  assert.ok(
    lines.some(l => l.startsWith('AP') && l.includes('(+')),
    'AP bonus'
  );
  // Subdermal Plating raises ARMOUR off its 0 base.
  assert.ok(
    lines.some(l => l.startsWith('ARMOUR') && /ARMOUR\s+1/.test(l)),
    'ARMOUR value'
  );
});

test('statLines shows regen rows only when phase shield / regen mesh equipped', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.PHASE_SHIELD);
  crew.applyGear(ITEM_ID.REGEN_MESH);
  const lines = statLines(crew);
  assert.ok(
    lines.some(l => l.startsWith('SHIELD') && l.includes('/turn')),
    'shield regen row'
  );
  assert.ok(
    lines.some(l => l.startsWith('REGEN') && l.includes('HP/turn')),
    'hp regen row'
  );
});

test('statLines reflects archetype melee/ranged differences without gear', () => {
  // Razor's heavier blade should read on the MELEE line; a fresh recruit-style
  // readout still works because Crew getters supply the base values.
  const razor = new Razor({ id: 'razor', x: 0, y: 0 });
  const merc = new Merc({ id: 'merc', x: 0, y: 0 });
  const razorMelee = statLines(razor).find(l => l.startsWith('MELEE'));
  const mercMelee = statLines(merc).find(l => l.startsWith('MELEE'));
  assert.ok(razorMelee && mercMelee);
  assert.notEqual(razorMelee, mercMelee);
});
