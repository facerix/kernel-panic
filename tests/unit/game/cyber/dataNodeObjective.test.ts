/**
 * P3.M3.4 — the data-node-slice objective wired through the Run.
 *
 * `CyberspaceLayer.build` spawns the contract's `count` nodes on the far
 * node tiles; satisfaction counts sliced nodes (active), the resolved latch
 * (jacked out), or zero (dormant). Jack-out before slicing leaves the
 * objective permanently unsatisfiable — extraction stays gated through the
 * existing abort-confirm flow. Node slice progress round-trips persistence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run } from '../../../../src/game/Run.js';
import { CyberspaceLayer } from '../../../../src/game/cyber/CyberspaceLayer.js';
import { DataNode, sliceDifficultyFor } from '../../../../src/game/cyber/DataNode.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { snapshot, restore } from '../../../../src/game/persistence.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { Rng } from '../../../../src/rng.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';
import type { RunEntitySnapshot, RunSnapshot } from '../../../../src/game/Run.js';
import type { ContractDifficulty } from '../../../../src/game/constants.js';

const cyberContract = (seed = 12345, difficulty: ContractDifficulty = 'standard', count = 1) => ({
  seed,
  objective: {
    kind: OBJECTIVES.DATA_NODE_SLICE,
    title: 'Spike the server farm',
    briefing: 'Jack in, slice the data node, then extract.',
    params: { requiresCyberspace: true, count },
  },
  difficulty,
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

function combatRun(seed = 12345, difficulty: ContractDifficulty = 'standard', count = 1) {
  const run = new Run({ crewMember: makeDecker(), seed });
  run.enterBriefing(cyberContract(seed, difficulty, count));
  run.enterCombat();
  return run;
}

function jackIn(run: Run): CyberspaceLayer {
  const point = Array.from(run.world!.entities.values()).find(
    e => e instanceof JackInPoint
  ) as JackInPoint;
  assert.ok(point, 'cyber contract placed a jack-in point');
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  assert.equal(point.interact(run.world!, run.player!).ok, true);
  assert.equal(run.cyberspace?.phase, 'active');
  return (run.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
}

function layerNodes(layer: CyberspaceLayer): DataNode[] {
  return Array.from(layer.world.entities.values()).filter(
    (e): e is DataNode => e instanceof DataNode
  );
}

/** Walk the avatar adjacent to `node` and interact until it slices. */
function sliceNode(layer: CyberspaceLayer, node: DataNode): void {
  while (!node.sliced) {
    const spot = adjacentFreeTile(layer.world, node);
    layer.world.relocateEntity(layer.avatar, spot.x, spot.y);
    layer.avatar.refreshAp();
    const result = node.interact(layer.world, layer.avatar);
    assert.equal(result.ok, true, `slice attempt failed: ${result.message}`);
  }
}

/** Walk the avatar back to the exit port and route out. */
function routeOut(layer: CyberspaceLayer): void {
  const spot = adjacentFreeTile(layer.world, layer.port);
  layer.world.relocateEntity(layer.avatar, spot.x, spot.y);
  layer.avatar.refreshAp();
  const result = layer.port.interact(layer.world, layer.avatar);
  assert.equal(result.ok, true, `jack-out failed: ${result.message}`);
}

function cyberEntities(record: RunSnapshot): RunEntitySnapshot[] {
  const block = record.cyberspace as unknown as Record<string, unknown>;
  return block.entities as RunEntitySnapshot[];
}

// --- node spawning ------------------------------------------------------------------

test('build spawns the contract count of data nodes with the difficulty threshold', () => {
  const layer = jackIn(combatRun(4242, 'standard', 1));
  const nodes = layerNodes(layer);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].sliceDifficulty, sliceDifficultyFor('standard'));
  assert.equal(nodes[0].sliced, false);
  // The node spawned on a passable tile away from the entry point.
  assert.ok(layer.world.grid.isPassable(nodes[0].x, nodes[0].y));
  const cheb = Math.max(
    Math.abs(nodes[0].x - layer.entryTile.x),
    Math.abs(nodes[0].y - layer.entryTile.y)
  );
  assert.ok(cheb > 1, 'node does not crowd the entry tile');
});

