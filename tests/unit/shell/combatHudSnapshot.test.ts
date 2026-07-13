import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Merc } from '../../../src/game/archetypes/Merc.js';
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
