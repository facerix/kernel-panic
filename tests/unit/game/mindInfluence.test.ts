/**
 * Mind Influence module tests (P3.5.M4 rename from `droneOverride.test.ts`).
 *
 * This coverage used to live in `Decker.test.ts`, then moved standalone in
 * P3.5.M2 once the Decker's Meatspace perk became EMP (the module kept
 * serving only the CyberAvatar's cyber-grid Override in the interim). M4
 * renames the module to `mindInfluence.ts` and gives it a permanent Meatspace
 * owner (the Adept's Influence perk) — this file moves and renames with it,
 * still testing the pure functions *directly* against a generic PLAYER-
 * faction operator: the mechanic is faction-agnostic and never depended on
 * any specific archetype.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import {
  canInfluence,
  influenceTarget,
  applyOverride,
  stepInfluencedHostiles,
} from '../../../src/game/mindInfluence.js';
import { TILE, FACTION, AP_COST, INFLUENCE_DURATION } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';

function makeWorld({
  operatorAt = [1, 1],
  grid,
  extraEntities = [],
}: { operatorAt?: [number, number]; grid?: Grid; extraEntities?: Entity[] } = {}) {
  const g = grid ?? new Grid(12, 12);
  const w = new World(g);
  // A generic PLAYER-faction operator — the module only needs alive/canAfford/
  // x,y/faction/spendAp, none of which are archetype-specific.
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

function makeDrone(
  id: string,
  x: number,
  y: number,
  faction: ConstructorParameters<typeof Skirmisher>[0]['faction'] = FACTION.CORP
) {
  return new Skirmisher({ id, x, y, faction });
}

// Deterministic single-roll stubs: 0.1 < success chance → dominate; 0.9 → fail.
const winRng = { next: () => 0.1 };
const loseRng = { next: () => 0.9 };

// --- canInfluence legality matrix -------------------------------------------

test('canInfluence accepts a live in-range LOS corp hostile', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  assert.equal(canInfluence(world, operator, drone).ok, true);
});

test('canInfluence rejects a null / non-Hostile target as not-overridable', () => {
  const prop = new Entity({ id: 'prop', x: 2, y: 1, faction: FACTION.CORP, glyph: '#' });
  const { world, operator } = makeWorld({ extraEntities: [prop] });
  assert.equal(canInfluence(world, operator, null).reason, 'not-overridable');
  assert.equal(canInfluence(world, operator, prop).reason, 'not-overridable');
});

test('canInfluence rejects when the operator is dead', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  operator.alive = false;
  assert.equal(canInfluence(world, operator, drone).reason, 'dead');
});

test('canInfluence rejects when AP < INFLUENCE cost', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  operator.spendAp(operator.ap - (AP_COST.INFLUENCE - 1));
  assert.equal(canInfluence(world, operator, drone).reason, 'insufficient-ap');
});

test('canInfluence rejects a dead target', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  drone.alive = false;
  assert.equal(canInfluence(world, operator, drone).reason, 'dead-target');
});

test('canInfluence rejects a target that is already dominated', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  applyOverride(drone, FACTION.PLAYER);
  assert.equal(canInfluence(world, operator, drone).reason, 'already-overridden');
});

test('canInfluence rejects a same-faction (already player-aligned) target', () => {
  const drone = makeDrone('k', 3, 1, FACTION.PLAYER);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  assert.equal(canInfluence(world, operator, drone).reason, 'friendly');
});

test('canInfluence rejects an out-of-range target', () => {
  const drone = makeDrone('k', 9, 1); // distance 8 > INFLUENCE_RANGE (5)
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  assert.equal(canInfluence(world, operator, drone).reason, 'out-of-range');
});

test('canInfluence rejects a target behind a wall (no LOS)', () => {
  const g = new Grid(12, 12);
  g.setTile(2, 1, TILE.WALL);
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ grid: g, extraEntities: [drone] });
  assert.equal(canInfluence(world, operator, drone).reason, 'no-los');
});

// --- influenceTarget commit semantics ---------------------------------------

test('influenceTarget success flips the target to PLAYER for the full duration', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  const apBefore = operator.ap;
  const result = influenceTarget(world, operator, drone, winRng);
  assert.equal(result.success, true);
  assert.equal(result.alarm, false);
  assert.equal(drone.faction, FACTION.PLAYER);
  assert.equal(drone.factionBeforeOverride, FACTION.CORP);
  assert.equal(drone.overrideTurnsRemaining, INFLUENCE_DURATION);
  assert.equal(drone.isOverridden, true);
  assert.equal(operator.ap, apBefore - AP_COST.INFLUENCE);
});

test('influenceTarget failure burns AP, trips the alarm, leaves faction intact', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  const apBefore = operator.ap;
  assert.equal(world.alarmActive, false);
  const result = influenceTarget(world, operator, drone, loseRng);
  assert.equal(result.success, false);
  assert.equal(result.alarm, true);
  assert.equal(world.alarmActive, true);
  assert.equal(drone.faction, FACTION.CORP);
  assert.equal(drone.isOverridden, false);
  assert.equal(operator.ap, apBefore - AP_COST.INFLUENCE);
});

test('influenceTarget throws on an illegal attempt without burning AP', () => {
  const drone = makeDrone('k', 9, 1); // out of range
  const { world, operator } = makeWorld({ extraEntities: [drone] });
  const apBefore = operator.ap;
  assert.throws(() => influenceTarget(world, operator, drone, winRng), /Illegal override/);
  assert.equal(operator.ap, apBefore, 'AP not debited on illegal influence');
  assert.equal(drone.faction, FACTION.CORP);
});

// --- golden path: dominated hostile fights corp, then reverts ---------------

test('a dominated hostile attacks corp allies for N turns then reverts', () => {
  const drone = makeDrone('hijacked', 4, 4);
  const victim = makeDrone('victim', 6, 4); // corp; the drone's new enemy
  const { world, operator } = makeWorld({ operatorAt: [2, 4], extraEntities: [drone, victim] });

  const result = influenceTarget(world, operator, drone, winRng);
  assert.equal(result.success, true);

  const rng = new Rng(7);
  const victimHpStart = victim.hp;
  let sawEngageAction = false;
  let expired = false;
  for (let turn = 0; turn < INFLUENCE_DURATION; turn++) {
    assert.equal(drone.faction, FACTION.PLAYER, `drone should be player-aligned on turn ${turn}`);
    drone.refreshAp();
    for (const { entity, action } of stepInfluencedHostiles(world, rng)) {
      assert.equal(entity.id, drone.id);
      if (action.type === 'fire' || String(action.type).startsWith('move')) {
        sawEngageAction = true;
      }
      if (action.type === 'override-expired') expired = true;
    }
  }

  assert.ok(sawEngageAction, 'dominated hostile should engage (fire/move) against corp');
  assert.ok(expired, 'influence should emit an override-expired action when it lapses');
  assert.equal(drone.isOverridden, false, 'influence countdown should be spent');
  assert.equal(drone.faction, FACTION.CORP, 'drone reverts to its original faction');
  assert.equal(drone.factionBeforeOverride, null, 'override bookkeeping cleared on revert');
  assert.ok(victim.hp <= victimHpStart, 'corp victim took fire from the dominated hostile');
});
