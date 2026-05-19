/**
 * Procedural map builder. Pure over an `Rng` — same seed + dimensions +
 * threat count produces an identical grid, drone roster, and exit tile.
 *
 * Pipeline:
 *   1. Fork the caller's rng with label `'mapgen'` so future procgen tweaks
 *      don't perturb combat rolls. (See `Rng.fork` for the substream design.)
 *   2. Allocate a WALL-filled grid the size of the map.
 *   3. BSP-split the map until every leaf is between MIN_LEAF and MAX_LEAF.
 *   4. Stamp a prefab into each leaf (random offset inside the leaf), keeping
 *      anchors translated into world coordinates.
 *   5. Carve L-shaped corridors between every internal split's two children
 *      so the whole map is one connected component on FLOOR tiles. Corridors
 *      only overwrite WALL — cover that happens to lie on the path stays
 *      cover (a cover tile in a corridor is exactly the kind of tactical
 *      pinch the blueprint asks for).
 *   6. Place the player spawn at the first leaf's prefab center; the exit
 *      tile at the last leaf's first declared exit anchor (or its center).
 *   7. Pick `threatCount` drone anchors from leaves *other than* the spawn
 *      leaf — first-come-first-served in DFS order. If we can't satisfy the
 *      threat budget, throw — silently dropping a drone is data corruption
 *      that would mask a content bug.
 *
 * The exit cell is stamped as `TILE.EXIT` (passable like FLOOR) so the
 * renderer shows a door glyph. `exitTile` remains the sidecar coordinate
 * for `Run` reach-exit detection.
 */

import { Grid } from '../Grid.js';
import { CONTRACT_DIFFICULTY, TILE } from '../constants.js';
import { BSP_TUNABLES, splitRegion, leaves, internalNodes } from './bsp.js';
import { fittingPrefabs } from './prefabs/index.js';
import type { Rng } from '../../rng.js';
import type { GridPoint } from '../../types.js';
import type { BspNode } from './bsp.js';
import type { ParsedPrefab } from './prefabs/types.js';
import type { ContractDifficulty } from '../constants.js';

const DEFAULT_THREAT_COUNT = 2;
const DEFAULT_MAX_CORP_CIVILIANS = 1;
const DEFAULT_MAX_NEUTRAL_CIVILIANS = 1;

/**
 * The outermost 1-tile rim of the grid is always reserved for WALL. The BSP
 * gets confined to the inner rectangle so prefabs can't be stamped flush
 * against rows 0 or H-1 / columns 0 or W-1 — which read like a room that's
 * "cut off mid-corridor". The whole-grid `Grid` starts WALL-filled so the
 * rim is implicit; this constant just controls where the playable region
 * begins. Bump to 2 if a future palette tweak makes the rim look too thin.
 */
const EDGE_INSET = 1;

type EntityAnchor = {
  x: number;
  y: number;
  waypoints: { x: number; y: number }[];
};
export type CivilianAnchor = {
  x: number;
  y: number;
};
export type Map = {
  grid: Grid;
  spawns: { player: GridPoint };
  drones: EntityAnchor[];
  corpCivilians: CivilianAnchor[];
  neutralCivilians: CivilianAnchor[];
  exitTile: GridPoint;
};

type StampedLeaf = {
  leaf: BspNode;
  prefab: ParsedPrefab;
  originX: number;
  originY: number;
  center: GridPoint;
  droneWorld: EntityAnchor[];
  patrolPathsWorld: GridPoint[][];
  exitWorld: GridPoint[];
  corpCivilianWorld: CivilianAnchor[];
  neutralCivilianWorld: CivilianAnchor[];
};
type BuildMapOptions = {
  rng: Rng;
  width: number;
  height: number;
  threatCount?: number;
  difficulty?: ContractDifficulty;
  maxCorpCivilians?: number;
  maxNeutralCivilians?: number;
};

/**
 * @param {{ rng: import('../../rng.js').Rng, width: number, height: number,
 *           threatCount?: number }} options
 * @returns {{ grid: Grid, spawns: { player: {x:number,y:number} },
 *             drones: Array<{x:number,y:number,waypoints:{x:number,y:number}[]}>,
 *             exitTile: { x: number, y: number } }}
 */
