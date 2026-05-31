import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { Entity } from '../../../src/game/Entity.js';
import { World } from '../../../src/game/World.js';
import {
  FACTION,
  AP_COST,
  DEFAULT_HP,
  HEAVY_MELEE_DAMAGE,
  ENEMY_TIER,
} from '../../../src/game/constants.js';
import { Guard } from '../../../src/game/ai/Guard.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { PATROL_STATE } from '../../../src/game/ai/PatrolHostile.js';
import { PatrolHostile } from '../../../src/game/ai/PatrolHostile.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import { Rng } from '../../../src/rng.js';

/** Fixed-sequence RNG that crashes if over-drained — pins dodge/hit outcomes. */
class StubRng {
  constructor(values) {
    this.values = [...values];
    this.calls = 0;
  }
  next() {
    if (this.calls >= this.values.length) {
      throw new Error('StubRng drained — test under-supplied rolls');
    }
    return this.values[this.calls++];
  }
}

const openWorld = (w = 12, h = 6) => new World(new Grid(w, h));

// --- identity ----------------------------------------------------------------

test('Guard is a corp-faction PatrolHostile with the guard glyph', () => {
  const guard = new Guard({ id: 'guard-0', x: 1, y: 1 });
  assert.ok(guard instanceof PatrolHostile, 'shares the patrol state machine');
  assert.ok(!(guard instanceof Skirmisher), 'is a sibling of Skirmisher, not a subclass');
  assert.equal(guard.faction, FACTION.CORP);
  assert.equal(guard.glyph, 'g');
});

test('Guard at T1 has baseline fodder stats: no armor, trades HP openly', () => {
  const guard = new Guard({ id: 'guard-0', x: 1, y: 1, tier: ENEMY_TIER.T1 });
  assert.equal(guard.maxHp, DEFAULT_HP, 'baseline HP (fodder hp multiplier 1.0×)');
  assert.equal(guard.damageReduction, 0, 'no armor — that is a T3 elite mechanic');
  // Dies to open trade: two 2-damage hits drop a 3-HP guard, with no mitigation.
  guard.damage(2);
  assert.ok(guard.alive, 'survives the first hit (HP 3 → 1)');
  guard.damage(2);
  assert.ok(!guard.alive, 'second hit drops it — full damage taken, no armor');
});

// --- engage: close + melee ---------------------------------------------------

