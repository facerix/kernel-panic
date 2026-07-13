import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseUpdateRelease, requiresUpdateAcknowledgement } from '../../src/updateRelease.js';

const active = parseUpdateRelease({
  version: '1.0.0',
  shellEpoch: 2,
  title: 'Active release',
  highlights: ['Already installed'],
});

test('same shell epoch keeps an update deferrable', () => {
  const pending = parseUpdateRelease({
    version: '1.1.0',
    shellEpoch: 2,
    title: 'Compatible release',
    highlights: ['New contract'],
  });
  assert.equal(requiresUpdateAcknowledgement(active, pending), false);
});

test('higher shell epoch requires acknowledgement before continuing', () => {
  const pending = parseUpdateRelease({
    version: '2.0.0',
    shellEpoch: 3,
    title: 'Breaking release',
    highlights: ['App shell replaced'],
  });
  assert.equal(requiresUpdateAcknowledgement(active, pending), true);
});

test('older pending shell epoch is rejected as a deployment error', () => {
  const pending = parseUpdateRelease({
    version: '0.9.0',
    shellEpoch: 1,
    title: 'Downgrade',
    highlights: ['Old shell'],
  });
  assert.throws(
    () => requiresUpdateAcknowledgement(active, pending),
    /pending shell epoch 1 is older than active epoch 2/
  );
});

test('release metadata rejects empty or malformed fields', () => {
  assert.throws(
    () => parseUpdateRelease({ version: '', shellEpoch: 1, title: 'Bad', highlights: ['x'] }),
    /version/
  );
  assert.throws(
    () => parseUpdateRelease({ version: '1', shellEpoch: 0, title: 'Bad', highlights: ['x'] }),
    /shellEpoch/
  );
  assert.throws(
    () => parseUpdateRelease({ version: '1', shellEpoch: 1, title: 'Bad', highlights: [] }),
    /highlights/
  );
});
