import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Entity } from '../../../src/game/Entity.js';
import { FACTION, DEFAULT_AP } from '../../../src/game/constants.js';

const baseProps = () => ({
  id: 'e1',
  x: 2,
  y: 3,
  faction: FACTION.PLAYER,
  glyph: '@',
});

test('Entity requires an id', () => {
  const props = baseProps();
  delete props.id;
  assert.throws(() => new Entity(props), TypeError);
});

test('Entity requires integer x and y', () => {
  assert.throws(() => new Entity({ ...baseProps(), x: 1.5 }), TypeError);
  assert.throws(() => new Entity({ ...baseProps(), y: '3' }), TypeError);
});

test('Entity requires a faction', () => {
  const props = baseProps();
  delete props.faction;
  assert.throws(() => new Entity(props), TypeError);
});

test('Entity starts at full AP and is alive', () => {
  const e = new Entity(baseProps());
  assert.equal(e.ap, DEFAULT_AP);
  assert.equal(e.maxAp, DEFAULT_AP);
  assert.equal(e.alive, true);
});

test('Entity respects a custom maxAp', () => {
  const e = new Entity({ ...baseProps(), maxAp: 6 });
  assert.equal(e.ap, 6);
  assert.equal(e.maxAp, 6);
});

test('Entity.canAfford reflects current AP', () => {
  const e = new Entity({ ...baseProps(), maxAp: 3 });
  assert.equal(e.canAfford(3), true);
  assert.equal(e.canAfford(4), false);
});

test('Entity.spendAp deducts AP', () => {
  const e = new Entity({ ...baseProps(), maxAp: 4 });
  e.spendAp(1);
  assert.equal(e.ap, 3);
  e.spendAp(2);
  assert.equal(e.ap, 1);
});

test('Entity.spendAp throws on overspend (no silent clamp)', () => {
  const e = new Entity({ ...baseProps(), maxAp: 2 });
  assert.throws(() => e.spendAp(3), /Insufficient AP/);
  assert.equal(e.ap, 2, 'AP unchanged after failed spend');
});

test('Entity.spendAp throws on negative input', () => {
  const e = new Entity(baseProps());
  assert.throws(() => e.spendAp(-1), RangeError);
});

test('Entity.refreshAp restores to maxAp', () => {
  const e = new Entity({ ...baseProps(), maxAp: 4 });
  e.spendAp(3);
  assert.equal(e.ap, 1);
  e.refreshAp();
  assert.equal(e.ap, 4);
});

test('Entity.refreshAp clears temporary shield', () => {
  const e = new Entity({ ...baseProps(), maxAp: 4 });
  e.addShield(2);
  e.spendAp(3);
  e.refreshAp();
  assert.equal(e.ap, 4);
  assert.equal(e.shieldHp, 0);
});

test('Entity defaults to full HP and respects custom maxHp', () => {
  const def = new Entity(baseProps());
  assert.equal(def.hp, def.maxHp);
  assert.ok(def.maxHp > 0, 'default maxHp positive');

  const e = new Entity({ ...baseProps(), maxHp: 5 });
  assert.equal(e.hp, 5);
  assert.equal(e.maxHp, 5);
});

test('Entity.damageReduction defaults to 0 and accepts non-negative integers', () => {
  const def = new Entity(baseProps());
  assert.equal(def.damageReduction, 0);

  const armored = new Entity({ ...baseProps(), damageReduction: 2 });
  assert.equal(armored.damageReduction, 2);
});

test('Entity rejects invalid damageReduction', () => {
  assert.throws(() => new Entity({ ...baseProps(), damageReduction: -1 }), RangeError);
  assert.throws(() => new Entity({ ...baseProps(), damageReduction: 1.5 }), RangeError);
});

test('Entity rejects non-positive maxHp (data-corruption guard)', () => {
  assert.throws(() => new Entity({ ...baseProps(), maxHp: 0 }), RangeError);
  assert.throws(() => new Entity({ ...baseProps(), maxHp: -1 }), RangeError);
  assert.throws(() => new Entity({ ...baseProps(), maxHp: 1.5 }), RangeError);
});

test('Entity.damage subtracts HP and keeps it non-negative', () => {
  const e = new Entity({ ...baseProps(), maxHp: 3 });
  e.damage(2);
  assert.equal(e.hp, 1);
  assert.equal(e.alive, true);
});

test('Entity.damage consumes temporary shield before HP', () => {
  const e = new Entity({ ...baseProps(), maxHp: 5 });
  e.addShield(2);
  assert.equal(e.shieldHp, 2);

  assert.equal(e.damage(1), 0, 'shield-only damage does not reduce HP');
  assert.equal(e.hp, 5);
  assert.equal(e.shieldHp, 1);

  assert.equal(e.damage(3), 2, 'overflow reaches HP');
  assert.equal(e.hp, 3);
  assert.equal(e.shieldHp, 0);
});

test('Entity.damage flips alive=false at 0 HP', () => {
  const e = new Entity({ ...baseProps(), maxHp: 2 });
  e.damage(2);
  assert.equal(e.hp, 0);
  assert.equal(e.alive, false);
});

test('Entity.damage clamps lethal overkill to 0 HP (no negative HP)', () => {
  const e = new Entity({ ...baseProps(), maxHp: 2 });
  e.damage(5);
  assert.equal(e.hp, 0);
  assert.equal(e.alive, false);
});

test('Entity.damage throws on negative or non-integer input', () => {
  const e = new Entity(baseProps());
  assert.throws(() => e.damage(-1), RangeError);
  assert.throws(() => e.damage(1.5), RangeError);
});

test('Entity.damage on a dead entity throws', () => {
  const e = new Entity({ ...baseProps(), maxHp: 1 });
  e.damage(1);
  assert.throws(() => e.damage(1), /already dead/);
});

test('Entity.heal restores HP without exceeding maxHp', () => {
  const e = new Entity({ ...baseProps(), maxHp: 5 });
  e.damage(3);

  assert.equal(e.heal(2), 2);
  assert.equal(e.hp, 4);
  assert.equal(e.heal(5), 1);
  assert.equal(e.hp, 5);
});

test('Entity.heal and addShield reject corrupt inputs loudly', () => {
  const e = new Entity(baseProps());
  assert.throws(() => e.heal(-1), RangeError);
  assert.throws(() => e.addShield(0), RangeError);
  e.damage(e.hp);
  assert.throws(() => e.heal(1), /already dead/);
  assert.throws(() => e.addShield(1), /already dead/);
});

test('Entity.stealthed defaults to false', () => {
  const e = new Entity(baseProps());
  assert.equal(e.stealthed, false);
});

test('Entity.isSpottableBy returns true when not stealthed (any distance)', () => {
  const e = new Entity({ ...baseProps(), x: 0, y: 0 });
  const observer = { x: 50, y: 50 };
  assert.equal(e.isSpottableBy(observer), true);
});

test('Entity.isSpottableBy honours Chebyshev adjacency when stealthed', () => {
  const e = new Entity({ ...baseProps(), x: 5, y: 5 });
  e.stealthed = true;
  // Adjacent observers (dx,dy ∈ [-1,1]) still spot.
  assert.equal(e.isSpottableBy({ x: 4, y: 4 }), true);
  assert.equal(e.isSpottableBy({ x: 5, y: 6 }), true);
  assert.equal(e.isSpottableBy({ x: 5, y: 5 }), true, 'colocated observer can spot');
  // Two tiles out is hidden.
  assert.equal(e.isSpottableBy({ x: 7, y: 5 }), false);
  assert.equal(e.isSpottableBy({ x: 5, y: 7 }), false);
});
