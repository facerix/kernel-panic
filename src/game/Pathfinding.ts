/**
 * A* pathfinding over the current passable tiles.
 *
 * Geometry matches `World.canMoveEntity`: 8-neighbour Chebyshev steps with
 * uniform cost (diagonal == orthogonal in V1 — see the deferred-fix list).
 * Heuristic is Chebyshev distance, which is admissible *and* consistent for
 * unit-cost 8-neighbour grids, so A* terminates with an optimal path.
 *
 * **No path caching across calls.** Drone behaviour calls `findPath` fresh
 * every step because the grid will mutate when destruction lands in M7 and a
 * stale cache would steer drones through walls. Cheap at V1 grid sizes
 * (~24×16) — the heap rarely exceeds a few dozen entries.
 *
 * Live entities are treated as blockers, with one exception: the *goal* tile
 * is allowed to be occupied by default. That's what an engaging drone needs —
 * "path toward the player" should produce a route even though the player
 * stands on the goal — so the drone can take the first step and re-evaluate.
 * Pass `allowOccupiedGoal: false` for callers that need a strictly-empty
 * destination (none in M5; reserved for movement commands).
 */

import type { World } from './World.js';
import type { GridPoint } from '../types.js';

const NEIGHBOURS = Object.freeze([
  Object.freeze([-1, -1]),
  Object.freeze([0, -1]),
  Object.freeze([1, -1]),
  Object.freeze([-1, 0]),
  Object.freeze([1, 0]),
  Object.freeze([-1, 1]),
  Object.freeze([0, 1]),
  Object.freeze([1, 1]),
]);

const keyOf = (x: number, y: number): string => `${x},${y}`;

/**
 * Chebyshev (king-move) distance — the heuristic we use, exposed so callers
 * (drone AI, debug overlays) can share the geometry instead of re-rolling
 * `Math.max(Math.abs(...), Math.abs(...))` inline.
 */
export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
type FindPathOptions = {
  allowOccupiedGoal?: boolean;
  maxSteps?: number;
  /** Treat these `"x,y"` keys as occupied even when no entity is present. */
  extraBlockers?: ReadonlySet<string>;
};

/**
 * Find a shortest path from `start` to `goal`. Returns an array of step
 * coordinates from `start` (exclusive) to `goal` (inclusive); `[]` when
 * `start` already equals `goal`; `null` when unreachable under the current
 * grid / occupation state or when `maxSteps` is exceeded.
 */
