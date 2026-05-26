import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { Entity } from '../../../src/game/Entity.js';
import { World } from '../../../src/game/World.js';
import { TILE, FACTION, AP_COST } from '../../../src/game/constants.js';
import { makeSalvage } from '../../../src/game/salvage.js';

const makePlayer = (x, y, overrides = {}) =>
  new Entity({ id: 'p', x, y, faction: FACTION.PLAYER, glyph: '@', ...overrides });

test('World.addEntity rejects duplicate ids', () => {
  const w = new World(new Grid(5, 5));
  w.addEntity(makePlayer(0, 0));
  assert.throws(() => w.addEntity(makePlayer(1, 1)), /Duplicate/);
});

test('World.addEntity rejects placement on impassable tile', () => {
  const g = new Grid(5, 5);
  g.setTile(2, 2, TILE.WALL);
  const w = new World(g);
  assert.throws(() => w.addEntity(makePlayer(2, 2)), /impassable/i);
});

test('World.addEntity rejects placement on an occupied tile', () => {
  const w = new World(new Grid(5, 5));
  w.addEntity(makePlayer(1, 1));
  const drone = new Entity({ id: 'd', x: 1, y: 1, faction: FACTION.CORP, glyph: 'd' });
  assert.throws(() => w.addEntity(drone), /occupied/i);
});

test('World.entityAt finds an entity or returns null', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 3);
  w.addEntity(p);
  assert.equal(w.entityAt(2, 3), p);
  assert.equal(w.entityAt(0, 0), null);
});

test('World.entityAt ignores corpses; anyEntityAt still resolves them', () => {
  const w = new World(new Grid(5, 5));
  const corpse = new Entity({ id: 'd', x: 2, y: 2, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(corpse);
  corpse.alive = false;
  assert.equal(w.entityAt(2, 2), null, 'movement / targeting queries stay corpse-blind');
  assert.equal(w.anyEntityAt(2, 2), corpse, 'salvage / UI can still find the tile occupant');
});

test('World.lootableCorpseAt finds a corpse even when a live actor shares the tile', () => {
  const w = new World(new Grid(5, 5));
  const corpse = new Entity({ id: 'd', x: 2, y: 2, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(corpse);
  corpse.alive = false;
  corpse.loot = { salvage: makeSalvage({ scrap: 2 }) };
  const player = makePlayer(2, 2);
  w.addEntity(player);
  assert.equal(w.lootableCorpseAt(2, 2), corpse);
  assert.equal(w.entityAt(2, 2), player);
});

test('World.canMoveEntity rejects step further than 1 tile (Chebyshev)', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, 2, 0).ok, false);
  assert.equal(w.canMoveEntity(p, 0, 2).ok, false);
});

test('World.canMoveEntity allows orthogonal and diagonal single steps', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, 1, 0).ok, true);
  assert.equal(w.canMoveEntity(p, 1, 1).ok, true);
  assert.equal(w.canMoveEntity(p, -1, -1).ok, true);
});

test('World.canMoveEntity rejects no-op (0,0)', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  w.addEntity(p);
  const r = w.canMoveEntity(p, 0, 0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-op');
});

test('World.canMoveEntity rejects move out of bounds', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(0, 0);
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, -1, 0).reason, 'out-of-bounds');
});

test('World.canMoveEntity rejects move into a wall', () => {
  const g = new Grid(5, 5);
  g.setTile(3, 2, TILE.WALL);
  const w = new World(g);
  const p = makePlayer(2, 2);
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, 1, 0).reason, 'blocked');
});

test('World.canMoveEntity rejects move into cover (Vault is the only way through)', () => {
  const g = new Grid(5, 5);
  g.setTile(3, 2, TILE.COVER);
  const w = new World(g);
  const p = makePlayer(2, 2);
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, 1, 0).reason, 'blocked');
});

test('World.canMoveEntity rejects move into occupied tile', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  const d = new Entity({ id: 'd', x: 3, y: 2, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(p);
  w.addEntity(d);
  assert.equal(w.canMoveEntity(p, 1, 0).reason, 'occupied');
});

test('World.canMoveEntity rejects move with insufficient AP', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2, { maxAp: 0 });
  w.addEntity(p);
  assert.equal(w.canMoveEntity(p, 1, 0).reason, 'insufficient-ap');
});

test('World.moveEntity debits AP and updates position', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2, { maxAp: 4 });
  w.addEntity(p);
  w.moveEntity(p, 1, 0);
  assert.equal(p.x, 3);
  assert.equal(p.y, 2);
  assert.equal(p.ap, 4 - AP_COST.MOVE);
});

