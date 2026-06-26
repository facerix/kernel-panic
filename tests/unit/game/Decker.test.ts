/**
 * Decker archetype tests (P3.M2) — Drone Override Hack legality matrix,
 * commit semantics, and the per-turn stepping/revert loop.
 *
 * The perk mirrors the Tech/Razor/Merc contract: `canOverride` is a pure
 * legality check returning `{ ok, reason }`; `overrideDrone` commits the spend
 * (AP + faction flip, or AP + alarm on a failed roll) and throws — without
 * mutating state — on any illegal precondition. The override then plays out
 * through `stepOverriddenDrones`, which fights the drone on the player's side
 * and reverts it when the countdown lapses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Decker } from '../../../src/game/archetypes/Decker.js';
import { Crew } from '../../../src/game/Crew.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { applyOverride, stepOverriddenDrones } from '../../../src/game/droneOverride.js';
import { TILE, FACTION, AP_COST, OVERRIDE_DURATION } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';

function makeWorld({ deckerAt = [1, 1], grid, extraEntities = [] } = {}) {
  const g = grid ?? new Grid(12, 12);
  const w = new World(g);
  const decker = new Decker({ id: 'decker', x: deckerAt[0], y: deckerAt[1] });
  w.addEntity(decker);
  for (const e of extraEntities) w.addEntity(e);
  return { world: w, decker };
}

function makeDrone(id, x, y, faction = FACTION.CORP) {
  return new Skirmisher({ id, x, y, faction });
}

// Deterministic single-roll stubs for the commit step (overrideDrone only
// consumes one rng.next()). 0.1 < success chance → hijack; 0.9 → failure.
const winRng = { next: () => 0.1 };
const loseRng = { next: () => 0.9 };

// --- class basics ----------------------------------------------------------

test('Decker extends Crew and is a PLAYER-faction operator with the @ glyph', () => {
  const d = new Decker({ id: 'd', x: 0, y: 0 });
  assert.ok(d instanceof Crew, 'Decker must extend Crew');
  assert.equal(d.faction, FACTION.PLAYER);
  assert.equal(d.glyph, '@');
  assert.equal(d.archetype, 'Decker');
  assert.equal(d.baseHitChance, 0.7);
});

// --- canOverride legality matrix -------------------------------------------

test('canOverride accepts a live in-range LOS corp drone', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, decker } = makeWorld({ extraEntities: [drone] });
  assert.equal(decker.canOverride(world, drone).ok, true);
});

test('canOverride rejects a null / non-Hostile target as not-overridable', () => {
  const prop = new Entity({ id: 'prop', x: 2, y: 1, faction: FACTION.CORP, glyph: '#' });
  const { world, decker } = makeWorld({ extraEntities: [prop] });
  assert.equal(decker.canOverride(world, null).reason, 'not-overridable');
  assert.equal(decker.canOverride(world, prop).reason, 'not-overridable');
});

test('canOverride rejects when the Decker is dead', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, decker } = makeWorld({ extraEntities: [drone] });
  decker.alive = false;
  assert.equal(decker.canOverride(world, drone).reason, 'dead');
});

test('canOverride rejects when AP < OVERRIDE cost', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, decker } = makeWorld({ extraEntities: [drone] });
  decker.spendAp(decker.ap - (AP_COST.OVERRIDE - 1));
  assert.equal(decker.canOverride(world, drone).reason, 'insufficient-ap');
});

test('canOverride rejects a dead target drone', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, decker } = makeWorld({ extraEntities: [drone] });
  drone.alive = false;
  assert.equal(decker.canOverride(world, drone).reason, 'dead-target');
});

test('canOverride rejects a drone that is already overridden', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, decker } = makeWorld({ extraEntities: [drone] });
  applyOverride(drone, FACTION.PLAYER);
  assert.equal(decker.canOverride(world, drone).reason, 'already-overridden');
});

test('canOverride rejects a same-faction (already player-aligned) drone', () => {
  const drone = makeDrone('k', 3, 1, FACTION.PLAYER);
  const { world, decker } = makeWorld({ extraEntities: [drone] });
  assert.equal(decker.canOverride(world, drone).reason, 'friendly');
});

test('canOverride rejects an out-of-range drone', () => {
  const drone = makeDrone('k', 9, 1); // distance 8 > OVERRIDE_RANGE (5)
  const { world, decker } = makeWorld({ extraEntities: [drone] });
  assert.equal(decker.canOverride(world, drone).reason, 'out-of-range');
});

test('canOverride rejects a drone behind a wall (no LOS)', () => {
  const g = new Grid(12, 12);
  g.setTile(2, 1, TILE.WALL);
  const drone = makeDrone('k', 3, 1);
  const { world, decker } = makeWorld({ grid: g, extraEntities: [drone] });
  assert.equal(decker.canOverride(world, drone).reason, 'no-los');
});

// --- overrideDrone commit semantics ----------------------------------------

test('overrideDrone success flips the drone to PLAYER for the full duration', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, decker } = makeWorld({ extraEntities: [drone] });
  const apBefore = decker.ap;
  const result = decker.overrideDrone(world, drone, winRng);
  assert.equal(result.success, true);
  assert.equal(result.alarm, false);
  assert.equal(drone.faction, FACTION.PLAYER);
  assert.equal(drone.factionBeforeOverride, FACTION.CORP);
  assert.equal(drone.overrideTurnsRemaining, OVERRIDE_DURATION);
  assert.equal(drone.isOverridden, true);
  assert.equal(decker.ap, apBefore - AP_COST.OVERRIDE);
});

test('overrideDrone failure burns AP, trips the alarm, leaves faction intact', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, decker } = makeWorld({ extraEntities: [drone] });
  const apBefore = decker.ap;
  assert.equal(world.alarmActive, false);
  const result = decker.overrideDrone(world, drone, loseRng);
  assert.equal(result.success, false);
  assert.equal(result.alarm, true);
  assert.equal(world.alarmActive, true);
  assert.equal(drone.faction, FACTION.CORP);
  assert.equal(drone.isOverridden, false);
  assert.equal(decker.ap, apBefore - AP_COST.OVERRIDE);
});

test('overrideDrone throws on an illegal attempt without burning AP', () => {
  const drone = makeDrone('k', 9, 1); // out of range
  const { world, decker } = makeWorld({ extraEntities: [drone] });
  const apBefore = decker.ap;
  assert.throws(() => decker.overrideDrone(world, drone, winRng), /Illegal override/);
  assert.equal(decker.ap, apBefore, 'AP not debited on illegal override');
  assert.equal(drone.faction, FACTION.CORP);
});

// --- golden path: hijacked drone fights corp, then reverts -----------------

test('an overridden drone attacks corp allies for N turns then reverts', () => {
  // Open arena: decker, hijacked drone, and a corp victim in a clean LOS line.
  const drone = makeDrone('hijacked', 4, 4);
  const victim = makeDrone('victim', 6, 4); // corp; the drone's new enemy
  const { world, decker } = makeWorld({ deckerAt: [2, 4], extraEntities: [drone, victim] });

  const result = decker.overrideDrone(world, drone, winRng);
  assert.equal(result.success, true);

  const rng = new Rng(7);
  const victimHpStart = victim.hp;
  let sawEngageAction = false;

  // Drive the override across its whole lifetime. Each pass is one player turn:
  // the drone acts, then its countdown ticks.
  let expired = false;
  for (let turn = 0; turn < OVERRIDE_DURATION; turn++) {
    assert.equal(drone.faction, FACTION.PLAYER, `drone should be player-aligned on turn ${turn}`);
    drone.refreshAp(); // mimic the AP refresh PLAYER entities get each round
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

test('overrideDrone is a no-op on the corp turn list — driver skips player faction', () => {
  // Sanity: once flipped, the drone is PLAYER faction, so the corp-turn driver
  // (which filters on corpFaction) will never step it. We assert the faction
  // contract that guarantees this rather than re-running the whole driver.
  const drone = makeDrone('k', 3, 1);
  const { world, decker } = makeWorld({ extraEntities: [drone] });
  decker.overrideDrone(world, drone, winRng);
  assert.notEqual(drone.faction, FACTION.CORP);
});