export function findPath(
  world: World,
  start: GridPoint,
  goal: GridPoint,
  options: FindPathOptions = {}
): GridPoint[] | null {
  if (!world || !world.grid) {
    throw new TypeError('findPath requires a world with a grid');
  }
  validatePoint('start', start);
  validatePoint('goal', goal);
  if (!world.grid.inBounds(start.x, start.y)) {
    throw new RangeError(`findPath: start (${start.x}, ${start.y}) out of grid bounds`);
  }
  if (!world.grid.inBounds(goal.x, goal.y)) {
    throw new RangeError(`findPath: goal (${goal.x}, ${goal.y}) out of grid bounds`);
  }

  const allowOccupiedGoal = options.allowOccupiedGoal ?? true;
  const maxSteps = options.maxSteps ?? Number.POSITIVE_INFINITY;
  const extraBlockers = options.extraBlockers;
  if (!(maxSteps === Number.POSITIVE_INFINITY || (Number.isInteger(maxSteps) && maxSteps >= 0))) {
    throw new RangeError(
      `findPath: maxSteps must be a non-negative integer or Infinity, got ${maxSteps}`
    );
  }

  const startKey = keyOf(start.x, start.y);
  const goalKey = keyOf(goal.x, goal.y);
  if (startKey === goalKey) return [];

  // Note: we *don't* gate on the start tile being passable. A drone could
  // theoretically be on a tile mid-destruction; refusing to plan would deadlock
  // it. The first step is the only one that matters and it's validated below.

  const open = new MinHeap();
  const cameFrom = new Map();
  const gScore = new Map();

  gScore.set(startKey, 0);
  open.push({ x: start.x, y: start.y }, chebyshev(start.x, start.y, goal.x, goal.y));

  while (!open.isEmpty()) {
    const cur = open.pop() as GridPoint;
    const ck = keyOf(cur.x, cur.y);
    if (ck === goalKey) {
      return reconstruct(cameFrom, ck);
    }
    const curG = gScore.get(ck);
    // Stale entries land in the heap when we find a shorter path to a node
    // already inside; ignore them.
    if (curG === undefined) continue;
    if (curG >= maxSteps) continue;

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!world.grid.inBounds(nx, ny)) continue;
      if (!world.grid.isPassable(nx, ny)) continue;
      const nk = keyOf(nx, ny);
      const isGoal = nk === goalKey;
      // Entity occupation: blocks every tile except, optionally, the goal.
      if (!(isGoal && allowOccupiedGoal) && world.entityAt(nx, ny)) continue;
      if (!(isGoal && allowOccupiedGoal) && extraBlockers?.has(nk)) continue;

      const tentativeG = curG + 1;
      if (tentativeG > maxSteps) continue;
      const prev = gScore.get(nk);
      if (prev !== undefined && prev <= tentativeG) continue;
      gScore.set(nk, tentativeG);
      cameFrom.set(nk, { x: cur.x, y: cur.y });
      const f = tentativeG + chebyshev(nx, ny, goal.x, goal.y);
      open.push({ x: nx, y: ny }, f);
    }
  }
  return null;
}

function validatePoint(label: string, p: GridPoint) {
  if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y)) {
    throw new TypeError(`findPath: ${label} requires integer x,y; got ${JSON.stringify(p)}`);
  }
}

function reconstruct(cameFrom: Map<string, GridPoint>, endKey: string): GridPoint[] {
  // Build the path backward from goal, then reverse. The start tile is *not*
  // included — callers (like the drone AI) want the next step, not their own
  // square.
  const path: GridPoint[] = [];
  let key = endKey;
  while (cameFrom.has(key)) {
    const [xs, ys] = key.split(',');
    path.push({ x: Number(xs), y: Number(ys) });
    const prev = cameFrom.get(key);
    key = keyOf(prev!.x, prev!.y);
  }
  path.reverse();
  return path;
}

/**
 * Minimal binary min-heap keyed by a numeric priority. Internal — not
 * exported. Plenty fast for V1 grid sizes; if pathfinding ever becomes hot,
 * swap in a bucket queue (uniform-cost grids benefit).
 */
class MinHeap {
  items: unknown[];
  priorities: number[];

  constructor() {
    this.items = [];
    this.priorities = [];
  }

  isEmpty() {
    return this.items.length === 0;
  }

  push(item: unknown, priority: number) {
    if (!Number.isFinite(priority)) {
      throw new RangeError(`MinHeap priority must be finite, got ${priority}`);
    }
    this.items.push(item);
    this.priorities.push(priority);
    this.#bubbleUp(this.items.length - 1);
  }

  pop(): unknown {
    if (this.items.length === 0) {
      throw new Error('MinHeap.pop called on empty heap');
    }
    const top = this.items[0];
    const last = this.items.pop();
    const lastP = this.priorities.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.priorities[0] = lastP!;
      this.#bubbleDown(0);
    }
    return top;
  }

  #bubbleUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[i] >= this.priorities[parent]) break;
      this.#swap(i, parent);
      i = parent;
    }
  }

  #bubbleDown(i: number) {
    const n = this.items.length;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.priorities[left] < this.priorities[smallest]) smallest = left;
      if (right < n && this.priorities[right] < this.priorities[smallest]) smallest = right;
      if (smallest === i) break;
      this.#swap(i, smallest);
      i = smallest;
    }
  }

  #swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
  }
}
