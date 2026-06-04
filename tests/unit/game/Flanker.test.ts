import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Flanker } from '../../../src/game/ai/Flanker.js';
import { Bruiser } from '../../../src/game/ai/Bruiser.js';
import { Guard } from '../../../src/game/ai/Guard.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { PatrolHostile } from '../../../src/game/ai/PatrolHostile.js';
import { canFireRanged, canMelee } from '../../../src/game/Combat.js';
import { Entity } from '../../../src/game/Entity.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import { Grid } from '../../../src/game/Grid.js';
import { isConcealedFromPlayer } from '../../../src/game/playerPerception.js';
import { World } from '../../../src/game/World.js';
import {
  AP_COST,
  ENEMY_TIER,
  FACTION,
  FLANKER_BASE_AP,
  HEAVY_MELEE_DAMAGE,
  TILE,
} from '../../../src/game/constants.js';

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

const makePlayer = (x, y, extra = {}) =>
  new Entity({ id: 'p', x, y, faction: FACTION.PLAYER, glyph: '@', maxHp: 10, ...extra });

test('Flanker is a corp-faction elite PatrolHostile with the flanker glyph', () => {
  const flanker = new Flanker({ id: 'flanker-0', x: 1, y: 1 });
  assert.ok(flanker instanceof PatrolHostile);
  assert.ok(!(flanker instanceof Bruiser), 'not the shove melee elite');
  assert.ok(!(flanker instanceof Skirmisher), 'not ranged fodder');
  assert.ok(!(flanker instanceof Guard), 'not melee fodder');
  assert.equal(flanker.faction, FACTION.CORP);
  assert.equal(flanker.glyph, 'f');
});

test('Flanker at T3 has elite durability, armor floor, 4 AP, and heavy melee', () => {
  const flanker = new Flanker({ id: 'flanker-0', x: 1, y: 1, tier: ENEMY_TIER.T3 });
  assert.equal(flanker.maxHp, 5);
  assert.equal(flanker.maxAp, FLANKER_BASE_AP + 1);
  assert.equal(flanker.maxAp, 4, 'base 3 AP lifted by the T3 elite bonus');
  assert.equal(flanker.damageReduction, 1);
  assert.equal(flanker.meleeDamage, HEAVY_MELEE_DAMAGE);
});

test('cover between player and Flanker hides it and blocks player ranged targeting', () => {
  const grid = new Grid(8, 3);
  grid.setTile(3, 1, TILE.COVER);
  const world = new World(grid);
  const player = makePlayer(1, 1, { maxAp: 2 });
  const flanker = new Flanker({ id: 'flanker-0', x: 5, y: 1, tier: ENEMY_TIER.T1 });
  world.addEntity(player);
  world.addEntity(flanker);

  assert.equal(isConcealedFromPlayer(flanker, player, world), true);
  assert.deepEqual(canFireRanged(world, player, flanker), {
    ok: false,
    reason: 'concealed-target',
  });

  grid.setTile(3, 1, TILE.FLOOR);
  assert.equal(isConcealedFromPlayer(flanker, player, world), false);
  assert.equal(canFireRanged(world, player, flanker).ok, true);
});

test('Flanker SLIDE is silent and hides it at range but not when player is adjacent', () => {
  const bus = new EventBus();
  let moves = 0;
  let noises = 0;
  bus.on(EVENT.ENTITY_MOVED, () => {
    moves += 1;
  });
  bus.on(EVENT.NOISE, () => {
    noises += 1;
  });
  const world = new World(new Grid(8, 3), { events: bus });
  const player = makePlayer(1, 1);
  const flanker = new Flanker({ id: 'flanker-0', x: 4, y: 1, tier: ENEMY_TIER.T1 });
  world.addEntity(player);
  world.addEntity(flanker);

  const to = flanker.slide(world, -1, 0);

  assert.deepEqual(to, { x: 2, y: 1 });
  assert.equal(moves, 1, 'slide still emits entity:moved for vision recompute');
  assert.equal(noises, 0, 'slide emits no NOISE tell');
  assert.equal(flanker.slideConcealed, true);
  assert.equal(isConcealedFromPlayer(flanker, player), false, 'adjacent after slide');
  assert.equal(isConcealedFromPlayer(flanker, player, world), false);
  assert.equal(canMelee(world, player, flanker).ok, true);

  const distantPlayer = makePlayer(0, 1);
  assert.equal(isConcealedFromPlayer(flanker, distantPlayer, world), true);
});

test('Flanker slide conceal stays active at Chebyshev distance 2', () => {
  const world = new World(new Grid(8, 3));
  const player = makePlayer(1, 1);
  const flanker = new Flanker({
    id: 'flanker-0',
    x: 3,
    y: 1,
    tier: ENEMY_TIER.T1,
    slideConcealed: true,
  });
  world.addEntity(player);
  world.addEntity(flanker);

  assert.equal(isConcealedFromPlayer(flanker, player, world), true);
  assert.deepEqual(canFireRanged(world, player, flanker), {
    ok: false,
    reason: 'concealed-target',
  });
});

test('Flanker slide conceal clears on corp AP refresh', () => {
  const world = new World(new Grid(8, 3));
  const flanker = new Flanker({ id: 'flanker-0', x: 4, y: 1, tier: ENEMY_TIER.T1 });
  world.addEntity(flanker);

  flanker.slide(world, -1, 0);
  assert.equal(flanker.slideConcealed, true);

  flanker.refreshAp();
  assert.equal(flanker.slideConcealed, false);
});

test('Flanker does not melee on the same activation after SLIDE', () => {
  const world = new World(new Grid(8, 3));
  const player = makePlayer(1, 1);
  const flanker = new Flanker({ id: 'flanker-0', x: 4, y: 1, tier: ENEMY_TIER.T3 });
  world.addEntity(player);
  world.addEntity(flanker);

  const log = flanker.takeTurn(world, new StubRng([]));

  assert.equal(log[0].type, 'slide');
  assert.equal(flanker.x, 2);
  assert.equal(flanker.y, 1);
  assert.equal(flanker.slideConcealed, true);
  assert.equal(player.hp, player.maxHp, 'no invisible same-turn hitch');
  assert.ok(log.every(step => step.type !== 'melee'));
});

test('Flanker melees after slide conceal clears on the next corp turn', () => {
  const world = new World(new Grid(8, 3));
  const player = makePlayer(1, 1);
  const flanker = new Flanker({
    id: 'flanker-0',
    x: 2,
    y: 1,
    maxAp: AP_COST.MELEE_ATTACK,
    tier: ENEMY_TIER.T1,
    slideConcealed: true,
  });
  world.addEntity(player);
  world.addEntity(flanker);

  flanker.refreshAp();
  const log = flanker.takeTurn(world, new StubRng([0.99]));

  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'melee');
  assert.equal(log[0].result.hit, true);
  assert.equal(player.hp, player.maxHp - HEAVY_MELEE_DAMAGE);
});