export function buildMap({
  rng,
  width,
  height,
  threatCount = DEFAULT_THREAT_COUNT,
  difficulty = CONTRACT_DIFFICULTY.ELEVATED,
  maxCorpCivilians,
  maxNeutralCivilians,
}: BuildMapOptions): Map {
  if (!rng || typeof rng.fork !== 'function') {
    throw new TypeError('buildMap requires an Rng with fork() (use src/rng.js)');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(
      `buildMap: width/height must be positive integers, got ${width}x${height}`
    );
  }
  if (!Number.isInteger(threatCount) || threatCount < 0) {
    throw new RangeError(
      `buildMap: threatCount must be a non-negative integer, got ${threatCount}`
    );
  }
  if (!isDifficulty(difficulty)) {
    throw new Error(`buildMap: unknown difficulty "${difficulty}"`);
  }
  const civilianCaps = civilianCapsForDifficulty(difficulty);
  const resolvedMaxCorpCivilians = maxCorpCivilians ?? civilianCaps.corp;
  const resolvedMaxNeutralCivilians = maxNeutralCivilians ?? civilianCaps.neutral;
  if (!Number.isInteger(resolvedMaxCorpCivilians) || resolvedMaxCorpCivilians < 0) {
    throw new RangeError(
      `buildMap: maxCorpCivilians must be a non-negative integer, got ${maxCorpCivilians}`
    );
  }
  if (!Number.isInteger(resolvedMaxNeutralCivilians) || resolvedMaxNeutralCivilians < 0) {
    throw new RangeError(
      `buildMap: maxNeutralCivilians must be a non-negative integer, got ${maxNeutralCivilians}`
    );
  }

  const mapRng = rng.fork('mapgen');
  const grid = new Grid(width, height, TILE.WALL);

  const playableWidth = width - EDGE_INSET * 2;
  const playableHeight = height - EDGE_INSET * 2;
  if (playableWidth < BSP_TUNABLES.MIN_LEAF || playableHeight < BSP_TUNABLES.MIN_LEAF) {
    // Caller asked for a map smaller than `MIN_LEAF + 2 × EDGE_INSET` on
    // either axis. The BSP would crash anyway with a less helpful message;
    // surface the inset relationship so the failure points at the user-facing
    // dimensions instead of an internal `splitRegion` constraint.
    throw new RangeError(
      `buildMap: ${width}x${height} map is too small after ${EDGE_INSET}-tile rim inset ` +
        `(playable ${playableWidth}x${playableHeight}, need ≥ ${BSP_TUNABLES.MIN_LEAF})`
    );
  }
  const root = splitRegion(mapRng, {
    x: EDGE_INSET,
    y: EDGE_INSET,
    width: playableWidth,
    height: playableHeight,
  });

  // Stamp prefabs in DFS-leaf order (same order `leaves()` returns).
  const stamped: StampedLeaf[] = [];
  for (const leaf of leaves(root)) {
    stamped.push(stampPrefab(grid, mapRng, leaf));
  }

  // Connect every internal split. For each split node, pick a representative
  // stamped leaf in each subtree (the first-seen in DFS order) and carve.
  for (const node of internalNodes(root)) {
    const a = representativeCenter(stamped, node.left!);
    const b = representativeCenter(stamped, node.right!);
    carveCorridor(grid, a, b);
  }

  if (stamped.length === 0) {
    throw new Error('buildMap: BSP produced zero leaves');
  }

  // Player spawn: first leaf's prefab center. Force FLOOR there in case the
  // prefab put COVER on its centre (none today, but defensive).
  const spawnLeaf = stamped[0];
  const playerSpawn = { ...spawnLeaf.center };
  if (grid.tileAt(playerSpawn.x, playerSpawn.y) !== TILE.FLOOR) {
    grid.setTile(playerSpawn.x, playerSpawn.y, TILE.FLOOR);
  }

  // Exit tile: last leaf's first declared exit anchor, or its centre.
  const exitLeaf = stamped[stamped.length - 1];
  const exitTile = exitLeaf.exitWorld[0] ? { ...exitLeaf.exitWorld[0] } : { ...exitLeaf.center };
  if (grid.tileAt(exitTile.x, exitTile.y) !== TILE.FLOOR) {
    grid.setTile(exitTile.x, exitTile.y, TILE.FLOOR);
  }
  grid.setTile(exitTile.x, exitTile.y, TILE.EXIT);
  if (exitTile.x === playerSpawn.x && exitTile.y === playerSpawn.y) {
    throw new Error(
      `buildMap: degenerate map — player spawn and exit on same tile (${exitTile.x},${exitTile.y})`
    );
  }

  // Drones — two passes:
  //   1) Use authored drone anchors from non-spawn leaves first; each anchor
  //      carries the nearest authored patrol path for its prefab.
  //   2) If the threat budget isn't met (some prefabs declare no drone
  //      anchors — `hallway` is intentionally one), fall back to picking
  //      FLOOR tiles inside non-spawn leaves and synthesise a two-point
  //      cardinal patrol. Better than refusing to spawn the run, and more
  //      alive than the old stand-still fallback.
  const droneAnchors: EntityAnchor[] = [];
  const corpCivilians: CivilianAnchor[] = [];
  const neutralCivilians: CivilianAnchor[] = [];
  const isAlreadyTaken = (x: number, y: number): boolean =>
    (x === playerSpawn.x && y === playerSpawn.y) ||
    (x === exitTile.x && y === exitTile.y) ||
    droneAnchors.some(a => a.x === x && a.y === y) ||
    corpCivilians.some(a => a.x === x && a.y === y) ||
    neutralCivilians.some(a => a.x === x && a.y === y);

  for (let i = 1; i < stamped.length && droneAnchors.length < threatCount; i++) {
    for (const anchor of stamped[i].droneWorld) {
      if (droneAnchors.length >= threatCount) break;
      if (isAlreadyTaken(anchor.x, anchor.y)) continue;
      if (grid.tileAt(anchor.x, anchor.y) !== TILE.FLOOR) continue;
      droneAnchors.push({
        x: anchor.x,
        y: anchor.y,
        waypoints:
          anchor.waypoints.length > 0
            ? anchor.waypoints
            : synthesizeFallbackPatrol(grid, { x: anchor.x, y: anchor.y }),
      });
    }
  }
  for (let i = 1; i < stamped.length && droneAnchors.length < threatCount; i++) {
    const region = stamped[i].leaf.region;
    for (let yy = region.y; yy < region.y + region.height; yy++) {
      if (droneAnchors.length >= threatCount) break;
      for (let xx = region.x; xx < region.x + region.width; xx++) {
        if (droneAnchors.length >= threatCount) break;
        if (grid.tileAt(xx, yy) !== TILE.FLOOR) continue;
        if (isAlreadyTaken(xx, yy)) continue;
        droneAnchors.push({
          x: xx,
          y: yy,
          waypoints: synthesizeFallbackPatrol(grid, { x: xx, y: yy }),
        });
      }
    }
  }
  if (droneAnchors.length < threatCount) {
    throw new Error(
      `buildMap: only ${droneAnchors.length}/${threatCount} drone anchors available for a ${width}x${height} map`
    );
  }

  // Civilians — collect authored spawn points from non-spawn leaves, capped
  // by maxCorpCivilians / maxNeutralCivilians. No fallback generation (unlike
  // drones) — civilians are optional content. Only place civilians on
  // passable, unoccupied tiles.
  for (let i = 1; i < stamped.length; i++) {
    if (
      corpCivilians.length >= resolvedMaxCorpCivilians &&
      neutralCivilians.length >= resolvedMaxNeutralCivilians
    )
      break;
    for (const a of stamped[i].corpCivilianWorld) {
      if (corpCivilians.length >= resolvedMaxCorpCivilians) break;
      if (grid.tileAt(a.x, a.y) !== TILE.FLOOR) continue;
      if (isAlreadyTaken(a.x, a.y)) continue;
      corpCivilians.push(a);
    }
    for (const a of stamped[i].neutralCivilianWorld) {
      if (neutralCivilians.length >= resolvedMaxNeutralCivilians) break;
      if (grid.tileAt(a.x, a.y) !== TILE.FLOOR) continue;
      if (isAlreadyTaken(a.x, a.y)) continue;
      neutralCivilians.push(a);
    }
  }

  return {
    grid,
    spawns: { player: playerSpawn },
    drones:
      difficulty === CONTRACT_DIFFICULTY.CRITICAL
        ? droneAnchors.map(anchor => ({
            ...anchor,
            waypoints: tightenPatrol(grid, anchor.waypoints),
          }))
        : droneAnchors,
    corpCivilians,
    neutralCivilians,
    exitTile,
  };
}

