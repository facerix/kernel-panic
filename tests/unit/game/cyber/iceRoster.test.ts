/**
 * P3.M3 — Spark + Guardian ICE and the cyber-grid roster composition.
 *
 * Three distinct silhouettes share the patrol state machine:
 *   - **Probe**  — long-sighted detector, patrols the approach rings.
 *   - **Spark**  — fast/fragile swarm; rides the trace flare, never raises it.
 *   - **Guardian** — heavy node guard; parks on a data node, strikes hard.
 *
 * The roster ties each role to map geometry: one Guardian per data node, a
 * Probe on every other ring, and a difficulty-scaled Spark swarm.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CyberspaceLayer } from '../../../../src/game/cyber/CyberspaceLayer.js';
import { ProbeIce } from '../../../../src/game/cyber/ProbeIce.js';
import { SparkIce } from '../../../../src/game/cyber/SparkIce.js';
import { GuardianIce } from '../../../../src/game/cyber/GuardianIce.js';
import { DataNode } from '../../../../src/game/cyber/DataNode.js';
import { PATROL_STATE } from '../../../../src/game/ai/PatrolHostile.js';
import { Decker } from '../../../../src/game/archetypes/Decker.js';
import { resolveMelee } from '../../../../src/game/Combat.js';
import { Run, RUN_STATE } from '../../../../src/game/Run.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { snapshot, restore } from '../../../../src/game/persistence.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { FACTION, type ContractDifficulty } from '../../../../src/game/constants.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { Rng } from '../../../../src/rng.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';

function buildLayer(
  opts: {
    contractSeed?: number;
    difficulty?: ContractDifficulty;
    nodeCount?: number;
  } = {}
) {
  const { contractSeed = 12345, difficulty = 'standard', nodeCount = 1 } = opts;
  return CyberspaceLayer.build({
    contractSeed,
    difficulty,
    decker: new Decker({ id: 'crew-decker', x: 0, y: 0 }),
    nodeCount,
  });
}

const ofType = <T extends Entity>(layer: CyberspaceLayer, ctor: new (...a: never[]) => T): T[] =>
  Array.from(layer.world.entities.values()).filter((e): e is T => e instanceof ctor);

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

// --- Spark stats ----------------------------------------------------------------------

test('Spark is the fast, fragile swarm attacker', () => {
  const spark = ofType(buildLayer(), SparkIce)[0];
  assert.ok(spark instanceof SparkIce);
  assert.equal(spark.glyph, '×');
  assert.equal(spark.displayName, 'Spark');
  assert.equal(spark.maxHp, 1, 'one swing deletes it');
  assert.equal(spark.maxAp, 4, 'deep AP pool — it closes and bites in one activation');
  assert.equal(spark.sightRange, 6);
  assert.equal(spark.meleeDamage, 1);
  assert.equal(spark.faction, FACTION.CORP);
});

test('Spark rides the trace flare but never raises one', () => {
  const layer = buildLayer();
  const spark = ofType(layer, SparkIce)[0];
  // Move it well clear of the avatar so its own turn cannot acquire a target.
  assert.equal(spark.state, PATROL_STATE.PATROL);
  const before = layer.world.alarmActive;
  // A flare from elsewhere drags the Spark to ENGAGE (it listens for alarms).
  layer.world.raiseAlarm({ target: layer.avatar, repPenalty: false });
  assert.equal(before, false);
  assert.equal(spark.state, PATROL_STATE.ENGAGE, 'the swarm converges on the flare');
  assert.deepEqual(spark.lastKnownTarget, { x: layer.avatar.x, y: layer.avatar.y });
});

// --- Guardian stats -------------------------------------------------------------------

test('Guardian is the heavy node guard that holds station', () => {
  const layer = buildLayer();
  const guardian = ofType(layer, GuardianIce)[0];
  assert.ok(guardian instanceof GuardianIce);
  assert.equal(guardian.glyph, 'Ψ');
  assert.equal(guardian.displayName, 'Guardian');
  assert.equal(guardian.maxHp, 6, 'three avatar swings to break');
  assert.equal(guardian.maxAp, 2, 'limited mobility');
  assert.equal(guardian.sightRange, 5, 'shortest sight — it reacts at its node');
  assert.equal(guardian.meleeDamage, 3);
  assert.equal(guardian.faction, FACTION.CORP);
  assert.equal(guardian.patrolWaypoints.length, 0, 'no patrol — it parks on the prize');

  // It guards a data node: spawned within its node, close to the slice target.
  const node = ofType(layer, DataNode)[0];
  const cheb = Math.max(Math.abs(guardian.x - node.x), Math.abs(guardian.y - node.y));
  assert.ok(cheb <= 3, 'the Guardian stands on the data node it guards');
});

test("Guardian's heavy strike beats ICE resistance", () => {
  const layer = buildLayer();
  const avatar = layer.avatar; // RAM 8, iceResistance 1
  const guardian = ofType(layer, GuardianIce)[0];
  const spot = adjacentFreeTile(layer.world, avatar);
  layer.world.relocateEntity(guardian, spot.x, spot.y);
  guardian.refreshAp();

  const result = resolveMelee(layer.world, guardian, avatar, new Rng(1), { dodgeChance: 0 });
  assert.equal(result.hit, true);
  assert.equal(result.damage, 2, 'dmg 3 vs resist 1 lands 2 — the prize bites back');
  assert.equal(avatar.hp, avatar.maxHp - 2);
});

// --- roster composition ----------------------------------------------------------------

const rosterCounts = (layer: CyberspaceLayer) => ({
  data: ofType(layer, DataNode).length,
  guardians: ofType(layer, GuardianIce).length,
  probes: ofType(layer, ProbeIce).length,
  sparks: ofType(layer, SparkIce).length,
});

test('one Guardian per data node; Probes on the remaining rings', () => {
  for (const [difficulty, nodeCount] of [
    ['standard', 1],
    ['elevated', 2],
    ['critical', 3],
  ] as const) {
    const layer = buildLayer({ difficulty, nodeCount });
    const c = rosterCounts(layer);
    assert.equal(c.data, nodeCount, `${difficulty}: ${nodeCount} data nodes`);
    assert.equal(c.guardians, nodeCount, `${difficulty}: a Guardian per data node`);
    assert.equal(
      c.probes,
      layer.patrolRings.length - nodeCount,
      `${difficulty}: Probes patrol every non-data ring`
    );
  }
});

test('the Spark swarm scales with contract difficulty', () => {
  assert.equal(rosterCounts(buildLayer({ difficulty: 'standard', nodeCount: 1 })).sparks, 1);
  assert.equal(rosterCounts(buildLayer({ difficulty: 'elevated', nodeCount: 1 })).sparks, 2);
  assert.equal(rosterCounts(buildLayer({ difficulty: 'critical', nodeCount: 1 })).sparks, 3);
});

test('no two ICE stack on the same tile', () => {
  const layer = buildLayer({ difficulty: 'critical', nodeCount: 3 });
  const seen = new Set<string>();
  for (const e of layer.world.entities.values()) {
    if (e instanceof ProbeIce || e instanceof SparkIce || e instanceof GuardianIce) {
      const key = `${e.x},${e.y}`;
      assert.ok(!seen.has(key), `two ICE share tile ${key}`);
      seen.add(key);
    }
  }
});

test('the full ICE roster is deterministic on the contract seed', () => {
  const key = (layer: CyberspaceLayer) =>
    Array.from(layer.world.entities.values())
      .filter(e => e instanceof ProbeIce || e instanceof SparkIce || e instanceof GuardianIce)
      .map(e => ({ id: e.id, x: e.x, y: e.y }))
      .sort((a, b) => a.id.localeCompare(b.id));
  const a = key(buildLayer({ contractSeed: 555, difficulty: 'critical', nodeCount: 3 }));
  const b = key(buildLayer({ contractSeed: 555, difficulty: 'critical', nodeCount: 3 }));
  assert.deepEqual(a, b);
  const c = key(buildLayer({ contractSeed: 556, difficulty: 'critical', nodeCount: 3 }));
  assert.notDeepEqual(a, c, 'a different seed diverges');
});

// --- persistence ----------------------------------------------------------------------

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

function jackedInLayer(seed = 12345): { run: Run; layer: CyberspaceLayer } {
  const run = new Run({
    crewMember: buildCrewMember('decker', { x: 0, y: 0 }, new Rng(100), { id: 'crew-decker' }),
    seed,
  });
  run.enterBriefing(cyberContract(seed));
  run.enterCombat();
  const point = Array.from(run.world!.entities.values()).find(
    e => e instanceof JackInPoint
  ) as JackInPoint;
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  assert.equal(point.interact(run.world!, run.player!).ok, true);
  assert.equal(run.state, RUN_STATE.COMBAT);
  const layer = (run.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
  return { run, layer };
}

test('Spark and Guardian patrol state round-trips and re-binds', () => {
  const { run, layer } = jackedInLayer();
  const spark = ofType(layer, SparkIce)[0];
  const guardian = ofType(layer, GuardianIce)[0];

  // Dirty both state machines.
  spark.state = PATROL_STATE.ENGAGE;
  spark.lastKnownTarget = { x: layer.avatar.x, y: layer.avatar.y };
  guardian.state = PATROL_STATE.INVESTIGATE;
  guardian.lastKnownTarget = { x: layer.entryTile.x, y: layer.entryTile.y };
  guardian.damage(2);

  const { run: restored } = restore(structuredClone(snapshot(run)));
  const restoredLayer = (restored.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;

  const sparkTwin = ofType(restoredLayer, SparkIce).find(e => e.id === spark.id);
  const guardianTwin = ofType(restoredLayer, GuardianIce).find(e => e.id === guardian.id);
  assert.ok(sparkTwin instanceof SparkIce);
  assert.ok(guardianTwin instanceof GuardianIce);
  assert.equal(sparkTwin!.state, PATROL_STATE.ENGAGE);
  assert.deepEqual(sparkTwin!.lastKnownTarget, spark.lastKnownTarget);
  assert.equal(guardianTwin!.state, PATROL_STATE.INVESTIGATE);
  assert.equal(guardianTwin!.hp, guardian.hp);
  assert.equal(guardianTwin!.maxHp, 6);

  // Re-binding: a fresh cyber flare drags the restored Spark to ENGAGE.
  sparkTwin!.state = PATROL_STATE.PATROL;
  sparkTwin!.lastKnownTarget = null;
  restoredLayer.world.raiseAlarm({ target: restoredLayer.avatar, repPenalty: false });
  assert.equal(sparkTwin!.state, PATROL_STATE.ENGAGE, 'restored Spark still listens for flares');
});
