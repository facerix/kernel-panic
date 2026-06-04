import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { EventBus } from '../../../src/game/events.js';
import {
  TILE,
  STIM_HEAL,
  SMOKE_RADIUS,
  INCENDIARY_THROW_DIST,
  BREACHING_CHARGE_RANGE,
  TARGETING_BONUS,
  DODGE_BONUS,
  RANGED_DAMAGE_BONUS,
  DEFAULT_HP,
} from '../../../src/game/constants.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { Rng } from '../../../src/rng.js';
import { ITEM_ID } from '../../../src/game/items.js';
import { placeSmoke, clearSmoke } from '../../../src/game/Smoke.js';
import { resolveRanged, resolveMelee } from '../../../src/game/Combat.js';
import { Razor } from '../../../src/game/archetypes/Razor.js';
import { Entity } from '../../../src/game/Entity.js';
import { FACTION } from '../../../src/game/constants.js';

// ---------------------------------------------------------------------------
// Crew.applyGear — Armour Plating
// ---------------------------------------------------------------------------

test('applyGear(ARMOUR_PLATING) increases maxHp and hp by 1', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  const origMaxHp = crew.maxHp;
  const origHp = crew.hp;
  crew.applyGear(ITEM_ID.ARMOUR_PLATING);
  assert.equal(crew.maxHp, origMaxHp + 1);
  assert.equal(crew.hp, origHp + 1);
  assert.equal(crew.gear.maxHpBonus, 1);
});

test('applyGear(ARMOUR_PLATING) stacks', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.ARMOUR_PLATING);
  crew.applyGear(ITEM_ID.ARMOUR_PLATING);
  assert.equal(crew.gear.maxHpBonus, 2);
  assert.equal(crew.maxHp, DEFAULT_HP + 2);
});

// ---------------------------------------------------------------------------
// Crew.applyGear — Targeting Chip
// ---------------------------------------------------------------------------

test('applyGear(TARGETING_CHIP) sets hitBonus', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.TARGETING_CHIP);
  assert.equal(crew.gear.hitBonus, TARGETING_BONUS);
});

test('applyGear throws on unknown item', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  assert.throws(() => crew.applyGear('unobtanium'), /unknown gear/i);
});

// ---------------------------------------------------------------------------
// Crew.applyGear — Reflex Weave
// ---------------------------------------------------------------------------

test('applyGear(REFLEX_WEAVE) sets dodgeBonus', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.REFLEX_WEAVE);
  assert.equal(crew.gear.dodgeBonus, DODGE_BONUS);
});

test('applyGear(BALLISTICS_COIL) sets rangedDamageBonus', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.BALLISTICS_COIL);
  assert.equal(crew.gear.rangedDamageBonus, RANGED_DAMAGE_BONUS);
});

// ---------------------------------------------------------------------------
// Combat.resolveRanged reads hitBonus from gear
// ---------------------------------------------------------------------------

test('resolveRanged incorporates gear hitBonus into threshold', () => {
  const grid = new Grid(12, 6, TILE.FLOOR);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  const attacker = new Merc({ id: 'merc', x: 2, y: 2, maxAp: 4 });
  attacker.applyGear(ITEM_ID.TARGETING_CHIP);
  const target = new Skirmisher({ id: 'drone', x: 5, y: 2 });
  world.addEntity(attacker);
  world.addEntity(target);
  const rng = new Rng(42);
  const result = resolveRanged(world, attacker, target, rng);
  // Merc baseHitChance is 0.8; one targeting chip adds TARGETING_BONUS.
  assert.equal(result.threshold, attacker.baseHitChance + TARGETING_BONUS);
});

test('resolveRanged incorporates gear rangedDamageBonus into damage', () => {
  const grid = new Grid(12, 6, TILE.FLOOR);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  const attacker = new Merc({ id: 'merc', x: 2, y: 2, maxAp: 4 });
  attacker.applyGear(ITEM_ID.BALLISTICS_COIL);
  const target = new Skirmisher({ id: 'drone', x: 5, y: 2 });
  world.addEntity(attacker);
  world.addEntity(target);
  const rng = new Rng(0); // guaranteed hit
  const result = resolveRanged(world, attacker, target, rng);
  assert.equal(result.damage, attacker.rangedAttackDamage());
});

// ---------------------------------------------------------------------------
// Combat.resolveMelee reads dodgeBonus from gear
// ---------------------------------------------------------------------------

test('resolveMelee incorporates gear dodgeBonus into threshold', () => {
  const grid = new Grid(12, 6, TILE.FLOOR);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  const attacker = new Entity({
    id: 'corp',
    x: 2,
    y: 2,
    faction: FACTION.CORP,
    glyph: 'd',
  });
  const target = new Razor({ id: 'razor', x: 3, y: 2, callsign: 'Cipher' });
  target.applyGear(ITEM_ID.REFLEX_WEAVE);
  world.addEntity(attacker);
  world.addEntity(target);
  const rng = new Rng(42);
  const result = resolveMelee(world, attacker, target, rng);
  assert.equal(result.dodgeThreshold, target.baseDodgeChance + DODGE_BONUS);
});

