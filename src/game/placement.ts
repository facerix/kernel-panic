/**
 * Consolidated entity-placement validation.
 *
 * Every non-passable entity placed on the grid must pass through
 * `isValidBlockingPlacement` — the single authoritative check for whether
 * a tile can safely receive an impassable prop without sealing corridors.
 *
 * `checkPlacementIntegrity` is the post-placement safety net: it verifies
 * that no static blocking entity has sealed a passable branch of the map.
 * Call it once after all entities are placed (in enterCombat and in future
 * M7.2 "add entities to an existing map" paths).
 */

import type { GridPoint } from '../types.js';
import type { World } from './World.js';
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