test('multi-node contracts spawn distinct nodes on distinct tiles', () => {
  const layer = jackIn(combatRun(4242, 'critical', 3));
  const nodes = layerNodes(layer);
  assert.equal(nodes.length, 3);
  const tiles = new Set(nodes.map(n => `${n.x},${n.y}`));
  assert.equal(tiles.size, 3);
  const ids = new Set(nodes.map(n => n.id));
  assert.equal(ids.size, 3);
  for (const node of nodes) {
    assert.equal(node.sliceDifficulty, sliceDifficultyFor('critical'));
  }
});

test('node placement is deterministic per contract seed', () => {
  const a = layerNodes(jackIn(combatRun(909, 'elevated', 2)));
  const b = layerNodes(jackIn(combatRun(909, 'elevated', 2)));
  assert.deepEqual(
    a.map(n => ({ id: n.id, x: n.x, y: n.y })),
    b.map(n => ({ id: n.id, x: n.x, y: n.y }))
  );
});

test('a node count beyond the map anchors throws at build', () => {
  assert.throws(
    () =>
      CyberspaceLayer.build({
        contractSeed: 1,
        difficulty: 'standard',
        decker: makeDecker(),
        nodeCount: 99,
      }),
    /nodeCount|node tiles/
  );
});

// --- satisfaction --------------------------------------------------------------------

test('dormant: objective unsatisfied, extraction gated, chip shows 0 of count', () => {
  const run = combatRun();
  assert.equal(run.cyberspace?.phase, 'dormant');
  assert.equal(run.isObjectiveSatisfied(), false);
  assert.equal(run.canExtract(), false);
  assert.deepEqual(run.objectiveProgress(), { label: 'NODES', current: 0, total: 1 });
});

test('active: slicing the node satisfies the objective and fills the chip', () => {
  const run = combatRun();
  const layer = jackIn(run);
  assert.equal(run.isObjectiveSatisfied(), false);
  assert.deepEqual(run.objectiveProgress(), { label: 'NODES', current: 0, total: 1 });

  sliceNode(layer, layerNodes(layer)[0]);
  assert.equal(run.isObjectiveSatisfied(), true);
  assert.equal(run.canExtract(), true);
  assert.deepEqual(run.objectiveProgress(), { label: 'NODES', current: 1, total: 1 });
});

test('multi-node: every node must slice', () => {
  const run = combatRun(4242, 'critical', 3);
  const layer = jackIn(run);
  const nodes = layerNodes(layer);
  sliceNode(layer, nodes[0]);
  assert.equal(run.isObjectiveSatisfied(), false);
  assert.deepEqual(run.objectiveProgress(), { label: 'NODES', current: 1, total: 3 });
  sliceNode(layer, nodes[1]);
  sliceNode(layer, nodes[2]);
  assert.equal(run.isObjectiveSatisfied(), true);
});

test('jack-out after slicing latches objectiveComplete: true', () => {
  const run = combatRun();
  const layer = jackIn(run);
  sliceNode(layer, layerNodes(layer)[0]);
  routeOut(layer);
  assert.deepEqual(run.cyberspace, { phase: 'resolved', objectiveComplete: true });
  assert.equal(run.isObjectiveSatisfied(), true);
  assert.equal(run.canExtract(), true);
});

test('jack-out before slicing latches false — permanently unsatisfiable', () => {
  const run = combatRun();
  const layer = jackIn(run);
  assert.equal(layer.port.interact(layer.world, layer.avatar).ok, true);
  assert.deepEqual(run.cyberspace, { phase: 'resolved', objectiveComplete: false });
  assert.equal(run.isObjectiveSatisfied(), false);
  assert.equal(run.canExtract(), false, 'clean extraction stays gated (abort flow)');
  assert.deepEqual(run.objectiveProgress(), { label: 'NODES', current: 0, total: 1 });
});

