/**
 * Procedural map builder. Pure over an `Rng` — same seed + dimensions +
 * threat count produces an identical grid, fodder roster, and exit tile.
 *
 * Pipeline:
 *   1. Fork the caller's rng with label `'mapgen'` so future procgen tweaks
 *      don't perturb combat rolls. (See `Rng.fork` for the substream design.)
 *   2. Allocate a WALL-filled grid the size of the map.
 *   3. BSP-split the map until every leaf is between MIN_LEAF and MAX_LEAF.
 *   4. Plan a prefab per leaf (random offset inside the leaf) and translate
 *      anchors into world coordinates.
 *   5. Carve L-shaped corridors between subtree leaf-region centres.
 *      Corridors only overwrite WALL.
 *   6. Paint prefabs over the carved grid so authored divider walls (e.g.
 *      checkpoint `|`) are not punched through by corridor geometry.
 *   6b. Connect each prefab to the corridor floors carved in its leaf (step 5)
 *       when random prefab offset leaves a wall band between room and spine.
 *       Door-gated contracts still retry on a forked substream when the linked-
 *       contract probe fails.
 *   7. Place the player spawn at the first leaf's prefab center; the exit
 *      tile at the last leaf's first declared exit anchor (or its center).
 *   8. Pick `threatCount` fodder anchors from leaves *other than* the spawn
 *      leaf — first-come-first-served in DFS order. If we can't satisfy the
 *      threat budget, throw — silently dropping a spawn slot is data corruption
 *      that would mask a content bug.
 *   9. Reserve specialist/elite anchors from remaining FLOOR tiles by
 *      difficulty so role composition can fail loud before spawning.
 *
 * The exit cell is stamped as `TILE.EXIT` (passable like FLOOR) so the
 * renderer shows a door glyph. `exitTile` remains the sidecar coordinate
 * for `Run` reach-exit detection.
 */

import { Grid } from '../Grid.js';
import { CONTRACT_DIFFICULTY, FACTION, TILE } from '../constants.js';
import { BSP_TUNABLES, splitRegion, leaves, internalNodes } from './bsp.js';
import { fittingPrefabs } from './prefabs/index.js';
import { Entity } from '../Entity.js';
import { World } from '../World.js';
import { Door } from '../entities/Door.js';
import { Terminal } from '../entities/Terminal.js';
import { findPath } from '../Pathfinding.js';
import {
  anchorPreservesExplorationReachability,
  coordKey,
  explorationReachableKeys,
  hasAdjacentPassableTile,
} from '../mapConnectivity.js';
import type { Rng } from '../../rng.js';
import type { GridPoint } from '../../types.js';
import type { BspNode } from './bsp.js';
import type { ParsedPrefab } from './prefabs/types.js';
import type { ContractDifficulty } from '../constants.js';

const DEFAULT_THREAT_COUNT = 2;
const DEFAULT_MAX_CORP_CIVILIANS = 1;
const DEFAULT_MAX_NEUTRAL_CIVILIANS = 1;
const MAX_DOOR_LAYOUT_ATTEMPTS = 48;
const DYNAMIC_DOOR_BUFFER = 3;
const DYNAMIC_TERMINAL_MAX_STEPS = 2;

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
export type DynamicDoorAnchor = {
  door: GridPoint;
  terminal: GridPoint;
};
export type Map = {
  grid: Grid;
  spawns: { player: GridPoint };
  fodder: EntityAnchor[];
  /**
   * T2+ specialist spawn slots (Phase 2.7 M3). Sized by difficulty: STANDARD
   * gets none, ELEVATED/CRITICAL each get one (the single rolled specialist).
   * Run maps the composed specialist entry onto these anchors.
   */
  specialists: EntityAnchor[];
  /**
   * T3 elite spawn slots (Phase 2.7 M4). Sized by difficulty: CRITICAL gets
   * one reserved slot even while `Run` keeps the buildable elite allowlist
   * empty. This lets map legality fail loud before elite classes land.
   */
  elites: EntityAnchor[];
  corpCivilians: CivilianAnchor[];
  neutralCivilians: CivilianAnchor[];
  /** Prefab/authored door anchors only. Dynamic doors are in `dynamicDoors`. */
  doors: GridPoint[];
  dynamicDoors: DynamicDoorAnchor[];
  dynamicDoorCount: number;
  exitTile: GridPoint;
};

type StampedLeaf = {
  leaf: BspNode;
  prefab: ParsedPrefab;
  originX: number;
  originY: number;
  center: GridPoint;
  fodderWorld: EntityAnchor[];
  patrolPathsWorld: GridPoint[][];
  exitWorld: GridPoint[];
  doorWorld: GridPoint[];
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
  includePrefabDoors?: boolean;
  /** Internal: rotates which non-spawn leaf receives the door prefab on retry. */
  doorLayoutAttempt?: number;
};

