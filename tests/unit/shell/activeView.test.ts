import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run } from '../../../src/game/Run.js';
import { CyberspaceLayer } from '../../../src/game/cyber/CyberspaceLayer.js';
import { JackInPoint } from '../../../src/game/entities/JackInPoint.js';
import { VisionField } from '../../../src/game/Vision.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from '../game/contractTestUtils.js';
import {
  activeActorOf,
  activeTileset,
  activeWorldOf,
  cyberLayerOf,
  isJackedIn,
  isRunScene,
  pickActiveVisionField,
} from '../../../src/shell/activeView.js';
import type { World } from '../../../src/game/World.js';
import type { Entity } from '../../../src/game/Entity.js';

const cyberContract = (seed = 12345) => ({
  seed,
  objective: {
    kind: OBJECTIVES.DATA_NODE_SLICE,
    title: 'Spike the server farm',
    briefing: 'Jack in, slice the data node, then extract.',
    params: { requiresCyberspace: true, count: 1 },
  },
  difficulty: 'standard',
  threatCount: 1,
  label: 'cyber test job',
  context: testContractContext(OBJECTIVES.DATA_NODE_SLICE),
  reward: { credits: 0, repDelta: 0 },
});

function makeDecker() {
  return buildCrewMember('decker', { x: 0, y: 0 }, new Rng(100), { id: 'crew-decker' });
}

function adjacentFreeTile(world: World, target: Entity) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = target.x + dx;
      const y = target.y + dy;
      if (world.grid.inBounds(x, y) && world.grid.isPassable(x, y) && !world.entityAt(x, y)) {
        return { x, y };
      }
    }
  }
  throw new Error(`no free tile adjacent to ${target.id}`);
}

function combatRun(seed = 12345) {
  const run = new Run({ crewMember: makeDecker(), seed });
  run.enterBriefing(cyberContract(seed));
  run.enterCombat();
  return run;
}

function jackIn(run: Run): CyberspaceLayer {
  const point = Array.from(run.world!.entities.values()).find(e => e instanceof JackInPoint);
  assert.ok(point, 'cyber contract placed a jack-in point');
  const spot = adjacentFreeTile(run.world!, point!);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  assert.equal((point as JackInPoint).interact(run.world!, run.player!).ok, true);
  return (run.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
}

test('isRunScene distinguishes Run from hub-shaped stubs', () => {
  const run = combatRun();
  assert.equal(isRunScene(run), true);
  assert.equal(isRunScene({ world: null, player: null }), false);
});

test('active view reads meat body before jack-in', () => {
  const run = combatRun();
  assert.equal(isJackedIn(run), false);
  assert.equal(activeWorldOf(run), run.world);
  assert.equal(activeActorOf(run), run.player);
  assert.equal(activeTileset(run), 'meat');
  assert.equal(cyberLayerOf(run), null);
});

test('active view swaps to cyber layer after jack-in', () => {
  const run = combatRun();
  const layer = jackIn(run);
  assert.equal(isJackedIn(run), true);
  assert.equal(activeWorldOf(run), layer.world);
  assert.equal(activeActorOf(run), layer.avatar);
  assert.equal(activeTileset(run), 'cyber');
  assert.equal(cyberLayerOf(run), layer);
  assert.notEqual(activeWorldOf(run), run.world);
  assert.notEqual(activeActorOf(run), run.player);
});

test('pickActiveVisionField selects meat or cyber fog', () => {
  const run = combatRun();
  const meatVision = new VisionField();
  const cyberVision = new VisionField();
  assert.equal(pickActiveVisionField(run, meatVision, cyberVision), meatVision);
  jackIn(run);
  assert.equal(pickActiveVisionField(run, meatVision, cyberVision), cyberVision);
});
