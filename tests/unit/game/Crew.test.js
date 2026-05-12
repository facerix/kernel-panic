/**
 * Crew base-class tests.
 *
 * Crew slots between `Entity` and the archetype classes. The behavioural
 * surface in M1 is small (callsign, flatlined, inventory/gear stubs) but the
 * contract is load-bearing: M2's Campaign reads `flatlined` to decide when to
 * end the run, M3's inventory lookup assumes the stub shape, etc. Anything
 * that drifts here corrupts campaign state silently — so we lean into
 * defensive constructor validation and pin it with tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Crew } from '../../../src/game/Crew.js';
import { Entity } from '../../../src/game/Entity.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Razor } from '../../../src/game/archetypes/Razor.js';
import { FACTION } from '../../../src/game/constants.js';

const baseProps = { id: 'c', x: 0, y: 0, faction: FACTION.PLAYER };

test('Crew extends Entity', () => {
  const c = new Crew({ ...baseProps });
  assert.ok(c instanceof Entity);
});

test('Crew defaults: callsign null, flatlined false, inventory null, gear null', () => {
  const c = new Crew({ ...baseProps });
  assert.equal(c.callsign, null);
  assert.equal(c.flatlined, false);
  assert.equal(c.inventory, null);
  assert.equal(c.gear, null);
});

test('Crew accepts a callsign string and exposes it', () => {
  const c = new Crew({ ...baseProps, callsign: 'Glitch' });
  assert.equal(c.callsign, 'Glitch');
});

test('Crew rejects an empty-string callsign (crash > silent fallback)', () => {
  assert.throws(() => new Crew({ ...baseProps, callsign: '' }), /callsign/i);
});

test('Crew rejects a non-string, non-null callsign', () => {
  assert.throws(() => new Crew({ ...baseProps, callsign: 42 }), /callsign/i);
  assert.throws(() => new Crew({ ...baseProps, callsign: {} }), /callsign/i);
});

test('Crew rejects a non-boolean flatlined', () => {
  assert.throws(() => new Crew({ ...baseProps, flatlined: 'no' }), /flatlined/i);
  assert.throws(() => new Crew({ ...baseProps, flatlined: 1 }), /flatlined/i);
});

test('Crew passes through Entity validation (e.g. integer x,y)', () => {
  // Belt-and-braces: Crew's super() call must not eat Entity's error.
  assert.throws(() => new Crew({ ...baseProps, x: 1.5 }), /integer/i);
});

test('Merc extends Crew and accepts a callsign through the constructor', () => {
  const m = new Merc({ id: 'm', x: 0, y: 0, callsign: 'Tracer' });
  assert.ok(m instanceof Crew);
  assert.equal(m.callsign, 'Tracer');
  assert.equal(m.flatlined, false);
});

test('Merc constructed without a callsign defaults to null (back-compat path)', () => {
  // buildPlayer (legacy entry) does not supply a callsign; the migration
  // must not break that path.
  const m = new Merc({ id: 'm', x: 0, y: 0 });
  assert.equal(m.callsign, null);
});

test('Razor extends Crew and accepts a callsign through the constructor', () => {
  const r = new Razor({ id: 'r', x: 0, y: 0, callsign: 'Cipher' });
  assert.ok(r instanceof Crew);
  assert.equal(r.callsign, 'Cipher');
  assert.equal(r.flatlined, false);
});

test('Razor constructed without a callsign defaults to null (back-compat path)', () => {
  const r = new Razor({ id: 'r', x: 0, y: 0 });
  assert.equal(r.callsign, null);
});