/**
 * @param {{ rng: import('../../rng.js').Rng, width: number, height: number,
 *           threatCount?: number }} options
 * @returns {{ grid: Grid, spawns: { player: {x:number,y:number} },
 *             fodder: Array<{x:number,y:number,waypoints:{x:number,y:number}[]}>,
 *             exitTile: { x: number, y: number } }}
 */
export function buildMap(options: BuildMapOptions): Map {
  validateBuildMapOptions(options);
  if (!options.includePrefabDoors) {
    return buildMapOnce(options.rng.fork('mapgen'), options);
  }
  for (let attempt = 0; attempt < MAX_DOOR_LAYOUT_ATTEMPTS; attempt++) {
    const mapRng = options.rng.fork(attempt === 0 ? 'mapgen' : `door-layout-${attempt}`);
    try {
      const map = buildMapOnce(mapRng, { ...options, doorLayoutAttempt: attempt });
      if (map.doors.length > 0 && doorLayoutSupportsLinkedContracts(map)) {
        return map;
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes('includePrefabDoors could not stamp')
      ) {
        throw error;
      }
    }
  }
  throw new Error(
    `buildMap: no door-gated layout after ${MAX_DOOR_LAYOUT_ATTEMPTS} attempts ` +
      `(includePrefabDoors)`
  );
}

/** True when spawn can path to exit and every passable tile on the grid. */
export function mapIsFullyConnectedFromSpawn(map: Map): boolean {
  const world = new World(map.grid);
  const spawn = map.spawns.player;
  if (findPath(world, spawn, map.exitTile) === null) return false;
  for (let y = 0; y < map.grid.height; y++) {
    for (let x = 0; x < map.grid.width; x++) {
      const tile = map.grid.tileAt(x, y);
      if (tile !== TILE.FLOOR && tile !== TILE.EXIT) continue;
      if (x === spawn.x && y === spawn.y) continue;
      if (findPath(world, spawn, { x, y }) === null) return false;
    }
  }
  return true;
}

function validateBuildMapOptions({
  rng,
  width,
  height,
  threatCount = DEFAULT_THREAT_COUNT,
  difficulty = CONTRACT_DIFFICULTY.ELEVATED,
  maxCorpCivilians,
  maxNeutralCivilians,
}: BuildMapOptions): void {
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
}