function isDifficulty(value: string): value is ContractDifficulty {
  return (Object.values(CONTRACT_DIFFICULTY) as string[]).includes(value);
}

function civilianCapsForDifficulty(difficulty: ContractDifficulty): {
  corp: number;
  neutral: number;
} {
  switch (difficulty) {
    case CONTRACT_DIFFICULTY.STANDARD:
      return { corp: 0, neutral: 0 };
    case CONTRACT_DIFFICULTY.ELEVATED:
      return { corp: DEFAULT_MAX_CORP_CIVILIANS, neutral: 0 };
    case CONTRACT_DIFFICULTY.CRITICAL:
      return { corp: DEFAULT_MAX_CORP_CIVILIANS, neutral: DEFAULT_MAX_NEUTRAL_CIVILIANS };
    default:
      return { corp: DEFAULT_MAX_CORP_CIVILIANS, neutral: DEFAULT_MAX_NEUTRAL_CIVILIANS };
  }
}

function tightenPatrol(grid: Grid, path: GridPoint[]): GridPoint[] {
  if (path.length < 2) return path.map(wp => ({ ...wp }));
  const tightened: GridPoint[] = [];
  for (let i = 0; i < path.length; i++) {
    const current = path[i]!;
    const next = path[i + 1];
    tightened.push({ ...current });
    if (!next) continue;
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 2) {
      const midpoint = {
        x: current.x + Math.sign(dx) * Math.ceil(Math.abs(dx) / 2),
        y: current.y + Math.sign(dy) * Math.ceil(Math.abs(dy) / 2),
      };
      if (
        grid.inBounds(midpoint.x, midpoint.y) &&
        grid.tileAt(midpoint.x, midpoint.y) === TILE.FLOOR
      ) {
        tightened.push(midpoint);
      }
    }
  }
  return tightened;
}

