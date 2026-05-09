import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import {
  TILE,
  FACTION,
  AP_COST,
  BASE_HIT_CHANCE,
  COVER_HIT_PENALTY,
} from '../../../src/game/constants.js';
import { canFireRanged, resolveRanged } from '../../../src/game/Combat.js';

/** Tiny stub Rng — emits a queued sequence. Lets tests pin hit/miss. */
class StubRng {
  constructor(values) {
    this.values = [...values];
    this.calls = 0;
  }
  next() {
    if (this.calls >= this.values.length) {
      throw new Error('StubRng: out of queued values');
    }
    return this.values[this.calls++];
  }
}

const makeFight = ({ grid, attackerAt = [1, 1], targetAt = [4, 1] } = {}) => {
  const g = grid ?? new Grid(8, 8);
  const w = new World(g);
  const attacker = new Entity({
    id: 'a',
    x: attackerAt[0],
    y: attackerAt[1],
    faction: FACTION.PLAYER,
    glyph: '@',
  });
  const target = new Entity({
    id: 't',
    x: targetAt[0],
    y: targetAt[1],
    faction: FACTION.CORP,
    glyph: 'd',
    maxHp: 3,
  });
  w.addEntity(attacker);
  w.addEntity(target);
  return { world: w, attacker, target };
};

test('canFireRanged accepts open LOS with sufficient AP', () => {
  const { world, attacker, target } = makeFight();
  assert.equal(canFireRanged(world, attacker, target).ok, true);
});

test('canFireRanged rejects insufficient AP', () => {
  const { world, attacker, target } = makeFight();
  attacker.spendAp(attacker.ap - (AP_COST.RANGED_ATTACK - 1));
  assert.equal(canFireRanged(world, attacker, target).reason, 'insufficient-ap');
});

test('canFireRanged rejects targeting self', () => {
  const { world, attacker } = makeFight();
  assert.equal(canFireRanged(world, attacker, attacker).reason, 'self-target');
});