function buildMapOnce(mapRng: Rng, options: BuildMapOptions): Map {
  const {
    width,
    height,
    threatCount = DEFAULT_THREAT_COUNT,
    difficulty = CONTRACT_DIFFICULTY.ELEVATED,
    maxCorpCivilians,
    maxNeutralCivilians,
    includePrefabDoors = false,
    doorLayoutAttempt = 0,
  } = options;
  const civilianCaps = civilianCapsForDifficulty(difficulty);
  const resolvedMaxCorpCivilians = maxCorpCivilians ?? civilianCaps.corp;
  const resolvedMaxNeutralCivilians = maxNeutralCivilians ?? civilianCaps.neutral;
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

  // Plan prefab placement first (RNG only), then carve corridors, then paint
  // prefabs. Carving after stamping was punching L-corridors through thin
  // divider walls (e.g. checkpoint's `|` column) and leaving orphan `#` tiles.
  const leafList = leaves(root);
  const stamped: StampedLeaf[] = [];
  let doorStampIndex: number | null = null;
  const doorLeafPreference =
    leafList.length > 1 ? 1 + (doorLayoutAttempt % (leafList.length - 1)) : -1;
  for (let i = 0; i < leafList.length; i++) {
    const preferDoors =
      includePrefabDoors &&
      doorStampIndex === null &&
      doorLeafPreference > 0 &&
      i === doorLeafPreference;
    const stamp = planPrefabStamp(mapRng, leafList[i]!, {
      preferDoors,
      excludeDoorPrefabs: i === 0,
    });
    stamped.push(stamp);
    if (preferDoors && stamp.doorWorld.length > 0) {
      doorStampIndex = stamped.length - 1;
    }
  }
  if (includePrefabDoors && doorStampIndex === null) {
    throw new Error(
      'buildMap: includePrefabDoors could not stamp a door prefab in a non-spawn leaf'
    );
  }

  // Connect every internal split using each subtree's first leaf centre
  // (BSP region midpoint — stable before any prefab is painted).
  for (const node of internalNodes(root)) {
    const a = representativeLeafCenter(node.left!);
    const b = representativeLeafCenter(node.right!);
    carveCorridor(grid, a, b);
  }

  const corridorFloorsByLeaf = stamped.map(stamp =>
    collectLeafCorridorFloors(grid, stamp.leaf.region)
  );

  for (const stamp of stamped) {
    writePrefabToGrid(grid, stamp);
  }

  for (let i = 0; i < stamped.length; i++) {
    connectPrefabToLeafCorridors(grid, stamped[i]!, corridorFloorsByLeaf[i]!);
  }

  if (stamped.length === 0) {
    throw new Error('buildMap: BSP produced zero leaves');
  }

  const doorAnchors =
    includePrefabDoors && doorStampIndex !== null
      ? stamped[doorStampIndex]!.doorWorld.map(door => ({ ...door }))
      : [];

  // Player spawn: first leaf's prefab center. Force FLOOR there in case the
  // prefab put COVER on its centre (none today, but defensive). Never leave
  // spawn on a door anchor — checkpoint centres coincide with `|` cells.
  const spawnLeaf = stamped[0];
  let playerSpawn = resolveSpawnAwayFromDoorAnchors(
    grid,
    { ...spawnLeaf.center },
    spawnLeaf.leaf.region,
    doorAnchors
  );
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

  const dynamicDoorWorld = new World(grid);
  for (let i = 0; i < doorAnchors.length; i++) {
    const door = doorAnchors[i]!;
    dynamicDoorWorld.addEntity(
      new Door({
        id: `prefab-door-probe-${i}`,
        doorId: `prefab-door-${i}`,
        x: door.x,
        y: door.y,
      })
    );
  }
  const dynamicDoors = placeDoors(dynamicDoorWorld, difficulty, mapRng, {
    spawn: playerSpawn,
    exitTile,
  });

  // Fodder — two passes:
  //   1) Use authored fodder anchors from non-spawn leaves first; each anchor
  //      carries the nearest authored patrol path for its prefab.
  //   2) If the threat budget isn't met (some prefabs declare no fodder
  //      anchors — `hallway` is intentionally one), fall back to picking
  //      FLOOR tiles inside non-spawn leaves and synthesise a two-point
  //      cardinal patrol. Better than refusing to spawn the run, and more
  //      alive than the old stand-still fallback.
  const fodderAnchors: EntityAnchor[] = [];
  const specialistAnchors: EntityAnchor[] = [];
  const eliteAnchors: EntityAnchor[] = [];
  const corpCivilians: CivilianAnchor[] = [];
  const neutralCivilians: CivilianAnchor[] = [];
  const isAlreadyTaken = (x: number, y: number): boolean =>
    (x === playerSpawn.x && y === playerSpawn.y) ||
    (x === exitTile.x && y === exitTile.y) ||
    doorAnchors.some(a => a.x === x && a.y === y) ||
    dynamicDoors.some(a => a.door.x === x && a.door.y === y) ||
    dynamicDoors.some(a => a.terminal.x === x && a.terminal.y === y) ||
    fodderAnchors.some(a => a.x === x && a.y === y) ||
    specialistAnchors.some(a => a.x === x && a.y === y) ||
    eliteAnchors.some(a => a.x === x && a.y === y) ||
    corpCivilians.some(a => a.x === x && a.y === y) ||
    neutralCivilians.some(a => a.x === x && a.y === y);

  for (let i = 1; i < stamped.length && fodderAnchors.length < threatCount; i++) {
    for (const anchor of stamped[i].fodderWorld) {
      if (fodderAnchors.length >= threatCount) break;
      if (isAlreadyTaken(anchor.x, anchor.y)) continue;
      if (grid.tileAt(anchor.x, anchor.y) !== TILE.FLOOR) continue;
      fodderAnchors.push({
        x: anchor.x,
        y: anchor.y,
        waypoints:
          anchor.waypoints.length > 0
            ? anchor.waypoints
            : synthesizeFallbackPatrol(grid, { x: anchor.x, y: anchor.y }),
      });
    }
  }
  for (let i = 1; i < stamped.length && fodderAnchors.length < threatCount; i++) {
    const region = stamped[i].leaf.region;
    for (let yy = region.y; yy < region.y + region.height; yy++) {
      if (fodderAnchors.length >= threatCount) break;
      for (let xx = region.x; xx < region.x + region.width; xx++) {
        if (fodderAnchors.length >= threatCount) break;
        if (grid.tileAt(xx, yy) !== TILE.FLOOR) continue;
        if (isAlreadyTaken(xx, yy)) continue;
        fodderAnchors.push({
          x: xx,
          y: yy,
          waypoints: synthesizeFallbackPatrol(grid, { x: xx, y: yy }),
        });
      }
    }
  }
  if (fodderAnchors.length < threatCount) {
    throw new Error(
      `buildMap: only ${fodderAnchors.length}/${threatCount} fodder anchors available for a ${width}x${height} map`
    );
  }

  // Specialist anchors (Phase 2.7 M3) — one per rolled specialist on
  // ELEVATED/CRITICAL. Picked from FLOOR tiles in non-spawn leaves *after*
  // fodder so they never collide; each gets a synthesised patrol so a lookout
  // sweeps for vantage rather than standing still. Fail loud if the map can't
  // budget them (M1.5 anchor budget) — that footprint is illegal for the tier.
  const specialistCount = specialistAnchorCount(difficulty);
  for (let i = 1; i < stamped.length && specialistAnchors.length < specialistCount; i++) {
    const region = stamped[i].leaf.region;
    for (let yy = region.y; yy < region.y + region.height; yy++) {
      if (specialistAnchors.length >= specialistCount) break;
      for (let xx = region.x; xx < region.x + region.width; xx++) {
        if (specialistAnchors.length >= specialistCount) break;
        if (grid.tileAt(xx, yy) !== TILE.FLOOR) continue;
        if (isAlreadyTaken(xx, yy)) continue;
        specialistAnchors.push({
          x: xx,
          y: yy,
          waypoints: synthesizeFallbackPatrol(grid, { x: xx, y: yy }),
        });
      }
    }
  }
  if (specialistAnchors.length < specialistCount) {
    throw new Error(
      `buildMap: only ${specialistAnchors.length}/${specialistCount} specialist anchors ` +
        `available for a ${width}x${height} ${difficulty} map`
    );
  }

  // Elite anchors (Phase 2.7 M4 foundation) — CRITICAL maps reserve exactly
  // one elite slot after fodder/specialists. Classes spawn later via
  // Run.enterCombat's buildable elite allowlist, but map legality is already
  // enforced here so M4 cannot silently degrade a T3 composition.
  const eliteCount = eliteAnchorCount(difficulty);
  for (let i = 1; i < stamped.length && eliteAnchors.length < eliteCount; i++) {
    const region = stamped[i].leaf.region;
    for (let yy = region.y; yy < region.y + region.height; yy++) {
      if (eliteAnchors.length >= eliteCount) break;
      for (let xx = region.x; xx < region.x + region.width; xx++) {
        if (eliteAnchors.length >= eliteCount) break;
        if (grid.tileAt(xx, yy) !== TILE.FLOOR) continue;
        if (isAlreadyTaken(xx, yy)) continue;
        eliteAnchors.push({
          x: xx,
          y: yy,
          waypoints: synthesizeFallbackPatrol(grid, { x: xx, y: yy }),
        });
      }
    }
  }
  if (eliteAnchors.length < eliteCount) {
    throw new Error(
      `buildMap: only ${eliteAnchors.length}/${eliteCount} elite anchors ` +
        `available for a ${width}x${height} ${difficulty} map`
    );
  }

  // Civilians — collect authored spawn points from non-spawn leaves, capped
  // by maxCorpCivilians / maxNeutralCivilians. No fallback generation (unlike
  // fodder) — civilians are optional content. Only place civilians on
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

  const map: Map = {
    grid,
    spawns: { player: playerSpawn },
    fodder:
      difficulty === CONTRACT_DIFFICULTY.CRITICAL
        ? fodderAnchors.map(anchor => ({
            ...anchor,
            waypoints: tightenPatrol(grid, anchor.waypoints),
          }))
        : fodderAnchors,
    specialists:
      difficulty === CONTRACT_DIFFICULTY.CRITICAL
        ? specialistAnchors.map(anchor => ({
            ...anchor,
            waypoints: tightenPatrol(grid, anchor.waypoints),
          }))
        : specialistAnchors,
    elites:
      difficulty === CONTRACT_DIFFICULTY.CRITICAL
        ? eliteAnchors.map(anchor => ({
            ...anchor,
            waypoints: tightenPatrol(grid, anchor.waypoints),
          }))
        : eliteAnchors,
    corpCivilians,
    neutralCivilians,
    doors: doorAnchors.filter(
      door =>
        grid.tileAt(door.x, door.y) === TILE.FLOOR &&
        !(door.x === playerSpawn.x && door.y === playerSpawn.y) &&
        !(door.x === exitTile.x && door.y === exitTile.y)
    ),
    dynamicDoors,
    dynamicDoorCount: dynamicDoors.length,
    exitTile,
  };
  if (!mapIsFullyConnectedFromSpawn(map)) {
    throw new Error(
      'buildMap: prefab-corridor connectors failed to join layout ' +
        `(spawn ${playerSpawn.x},${playerSpawn.y} exit ${exitTile.x},${exitTile.y})`
    );
  }
  return map;
}