// --- persistence ---------------------------------------------------------------------

test('mid-slice progress round-trips and finishes after restore', () => {
  const run = combatRun(777, 'elevated', 1); // threshold 3, base intrusion 2
  const layer = jackIn(run);
  const node = layerNodes(layer)[0];
  const spot = adjacentFreeTile(layer.world, node);
  layer.world.relocateEntity(layer.avatar, spot.x, spot.y);
  layer.avatar.refreshAp();
  assert.equal(node.interact(layer.world, layer.avatar).ok, true);
  assert.equal(node.sliceProgress, 2);
  assert.equal(node.sliced, false);

  const record = structuredClone(snapshot(run));
  const { run: restored } = restore(record);
  assert.equal(restored.cyberspace?.phase, 'active');
  const restoredLayer = (restored.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
  const restoredNode = layerNodes(restoredLayer)[0];
  assert.equal(restoredNode.sliceProgress, 2);
  assert.equal(restoredNode.sliceDifficulty, 3);
  assert.equal(restoredNode.sliced, false);
  assert.equal(restored.isObjectiveSatisfied(), false);

  sliceNode(restoredLayer, restoredNode);
  assert.equal(restored.isObjectiveSatisfied(), true);
});

test('a sliced node round-trips as sliced', () => {
  const run = combatRun();
  const layer = jackIn(run);
  sliceNode(layer, layerNodes(layer)[0]);

  const { run: restored } = restore(structuredClone(snapshot(run)));
  const restoredLayer = (restored.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
  assert.equal(layerNodes(restoredLayer)[0].sliced, true);
  assert.equal(restored.isObjectiveSatisfied(), true);
});

test('the resolved latch round-trips satisfaction both ways', () => {
  for (const complete of [true, false]) {
    const run = combatRun();
    const layer = jackIn(run);
    if (complete) sliceNode(layer, layerNodes(layer)[0]);
    routeOut(layer);

    const { run: restored } = restore(structuredClone(snapshot(run)));
    assert.deepEqual(restored.cyberspace, { phase: 'resolved', objectiveComplete: complete });
    assert.equal(restored.isObjectiveSatisfied(), complete);
  }
});

// --- adversarial restore --------------------------------------------------------------

test('an active block missing its data nodes throws', () => {
  const run = combatRun();
  jackIn(run);
  const record = structuredClone(snapshot(run));
  const block = record.cyberspace as unknown as Record<string, unknown>;
  block.entities = cyberEntities(record).filter(e => e.archetype !== 'data-node');
  assert.throws(() => restore(record), /data.node/i);
});

test('a node-count mismatch against the contract throws', () => {
  const run = combatRun();
  jackIn(run);
  const record = structuredClone(snapshot(run));
  const block = record.cyberspace as unknown as Record<string, unknown>;
  const node = cyberEntities(record).find(e => e.archetype === 'data-node')!;
  const clone = structuredClone(node);
  clone.id = 'data-node-rogue';
  clone.x = node.x + 1;
  (block.entities as RunEntitySnapshot[]).push(clone);
  assert.throws(() => restore(record), /data.node/i);
});

test('malformed node extras throw', () => {
  const base = () => {
    const run = combatRun();
    jackIn(run);
    return structuredClone(snapshot(run));
  };

  const missingDifficulty = base();
  const node1 = cyberEntities(missingDifficulty).find(e => e.archetype === 'data-node')!;
  delete (node1.extra as Record<string, unknown>).sliceDifficulty;
  assert.throws(() => restore(missingDifficulty), /sliceDifficulty/);

  const negativeProgress = base();
  const node2 = cyberEntities(negativeProgress).find(e => e.archetype === 'data-node')!;
  (node2.extra as Record<string, unknown>).sliceProgress = -1;
  assert.throws(() => restore(negativeProgress), /sliceProgress/);
});