test('World.moveEntity throws on illegal move and leaves state untouched', () => {
  const g = new Grid(5, 5);
  g.setTile(3, 2, TILE.WALL);
  const w = new World(g);
  const p = makePlayer(2, 2);
  w.addEntity(p);
  const apBefore = p.ap;
  assert.throws(() => w.moveEntity(p, 1, 0), /Illegal move/);
  assert.equal(p.x, 2);
  assert.equal(p.y, 2);
  assert.equal(p.ap, apBefore);
});

test('World.canMoveEntity rejects a dead entity (corpses cannot move)', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  w.addEntity(p);
  p.alive = false;
  const r = w.canMoveEntity(p, 1, 0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'dead');
});

test('World.canMoveEntity throws on non-integer offsets (data-corruption guard)', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  w.addEntity(p);
  assert.throws(() => w.canMoveEntity(p, 0.5, 0), TypeError);
  assert.throws(() => w.canMoveEntity(p, 0, Number.NaN), TypeError);
});

test('World.blockerKeys returns coordinate keys for every live entity', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(1, 1);
  const d = new Entity({ id: 'd', x: 3, y: 2, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(p);
  w.addEntity(d);
  const keys = w.blockerKeys();
  assert.equal(keys.size, 2);
  assert.ok(keys.has('1,1'));
  assert.ok(keys.has('3,2'));
});

test('World.moveEntity emits entity:moved with from/to when an event bus is attached', async () => {
  const { EventBus, EVENT } = await import('../../../src/game/events.js');
  const bus = new EventBus();
  const w = new World(new Grid(5, 5), { events: bus });
  const p = makePlayer(2, 2);
  w.addEntity(p);
  const events = [];
  bus.on(EVENT.ENTITY_MOVED, payload => events.push(payload));
  w.moveEntity(p, 1, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].entity, p);
  assert.deepEqual(events[0].from, { x: 2, y: 2 });
  assert.deepEqual(events[0].to, { x: 3, y: 2 });
});

test('World without an event bus does not emit (and does not crash)', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  w.addEntity(p);
  // Just verifying the optional-chaining path; a thrown error here would fail
  // every other harness/test that omits the bus.
  assert.doesNotThrow(() => w.moveEntity(p, 1, 0));
});

test('World.moveEntity emits a noise event with MOVE radius', async () => {
  const { EventBus, EVENT } = await import('../../../src/game/events.js');
  const { NOISE_RADIUS } = await import('../../../src/game/constants.js');
  const bus = new EventBus();
  const w = new World(new Grid(5, 5), { events: bus });
  const p = makePlayer(2, 2);
  w.addEntity(p);
  const noises = [];
  bus.on(EVENT.NOISE, payload => noises.push(payload));
  w.moveEntity(p, 1, 0);
  assert.equal(noises.length, 1);
  assert.equal(noises[0].kind, 'move');
  assert.equal(noises[0].radius, NOISE_RADIUS.MOVE);
  assert.equal(noises[0].source, p);
  assert.deepEqual(noises[0].origin, { x: 3, y: 2 }, 'noise origin is the post-move tile');
});

test('World alarm defaults quiet and inactive', () => {
  const w = new World(new Grid(5, 5));
  assert.equal(w.alarm.phase, 'quiet');
  assert.equal(w.alarm.level, 0);
  assert.equal(w.alarmActive, false);
});

test('World.raiseAlarm enters alert phase and emits one alarm event', async () => {
  const { EventBus, EVENT } = await import('../../../src/game/events.js');
  const bus = new EventBus();
  const w = new World(new Grid(5, 5), { events: bus });
  const alarms = [];
  bus.on(EVENT.ALARM, payload => alarms.push(payload));

  const raised = w.raiseAlarm({ origin: { x: 2, y: 2 } });
  const duplicate = w.raiseAlarm({ origin: { x: 3, y: 3 } });

  assert.equal(raised, true);
  assert.equal(duplicate, false, 'alert phase suppresses duplicate alarm penalties');
  assert.equal(alarms.length, 1);
  assert.equal(w.alarm.phase, 'alert');
  assert.equal(w.alarm.level, 1);
  assert.equal(w.alarm.holdTurnsRemaining, 2);
  assert.equal(w.alarmActive, true);
});

