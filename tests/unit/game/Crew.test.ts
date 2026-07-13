/**
 * Crew base-class tests.
 *
 * Crew slots between `Entity` and the archetype classes. The behavioural
 * surface in M1 is small (callsign, flatlined, inventory/gear stubs) but the
 * contract is load-bearing: M2's Campaign reads `flatlined` to decide when to
 * end the run, M3's inventory lookup assumes the stub shape, etc. Anything
 * that drifts here corrupts campaign state silently — so we lean into
 * defensive constructor validation and pin it with tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Crew } from '../../../src/game/Crew.js';
import { Entity } from '../../../src/game/Entity.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Razor } from '../../../src/game/archetypes/Razor.js';
import { Tech } from '../../../src/game/archetypes/Tech.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import {
  FACTION,
  AP_COST,
  BASE_HIT_CHANCE,
  DODGE_CHANCE,
  DODGE_BONUS,
  TARGETING_BONUS,
  RANGED_DAMAGE,
  RANGED_DAMAGE_BONUS,
  MERC_RANGED_DAMAGE,
  MELEE_DAMAGE,
  HEAVY_MELEE_DAMAGE,
} from '../../../src/game/constants.js';
import { ITEM_ID } from '../../../src/game/items.js';
import { emptySalvage, makeSalvage, totalSalvage } from '../../../src/game/salvage.js';
import type { EntityInit, LootableEntity } from '../../../src/game/Entity.js';

const baseProps = { id: 'c', x: 0, y: 0 };

const createMockLootableEntity = (props: EntityInit): LootableEntity => {
  const entity = new Entity(props);
  (entity as LootableEntity).loot = { salvage: emptySalvage() };
  return entity as LootableEntity;
};

test('Crew extends Entity', () => {
  const c = new Crew({ ...baseProps });
  assert.ok(c instanceof Entity);
});

test('Crew defaults faction to PLAYER when omitted', () => {
  const c = new Crew({ id: 'solo', x: 1, y: 2 });
  assert.equal(c.faction, FACTION.PLAYER);
});

test('Crew accepts explicit faction override', () => {
  const c = new Crew({ id: 'spy', x: 0, y: 0, faction: FACTION.CORP });
  assert.equal(c.faction, FACTION.CORP);
});

test('Crew defaults: callsign null, flatlined false, inventory null, gear null', () => {
  const c = new Crew({ ...baseProps });
  assert.equal(c.callsign, null);
  assert.equal(c.flatlined, false);
  assert.equal(c.inventory, null);
  assert.equal(c.gear, null);
});

test('Crew accepts a callsign string and exposes it', () => {
  const c = new Crew({ ...baseProps, callsign: 'Glitch' });
  assert.equal(c.callsign, 'Glitch');
});

test('Crew rejects an empty-string callsign (crash > silent fallback)', () => {
  assert.throws(() => new Crew({ ...baseProps, callsign: '' }), /callsign/i);
});

test('Crew rejects a non-string, non-null callsign', () => {
  assert.throws(() => new Crew({ ...baseProps, callsign: 42 as unknown as string }), /callsign/i);
  assert.throws(() => new Crew({ ...baseProps, callsign: {} as unknown as string }), /callsign/i);
});

test('Crew rejects a non-boolean flatlined', () => {
  assert.throws(
    () => new Crew({ ...baseProps, flatlined: 'no' as unknown as boolean }),
    /flatlined/i
  );
  assert.throws(() => new Crew({ ...baseProps, flatlined: 1 as unknown as boolean }), /flatlined/i);
});

test('Crew passes through Entity validation (e.g. integer x,y)', () => {
  // Belt-and-braces: Crew's super() call must not eat Entity's error.
  assert.throws(() => new Crew({ ...baseProps, x: 1.5 }), /integer/i);
});

test('Merc extends Crew and accepts a callsign through the constructor', () => {
  const m = new Merc({ id: 'm', x: 0, y: 0, callsign: 'Tracer' });
  assert.ok(m instanceof Crew);
  assert.equal(m.callsign, 'Tracer');
  assert.equal(m.flatlined, false);
});

test('Merc constructed without a callsign defaults to null', () => {
  // Bare constructors still expose the default; Campaign-created crew use
  // buildCrewMember and should always have stable names.
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.equal(m.callsign, null);
});

test('Razor extends Crew and accepts a callsign through the constructor', () => {
  const r = new Razor({ id: 'r', x: 0, y: 0, callsign: 'Cipher' });
  assert.ok(r instanceof Crew);
  assert.equal(r.callsign, 'Cipher');
  assert.equal(r.flatlined, false);
});

test('Razor constructed without a callsign defaults to null', () => {
  const r = new Razor({ id: 'r', x: 0, y: 0 });
  assert.equal(r.callsign, null);
});

// --- M3: inventory solidification ----------------------------------------

test('Crew.initInventory sets inventory to typed-empty wallet + empty consumables', () => {
  const c = new Crew({ ...baseProps });
  c.initInventory();
  assert.deepEqual(c.inventory, { salvage: emptySalvage(), consumables: [] });
});

test('Crew.initInventory is idempotent (no-op if already initialized)', () => {
  const c = new Crew({ ...baseProps });
  c.initInventory();
  c.inventory!.salvage = makeSalvage({ scrap: 5 });
  c.initInventory();
  assert.equal(c.inventory!.salvage.scrap, 5, 'should not reset an already-init inventory');
});

test('Crew.collectSalvage transfers loot from adjacent corpse', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const crew = new Crew({ ...baseProps, x: 3, y: 3 });
  crew.initInventory();
  w.addEntity(crew);

  const corpse = createMockLootableEntity({
    id: 'drone-0',
    x: 4,
    y: 3,
    faction: FACTION.CORP,
    glyph: 'd',
  });
  corpse.damage(corpse.maxHp); // kill it
  corpse.loot = { salvage: makeSalvage({ scrap: 2 }) };
  w.addEntity(corpse);

  crew.collectSalvage(w, corpse);
  assert.equal(crew.inventory!.salvage.scrap, 2);
  assert.equal(totalSalvage(crew.inventory!.salvage), 2);
  assert.equal(totalSalvage(corpse.loot!.salvage), 0, 'corpse loot zeroed after collection');
  assert.equal(crew.ap, crew.maxAp - AP_COST.INTERACT, 'INTERACT AP cost applied');
});

test('Crew.collectSalvage allows corpse on the same tile (Chebyshev 0)', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const corpse = createMockLootableEntity({
    id: 'drone-0',
    x: 3,
    y: 3,
    faction: FACTION.CORP,
    glyph: 'd',
  });
  w.addEntity(corpse);
  corpse.damage(corpse.maxHp);
  corpse.loot = { salvage: makeSalvage({ scrap: 3 }) };

  const crew = new Crew({ ...baseProps, x: 4, y: 3 });
  crew.initInventory();
  w.addEntity(crew);
  w.moveEntity(crew, -1, 0);

  assert.equal(crew.x, 3);
  assert.equal(crew.y, 3);
  crew.collectSalvage(w, corpse);
  assert.equal(crew.inventory!.salvage.scrap, 3);
  assert.equal(totalSalvage(corpse.loot!.salvage), 0);
});

test('Crew.collectSalvage throws when corpse is not adjacent (Chebyshev > 1)', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const crew = new Crew({ ...baseProps, x: 3, y: 3 });
  crew.initInventory();
  w.addEntity(crew);

  const corpse = createMockLootableEntity({
    id: 'drone-0',
    x: 6,
    y: 3,
    faction: FACTION.CORP,
    glyph: 'd',
  });
  corpse.damage(corpse.maxHp);
  corpse.loot = { salvage: makeSalvage({ scrap: 1 }) };
  w.addEntity(corpse);

  assert.throws(() => crew.collectSalvage(w, corpse), /adjacent/i);
});

test('Crew.collectSalvage throws when target is still alive', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const crew = new Crew({ ...baseProps, x: 3, y: 3 });
  crew.initInventory();
  w.addEntity(crew);

  const alive = createMockLootableEntity({
    id: 'drone-0',
    x: 4,
    y: 3,
    faction: FACTION.CORP,
    glyph: 'd',
  });
  alive.loot = { salvage: makeSalvage({ scrap: 1 }) };
  w.addEntity(alive);

  assert.throws(() => crew.collectSalvage(w, alive), /alive|dead/i);
});

test('Crew.collectSalvage throws when target has no loot', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const crew = new Crew({ ...baseProps, x: 3, y: 3 });
  crew.initInventory();
  w.addEntity(crew);

  const corpse = createMockLootableEntity({
    id: 'drone-0',
    x: 4,
    y: 3,
    faction: FACTION.CORP,
    glyph: 'd',
  });
  corpse.damage(corpse.maxHp);
  w.addEntity(corpse);

  assert.throws(() => crew.collectSalvage(w, corpse), /loot/i);
});

test('Crew.collectSalvage throws when target loot is an empty wallet', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const crew = new Crew({ ...baseProps, x: 3, y: 3 });
  crew.initInventory();
  w.addEntity(crew);

  const corpse = createMockLootableEntity({
    id: 'drone-0',
    x: 4,
    y: 3,
    faction: FACTION.CORP,
    glyph: 'd',
  });
  corpse.damage(corpse.maxHp);
  corpse.loot = { salvage: emptySalvage() };
  w.addEntity(corpse);

  assert.throws(() => crew.collectSalvage(w, corpse), /salvage/i);
});

test('Crew.collectSalvage throws when crew lacks AP for INTERACT', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const crew = new Crew({ ...baseProps, x: 3, y: 3 });
  crew.initInventory();
  crew.ap = 0;
  w.addEntity(crew);

  const corpse = createMockLootableEntity({
    id: 'drone-0',
    x: 4,
    y: 3,
    faction: FACTION.CORP,
    glyph: 'd',
  });
  corpse.damage(corpse.maxHp);
  corpse.loot = { salvage: makeSalvage({ scrap: 2 }) };
  w.addEntity(corpse);

  assert.throws(() => crew.collectSalvage(w, corpse), /ap/i);
});

test('Crew.collectSalvage throws when inventory not initialized', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const crew = new Crew({ ...baseProps, x: 3, y: 3 });
  // no initInventory — inventory is null
  w.addEntity(crew);

  const corpse = createMockLootableEntity({
    id: 'drone-0',
    x: 4,
    y: 3,
    faction: FACTION.CORP,
    glyph: 'd',
  });
  corpse.damage(corpse.maxHp);
  corpse.loot = { salvage: makeSalvage({ scrap: 1 }) };
  w.addEntity(corpse);

  assert.throws(() => crew.collectSalvage(w, corpse), /inventory/i);
});

test('Crew.collectSalvage accumulates across multiple corpses', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const crew = new Crew({ ...baseProps, x: 3, y: 3, maxAp: 10 });
  crew.initInventory();
  w.addEntity(crew);

  const c1 = createMockLootableEntity({ id: 'd1', x: 4, y: 3, faction: FACTION.CORP, glyph: 'd' });
  c1.damage(c1.maxHp);
  c1.loot = { salvage: makeSalvage({ scrap: 2 }) };
  w.addEntity(c1);

  const c2 = createMockLootableEntity({ id: 'd2', x: 3, y: 4, faction: FACTION.CORP, glyph: 'd' });
  c2.damage(c2.maxHp);
  c2.loot = { salvage: makeSalvage({ scrap: 3 }) };
  w.addEntity(c2);

  crew.collectSalvage(w, c1);
  crew.collectSalvage(w, c2);
  assert.equal(crew.inventory!.salvage.scrap, 5);
  assert.equal(totalSalvage(crew.inventory!.salvage), 5);
});

// --- M4.1: corpse removal on salvage ------------------------------------

test('Crew.collectSalvage removes the stripped corpse from the world (M4.1)', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const crew = new Crew({ ...baseProps, x: 3, y: 3 });
  crew.initInventory();
  w.addEntity(crew);

  const corpse = createMockLootableEntity({
    id: 'drone-0',
    x: 4,
    y: 3,
    faction: FACTION.CORP,
    glyph: 'd',
  });
  corpse.damage(corpse.maxHp);
  corpse.loot = { salvage: makeSalvage({ scrap: 2 }) };
  w.addEntity(corpse);

  // Sanity: corpse is in the world before salvage.
  assert.equal(w.anyEntityAt(4, 3), corpse, 'corpse occupies the tile before salvage');
  assert.equal(w.lootableCorpseAt(4, 3), corpse, 'corpse is lootable before salvage');

  crew.collectSalvage(w, corpse);

  // After M4.1: corpse must be gone from the world map.
  assert.equal(w.anyEntityAt(4, 3), null, 'corpse removed from world after salvage');
  assert.equal(w.lootableCorpseAt(4, 3), null, 'no lootable corpse at the tile after salvage');
  assert.equal(w.entities.has(corpse.id), false, 'entities map no longer contains corpse id');
  // Loot was transferred before removal.
  assert.equal(crew.inventory!.salvage.scrap, 2);
});

test('Crew.collectSalvage allows another entity to step onto the freed tile', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const crew = new Crew({ ...baseProps, x: 3, y: 3 });
  crew.initInventory();
  w.addEntity(crew);

  const corpse = createMockLootableEntity({
    id: 'drone-0',
    x: 4,
    y: 3,
    faction: FACTION.CORP,
    glyph: 'd',
  });
  corpse.damage(corpse.maxHp);
  corpse.loot = { salvage: makeSalvage({ scrap: 1 }) };
  w.addEntity(corpse);

  crew.collectSalvage(w, corpse);

  // Stepping into the freed tile must not collide with the stale corpse.
  w.moveEntity(crew, 1, 0);
  assert.equal(crew.x, 4);
  assert.equal(crew.y, 3);
});

// --- Archetype base hit chance -------------------------------------------

test('Crew.baseHitChance defaults to BASE_HIT_CHANCE', () => {
  const c = new Crew({ ...baseProps });
  assert.equal(c.baseHitChance, BASE_HIT_CHANCE);
});

test('Merc.baseHitChance is 0.8', () => {
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.equal(m.baseHitChance, 0.8);
});

test('Razor.baseHitChance is 0.7', () => {
  const r = new Razor({ id: 'r', x: 0, y: 0 });
  assert.equal(r.baseHitChance, 0.7);
});

test('Tech.baseHitChance is 0.75', () => {
  const t = new Tech({ id: 't', x: 0, y: 0 });
  assert.equal(t.baseHitChance, 0.75);
});

test('Crew.rangedDamage defaults to RANGED_DAMAGE; Merc overrides', () => {
  const c = new Crew({ ...baseProps });
  assert.equal(c.rangedDamage, RANGED_DAMAGE);
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.equal(m.rangedDamage, MERC_RANGED_DAMAGE);
  const t = new Tech({ id: 't', x: 0, y: 0 });
  assert.equal(t.rangedDamage, RANGED_DAMAGE);
});

test('Crew.gearAtCap reports every limit-1 gear item saturated after one apply', () => {
  const limit1 = [
    ITEM_ID.RIP_ROUNDS,
    ITEM_ID.MONOBLADE,
    ITEM_ID.SUBDERMAL_PLATING,
    ITEM_ID.ADRENAL_SPIKE,
    ITEM_ID.PHASE_SHIELD,
    ITEM_ID.REGEN_MESH,
  ];
  for (const itemId of limit1) {
    const m = new Merc({ id: 'm', x: 0, y: 0 });
    assert.equal(m.gearAtCap(itemId), false, `${itemId} not saturated before purchase`);
    m.applyGear(itemId);
    assert.equal(m.gearAtCap(itemId), true, `${itemId} saturated after one purchase`);
  }
});

test('Crew.gearAtCap: unbounded Bone Lacing never saturates', () => {
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.equal(m.gearAtCap(ITEM_ID.BONE_LACING), false);
  m.applyGear(ITEM_ID.BONE_LACING);
  m.applyGear(ITEM_ID.BONE_LACING);
  assert.equal(m.gearAtCap(ITEM_ID.BONE_LACING), false, 'still re-purchasable after stacking');
});

test('Crew.gearAtCap: stacking gear saturates only at its per-archetype cap', () => {
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  // Targeting Chip stacks in TARGETING_BONUS steps up to (1 − baseHitChance).
  const steps = Math.round(m.maxHitBonus / TARGETING_BONUS);
  for (let i = 0; i < steps; i++) {
    assert.equal(m.gearAtCap(ITEM_ID.TARGETING_CHIP), false, `not capped at step ${i}`);
    m.applyGear(ITEM_ID.TARGETING_CHIP);
  }
  assert.equal(m.gearAtCap(ITEM_ID.TARGETING_CHIP), true, 'capped once fully stacked');
});

test('Crew.gearAtCap throws on a non-gear id (no silent false)', () => {
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.throws(() => m.gearAtCap('stim'), /unknown gear item/i);
});

test('Crew.rangedAttackDamage is archetype base plus capped RiP Rounds', () => {
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.equal(m.rangedAttackDamage(), MERC_RANGED_DAMAGE);
  m.applyGear(ITEM_ID.RIP_ROUNDS);
  assert.equal(m.rangedAttackDamage(), MERC_RANGED_DAMAGE + RANGED_DAMAGE_BONUS);
});

test('Crew.meleeDamage defaults to MELEE_DAMAGE; Razor overrides', () => {
  const c = new Crew({ ...baseProps });
  assert.equal(c.meleeDamage, MELEE_DAMAGE);
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.equal(m.meleeDamage, MELEE_DAMAGE);
  const r = new Razor({ id: 'r', x: 0, y: 0 });
  assert.equal(r.meleeDamage, HEAVY_MELEE_DAMAGE);
});

test('Crew.baseDodgeChance defaults to DODGE_CHANCE', () => {
  const c = new Crew({ ...baseProps });
  assert.equal(c.baseDodgeChance, DODGE_CHANCE);
});

test('Razor.baseDodgeChance is 0.35', () => {
  const r = new Razor({ id: 'r', x: 0, y: 0 });
  assert.equal(r.baseDodgeChance, 0.35);
});

test('Merc.baseDodgeChance uses the crew default', () => {
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.equal(m.baseDodgeChance, DODGE_CHANCE);
});

test('Crew.maxHitBonus is 1 − baseHitChance', () => {
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.equal(m.maxHitBonus, 1 - 0.8); // 0.2
  const r = new Razor({ id: 'r', x: 0, y: 0 });
  assert.equal(r.maxHitBonus, 1 - 0.7); // 0.3
});

// --- applyGear targeting chip cap ----------------------------------------

test('applyGear caps hitBonus so base + bonus cannot exceed 1.0 (Merc)', () => {
  // Merc base 0.8, max bonus 0.2 — two chips (0.2) fills the cap, third is clamped.
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  m.applyGear(ITEM_ID.TARGETING_CHIP); // 0.1
  m.applyGear(ITEM_ID.TARGETING_CHIP); // 0.2 (cap)
  m.applyGear(ITEM_ID.TARGETING_CHIP); // clamped to 0.2
  assert.equal(m.gear!.hitBonus, m.maxHitBonus);
  assert.ok(m.baseHitChance + m.gear!.hitBonus <= 1, 'total must not exceed 1.0');
});

test('applyGear caps hitBonus so base + bonus cannot exceed 1.0 (Razor)', () => {
  // Razor base 0.7, max bonus 0.3 — three chips fill the cap, fourth is clamped.
  const r = new Razor({ id: 'r', x: 0, y: 0 });
  r.applyGear(ITEM_ID.TARGETING_CHIP); // 0.1
  r.applyGear(ITEM_ID.TARGETING_CHIP); // 0.2
  r.applyGear(ITEM_ID.TARGETING_CHIP); // 0.3 (cap)
  r.applyGear(ITEM_ID.TARGETING_CHIP); // clamped to 0.3
  assert.equal(r.gear!.hitBonus, r.maxHitBonus);
  assert.ok(r.baseHitChance + r.gear!.hitBonus <= 1, 'total must not exceed 1.0');
});

test('applyGear applies full bonus when below cap', () => {
  const r = new Razor({ id: 'r', x: 0, y: 0 });
  r.applyGear(ITEM_ID.TARGETING_CHIP);
  assert.equal(r.gear!.hitBonus, TARGETING_BONUS);
  r.applyGear(ITEM_ID.TARGETING_CHIP);
  assert.equal(r.gear!.hitBonus, TARGETING_BONUS * 2);
});

test('Crew.maxDodgeBonus is 1 − baseDodgeChance', () => {
  const r = new Razor({ id: 'r', x: 0, y: 0 });
  assert.equal(r.maxDodgeBonus, 1 - 0.35);
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.equal(m.maxDodgeBonus, 1 - DODGE_CHANCE);
});

test('applyGear caps dodgeBonus so base + bonus cannot exceed 1.0 (Razor)', () => {
  const r = new Razor({ id: 'r', x: 0, y: 0 });
  for (let i = 0; i < 7; i++) r.applyGear(ITEM_ID.GHOST_WEAVE);
  assert.equal(r.gear!.dodgeBonus, r.maxDodgeBonus);
  assert.ok(r.baseDodgeChance + r.gear!.dodgeBonus <= 1);
});

test('applyGear(GHOST_WEAVE) sets dodgeBonus', () => {
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  m.applyGear(ITEM_ID.GHOST_WEAVE);
  assert.equal(m.gear!.dodgeBonus, DODGE_BONUS);
});
