/**
 * combatTurnPipeline — player aftermath and turn phase order are single-sourced here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Turret } from '../../../src/game/Turret.js';
import { CorpDrone } from '../../../src/game/ai/CorpDrone.js';
import { EventBus } from '../../../src/game/events.js';
import { TILE } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';
import {
  advanceFromPlayerTurn,
  drivePlayerAftermath,
  runPlayerAftermath,
  runPlayerAftermathSteps,
  formatPlayerAftermathStepLogLines,
  formatPlayerAftermathLogLines,
} from '../../../src/game/combatTurnPipeline.js';

function makeOpenWorld() {
  const grid = new Grid(8, 8);
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  const bus = new EventBus();
  return { world: new World(grid, { events: bus }), bus };
}

test('runPlayerAftermath returns turretAutoFire array (may be empty)', () => {
  const { world } = makeOpenWorld();
  const aftermath = runPlayerAftermath(world, new Rng(1));
  assert.ok(Array.isArray(aftermath.steps));
  assert.ok(Array.isArray(aftermath.turretAutoFire));
  assert.equal(aftermath.turretAutoFire.length, 0);
});

test('runPlayerAftermathSteps yields one step per live turret', () => {
  const { world } = makeOpenWorld();
  const live = new Turret({ id: 'live', x: 2, y: 2 });
  const dead = new Turret({ id: 'dead', x: 4, y: 4 });
  world.addEntity(live);
  world.addEntity(dead);
  dead.damage(dead.maxHp);

  const steps = [...runPlayerAftermathSteps(world, new Rng(1))];
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'turret-autofire');
  assert.equal(steps[0].turret, live);
  assert.equal(steps[0].action.reason, 'no-target');
});

test('formatPlayerAftermathLogLines describes a turret hit', () => {
  const { world, bus } = makeOpenWorld();
  const turret = new Turret({ id: 't1', x: 2, y: 2 });
  const drone = new CorpDrone({
    id: 'drone-0',
    x: 3,
    y: 2,
    maxAp: 3,
    patrolWaypoints: [{ x: 3, y: 2 }],
  });
  world.addEntity(turret);
  world.addEntity(drone);
  drone.bindToBus(bus);
  const aftermath = runPlayerAftermath(world, new Rng(0));
  const lines = formatPlayerAftermathLogLines(aftermath);
  assert.deepEqual(formatPlayerAftermathStepLogLines(aftermath.steps[0]), lines);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /t1 auto-fires at drone-0/);
  assert.match(lines[0], /HIT|miss/);
});

test('drivePlayerAftermath pumps one step per schedule tick', () => {
  const { world } = makeOpenWorld();
  world.addEntity(new Turret({ id: 't1', x: 2, y: 2 }));
  world.addEntity(new Turret({ id: 't2', x: 4, y: 4 }));
  const calls = [];
  const scheduleQueue = [];
  const animLock = { pushes: [], push: ms => animLock.pushes.push(ms) };

  drivePlayerAftermath({
    world,
    rng: new Rng(1),
    onStep: step => calls.push(step.turret.id),
    onFinish: () => calls.push('finish'),
    animLock,
    stepDelayMs: 50,
    lockMarginMs: 10,
    schedule: (fn, ms) => scheduleQueue.push({ fn, ms }),
  });

  assert.deepEqual(calls, ['t1']);
  assert.deepEqual(animLock.pushes, [60]);
  assert.equal(scheduleQueue.length, 1);
  assert.equal(scheduleQueue[0].ms, 50);

  scheduleQueue.shift().fn();
  assert.deepEqual(calls, ['t1', 't2']);
  scheduleQueue.shift().fn();
  assert.deepEqual(calls, ['t1', 't2', 'finish']);
});

test('advanceFromPlayerTurn orders player aftermath before corp and final player handoff', () => {
  const { world } = makeOpenWorld();
  world.addEntity(new Turret({ id: 't1', x: 2, y: 2 }));
  const calls = [];
  const queue = {
    endTurn: () => calls.push('queue.endTurn'),
  };

  advanceFromPlayerTurn({
    queue,
    world,
    rng: new Rng(1),
    onCorpTurnReady: () => calls.push('corp.ready'),
    onPlayerAftermathStep: step => {
      assert.equal(step.type, 'turret-autofire');
      calls.push('player.aftermath.step');
    },
    driveCorpTurn: ({ onFinish }) => {
      calls.push('corp.drive');
      onFinish();
    },
    onPlayerTurnReady: () => calls.push('player.ready'),
  });

  assert.deepEqual(calls, [
    'queue.endTurn',
    'corp.ready',
    'player.aftermath.step',
    'corp.drive',
    'queue.endTurn',
    'player.ready',
  ]);
});

test('advanceFromPlayerTurn waits for async aftermath before starting corp', () => {
  const { world } = makeOpenWorld();
  const calls = [];
  let finishAftermath;
  const queue = {
    endTurn: () => calls.push('queue.endTurn'),
  };

  advanceFromPlayerTurn({
    queue,
    world,
    rng: new Rng(1),
    drivePlayerAftermath: ({ onFinish }) => {
      calls.push('aftermath.drive');
      finishAftermath = onFinish;
    },
    driveCorpTurn: ({ onFinish }) => {
      calls.push('corp.drive');
      onFinish();
    },
    onPlayerTurnReady: () => calls.push('player.ready'),
  });

  assert.deepEqual(calls, ['queue.endTurn', 'aftermath.drive']);
  finishAftermath();
  assert.deepEqual(calls, [
    'queue.endTurn',
    'aftermath.drive',
    'corp.drive',
    'queue.endTurn',
    'player.ready',
  ]);
});

test('advanceFromPlayerTurn lets async corp driver own when the player turn resumes', () => {
  const { world } = makeOpenWorld();
  const calls = [];
  let finishCorpTurn;
  const queue = {
    endTurn: () => calls.push('queue.endTurn'),
  };

  advanceFromPlayerTurn({
    queue,
    world,
    rng: new Rng(1),
    drivePlayerAftermath: ({ onFinish }) => onFinish(),
    driveCorpTurn: ({ onFinish }) => {
      calls.push('corp.drive');
      finishCorpTurn = onFinish;
    },
    onPlayerTurnReady: () => calls.push('player.ready'),
  });

  assert.deepEqual(calls, ['queue.endTurn', 'corp.drive']);
  finishCorpTurn();
  assert.deepEqual(calls, ['queue.endTurn', 'corp.drive', 'queue.endTurn', 'player.ready']);
});

test('advanceFromPlayerTurn rejects malformed ctx', () => {
  const { world } = makeOpenWorld();
  const valid = {
    queue: { endTurn: () => {} },
    world,
    rng: new Rng(1),
    driveCorpTurn: () => {},
  };
  assert.throws(() => advanceFromPlayerTurn(null), /ctx/);
  assert.throws(() => advanceFromPlayerTurn({ ...valid, queue: {} }), /queue\.endTurn/);
  assert.throws(() => advanceFromPlayerTurn({ ...valid, world: {} }), /world\.entities/);
  assert.throws(() => advanceFromPlayerTurn({ ...valid, rng: {} }), /Rng-like/);
  assert.throws(() => advanceFromPlayerTurn({ ...valid, driveCorpTurn: null }), /driveCorpTurn/);
  assert.throws(
    () => advanceFromPlayerTurn({ ...valid, drivePlayerAftermath: null }),
    /drivePlayerAftermath/
  );
});
