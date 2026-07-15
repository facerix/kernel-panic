/**
 * Adept archetype tests (P3.5.M4).
 *
 * The Adept inherits the old Decker "Drone Override Hack" mechanic wholesale
 * — reflavored as **Influence**, psychic domination of a hostile's will. The
 * mechanic's own pure-function coverage lives in `mindInfluence.test.ts`;
 * here we cover the class basics (base stats deliberately weaker than the
 * combat archetypes) and the thin `canInfluence`/`influenceTarget`
 * delegators, mirroring the shape `Decker.test.ts` used for Override before
 * P3.5.M2 moved it off the Decker.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Adept } from '../../../src/game/archetypes/Adept.js';
import { Crew } from '../../../src/game/Crew.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { FACTION, AP_COST, INFLUENCE_DURATION } from '../../../src/game/constants.js';

function makeWorld({ adeptAt = [1, 1], grid, extraEntities = [] } = {}) {
  const g = grid ?? new Grid(12, 12);
  const w = new World(g);
  const adept = new Adept({ id: 'adept', x: adeptAt[0], y: adeptAt[1] });
  w.addEntity(adept);
  for (const e of extraEntities) w.addEntity(e);
  return { world: w, adept };
}

const makeDrone = (id, x, y, faction = FACTION.CORP) => new Skirmisher({ id, x, y, faction });

// Deterministic single-roll stubs: 0.1 < success chance → dominate; 0.9 → fail.
const winRng = { next: () => 0.1 };
const loseRng = { next: () => 0.9 };

// --- class basics ------------------------------------------------------------

test('Adept extends Crew and is a PLAYER-faction operator with the @ glyph', () => {
  const a = new Adept({ id: 'a', x: 0, y: 0 });
  assert.ok(a instanceof Crew, 'Adept must extend Crew');
  assert.equal(a.faction, FACTION.PLAYER);
  assert.equal(a.glyph, '@');
  assert.equal(a.archetype, 'Adept');
});

test('Adept base stats are deliberately weaker than the combat archetypes', () => {
  const a = new Adept({ id: 'a', x: 0, y: 0 });
  assert.equal(a.baseHitChance, 0.7);
  assert.equal(a.baseDodgeChance, 0.2);
});

// --- Influence delegators ----------------------------------------------------

test('Adept.canInfluence accepts a live in-range LOS corp hostile', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, adept } = makeWorld({ extraEntities: [drone] });
  assert.equal(adept.canInfluence(world, drone).ok, true);
});

test('Adept.canInfluence rejects when AP < INFLUENCE cost', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, adept } = makeWorld({ extraEntities: [drone] });
  adept.spendAp(adept.ap - (AP_COST.INFLUENCE - 1));
  assert.equal(adept.canInfluence(world, drone).reason, 'insufficient-ap');
});

test('Adept.canInfluence rejects a non-Hostile target', () => {
  const { world, adept } = makeWorld();
  assert.equal(adept.canInfluence(world, null).reason, 'not-overridable');
});

test('Adept.influenceTarget success dominates the target for the full duration', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, adept } = makeWorld({ extraEntities: [drone] });
  const apBefore = adept.ap;
  const result = adept.influenceTarget(world, drone, winRng);
  assert.equal(result.success, true);
  assert.equal(drone.faction, FACTION.PLAYER);
  assert.equal(drone.overrideTurnsRemaining, INFLUENCE_DURATION);
  assert.equal(adept.ap, apBefore - AP_COST.INFLUENCE);
});

test('Adept.influenceTarget failure burns AP, trips the alarm, leaves faction intact', () => {
  const drone = makeDrone('k', 3, 1);
  const { world, adept } = makeWorld({ extraEntities: [drone] });
  const apBefore = adept.ap;
  const result = adept.influenceTarget(world, drone, loseRng);
  assert.equal(result.success, false);
  assert.equal(result.alarm, true);
  assert.equal(drone.faction, FACTION.CORP);
  assert.equal(adept.ap, apBefore - AP_COST.INFLUENCE);
});

test('Adept.influenceTarget throws on an illegal attempt without burning AP', () => {
  const drone = makeDrone('k', 9, 1); // out of range
  const { world, adept } = makeWorld({ extraEntities: [drone] });
  const apBefore = adept.ap;
  assert.throws(() => adept.influenceTarget(world, drone, winRng), /Illegal override/);
  assert.equal(adept.ap, apBefore, 'AP not debited on illegal influence');
});
