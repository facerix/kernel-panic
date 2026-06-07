import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aliasFor, type EnemyAlias } from '../../../src/game/enemyAliases.js';
import { ENEMY_ARCHETYPE } from '../../../src/game/encounters.js';
import { CONTRACT_LEXICON } from '../../../src/game/hub/Curator.js';

const ARCHETYPES = Object.values(ENEMY_ARCHETYPE);

/** Run `fn` with `console.warn` captured; returns the collected arg-lists. */
function captureWarnings(fn: () => void): unknown[][] {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

test('aliasFor returns the curated alias for a known principal/archetype pair', () => {
  const alias = aliasFor('matsuda', ENEMY_ARCHETYPE.SKIRMISHER);
  assert.equal(alias.displayName, 'Auditor');
  assert.equal(alias.principalTag, 'Matsuda');
});

test('every lexicon principal has a curated tag and a name for every archetype', () => {
  const seen: EnemyAlias[] = [];
  const warnings = captureWarnings(() => {
    for (const principal of CONTRACT_LEXICON.principals) {
      for (const archetype of ARCHETYPES) {
        const alias = aliasFor(principal.id, archetype);
        assert.ok(alias.principalTag.length > 0, `${principal.id} is missing a short tag`);
        assert.ok(
          alias.displayName.length > 0,
          `${principal.id}/${archetype} is missing a display name`
        );
        seen.push(alias);
      }
    }
  });
  assert.deepEqual(
    warnings,
    [],
    `every lexicon pair must be curated — unexpected fallback warnings: ${JSON.stringify(warnings)}`
  );
  assert.equal(seen.length, CONTRACT_LEXICON.principals.length * ARCHETYPES.length);
});

test('principal tags stay short enough for the tablet combat log', () => {
  // Bracket-prefix budget: long tags blow out the log line on narrow screens.
  for (const principal of CONTRACT_LEXICON.principals) {
    const { principalTag } = aliasFor(principal.id, ENEMY_ARCHETYPE.GUARD);
    assert.ok(
      principalTag.length <= 8,
      `tag "${principalTag}" for ${principal.id} exceeds the 8-char budget`
    );
  }
});

test('aliasFor warns and falls back to the generic archetype name for an unknown principal', () => {
  let alias: EnemyAlias | undefined;
  const warnings = captureWarnings(() => {
    alias = aliasFor('no-such-principal', ENEMY_ARCHETYPE.GUARD);
  });
  assert.ok(alias);
  // Generic, capitalized archetype name; no bracket tag for an unknown owner.
  assert.equal(alias.displayName, 'Guard');
  assert.equal(alias.principalTag, '');
  assert.equal(warnings.length, 1, 'a missing alias must warn exactly once (loud in dev)');
});

test('aliasFor warns and falls back when the principal is known but the archetype is not curated', () => {
  let alias: EnemyAlias | undefined;
  const warnings = captureWarnings(() => {
    // @ts-expect-error — deliberately passing an archetype outside the union.
    alias = aliasFor('matsuda', 'netrunner');
  });
  assert.ok(alias);
  assert.equal(alias.displayName, 'Netrunner', 'falls back to the capitalized archetype id');
  // A known principal still contributes its tag even when the name falls back.
  assert.equal(alias.principalTag, 'Matsuda');
  assert.equal(warnings.length, 1);
});
