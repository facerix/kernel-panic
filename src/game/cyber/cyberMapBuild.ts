/**
 * P3.M3.3 — Cyberspace map generation.
 *
 * Dedicated generator (deliberately NOT the BSP/prefab `buildMap`): a lattice
 * of square *nodes* (rooms) linked by 1-tile *data lines* (corridors) through
 * solid firewall (`TILE.WALL` fill). Only FLOOR/WALL tile ids are used, so
 * Grid passability / LOS, A*, VisionField, and World all work unchanged —
 * the distinct look comes from the renderer's tileset axis (P3.M3.6), not
 * from new tile ids.
 *
 * Topology: a random spanning walk over a 4×2 slot lattice picks `nodeCount`
 * slots (scaling with contract difficulty); each slot gets a 3–5 tile square
 * node and each walk edge a carved L-corridor. The entry node hosts the
 * avatar spawn (`entryTile`) and the exit port anchor (`portTile`, adjacent).
 * Non-entry node centers are returned as `nodeTiles` (data-node anchors,
 * P3.M3.4) with `patrolRings` (Probe ICE waypoints, P3.M3.5) around them.
 *
 * Deterministic per `rng` — callers seed with the *contract* seed fork so the
 * layout is independent of the jack-in turn. Connectivity is validated from
 * `entryTile`; an unreachable node is a generator bug and throws.
 */
import { Grid } from '../Grid.js';
import { World } from '../World.js';
import { CONTRACT_DIFFICULTY, TILE, type ContractDifficulty } from '../constants.js';
import { coordKey, explorationReachableKeys } from '../mapConnectivity.js';
import type { GridPoint } from '../../types.js';
import type { Rng } from '../../rng.js';

const LATTICE_COLS = 4;
const LATTICE_ROWS = 2;
/** Slot pitch in tiles; each slot's interior is `CELL - 1` tiles square. */
const CELL = 7;

export const CYBER_MAP_WIDTH = LATTICE_COLS * CELL + 1; // 29
export const CYBER_MAP_HEIGHT = LATTICE_ROWS * CELL + 1; // 15

/** Node count per contract difficulty — the cyber-side threat/objective budget. */
const NODE_COUNT: Record<string, number> = Object.freeze({
  [CONTRACT_DIFFICULTY.STANDARD]: 5,
  [CONTRACT_DIFFICULTY.ELEVATED]: 6,
  [CONTRACT_DIFFICULTY.CRITICAL]: 8,
});

type Slot = { c: number; r: number };

const slotKey = (slot: Slot): string => `${slot.c},${slot.r}`;

export type CyberMapBuildResult = {
  grid: Grid;
  /** Avatar spawn — center of the entry node. */
  entryTile: GridPoint;
  /** Exit-port anchor, Chebyshev-adjacent to `entryTile` inside the entry node. */
  portTile: GridPoint;
  /** Non-entry node centers — data-node anchors (P3.M3.4). */
  nodeTiles: GridPoint[];
  /** Per-`nodeTiles` waypoint ring just inside each node — Probe patrols (P3.M3.5). */
  patrolRings: GridPoint[][];
};