export type PlaceDoorsOptions = {
  spawn: GridPoint;
  exitTile: GridPoint;
  objectiveAnchors?: readonly GridPoint[];
  reserved?: ReadonlySet<string>;
};

export function placeDoors(
  world: World,
  difficulty: ContractDifficulty,
  rng: Rng,
  options: PlaceDoorsOptions
): DynamicDoorAnchor[] {
  if (difficulty === CONTRACT_DIFFICULTY.STANDARD) return [];
  const targetCount = difficulty === CONTRACT_DIFFICULTY.CRITICAL ? rng.intRange(1, 3) : 1;
  const placed: DynamicDoorAnchor[] = [];
  const candidates = shuffleDoorCandidates(
    findCorridorDoorCandidates(world, options.spawn, options.exitTile, options.reserved),
    rng
  );

  for (const candidate of candidates) {
    if (placed.length >= targetCount) break;
    const doorId = `dynamic-door-${placed.length}`;
    const door = new Door({
      id: `dynamic-door-entity-${placed.length}`,
      doorId,
      x: candidate.x,
      y: candidate.y,
    });
    try {
      world.addEntity(door);
    } catch {
      continue;
    }

    const terminalAnchors = findDynamicTerminalAnchors(
      world,
      options.spawn,
      options.exitTile,
      door,
      {
        objectiveAnchors: options.objectiveAnchors,
        reserved: options.reserved,
      }
    );
    const terminalAnchor =
      terminalAnchors.find(anchor =>
        dynamicDoorPreservesConnectivity(world, options, door, anchor)
      ) ?? null;
    if (!terminalAnchor) {
      world.removeEntity(door.id);
      continue;
    }

    const terminal = new Terminal({
      id: `dynamic-door-terminal-${placed.length}`,
      x: terminalAnchor.x,
      y: terminalAnchor.y,
      label: 'Access terminal',
      raisesAlarm: true,
      unlocksId: door.doorId,
    });
    try {
      world.addEntity(terminal);
    } catch {
      world.removeEntity(door.id);
      continue;
    }
    placed.push({
      door: { x: door.x, y: door.y },
      terminal: { x: terminal.x, y: terminal.y },
    });
  }

  return placed;
}