// ---------------------------------------------------------------------------
// Crew.addConsumable + useConsumable — Stim
// ---------------------------------------------------------------------------

test('addConsumable puts an item in inventory.consumables', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.addConsumable(ITEM_ID.STIM);
  assert.ok(crew.inventory, 'inventory should be initialised');
  assert.equal(crew.inventory.consumables.length, 1);
  assert.equal(crew.inventory.consumables[0].id, ITEM_ID.STIM);
});

test('addConsumable stacks (multiple stims)', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.addConsumable(ITEM_ID.STIM);
  crew.addConsumable(ITEM_ID.STIM);
  assert.equal(crew.inventory.consumables.length, 2);
});

test('useConsumable(STIM) heals HP and costs 1 AP', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0, maxAp: 4 });
  crew.addConsumable(ITEM_ID.STIM);
  crew.hp = 1; // wounded
  const apBefore = crew.ap;
  const result = crew.useConsumable(ITEM_ID.STIM);
  assert.equal(result.type, 'stim');
  assert.equal(result.healed, STIM_HEAL);
  assert.equal(crew.hp, 1 + STIM_HEAL);
  assert.equal(crew.ap, apBefore - 1);
  assert.equal(crew.inventory.consumables.length, 0);
});

test('useConsumable(STIM) does not exceed maxHp', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0, maxAp: 4 });
  crew.addConsumable(ITEM_ID.STIM);
  crew.hp = crew.maxHp; // already at full
  const result = crew.useConsumable(ITEM_ID.STIM);
  assert.equal(result.healed, 0);
  assert.equal(crew.hp, crew.maxHp);
});

test('useConsumable throws when inventory not initialised', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  // Don't call addConsumable (which inits inventory)
  assert.throws(() => crew.useConsumable(ITEM_ID.STIM), /inventory not initialised/i);
});

test('useConsumable throws on insufficient AP', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.addConsumable(ITEM_ID.STIM);
  crew.ap = 0;
  assert.throws(() => crew.useConsumable(ITEM_ID.STIM), /insufficient AP/i);
});

test('useConsumable throws when item not in inventory', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.initInventory();
  assert.throws(() => crew.useConsumable(ITEM_ID.STIM), /does not have/i);
});

// ---------------------------------------------------------------------------
// Crew.useConsumable — Smoke Charge
// ---------------------------------------------------------------------------

test('useConsumable(SMOKE_CHARGE) returns smoke descriptor', () => {
  const crew = new Merc({ id: 'merc', x: 3, y: 3, maxAp: 4 });
  crew.addConsumable(ITEM_ID.SMOKE_CHARGE);
  const result = crew.useConsumable(ITEM_ID.SMOKE_CHARGE);
  assert.equal(result.type, 'smoke');
  assert.equal(result.cx, 3);
  assert.equal(result.cy, 3);
  assert.equal(result.radius, SMOKE_RADIUS);
  assert.equal(crew.inventory.consumables.length, 0);
});

// ---------------------------------------------------------------------------
// Crew.useConsumable — Incendiary
// ---------------------------------------------------------------------------

test('useConsumable(INCENDIARY) returns thrown hazard descriptor', () => {
  const crew = new Merc({ id: 'merc', x: 3, y: 3, maxAp: 4 });
  crew.addConsumable(ITEM_ID.INCENDIARY);
  const result = crew.useConsumable(ITEM_ID.INCENDIARY, { dx: 1, dy: 0 });
  assert.equal(result.type, 'incendiary');
  assert.equal(result.cx, 3 + INCENDIARY_THROW_DIST);
  assert.equal(result.cy, 3);
  assert.equal(crew.inventory.consumables.length, 0);
});

test('useConsumable(BREACHING_CHARGE) returns adjacent breach descriptor', () => {
  const crew = new Merc({ id: 'merc', x: 3, y: 3, maxAp: 4 });
  crew.addConsumable(ITEM_ID.BREACHING_CHARGE);
  const result = crew.useConsumable(ITEM_ID.BREACHING_CHARGE, { dx: -1, dy: 0 });
  assert.equal(result.type, 'breach');
  assert.equal(result.tx, 3 - BREACHING_CHARGE_RANGE);
  assert.equal(result.ty, 3);
  assert.equal(crew.inventory.consumables.length, 0);
});

