import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Juggernaut } from '../../../src/game/ai/Juggernaut.js';
import { Bruiser } from '../../../src/game/ai/Bruiser.js';
import { Guard } from '../../../src/game/ai/Guard.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { PatrolHostile } from '../../../src/game/ai/PatrolHostile.js';
import { Entity } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { resolveRanged } from '../../../src/game/Combat.js';
import {
  ENEMY_TIER,
  FACTION,
  JUGGERNAUT_SUPPRESS_RANGE,
  JUGGERNAUT_SUPPRESS_DAMAGE,
  JUGGERNAUT_PREFERRED_MIN,
  TILE,
} from '../../../src/game/constants.js';

// Walls boxing the juggernaut at (1,1) so no band-kite tile exists — every
// neighbour except the player's tile (2,1) is sealed. Shared by the cornered
// tests; the only variable is whether the player's knockback lane is open.
const CORNER_WALLS = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];

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

// Always-hit rng for turns whose suppress-roll count we don't want to pin.
const alwaysHit = () => ({ next: () => 0.0 });

const openWorld = (w = 16, h = 6) => new World(new Grid(w, h));
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const makePlayer = (x, y, extra = {}) =>
  new Entity({ id: 'p', x, y, faction: FACTION.PLAYER, glyph: '@', maxHp: 10, ...extra });

test('Juggernaut is a corp-faction elite PatrolHostile with the elite glyph', () => {
  const jug = new Juggernaut({ id: 'juggernaut-0', x: 1, y: 1 });
  assert.ok(jug instanceof PatrolHostile);
  assert.ok(!(jug instanceof Bruiser), 'not the melee elite');
  assert.ok(!(jug instanceof Skirmisher), 'not the ranged fodder');
  assert.ok(!(jug instanceof Guard), 'not the melee fodder');
  assert.equal(jug.faction, FACTION.CORP);
  assert.equal(jug.glyph, 'j');
  assert.equal(jug.preferredMin, JUGGERNAUT_PREFERRED_MIN);
});

test('Juggernaut at T3 has high HP, an armor floor, and low (elite-bumped) AP', () => {
  const jug = new Juggernaut({ id: 'juggernaut-0', x: 1, y: 1, tier: ENEMY_TIER.T3 });
  // DEFAULT_HP (3) × 1.5 = 4.5 → ceil 5; base AP 3 + elite apBonus 1 = 4; armor floor 1.
  assert.equal(jug.maxHp, 5);
  assert.equal(
    jug.maxAp,
    4,
    'low base AP (3) lifted to 4 — never the skirmisher 4-AP-from-fodder dance'
  );
  assert.ok(jug.damageReduction >= 1, 'elite armor floor');
});

test('Juggernaut in the suppress band fires a 1-AP / 1-damage chip', () => {
  const w = openWorld();
  const player = makePlayer(5, 2);
  // cheb 4: outside preferredMin (3), inside suppress range (5).
  const jug = new Juggernaut({ id: 'juggernaut-0', x: 9, y: 2, maxAp: 1, tier: ENEMY_TIER.T1 });
  w.addEntity(player);
  w.addEntity(jug);

  const log = jug.takeTurn(w, new StubRng([0.0])); // roll 0 → guaranteed hit

  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'suppress');
  assert.equal(log[0].result.hit, true);
  assert.equal(log[0].result.damage, JUGGERNAUT_SUPPRESS_DAMAGE);
  assert.equal(player.hp, player.maxHp - JUGGERNAUT_SUPPRESS_DAMAGE);
  assert.equal(jug.ap, 0, 'suppress costs only 1 AP');
});

test('Juggernaut out of suppress range advances one step instead of firing', () => {
  const w = openWorld();
  const player = makePlayer(2, 2);
  // cheb 7: inside sight range (8) so it acquires, outside suppress range (5).
  const jug = new Juggernaut({ id: 'juggernaut-0', x: 9, y: 2, maxAp: 1, tier: ENEMY_TIER.T1 });
  w.addEntity(player);
  w.addEntity(jug);

  const log = jug.takeTurn(w, new StubRng([]));

  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'move-engage');
  assert.ok(jug.x < 9, 'closed toward the player');
  assert.ok(
    log.every(step => step.type !== 'suppress'),
    'no suppression from outside the band'
  );
});

test('Juggernaut crowded inside the band band-kites to the band edge, then suppresses', () => {
  const w = openWorld();
  const player = makePlayer(5, 2);
  const jug = new Juggernaut({ id: 'juggernaut-0', x: 6, y: 2, maxAp: 4, tier: ENEMY_TIER.T1 });
  w.addEntity(player);
  w.addEntity(jug);

  const log = jug.takeTurn(w, alwaysHit());

  const distance = cheb(jug, player);
  assert.ok(jug.x > 6, 'repositioned away from the adjacent player');
  assert.ok(
    distance >= JUGGERNAUT_PREFERRED_MIN,
    `stopped retreating once out of the preferredMin band (cheb ${distance})`
  );
  assert.ok(
    distance <= JUGGERNAUT_SUPPRESS_RANGE,
    `band-kite stays inside the suppress range — not a panic flee (cheb ${distance})`
  );
  assert.ok(
    log.some(step => step.type === 'move-engage'),
    'kited at least one step'
  );
  assert.ok(
    log.some(step => step.type === 'suppress'),
    'resumed suppressing from the band edge'
  );
});

