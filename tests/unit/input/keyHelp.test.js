/**
 * `<key-help>` reads its rows from `src/input/keyHelp.js`. The rows are hand
 * authored (keymap.js doesn't expose its bindings as data — it uses switch
 * blocks), so we use these tests as a *drift guard* against the real keymap:
 *
 *   - Every advertised key must actually be handled by `dispatch(key, IDLE)`
 *     — otherwise the help panel teaches the player a lie.
 *   - A sentinel of known keymap keys must each appear in `HELP_ROWS` — so
 *     when a future milestone adds a binding to keymap.js, this test fails
 *     until the help rows catch up.
 *
 * The scope filter (`hub` / `combat`) is asserted directly; the help panel
 * uses it to suppress combat-only rows in the Hub and vice versa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeKeymap, HELP_ROWS } from '../../../src/input/keyHelp.js';
import { dispatch, MODE } from '../../../src/input/keymap.js';

const SCOPES = new Set(['hub', 'combat', 'both']);
const GROUPS = new Set(['move', 'action', 'system']);

test('every HELP_ROWS entry has the required shape', () => {
  assert.ok(HELP_ROWS.length > 0, 'HELP_ROWS must not be empty');
  for (const row of HELP_ROWS) {
    assert.ok(Array.isArray(row.keys) && row.keys.length > 0, `row ${row.label}: keys[] required`);
    for (const k of row.keys) {
      assert.equal(typeof k, 'string', `row ${row.label}: key must be a string`);
      assert.ok(k.length > 0, `row ${row.label}: empty key`);
    }
    assert.equal(typeof row.label, 'string');
    assert.ok(row.label.length > 0, 'label must be non-empty');
    assert.ok(SCOPES.has(row.scope), `scope "${row.scope}" not in ${[...SCOPES].join(',')}`);
    assert.ok(GROUPS.has(row.group), `group "${row.group}" not in ${[...GROUPS].join(',')}`);
  }
});

test('every advertised key is actually handled by the keymap dispatcher', () => {
  for (const row of HELP_ROWS) {
    for (const key of row.keys) {
      // `?` is a UI-only key handled at shell level, not in the game keymap.
      // Other rows should round-trip through dispatch.
      if (key === '?') continue;
      const r = dispatch(key, MODE.IDLE);
      const handled = r.intent !== null || r.nextMode !== MODE.IDLE;
      assert.ok(
        handled,
        `help row "${row.label}" advertises key "${key}" but keymap dispatch returns idle no-op`
      );
    }
  }
});

test('describeKeymap("hub") returns only hub-scoped and both-scoped rows', () => {
  const rows = describeKeymap('hub');
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(['hub', 'both'].includes(r.scope), `hub view leaked scope "${r.scope}"`);
  }
});

test('describeKeymap("combat") returns only combat-scoped and both-scoped rows', () => {
  const rows = describeKeymap('combat');
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(['combat', 'both'].includes(r.scope), `combat view leaked scope "${r.scope}"`);
  }
});

test('describeKeymap rejects unknown scope (crash > silent fallback)', () => {
  assert.throws(() => describeKeymap('foo'), /unknown scope/i);
});

test('drift guard: every key handled by keymap.js dispatch appears in HELP_ROWS', () => {
  // Sentinel mirrors the keys explicitly handled inside `dispatchIdle` and
  // its direction table. If keymap.js grows a new binding, add it here AND
  // to HELP_ROWS; the test fails loudly when they're out of sync.
  const sentinel = [
    // movement (orthogonal + diagonal + WASD)
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'w',
    'a',
    's',
    'd',
    'q',
    'e',
    'z',
    'c',
    // action / aim
    'f',
    'm',
    'x',
    ' ',
    // system
    '.',
    'Escape',
    'Q',
  ];
  const helpKeys = new Set(HELP_ROWS.flatMap(r => r.keys));
  for (const k of sentinel) {
    assert.ok(helpKeys.has(k), `keymap handles "${k}" but HELP_ROWS has no row for it`);
  }
});

test("'?' is in HELP_ROWS as a system-scope row", () => {
  // '?' is the help toggle itself — it must self-document.
  const help = HELP_ROWS.find(r => r.keys.includes('?'));
  assert.ok(help, "HELP_ROWS must include a row for the '?' help toggle");
  assert.equal(help.group, 'system');
  assert.equal(help.scope, 'both');
});

test('unified `x` perk key has a help row labelled as the archetype perk', () => {
  // Phase-2 M1 collapsed Vault and Slide into a single SPECIAL aim mode that
  // dispatches by archetype at intent-apply time. The help row must surface
  // that to the player — generic "Special action" copy is fine; the live
  // verb (Vault / Slide / Deploy) shows up in the on-screen log.
  const row = HELP_ROWS.find(r => r.keys.includes('x'));
  assert.ok(row, "HELP_ROWS must include a row for the 'x' perk key");
  assert.ok(
    /special/i.test(row.label),
    `expected 'x' row to mention "special", got "${row.label}"`
  );
});