test('useConsumable enforces aim shape for aimed items only', () => {
  const crew = new Merc({ id: 'merc', x: 3, y: 3, maxAp: 4 });
  crew.addConsumable(ITEM_ID.INCENDIARY);
  assert.throws(() => crew.useConsumable(ITEM_ID.INCENDIARY), /requires aim/i);
  assert.throws(() => crew.useConsumable(ITEM_ID.INCENDIARY, { dx: 0, dy: 0 }), /invalid aim/i);
  assert.throws(() => crew.useConsumable(ITEM_ID.INCENDIARY, { dx: 2, dy: 0 }), /invalid aim/i);

  const breachCrew = new Merc({ id: 'breach-merc', x: 3, y: 3, maxAp: 4 });
  breachCrew.addConsumable(ITEM_ID.BREACHING_CHARGE);
  assert.throws(() => breachCrew.useConsumable(ITEM_ID.BREACHING_CHARGE), /requires aim/i);
  assert.throws(
    () => breachCrew.useConsumable(ITEM_ID.BREACHING_CHARGE, { dx: 0, dy: 0 }),
    /invalid aim/i
  );

  const smokeCrew = new Merc({ id: 'smoke-merc', x: 3, y: 3, maxAp: 4 });
  smokeCrew.addConsumable(ITEM_ID.SMOKE_CHARGE);
  assert.throws(
    () => smokeCrew.useConsumable(ITEM_ID.SMOKE_CHARGE, { dx: 1, dy: 0 }),
    /does not accept aim/i
  );
});

// ---------------------------------------------------------------------------
// Smoke placement and clearing
// ---------------------------------------------------------------------------

test('placeSmoke converts FLOOR tiles to SMOKE within radius', () => {
  const grid = new Grid(10, 10, TILE.FLOOR);
  const overlays = placeSmoke(grid, 5, 5, 2);
  assert.ok(overlays.length > 0);
  // Center should be smoke.
  assert.equal(grid.tileAt(5, 5), TILE.SMOKE);
  // Corner of radius 2 (Chebyshev) should be smoke.
  assert.equal(grid.tileAt(3, 3), TILE.SMOKE);
  assert.equal(grid.tileAt(7, 7), TILE.SMOKE);
  // All overlays should have FLOOR as originalTile.
  for (const o of overlays) {
    assert.equal(o.originalTile, TILE.FLOOR);
  }
});

test('placeSmoke does not convert WALLs', () => {
  const grid = new Grid(10, 10, TILE.FLOOR);
  grid.setTile(5, 4, TILE.WALL);
  const overlays = placeSmoke(grid, 5, 5, 2);
  assert.equal(grid.tileAt(5, 4), TILE.WALL);
  assert.ok(!overlays.some(o => o.x === 5 && o.y === 4));
});

test('placeSmoke handles edge of grid gracefully', () => {
  const grid = new Grid(6, 6, TILE.FLOOR);
  // Place near corner — some tiles will be OOB.
  const overlays = placeSmoke(grid, 0, 0, 2);
  assert.ok(overlays.length > 0);
  assert.equal(grid.tileAt(0, 0), TILE.SMOKE);
});

test('SMOKE tile is passable', () => {
  const grid = new Grid(5, 5, TILE.FLOOR);
  grid.setTile(2, 2, TILE.SMOKE);
  assert.equal(grid.isPassable(2, 2), true);
});

test('SMOKE tile blocks line of sight', () => {
  const grid = new Grid(5, 5, TILE.FLOOR);
  grid.setTile(2, 2, TILE.SMOKE);
  assert.equal(grid.blocksLineOfSight(2, 2), true);
});

test('clearSmoke restores original tiles', () => {
  const grid = new Grid(10, 10, TILE.FLOOR);
  const overlays = placeSmoke(grid, 5, 5, 1);
  clearSmoke(grid, overlays);
  // All tiles should be back to FLOOR.
  assert.equal(grid.tileAt(5, 5), TILE.FLOOR);
  assert.equal(grid.tileAt(4, 4), TILE.FLOOR);
  assert.equal(grid.tileAt(6, 6), TILE.FLOOR);
});

test('clearSmoke preserves EXIT tiles that were under smoke', () => {
  const grid = new Grid(10, 10, TILE.FLOOR);
  grid.setTile(5, 5, TILE.EXIT);
  const overlays = placeSmoke(grid, 5, 5, 1);
  // EXIT should have been converted to SMOKE.
  assert.equal(grid.tileAt(5, 5), TILE.SMOKE);
  const exitOverlay = overlays.find(o => o.x === 5 && o.y === 5);
  assert.ok(exitOverlay);
  assert.equal(exitOverlay.originalTile, TILE.EXIT);
  // Clear restores EXIT.
  clearSmoke(grid, overlays);
  assert.equal(grid.tileAt(5, 5), TILE.EXIT);
});

test('clearSmoke is idempotent on empty array', () => {
  const grid = new Grid(5, 5, TILE.FLOOR);
  clearSmoke(grid, []);
  assert.equal(grid.tileAt(2, 2), TILE.FLOOR);
});