function stampPrefab(grid: Grid, rng: Rng, leaf: BspNode): StampedLeaf {
  const candidates = fittingPrefabs(leaf.region.width, leaf.region.height);
  if (candidates.length === 0) {
    throw new Error(
      `buildMap: no prefab fits leaf ${leaf.region.width}x${leaf.region.height} at (${leaf.region.x},${leaf.region.y})`
    );
  }
  const prefab = rng.pick(candidates);

  // Centre the prefab inside the leaf, with a small random jitter when there's
  // slack on either axis. Centring keeps the corridor exits more uniform; the
  // jitter prevents every map from looking identical at the same scale.
  const slackX = leaf.region.width - prefab.w;
  const slackY = leaf.region.height - prefab.h;
  const offsetX = slackX > 0 ? rng.intRange(0, slackX + 1) : 0;
  const offsetY = slackY > 0 ? rng.intRange(0, slackY + 1) : 0;
  const originX = leaf.region.x + offsetX;
  const originY = leaf.region.y + offsetY;

  for (let y = 0; y < prefab.h; y++) {
    for (let x = 0; x < prefab.w; x++) {
      grid.setTile(originX + x, originY + y, prefab.tiles[y * prefab.w + x]);
    }
  }

  const center = {
    x: originX + Math.floor(prefab.w / 2),
    y: originY + Math.floor(prefab.h / 2),
  };

  const patrolPathsWorld = prefab.patrolPaths.map(path =>
    path.map(wp => ({
      x: originX + wp.x,
      y: originY + wp.y,
    }))
  );
  const droneWorld = prefab.anchors.drones.map(a => {
    const spawn = { x: originX + a.x, y: originY + a.y };
    const assignedPath = assignNearestPatrolPath(spawn, patrolPathsWorld);
    return {
      ...spawn,
      waypoints:
        assignedPath ??
        (a.waypoints ?? []).map(wp => ({
          x: originX + wp.x,
          y: originY + wp.y,
        })),
    };
  });
  const exitWorld = prefab.anchors.exit.map(e => ({
    x: originX + e.x,
    y: originY + e.y,
  }));
  const corpCivilianWorld = (prefab.anchors.corpCivilians ?? []).map(a => ({
    x: originX + a.x,
    y: originY + a.y,
  }));
  const neutralCivilianWorld = (prefab.anchors.neutralCivilians ?? []).map(a => ({
    x: originX + a.x,
    y: originY + a.y,
  }));

  return {
    leaf,
    prefab,
    originX,
    originY,
    center,
    droneWorld,
    patrolPathsWorld,
    exitWorld,
    corpCivilianWorld,
    neutralCivilianWorld,
  };
}