function doorLayoutSupportsLinkedContracts(map: Map): boolean {
  const doorAnchor = map.doors[0];
  if (!doorAnchor) return false;

  const world = new World(map.grid);
  const player = new Entity({
    id: 'door-layout-probe',
    x: map.spawns.player.x,
    y: map.spawns.player.y,
    faction: FACTION.PLAYER,
    glyph: '@',
    maxAp: 1,
    maxHp: 1,
  });
  world.addEntity(player);
  const door = new Door({
    id: 'door-layout-probe-entity',
    doorId: 'door-0',
    x: doorAnchor.x,
    y: doorAnchor.y,
  });
  world.addEntity(door);

  const exitBlockedWhileLocked =
    findPath(world, player, map.exitTile, { allowOccupiedGoal: false }) === null;
  door.unlock();
  const exitOpenWhenUnlocked =
    findPath(world, player, map.exitTile, { allowOccupiedGoal: false }) !== null;
  door.lock();
  if (!exitBlockedWhileLocked || !exitOpenWhenUnlocked) return false;

  let unlockCandidates = 0;
  let behindCandidates = 0;
  for (let y = 1; y < world.grid.height - 1; y++) {
    for (let x = 1; x < world.grid.width - 1; x++) {
      if (!world.grid.isPassable(x, y)) continue;
      if (x === player.x && y === player.y) continue;
      if (x === map.exitTile.x && y === map.exitTile.y) continue;
      if (!hasAdjacentPassableTile(world, x, y)) continue;

      const reachableNow = findPath(world, player, { x, y }, { allowOccupiedGoal: false }) !== null;
      if (reachableNow) {
        if (preservesExplorationWithDoorState(world, player, { x, y }, door, false)) {
          unlockCandidates++;
        }
        continue;
      }
      door.unlock();
      const reachableWhenUnlocked =
        findPath(world, player, { x, y }, { allowOccupiedGoal: false }) !== null;
      door.lock();
      if (
        reachableWhenUnlocked &&
        preservesExplorationWithDoorState(world, player, { x, y }, door, true)
      ) {
        behindCandidates++;
      }
    }
  }
  return unlockCandidates > 0 && behindCandidates > 0;
}

function preservesExplorationWithDoorState(
  world: World,
  player: Entity,
  anchor: GridPoint,
  door: Door,
  doorUnlocked: boolean
): boolean {
  const wasLocked = door.locked;
  try {
    if (doorUnlocked) door.unlock();
    else door.lock();
    return anchorPreservesExplorationReachability(world, { x: player.x, y: player.y }, anchor);
  } finally {
    if (wasLocked) door.lock();
    else door.unlock();
  }
}

