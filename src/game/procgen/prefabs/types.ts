/**
 * Authoring-time shapes for room prefabs (ASCII glyph grid + metadata).
 *
 * This module intentionally imports nothing else in the prefab tree. Individual
 * prefab files should import types from here only — never from `./index.js`,
 * which would create a circular load order (`index` → prefab → `index`).
 */

/** Integer cell in prefab local space (0 .. w-1, 0 .. h-1). */
export type PrefabAnchor = {
  x: number;
  y: number;
};

export type PrefabDroneAnchor = PrefabAnchor & {
  waypoints?: PrefabAnchor[];
};

export type PrefabAnchorsSpec = {
  drones: PrefabDroneAnchor[];
  cover: PrefabAnchor[];
  exit: PrefabAnchor[];
  /** M5: corp-aligned non-combatant spawn points. */
  corpCivilians?: PrefabAnchor[];
  /** M5: neutral civilian spawn points. */
  neutralCivilians?: PrefabAnchor[];
  /** M6.1: locked door entity anchors; ASCII `|` marks floor under the entity. */
  doors?: PrefabAnchor[];
};

/**
 * Declared alongside the ASCII body. Optional `w` / `h` are cross-checked
 * against the parsed row/column dimensions.
 */
export type PrefabMetadata = {
  id: string;
  w?: number;
  h?: number;
  anchors: PrefabAnchorsSpec;
  /** M7: reusable patrol waypoint lists, assigned to nearest drone anchor. */
  patrolPaths?: PrefabAnchor[][];
};

/**
 * Newline-separated rows of authoring glyphs (`.`, `#`, `=`, …). Leading and
 * trailing blank lines are stripped by `parsePrefab`.
 */
export type PrefabAscii = string;

/** Runtime tile buffer + validated anchors after `parsePrefab`. */
export type ParsedPrefab = {
  id: string;
  w: number;
  h: number;
  tiles: Uint8Array;
  anchors: PrefabAnchorsSpec;
  patrolPaths: PrefabAnchor[][];
};
