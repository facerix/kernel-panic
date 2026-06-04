import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Bruiser } from '../../../src/game/ai/Bruiser.js';
import { Guard } from '../../../src/game/ai/Guard.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { PatrolHostile, PATROL_STATE } from '../../../src/game/ai/PatrolHostile.js';
import { Entity } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import {
  AP_COST,
  ENEMY_TIER,
  FACTION,
  HEAVY_MELEE_DAMAGE,
  TILE,
} from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';

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

test('Bruiser is a corp-faction elite PatrolHostile with the elite glyph', () => {
  const bruiser = new Bruiser({ id: 'bruiser-0', x: 1, y: 1 });
  assert.ok(bruiser instanceof PatrolHostile);
  assert.ok(!(bruiser instanceof Guard), 'sibling of Guard, not a subclass');
  assert.ok(!(bruiser instanceof Skirmisher), 'not a ranged skirmisher');
  assert.equal(bruiser.faction, FACTION.CORP);
  assert.equal(bruiser.glyph, 'b');
});

test('Bruiser at T3 has elite durability, armor floor, fast AP, and heavy melee', () => {
  const bruiser = new Bruiser({ id: 'bruiser-0', x: 1, y: 1, tier: ENEMY_TIER.T3 });
  assert.equal(bruiser.maxHp, 5);
  assert.equal(bruiser.maxAp, 5);
  assert.equal(bruiser.damageReduction, 1);
  assert.equal(bruiser.meleeDamage, HEAVY_MELEE_DAMAGE);
});

test('connected Bruiser melee deals heavy damage and shoves one clear tile away', () => {
  const w = openWorld();
  const player = new Entity({
    id: 'p',
    x: 5,
    y: 2,
    faction: FACTION.PLAYER,
    glyph: '@',
    maxHp: 10,
  });
  const bruiser = new Bruiser({
    id: 'bruiser-0',
    x: 6,
    y: 2,
    maxAp: AP_COST.MELEE_ATTACK,
    tier: ENEMY_TIER.T1,
  });
  w.addEntity(player);
  w.addEntity(bruiser);

  const log = bruiser.takeTurn(w, new StubRng([0.99]));

  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'melee');
  assert.equal(log[0].result.hit, true);
  assert.equal(player.hp, player.maxHp - HEAVY_MELEE_DAMAGE);
  assert.deepEqual(log[0].knockback, { x: 4, y: 2 });
  assert.equal(player.x, 4);
  assert.equal(player.y, 2);
});

test('blocked Bruiser shove still lands damage and records no knockback', () => {
  const grid = new Grid(12, 6);
  grid.setTile(4, 2, TILE.WALL);
  const w = new World(grid);
  const player = new Entity({
    id: 'p',
    x: 5,
    y: 2,
    faction: FACTION.PLAYER,
    glyph: '@',
    maxHp: 10,
  });
  const bruiser = new Bruiser({
    id: 'bruiser-0',
    x: 6,
    y: 2,
    maxAp: AP_COST.MELEE_ATTACK,
    tier: ENEMY_TIER.T1,
  });
  w.addEntity(player);
  w.addEntity(bruiser);

  const log = bruiser.takeTurn(w, new StubRng([0.99]));

  assert.equal(log[0].type, 'melee');
  assert.equal(log[0].result.hit, true);
  assert.equal(player.hp, player.maxHp - HEAVY_MELEE_DAMAGE);
  assert.equal(log[0].knockback, null);
  assert.equal(player.x, 5);
  assert.equal(player.y, 2);
});

test('dodged Bruiser melee does not shove or damage', () => {
  const w = openWorld();
  const player = new Entity({
    id: 'p',
    x: 5,
    y: 2,
    faction: FACTION.PLAYER,
    glyph: '@',
    maxHp: 10,
  });
  const bruiser = new Bruiser({
    id: 'bruiser-0',
    x: 6,
    y: 2,
    maxAp: AP_COST.MELEE_ATTACK,
    tier: ENEMY_TIER.T1,
  });
  w.addEntity(player);
  w.addEntity(bruiser);

  const log = bruiser.takeTurn(w, new StubRng([0.01]));

  assert.equal(log[0].type, 'melee');
  assert.equal(log[0].result.hit, false);
  assert.equal(log[0].result.dodged, true);
  assert.equal(log[0].knockback, null);
  assert.equal(player.hp, player.maxHp);
  assert.equal(player.x, 5);
});

test('Bruiser shove can move a target into COVER', () => {
  const grid = new Grid(12, 6);
  grid.setTile(4, 2, TILE.COVER);
  const w = new World(grid);
  const player = new Entity({
    id: 'p',
    x: 5,
    y: 2,
    faction: FACTION.PLAYER,
    glyph: '@',
    maxHp: 10,
  });
  const bruiser = new Bruiser({
    id: 'bruiser-0',
    x: 6,
    y: 2,
    maxAp: AP_COST.MELEE_ATTACK,
    tier: ENEMY_TIER.T1,
  });
  w.addEntity(player);
  w.addEntity(bruiser);

  const log = bruiser.takeTurn(w, new StubRng([0.99]));

  assert.equal(log[0].type, 'melee');
  assert.deepEqual(log[0].knockback, { x: 4, y: 2 });
  assert.equal(player.x, 4);
  assert.equal(w.grid.tileAt(player.x, player.y), TILE.COVER);
});

test('Bruiser uses 5 AP to close multiple tiles and never fires', () => {
  const w = openWorld(14, 4);
  const player = new Entity({ id: 'p', x: 2, y: 2, faction: FACTION.PLAYER, glyph: '@' });
  const bruiser = new Bruiser({ id: 'bruiser-0', x: 8, y: 2 });
  w.addEntity(player);
  w.addEntity(bruiser);

  const log = bruiser.takeTurn(w, new Rng(1));

  assert.equal(bruiser.state, PATROL_STATE.ENGAGE);
  assert.ok(bruiser.x < 8, 'bruiser advanced toward the player');
  assert.ok(log.length >= 4, 'elite AP lets the bruiser close hard');
  assert.ok(
    log.every(step => step.type === 'move-engage'),
    'no ranged or suppress steps'
  );
});