function findCorridorDoorCandidates(
  world: World,
  spawn: GridPoint,
  exitTile: GridPoint,
  reserved: ReadonlySet<string> | undefined
): GridPoint[] {
  const candidates: GridPoint[] = [];
  for (let y = 1; y < world.grid.height - 1; y++) {
    for (let x = 1; x < world.grid.width - 1; x++) {
      if (world.grid.tileAt(x, y) !== TILE.FLOOR) continue;
      if (world.liveEntityAt(x, y)) continue;
      if (reserved?.has(coordKey(x, y))) continue;
      if (manhattan({ x, y }, spawn) < DYNAMIC_DOOR_BUFFER) continue;
      if (manhattan({ x, y }, exitTile) < DYNAMIC_DOOR_BUFFER) continue;
      const north = isFloorNeighbour(world, x, y - 1);
      const south = isFloorNeighbour(world, x, y + 1);
      const west = isFloorNeighbour(world, x - 1, y);
      const east = isFloorNeighbour(world, x + 1, y);
      const vertical = north && south && !west && !east;
      const horizontal = west && east && !north && !south;
      if (vertical || horizontal) candidates.push({ x, y });
    }
  }
  return candidates;
}

function findDynamicTerminalAnchors(
  world: World,
  spawn: GridPoint,
  exitTile: GridPoint,
  door: Door,
  options: Pick<PlaceDoorsOptions, 'objectiveAnchors' | 'reserved'>
): GridPoint[] {
  const anchors: GridPoint[] = [];
  const queue: Array<GridPoint & { distance: number }> = [{ x: door.x, y: door.y, distance: 0 }];
  const seen = new Set([coordKey(door.x, door.y)]);
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i]!;
    if (point.distance >= DYNAMIC_TERMINAL_MAX_STEPS) continue;
    for (const [dx, dy] of CARDINAL_OFFSETS) {
      const x = point.x + dx;
      const y = point.y + dy;
      const key = coordKey(x, y);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!world.grid.inBounds(x, y)) continue;
      if (world.grid.tileAt(x, y) !== TILE.FLOOR) continue;
      if (options.reserved?.has(key)) continue;
      if (x === spawn.x && y === spawn.y) continue;
      if (x === exitTile.x && y === exitTile.y) continue;
      if (world.liveEntityAt(x, y)) continue;
      const anchor = { x, y };
      if (findPath(world, spawn, anchor, { allowOccupiedGoal: false }) === null) {
        queue.push({ x, y, distance: point.distance + 1 });
        continue;
      }
      if (!anchorPreservesExplorationReachability(world, spawn, anchor)) {
        queue.push({ x, y, distance: point.distance + 1 });
        continue;
      }
      anchors.push(anchor);
      queue.push({ x, y, distance: point.distance + 1 });
    }
  }
  return anchors;
}

function dynamicDoorPreservesConnectivity(
  world: World,
  options: PlaceDoorsOptions,
  door: Door,
  terminalAnchor: GridPoint
): boolean {
  const terminalBlocker = coordKey(terminalAnchor.x, terminalAnchor.y);
  const targets = [options.exitTile, ...(options.objectiveAnchors ?? [])];
  const wasLocked = door.locked;
  try {
    door.unlock();
    for (const target of targets) {
      const baselineReachable =
        findPath(world, options.spawn, target, {
          allowOccupiedGoal: false,
          extraBlockers: new Set([terminalBlocker]),
        }) !== null;
      if (!baselineReachable) continue;
      door.lock();
      const reachableWithDoorLocked =
        findPath(world, options.spawn, target, {
          allowOccupiedGoal: false,
          extraBlockers: new Set([terminalBlocker]),
        }) !== null;
      door.unlock();
      if (!reachableWithDoorLocked) return false;
    }
    door.lock();
    return dynamicDoorGatesReachableArea(world, options, door, terminalAnchor);
  } finally {
    if (wasLocked) door.lock();
    else door.unlock();
  }
}

function dynamicDoorGatesReachableArea(
  world: World,
  options: PlaceDoorsOptions,
  door: Door,
  terminalAnchor: GridPoint
): boolean {
  const terminalKey = coordKey(terminalAnchor.x, terminalAnchor.y);
  const lockedReachable = explorationReachableKeys(world, options.spawn);
  const wasLocked = door.locked;
  try {
    door.unlock();
    const openReachable = explorationReachableKeys(world, options.spawn);
    for (const key of openReachable) {
      if (lockedReachable.has(key)) continue;
      if (key === coordKey(door.x, door.y)) continue;
      if (key === terminalKey) continue;
      if (options.reserved?.has(key)) continue;
      return true;
    }
    return false;
  } finally {
    if (wasLocked) door.lock();
    else door.unlock();
  }
}

