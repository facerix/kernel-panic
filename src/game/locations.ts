/*
 * P2.5.M7.2 — Location memory & site roster.
 *
 * Pure utility module for the campaign's site roster. The campaign remembers
 * combat locations by seed and accumulates terrain mutations (breach holes,
 * removed doors) across visits. On revisit, the map is rebuilt deterministically
 * from the seed and these deltas are replayed onto the fresh geometry before
 * fresh enemies/objectives spawn.
 *
 * Everything here is side-effect free except `applyMutationDeltas`, whose only
 * effect is mutating the `Grid` passed in. No silent fallbacks: corrupt deltas
 * or malformed roster entries throw rather than ship a bad map.
 */

import { TILE } from './constants.js';
import { normalizeMapDimensions } from './procgen/mapDimensions.js';
import type { Grid } from './Grid.js';
import type { LocationSite, LocationToken, TileDelta } from '../types.js';

const KNOWN_TILE_IDS: ReadonlySet<number> = new Set(Object.values(TILE));
const LOCATION_TIERS: ReadonlySet<LocationSite['tier']> = new Set(['score', 'roster']);

/** Stable coordinate key for delta deduplication. */
function coordKey(x: number, y: number): string {
  return `${x},${y}`;
}

const SEEN_KEY_RE = /^-?\d+,-?\d+$/;

function assertValidSeenKey(key: string, context: string): void {
  if (typeof key !== 'string' || !SEEN_KEY_RE.test(key)) {
    throw new TypeError(`${context}: malformed coordinate key "${key}"`);
  }
}

function compareSeenKeys(a: string, b: string): number {
  const [ax, ay] = a.split(',').map(Number);
  const [bx, by] = b.split(',').map(Number);
  const dx = ax! - bx!;
  return dx !== 0 ? dx : ay! - by!;
}

/**
 * Union exploration memory from prior visits with a run's newly seen tiles.
 * Returns a sorted, deduplicated copy — exploration accumulates across visits.
 */
export function mergeSiteSeenKeys(
  existing: readonly string[],
  incoming: readonly string[]
): string[] {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) {
    throw new TypeError('mergeSiteSeenKeys: existing and incoming must be arrays');
  }
  const merged = new Set<string>();
  for (const key of existing) {
    assertValidSeenKey(key, 'mergeSiteSeenKeys');
    merged.add(key);
  }
  for (const key of incoming) {
    assertValidSeenKey(key, 'mergeSiteSeenKeys');
    merged.add(key);
  }
  return [...merged].sort(compareSeenKeys);
}

/**
 * Deterministic site id from a map seed. `String(seed)` is sufficient for the
 * current pool size (max 6 roster slots, no seed collisions in practice); a
 * hash is only needed if seed values could ever collide.
 */
export function generateSiteId(seed: number | string): string {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) {
      throw new TypeError(`generateSiteId: numeric seed must be finite, got ${seed}`);
    }
    return String(seed >>> 0);
  }
  if (typeof seed === 'string' && seed.length > 0) {
    return seed;
  }
  throw new TypeError('generateSiteId: seed must be a finite number or non-empty string');
}

/**
 * Replay terrain mutations onto a freshly-built grid (revisit re-entry).
 * Mutates `grid` only — does not touch any `World.mutationDeltas` accumulator,
 * so this run's *new* breaches stay separate from the persisted history.
 *
 * Throws on any corrupt delta (unknown kind, out-of-bounds coord, unknown tile
 * value) — a bad map is worse than a crash.
 */
export function applyMutationDeltas(grid: Grid, deltas: readonly TileDelta[]): void {
  if (!grid || typeof grid.setTile !== 'function' || typeof grid.inBounds !== 'function') {
    throw new TypeError('applyMutationDeltas requires a Grid');
  }
  if (!Array.isArray(deltas)) {
    throw new TypeError('applyMutationDeltas: deltas must be an array');
  }
  deltas.forEach((delta, i) => {
    assertValidDelta(delta, i);
    if (!grid.inBounds(delta.x, delta.y)) {
      throw new RangeError(
        `applyMutationDeltas: deltas[${i}] (${delta.x}, ${delta.y}) is out of bounds`
      );
    }
    // `entity-removed` deltas carry no grid change of their own — the companion
    // `tile` delta (e.g. a breached door's cell → RUBBLE) does the geometry.
    // Run re-entry uses the resulting tile to decide which doors to skip.
    if (delta.kind === 'tile') {
      grid.setTile(delta.x, delta.y, delta.to);
    }
  });
}

/**
 * Merge accumulated site deltas with a run's new deltas, deduplicating by
 * coordinate. Same-coordinate deltas keep the latest (incoming) only, so a
 * cell that was breached twice across visits records one current delta.
 * `entity-removed` deltas are keyed by their own coordinate too.
 */
export function mergeSiteDeltas(
  existing: readonly TileDelta[],
  incoming: readonly TileDelta[]
): TileDelta[] {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) {
    throw new TypeError('mergeSiteDeltas: existing and incoming must be arrays');
  }
  const byCoord = new Map<string, TileDelta>();
  for (const delta of existing) byCoord.set(coordKey(delta.x, delta.y), delta);
  for (const delta of incoming) byCoord.set(coordKey(delta.x, delta.y), delta);
  return [...byCoord.values()].map(cloneDelta);
}

