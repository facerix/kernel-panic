/**
 * Archetype registry tests.
 *
 * `src/game/archetypes/index.js` is a thin metadata layer over the existing
 * `Merc` and `Razor` classes. It serves three callers:
 *   - `<character-select>` reads `ARCHETYPES` to render the modal
 *   - `<key-help>` reads `ARCHETYPES[id].perkKey` to label the perk row
 *   - `Run.#makePlayer` and `Run.setArchetype` delegate to `buildPlayer`
 * The class behaviour (vault / slide) is already covered by Merc/Razor tests;
 * here we only assert the metadata contract and the factory glue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCHETYPES,
  ARCHETYPE_IDS,
  buildPlayer,
  isArchetypeId,
} from '../../../src/game/archetypes/index.js';
import { FACTION } from '../../../src/game/constants.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Razor } from '../../../src/game/archetypes/Razor.js';

test('ARCHETYPES exposes merc and razor with required metadata', () => {
  for (const id of ['merc', 'razor']) {
    const a = ARCHETYPES[id];
    assert.ok(a, `missing archetype "${id}"`);
    assert.equal(a.id, id);
    assert.equal(typeof a.name, 'string');
    assert.ok(a.name.length > 0, `${id}.name empty`);
    assert.equal(typeof a.blurb, 'string');
    assert.ok(a.blurb.length > 0, `${id}.blurb empty`);
    assert.ok(Array.isArray(a.perks) && a.perks.length > 0);
    assert.equal(typeof a.perkKey, 'string');
    assert.ok(a.perkKey.length > 0);
    assert.equal(typeof a.perkLabel, 'string');
    assert.ok(a.perkLabel.length > 0);
  }
});

test('Merc perk is vault on key v; Razor perk is slide on key t', () => {
  // These keys are already implemented in keymap.js — the registry just has
  // to mirror them. If they ever drift, key-help renders nonsense.
  assert.equal(ARCHETYPES.merc.perkKey, 'v');
  assert.deepEqual(ARCHETYPES.merc.perks, ['vault']);
  assert.equal(ARCHETYPES.razor.perkKey, 't');
  assert.deepEqual(ARCHETYPES.razor.perks, ['slide']);
});

test('ARCHETYPE_IDS lists every registered id, in display order', () => {
  // Display order matters for the character-select modal (default focus is
  // the first entry on first load). Merc first, then Razor.
  assert.deepEqual(ARCHETYPE_IDS, ['merc', 'razor']);
});

test('buildPlayer("merc", spawn) returns a Merc with the spawn coords', () => {
  const p = buildPlayer('merc', { x: 3, y: 4 });
  assert.ok(p instanceof Merc, 'expected a Merc instance');
  assert.equal(p.x, 3);
  assert.equal(p.y, 4);
  assert.equal(p.faction, FACTION.PLAYER);
  assert.equal(p.alive, true);
});

test('buildPlayer("razor", spawn) returns a Razor with the spawn coords', () => {
  const p = buildPlayer('razor', { x: 5, y: 6 });
  assert.ok(p instanceof Razor, 'expected a Razor instance');
  assert.equal(p.x, 5);
  assert.equal(p.y, 6);
  assert.equal(p.faction, FACTION.PLAYER);
});

test('buildPlayer accepts a maxAp override (used by Run for the global 4-AP budget)', () => {
  const p = buildPlayer('merc', { x: 0, y: 0, maxAp: 4 });
  assert.equal(p.maxAp, 4);
});

test('buildPlayer rejects an unknown archetype id (crash > silent fallback)', () => {
  assert.throws(() => buildPlayer('hacker', { x: 0, y: 0 }), /unknown archetype/i);
});

test('buildPlayer requires a finite (x, y) spawn', () => {
  assert.throws(() => buildPlayer('merc'), /spawn/i);
  assert.throws(() => buildPlayer('merc', {}), /spawn/i);
  assert.throws(() => buildPlayer('merc', { x: 0 }), /spawn/i);
  assert.throws(() => buildPlayer('merc', { x: 0, y: NaN }), /spawn/i);
});

test('isArchetypeId is a string-set membership check', () => {
  assert.equal(isArchetypeId('merc'), true);
  assert.equal(isArchetypeId('razor'), true);
  assert.equal(isArchetypeId('wizard'), false);
  assert.equal(isArchetypeId(null), false);
  assert.equal(isArchetypeId(undefined), false);
  assert.equal(isArchetypeId(7), false);
});
