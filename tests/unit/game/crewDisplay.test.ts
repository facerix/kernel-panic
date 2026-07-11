import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gearLines, statDisplays } from '../../../src/game/crewDisplay.js';
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
    lines.some(l => l.includes('Armor Plating') && l.includes('+2 HP')),
    `expected Armor Plating line, got ${JSON.stringify(lines)}`
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
// statDisplays — roster STATS block. Maps each combat stat to its display
// value with gear folded into the value (no inline annotation). Core keys
// always present; per-turn regen keys only when active; bonuses counted once.
// ---------------------------------------------------------------------------

/** Leading numeric value of a stat display ("3 dmg" → 3, "65%" → 65). */
const num = (s: string) => parseInt(s, 10);

test('statDisplays exposes the seven core stat keys, no regen keys by default', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  const labels = statDisplays(crew);
  for (const key of ['hp', 'ap', 'aim', 'dodge', 'ranged', 'melee', 'armor']) {
    assert.ok(key in labels, `missing ${key} in ${JSON.stringify(labels)}`);
  }
  assert.equal(labels.shield, undefined, 'no shield regen key without gear');
  assert.equal(labels.regen, undefined, 'no hp regen key without gear');
  // Shape: HP is current/max, AIM/DODGE are percentages, damage carries a unit.
  assert.equal(labels.hp, `${crew.hp}/${crew.maxHp}`);
  assert.match(labels.aim, /^\d+%$/);
  assert.match(labels.dodge, /^\d+%$/);
  assert.match(labels.ranged, /\bdmg$/);
  assert.match(labels.melee, /\bdmg$/);
  // Values are folded — a bare operator carries no inline "(+N)" annotations.
  for (const [k, v] of Object.entries(labels)) {
    assert.ok(!v.includes('(+'), `unexpected annotation on ${k}: ${JSON.stringify(labels)}`);
  }
});

test('statDisplays folds each gear bonus into its stat value, counted exactly once', () => {
  const bare = statDisplays(new Merc({ id: 'bare', x: 0, y: 0 }));
  const bareCrew = new Merc({ id: 'ref', x: 0, y: 0 });

  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.TARGETING_CHIP);
  crew.applyGear(ITEM_ID.REFLEX_WEAVE);
  crew.applyGear(ITEM_ID.BALLISTICS_COIL);
  crew.applyGear(ITEM_ID.MONOBLADE);
  crew.applyGear(ITEM_ID.REFLEX_BOOSTER);
  crew.applyGear(ITEM_ID.SUBDERMAL_PLATING);
  const labels = statDisplays(crew);

  // Base-derived stats: the bonus reads higher than the bare value.
  assert.ok(num(labels.aim) > num(bare.aim), 'AIM reflects targeting chip');
  assert.ok(num(labels.dodge) > num(bare.dodge), 'DODGE reflects reflex weave');
  assert.ok(num(labels.ranged) > num(bare.ranged), 'RANGED reflects ballistics coil');
  assert.ok(num(labels.melee) > num(bare.melee), 'MELEE reflects monoblade');

  // Live stats: `maxAp` and `damageReduction` already bake the gear delta in, so
  // the display must count it once — not add the tracked bonus a second time.
  assert.equal(crew.maxAp, bareCrew.maxAp + 1, 'sanity: reflex booster raised maxAp by 1');
  assert.equal(labels.ap, `${crew.maxAp}`, 'AP folds the booster exactly once');
  assert.equal(crew.damageReduction, 1, 'sanity: subdermal plating raised armor to 1');
  assert.equal(labels.armor, `${crew.damageReduction}`, 'ARMOR folds subdermal plating once');

  // Still no inline annotations once gear is on.
  for (const [k, v] of Object.entries(labels)) {
    assert.ok(!v.includes('(+'), `unexpected annotation on ${k}: ${JSON.stringify(labels)}`);
  }
});

test('statDisplays exposes regen keys only when phase shield / regen mesh equipped', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.PHASE_SHIELD);
  crew.applyGear(ITEM_ID.REGEN_MESH);
  const labels = statDisplays(crew);
  assert.ok(labels.shield?.includes('/turn'), `shield: ${labels.shield}`);
  assert.ok(labels.regen?.includes('HP/turn'), `regen: ${labels.regen}`);
  // The value owns its sign: a single leading '+', never doubled by the caller.
  assert.ok(
    labels.shield.startsWith('+') && !labels.shield.startsWith('++'),
    `shield sign: ${labels.shield}`
  );
  assert.ok(
    labels.regen.startsWith('+') && !labels.regen.startsWith('++'),
    `regen sign: ${labels.regen}`
  );
});

test('statDisplays reflects archetype melee/ranged differences without gear', () => {
  // Razor's heavier blade should read on the MELEE value; a fresh recruit-style
  // readout still works because Crew getters supply the base values.
  const razor = new Razor({ id: 'razor', x: 0, y: 0 });
  const merc = new Merc({ id: 'merc', x: 0, y: 0 });
  assert.notEqual(statDisplays(razor).melee, statDisplays(merc).melee);
});
