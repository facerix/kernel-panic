/**
 * EMP Neural-Shock tests (P3.5.M2) — the Decker's self-centered AOE stun.
 *
 * Mirrors `breach.test.ts`'s blast-geometry style: `isInEmpBlast` is a pure
 * Chebyshev check; `detonateEmp` stuns everyone alive in radius with no faction
 * filter, debits AP exactly once, and skips corpses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { Decker } from '../../../src/game/archetypes/Decker.js';
import { canEmp, isInEmpBlast, detonateEmp } from '../../../src/game/empBlast.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import { FACTION, AP_COST, EMP_RADIUS, STATUS_EFFECT } from '../../../src/game/constants.js';

function makeWorld({ deckerAt = [5, 5], grid, extraEntities = [], bus = null } = {}) {
  const g = grid ?? new Grid(12, 12);
  const w = new World(g, bus ? { events: bus } : {});
  const decker = new Decker({ id: 'decker', x: deckerAt[0], y: deckerAt[1] });
  w.addEntity(decker);
  for (const e of extraEntities) w.addEntity(e);
  return { world: w, decker };
}

const enemy = (id, x, y) => new Entity({ id, x, y, faction: FACTION.CORP, glyph: 'd' });
const ally = (id, x, y) => new Entity({ id, x, y, faction: FACTION.PLAYER, glyph: 'c' });

// --- isInEmpBlast geometry --------------------------------------------------

test('isInEmpBlast covers the Chebyshev disc of EMP_RADIUS around the center', () => {
  const cx = 5;
  const cy = 5;
  assert.equal(isInEmpBlast(cx, cy, cx, cy), true, 'center is in the blast');
  assert.equal(
    isInEmpBlast(cx, cy, cx + EMP_RADIUS, cy + EMP_RADIUS),
    true,
    'far corner in radius'
  );
  assert.equal(isInEmpBlast(cx, cy, cx + EMP_RADIUS + 1, cy), false, 'one tile past radius is out');
  assert.equal(
    isInEmpBlast(cx, cy, cx, cy - (EMP_RADIUS + 1)),
    false,
    'one tile past radius (up) is out'
  );
});

// --- canEmp legality --------------------------------------------------------

test('canEmp accepts a live Decker with enough AP', () => {
  const { decker } = makeWorld();
  assert.equal(canEmp(decker).ok, true);
});

test('canEmp rejects a dead Decker', () => {
  const { decker } = makeWorld();
  decker.alive = false;
  assert.equal(canEmp(decker).reason, 'dead');
});

test('canEmp rejects when AP < EMP cost', () => {
  const { decker } = makeWorld();
  decker.spendAp(decker.ap - (AP_COST.EMP - 1));
  assert.equal(canEmp(decker).reason, 'insufficient-ap');
});

// --- detonateEmp semantics --------------------------------------------------

test('detonateEmp stuns every OTHER alive entity in radius regardless of faction', () => {
  const nearCorp = enemy('corp', 6, 5); // dist 1
  const nearAlly = ally('ally', 5, 4); // dist 1
  const { world, decker } = makeWorld({ extraEntities: [nearCorp, nearAlly] });
  const { stunned } = detonateEmp(world, decker);
  assert.ok(stunned.includes(nearCorp), 'corp foe stunned');
  assert.ok(stunned.includes(nearAlly), 'friendly crew stunned too (no faction filter)');
  assert.equal(nearCorp.hasEffect(STATUS_EFFECT.STUN), true);
  assert.equal(nearAlly.hasEffect(STATUS_EFFECT.STUN), true);
});

test('detonateEmp does NOT stun the Decker who fired it (no self-footgun)', () => {
  const nearCorp = enemy('corp', 6, 5);
  const { world, decker } = makeWorld({ extraEntities: [nearCorp] });
  const { stunned } = detonateEmp(world, decker);
  assert.ok(!stunned.includes(decker), 'caster exempt from its own discharge');
  assert.equal(decker.hasEffect(STATUS_EFFECT.STUN), false);
});

test('detonateEmp leaves entities outside the radius untouched', () => {
  const far = enemy('far', 5 + EMP_RADIUS + 1, 5);
  const { world, decker } = makeWorld({ extraEntities: [far] });
  const { stunned } = detonateEmp(world, decker);
  assert.equal(far.hasEffect(STATUS_EFFECT.STUN), false, 'out-of-radius foe not stunned');
  assert.ok(!stunned.includes(far));
});

test('detonateEmp skips corpses (dead entities take no stun)', () => {
  const dead = enemy('dead', 6, 5);
  dead.alive = false;
  const { world, decker } = makeWorld({ extraEntities: [dead] });
  const { stunned } = detonateEmp(world, decker);
  assert.ok(!stunned.includes(dead));
  assert.equal(dead.hasEffect(STATUS_EFFECT.STUN), false);
});

test('detonateEmp debits AP exactly once', () => {
  const { world, decker } = makeWorld({ extraEntities: [enemy('c', 6, 5), enemy('c2', 4, 5)] });
  const apBefore = decker.ap;
  detonateEmp(world, decker);
  assert.equal(decker.ap, apBefore - AP_COST.EMP, 'one EMP cost debited, not per-target');
});

test('detonateEmp throws on an illegal attempt without burning AP', () => {
  const { world, decker } = makeWorld();
  decker.spendAp(decker.ap); // 0 AP
  const apBefore = decker.ap;
  assert.throws(() => detonateEmp(world, decker), /Illegal EMP/);
  assert.equal(decker.ap, apBefore, 'no AP debited on an illegal EMP');
});

test('detonateEmp emits EMP_DETONATED with origin and stun count for the shell flash', () => {
  const bus = new EventBus();
  const events = [];
  bus.on(EVENT.EMP_DETONATED, payload => events.push(payload));
  const { world, decker } = makeWorld({ bus, extraEntities: [enemy('a', 6, 5), enemy('b', 4, 5)] });
  detonateEmp(world, decker);
  assert.equal(events.length, 1, 'exactly one detonation event');
  assert.deepEqual(events[0].origin, { x: 5, y: 5 }, 'origin is the Decker tile');
  assert.equal(events[0].stunned, 2, 'reports how many were caught');
});

test('a stunned entity takes 0 AP on its next refresh, full AP after', () => {
  const foe = enemy('foe', 6, 5);
  const { world, decker } = makeWorld({ extraEntities: [foe] });
  detonateEmp(world, decker);
  foe.refreshAp();
  assert.equal(foe.ap, 0, 'stun consumes the next activation');
  foe.refreshAp();
  assert.equal(foe.ap, foe.maxAp, 'the activation after the stun is normal');
});