const CARDINAL_OFFSETS = Object.freeze([
  Object.freeze([-1, 0]),
  Object.freeze([1, 0]),
  Object.freeze([0, -1]),
  Object.freeze([0, 1]),
] as const);

function isFloorNeighbour(world: World, x: number, y: number): boolean {
  return world.grid.inBounds(x, y) && world.grid.tileAt(x, y) === TILE.FLOOR;
}

function shuffleDoorCandidates(candidates: GridPoint[], rng: Rng): GridPoint[] {
  const out = candidates.map(candidate => ({ ...candidate }));
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.intRange(0, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function manhattan(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function resolveSpawnAwayFromDoorAnchors(
  grid: Grid,
  preferred: GridPoint,
  region: { x: number; y: number; width: number; height: number },
  doorAnchors: GridPoint[]
): GridPoint {
  const onDoor = (x: number, y: number) => doorAnchors.some(door => door.x === x && door.y === y);
  const inRegion = (x: number, y: number) =>
    x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;
  const isSpawnCandidate = (x: number, y: number) =>
    inRegion(x, y) && grid.inBounds(x, y) && grid.tileAt(x, y) === TILE.FLOOR && !onDoor(x, y);

  if (isSpawnCandidate(preferred.x, preferred.y)) {
    return preferred;
  }

  const queue: GridPoint[] = [preferred];
  const seen = new Set([`${preferred.x},${preferred.y}`]);
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i]!;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const x = point.x + dx;
      const y = point.y + dy;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!inRegion(x, y)) continue;
      if (isSpawnCandidate(x, y)) return { x, y };
      if (grid.inBounds(x, y) && grid.tileAt(x, y) === TILE.FLOOR) {
        queue.push({ x, y });
      }
    }
  }

  throw new Error(
    `buildMap: no spawn tile away from door anchors near (${preferred.x},${preferred.y})`
  );
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

/**
 * How many specialist spawn slots a tier needs (Phase 2.7 M3). Mirrors the
 * encounter composition rules: ELEVATED and CRITICAL each carry exactly one
 * specialist; STANDARD carries none.
 */
function specialistAnchorCount(difficulty: ContractDifficulty): number {
  switch (difficulty) {
    case CONTRACT_DIFFICULTY.ELEVATED:
    case CONTRACT_DIFFICULTY.CRITICAL:
      return 1;
    default:
      return 0;
  }
}

/**
 * How many elite spawn slots a tier needs (Phase 2.7 M4). CRITICAL carries
 * exactly one elite; lower tiers carry none.
 */
