/**
 * Archetype registry tests.
 *
 * `src/game/archetypes/index.js` is a thin metadata layer over the existing
 * `Merc` and `Razor` classes. It serves three callers:
 *   - Hub UI reads `ARCHETYPES` to render labels
 *   - `<key-help>` reads `ARCHETYPES[id].perkLabel` for intro text
 *   - `Campaign.buildCrew` delegates to `buildCrewMember`
 * The class behaviour (vault / slide) is already covered by Merc/Razor tests;
 * here we only assert the metadata contract and the factory glue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCHETYPES,
  ARCHETYPE_IDS,
  CALLSIGNS_BY_ARCHETYPE,
  RECRUIT_ARCHETYPE_POOL,
  buildCrewMember,
  isArchetypeId,
  pickCallsign,
} from '../../../src/game/archetypes/index.js';
import { Decker } from '../../../src/game/archetypes/Decker.js';
import { FACTION } from '../../../src/game/constants.js';
import { Merc, CALLSIGNS as MERC_CALLSIGNS } from '../../../src/game/archetypes/Merc.js';
import { CALLSIGNS as RAZOR_CALLSIGNS } from '../../../src/game/archetypes/Razor.js';
import { Rng } from '../../../src/rng.js';

test('ARCHETYPES exposes merc, razor, and tech with required metadata', () => {
  for (const id of ['merc', 'razor', 'tech']) {
    const a = ARCHETYPES[id];
    assert.ok(a, `missing archetype "${id}"`);
    assert.equal(a.id, id);
    assert.equal(typeof a.name, 'string');
    assert.ok(a.name.length > 0, `${id}.name empty`);
    assert.equal(typeof a.blurb, 'string');
    assert.ok(a.blurb.length > 0, `${id}.blurb empty`);
    assert.ok(Array.isArray(a.perks) && a.perks.length > 0);
    assert.equal(typeof a.perkLabel, 'string');
    assert.ok(a.perkLabel.length > 0);
  }
});

test('Merc perk is vault; Razor perk is slide; Tech perk is deploy', () => {
  assert.deepEqual(ARCHETYPES.merc.perks, ['vault']);
  assert.deepEqual(ARCHETYPES.razor.perks, ['slide']);
  assert.deepEqual(ARCHETYPES.tech.perks, ['deploy']);
});

test('ARCHETYPE_IDS lists every registered id, in display order', () => {
  // Display order matters for the character-select modal (default focus is
  // the first entry on first load). Merc → Razor → Tech, simplest kit first.
  assert.deepEqual(ARCHETYPE_IDS, ['merc', 'razor', 'tech']);
});

test('each archetype exports a CALLSIGNS list of 10–15 unique entries', () => {
  // P1.M1 plan: 10–15 curated callsigns per archetype. Uniqueness inside a list
  // matters because `pickCallsign` filters by exclusion — two identical
  // entries would silently double the odds of either being picked.
  for (const [id, list] of Object.entries(CALLSIGNS_BY_ARCHETYPE)) {
    assert.ok(list.length >= 10 && list.length <= 15, `${id} CALLSIGNS size out of [10, 15]`);
    assert.equal(new Set(list).size, list.length, `${id} CALLSIGNS contains duplicates`);
    for (const name of list) {
      assert.equal(typeof name, 'string');
      assert.ok(name.length > 0);
    }
  }
});

test('CALLSIGNS_BY_ARCHETYPE mirrors the per-archetype module exports', () => {
  assert.deepEqual(CALLSIGNS_BY_ARCHETYPE.merc, MERC_CALLSIGNS);
  assert.deepEqual(CALLSIGNS_BY_ARCHETYPE.razor, RAZOR_CALLSIGNS);
});

test('pickCallsign returns a name from the archetype pool', () => {
  const rng = new Rng(1);
  const name = pickCallsign('merc', rng);
  assert.ok(MERC_CALLSIGNS.includes(name), `picked "${name}" not in Merc list`);
});

test('pickCallsign honours an excludeCallsigns Set', () => {
  const rng = new Rng(7);
  const exclude = new Set(MERC_CALLSIGNS.slice(0, MERC_CALLSIGNS.length - 1));
  const name = pickCallsign('merc', rng, exclude);
  assert.equal(name, MERC_CALLSIGNS[MERC_CALLSIGNS.length - 1]);
});

test('pickCallsign crashes when every name is excluded (no silent placeholder)', () => {
  const rng = new Rng(1);
  const exclude = new Set(RAZOR_CALLSIGNS);
  assert.throws(() => pickCallsign('razor', rng, exclude), /no callsigns available/i);
});

test('pickCallsign rejects an unknown archetype', () => {
  assert.throws(() => pickCallsign('wizard', new Rng(0)), /unknown archetype/i);
});

test('pickCallsign rejects a non-Set exclude argument', () => {
  // Easy footgun: pass an Array instead of a Set. `.has` would be undefined
  // and the filter would silently exclude nothing — exactly the silent-
  // fallback shape we're avoiding.
  assert.throws(() => pickCallsign('merc', new Rng(0), ['Tracer']), /must be a Set/i);
});

test('buildCrewMember returns the right archetype class with a populated callsign', () => {
  const rng = new Rng(42);
  const m = buildCrewMember('merc', { x: 3, y: 4 }, rng);
  assert.ok(m instanceof Merc);
  assert.equal(m.x, 3);
  assert.equal(m.y, 4);
  assert.equal(m.faction, FACTION.PLAYER);
  assert.equal(typeof m.callsign, 'string');
  assert.ok(MERC_CALLSIGNS.includes(m.callsign));
  assert.equal(m.flatlined, false);
});

test('buildCrewMember is reproducible from the same Rng seed', () => {
  // Reproducibility is the whole point of threading a seeded Rng through the
  // campaign factory — same seed must yield the same callsign so save/restore
  // never re-rolls names.
  const a = buildCrewMember('razor', { x: 0, y: 0 }, new Rng(123));
  const b = buildCrewMember('razor', { x: 0, y: 0 }, new Rng(123));
  assert.equal(a.callsign, b.callsign);
});

test('buildCrewMember threads excludeCallsigns through pickCallsign', () => {
  const exclude = new Set(MERC_CALLSIGNS.slice(0, MERC_CALLSIGNS.length - 1));
  const m = buildCrewMember('merc', { x: 0, y: 0 }, new Rng(0), {
    excludeCallsigns: exclude,
  });
  assert.equal(m.callsign, MERC_CALLSIGNS[MERC_CALLSIGNS.length - 1]);
});

test('buildCrewMember rejects an unknown archetype', () => {
  assert.throws(() => buildCrewMember('wizard', { x: 0, y: 0 }, new Rng(0)), /unknown archetype/i);
});

test('buildCrewMember rejects a malformed spawn', () => {
  assert.throws(() => buildCrewMember('merc', null, new Rng(0)), /spawn/i);
  assert.throws(() => buildCrewMember('merc', { x: 0 }, new Rng(0)), /spawn/i);
  assert.throws(() => buildCrewMember('merc', { x: NaN, y: 0 }, new Rng(0)), /spawn/i);
});

test('buildCrewMember rejects a missing or invalid rng', () => {
  assert.throws(() => buildCrewMember('merc', { x: 0, y: 0 }), /Rng/i);
  assert.throws(() => buildCrewMember('merc', { x: 0, y: 0 }, {}), /Rng/i);
});

// --- Decker (P3.M2): registered, buildable, but not a starter/recruit pick ---

test('Decker is registered in ARCHETYPES with its OVERRIDE perk metadata', () => {
  const a = ARCHETYPES.decker;
  assert.ok(a, 'missing decker archetype');
  assert.equal(a.id, 'decker');
  assert.equal(a.name, 'DECKER');
  assert.deepEqual(a.perks, ['override']);
  assert.equal(a.perkName, 'OVERRIDE');
  assert.ok(a.perkLabel.length > 0);
});

test('Decker is excluded from the starter selector and the random recruit pool', () => {
  // The Decker joins only via the Act-2 narrative beat — never as a starter
  // pick or a random recruit roll (P3.M2 design constraint).
  assert.ok(!ARCHETYPE_IDS.includes('decker'), 'Decker must not be a selectable starter');
  assert.ok(
    !RECRUIT_ARCHETYPE_POOL.includes('decker'),
    'Decker must not be in the random recruit pool'
  );
});

test('buildCrewMember can still construct a Decker by id (recruitment path)', () => {
  const d = buildCrewMember('decker', { x: 1, y: 2 }, new Rng(9));
  assert.ok(d instanceof Decker);
  assert.equal(isArchetypeId('decker'), true);
  assert.ok(CALLSIGNS_BY_ARCHETYPE.decker.includes(d.callsign));
});

test('isArchetypeId is a string-set membership check', () => {
  assert.equal(isArchetypeId('merc'), true);
  assert.equal(isArchetypeId('razor'), true);
  assert.equal(isArchetypeId('wizard'), false);
  assert.equal(isArchetypeId(null), false);
  assert.equal(isArchetypeId(undefined), false);
  assert.equal(isArchetypeId(7), false);
});