export function buildCyberMap({
  rng,
  difficulty,
}: {
  rng: Rng;
  difficulty: ContractDifficulty;
}): CyberMapBuildResult {
  const nodeCount = NODE_COUNT[difficulty];
  if (!nodeCount) {
    throw new Error(`buildCyberMap: unknown contract difficulty "${difficulty}"`);
  }

  // 1. Spanning random walk over the slot lattice. Always connected by
  // construction (every new slot attaches to a visited one).
  const startSlot: Slot = { c: 0, r: rng.intRange(0, LATTICE_ROWS) };
  const visited: Slot[] = [startSlot];
  const visitedKeys = new Set([slotKey(startSlot)]);
  const edges: Array<[Slot, Slot]> = [];
  while (visited.length < nodeCount) {
    const frontier: Array<[Slot, Slot]> = [];
    for (const slot of visited) {
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next: Slot = { c: slot.c + dc, r: slot.r + dr };
        if (next.c < 0 || next.r < 0 || next.c >= LATTICE_COLS || next.r >= LATTICE_ROWS) continue;
        if (visitedKeys.has(slotKey(next))) continue;
        frontier.push([slot, next]);
      }
    }
    if (frontier.length === 0) {
      // Unreachable while nodeCount ≤ lattice slots, but fail loud if the
      // lattice dimensions and NODE_COUNT ever drift apart.
      throw new Error(`buildCyberMap: lattice walk exhausted at ${visited.length}/${nodeCount}`);
    }
    const [from, to] = rng.pick(frontier);
    visited.push(to);
    visitedKeys.add(slotKey(to));
    edges.push([from, to]);
  }

  // 2. Carve square nodes into the firewall fill.
  const grid = new Grid(CYBER_MAP_WIDTH, CYBER_MAP_HEIGHT, TILE.WALL);
  const centers = new Map<string, GridPoint>();
  const rings = new Map<string, GridPoint[]>();
  for (const slot of visited) {
    const size = rng.intRange(3, 6); // 3–5 tiles square
    const ox = 1 + slot.c * CELL + Math.floor((CELL - 1 - size) / 2);
    const oy = 1 + slot.r * CELL + Math.floor((CELL - 1 - size) / 2);
    for (let y = oy; y < oy + size; y++) {
      for (let x = ox; x < ox + size; x++) {
        grid.setTile(x, y, TILE.FLOOR);
      }
    }
    centers.set(slotKey(slot), { x: ox + Math.floor(size / 2), y: oy + Math.floor(size / 2) });
    // Clockwise perimeter ring just inside the node — Probe patrol waypoints.
    const ring: GridPoint[] = [];
    for (let x = ox; x < ox + size; x++) ring.push({ x, y: oy });
    for (let y = oy + 1; y < oy + size; y++) ring.push({ x: ox + size - 1, y });
    for (let x = ox + size - 2; x >= ox; x--) ring.push({ x, y: oy + size - 1 });
    for (let y = oy + size - 2; y >= oy + 1; y--) ring.push({ x: ox, y });
    rings.set(slotKey(slot), ring);
  }

  // 3. Carve 1-tile L-corridors (data lines) along the walk edges. Adjacent
  // slots keep the path inside their two cells, so corridors never clip a
  // third node.
  for (const [a, b] of edges) {
    const ca = centers.get(slotKey(a))!;
    const cb = centers.get(slotKey(b))!;
    let x = ca.x;
    let y = ca.y;
    while (x !== cb.x) {
      x += Math.sign(cb.x - x);
      grid.setTile(x, y, TILE.FLOOR);
    }
    while (y !== cb.y) {
      y += Math.sign(cb.y - y);
      grid.setTile(x, y, TILE.FLOOR);
    }
  }

  // 4. Entry node hosts the avatar spawn and the exit-port anchor. Nodes are
  // ≥ 3 tiles square, so center+1 is always inside the node.
  const entryTile = centers.get(slotKey(startSlot))!;
  const portTile: GridPoint = { x: entryTile.x + 1, y: entryTile.y };

  // 5. Connectivity gate — crash on an unreachable node rather than ship a
  // map the objective can never complete on.
  const reachable = explorationReachableKeys(new World(grid), entryTile);
  if (!reachable.has(coordKey(portTile.x, portTile.y))) {
    throw new Error(`buildCyberMap: port tile (${portTile.x}, ${portTile.y}) unreachable`);
  }
  const nodeTiles: GridPoint[] = [];
  const patrolRings: GridPoint[][] = [];
  for (const slot of visited) {
    const center = centers.get(slotKey(slot))!;
    if (!reachable.has(coordKey(center.x, center.y))) {
      throw new Error(
        `buildCyberMap: node at (${center.x}, ${center.y}) unreachable from entry ` +
          `(${entryTile.x}, ${entryTile.y})`
      );
    }
    if (slot === startSlot) continue;
    nodeTiles.push(center);
    patrolRings.push(rings.get(slotKey(slot))!);
  }

  return { grid, entryTile, portTile, nodeTiles, patrolRings };
}
