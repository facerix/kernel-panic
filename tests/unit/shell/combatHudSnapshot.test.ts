import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Berserk } from '../../../src/game/archetypes/Berserk.js';
import { ITEM_ID } from '../../../src/game/items.js';
import type { Run } from '../../../src/game/Run.js';
import { combatHudBodyPanes } from '../../../src/shell/combatHudSnapshot.js';

test('combatHudBodyPanes exposes equipped armor and live shield state for Meatspace crew', () => {
  const crew = new Merc({ id: 'crew-merc', x: 0, y: 0, callsign: 'Vega' });
  crew.applyGear(ITEM_ID.SUBDERMAL_PLATING);
  crew.applyGear(ITEM_ID.PHASE_SHIELD);
  crew.refreshAp();
  const scene = {
    player: crew,
    meatActor: crew,
    activeLayer: 'meat',
    archetype: 'merc',
  } as unknown as Run;

  const panes = combatHudBodyPanes(scene);

  assert.deepEqual(panes.defense, {
    armor: 1,
    shield: { current: 1, capacity: 1 },
  });

  crew.damage(1);
  assert.deepEqual(combatHudBodyPanes(scene).defense, {
    armor: 1,
    shield: { current: 0, capacity: 1 },
  });
});

test('combatHudBodyPanes omits defense readout when no defensive gear is equipped', () => {
  const crew = new Merc({ id: 'crew-merc', x: 0, y: 0 });
  const scene = {
    player: crew,
    meatActor: crew,
    activeLayer: 'meat',
    archetype: 'merc',
  } as unknown as Run;

  assert.equal(combatHudBodyPanes(scene).defense, undefined);
});

test('combatHudBodyPanes exposes the Berserk Surge and Crash windows', () => {
  const crew = new Berserk({ id: 'crew-berserk', x: 0, y: 0, callsign: 'Fury' });
  const scene = {
    player: crew,
    meatActor: crew,
    activeLayer: 'meat',
    archetype: 'berserk',
  } as unknown as Run;

  crew.surge();
  const surgePanes = combatHudBodyPanes(scene);
  assert.equal(surgePanes.identity.surging, true);
  assert.equal(surgePanes.identity.crashing, false);
  assert.deepEqual(surgePanes.ap, { ap: 2, maxAp: 5 }, 'HUD reserves the Surge bonus pip');

  crew.refreshAp();
  assert.deepEqual(
    combatHudBodyPanes(scene).ap,
    { ap: 5, maxAp: 5 },
    'the exact 5/4 smoketest crash is represented as a valid five-pip counter'
  );
  crew.refreshAp();
  assert.equal(combatHudBodyPanes(scene).identity.surging, false);
  assert.equal(combatHudBodyPanes(scene).identity.crashing, true);
  assert.deepEqual(
    combatHudBodyPanes(scene).ap,
    { ap: 2, maxAp: 4 },
    'Crash docks CRASH_AP_PENALTY (2) from the 4-AP budget'
  );
});