test('guard melees an adjacent target when AP allows', () => {
  const w = openWorld();
  const player = new Entity({ id: 'p', x: 5, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const guard = new Guard({ id: 'guard-0', x: 6, y: 2, maxAp: AP_COST.MELEE_ATTACK });
  w.addEntity(player);
  w.addEntity(guard);
  // roll 0.99 ≥ DODGE_CHANCE → connects.
  const log = guard.takeTurn(w, new StubRng([0.99]));
  assert.equal(guard.state, PATROL_STATE.ENGAGE);
  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'melee');
  assert.equal(log[0].result.hit, true);
  assert.equal(player.hp, player.maxHp - HEAVY_MELEE_DAMAGE);
});

test('guard closes the distance toward an out-of-reach target (no ranged option)', () => {
  const w = openWorld(14, 4);
  const player = new Entity({ id: 'p', x: 2, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const guard = new Guard({ id: 'guard-0', x: 8, y: 2, maxAp: 4 });
  w.addEntity(player);
  w.addEntity(guard);
  const log = guard.takeTurn(w, new Rng(1));
  assert.equal(guard.state, PATROL_STATE.ENGAGE);
  assert.ok(guard.x < 8, 'guard advanced toward the player');
  assert.ok(
    log.every(step => step.type === 'move-engage'),
    'only movement — never a ranged shot (guards have no gun)'
  );
});

test('guard closes then strikes within a single turn (takeTurnSteps paces both)', () => {
  const w = openWorld();
  const player = new Entity({ id: 'p', x: 4, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  // 2 AP: one step to become adjacent (cost 1) + one swing (cost 1).
  const guard = new Guard({ id: 'guard-0', x: 6, y: 2, maxAp: 2 });
  w.addEntity(player);
  w.addEntity(guard);
  const steps = [...guard.takeTurnSteps(w, new StubRng([0.99]))];
  assert.equal(steps.length, 2);
  assert.equal(steps[0].type, 'move-engage');
  assert.equal(steps[1].type, 'melee');
  assert.equal(player.hp, player.maxHp - HEAVY_MELEE_DAMAGE);
});

test('guard does not melee a NEUTRAL bystander', () => {
  const w = openWorld();
  const neutral = new Entity({
    id: 'neutral-civ',
    x: 5,
    y: 2,
    faction: FACTION.NEUTRAL,
    glyph: 'n',
  });
  const guard = new Guard({ id: 'guard-0', x: 6, y: 2, maxAp: 4 });
  w.addEntity(neutral);
  w.addEntity(guard);
  const log = guard.takeTurn(w, new Rng(1));
  assert.equal(neutral.hp, neutral.maxHp, 'NEUTRAL is never a valid target');
  assert.ok(!log.some(s => s.type === 'melee'));
});

// --- shared state machine (inherited from PatrolHostile) ----------------------

test('guard walks toward its first patrol waypoint', () => {
  const w = openWorld();
  const guard = new Guard({
    id: 'guard-0',
    x: 1,
    y: 2,
    maxAp: AP_COST.MOVE,
    patrolWaypoints: [{ x: 5, y: 2 }],
  });
  w.addEntity(guard);
  const log = guard.takeTurn(w, new Rng(1));
  assert.ok(guard.x > 1, 'guard moved toward the waypoint');
  assert.equal(guard.state, PATROL_STATE.PATROL);
  assert.equal(log[0].type, 'move-patrol');
});

test('noise puts a patrolling guard into investigate; alarm forces engage', () => {
  const bus = new EventBus();
  const guard = new Guard({ id: 'guard-0', x: 2, y: 2 });
  guard.bindToBus(bus);
  bus.emit(EVENT.NOISE, { origin: { x: 7, y: 4 } });
  assert.equal(guard.state, PATROL_STATE.INVESTIGATE);
  assert.deepEqual(guard.lastKnownTarget, { x: 7, y: 4 });

  bus.emit(EVENT.ALARM, {
    source: { id: 'civ-0', x: 3, y: 3 },
    target: { id: 'player', x: 8, y: 3, alive: true },
    origin: { x: 3, y: 3 },
  });
  assert.equal(guard.state, PATROL_STATE.ENGAGE);
  assert.deepEqual(guard.lastKnownTarget, { x: 8, y: 3 });
});

test('Guard.unbind detaches the bus listeners', () => {
  const bus = new EventBus();
  const guard = new Guard({ id: 'guard-0', x: 2, y: 2 });
  guard.bindToBus(bus);
  guard.unbind();
  bus.emit(EVENT.NOISE, { origin: { x: 7, y: 4 } });
  assert.equal(guard.state, PATROL_STATE.PATROL);
  assert.equal(guard.lastKnownTarget, null);
});

test('takeTurn on a dead guard is a no-op', () => {
  const w = openWorld();
  const guard = new Guard({ id: 'guard-0', x: 1, y: 1, patrolWaypoints: [{ x: 5, y: 1 }] });
  w.addEntity(guard);
  guard.alive = false;
  const log = guard.takeTurn(w, new Rng(1));
  assert.deepEqual(log, []);
  assert.equal(guard.x, 1);
});

test('Guard constructor rejects malformed waypoints', () => {
  assert.throws(
    () => new Guard({ id: 'guard-0', x: 1, y: 1, patrolWaypoints: [{ x: 0.5, y: 1 }] }),
    TypeError
  );
  assert.throws(() => new Guard({ id: 'guard-0', x: 1, y: 1, patrolWaypoints: 'nope' }), TypeError);
});