test('canFireRanged rejects same-faction targets (no friendly fire in V1)', () => {
  const g = new Grid(8, 8);
  const w = new World(g);
  const a = new Entity({ id: 'a', x: 1, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  const ally = new Entity({ id: 'b', x: 4, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  w.addEntity(a);
  w.addEntity(ally);
  assert.equal(canFireRanged(w, a, ally).reason, 'same-faction');
});

test('canFireRanged rejects a dead target', () => {
  const { world, attacker, target } = makeFight();
  target.alive = false;
  assert.equal(canFireRanged(world, attacker, target).reason, 'invalid-target');
});

test('canFireRanged rejects a target out of range', () => {
  const g = new Grid(40, 40);
  const w = new World(g);
  const a = new Entity({ id: 'a', x: 1, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  const t = new Entity({ id: 't', x: 30, y: 1, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(a);
  w.addEntity(t);
  assert.equal(canFireRanged(w, a, t).reason, 'out-of-range');
});

test('canFireRanged rejects when LOS is blocked by a wall', () => {
  const g = new Grid(8, 8);
  g.setTile(3, 1, TILE.WALL);
  const { world, attacker, target } = makeFight({ grid: g });
  assert.equal(canFireRanged(world, attacker, target).reason, 'no-los');
});

test('canFireRanged rejects when another entity stands on the line of fire', () => {
  // Entities should occlude LOS — see M4 review item. A neutral standing
  // between attacker and target breaks the shot, no friendly-fire bypass.
  const g = new Grid(8, 8);
  const w = new World(g);
  const attacker = new Entity({ id: 'a', x: 1, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  const blocker = new Entity({ id: 'b', x: 3, y: 1, faction: FACTION.NEUTRAL, glyph: 'h' });
  const target = new Entity({ id: 't', x: 5, y: 1, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(attacker);
  w.addEntity(blocker);
  w.addEntity(target);
  assert.equal(canFireRanged(w, attacker, target).reason, 'no-los');
});

test('canFireRanged rejects diagonals beyond the Euclidean range', () => {
  // Pre-fix this would slip past as Chebyshev 8 ≤ 8. After fix, dx²+dy² = 128
  // > 64 — must be 'out-of-range', proving Combat shares the new helper.
  const g = new Grid(20, 20);
  const w = new World(g);
  const a = new Entity({ id: 'a', x: 1, y: 1, faction: FACTION.PLAYER, glyph: '@' });
  const t = new Entity({ id: 't', x: 9, y: 9, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(a);
  w.addEntity(t);
  assert.equal(canFireRanged(w, a, t).reason, 'out-of-range');
});

test('resolveRanged crashes when the computed hit threshold is out of [0,1]', () => {
  const { world, attacker, target } = makeFight();
  const rng = new StubRng([0.5]);
  // baseHit 1.5 (without cover) → out of band; must surface, not silently
  // become "always hit".
  assert.throws(() => resolveRanged(world, attacker, target, rng, { baseHit: 1.5 }), RangeError);
  assert.equal(attacker.ap, 4, 'no AP burned on bad tuning');
  assert.equal(rng.calls, 0, 'no roll consumed on bad tuning');
});

test('resolveRanged hits and damages when roll < threshold', () => {
  const { world, attacker, target } = makeFight();
  const apBefore = attacker.ap;
  const hpBefore = target.hp;
  const rng = new StubRng([0.0]); // guaranteed hit
  const result = resolveRanged(world, attacker, target, rng);
  assert.equal(result.hit, true);
  assert.equal(result.threshold, BASE_HIT_CHANCE);
  assert.equal(result.inCover, false);
  assert.equal(target.hp, hpBefore - 1);
  assert.equal(attacker.ap, apBefore - AP_COST.RANGED_ATTACK);
});

test('resolveRanged misses when roll ≥ threshold and target HP unchanged', () => {
  const { world, attacker, target } = makeFight();
  const hpBefore = target.hp;
  const rng = new StubRng([0.99]); // guaranteed miss
  const result = resolveRanged(world, attacker, target, rng);
  assert.equal(result.hit, false);
  assert.equal(target.hp, hpBefore, 'no damage on miss');
  assert.equal(target.alive, true);
});

test('resolveRanged applies COVER_HIT_PENALTY when cover lies between', () => {
  const g = new Grid(8, 8);
  g.setTile(3, 1, TILE.COVER);
  const { world, attacker, target } = makeFight({ grid: g });
  // Roll just above the covered threshold but below the uncovered one.
  const justAboveCovered = BASE_HIT_CHANCE - COVER_HIT_PENALTY + 0.01;
  const rng = new StubRng([justAboveCovered]);
  const result = resolveRanged(world, attacker, target, rng);
  assert.equal(result.inCover, true);
  assert.equal(result.threshold, BASE_HIT_CHANCE - COVER_HIT_PENALTY);
  assert.equal(result.hit, false, 'cover converts a would-be hit into a miss');
});

test('resolveRanged kills the target on lethal damage', () => {
  const { world, attacker, target } = makeFight();
  target.hp = 1;
  const rng = new StubRng([0.0]);
  const result = resolveRanged(world, attacker, target, rng);
  assert.equal(result.hit, true);
  assert.equal(result.killed, true);
  assert.equal(target.alive, false);
  assert.equal(target.hp, 0);
});

test('resolveRanged throws on illegal preconditions and does NOT debit AP', () => {
  const g = new Grid(8, 8);
  g.setTile(3, 1, TILE.WALL); // blocks LOS
  const { world, attacker, target } = makeFight({ grid: g });
  const apBefore = attacker.ap;
  const rng = new StubRng([0.0]);
  assert.throws(() => resolveRanged(world, attacker, target, rng), /Illegal ranged/);
  assert.equal(attacker.ap, apBefore, 'no AP burned on illegal attack');
  assert.equal(rng.calls, 0, 'no roll consumed on illegal attack');
});

test('resolveRanged is reproducible across runs with the same RNG state', () => {
  const r1 = new StubRng([0.4, 0.4]);
  const r2 = new StubRng([0.4, 0.4]);
  const { world: w1, attacker: a1, target: t1 } = makeFight();
  const { world: w2, attacker: a2, target: t2 } = makeFight();
  const o1 = resolveRanged(w1, a1, t1, r1);
  const o2 = resolveRanged(w2, a2, t2, r2);
  assert.deepEqual(o1, o2);
});

test('resolveRanged crashes if no Rng is supplied (no Math.random fallback)', () => {
  const { world, attacker, target } = makeFight();
  assert.throws(() => resolveRanged(world, attacker, target, null), TypeError);
});
