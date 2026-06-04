/**
 * Turret tests — placement, target selection, autofire commit.
 *
 * The turret is a peer of Entity (not an archetype). Its `autoFire(world,
 * rng)` is the seam the shell calls between player and corp turns. Tests
 * lock down:
 *   - constructor invariants (faction, glyph, max-AP, ownerId);
 *   - `findTarget` picks the nearest live hostile within range with LOS;
 *   - LOS / range / faction guards reject the wrong candidates;
 *   - `autoFire` routes through Combat (cover penalty, damage event, kill);
 *   - `runTurretAutoFire` drains every live turret in the world.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Turret, runTurretAutoFire } from '../../../src/game/Turret.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { CorpCivilian } from '../../../src/game/entities/CorpCivilian.js';
import { Entity } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import {
  FACTION,
  TILE,
  TURRET_MAX_HP,
  TURRET_RANGE,
  TURRET_DAMAGE,
} from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';

function makeWorld({ grid, withBus = false } = {}) {
  const g = grid ?? new Grid(12, 12);
  const bus = withBus ? new EventBus() : null;
  const world = new World(g, bus ? { events: bus } : {});
  return { world, bus };
}

function makeDrone(overrides: ConstructorParameters<typeof Skirmisher>[0]) {
  return new Skirmisher(overrides);
}

test('Turret constructor defaults to PLAYER faction, glyph "T", maxAp 0', () => {
  const t = new Turret({ id: 't1', x: 3, y: 3 });
  assert.equal(t.faction, FACTION.PLAYER);
  assert.equal(t.glyph, 'T');
  assert.equal(t.maxAp, 0);
  assert.equal(t.maxHp, TURRET_MAX_HP);
  assert.equal(t.range, TURRET_RANGE);
  assert.equal(t.attackDamage, TURRET_DAMAGE);
});

test('Turret does not shadow Entity.prototype.damage (the *method*)', () => {
  // Regression: turret stat is `attackDamage`, NOT `damage` — the latter is
  // Entity's method for applying incoming damage. Shadowing it broke
  // `turret.damage(n)` on every cleanup path.
  const t = new Turret({ id: 't', x: 0, y: 0 });
  assert.equal(typeof t.damage, 'function');
});

test('Turret constructor accepts ownerId, range, and attackDamage overrides', () => {
  const t = new Turret({
    id: 't1',
    x: 1,
    y: 1,
    ownerId: 'tech',
    range: 6,
    attackDamage: 2,
  });
  assert.equal(t.ownerId, 'tech');
  assert.equal(t.range, 6);
  assert.equal(t.attackDamage, 2);
});

test('Turret constructor rejects non-positive range', () => {
  assert.throws(() => new Turret({ id: 't', x: 0, y: 0, range: 0 }), /range/i);
  assert.throws(() => new Turret({ id: 't', x: 0, y: 0, range: -1 }), /range/i);
});

test('Turret constructor rejects non-positive attackDamage', () => {
  assert.throws(() => new Turret({ id: 't', x: 0, y: 0, attackDamage: 0 }), /attackDamage/i);
});

test('Turret.findTarget returns null when no hostiles are in the world', () => {
  const { world } = makeWorld();
  const turret = new Turret({ id: 't1', x: 5, y: 5 });
  world.addEntity(turret);
  assert.equal(turret.findTarget(world), null);
});

test('Turret.findTarget ignores same-faction (player) entities', () => {
  const { world } = makeWorld();
  const turret = new Turret({ id: 't1', x: 5, y: 5 });
  const ally = new Entity({ id: 'ally', x: 6, y: 5, faction: FACTION.PLAYER, glyph: '@' });
  world.addEntity(turret);
  world.addEntity(ally);
  assert.equal(turret.findTarget(world), null);
});

test('Turret.findTarget picks the nearest live corp drone within range', () => {
  const { world } = makeWorld();
  const turret = new Turret({ id: 't1', x: 5, y: 5 });
  // Three hostiles at distinct distances; nearest is at (5, 7) (cheb 2).
  const near = makeDrone({ id: 'near', x: 5, y: 7 });
  const mid = makeDrone({ id: 'mid', x: 7, y: 8 });
  const far = makeDrone({ id: 'far', x: 9, y: 8 });
  world.addEntity(turret);
  world.addEntity(near);
  world.addEntity(mid);
  world.addEntity(far);
  assert.equal(turret.findTarget(world), near);
});

test('Turret.findTarget excludes hostiles outside TURRET_RANGE', () => {
  const grid = new Grid(20, 20);
  const { world } = makeWorld({ grid });
  const turret = new Turret({ id: 't1', x: 2, y: 2 });
  // Place a hostile well outside the 4-tile default range.
  const farDrone = makeDrone({ id: 'far', x: 19, y: 19 });
  world.addEntity(turret);
  world.addEntity(farDrone);
  assert.equal(turret.findTarget(world), null, 'out-of-range hostiles must not be picked');
});

test('Turret.findTarget excludes hostiles with a wall on the sightline', () => {
  const grid = new Grid(12, 12);
  // Wall column between turret and drone.
  for (let y = 0; y < 12; y++) grid.setTile(6, y, TILE.WALL);
  const { world } = makeWorld({ grid });
  const turret = new Turret({ id: 't1', x: 4, y: 5 });
  // Drone within Cheb-4 but blocked by the wall column.
  const drone = makeDrone({ id: 'd', x: 8, y: 5 });
  // Need to put drone on a passable tile — it's at x=8 which is FLOOR.
  world.addEntity(turret);
  world.addEntity(drone);
  assert.equal(turret.findTarget(world), null, 'wall must block LOS');
});

test('Turret.findTarget excludes dead hostiles', () => {
  const { world } = makeWorld();
  const turret = new Turret({ id: 't1', x: 3, y: 3 });
  const drone = makeDrone({ id: 'd', x: 4, y: 3 });
  world.addEntity(turret);
  world.addEntity(drone);
  drone.damage(drone.maxHp); // kill
  assert.equal(turret.findTarget(world), null);
});

test('Turret.autoFire returns idle when no target is in range', () => {
  const { world } = makeWorld();
  const turret = new Turret({ id: 't1', x: 5, y: 5 });
  world.addEntity(turret);
  const result = turret.autoFire(world, new Rng(0));
  assert.equal(result.type, 'idle');
  assert.equal(result.reason, 'no-target');
});

test('Turret.autoFire is silent when the turret is destroyed', () => {
  const { world } = makeWorld();
  const turret = new Turret({ id: 't1', x: 5, y: 5 });
  world.addEntity(turret);
  turret.damage(turret.maxHp); // turret dies
  const result = turret.autoFire(world, new Rng(0));
  assert.equal(result.type, 'idle');
  assert.equal(result.reason, 'destroyed');
});

test('Turret.autoFire commits a free shot through resolveRanged on a target hit', () => {
  // Seed the Rng so the deterministic roll is a guaranteed hit (mulberry32
  // first draw at seed 1 is ~0.27, below default 0.75 threshold).
  const { world, bus } = makeWorld({ withBus: true });
  const turret = new Turret({ id: 't1', x: 3, y: 3 });
  const drone = makeDrone({ id: 'd', x: 4, y: 3, maxHp: 3 });
  world.addEntity(turret);
  world.addEntity(drone);

  const events = [];
  bus.on(EVENT.ENTITY_DAMAGED, payload => events.push(payload));

  const rng = new Rng(1);
  const result = turret.autoFire(world, rng);
  assert.equal(result.type, 'fire');
  assert.equal(result.target, drone);
  assert.equal(result.result.hit, true);
  assert.equal(result.result.damage, TURRET_DAMAGE);
  // The shared Combat path must have emitted the damage event.
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'ranged');
  assert.equal(events[0].attacker, turret);
  // Turret has no AP pool — autoFire must never debit AP (would have thrown).
  assert.equal(turret.ap, 0);
});

test('Turret.autoFire throws without an Rng (crash > silent fallback)', () => {
  const { world } = makeWorld();
  const turret = new Turret({ id: 't1', x: 3, y: 3 });
  world.addEntity(turret);
  assert.throws(() => turret.autoFire(world, null), /Rng/i);
});

test('runTurretAutoFire iterates every live turret in the world', () => {
  const { world } = makeWorld();
  const t1 = new Turret({ id: 't1', x: 3, y: 3 });
  const t2 = new Turret({ id: 't2', x: 6, y: 6 });
  world.addEntity(t1);
  world.addEntity(t2);
  const results = runTurretAutoFire(world, new Rng(0));
  assert.equal(results.length, 2);
  const ids = results.map(r => r.turret.id).sort();
  assert.deepEqual(ids, ['t1', 't2']);
});

test('runTurretAutoFire skips destroyed turrets entirely (no entry in result)', () => {
  const { world } = makeWorld();
  const live = new Turret({ id: 't1', x: 3, y: 3 });
  const dead = new Turret({ id: 't2', x: 6, y: 6 });
  world.addEntity(live);
  world.addEntity(dead);
  dead.damage(dead.maxHp);
  const results = runTurretAutoFire(world, new Rng(0));
  assert.equal(results.length, 1);
  assert.equal(results[0].turret.id, 't1');
});

// --- M5: turrets must not target non-combatants ------------------------------

test('turret does not target CorpCivilian (corp non-combatant)', () => {
  const { world } = makeWorld({ withBus: true });
  const turret = new Turret({ id: 'sentry', x: 3, y: 3 });
  const civilian = new CorpCivilian({ id: 'desk-clerk', x: 4, y: 3 });
  world.addEntity(turret);
  world.addEntity(civilian);

  assert.equal(turret.findTarget(world), null, 'CorpCivilian must not be targeted');
  const result = turret.autoFire(world, new Rng(1));
  assert.equal(result.type, 'idle');
  assert.equal(result.reason, 'no-target');
});

test('turret prefers Skirmisher over nearby CorpCivilian', () => {
  const { world } = makeWorld();
  const turret = new Turret({ id: 'sentry', x: 3, y: 3 });
  const civilian = new CorpCivilian({ id: 'desk-clerk', x: 3, y: 4 });
  const drone = makeDrone({ id: 'd', x: 5, y: 3 });
  world.addEntity(turret);
  world.addEntity(civilian);
  world.addEntity(drone);

  assert.equal(turret.findTarget(world), drone, 'must engage combatant, not civilian');
});

test('turret does not target NEUTRAL-faction entities', () => {
  const { world } = makeWorld({ withBus: true });
  const turret = new Turret({ id: 'sentry', x: 3, y: 3 });
  const neutral = new Entity({
    id: 'bystander',
    x: 4,
    y: 3,
    faction: FACTION.NEUTRAL,
    glyph: 'n',
  });
  world.addEntity(turret);
  world.addEntity(neutral);

  assert.equal(turret.findTarget(world), null, 'NEUTRAL must not be targeted by turret');
  const result = turret.autoFire(world, new Rng(1));
  assert.equal(result.type, 'idle');
  assert.equal(result.reason, 'no-target');
});
