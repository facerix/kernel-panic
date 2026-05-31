import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { Entity } from '../../../src/game/Entity.js';
import { World } from '../../../src/game/World.js';
import {
  TILE,
  FACTION,
  DEFAULT_HP,
  SPOTTER_SIGHT_RANGE,
  ENEMY_TIER,
} from '../../../src/game/constants.js';
import { Spotter } from '../../../src/game/ai/Spotter.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { PatrolHostile, PATROL_STATE } from '../../../src/game/ai/PatrolHostile.js';
import { EventBus, EVENT, ALARM_KIND } from '../../../src/game/events.js';
import { ALARM_PHASE } from '../../../src/game/World.js';
import { Rng } from '../../../src/rng.js';

const openWorld = (w = 14, h = 8) => new World(new Grid(w, h), { events: new EventBus() });

/** Capture every ALARM payload emitted on the world bus. */
const captureAlarms = world => {
  const seen = [];
  world.events.on(EVENT.ALARM, payload => seen.push(payload));
  return seen;
};

const addPlayer = (world, x, y) => {
  const player = new Entity({ id: 'player', x, y, faction: FACTION.PLAYER, glyph: '@' });
  world.addEntity(player);
  return player;
};

// --- identity ----------------------------------------------------------------

test('Spotter is a corp PatrolHostile with the spotter glyph and extended sight', () => {
  const spotter = new Spotter({ id: 'spotter-0', x: 1, y: 1 });
  assert.ok(spotter instanceof PatrolHostile, 'shares the patrol state machine');
  assert.ok(!(spotter instanceof Skirmisher), 'is a sibling of Skirmisher, not a subclass');
  assert.equal(spotter.faction, FACTION.CORP);
  assert.equal(spotter.glyph, 's');
  assert.equal(spotter.sightRange, SPOTTER_SIGHT_RANGE);
});

test('Spotter at T2 has baseline specialist HP and no armor (evasion is positional)', () => {
  const spotter = new Spotter({ id: 'spotter-0', x: 1, y: 1, tier: ENEMY_TIER.T2 });
  assert.equal(spotter.maxHp, DEFAULT_HP, 'specialist T2 hp multiplier is 1.0×');
  assert.equal(spotter.damageReduction, 0, 'no armor — vantage AI, not dodge, keeps it alive');
});

// --- spot mode: per-turn target share ---------------------------------------

test('Spotter with LOS pings ALARM kind:spotter every turn without raising the facility alarm', () => {
  const world = openWorld();
  const player = addPlayer(world, 2, 3);
  const spotter = new Spotter({ id: 'spotter-0', x: 6, y: 3, maxAp: 3 });
  world.addEntity(spotter);
  const alarms = captureAlarms(world);

  const log1 = spotter.takeTurn(world, new Rng(1));
  assert.ok(
    log1.some(step => step.type === 'spot' && step.target === 'player'),
    'yields a spot step targeting the player'
  );
  assert.equal(alarms.length, 1, 'exactly one ping this turn');
  assert.equal(alarms[0].kind, ALARM_KIND.SPOTTER, 'spotter-kind, not facility');
  assert.equal(alarms[0].target, player);
  assert.equal(world.alarm.phase, ALARM_PHASE.QUIET, 'facility latch untouched — no raiseAlarm');

  // Second turn (sight still holds) pings again — the value is the refresh.
  spotter.refreshAp();
  spotter.takeTurn(world, new Rng(2));
  assert.equal(alarms.length, 2, 'pings again next turn while LOS holds');
});

test('a subscribed patrol hostile force-engages on a spotter ping (fresh coords)', () => {
  const world = openWorld();
  const player = addPlayer(world, 2, 3);
  const spotter = new Spotter({ id: 'spotter-0', x: 6, y: 3, maxAp: 1 });
  world.addEntity(spotter);
  // A guard far away, out of its own sight, only learns of the player via the
  // spotter's ping (it subscribes to ALARM; the spotter does not).
  const ally = new Skirmisher({ id: 'drone-0', x: 12, y: 7 });
  world.addEntity(ally);
  ally.bindToBus(world.events);

  spotter.takeTurn(world, new Rng(1));
  assert.equal(ally.state, PATROL_STATE.ENGAGE, 'ally re-engages on the shared target');
  assert.deepEqual(ally.lastKnownTarget, { x: player.x, y: player.y });
});

