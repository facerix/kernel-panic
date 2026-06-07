/**
 * Grid reachability helpers for exploration accounting and impassable prop
 * placement. Uses 8-way passable-tile flood with entity blockers — the same
 * graph recon objectives count and placement validation share.
 */

import { FACTION } from './constants.js';
import { Hostile } from './Hostile.js';
import { Door } from './entities/Door.js';
import { DenyTarget } from './entities/DenyTarget.js';
import { RelayNode } from './entities/RelayNode.js';
import type { Entity } from './Entity.js';
import type { GridPoint } from '../types.js';
import type { World } from './World.js';

export function coordKey(x: number, y: number): string {
  return `${x},${y}`;
}

export type ExplorationReachabilityOptions = {
  /** Treat these coordinate keys as blocked in addition to impassable entities. */
  extraBlockers?: ReadonlySet<string>;
  /** When false, only grid passability matters (legacy / debug only). */
  respectEntityBlockers?: boolean;
  /**
   * When true, locked doors are traversable for flood-fill only (recon
   * eligible-area accounting). Open doors are already passable in gameplay.
   */
  passThroughLockedDoors?: boolean;
  /**
   * When true, transient occupants (hostiles, destroyable props, crew) do not
   * shrink the recon eligible-area graph — only permanent neutral fixtures do.
   */
  reconEligibleArea?: boolean;
};

/** Impassable entities that permanently occupy a tile for recon accounting. */
export function entityBlocksReconEligibleFlood(entity: Entity): boolean {
  if (entity.passable) return false;
  if (entity instanceof Door) return false;
  if (entity instanceof Hostile) return false;
  if (entity instanceof RelayNode) return false;
  if (entity instanceof DenyTarget) return false;
  if (entity.anchored && entity.faction === FACTION.NEUTRAL) return true;
  return false;
}

/** True when any cardinal neighbour is passable and unoccupied. */
export function hasAdjacentPassableTile(world: World, x: number, y: number): boolean {
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    const tx = x + dx;
    const ty = y + dy;
    if (world.grid.inBounds(tx, ty) && world.grid.isPassable(tx, ty) && !world.entityAt(tx, ty)) {
      return true;
    }
  }
  return false;
}

/**
 * Every passable cell reachable from `start` via 8-way adjacency. Respects
 * impassable entities by default (matches recon eligible-cell accounting).
 */
export function explorationReachableKeys(
  world: World,
  start: GridPoint,
  options: ExplorationReachabilityOptions = {}
): Set<string> {
  const {
    extraBlockers = new Set(),
    respectEntityBlockers = true,
    passThroughLockedDoors = false,
    reconEligibleArea = false,
  } = options;
  const reachable = new Set<string>();
  const startKey = coordKey(start.x, start.y);
  if (!world.grid.inBounds(start.x, start.y) || !world.grid.isPassable(start.x, start.y)) {
    return reachable;
  }
  if (extraBlockers.has(startKey)) return reachable;

  const queue: GridPoint[] = [{ x: start.x, y: start.y }];
  reachable.add(startKey);
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i]!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = point.x + dx;
        const y = point.y + dy;
        const key = coordKey(x, y);
        if (reachable.has(key)) continue;
        if (!world.grid.inBounds(x, y)) continue;
        if (!world.grid.isPassable(x, y)) continue;
        if (extraBlockers.has(key)) continue;
        if (respectEntityBlockers) {
          const blocker = world.entityAt(x, y);
          if (blocker) {
            if (reconEligibleArea) {
              if (entityBlocksReconEligibleFlood(blocker)) continue;
            } else if (
              !(passThroughLockedDoors && blocker instanceof Door && blocker.locked)
            ) {
              continue;
            }
          }
        }
        reachable.add(key);
        queue.push({ x, y });
      }
    }
  }
  return reachable;
}

/**
 * True when placing an impassable entity on `anchor` would disconnect part of
 * the exploration graph from `start` (for example sealing a recon pocket).
 */
export function isImpassablePlacementChokepoint(
  world: World,
  start: GridPoint,
  anchor: GridPoint,
  options: Omit<ExplorationReachabilityOptions, 'extraBlockers'> = {}
): boolean {
  const anchorKey = coordKey(anchor.x, anchor.y);
  const baseline = explorationReachableKeys(world, start, options);
  if (!baseline.has(anchorKey)) return false;
  const blocked = explorationReachableKeys(world, start, {
    ...options,
    extraBlockers: new Set([anchorKey]),
  });
  for (const key of baseline) {
    if (key === anchorKey) continue;
    if (!blocked.has(key)) return true;
  }
  return false;
}

/**
 * Safe to place an impassable floor prop at `anchor` without shrinking the
 * exploration graph from `start`.
 */
export function anchorPreservesExplorationReachability(
  world: World,
  start: GridPoint,
  anchor: GridPoint,
  options: Omit<ExplorationReachabilityOptions, 'extraBlockers'> = {}
): boolean {
  return !isImpassablePlacementChokepoint(world, start, anchor, options);
}
