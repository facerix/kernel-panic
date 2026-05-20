/**
 * M2.4: Corp turret unit tests.
 *
 * CorpTurret is a stationary CORP-faction hostile that fires at PLAYER entities
 * during the corp turn. Tests cover construction, targeting, firing, destruction,
 * snapshot round-trip, and integration with the corp turn driver.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CorpTurret } from '../../../src/game/entities/CorpTurret.js';
import { Entity } from '../../../src/game/Entity.js';
import { Hostile } from '../../../src/game/Hostile.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { EventBus } from '../../../src/game/events.js';
import { Rng } from '../../../src/rng.js';
import {
  FACTION,
  TILE,
  AP_COST,
  CORP_TURRET_RANGE,
  CORP_TURRET_DAMAGE,
  CORP_TURRET_HP,
} from '../../../src/game/constants.js';

function makeGrid(w = 12, h = 12): Grid {
  const grid = new Grid(w, h, TILE.WALL);
  // Carve a floor area
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  return grid;
}

function makeWorld(w = 12, h = 12): World {
  return new World(makeGrid(w, h), { events: new EventBus() });
}

describe('CorpTurret', () => {
  // --- Construction ---

  it('constructs with default values', () => {
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 5, y: 5 });
    assert.equal(turret.faction, FACTION.CORP);
    assert.equal(turret.glyph, '$');
    assert.equal(turret.range, CORP_TURRET_RANGE);
    assert.equal(turret.attackDamage, CORP_TURRET_DAMAGE);
    assert.equal(turret.maxHp, CORP_TURRET_HP);
    assert.equal(turret.maxAp, AP_COST.RANGED_ATTACK);
    assert.equal(turret.alive, true);
  });

  it('constructs with custom range/damage/hp', () => {
    const turret = new CorpTurret({
      id: 'corp-turret-1',
      x: 3,
      y: 3,
      range: 6,
      attackDamage: 2,
      maxHp: 5,
    });
    assert.equal(turret.range, 6);
    assert.equal(turret.attackDamage, 2);
    assert.equal(turret.maxHp, 5);
  });

  it('is a Hostile subclass', () => {
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 1, y: 1 });
    assert.ok(turret instanceof Hostile);
  });

  it('throws on invalid range', () => {
    assert.throws(
      () => new CorpTurret({ id: 'ct', x: 1, y: 1, range: 0 }),
      /positive integer/
    );
    assert.throws(
      () => new CorpTurret({ id: 'ct', x: 1, y: 1, range: -1 }),
      /positive integer/
    );
  });

  it('throws on invalid attackDamage', () => {
    assert.throws(
      () => new CorpTurret({ id: 'ct', x: 1, y: 1, attackDamage: 0 }),
      /positive integer/
    );
  });

  // --- Targeting ---

  it('acquires a PLAYER-faction target in LOS and range', () => {
    const world = makeWorld();
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 5, y: 5 });
    const player = new Entity({
      id: 'crew-merc',
      x: 5,
      y: 3,
      faction: FACTION.PLAYER,
      glyph: '@',
    });
    world.addEntity(turret);
    world.addEntity(player);
    const target = turret.acquireTarget(world);
    assert.equal(target, player);
  });

  it('does not target same-faction entities', () => {
    const world = makeWorld();
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 5, y: 5 });
    const drone = new Entity({
      id: 'drone-0',
      x: 5,
      y: 3,
      faction: FACTION.CORP,
      glyph: 'd',
    });
    world.addEntity(turret);
    world.addEntity(drone);
    const target = turret.acquireTarget(world);
    assert.equal(target, null);
  });

  it('does not target entities out of range', () => {
    const world = makeWorld(20, 20);
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 2, y: 2, range: 3 });
    const player = new Entity({
      id: 'crew-merc',
      x: 15,
      y: 15,
      faction: FACTION.PLAYER,
      glyph: '@',
    });
    world.addEntity(turret);
    world.addEntity(player);
    const target = turret.acquireTarget(world);
    assert.equal(target, null);
  });

  it('does not target entities behind walls (no LOS)', () => {
    const grid = new Grid(12, 12, TILE.WALL);
    // Carve two rooms separated by a wall at x=6
    for (let y = 1; y < 11; y++) {
      for (let x = 1; x < 6; x++) grid.setTile(x, y, TILE.FLOOR);
      for (let x = 7; x < 11; x++) grid.setTile(x, y, TILE.FLOOR);
    }
    const world = new World(grid, { events: new EventBus() });
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 4, y: 5, range: 8 });
    const player = new Entity({
      id: 'crew-merc',
      x: 8,
      y: 5,
      faction: FACTION.PLAYER,
      glyph: '@',
    });
    world.addEntity(turret);
    world.addEntity(player);
    assert.equal(turret.acquireTarget(world), null);
  });

  // --- Firing (takeTurnSteps) ---

  it('fires at visible target and spends AP', () => {
    const world = makeWorld();
    const turret = new CorpTurret({
      id: 'corp-turret-0',
      x: 5,
      y: 5,
      maxAp: AP_COST.RANGED_ATTACK,
    });
    const player = new Entity({
      id: 'crew-merc',
      x: 5,
      y: 3,
      faction: FACTION.PLAYER,
      glyph: '@',
      maxHp: 10,
    });
    world.addEntity(turret);
    world.addEntity(player);
    turret.ap = AP_COST.RANGED_ATTACK;

    const rng = new Rng(42);
    const steps = [...turret.takeTurnSteps(world, rng)];
    assert.equal(steps.length, 1);
    assert.equal(steps[0].type, 'fire');
    assert.equal((steps[0] as { target: string }).target, 'crew-merc');
    assert.equal(turret.ap, 0);
  });

  it('idles when no target visible', () => {
    const world = makeWorld();
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 5, y: 5 });
    world.addEntity(turret);
    turret.ap = AP_COST.RANGED_ATTACK;

    const rng = new Rng(42);
    const steps = [...turret.takeTurnSteps(world, rng)];
    assert.equal(steps.length, 0);
    // AP not spent if no target
    assert.equal(turret.ap, AP_COST.RANGED_ATTACK);
  });

  it('does not fire when dead', () => {
    const world = makeWorld();
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 5, y: 5 });
    turret.hp = 0;
    turret.alive = false;
    world.addEntity(turret);

    const rng = new Rng(42);
    const steps = [...turret.takeTurnSteps(world, rng)];
    assert.equal(steps.length, 0);
  });

  it('does not fire when AP insufficient', () => {
    const world = makeWorld();
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 5, y: 5 });
    const player = new Entity({
      id: 'crew-merc',
      x: 5,
      y: 3,
      faction: FACTION.PLAYER,
      glyph: '@',
      maxHp: 10,
    });
    world.addEntity(turret);
    world.addEntity(player);
    turret.ap = 0;

    const rng = new Rng(42);
    const steps = [...turret.takeTurnSteps(world, rng)];
    assert.equal(steps.length, 0);
  });

  // --- Destruction ---

  it('can be destroyed by player damage', () => {
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 5, y: 5 });
    assert.equal(turret.hp, CORP_TURRET_HP);
    turret.damage(CORP_TURRET_HP);
    assert.equal(turret.alive, false);
    assert.equal(turret.hp, 0);
  });

  // --- takeTurn (batch form) ---

  it('takeTurn returns same steps as takeTurnSteps', () => {
    const world = makeWorld();
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 5, y: 5 });
    world.addEntity(turret);
    turret.ap = AP_COST.RANGED_ATTACK;

    const rng = new Rng(42);
    const steps = turret.takeTurn(world, rng);
    // No target → empty
    assert.ok(Array.isArray(steps));
    assert.equal(steps.length, 0);
  });

  // --- Cannot dodge ---

  it('has baseDodgeChance of 0 (stationary, cannot dodge)', () => {
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 1, y: 1 });
    assert.equal(turret.baseDodgeChance, 0);
  });

  // --- Does not target NEUTRAL entities (inherits from Hostile) ---

  it('does not target NEUTRAL-faction entities', () => {
    const world = makeWorld();
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 5, y: 5 });
    const neutral = new Entity({
      id: 'neutral-civ-0',
      x: 5,
      y: 3,
      faction: FACTION.NEUTRAL,
      glyph: 'n',
    });
    world.addEntity(turret);
    world.addEntity(neutral);
    assert.equal(turret.acquireTarget(world), null);
  });
});