function eliteAnchorCount(difficulty: ContractDifficulty): number {
  switch (difficulty) {
    case CONTRACT_DIFFICULTY.CRITICAL:
      return 1;
    default:
      return 0;
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

function planPrefabStamp(
  rng: Rng,
  leaf: BspNode,
  options: { preferDoors?: boolean; excludeDoorPrefabs?: boolean } = {}
): StampedLeaf {
  const candidates = fittingPrefabs(leaf.region.width, leaf.region.height);
  if (candidates.length === 0) {
    throw new Error(
      `buildMap: no prefab fits leaf ${leaf.region.width}x${leaf.region.height} at (${leaf.region.x},${leaf.region.y})`
    );
  }
  const eligible = options.excludeDoorPrefabs
    ? candidates.filter(prefab => (prefab.anchors.doors?.length ?? 0) === 0)
    : candidates;
  if (eligible.length === 0) {
    throw new Error(
      `buildMap: no non-door prefab fits leaf ${leaf.region.width}x${leaf.region.height} at (${leaf.region.x},${leaf.region.y})`
    );
  }
  const doorCandidates = eligible.filter(prefab => (prefab.anchors.doors?.length ?? 0) > 0);
  const prefab =
    options.preferDoors && doorCandidates.length > 0
      ? rng.pick(doorCandidates)
      : rng.pick(eligible);

  // Centre the prefab inside the leaf, with a small random jitter when there's
  // slack on either axis. Centring keeps the corridor exits more uniform; the
  // jitter prevents every map from looking identical at the same scale.
  const slackX = leaf.region.width - prefab.w;
  const slackY = leaf.region.height - prefab.h;
  const offsetX = slackX > 0 ? rng.intRange(0, slackX + 1) : 0;
  const offsetY = slackY > 0 ? rng.intRange(0, slackY + 1) : 0;
  const originX = leaf.region.x + offsetX;
  const originY = leaf.region.y + offsetY;

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
  const fodderWorld = prefab.anchors.fodder.map(a => {
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
  const doorWorld = (prefab.anchors.doors ?? []).map(e => ({
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
    fodderWorld,
    patrolPathsWorld,
    exitWorld,
    doorWorld,
    corpCivilianWorld,
    neutralCivilianWorld,
  };
}

function writePrefabToGrid(grid: Grid, stamp: StampedLeaf): void {
  const { prefab, originX, originY } = stamp;
  for (let y = 0; y < prefab.h; y++) {
    for (let x = 0; x < prefab.w; x++) {
      grid.setTile(originX + x, originY + y, prefab.tiles[y * prefab.w + x]);
    }
  }
}

/** FLOOR tiles carved in step 5 inside `region`, before prefab paint. */
function collectLeafCorridorFloors(
  grid: Grid,
  region: { x: number; y: number; width: number; height: number }
): GridPoint[] {
  const floors: GridPoint[] = [];
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      if (grid.tileAt(x, y) === TILE.FLOOR) floors.push({ x, y });
    }
  }
  return floors;
}

function isPrefabPassableTile(grid: Grid, x: number, y: number): boolean {
  if (!grid.inBounds(x, y)) return false;
  const tile = grid.tileAt(x, y);
  return tile === TILE.FLOOR || tile === TILE.EXIT || tile === TILE.COVER;
}

function prefabPassableTiles(grid: Grid, stamp: StampedLeaf): GridPoint[] {
  const tiles: GridPoint[] = [];
  for (let y = 0; y < stamp.prefab.h; y++) {
    for (let x = 0; x < stamp.prefab.w; x++) {
      const wx = stamp.originX + x;
      const wy = stamp.originY + y;
      if (isPrefabPassableTile(grid, wx, wy)) tiles.push({ x: wx, y: wy });
    }
  }
  return tiles;
}

function prefabReachableCorridorFloors(
  grid: Grid,
  stamp: StampedLeaf,
  corridorFloors: GridPoint[]
): boolean {
  const passable = prefabPassableTiles(grid, stamp);
  if (passable.length === 0) return corridorFloors.length === 0;
  if (corridorFloors.length === 0) return true;

  const corridorKeys = new Set(corridorFloors.map(point => coordKey(point.x, point.y)));
  const queue = passable.map(point => ({ ...point }));
  const seen = new Set(passable.map(point => coordKey(point.x, point.y)));
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i]!;
    if (corridorKeys.has(coordKey(point.x, point.y))) return true;
    for (const [dx, dy] of CARDINAL_OFFSETS) {
      const nx = point.x + dx;
      const ny = point.y + dy;
      const key = coordKey(nx, ny);
      if (seen.has(key)) continue;
      if (!isPrefabPassableTile(grid, nx, ny)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}

/**
 * When prefab offset leaves a wall band between the room and the corridor
 * spine carved at step 5, punch a 1-tile L-connector (WALL only) to the
 * nearest corridor anchor in the same leaf.
 */
function connectPrefabToLeafCorridors(
  grid: Grid,
  stamp: StampedLeaf,
  corridorFloors: GridPoint[]
): void {
  if (corridorFloors.length === 0) return;
  if (prefabReachableCorridorFloors(grid, stamp, corridorFloors)) return;

  const passable = prefabPassableTiles(grid, stamp);
  if (passable.length === 0) {
    throw new Error(
      `buildMap: leaf at (${stamp.leaf.region.x},${stamp.leaf.region.y}) has no passable prefab tiles`
    );
  }

  let bestPrefab = passable[0]!;
  let bestCorridor = corridorFloors[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const prefabTile of passable) {
    for (const corridorTile of corridorFloors) {
      const distance = manhattan(prefabTile, corridorTile);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPrefab = prefabTile;
        bestCorridor = corridorTile;
      }
    }
  }
  carveCorridor(grid, bestPrefab, bestCorridor);
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

/** Midpoint of a leaf's BSP region — corridor endpoints before prefab paint. */
function leafRegionCenter(leaf: BspNode): GridPoint {
  const r = leaf.region;
  return {
    x: Math.floor(r.x + r.width / 2),
    y: Math.floor(r.y + r.height / 2),
  };
}

/**
 * First leaf in DFS order under `node`. Throws if the subtree is empty.
 */
function representativeLeafCenter(node: BspNode): GridPoint {
  if (!node) throw new Error('representativeLeafCenter: null subtree');
  const subtreeLeaves = leaves(node);
  if (subtreeLeaves.length === 0) {
    throw new Error('representativeLeafCenter: no leaves in subtree');
  }
  return leafRegionCenter(subtreeLeaves[0]!);
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