test('World alarm ticks from alert to cooldown to quiet', async () => {
  const { EventBus, EVENT } = await import('../../../src/game/events.js');
  const bus = new EventBus();
  const w = new World(new Grid(5, 5), { events: bus });
  const transitions = [];
  bus.on(EVENT.ALARM_CHANGED, payload => transitions.push(payload));

  w.raiseAlarm();
  w.tickAlarm();
  assert.equal(w.alarm.phase, 'alert');
  assert.equal(w.alarm.holdTurnsRemaining, 1);
  assert.equal(w.alarmActive, true);

  w.tickAlarm();
  assert.equal(w.alarm.phase, 'cooldown');
  assert.equal(w.alarm.cooldownTurnsRemaining, 2);
  assert.equal(w.alarmActive, false);

  w.tickAlarm();
  assert.equal(w.alarm.phase, 'cooldown');
  assert.equal(w.alarm.cooldownTurnsRemaining, 1);

  w.tickAlarm();
  assert.equal(w.alarm.phase, 'quiet');
  assert.equal(w.alarm.level, 0);
  assert.equal(w.alarmActive, false);

  assert.deepEqual(
    transitions.map(t => t.transition),
    ['raised', 'cooldown', 'quiet']
  );
});

test('World.moveEntity { silent: true } suppresses noise but still emits entity:moved', async () => {
  const { EventBus, EVENT } = await import('../../../src/game/events.js');
  const bus = new EventBus();
  const w = new World(new Grid(5, 5), { events: bus });
  const p = makePlayer(2, 2);
  w.addEntity(p);
  const moves = [];
  const noises = [];
  bus.on(EVENT.ENTITY_MOVED, payload => moves.push(payload));
  bus.on(EVENT.NOISE, payload => noises.push(payload));
  w.moveEntity(p, 1, 0, { silent: true });
  assert.equal(moves.length, 1, 'silent does not gag entity:moved (vision still updates)');
  assert.deepEqual(noises, [], 'silent suppresses the noise emit');
});

// --- relocateEntity (free-move without AP cost) ---

test('World.relocateEntity moves entity without AP cost', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2, { maxAp: 4 });
  w.addEntity(p);
  const apBefore = p.ap;
  w.relocateEntity(p, 4, 4);
  assert.equal(p.x, 4);
  assert.equal(p.y, 4);
  assert.equal(p.ap, apBefore, 'relocate must not debit AP');
});

test('World.relocateEntity emits entity:moved', async () => {
  const { EventBus, EVENT } = await import('../../../src/game/events.js');
  const bus = new EventBus();
  const w = new World(new Grid(5, 5), { events: bus });
  const p = makePlayer(2, 2);
  w.addEntity(p);
  const events: unknown[] = [];
  bus.on(EVENT.ENTITY_MOVED, payload => events.push(payload));
  w.relocateEntity(p, 4, 3);
  assert.equal(events.length, 1);
  assert.deepEqual((events[0] as Record<string, unknown>).from, { x: 2, y: 2 });
  assert.deepEqual((events[0] as Record<string, unknown>).to, { x: 4, y: 3 });
});

test('World.relocateEntity throws on occupied tile', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  const d = new Entity({ id: 'd', x: 3, y: 3, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(p);
  w.addEntity(d);
  assert.throws(() => w.relocateEntity(p, 3, 3), /occupied/i);
  assert.equal(p.x, 2, 'position unchanged on failure');
  assert.equal(p.y, 2);
});

test('World.relocateEntity throws on impassable tile', () => {
  const g = new Grid(5, 5);
  g.setTile(3, 3, TILE.WALL);
  const w = new World(g);
  const p = makePlayer(2, 2);
  w.addEntity(p);
  assert.throws(() => w.relocateEntity(p, 3, 3), /passable/i);
});

test('World.relocateEntity throws on out-of-bounds', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  w.addEntity(p);
  assert.throws(() => w.relocateEntity(p, 10, 10), /out of bounds/i);
});

test('World.relocateEntity throws on dead entity', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(2, 2);
  w.addEntity(p);
  p.alive = false;
  assert.throws(() => w.relocateEntity(p, 3, 3), /dead/i);
});

test('World.blockerKeys excludes dead entities', () => {
  const w = new World(new Grid(5, 5));
  const p = makePlayer(1, 1);
  const d = new Entity({ id: 'd', x: 3, y: 2, faction: FACTION.CORP, glyph: 'd' });
  w.addEntity(p);
  w.addEntity(d);
  d.alive = false;
  const keys = w.blockerKeys();
  assert.equal(keys.size, 1);
  assert.ok(keys.has('1,1'));
  assert.equal(keys.has('3,2'), false, 'corpse should not occlude LOS');
});
