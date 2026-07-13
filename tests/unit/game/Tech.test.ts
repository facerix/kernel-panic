/**
 * Tech archetype tests — Deploy Turret legality matrix and commit semantics.
 *
 * The contract mirrors the Merc and Razor perk tests: `canDeploy` is a pure
 * legality check returning `{ ok, reason }`; `deployTurret` commits the spend
 * (AP + turretReady flag) on success and throws — without mutating state —
 * on any illegal precondition. Crashing rather than silently doing nothing
 * means a bug that nullifies a deploy can't silently strand the turret token.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Tech } from '../../../src/game/archetypes/Tech.js';
import { Crew } from '../../../src/game/Crew.js';
import { Turret } from '../../../src/game/Turret.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import {
  TILE,
  FACTION,
  AP_COST,
  SALVAGE_PER_IMPROVISED_TURRET,
  TURRET_DAMAGE,
  RANGED_DAMAGE_BONUS,
} from '../../../src/game/constants.js';
import { ITEM_ID } from '../../../src/game/items.js';
import { makeSalvage, totalSalvage } from '../../../src/game/salvage.js';

function makeWorld({ techAt = [3, 3], grid, extraEntities = [] } = {}) {
  const g = grid ?? new Grid(8, 8);
  const w = new World(g);
  const tech = new Tech({ id: 'tech', x: techAt[0], y: techAt[1] });
  w.addEntity(tech);
  for (const e of extraEntities) w.addEntity(e);
  return { world: w, tech };
}

test('Tech inherits from Crew and starts with turretReady = true', () => {
  const t = new Tech({ id: 't', x: 0, y: 0 });
  assert.ok(t instanceof Crew, 'Tech must extend Crew');
  assert.equal(t.faction, FACTION.PLAYER);
  assert.equal(t.turretReady, true);
});

test('Tech.canDeploy rejects (0, 0) as no-op', () => {
  const { world, tech } = makeWorld();
  assert.equal(tech.canDeploy(world, 0, 0).reason, 'no-op');
});

test('Tech.canDeploy rejects offsets larger than 1 (Chebyshev adjacency)', () => {
  const { world, tech } = makeWorld();
  assert.equal(tech.canDeploy(world, 2, 0).reason, 'too-far');
  assert.equal(tech.canDeploy(world, 0, -2).reason, 'too-far');
});

test('Tech.canDeploy rejects non-integer offsets (data-corruption guard)', () => {
  // Crash > silent fallback — a fractional offset is data corruption, not a
  // gameplay quirk we want to clamp.
  const { world, tech } = makeWorld();
  assert.throws(() => tech.canDeploy(world, 0.5, 0), /integer/i);
});

test('Tech.canDeploy rejects when AP < DEPLOY cost', () => {
  const { world, tech } = makeWorld();
  // Drain to one AP shy of DEPLOY.
  tech.spendAp(tech.ap - (AP_COST.DEPLOY - 1));
  assert.equal(tech.canDeploy(world, 1, 0).reason, 'insufficient-ap');
});

test('Tech.canDeploy rejects when turretReady is false', () => {
  const { world, tech } = makeWorld();
  tech.turretReady = false;
  assert.equal(tech.canDeploy(world, 1, 0).reason, 'no-turret');
});

test('Tech.canDeploy rejects if the target tile is out of bounds', () => {
  const g = new Grid(5, 5);
  const { world, tech } = makeWorld({ grid: g, techAt: [4, 4] });
  // Target (5, 4) is OOB.
  assert.equal(tech.canDeploy(world, 1, 0).reason, 'out-of-bounds');
});

test('Tech.canDeploy rejects if the target tile is a wall', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.WALL);
  const { world, tech } = makeWorld({ grid: g });
  assert.equal(tech.canDeploy(world, 1, 0).reason, 'blocked');
});

test('Tech.canDeploy rejects if the target tile is cover', () => {
  // Turrets sit on solid ground; you can't stack one on a half-wall.
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  const { world, tech } = makeWorld({ grid: g });
  assert.equal(tech.canDeploy(world, 1, 0).reason, 'blocked');
});

test('Tech.canDeploy rejects if the target tile is occupied', () => {
  const drone = new Entity({ id: 'd', x: 4, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const { world, tech } = makeWorld({ extraEntities: [drone] });
  assert.equal(tech.canDeploy(world, 1, 0).reason, 'occupied');
});

test('Tech.canDeploy accepts a clean orthogonal adjacent floor tile', () => {
  const { world, tech } = makeWorld();
  assert.equal(tech.canDeploy(world, 1, 0).ok, true);
});

test('Tech.canDeploy accepts a clean diagonal adjacent floor tile', () => {
  const { world, tech } = makeWorld();
  assert.equal(tech.canDeploy(world, 1, 1).ok, true);
});

test('Tech.deployTurret places a Turret on the target tile and debits AP', () => {
  const { world, tech } = makeWorld();
  const apBefore = tech.ap;
  const turret = tech.deployTurret(world, 1, 0);
  assert.ok(turret instanceof Turret);
  assert.equal(turret.x, 4);
  assert.equal(turret.y, 3);
  assert.equal(turret.faction, FACTION.PLAYER);
  assert.equal(turret.ownerId, tech.id);
  assert.equal(tech.ap, apBefore - AP_COST.DEPLOY);
  assert.equal(tech.turretReady, false, 'turretReady consumed on commit');
  // The turret must now be a live grid entity.
  assert.equal(world.entityAt(4, 3), turret);
});

test('Tech.deployTurret sets turret maxHp to owner maxHp (Bone Lacing)', () => {
  const { world, tech } = makeWorld();
  tech.applyGear(ITEM_ID.BONE_LACING);
  const turret = tech.deployTurret(world, 1, 0);
  assert.equal(turret.maxHp, tech.maxHp);
  assert.equal(turret.hp, tech.maxHp);
});

test('Tech.deployTurret applies RiP Rounds to attackDamage', () => {
  const { world, tech } = makeWorld();
  tech.applyGear(ITEM_ID.RIP_ROUNDS);
  const turret = tech.deployTurret(world, 1, 0);
  assert.equal(turret.attackDamage, TURRET_DAMAGE + RANGED_DAMAGE_BONUS);
});

test('Tech.deployTurret throws on illegal preconditions and leaves state untouched', () => {
  const { world, tech } = makeWorld(); // 8×8 grid, plenty of room
  // Trip an illegal deploy: target a non-adjacent tile.
  const apBefore = tech.ap;
  const readyBefore = tech.turretReady;
  assert.throws(() => tech.deployTurret(world, 2, 0), /Illegal deploy/);
  assert.equal(tech.ap, apBefore, 'AP not debited on illegal deploy');
  assert.equal(tech.turretReady, readyBefore, 'turretReady preserved on illegal deploy');
  assert.equal(world.entityAt(5, 3), null, 'no stray turret placed');
});

test('Tech.deployTurret blocks a second deploy in the same job (no double-drop)', () => {
  const { world, tech } = makeWorld();
  tech.deployTurret(world, 1, 0); // ok
  // Replenish AP so the second deploy fails on the turret token, not AP.
  tech.refreshAp();
  assert.equal(tech.canDeploy(world, 0, 1).reason, 'no-turret');
  // And a commit attempt throws.
  assert.throws(() => tech.deployTurret(world, 0, 1), /no-turret/);
});

// --- M3: improvised turrets -----------------------------------------------

function makeWorldWithInventory({ techAt = [3, 3], grid, salvage = 4, extraEntities = [] } = {}) {
  const g = grid ?? new Grid(8, 8);
  const w = new World(g);
  const tech = new Tech({ id: 'tech', x: techAt[0], y: techAt[1] });
  tech.initInventory();
  // M4.2: improvised turrets cost scrap specifically. The `salvage` knob in
  // this helper now drives the scrap bucket so the existing test names ("with
  // salvage", "no salvage") keep their original meaning.
  tech.inventory.salvage = makeSalvage({ scrap: salvage });
  w.addEntity(tech);
  for (const e of extraEntities) w.addEntity(e);
  return { world: w, tech };
}

test('Tech.canImproviseTurret accepts when salvage >= cost and tile is legal', () => {
  const { world, tech } = makeWorldWithInventory({ salvage: SALVAGE_PER_IMPROVISED_TURRET });
  // Pre-built turret already deployed.
  tech.turretReady = false;
  const check = tech.canImproviseTurret(world, 1, 0);
  assert.equal(check.ok, true);
});

test('Tech.canImproviseTurret rejects when inventory not initialised', () => {
  const { world, tech } = makeWorld(); // null inventory
  tech.turretReady = false;
  const check = tech.canImproviseTurret(world, 1, 0);
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'no-inventory');
});

test('Tech.canImproviseTurret rejects when salvage < cost', () => {
  const { world, tech } = makeWorldWithInventory({ salvage: SALVAGE_PER_IMPROVISED_TURRET - 1 });
  tech.turretReady = false;
  const check = tech.canImproviseTurret(world, 1, 0);
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'insufficient-salvage');
});

test('Tech.canImproviseTurret rejects when AP < DEPLOY cost', () => {
  const { world, tech } = makeWorldWithInventory();
  tech.turretReady = false;
  tech.spendAp(tech.ap - (AP_COST.DEPLOY - 1));
  const check = tech.canImproviseTurret(world, 1, 0);
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'insufficient-ap');
});

test('Tech.canImproviseTurret rejects out-of-bounds tile', () => {
  const g = new Grid(5, 5);
  const { world, tech } = makeWorldWithInventory({ grid: g, techAt: [4, 4] });
  tech.turretReady = false;
  assert.equal(tech.canImproviseTurret(world, 1, 0).reason, 'out-of-bounds');
});

test('Tech.canImproviseTurret rejects occupied tile', () => {
  const drone = new Entity({ id: 'd', x: 4, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const { world, tech } = makeWorldWithInventory({ extraEntities: [drone] });
  tech.turretReady = false;
  assert.equal(tech.canImproviseTurret(world, 1, 0).reason, 'occupied');
});

test('Tech.improviseTurret commits: deducts salvage + AP, places turret', () => {
  const { world, tech } = makeWorldWithInventory({ salvage: 4 });
  tech.turretReady = false;
  const apBefore = tech.ap;
  const scrapBefore = tech.inventory.salvage.scrap;
  const turret = tech.improviseTurret(world, 1, 0);
  assert.ok(turret instanceof Turret);
  assert.equal(turret.x, 4);
  assert.equal(turret.y, 3);
  assert.equal(turret.faction, FACTION.PLAYER);
  assert.equal(tech.ap, apBefore - AP_COST.DEPLOY);
  assert.equal(
    tech.inventory.salvage.scrap,
    scrapBefore - SALVAGE_PER_IMPROVISED_TURRET,
    'scrap deducted by improvise cost'
  );
  assert.equal(world.entityAt(4, 3), turret);
});

test('Tech.improviseTurret throws on illegal pre-conditions without mutating state', () => {
  const { world, tech } = makeWorldWithInventory({ salvage: 0 });
  tech.turretReady = false;
  const apBefore = tech.ap;
  assert.throws(() => tech.improviseTurret(world, 1, 0), /Illegal/);
  assert.equal(tech.ap, apBefore, 'AP not debited on illegal improvise');
  assert.equal(
    totalSalvage(tech.inventory.salvage),
    0,
    'salvage wallet untouched on illegal improvise'
  );
});

test('Tech.improviseTurret uses unique turret ids for multiple placements', () => {
  const { world, tech } = makeWorldWithInventory({ salvage: 10 });
  tech.turretReady = false;
  const t1 = tech.improviseTurret(world, 1, 0);
  tech.refreshAp();
  const t2 = tech.improviseTurret(world, 0, 1);
  assert.notEqual(t1.id, t2.id, 'turret ids must be unique');
  assert.equal(world.entityAt(4, 3), t1);
  assert.equal(world.entityAt(3, 4), t2);
});
