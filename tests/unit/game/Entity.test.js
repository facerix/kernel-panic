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

test('Entity defaults to full HP and respects custom maxHp', () => {
  const def = new Entity(baseProps());
  assert.equal(def.hp, def.maxHp);
  assert.ok(def.maxHp > 0, 'default maxHp positive');

  const e = new Entity({ ...baseProps(), maxHp: 5 });
  assert.equal(e.hp, 5);
  assert.equal(e.maxHp, 5);
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
