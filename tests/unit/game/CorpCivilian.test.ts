import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CorpCivilian } from '../../../src/game/entities/CorpCivilian.js';
import { Entity } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import { FACTION, TILE } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';

function makeWorld(opts: { width?: number; height?: number } = {}) {
  const w = opts.width ?? 10;
  const h = opts.height ?? 10;
  const grid = new Grid(w, h, TILE.FLOOR);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  return { grid, bus, world };
}

function makePlayer(x: number, y: number) {
  return new Entity({ id: 'player', x, y, faction: FACTION.PLAYER, glyph: '@' });
}

test('CorpCivilian is CORP faction with glyph "c"', () => {
  const civ = new CorpCivilian({ id: 'civ-0', x: 3, y: 3 });
  assert.equal(civ.faction, FACTION.CORP);
  assert.equal(civ.glyph, 'c');
  assert.equal(civ.maxHp, 1);
  assert.equal(civ.maxAp, 1);
});

test('CorpCivilian emits alarm when player is in LOS', () => {
  const { world, bus } = makeWorld();
  const civ = new CorpCivilian({ id: 'civ-0', x: 2, y: 2 });
  const player = makePlayer(4, 2);
  world.addEntity(civ);
  world.addEntity(player);

  const alarms: unknown[] = [];
  bus.on(EVENT.ALARM, (p: unknown) => alarms.push(p));

  const steps = civ.takeTurn(world, new Rng(1));
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'alarm');
  assert.equal(alarms.length, 1);
  const payload = alarms[0] as Record<string, unknown>;
  assert.equal(payload.source, civ);
  assert.equal(payload.target, player);
  assert.equal(world.alarmActive, true, 'alarm should latch on the world');
});

test('CorpCivilian does NOT alarm when player is out of LOS (wall between)', () => {
  const { world, grid, bus } = makeWorld();
  const civ = new CorpCivilian({ id: 'civ-0', x: 2, y: 2 });
  const player = makePlayer(5, 2);
  // Place a wall between them.
  grid.setTile(3, 2, TILE.WALL);
  grid.setTile(4, 2, TILE.WALL);
  world.addEntity(civ);
  world.addEntity(player);

  const alarms: unknown[] = [];
  bus.on(EVENT.ALARM, (p: unknown) => alarms.push(p));

  const steps = civ.takeTurn(world, new Rng(1));
  assert.equal(steps.length, 0, 'no alarm when LOS is blocked');
  assert.equal(alarms.length, 0);
  assert.equal(world.alarmActive, false);
});

test('CorpCivilian does NOT alarm when player is out of range', () => {
  const { world, bus } = makeWorld({ width: 30, height: 30 });
  const civ = new CorpCivilian({ id: 'civ-0', x: 1, y: 1, sightRange: 3 });
  const player = makePlayer(10, 10);
  world.addEntity(civ);
  world.addEntity(player);

  const alarms: unknown[] = [];
  bus.on(EVENT.ALARM, (p: unknown) => alarms.push(p));

  civ.takeTurn(world, new Rng(1));
  assert.equal(alarms.length, 0, 'no alarm when out of range');
  assert.equal(world.alarmActive, false);
});

test('alarm is a permanent latch — does not re-fire on subsequent turns', () => {
  const { world, bus } = makeWorld();
  const civ = new CorpCivilian({ id: 'civ-0', x: 2, y: 2 });
  const player = makePlayer(4, 2);
  world.addEntity(civ);
  world.addEntity(player);

  const alarms: unknown[] = [];
  bus.on(EVENT.ALARM, (p: unknown) => alarms.push(p));

  civ.takeTurn(world, new Rng(1));
  assert.equal(alarms.length, 1);
  assert.equal(world.alarmActive, true);

  // Same turn — latched via world.alarmActive.
  civ.takeTurn(world, new Rng(1));
  assert.equal(alarms.length, 1, 'no duplicate alarm same turn');

  // New turn (AP refresh) — still latched.
  civ.refreshAp();
  civ.takeTurn(world, new Rng(1));
  assert.equal(alarms.length, 1, 'alarm must not re-fire after refresh');
});

test('second CorpCivilian does not alarm when first already triggered', () => {
  const { world, bus } = makeWorld();
  const civ1 = new CorpCivilian({ id: 'civ-0', x: 2, y: 2 });
  const civ2 = new CorpCivilian({ id: 'civ-1', x: 2, y: 4 });
  const player = makePlayer(4, 3);
  world.addEntity(civ1);
  world.addEntity(civ2);
  world.addEntity(player);

  const alarms: unknown[] = [];
  bus.on(EVENT.ALARM, (p: unknown) => alarms.push(p));

  // First civilian spots the player and triggers alarm.
  civ1.takeTurn(world, new Rng(1));
  assert.equal(alarms.length, 1);
  assert.equal(world.alarmActive, true);

  // Second civilian also has LOS but alarm is already active — suppressed.
  civ2.takeTurn(world, new Rng(1));
  assert.equal(alarms.length, 1, 'second civilian must not stack alarms');
});

test('CorpCivilian does nothing when dead', () => {
  const { world, bus } = makeWorld();
  const civ = new CorpCivilian({ id: 'civ-0', x: 2, y: 2 });
  const player = makePlayer(4, 2);
  world.addEntity(civ);
  world.addEntity(player);
  civ.damage(1); // kill (maxHp=1)
  assert.equal(civ.alive, false);

  const alarms: unknown[] = [];
  bus.on(EVENT.ALARM, (p: unknown) => alarms.push(p));

  civ.takeTurn(world, new Rng(1));
  assert.equal(alarms.length, 0, 'dead civilian cannot alarm');
  assert.equal(world.alarmActive, false);
});

test('CorpCivilian constructor validates sightRange', () => {
  assert.throws(() => new CorpCivilian({ id: 'x', x: 0, y: 0, sightRange: -1 }), /sightRange/);
  assert.throws(() => new CorpCivilian({ id: 'x', x: 0, y: 0, sightRange: 2.5 as unknown as number }), /sightRange/);
});
