import { test } from 'node:test';
import assert from 'node:assert/strict';

import { entityLabel } from '../../../src/game/Entity.js';
import { FACTION } from '../../../src/game/constants.js';

test('entityLabel renders [principalTag]displayName for an aliased hostile', () => {
  assert.equal(
    entityLabel({
      id: 'drone-0',
      faction: FACTION.CORP,
      displayName: 'Auditor',
      principalTag: 'Matsuda',
    }),
    '[Matsuda]Auditor'
  );
});

test('entityLabel renders a bare displayName when no principalTag applies', () => {
  assert.equal(
    entityLabel({ id: 'drone-0', faction: FACTION.CORP, displayName: 'Auditor' }),
    'Auditor'
  );
});

test('entityLabel falls back to legacy [Faction]Kind for un-aliased entities', () => {
  assert.equal(entityLabel({ id: 'drone-0', faction: FACTION.CORP }), '[Corp]Drone');
  assert.equal(entityLabel({ id: 'guard-2', faction: FACTION.CORP }), '[Corp]Guard');
});

test('callsign takes priority over a stored display identity', () => {
  assert.equal(
    entityLabel({
      id: 'crew-merc',
      faction: FACTION.PLAYER,
      callsign: 'Vega',
      displayName: 'should-be-ignored',
      principalTag: 'Nope',
    }),
    'Vega'
  );
});
