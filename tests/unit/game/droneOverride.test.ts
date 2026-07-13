/**
 * Drone Override module tests (P3.5.M2 relocation).
 *
 * This coverage used to live in `Decker.test.ts`, exercised through the Decker's
 * `canOverride`/`overrideDrone` delegators. M2 removed those delegators (the
 * Decker's Meatspace perk is now EMP), so this file tests the `droneOverride`
 * module functions *directly* against a generic PLAYER-faction operator — the
 * mechanic is faction-agnostic and never depended on the Decker specifically.
 * M4 renames this module to `mindInfluence.ts` (the Adept's Influence perk) and
 * this file moves with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import {
  canOverride,
  overrideDrone,
  applyOverride,
  stepOverriddenDrones,
} from '../../../src/game/droneOverride.js';
import { TILE, FACTION, AP_COST, OVERRIDE_DURATION } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';

function makeWorld({ operatorAt = [1, 1], grid, extraEntities = [] } = {}) {
  const g = grid ?? new Grid(12, 12);
  const w = new World(g);
  // A generic PLAYER-faction operator — the module only needs alive/canAfford/
  // x,y/faction/spendAp, none of which are Decker-specific.
  const operator = new Entity({
    id: 'operator',
    x: operatorAt[0],
    y: operatorAt[1],
    faction: FACTION.PLAYER,
    glyph: '@',
  });
  w.addEntity(operator);
  for (const e of extraEntities) w.addEntity(e);
  return { world: w, operator };
}

function makeDrone(id, x, y, faction = FACTION.CORP) {
  return new Skirmisher({ id, x, y, faction });
}

// Deterministic single-roll stubs: 0.1 < success chance → hijack; 0.9 → fail.
const winRng = { next: () => 0.1 };
const loseRng = { next: () => 0.9 };

// --- canOverride legality matrix -------------------------------------------

test('canOverride accepts a live in-range LOS corp drone', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  assert.equal(canOverride(world, operator, drone).ok, true);
});

test('canOverride rejects a null / non-Hostile target as not-overridable', () => {
  const prop = new Entity({ id: 'prop', x: 2, y: 1, faction: FACTION.CORP, glyph: '#' });
  const { world, operator } = makeWorld({ extraEntities: [prop] });
  assert.equal(canOverride(world, operator, null).reason, 'not-overridable');
  assert.equal(canOverride(world, operator, prop).reason, 'not-overridable');
});

test('canOverride rejects when the operator is dead', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  operator.alive = false;
  assert.equal(canOverride(world, operator, drone).reason, 'dead');
});

test('canOverride rejects when AP < OVERRIDE cost', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  operator.spendAp(operator.ap - (AP_COST.OVERRIDE - 1));
  assert.equal(canOverride(world, operator, drone).reason, 'insufficient-ap');
});

test('canOverride rejects a dead target drone', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  drone.alive = false;
  assert.equal(canOverride(world, operator, drone).reason, 'dead-target');
});

test('canOverride rejects a drone that is already overridden', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  applyOverride(drone, FACTION.PLAYER);
  assert.equal(canOverride(world, operator, drone).reason, 'already-overridden');
});

test('canOverride rejects a same-faction (already player-aligned) drone', () => {
  const drone = makeDrone('k', 3, 1, FACTION.PLAYER);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  assert.equal(canOverride(world, operator, drone).reason, 'friendly');
});

test('canOverride rejects an out-of-range drone', () => {
  const drone = makeDrone('k', 9, 1); // distance 8 > OVERRIDE_RANGE (5)
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  assert.equal(canOverride(world, operator, drone).reason, 'out-of-range');
});

test('canOverride rejects a drone behind a wall (no LOS)', () => {
  const g = new Grid(12, 12);
  g.setTile(2, 1, TILE.WALL);
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ grid: g, extraEntities: [drone] });
  assert.equal(canOverride(world, operator, drone).reason, 'no-los');
});

// --- overrideDrone commit semantics ----------------------------------------

test('overrideDrone success flips the drone to PLAYER for the full duration', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  const apBefore = operator.ap;
  const result = overrideDrone(world, operator, drone, winRng);
  assert.equal(result.success, true);
  assert.equal(result.alarm, false);
  assert.equal(drone.faction, FACTION.PLAYER);
  assert.equal(drone.factionBeforeOverride, FACTION.CORP);
  assert.equal(drone.overrideTurnsRemaining, OVERRIDE_DURATION);
  assert.equal(drone.isOverridden, true);
  assert.equal(operator.ap, apBefore - AP_COST.OVERRIDE);
});

test('overrideDrone failure burns AP, trips the alarm, leaves faction intact', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  const apBefore = operator.ap;
  assert.equal(world.alarmActive, false);
  const result = overrideDrone(world, operator, drone, loseRng);
  assert.equal(result.success, false);
  assert.equal(result.alarm, true);
  assert.equal(world.alarmActive, true);
  assert.equal(drone.faction, FACTION.CORP);
  assert.equal(drone.isOverridden, false);
  assert.equal(operator.ap, apBefore - AP_COST.OVERRIDE);
});

test('overrideDrone throws on an illegal attempt without burning AP', () => {
  const drone = makeDrone('k', 9, 1); // out of range
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  const apBefore = operator.ap;
  assert.throws(() => overrideDrone(world, operator, drone, winRng), /Illegal override/);
  assert.equal(operator.ap, apBefore, 'AP not debited on illegal override');
  assert.equal(drone.faction, FACTION.CORP);
});

// --- golden path: hijacked drone fights corp, then reverts -----------------

test('an overridden drone attacks corp allies for N turns then reverts', () => {
  const drone = makeDrone('hijacked', 4, 4);
  const victim = makeDrone('victim', 6, 4); // corp; the drone's new enemy
  const { world, operator } = makeWorld({ operatorAt: [2, 4], extraEntities: [drone, victim] });

  const result = overrideDrone(world, operator, drone, winRng);
  assert.equal(result.success, true);

  const rng = new Rng(7);
  const victimHpStart = victim.hp;
  let sawEngageAction = false;
  let expired = false;
  for (let turn = 0; turn < OVERRIDE_DURATION; turn++) {
    assert.equal(drone.faction, FACTION.PLAYER, `drone should be player-aligned on turn ${turn}`);
    drone.refreshAp();
    for (const { entity, action } of stepOverriddenDrones(world, rng)) {
      assert.equal(entity.id, drone.id);
      if (action.type === 'fire' || String(action.type).startsWith('move')) {
        sawEngageAction = true;
      }
      if (action.type === 'override-expired') expired = true;
    }
  }

  assert.ok(sawEngageAction, 'hijacked drone should engage (fire/move) against corp');
  assert.ok(expired, 'override should emit an override-expired action when it lapses');
  assert.equal(drone.isOverridden, false, 'override countdown should be spent');
  assert.equal(drone.faction, FACTION.CORP, 'drone reverts to its original faction');
  assert.equal(drone.factionBeforeOverride, null, 'override bookkeeping cleared on revert');
  assert.ok(victim.hp <= victimHpStart, 'corp victim took fire from the hijacked drone');
});
