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
  DEFAULT_AP,
  MELEE_DAMAGE_BONUS,
  ARMOR_BONUS,
  AP_BONUS,
  SHIELD_REGEN,
  HP_REGEN,
  HEAVY_MELEE_DAMAGE,
} from '../../../src/game/constants.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { Rng } from '../../../src/rng.js';
import { ITEM_ID } from '../../../src/game/items.js';
import { placeSmoke } from '../../../src/game/Smoke.js';
import { resolveRanged, resolveMelee } from '../../../src/game/Combat.js';
import { Razor } from '../../../src/game/archetypes/Razor.js';
import { Entity } from '../../../src/game/Entity.js';
import { FACTION, SMOKE_DURATION } from '../../../src/game/constants.js';

// ---------------------------------------------------------------------------
// Crew.applyGear — Bone Lacing
// ---------------------------------------------------------------------------

test('applyGear(BONE_LACING) increases maxHp and hp by 1', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  const origMaxHp = crew.maxHp;
  const origHp = crew.hp;
  crew.applyGear(ITEM_ID.BONE_LACING);
  assert.equal(crew.maxHp, origMaxHp + 1);
  assert.equal(crew.hp, origHp + 1);
  assert.equal(crew.gear.maxHpBonus, 1);
});

test('applyGear(BONE_LACING) stacks', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.BONE_LACING);
  crew.applyGear(ITEM_ID.BONE_LACING);
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
// Crew.applyGear — Ghost Weave
// ---------------------------------------------------------------------------

test('applyGear(GHOST_WEAVE) sets dodgeBonus', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.GHOST_WEAVE);
  assert.equal(crew.gear.dodgeBonus, DODGE_BONUS);
});

test('applyGear(RIP_ROUNDS) sets rangedDamageBonus', () => {
  const crew = new Merc({ id: 'merc', x: 0, y: 0 });
  crew.applyGear(ITEM_ID.RIP_ROUNDS);
  assert.equal(crew.gear.rangedDamageBonus, RANGED_DAMAGE_BONUS);
});

// ---------------------------------------------------------------------------
// P3.M6.2 net-new scoreable gear — Crew.applyGear
// ---------------------------------------------------------------------------

test('applyGear(MONOBLADE) raises meleeAttackDamage by the bonus, capped', () => {
  const razor = new Razor({ id: 'razor', x: 0, y: 0, callsign: 'Cipher' });
  const base = razor.meleeAttackDamage();
  razor.applyGear(ITEM_ID.MONOBLADE);
  assert.equal(razor.gear.meleeDamageBonus, MELEE_DAMAGE_BONUS);
  assert.equal(razor.meleeAttackDamage(), base + MELEE_DAMAGE_BONUS);
  // Capped: a second install is a harmless no-op (mirrors RiP Rounds).
  razor.applyGear(ITEM_ID.MONOBLADE);
  assert.equal(razor.gear.meleeDamageBonus, razor.maxMeleeDamageBonus);
  assert.equal(razor.meleeAttackDamage(), base + razor.maxMeleeDamageBonus);
});

test('resolveMelee applies the Monoblade bonus through meleeAttackDamage', () => {
  const grid = new Grid(12, 6, TILE.FLOOR);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  const attacker = new Razor({ id: 'razor', x: 2, y: 2, callsign: 'Cipher', maxAp: 4 });
  attacker.applyGear(ITEM_ID.MONOBLADE);
  const target = new Skirmisher({ id: 'drone', x: 3, y: 2 });
  world.addEntity(attacker);
  world.addEntity(target);
  const rng = new Rng(42);
  // Force a clean hit (no dodge) so we read the unmitigated swing.
  const result = resolveMelee(world, attacker, target, rng, { dodgeChance: 0 });
  assert.equal(result.hit, true);
  assert.equal(result.damage, HEAVY_MELEE_DAMAGE + MELEE_DAMAGE_BONUS);
  assert.equal(result.damage, attacker.meleeAttackDamage());
});

test('applyGear(SUBDERMAL_PLATING) raises damageReduction, capped', () => {
  const merc = new Merc({ id: 'merc', x: 0, y: 0 });
  assert.equal(merc.damageReduction, 0);
  merc.applyGear(ITEM_ID.SUBDERMAL_PLATING);
  assert.equal(merc.gear.armorBonus, ARMOR_BONUS);
  assert.equal(merc.damageReduction, ARMOR_BONUS);
  // Capped at one effective unit — a second install changes nothing.
  merc.applyGear(ITEM_ID.SUBDERMAL_PLATING);
  assert.equal(merc.damageReduction, merc.maxArmorBonus);
  assert.equal(merc.gear.armorBonus, merc.maxArmorBonus);
});

