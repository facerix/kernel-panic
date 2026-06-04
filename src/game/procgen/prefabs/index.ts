/**
 * Authored room prefabs — small ASCII-keyed tile blocks plus declared
 * anchors (fodder spawns, cover positions). The procgen pipeline picks one
 * per BSP leaf and stamps it inside the leaf's bounds.
 *
 * Hand-authoring shape: each prefab module exports an `ASCII` string and a
 * `metadata` object with the prefab id and explicit anchors. We parse the
 * ASCII once at module load via `parsePrefab` so consumers see a typed
 * `Prefab` record (Uint8Array tiles + integer anchor coords).
 *
 * ASCII glyph map:
 *   `.`  TILE.FLOOR
 *   `#`  TILE.WALL
 *   `=`  TILE.COVER
 *   `|`  TILE.FLOOR + door anchor
 *
 * Fodder anchors, optional waypoints, and exit candidate tiles are declared
 * separately in the `anchors` object so prefab authors aren't squeezing
 * waypoint metadata into the ASCII grid (which would couple shape and
 * gameplay data).
 *
 * Crashes loudly on:
 *   - unknown ASCII glyphs
 *   - inconsistent row widths
 *   - anchors outside the prefab's bounds
 *   - declared dimensions disagreeing with the parsed ASCII
 *
 * Silent fallback here would mask a content-authoring bug we want surfaced
 * the first time the test suite runs.
 */

import { TILE } from '../../constants.js';
import { ASCII as OFFICE_ASCII, METADATA as OFFICE_METADATA } from './office.js';
import { ASCII as SERVER_ROOM_ASCII, METADATA as SERVER_ROOM_METADATA } from './server-room.js';
import { ASCII as HALLWAY_ASCII, METADATA as HALLWAY_METADATA } from './hallway.js';
import { ASCII as LAB_ASCII, METADATA as LAB_METADATA } from './lab.js';
import { ASCII as CHECKPOINT_ASCII, METADATA as CHECKPOINT_METADATA } from './checkpoint.js';
import type { ParsedPrefab, PrefabAscii, PrefabAnchor, PrefabMetadata } from './types.js';

export type {
  ParsedPrefab,
  PrefabAnchor,
  PrefabAnchorsSpec,
  PrefabAscii,
  PrefabFodderAnchor,
  PrefabMetadata,
} from './types.js';

const GLYPH_TO_TILE = Object.freeze({
  '.': TILE.FLOOR,
  '#': TILE.WALL,
  '=': TILE.COVER,
  '|': TILE.FLOOR,
});

/**
 * Parse an ASCII prefab body + metadata into a runtime `Prefab`. The ascii
 * body uses '\n' separators with leading/trailing newlines stripped. Every
 * row must be the same length.
 *
 * @returns Parsed prefab: tile bytes plus validated anchors.
 */
export function parsePrefab(ascii: PrefabAscii, metadata: PrefabMetadata): ParsedPrefab {
  if (typeof ascii !== 'string' || ascii.length === 0) {
    throw new TypeError('parsePrefab requires a non-empty ASCII string');
  }
  if (!metadata || typeof metadata.id !== 'string') {
    throw new TypeError('parsePrefab requires metadata with a string id');
  }
  const rows = ascii.replace(/^\n+|\n+$/g, '').split('\n');
  const h = rows.length;
  if (h === 0) throw new Error(`parsePrefab(${metadata.id}): empty body`);
  const w = rows[0].length;
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) {
      throw new Error(
        `parsePrefab(${metadata.id}): row ${y} has length ${rows[y].length}, expected ${w}`
      );
    }
  }
  if (metadata.w !== undefined && metadata.w !== w) {
    throw new Error(
      `parsePrefab(${metadata.id}): metadata.w=${metadata.w} disagrees with ASCII width ${w}`
    );
  }
  if (metadata.h !== undefined && metadata.h !== h) {
    throw new Error(
      `parsePrefab(${metadata.id}): metadata.h=${metadata.h} disagrees with ASCII height ${h}`
    );
  }

  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (!Object.hasOwn(GLYPH_TO_TILE, ch)) {
        throw new Error(`parsePrefab(${metadata.id}): unknown glyph "${ch}" at (${x}, ${y})`);
      }
      const glyph = ch as keyof typeof GLYPH_TO_TILE;
      tiles[y * w + x] = GLYPH_TO_TILE[glyph];
    }
  }

  const anchors = {
    fodder: validateAnchors(metadata.anchors?.fodder ?? [], w, h, metadata.id, 'fodder'),
    cover: validateAnchors(metadata.anchors?.cover ?? [], w, h, metadata.id, 'cover'),
    exit: validateAnchors(metadata.anchors?.exit ?? [], w, h, metadata.id, 'exit'),
    corpCivilians: validateAnchors(
      metadata.anchors?.corpCivilians ?? [],
      w,
      h,
      metadata.id,
      'corpCivilians'
    ),
    neutralCivilians: validateAnchors(
      metadata.anchors?.neutralCivilians ?? [],
      w,
      h,
      metadata.id,
      'neutralCivilians'
    ),
    doors: validateAnchors(metadata.anchors?.doors ?? [], w, h, metadata.id, 'doors'),
  };
  const patrolPaths = validatePatrolPaths(metadata.patrolPaths ?? [], w, h, metadata.id);

  return { id: metadata.id, w, h, tiles, anchors, patrolPaths };
}