/**
 * Structural validation for a roster entry on campaign restore. Throws on bad
 * delta, unknown tier, non-boolean `scoreTarget`, missing/empty string fields,
 * or a non-integer `lastVisitedJob`. Returns a fresh, normalized copy.
 */
export function normalizeLocationSite(raw: unknown): LocationSite {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('normalizeLocationSite: site must be an object');
  }
  const candidate = raw as Partial<LocationSite>;
  const id = requireNonEmptyString(candidate.id, 'id');
  const seed = requireNonEmptyString(candidate.seed, 'seed');
  const dimensions = normalizeMapDimensions(
    candidate.mapWidth,
    candidate.mapHeight,
    'normalizeLocationSite'
  );
  const label = requireNonEmptyString(candidate.label, 'label');
  if (candidate.tier === undefined || !LOCATION_TIERS.has(candidate.tier)) {
    throw new RangeError(`normalizeLocationSite: unknown tier "${String(candidate.tier)}"`);
  }
  if (typeof candidate.scoreTarget !== 'boolean') {
    throw new TypeError('normalizeLocationSite: scoreTarget must be a boolean');
  }
  if (!Number.isInteger(candidate.lastVisitedJob) || (candidate.lastVisitedJob as number) < 0) {
    throw new RangeError('normalizeLocationSite: lastVisitedJob must be a non-negative integer');
  }
  if (!Array.isArray(candidate.mutationDeltas)) {
    throw new TypeError('normalizeLocationSite: mutationDeltas must be an array');
  }
  const mutationDeltas = candidate.mutationDeltas.map((delta, i) => {
    assertValidDelta(delta, i);
    return cloneDelta(delta);
  });
  const seenKeys = Array.isArray(candidate.seenKeys)
    ? candidate.seenKeys.map((key, i) => {
        assertValidSeenKey(key, `normalizeLocationSite: seenKeys[${i}]`);
        return key;
      })
    : [];
  return {
    id,
    seed,
    mapWidth: dimensions.width,
    mapHeight: dimensions.height,
    label,
    tier: candidate.tier,
    scoreTarget: candidate.scoreTarget,
    mutationDeltas,
    seenKeys,
    lastVisitedJob: candidate.lastVisitedJob as number,
    ...(candidate.principal !== undefined
      ? { principal: normalizeLocationToken(candidate.principal, 'principal') }
      : {}),
    ...(candidate.site !== undefined
      ? { site: normalizeLocationToken(candidate.site, 'site') }
      : {}),
  };
}

/** Validate + clone a lexicon token reference (principal / site identity). */
function normalizeLocationToken(raw: unknown, field: string): LocationToken {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`normalizeLocationSite: ${field} must be an object`);
  }
  const token = raw as Partial<LocationToken>;
  const id = requireNonEmptyString(token.id, `${field}.id`);
  const label = requireNonEmptyString(token.label, `${field}.label`);
  if (!Array.isArray(token.groups) || !token.groups.every(g => typeof g === 'string' && g.length)) {
    throw new TypeError(`normalizeLocationSite: ${field}.groups must be non-empty strings`);
  }
  return { id, label, groups: [...token.groups] };
}

/**
 * Structural validation for a single delta. Bounds are *not* checked here
 * (no grid available at campaign-restore time) — `applyMutationDeltas` enforces
 * bounds against the rebuilt grid. Negative coords are rejected here as a cheap
 * structural guard.
 */
function assertValidDelta(delta: unknown, i: number): asserts delta is TileDelta {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
    throw new TypeError(`location delta[${i}] must be an object`);
  }
  const rec = delta as Partial<TileDelta>;
  if (rec.kind === 'tile') {
    requireGridInt(rec.x, i, 'x');
    requireGridInt(rec.y, i, 'y');
    if (!KNOWN_TILE_IDS.has(rec.from as number) || !KNOWN_TILE_IDS.has(rec.to as number)) {
      throw new RangeError(`location delta[${i}] tile delta has unknown tile id`);
    }
    return;
  }
  if (rec.kind === 'entity-removed') {
    if (typeof rec.id !== 'string' || rec.id.length === 0) {
      throw new TypeError(`location delta[${i}] entity removal requires a non-empty id`);
    }
    requireGridInt(rec.x, i, 'x');
    requireGridInt(rec.y, i, 'y');
    if (typeof rec.archetype !== 'string' || rec.archetype.length === 0) {
      throw new TypeError(`location delta[${i}] entity removal requires an archetype`);
    }
    return;
  }
  throw new Error(`location delta[${i}] has unknown kind "${String(rec.kind)}"`);
}

function cloneDelta(delta: TileDelta): TileDelta {
  return { ...delta };
}

function requireGridInt(value: unknown, i: number, field: string): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new RangeError(`location delta[${i}] ${field} must be a non-negative integer`);
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`normalizeLocationSite: ${field} must be a non-empty string`);
  }
  return value;
}