test('subdermal plating mitigates incoming melee damage with a min-1 floor', () => {
  const grid = new Grid(12, 6, TILE.FLOOR);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  const attacker = new Entity({ id: 'corp', x: 2, y: 2, faction: FACTION.CORP, glyph: 'd' });
  const target = new Merc({ id: 'merc', x: 3, y: 2 });
  target.applyGear(ITEM_ID.SUBDERMAL_PLATING);
  world.addEntity(attacker);
  world.addEntity(target);
  const hpBefore = target.hp;
  const rng = new Rng(42);
  // Generic corp melee is MELEE_DAMAGE (2); armour 1 → 1 applied.
  const result = resolveMelee(world, attacker, target, rng, { dodgeChance: 0, damage: 2 });
  assert.equal(result.hit, true);
  assert.equal(result.damage, 1);
  assert.equal(target.hp, hpBefore - 1);
});

test('applyGear(ADRENAL_SPIKE) grants +AP immediately, capped at one', () => {
  const merc = new Merc({ id: 'merc', x: 0, y: 0, maxAp: DEFAULT_AP });
  const apBefore = merc.ap;
  merc.applyGear(ITEM_ID.ADRENAL_SPIKE);
  assert.equal(merc.maxAp, DEFAULT_AP + AP_BONUS);
  assert.equal(merc.ap, apBefore + AP_BONUS, 'extra AP is usable the same turn');
  assert.equal(merc.gear.apBonus, AP_BONUS);
  // One per operator — a second install is a no-op, no runaway AP.
  merc.applyGear(ITEM_ID.ADRENAL_SPIKE);
  assert.equal(merc.maxAp, DEFAULT_AP + merc.maxApBonus);
  assert.equal(merc.gear.apBonus, merc.maxApBonus);
});

test('applyGear(PHASE_SHIELD) sets shieldRegen; refreshAp re-grants the shield each turn', () => {
  const merc = new Merc({ id: 'merc', x: 0, y: 0, maxAp: 4 });
  merc.applyGear(ITEM_ID.PHASE_SHIELD);
  assert.equal(merc.gear.shieldRegen, SHIELD_REGEN);
  // Capped — a second install is a no-op.
  merc.applyGear(ITEM_ID.PHASE_SHIELD);
  assert.equal(merc.gear.shieldRegen, merc.maxShieldRegen);

  // refreshAp tops the buffer back to the regen value every turn.
  assert.equal(merc.shieldHp, 0);
  merc.refreshAp();
  assert.equal(merc.shieldHp, SHIELD_REGEN);
  // Spend the buffer, then a fresh turn restores it (not accumulates).
  merc.damage(SHIELD_REGEN);
  assert.equal(merc.shieldHp, 0);
  merc.refreshAp();
  assert.equal(merc.shieldHp, SHIELD_REGEN);
});

test('phase shield buffer absorbs damage before HP', () => {
  const merc = new Merc({ id: 'merc', x: 0, y: 0, maxAp: 4 });
  merc.applyGear(ITEM_ID.PHASE_SHIELD);
  merc.refreshAp();
  const hpBefore = merc.hp;
  merc.damage(SHIELD_REGEN); // fully soaked by the shield
  assert.equal(merc.hp, hpBefore);
  assert.equal(merc.shieldHp, 0);
});

test('applyGear(REGEN_MESH) sets hpRegen; refreshAp heals each turn up to maxHp', () => {
  const merc = new Merc({ id: 'merc', x: 0, y: 0, maxAp: 4 });
  merc.applyGear(ITEM_ID.REGEN_MESH);
  assert.equal(merc.gear.hpRegen, HP_REGEN);
  // Capped — second install is a no-op.
  merc.applyGear(ITEM_ID.REGEN_MESH);
  assert.equal(merc.gear.hpRegen, merc.maxHpRegen);

  merc.hp = 1; // wounded
  merc.refreshAp();
  assert.equal(merc.hp, 1 + HP_REGEN);
  // Does not exceed maxHp.
  merc.hp = merc.maxHp;
  merc.refreshAp();
  assert.equal(merc.hp, merc.maxHp);
});