function assignNearestPatrolPath(spawn: GridPoint, paths: GridPoint[][]): GridPoint[] | null {
  let bestPath: GridPoint[] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const path of paths) {
    const first = path[0];
    if (!first) continue;
    const dx = first.x - spawn.x;
    const dy = first.y - spawn.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < bestDistance) {
      bestDistance = distanceSquared;
      bestPath = path.map(wp => ({ x: wp.x, y: wp.y }));
    }
  }
  return bestPath;
}

function synthesizeFallbackPatrol(grid: Grid, spawn: GridPoint): GridPoint[] {
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const start = { x: spawn.x, y: spawn.y };

  for (let distance = 1; distance < Math.max(grid.width, grid.height); distance++) {
    for (const dir of directions) {
      const candidate = {
        x: spawn.x + dir.x * distance,
        y: spawn.y + dir.y * distance,
      };
      if (!grid.inBounds(candidate.x, candidate.y)) continue;
      if (grid.tileAt(candidate.x, candidate.y) === TILE.FLOOR) {
        return [start, candidate];
      }
    }
  }

  return [start, start];
}

/**
 * Find the first stamped leaf whose BSP node lives in the subtree rooted at
 * `node`. Used by corridor carving to pick a representative center per
 * subtree. Throws if the subtree has no stamped leaves — that would mean the
 * tree shape and the stamp pass disagreed, which is a bug we want loud.
 */
function representativeCenter(stamped: StampedLeaf[], node: BspNode): GridPoint {
  if (!node) throw new Error('representativeCenter: null subtree');
  const subtreeLeaves = new Set(leaves(node));
  for (const s of stamped) {
    if (subtreeLeaves.has(s.leaf)) return s.center;
  }
  throw new Error('representativeCenter: no stamped leaf found in subtree');
}

/**
 * Carve an L-shaped corridor (horizontal-then-vertical) of FLOOR tiles
 * between two world-space points. Only WALL tiles are overwritten — cover
 * that's already on the path stays cover, and floor tiles are no-ops.
 */
function carveCorridor(grid: Grid, a: GridPoint, b: GridPoint): void {
  const stepX = a.x === b.x ? 0 : a.x < b.x ? 1 : -1;
  let x = a.x;
  while (x !== b.x) {
    if (grid.tileAt(x, a.y) === TILE.WALL) grid.setTile(x, a.y, TILE.FLOOR);
    x += stepX;
  }
  const stepY = a.y === b.y ? 0 : a.y < b.y ? 1 : -1;
  let y = a.y;
  while (y !== b.y) {
    if (grid.tileAt(b.x, y) === TILE.WALL) grid.setTile(b.x, y, TILE.FLOOR);
    y += stepY;
  }
  // Endpoints in case the loops skipped them.
  if (grid.tileAt(b.x, b.y) === TILE.WALL) grid.setTile(b.x, b.y, TILE.FLOOR);
  if (grid.tileAt(a.x, a.y) === TILE.WALL) grid.setTile(a.x, a.y, TILE.FLOOR);
}
