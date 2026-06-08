/**
 * Consolidated entity-placement validation and anchor resolution.
 *
 * Every non-passable entity placed on the grid must pass through
 * `isValidBlockingPlacement` — the single authoritative check for whether
 * a tile can safely receive an impassable prop without sealing corridors.
 *
 * `nearestEmptyFloorTile` / `nudgeIfOccupied` resolve procgen anchors that
 * collide with entities already on the map (cardinal BFS through occupied tiles).
 *
 * `checkPlacementIntegrity` is the post-placement safety net: it verifies
 * that no static blocking entity has sealed a passable branch of the map.
 * Call it once after all entities are placed (in enterCombat and in future
 * P2.5.M7.2 "add entities to an existing map" paths).
 */

import type { GridPoint } from '../types.js';
import type { World } from './World.js';
import type { Entity } from './Entity.js';
import { Door } from './entities/Door.js';
import {
  anchorPreservesExplorationReachability,
  coordKey,
  explorationReachableKeys,
  hasAdjacentPassableTile,
} from './mapConnectivity.js';

export type BlockingPlacementOptions = {
  /** Coordinate keys to treat as unavailable. */
  reserved?: ReadonlySet<string>;
};

const CARDINAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Nearest passable, empty floor tile reachable from `(x, y)` via cardinal BFS.
 * Walks through occupied tiles during the search. Returns the anchor when it is
 * already empty; `null` when no empty floor is reachable.
 */
export function nearestEmptyFloorTile(world: World, x: number, y: number): GridPoint | null {
  if (!world.liveEntityAt(x, y)) return { x, y };
  const queue: GridPoint[] = [{ x, y }];
  const seen = new Set([coordKey(x, y)]);
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i]!;
    for (const [dx, dy] of CARDINAL_OFFSETS) {
      const nx = point.x + dx;
      const ny = point.y + dy;
      const key = coordKey(nx, ny);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!world.grid.inBounds(nx, ny)) continue;
      if (!world.grid.isPassable(nx, ny)) continue;
      if (world.liveEntityAt(nx, ny)) {
        queue.push({ x: nx, y: ny });
        continue;
      }
      return { x: nx, y: ny };
    }
  }
  return null;
}

/**
 * If `entity` is alive and its tile is already occupied, move it to the nearest
 * empty floor tile from {@link nearestEmptyFloorTile}. Passable props (keycards,
 * consumables) count as occupied — impassable entities do not share their tile.
 *
 * Returns `true` when the entity is placeable (no conflict, or successfully
 * nudged). Returns `false` when no empty floor tile is reachable.
 */
export function nudgeIfOccupied(entity: Entity, world: World): boolean {
  if (!entity.alive || entity.passable) return true;
  if (!world.liveEntityAt(entity.x, entity.y)) return true;

  const origX = entity.x;
  const origY = entity.y;
  const dest = nearestEmptyFloorTile(world, origX, origY);
  if (!dest) return false;

  entity.x = dest.x;
  entity.y = dest.y;
  if (dest.x !== origX || dest.y !== origY) {
    console.warn(
      `[placement] tile (${origX}, ${origY}) already occupied — nudged ${entity.id} to (${dest.x}, ${dest.y})`
    );
  }
  return true;
}

/**
 * True when `anchor` can safely receive an impassable entity without
 * blocking map connectivity.
 *
 * Checks (in order):
 *  1. Tile is in-bounds and passable
 *  2. Not the spawn or exit tile
 *  3. Not already occupied by a live entity
 *  4. Not reserved
 *  5. Has at least one adjacent passable+unoccupied tile (interaction access)
 *  6. Placing an impassable blocker here won't disconnect any part of the
 *     exploration graph from `spawn`
 *
 * Door-aware callers should temporarily set the door's lock state before
 * calling, then restore it afterward.
 */
export function isValidBlockingPlacement(
  world: World,
  spawn: GridPoint,
  exitTile: GridPoint,
  anchor: GridPoint,
  opts?: BlockingPlacementOptions
): boolean {
  const { x, y } = anchor;
  if (!world.grid.inBounds(x, y)) return false;
  if (!world.grid.isPassable(x, y)) return false;
  if (x === spawn.x && y === spawn.y) return false;
  if (x === exitTile.x && y === exitTile.y) return false;
  if (world.liveEntityAt(x, y)) return false;
  if (opts?.reserved?.has(coordKey(x, y))) return false;
  if (!hasAdjacentPassableTile(world, x, y)) return false;
  return anchorPreservesExplorationReachability(world, spawn, anchor);
}

/**
 * Post-placement integrity check. Returns `true` when no static blocking
 * entity has sealed off a passable branch of the map.
 *
 * Algorithm:
 *  1. Temporarily unlock every door (they become walk-through).
 *  2. Collect coordinates of all static blocking entities (terminals, turrets,
 *     etc. — NOT doors, NOT mobile entities like drones/civilians/player).
 *  3. Flood-fill from `spawn` ignoring all entity blockers (grid-only).
 *  4. Flood-fill from `spawn` with static blockers.
 *  5. Any grid-reachable tile that the static-blocked flood can't reach
 *     (and isn't a static blocker tile itself) means a passage was sealed.
 *
 * Callers should treat `false` as "this map has a sealed branch" and
 * recover gracefully (e.g. regenerate).
 */
export function checkPlacementIntegrity(world: World, spawn: GridPoint): boolean {
  // Snapshot door lock states and temporarily unlock all doors.
  const doorStates: Array<{ door: Door; wasLocked: boolean }> = [];
  for (const e of world.entities.values()) {
    if (e instanceof Door && e.locked) {
      doorStates.push({ door: e, wasLocked: true });
      e.unlock();
    }
  }

  try {
    // Collect anchored non-door blocking entity positions.
    // Anchored entities (terminals, deny targets, sync pads, etc.) are fixed
    // to their tile — they permanently seal any corridor they sit on. Doors
    // are excluded (we just unlocked them above). Non-anchored entities
    // (drones, civilians, player) can move off a chokepoint during gameplay.
    const staticBlockers = new Set<string>();
    for (const e of world.entities.values()) {
      if (!e.alive || e.passable) continue;
      if (e instanceof Door) continue;
      if (!e.anchored) continue;
      staticBlockers.add(coordKey(e.x, e.y));
    }

    // Grid-only flood (ignores all entities).
    const gridReachable = explorationReachableKeys(world, spawn, {
      respectEntityBlockers: false,
    });

    // Flood with static prop blockers.
    const withBlockers = explorationReachableKeys(world, spawn, {
      respectEntityBlockers: false,
      extraBlockers: staticBlockers,
    });

    for (const key of gridReachable) {
      if (withBlockers.has(key)) continue;
      if (staticBlockers.has(key)) continue; // the blocker's own tile
      return false;
    }
    return true;
  } finally {
    for (const { door, wasLocked } of doorStates) {
      if (wasLocked) door.lock();
    }
  }
}
