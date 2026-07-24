/**
 * P3.6 — Hostiles route around fire.
 *
 * `stepToward` paths twice: once treating HAZARD tiles as blocked, and — only
 * if that finds nothing at all — once without the restriction. So fire reads
 * as a wall the AI respects, while never becoming a *real* wall: a hostile
 * sealed in by flame still comes for you, it just has to walk through the burn
 * to do it.
 *
 * Deliberately NOT done by weighting A* or by making HAZARD impassable in
 * `Grid.isPassable`. `findPath` is load-bearing for map generation and for the
 * exit-reachability check in `Run.#checkSoftLock` — a player throwing a
 * molotov must never be able to make the game believe the exit is unreachable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { PatrolHostile, type EngageSteps } from '../../../src/game/ai/PatrolHostile.js';
import { TILE, FACTION } from '../../../src/game/constants.js';
import type { World as WorldType } from '../../../src/game/World.js';
import type { Entity } from '../../../src/game/Entity.js';
import type { Rng } from '../../../src/rng.js';

/** Exposes the protected `stepToward` so pathing choices can be asserted directly. */
class ProbeHostile extends PatrolHostile {
  // Never engages — these tests drive `stepToward` directly, so the state
  // machine's engage branch is out of scope.
  // eslint-disable-next-line require-yield
  protected override *engageSteps(_w: WorldType, _r: Rng, _t: Entity): EngageSteps {
    return 'break';
  }
  step(world: WorldType, gx: number, gy: number) {
    return this.stepToward(world, gx, gy, 'investigate');
  }
}

function makeWorld(width: number, height: number) {
  const grid = new Grid(width, height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  return new World(grid);
}

function makeProbe(x: number, y: number) {
  return new ProbeHostile({ id: 'probe', x, y, faction: FACTION.CORP, glyph: 'k', maxAp: 99 });
}

/**
 * A dividing wall at x=2 with exactly two gaps: a NEAR one at (2,2) and a FAR
 * one at (2,4). Probe starts at (0,1), goal is (4,1).
 *
 *        x=0  1    2    3   4
 *   y=0   #   #    #    #   #
 *   y=1   P   .   [#]   .   G
 *   y=2   .   .   near  .   .     ← 4 steps via here
 *   y=3   .   .   [#]   .   .
 *   y=4   .   .   far   .   .     ← 6 steps via here
 *   y=5   #   #    #    #   #
 *
 * The near gap is strictly shorter, so plain uniform-cost A* always takes it.
 * That's what makes this map able to fail: put fire in the near gap and only
 * an AI that actually avoids hazard will take the long way. (An open 1-tile
 * obstacle proves nothing here — 8-connectivity lets you slide around it
 * diagonally for free, so both routes tie and the test just measures A*'s
 * neighbour ordering.)
 */
function makeTwoGapWorld() {
  const world = makeWorld(5, 6);
  for (let x = 0; x < 5; x++) {
    world.grid.setTile(x, 0, TILE.WALL);
    world.grid.setTile(x, 5, TILE.WALL);
  }
  world.grid.setTile(2, 1, TILE.WALL);
  world.grid.setTile(2, 3, TILE.WALL);
  return world;
}

/** Walk the probe to the goal, returning every tile it stood on. */
function walk(world: WorldType, probe: ProbeHostile, gx: number, gy: number) {
  const visited: number[] = [];
  for (let i = 0; i < 20 && !(probe.x === gx && probe.y === gy); i++) {
    probe.ap = 99;
    if (!probe.step(world, gx, gy)) break;
    visited.push(world.grid.tileAt(probe.x, probe.y));
  }
  return { visited, arrived: probe.x === gx && probe.y === gy };
}

test('baseline: with both gaps clear, a hostile takes the shorter near gap', () => {
  // Guards the map itself. If this ever fails, the two routes are no longer
  // asymmetric and the avoidance tests below stop proving anything.
  const world = makeTwoGapWorld();
  const probe = makeProbe(0, 1);
  world.addEntity(probe);

  const seen: string[] = [];
  for (let i = 0; i < 20 && !(probe.x === 4 && probe.y === 1); i++) {
    probe.ap = 99;
    if (!probe.step(world, 4, 1)) break;
    seen.push(`${probe.x},${probe.y}`);
  }

  assert.ok(seen.includes('2,2'), 'unobstructed, the near gap is strictly shorter');
  assert.ok(!seen.includes('2,4'), 'and the far gap is not used');
});

test('a hostile takes a strictly longer route to avoid walking through fire', () => {
  const world = makeTwoGapWorld();
  world.grid.setTile(2, 2, TILE.HAZARD); // plug the *short* gap with fire
  const probe = makeProbe(0, 1);
  world.addEntity(probe);

  const seen: string[] = [];
  for (let i = 0; i < 20 && !(probe.x === 4 && probe.y === 1); i++) {
    probe.ap = 99;
    if (!probe.step(world, 4, 1)) break;
    seen.push(`${probe.x},${probe.y}`);
  }

  assert.ok(!seen.includes('2,2'), 'must not walk into the fire when a route exists');
  assert.ok(seen.includes('2,4'), 'must detour through the far gap instead');
  assert.equal(probe.x, 4, 'and still reaches the goal');
  assert.equal(probe.y, 1);
});

test('a hostile never ends a step on fire while any fire-free route exists', () => {
  const world = makeTwoGapWorld();
  world.grid.setTile(2, 2, TILE.HAZARD);
  const probe = makeProbe(0, 1);
  world.addEntity(probe);

  const { visited, arrived } = walk(world, probe, 4, 1);

  assert.ok(arrived, 'probe reaches the goal');
  assert.ok(
    !visited.includes(TILE.HAZARD),
    'probe stood on fire at some point despite a clear detour'
  );
});

test('a hostile DOES walk through fire when it is the only way through', () => {
  const world = makeTwoGapWorld();
  world.grid.setTile(2, 2, TILE.HAZARD); // fire in the near gap
  world.grid.setTile(2, 4, TILE.WALL); //   and the far gap sealed
  const probe = makeProbe(0, 1);
  world.addEntity(probe);

  const { visited, arrived } = walk(world, probe, 4, 1);

  assert.ok(arrived, 'with no alternative, the probe commits to the burn and still reaches you');
  assert.ok(visited.includes(TILE.HAZARD), 'it had to cross the fire to get there');
});

test('fire never makes a goal unreachable — it is a deterrent, not a wall', () => {
  const world = makeTwoGapWorld();
  world.grid.setTile(2, 2, TILE.HAZARD);
  world.grid.setTile(2, 4, TILE.WALL);
  const probe = makeProbe(0, 1);
  world.addEntity(probe);

  assert.ok(probe.step(world, 4, 1), 'a fire-plugged corridor is still a route, not a dead end');
});

test('a hostile that starts inside fire is not stranded by its own avoidance', () => {
  // The safe-path pass blocks every hazard tile; a hostile already standing in
  // a burn must not path itself into a null and freeze.
  const world = makeWorld(5, 3);
  for (const x of [1, 2, 3]) world.grid.setTile(x, 1, TILE.HAZARD);
  const probe = makeProbe(2, 1);
  world.addEntity(probe);

  const step = probe.step(world, 4, 1);

  assert.ok(step, 'probe still moves');
  assert.notEqual(probe.x, 2, 'and makes progress out of the burn');
});