function validateAnchors<T extends PrefabAnchor>(
  list: T[],
  w: number,
  h: number,
  prefabId: string,
  kind: 'fodder' | 'cover' | 'exit' | 'corpCivilians' | 'neutralCivilians' | 'doors'
): T[] {
  if (!Array.isArray(list)) {
    throw new TypeError(`prefab ${prefabId}: anchors.${kind} must be an array`);
  }
  return list.map(a => {
    if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) {
      throw new TypeError(
        `prefab ${prefabId}: ${kind} anchor requires integer x,y; got ${JSON.stringify(a)}`
      );
    }
    if (a.x < 0 || a.x >= w || a.y < 0 || a.y >= h) {
      throw new RangeError(
        `prefab ${prefabId}: ${kind} anchor (${a.x},${a.y}) out of ${w}x${h} bounds`
      );
    }
    if (kind === 'fodder' && 'waypoints' in a && a.waypoints) {
      if (!Array.isArray(a.waypoints)) {
        throw new TypeError(
          `prefab ${prefabId}: fodder waypoints must be an array, got ${typeof a.waypoints}`
        );
      }
      for (const wp of a.waypoints) {
        if (!Number.isInteger(wp.x) || !Number.isInteger(wp.y)) {
          throw new TypeError(
            `prefab ${prefabId}: waypoint ${JSON.stringify(wp)} requires integer x,y`
          );
        }
        if (wp.x < 0 || wp.x >= w || wp.y < 0 || wp.y >= h) {
          throw new RangeError(
            `prefab ${prefabId}: waypoint (${wp.x},${wp.y}) out of ${w}x${h} bounds`
          );
        }
      }
    }
    return { ...a };
  });
}

function validatePatrolPaths(
  paths: PrefabAnchor[][],
  w: number,
  h: number,
  prefabId: string
): PrefabAnchor[][] {
  if (!Array.isArray(paths)) {
    throw new TypeError(`prefab ${prefabId}: patrolPaths must be an array`);
  }
  return paths.map((path, pathIndex) => {
    if (!Array.isArray(path) || path.length === 0) {
      throw new TypeError(
        `prefab ${prefabId}: patrolPaths[${pathIndex}] must be a non-empty array`
      );
    }
    return path.map((wp, waypointIndex) => {
      if (!Number.isInteger(wp.x) || !Number.isInteger(wp.y)) {
        throw new TypeError(
          `prefab ${prefabId}: patrolPaths[${pathIndex}][${waypointIndex}] requires integer x,y`
        );
      }
      if (wp.x < 0 || wp.x >= w || wp.y < 0 || wp.y >= h) {
        throw new RangeError(
          `prefab ${prefabId}: patrol waypoint (${wp.x},${wp.y}) out of ${w}x${h} bounds`
        );
      }
      return { x: wp.x, y: wp.y };
    });
  });
}

export const PREFABS = Object.freeze({
  office: parsePrefab(OFFICE_ASCII, OFFICE_METADATA),
  serverRoom: parsePrefab(SERVER_ROOM_ASCII, SERVER_ROOM_METADATA),
  hallway: parsePrefab(HALLWAY_ASCII, HALLWAY_METADATA),
  lab: parsePrefab(LAB_ASCII, LAB_METADATA),
  checkpoint: parsePrefab(CHECKPOINT_ASCII, CHECKPOINT_METADATA),
});

/**
 * Look up a prefab whose footprint fits inside `(maxW, maxH)`. Returns null
 * when nothing fits — caller decides whether that's a hard error.
 */
export function fittingPrefabs(maxW: number, maxH: number): ParsedPrefab[] {
  return Object.values(PREFABS).filter(p => p.w <= maxW && p.h <= maxH);
}
