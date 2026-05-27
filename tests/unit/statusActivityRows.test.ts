import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recordStatusActionLine, statusActionRows } from '../../src/statusActivityRows.js';

test('statusActionRows keeps a terminal interaction burst visible oldest-to-newest', () => {
  let history: string[] = [];

  history = recordStatusActionLine(history, '> Checkpoint door unlocked - passage open.');
  history = recordStatusActionLine(history, '> REP -5: facility alarm triggered.');
  history = recordStatusActionLine(history, 'Access terminal sliced - alarm tripped.');

  assert.deepEqual(statusActionRows(history, 3, true), [
    {
      source: 'action',
      text: 'Checkpoint door unlocked - passage open. / REP -5: facility alarm triggered.',
    },
    { source: 'action', text: 'Access terminal sliced - alarm tripped.' },
  ]);
});

test('recordStatusActionLine treats an empty flash as the newest cleared row', () => {
  let history: string[] = [];

  history = recordStatusActionLine(history, 'Old result');
  history = recordStatusActionLine(history, '');

  assert.deepEqual(statusActionRows(history, 1, false), [
    { source: 'action', text: 'Old result' },
    { source: 'action', text: '' },
  ]);
});

test('statusActionRows lets a single fresh action share the HUD with an ephemeral hint', () => {
  const history = recordStatusActionLine([], 'Access terminal sliced.');

  assert.deepEqual(statusActionRows(history, 1, true), [
    { source: 'ephemeral', text: '' },
    { source: 'action', text: 'Access terminal sliced.' },
  ]);
});
