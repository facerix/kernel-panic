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
import { FACTION, AP_COST, BASE_HIT_CHANCE, TARGETING_BONUS } from '../../../src/game/constants.js';
import { ITEM_ID } from '../../../src/game/items.js';
import type { EntityInit, LootableEntity } from '../../../src/game/Entity.js';

const baseProps = { id: 'c', x: 0, y: 0 };

const createMockLootableEntity = (props: EntityInit): LootableEntity => {
  const entity = new Entity(props);
  (entity as LootableEntity).loot = { salvage: 0 };
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

test('Crew.initInventory sets inventory to { salvage: 0, consumables: [] }', () => {
  const c = new Crew({ ...baseProps });
  c.initInventory();
  assert.deepEqual(c.inventory, { salvage: 0, consumables: [] });
});

test('Crew.initInventory is idempotent (no-op if already initialized)', () => {
  const c = new Crew({ ...baseProps });
  c.initInventory();
  c.inventory!.salvage = 5;
  c.initInventory();
  assert.equal(c.inventory!.salvage, 5, 'should not reset an already-init inventory');
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
  corpse.loot = { salvage: 2 };
  w.addEntity(corpse);

  crew.collectSalvage(w, corpse);
  assert.equal(crew.inventory!.salvage, 2);
  assert.equal(corpse.loot!.salvage, 0, 'corpse loot zeroed after collection');
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
  corpse.loot = { salvage: 3 };

  const crew = new Crew({ ...baseProps, x: 4, y: 3 });
  crew.initInventory();
  w.addEntity(crew);
  w.moveEntity(crew, -1, 0);

  assert.equal(crew.x, 3);
  assert.equal(crew.y, 3);
  crew.collectSalvage(w, corpse);
  assert.equal(crew.inventory!.salvage, 3);
  assert.equal(corpse.loot!.salvage, 0);
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
  corpse.loot = { salvage: 1 };
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
  alive.loot = { salvage: 1 };
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

test('Crew.collectSalvage throws when target loot.salvage is 0', () => {
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
  corpse.loot = { salvage: 0 };
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
  corpse.loot = { salvage: 2 };
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
  corpse.loot = { salvage: 1 };
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
  c1.loot = { salvage: 2 };
  w.addEntity(c1);

  const c2 = createMockLootableEntity({ id: 'd2', x: 3, y: 4, faction: FACTION.CORP, glyph: 'd' });
  c2.damage(c2.maxHp);
  c2.loot = { salvage: 3 };
  w.addEntity(c2);

  crew.collectSalvage(w, c1);
  crew.collectSalvage(w, c2);
  assert.equal(crew.inventory!.salvage, 5);
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
