import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_COMBAT_MAP_DIMENSIONS,
  MAP_DIMENSION_BANDS,
  normalizeMapDimensions,
  resolveMapDimensions,
} from '../../../../src/game/procgen/mapDimensions.js';
import { buildMap, mapIsFullyConnectedFromSpawn } from '../../../../src/game/procgen/mapBuild.js';
import { CONTRACT_DIFFICULTY } from '../../../../src/game/constants.js';
import { Rng } from '../../../../src/rng.js';

test('resolveMapDimensions is deterministic for the same seed and difficulty', () => {
  const a = resolveMapDimensions({ seed: 0xdecafbad, difficulty: CONTRACT_DIFFICULTY.ELEVATED });
  const b = resolveMapDimensions({ seed: 0xdecafbad, difficulty: CONTRACT_DIFFICULTY.ELEVATED });

  assert.deepEqual(a, b);
});

test('resolveMapDimensions chooses only from the difficulty allowlist', () => {
  for (const difficulty of Object.values(CONTRACT_DIFFICULTY)) {
    for (let seed = 0; seed < 50; seed++) {
      const dimensions = resolveMapDimensions({ seed, difficulty });
      assert.ok(
        MAP_DIMENSION_BANDS[difficulty].some(
          option => option.width === dimensions.width && option.height === dimensions.height
        ),
        `${difficulty} seed ${seed} resolved ${dimensions.width}x${dimensions.height}`
      );
    }
  }
});

test('different seeds at the same difficulty can produce different dimensions', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 50; seed++) {
    const { width, height } = resolveMapDimensions({
      seed,
      difficulty: CONTRACT_DIFFICULTY.STANDARD,
    });
    seen.add(`${width}x${height}`);
  }

  assert.ok(seen.size > 1, `expected jitter, saw ${[...seen].join(', ')}`);
});

test('every allowlisted size can build the matching difficulty threat budget', () => {
  for (const difficulty of Object.values(CONTRACT_DIFFICULTY)) {
    for (const dimensions of MAP_DIMENSION_BANDS[difficulty]) {
      const map = buildMap({
        rng: new Rng(1234),
        width: dimensions.width,
        height: dimensions.height,
        threatCount:
          difficulty === CONTRACT_DIFFICULTY.STANDARD
            ? 2
            : difficulty === CONTRACT_DIFFICULTY.ELEVATED
              ? 3
              : 4,
        difficulty,
      });

      assert.equal(map.grid.width, dimensions.width);
      assert.equal(map.grid.height, dimensions.height);
      assert.equal(
        map.fodder.length,
        difficulty === CONTRACT_DIFFICULTY.STANDARD
          ? 2
          : difficulty === CONTRACT_DIFFICULTY.ELEVATED
            ? 3
            : 4
      );
      assert.ok(
        mapIsFullyConnectedFromSpawn(map),
        `${dimensions.width}x${dimensions.height} disconnected`
      );
    }
  }
});

test('STANDARD band minimum footprint is the legacy 24x16 baseline', () => {
  const minWidth = Math.min(...MAP_DIMENSION_BANDS[CONTRACT_DIFFICULTY.STANDARD].map(d => d.width));
  const minHeight = Math.min(
    ...MAP_DIMENSION_BANDS[CONTRACT_DIFFICULTY.STANDARD].map(d => d.height)
  );
  assert.equal(minWidth, DEFAULT_COMBAT_MAP_DIMENSIONS.width);
  assert.equal(minHeight, DEFAULT_COMBAT_MAP_DIMENSIONS.height);
});

test('normalizeMapDimensions defaults only fully legacy records', () => {
  assert.deepEqual(
    normalizeMapDimensions(undefined, undefined, 'test'),
    DEFAULT_COMBAT_MAP_DIMENSIONS
  );
  assert.throws(() => normalizeMapDimensions(24, undefined, 'test'), /supplied together/);
  assert.throws(() => normalizeMapDimensions(23, 16, 'test'), /even/);
});
