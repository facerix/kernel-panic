/**
 * Phase 2.7 M1.5 - combat footprint selection.
 *
 * Map dimensions are part of the contract/site identity, not a transient
 * render choice. The resolver is pure over `(seed, difficulty)` and uses its
 * own RNG fork so later mapgen changes do not perturb the footprint roll.
 */

import { Rng } from '../../rng.js';
import { CONTRACT_DIFFICULTY } from '../constants.js';
import { BSP_TUNABLES } from './bsp.js';
import type { ContractDifficulty } from '../constants.js';

export type MapDimensions = Readonly<{ width: number; height: number }>;

export const DEFAULT_COMBAT_MAP_DIMENSIONS: MapDimensions = Object.freeze({
  width: 24,
  height: 16,
});

export const MAX_COMBAT_MAP_DIMENSIONS: MapDimensions = Object.freeze({
  width: 32,
  height: 20,
});

export const MAP_DIMENSION_BANDS: Record<ContractDifficulty, readonly MapDimensions[]> =
  Object.freeze({
    [CONTRACT_DIFFICULTY.STANDARD]: Object.freeze([
      DEFAULT_COMBAT_MAP_DIMENSIONS,
      Object.freeze({ width: 26, height: 16 }),
      Object.freeze({ width: 28, height: 16 }),
    ]),
    [CONTRACT_DIFFICULTY.ELEVATED]: Object.freeze([
      Object.freeze({ width: 26, height: 18 }),
      Object.freeze({ width: 28, height: 18 }),
      Object.freeze({ width: 30, height: 18 }),
    ]),
    [CONTRACT_DIFFICULTY.CRITICAL]: Object.freeze([
      Object.freeze({ width: 28, height: 18 }),
      Object.freeze({ width: 30, height: 20 }),
      Object.freeze({ width: 32, height: 20 }),
    ]),
  });

for (const [difficulty, band] of Object.entries(MAP_DIMENSION_BANDS)) {
  if (band.length === 0) {
    throw new Error(`MAP_DIMENSION_BANDS.${difficulty} must not be empty`);
  }
  for (const dimensions of band) {
    assertValidMapDimensions(dimensions, `MAP_DIMENSION_BANDS.${difficulty}`);
  }
}

export function resolveMapDimensions({
  seed,
  difficulty,
}: {
  seed: number;
  difficulty: ContractDifficulty;
}): MapDimensions {
  if (!Number.isInteger(seed) || seed < 0) {
    throw new RangeError(`resolveMapDimensions: seed must be a non-negative integer, got ${seed}`);
  }
  const band = MAP_DIMENSION_BANDS[difficulty];
  if (!band) {
    throw new Error(`resolveMapDimensions: unknown difficulty "${difficulty}"`);
  }
  const rng = new Rng(seed).fork('map-size');
  const dimensions = band[rng.intRange(0, band.length)]!;
  return { ...dimensions };
}

/**
 * Normalize contract/site dimensions. Both fields missing is the legacy path
 * (pre-M1.5 contracts and roster sites); a partial pair is corrupt data.
 */
export function normalizeMapDimensions(
  width: unknown,
  height: unknown,
  context: string
): MapDimensions {
  if (width === undefined && height === undefined) {
    return { ...DEFAULT_COMBAT_MAP_DIMENSIONS };
  }
  if (width === undefined || height === undefined) {
    throw new TypeError(`${context}: mapWidth and mapHeight must be supplied together`);
  }
  const dimensions = { width, height };
  assertValidMapDimensions(dimensions, context);
  return dimensions as MapDimensions;
}

function assertValidMapDimensions(
  dimensions: { width: unknown; height: unknown },
  context: string
): asserts dimensions is { width: number; height: number } {
  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new TypeError(`${context}: map dimensions must be integer width/height`);
  }
  const w = width as number;
  const h = height as number;
  if (w <= 0 || h <= 0) {
    throw new RangeError(`${context}: map dimensions must be positive, got ${w}x${h}`);
  }
  if (w % 2 !== 0 || h % 2 !== 0) {
    throw new RangeError(`${context}: map dimensions must be even, got ${w}x${h}`);
  }
  if (w > MAX_COMBAT_MAP_DIMENSIONS.width || h > MAX_COMBAT_MAP_DIMENSIONS.height) {
    throw new RangeError(
      `${context}: map dimensions ${w}x${h} exceed ` +
        `${MAX_COMBAT_MAP_DIMENSIONS.width}x${MAX_COMBAT_MAP_DIMENSIONS.height}`
    );
  }
  const playableWidth = w - 2;
  const playableHeight = h - 2;
  if (playableWidth < BSP_TUNABLES.MIN_LEAF || playableHeight < BSP_TUNABLES.MIN_LEAF) {
    throw new RangeError(
      `${context}: playable area ${playableWidth}x${playableHeight} is below ` +
        `MIN_LEAF=${BSP_TUNABLES.MIN_LEAF}`
    );
  }
}