test('Spotter does not consume ALARM events (no self-wake, no facility coupling)', () => {
  const bus = new EventBus();
  const spotter = new Spotter({ id: 'spotter-0', x: 2, y: 2 });
  spotter.bindToBus(bus);

  bus.emit(EVENT.ALARM, {
    kind: ALARM_KIND.FACILITY,
    target: { id: 'player', x: 8, y: 3, alive: true },
  });
  assert.equal(spotter.state, PATROL_STATE.PATROL, 'ignores incoming alarms');
  assert.equal(spotter.lastKnownTarget, null);

  // But it still latches noise like any patrol hostile (proves bind worked).
  bus.emit(EVENT.NOISE, { origin: { x: 7, y: 4 } });
  assert.equal(spotter.state, PATROL_STATE.INVESTIGATE);
});

test('a dead spotter emits no pings', () => {
  const world = openWorld();
  addPlayer(world, 2, 3);
  const spotter = new Spotter({ id: 'spotter-0', x: 6, y: 3, maxAp: 3 });
  world.addEntity(spotter);
  const alarms = captureAlarms(world);
  spotter.alive = false;
  const log = spotter.takeTurn(world, new Rng(1));
  assert.deepEqual(log, []);
  assert.equal(alarms.length, 0, 'killing the spotter stops the pings');
});

test('Spotter does not spot a stealthed target beyond Chebyshev 1', () => {
  const world = openWorld();
  const player = addPlayer(world, 2, 3);
  player.stealthed = true;
  const spotter = new Spotter({ id: 'spotter-0', x: 6, y: 3, maxAp: 3 });
  world.addEntity(spotter);
  const alarms = captureAlarms(world);
  const log = spotter.takeTurn(world, new Rng(1));
  assert.ok(!log.some(step => step.type === 'spot'), 'no ping on a hidden distant target');
  assert.equal(alarms.length, 0);
});

// --- vantage AI: distance-maximising LOS hunt --------------------------------

test('Spotter without LOS seeks a max-distance vantage instead of closing on the lead', () => {
  // Open field, no live target. The spotter is INVESTIGATING a last-known
  // position; a skirmisher/guard would step *toward* it. The spotter instead
  // moves to the farthest neighbour that still holds sight — vantage, not chase.
  const world = openWorld();
  const spotter = new Spotter({ id: 'spotter-0', x: 5, y: 3, maxAp: 1 });
  world.addEntity(spotter);
  spotter.state = PATROL_STATE.INVESTIGATE;
  spotter.lastKnownTarget = { x: 1, y: 3 };

  const log = spotter.takeTurn(world, new Rng(1));
  assert.ok(
    log.some(step => step.type === 'move-investigate'),
    'repositions while investigating'
  );
  assert.ok(spotter.x > 5, 'moved AWAY from the lead (vantage), not toward it');
});

test('cornered spotter with no LOS-restoring vantage falls back to closing in', () => {
  // A wall column at x=4 splits the room with its only doorway at the bottom
  // (4,5). The spotter sits top-right at (6,1) with the lead at (1,1): no
  // neighbour can see across the wall (the door is nowhere near the sightline),
  // so vantage-seeking yields nothing and it falls back to pathing toward the
  // lead through the doorway — reacquire, not flee.
  const world = openWorld(10, 7);
  for (let y = 0; y < 7; y++) world.grid.setTile(4, y, TILE.WALL);
  world.grid.setTile(4, 5, TILE.FLOOR);
  const spotter = new Spotter({ id: 'spotter-0', x: 6, y: 1, maxAp: 1 });
  world.addEntity(spotter);
  spotter.state = PATROL_STATE.INVESTIGATE;
  spotter.lastKnownTarget = { x: 1, y: 1 };

  const before = Math.max(Math.abs(1 - spotter.x), Math.abs(1 - spotter.y));
  const log = spotter.takeTurn(world, new Rng(1));
  assert.ok(
    log.some(step => step.type === 'move-investigate'),
    'still makes progress toward reacquiring'
  );
  const after = Math.max(Math.abs(1 - spotter.x), Math.abs(1 - spotter.y));
  assert.ok(after < before, 'closed toward the lead when no vantage restores LOS');
});