test('Juggernaut closes then suppresses in a single low-AP corp turn', () => {
  const grid = new Grid(16, 6);
  // Wall the diagonal exits so the first A* step is the straight close to
  // (10,2) — exactly the suppress-range edge — rather than a diagonal that
  // would land just outside the band.
  grid.setTile(10, 1, TILE.WALL);
  grid.setTile(10, 3, TILE.WALL);
  const w = new World(grid);
  const player = makePlayer(5, 2);
  // dist 6: one straight step closes to dist 5 (the suppress-range edge).
  const jug = new Juggernaut({ id: 'juggernaut-0', x: 11, y: 2, maxAp: 2, tier: ENEMY_TIER.T1 });
  w.addEntity(player);
  w.addEntity(jug);

  const log = jug.takeTurn(w, new StubRng([0.0]));

  assert.equal(log.length, 2);
  assert.equal(log[0].type, 'move-engage');
  assert.equal(log[1].type, 'suppress');
  assert.equal(player.hp, player.maxHp - JUGGERNAUT_SUPPRESS_DAMAGE);
});

test('Juggernaut cornered at point-blank body-checks the target away for no damage', () => {
  const grid = new Grid(6, 6);
  for (const [x, y] of CORNER_WALLS) grid.setTile(x, y, TILE.WALL);
  const w = new World(grid);
  const player = makePlayer(2, 1);
  const jug = new Juggernaut({ id: 'juggernaut-0', x: 1, y: 1, maxAp: 1, tier: ENEMY_TIER.T1 });
  w.addEntity(player);
  w.addEntity(jug);

  const log = jug.takeTurn(w, new StubRng([]));

  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'shove');
  assert.deepEqual(log[0].to, { x: 3, y: 1 }, 'pushed one tile away along the away-vector');
  assert.equal(player.hp, player.maxHp, 'a shove is a no-damage spacing reset');
  assert.equal(player.x, 3, 'target is knocked back to reopen the band');
  assert.equal(player.y, 1);
  assert.equal(jug.x, 1, 'the juggernaut holds its tile');
  assert.equal(jug.y, 1);
});

test('Juggernaut cornered with a blocked knockback lane holds its ground', () => {
  const grid = new Grid(6, 6);
  for (const [x, y] of CORNER_WALLS) grid.setTile(x, y, TILE.WALL);
  // Seal the player's knockback landing tile so the body-check has nowhere to go.
  grid.setTile(3, 1, TILE.WALL);
  const w = new World(grid);
  const player = makePlayer(2, 1);
  const jug = new Juggernaut({ id: 'juggernaut-0', x: 1, y: 1, maxAp: 1, tier: ENEMY_TIER.T1 });
  w.addEntity(player);
  w.addEntity(jug);

  const log = jug.takeTurn(w, new StubRng([]));

  assert.equal(log.length, 0, 'cannot create space, cannot fire point-blank — idle');
  assert.equal(player.hp, player.maxHp, 'no damage');
  assert.equal(player.x, 2, 'player not moved');
  assert.equal(jug.ap, 1, 'a blocked shove spends no AP');
});

test('Juggernaut does not suppress a stealthed target beyond Chebyshev 1', () => {
  const w = openWorld();
  const player = makePlayer(5, 2);
  player.stealthed = true;
  const jug = new Juggernaut({ id: 'juggernaut-0', x: 9, y: 2, maxAp: 4, tier: ENEMY_TIER.T1 });
  w.addEntity(player);
  w.addEntity(jug);

  const log = jug.takeTurn(w, new StubRng([]));

  assert.ok(
    log.every(step => step.type !== 'suppress'),
    'a cloaked target out of melee range is unspottable — no suppression'
  );
  assert.equal(player.hp, player.maxHp, 'player takes no chip damage');
});

test('Juggernaut never deploys or spawns a turret entity', () => {
  const w = openWorld();
  const player = makePlayer(5, 2);
  const jug = new Juggernaut({ id: 'juggernaut-0', x: 9, y: 2, maxAp: 4, tier: ENEMY_TIER.T1 });
  w.addEntity(player);
  w.addEntity(jug);

  const log = jug.takeTurn(w, alwaysHit());

  assert.equal(
    [...w.entities.values()].length,
    2,
    'no new entity spawned (body is the denial asset)'
  );
  assert.ok(
    log.every(step => ['suppress', 'move-engage', 'melee'].includes(step.type)),
    'only band-control verbs — no deploy step'
  );
});

test('Juggernaut armor lets it outlast sustained chip fire that kills a skirmisher', () => {
  const w = openWorld();
  const attacker = makePlayer(0, 2);
  const jug = new Juggernaut({ id: 'juggernaut-0', x: 3, y: 2, tier: ENEMY_TIER.T3 });
  const skirmisher = new Skirmisher({ id: 'drone-0', x: 3, y: 4, tier: ENEMY_TIER.T1 });
  w.addEntity(attacker);
  w.addEntity(jug);
  w.addEntity(skirmisher);

  // Three guaranteed 1-damage ranged hits (RANGED_DAMAGE default).
  for (let i = 0; i < 3; i++) {
    resolveRanged(w, attacker, skirmisher, new StubRng([0.0]), { freeShot: true });
  }
  for (let i = 0; i < 3; i++) {
    resolveRanged(w, attacker, jug, new StubRng([0.0]), { freeShot: true });
  }

  assert.equal(skirmisher.alive, false, 'three chips drop the unarmored fodder');
  assert.equal(jug.alive, true, 'the armored elite is still standing');
  assert.equal(jug.hp, jug.maxHp - 3, 'armor floors damage at 1, but HP pool is larger');
});
