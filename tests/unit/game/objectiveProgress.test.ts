import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { EventBus } from '../../../src/game/events.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import {
  formatObjectiveProgressTag,
  objectiveProgress,
  sweepObjectiveProgress,
} from '../../../src/game/objectiveProgress.js';
import { TILE } from '../../../src/game/constants.js';
import { testContractContext } from './contractTestUtils.js';
import type { Contract } from '../../../src/game/hub/Curator.js';

function makeGrid(w = 12, h = 12): Grid {
  const grid = new Grid(w, h, TILE.WALL);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  return grid;
}

function makeWorld(w = 12, h = 12): World {
  return new World(makeGrid(w, h), { events: new EventBus() });
}

function makeSweepContract(target: string): Contract {
  return {
    seed: 42,
    objective: {
      kind: OBJECTIVES.SWEEP,
      title: 'Sweep test',
      briefing: 'Clear targets.',
      params: { target },
    },
    difficulty: 'standard',
    threatCount: 2,
    label: '// Test sweep',
    context: testContractContext(OBJECTIVES.SWEEP),
    reward: { credits: 50, repDelta: 5 },
  };
}

test('objectiveProgress returns null for objectives without a meter', () => {
  const world = makeWorld();
  const contract: Contract = {
    seed: 1,
    objective: {
      kind: OBJECTIVES.REACH_EXIT,
      title: 'Exit',
      briefing: 'Reach the exit.',
    },
    difficulty: 'standard',
    threatCount: 2,
    label: '// Exit',
    context: testContractContext(OBJECTIVES.REACH_EXIT),
    reward: { credits: 10, repDelta: 1 },
  };
  assert.equal(objectiveProgress(contract, world, []), null);
});

test('objectiveProgress unifies sweep tally', () => {
  const world = makeWorld();
  const d0 = new Skirmisher({ id: 'drone-0', x: 3, y: 3 });
  const d1 = new Skirmisher({ id: 'drone-1', x: 5, y: 5 });
  world.addEntity(d0);
  world.addEntity(d1);
  const contract = makeSweepContract('hostile-all');

  assert.deepEqual(objectiveProgress(contract, world, []), {
    label: 'SWEEP',
    current: 0,
    total: 2,
  });
  d0.damage(d0.maxHp);
  assert.deepEqual(sweepObjectiveProgress(contract, world), { cleared: 1, total: 2 });
  assert.deepEqual(objectiveProgress(contract, world, []), {
    label: 'SWEEP',
    current: 1,
    total: 2,
  });
});

test('formatObjectiveProgressTag renders bracketed meter copy', () => {
  assert.equal(
    formatObjectiveProgressTag({ label: 'MAP', current: 4, total: 10 }),
    ' <span class="todo">[MAP:4/10]</span>'
  );
  assert.equal(formatObjectiveProgressTag(null), '');
});
