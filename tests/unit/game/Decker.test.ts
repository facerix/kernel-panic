/**
 * Decker archetype tests (P3.5.M2).
 *
 * The Decker's Meatspace signature is now **EMP** — a self-centered AOE stun.
 * The old Drone Override Hack moved off the Decker in M2 (its module coverage
 * lives in `mindInfluence.test.ts`, and it became the Adept's Influence perk
 * in M4 — see `Adept.test.ts`). Here we cover the class basics and the thin
 * `canEmp`/`detonateEmp` delegators to `empBlast.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Decker } from '../../../src/game/archetypes/Decker.js';
import { Crew } from '../../../src/game/Crew.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { FACTION, AP_COST, EMP_RADIUS, STATUS_EFFECT } from '../../../src/game/constants.js';

function makeWorld({
  deckerAt = [5, 5],
  grid,
  extraEntities = [],
}: {
  deckerAt?: [number, number];
  grid?: Grid;
  extraEntities?: Entity[];
} = {}) {
  const g = grid ?? new Grid(12, 12);
  const w = new World(g);
  const decker = new Decker({ id: 'decker', x: deckerAt[0], y: deckerAt[1] });
  w.addEntity(decker);
  for (const e of extraEntities) w.addEntity(e);
  return { world: w, decker };
}

const corp = (id: string, x: number, y: number) =>
  new Entity({ id, x, y, faction: FACTION.CORP, glyph: 'd' });

// --- class basics ----------------------------------------------------------

test('Decker extends Crew and is a PLAYER-faction operator with the @ glyph', () => {
  const d = new Decker({ id: 'd', x: 0, y: 0 });
  assert.ok(d instanceof Crew, 'Decker must extend Crew');
  assert.equal(d.faction, FACTION.PLAYER);
  assert.equal(d.glyph, '@');
  assert.equal(d.archetype, 'Decker');
  assert.equal(d.baseHitChance, 0.7);
});

test('Decker retains its cyber-deck capability flag and cyber stats', () => {
  const d = new Decker({ id: 'd', x: 0, y: 0 });
  assert.equal(d.canJackIn, true);
  assert.ok(d.ram > 0);
  assert.ok(d.intrusionStrength > 0);
});

// --- EMP delegators --------------------------------------------------------

test('Decker.canEmp accepts a live Decker with enough AP', () => {
  const { decker } = makeWorld();
  assert.equal(decker.canEmp().ok, true);
});

test('Decker.canEmp rejects when AP < EMP cost', () => {
  const { decker } = makeWorld();
  decker.spendAp(decker.ap - (AP_COST.EMP - 1));
  assert.equal(decker.canEmp().reason, 'insufficient-ap');
});

test('Decker.detonateEmp stuns in-radius foes but not itself; debits AP once', () => {
  const foe = corp('foe', 5 + EMP_RADIUS, 5); // edge of radius
  const far = corp('far', 5 + EMP_RADIUS + 1, 5); // just outside
  const { world, decker } = makeWorld({ extraEntities: [foe, far] });
  const apBefore = decker.ap;
  const { stunned } = decker.detonateEmp(world);
  assert.ok(!stunned.includes(decker), 'caster is exempt from its own EMP');
  assert.ok(stunned.includes(foe), 'in-radius foe stunned');
  assert.ok(!stunned.includes(far), 'out-of-radius foe untouched');
  assert.equal(foe.hasEffect(STATUS_EFFECT.STUN), true);
  assert.equal(far.hasEffect(STATUS_EFFECT.STUN), false);
  assert.equal(decker.hasEffect(STATUS_EFFECT.STUN), false);
  assert.equal(decker.ap, apBefore - AP_COST.EMP);
});

test('Decker.detonateEmp throws on an illegal attempt without burning AP', () => {
  const { world, decker } = makeWorld();
  decker.spendAp(decker.ap);
  assert.throws(() => decker.detonateEmp(world), /Illegal EMP/);
  assert.equal(decker.ap, 0);
});