test('a dead crew member regenerates nothing on refreshAp', () => {
  const merc = new Merc({ id: 'merc', x: 0, y: 0, maxAp: 4 });
  merc.applyGear(ITEM_ID.PHASE_SHIELD);
  merc.applyGear(ITEM_ID.REGEN_MESH);
  merc.damage(merc.hp); // flatline the body
  assert.equal(merc.alive, false);
  merc.refreshAp(); // must not throw on a corpse (heal/addShield would)
  assert.equal(merc.shieldHp, 0);
  assert.equal(merc.hp, 0);
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
  attacker.applyGear(ITEM_ID.RIP_ROUNDS);
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
  target.applyGear(ITEM_ID.GHOST_WEAVE);
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

test('useConsumable(MOLOTOV) returns thrown hazard descriptor', () => {
  const crew = new Merc({ id: 'merc', x: 3, y: 3, maxAp: 4 });
  crew.addConsumable(ITEM_ID.MOLOTOV);
  const result = crew.useConsumable(ITEM_ID.MOLOTOV, { dx: 1, dy: 0 });
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
  crew.addConsumable(ITEM_ID.MOLOTOV);
  assert.throws(() => crew.useConsumable(ITEM_ID.MOLOTOV), /requires aim/i);
  assert.throws(() => crew.useConsumable(ITEM_ID.MOLOTOV, { dx: 0, dy: 0 }), /invalid aim/i);
  assert.throws(() => crew.useConsumable(ITEM_ID.MOLOTOV, { dx: 2, dy: 0 }), /invalid aim/i);

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

const smokeWorld = (w = 10, h = 10) => new World(new Grid(w, h, TILE.FLOOR));

test('placeSmoke converts FLOOR tiles to SMOKE within radius', () => {
  const world = smokeWorld();
  const placed = placeSmoke(world, 5, 5, 2);
  assert.ok(placed.length > 0);
  // Center should be smoke.
  assert.equal(world.grid.tileAt(5, 5), TILE.SMOKE);
  // Corner of radius 2 (Chebyshev) should be smoke.
  assert.equal(world.grid.tileAt(3, 3), TILE.SMOKE);
  assert.equal(world.grid.tileAt(7, 7), TILE.SMOKE);
});

test('placeSmoke does not convert WALLs', () => {
  const world = smokeWorld();
  world.grid.setTile(5, 4, TILE.WALL);
  const placed = placeSmoke(world, 5, 5, 2);
  assert.equal(world.grid.tileAt(5, 4), TILE.WALL);
  assert.ok(!placed.some(p => p.x === 5 && p.y === 4));
});

test('placeSmoke handles edge of grid gracefully', () => {
  const world = smokeWorld(6, 6);
  // Place near corner — some tiles will be OOB.
  const placed = placeSmoke(world, 0, 0, 2);
  assert.ok(placed.length > 0);
  assert.equal(world.grid.tileAt(0, 0), TILE.SMOKE);
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

test('smoke clears itself after SMOKE_DURATION rounds', () => {
  const world = smokeWorld();
  placeSmoke(world, 5, 5, 1);
  assert.equal(world.grid.tileAt(5, 5), TILE.SMOKE);

  for (let i = 0; i < SMOKE_DURATION; i++) world.tickTileEffects();

  // All tiles should be back to FLOOR.
  assert.equal(world.grid.tileAt(5, 5), TILE.FLOOR);
  assert.equal(world.grid.tileAt(4, 4), TILE.FLOOR);
  assert.equal(world.grid.tileAt(6, 6), TILE.FLOOR);
});

test('smoke survives the corp turn it was thrown to blind', () => {
  // SMOKE_DURATION is measured in *rounds*, and the tick lands after the corp
  // turn. A cloud that cleared before the drones moved would be pointless.
  const world = smokeWorld();
  placeSmoke(world, 5, 5, 1);
  assert.equal(
    world.grid.tileAt(5, 5),
    TILE.SMOKE,
    'still up between placement and the round boundary'
  );
});

test('smoke over an EXIT tile restores the EXIT, not FLOOR', () => {
  const world = smokeWorld();
  world.grid.setTile(5, 5, TILE.EXIT);
  placeSmoke(world, 5, 5, 1);
  // EXIT should have been converted to SMOKE.
  assert.equal(world.grid.tileAt(5, 5), TILE.SMOKE);

  for (let i = 0; i < SMOKE_DURATION; i++) world.tickTileEffects();

  assert.equal(world.grid.tileAt(5, 5), TILE.EXIT, 'the exit must survive its own smoke cloud');
});

test('smoke leaves a burning hazard tile to its own timer', () => {
  // placeSmoke only takes FLOOR/EXIT, so a cloud thrown over fire must not
  // capture HAZARD as its restore target and strand the fire permanently.
  const world = smokeWorld();
  world.applyTileEffect(5, 5, TILE.HAZARD, 2);
  placeSmoke(world, 5, 5, 1);

  assert.equal(world.grid.tileAt(5, 5), TILE.HAZARD, 'fire is not smothered by the cloud');
  assert.equal(world.grid.tileAt(5, 4), TILE.SMOKE, 'but the tiles around it take smoke');

  world.tickTileEffects();
  world.tickTileEffects();
  assert.equal(world.grid.tileAt(5, 5), TILE.FLOOR, 'and the fire still burns out on schedule');
});

test('tickTileEffects is a no-op when nothing is active', () => {
  const world = smokeWorld(5, 5);
  assert.deepEqual(world.tickTileEffects(), []);
  assert.equal(world.grid.tileAt(2, 2), TILE.FLOOR);
});
