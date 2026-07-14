/**
 * P3.M3.3 — Cyberspace persistence: the heart of the slice.
 *
 * A mid-jack-in snapshot must round-trip the cyber grid, avatar pools, alarm,
 * and map memory exactly; the restored run re-wires its cyber listeners.
 * Malformed blocks throw (crash > data corruption): missing fields, OOB or
 * duplicated avatars, half-populated Decker cyber stats in *both* crew paths.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME } from '../../../../src/game/Run.js';
import { CyberspaceLayer } from '../../../../src/game/cyber/CyberspaceLayer.js';
import { CyberAvatar } from '../../../../src/game/cyber/CyberAvatar.js';
import { EntryPort } from '../../../../src/game/cyber/EntryPort.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { Decker } from '../../../../src/game/archetypes/Decker.js';
import { ProbeIce } from '../../../../src/game/cyber/ProbeIce.js';
import { applyOverride } from '../../../../src/game/mindInfluence.js';
import { Campaign } from '../../../../src/game/Campaign.js';
import { EVENT } from '../../../../src/game/events.js';
import {
  snapshot,
  restore,
  snapshotCampaign,
  restoreCampaign,
} from '../../../../src/game/persistence.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import {
  DECKER_BASE_ICE_RESISTANCE,
  DECKER_BASE_INTRUSION,
  DECKER_BASE_RAM,
  TILE,
  FACTION,
} from '../../../../src/game/constants.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { Rng } from '../../../../src/rng.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';
import type { RunEntitySnapshot, RunSnapshot, RunResult } from '../../../../src/game/Run.js';

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

function activeRun(seed = 12345, hooks: { onResult?: (r: RunResult) => void } = {}) {
  const run = new Run({ crewMember: makeDecker(), seed, ...hooks });
  run.enterBriefing(cyberContract(seed));
  run.enterCombat();
  const point = Array.from(run.world!.entities.values()).find(
    e => e instanceof JackInPoint
  ) as JackInPoint;
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  assert.equal(point.interact(run.world!, run.player!).ok, true);
  assert.equal(run.cyberspace?.phase, 'active');
  return run;
}

function layerOf(run: Run): CyberspaceLayer {
  assert.equal(run.cyberspace?.phase, 'active');
  return (run.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
}

function activeRecord(seed = 12345): RunSnapshot {
  const run = activeRun(seed);
  const layer = layerOf(run);
  // Dirty the layer so the round-trip carries real state.
  const dest = adjacentFreeTile(layer.world, layer.avatar);
  layer.world.relocateEntity(layer.avatar, dest.x, dest.y);
  layer.avatar.spendAp(1);
  layer.avatar.damage(2);
  layer.recordSeen([
    `${layer.entryTile.x},${layer.entryTile.y}`,
    `${layer.avatar.x},${layer.avatar.y}`,
  ]);
  layer.world.raiseAlarm({ repPenalty: false });
  return structuredClone(snapshot(run));
}

function cyberBlock(record: RunSnapshot): Record<string, unknown> {
  assert.ok(record.cyberspace, 'record carries a cyberspace block');
  return record.cyberspace as unknown as Record<string, unknown>;
}

function cyberEntities(record: RunSnapshot): RunEntitySnapshot[] {
  return cyberBlock(record).entities as RunEntitySnapshot[];
}

// --- round-trip -------------------------------------------------------------------

test('a mid-jack-in snapshot round-trips the layer exactly', () => {
  const run = activeRun();
  const layer = layerOf(run);
  const dest = adjacentFreeTile(layer.world, layer.avatar);
  layer.world.relocateEntity(layer.avatar, dest.x, dest.y);
  layer.avatar.spendAp(1);
  layer.avatar.damage(2);
  layer.recordSeen([`${layer.entryTile.x},${layer.entryTile.y}`]);
  layer.world.raiseAlarm({ repPenalty: false });

  const record = structuredClone(snapshot(run));
  const { run: restored } = restore(record);
  assert.equal(restored.cyberspace?.phase, 'active');
  const restoredLayer = layerOf(restored);

  assert.deepEqual(Array.from(restoredLayer.world.grid.tiles), Array.from(layer.world.grid.tiles));
  assert.deepEqual(restoredLayer.entryTile, layer.entryTile);
  const avatar = restoredLayer.avatar;
  assert.deepEqual(
    {
      x: avatar.x,
      y: avatar.y,
      hp: avatar.hp,
      maxHp: avatar.maxHp,
      ap: avatar.ap,
      damageReduction: avatar.damageReduction,
      intrusionStrength: avatar.intrusionStrength,
      callsign: avatar.callsign,
    },
    {
      x: layer.avatar.x,
      y: layer.avatar.y,
      hp: layer.avatar.hp,
      maxHp: layer.avatar.maxHp,
      ap: layer.avatar.ap,
      damageReduction: layer.avatar.damageReduction,
      intrusionStrength: layer.avatar.intrusionStrength,
      callsign: layer.avatar.callsign,
    }
  );
  assert.ok(restoredLayer.port instanceof EntryPort);
  assert.deepEqual(restoredLayer.mapSeenKeys(), layer.mapSeenKeys());
  assert.deepEqual(restoredLayer.world.snapshotAlarm(), layer.world.snapshotAlarm());
  // Meatspace round-tripped alongside: the Decker body is still the player.
  assert.ok(restored.player instanceof Decker);
});

test('overridden ICE state round-trips through an active cyber layer', () => {
  const run = activeRun();
  const layer = layerOf(run);
  const probe = Array.from(layer.world.entities.values()).find(
    (entity): entity is ProbeIce => entity instanceof ProbeIce
  );
  assert.ok(probe);
  applyOverride(probe, FACTION.PLAYER);

  const { run: restored } = restore(structuredClone(snapshot(run)));
  const restoredProbe = Array.from(layerOf(restored).world.entities.values()).find(
    (entity): entity is ProbeIce => entity instanceof ProbeIce
  );
  assert.ok(restoredProbe);
  assert.equal(restoredProbe.faction, FACTION.PLAYER);
  assert.equal(restoredProbe.isOverridden, true);
  assert.equal(restoredProbe.overrideTurnsRemaining, probe.overrideTurnsRemaining);
});

test('a restored active run re-wires its cyber listeners', () => {
  const results: RunResult[] = [];
  const { run: restored } = restore(activeRecord(), { onResult: r => results.push(r) });
  const layer = layerOf(restored);
  const avatar = layer.avatar;
  avatar.damage(avatar.hp);
  layer.bus.emit(EVENT.ENTITY_DAMAGED, {
    target: avatar,
    attacker: null,
    damage: avatar.maxHp,
    killed: true,
    source: 'black-ice',
  });
  assert.equal(restored.state, RUN_STATE.RESULT);
  assert.equal(results[0]?.outcome, OUTCOME.DEATH);
});

test('a restored active run keeps the dual-world turn cadence', () => {
  const { run: restored } = restore(activeRecord());
  const layer = layerOf(restored);
  layer.avatar.refreshAp();
  layer.avatar.spendAp(2);
  restored.queue!.endTurn(restored.world!); // player → corp
  restored.queue!.endTurn(restored.world!); // corp → player
  assert.equal(layer.avatar.ap, layer.avatar.maxAp);
});

test('a resolved layer round-trips its latch', () => {
  const run = activeRun();
  const layer = layerOf(run);
  layer.port.interact(layer.world, layer.avatar);
  assert.deepEqual(run.cyberspace, { phase: 'resolved', objectiveComplete: false });
  const record = structuredClone(snapshot(run));
  assert.deepEqual(record.cyberspace, { phase: 'resolved', objectiveComplete: false });
  const { run: restored } = restore(record);
  assert.deepEqual(restored.cyberspace, { phase: 'resolved', objectiveComplete: false });
  assert.throws(() => restored.jackOut(), /phase/);
});

// --- adversarial: active block -----------------------------------------------------

test('active block missing a required field throws', () => {
  for (const field of ['grid', 'entities', 'entryTile', 'alarm', 'mapMemory']) {
    const record = activeRecord();
    delete cyberBlock(record)[field];
    assert.throws(
      () => restore(record),
      new RegExp(field === 'mapMemory' ? 'mapMemory' : field),
      `expected restore to throw on missing cyberspace.${field}`
    );
  }
});

test('active block with unknown payload keys throws', () => {
  const record = activeRecord();
  cyberBlock(record).objectiveComplete = true; // resolved-only latch on active phase
  assert.throws(() => restore(record), /objectiveComplete/);
});

test('an out-of-bounds cyber entity throws', () => {
  const record = activeRecord();
  const avatarRec = cyberEntities(record).find(e => e.archetype === 'cyber-avatar')!;
  avatarRec.x = 999;
  assert.throws(() => restore(record), /out of bounds/);
});

test('zero or multiple avatars throw', () => {
  const missing = activeRecord();
  const block = cyberBlock(missing);
  block.entities = cyberEntities(missing).filter(e => e.archetype !== 'cyber-avatar');
  assert.throws(() => restore(missing), /avatar/);

  const doubled = activeRecord();
  const entities = cyberEntities(doubled);
  const avatarRec = entities.find(e => e.archetype === 'cyber-avatar')!;
  const clone = structuredClone(avatarRec);
  clone.id = 'cyber-avatar-1';
  entities.push(clone);
  assert.throws(() => restore(doubled), /avatar/);
});

test('a missing exit port throws', () => {
  const record = activeRecord();
  const block = cyberBlock(record);
  block.entities = cyberEntities(record).filter(e => e.archetype !== 'entry-port');
  assert.throws(() => restore(record), /port/);
});

test('non-cyber tile ids in the cyber grid throw', () => {
  const record = activeRecord();
  const grid = cyberBlock(record).grid as { tiles: number[] };
  const wallIndex = grid.tiles.findIndex(t => t === TILE.WALL);
  assert.ok(wallIndex >= 0);
  grid.tiles[wallIndex] = TILE.COVER;
  assert.throws(() => restore(record), /tile/);
});

test('an avatar record without intrusion state throws', () => {
  const record = activeRecord();
  const avatarRec = cyberEntities(record).find(e => e.archetype === 'cyber-avatar')!;
  delete (avatarRec.extra as Record<string, unknown>).intrusionStrength;
  assert.throws(() => restore(record), /intrusion/);
});

// --- adversarial: resolved block -----------------------------------------------------

test('resolved block without its latch throws', () => {
  const run = activeRun();
  const layer = layerOf(run);
  layer.port.interact(layer.world, layer.avatar);
  const record = structuredClone(snapshot(run));
  delete cyberBlock(record).objectiveComplete;
  assert.throws(() => restore(record), /objectiveComplete/);
});

test('resolved block smuggling active payload throws', () => {
  const run = activeRun();
  const layer = layerOf(run);
  layer.port.interact(layer.world, layer.avatar);
  const record = structuredClone(snapshot(run));
  cyberBlock(record).grid = { w: 1, h: 1, tiles: [0] };
  assert.throws(() => restore(record), /grid/);
});

// --- Decker cyber stats: run-entity path ---------------------------------------------

test('Decker cyber stats round-trip through the run-entity extra', () => {
  const record = activeRecord();
  const deckerRec = record.entities.find(e => e.archetype === 'decker')!;
  assert.deepEqual(
    {
      ram: (deckerRec.extra as Record<string, unknown>).ram,
      intrusionStrength: (deckerRec.extra as Record<string, unknown>).intrusionStrength,
      iceResistance: (deckerRec.extra as Record<string, unknown>).iceResistance,
    },
    {
      ram: DECKER_BASE_RAM,
      intrusionStrength: DECKER_BASE_INTRUSION,
      iceResistance: DECKER_BASE_ICE_RESISTANCE,
    }
  );
  const { run: restored } = restore(record);
  const decker = restored.player as Decker;
  assert.equal(decker.ram, DECKER_BASE_RAM);
  assert.equal(decker.intrusionStrength, DECKER_BASE_INTRUSION);
  assert.equal(decker.iceResistance, DECKER_BASE_ICE_RESISTANCE);
});

test('half-populated Decker cyber stats in the run-entity extra throw', () => {
  const record = activeRecord();
  const deckerRec = record.entities.find(e => e.archetype === 'decker')!;
  delete (deckerRec.extra as Record<string, unknown>).ram;
  assert.throws(() => restore(record), /ram/);
});

test('a legacy Decker record without cyber stats restores with base stats', () => {
  const record = activeRecord();
  const deckerRec = record.entities.find(e => e.archetype === 'decker')!;
  const extra = deckerRec.extra as Record<string, unknown>;
  delete extra.ram;
  delete extra.intrusionStrength;
  delete extra.iceResistance;
  const { run: restored } = restore(record);
  const decker = restored.player as Decker;
  assert.equal(decker.ram, DECKER_BASE_RAM);
  assert.equal(decker.iceResistance, DECKER_BASE_ICE_RESISTANCE);
});

// --- Decker cyber stats: campaign crew path -------------------------------------------

function act2CampaignWithDecker(): Campaign {
  const campaign = new Campaign({ seed: 42, rep: 65, completedJobs: 4 });
  assert.ok(campaign.crew.some(m => m.archetype === 'Decker'));
  return campaign;
}

test('campaign crew snapshots carry the Decker cyber block', () => {
  const record = snapshotCampaign(act2CampaignWithDecker());
  const deckerRec = record.crew.find(c => c.archetype === 'decker') as unknown as {
    cyber?: { ram: number; intrusion: number; iceResistance: number };
  };
  assert.deepEqual(deckerRec.cyber, {
    ram: DECKER_BASE_RAM,
    intrusion: DECKER_BASE_INTRUSION,
    iceResistance: DECKER_BASE_ICE_RESISTANCE,
  });
  const restored = restoreCampaign(structuredClone(record));
  const decker = restored.crew.find(m => m.archetype === 'Decker') as Decker;
  assert.equal(decker.ram, DECKER_BASE_RAM);
  assert.equal(decker.intrusionStrength, DECKER_BASE_INTRUSION);
});

test('half-populated campaign cyber stats throw; absent stats default', () => {
  const base = snapshotCampaign(act2CampaignWithDecker());

  const half = structuredClone(base);
  const halfDecker = half.crew.find(c => c.archetype === 'decker') as unknown as {
    cyber: Record<string, unknown>;
  };
  delete halfDecker.cyber.intrusion;
  assert.throws(() => restoreCampaign(half), /intrusion/);

  const legacy = structuredClone(base);
  const legacyDecker = legacy.crew.find(c => c.archetype === 'decker') as unknown as {
    cyber?: unknown;
  };
  delete legacyDecker.cyber;
  const restored = restoreCampaign(legacy);
  const decker = restored.crew.find(m => m.archetype === 'Decker') as Decker;
  assert.equal(decker.ram, DECKER_BASE_RAM);
});

test('cyber stats on a non-Decker crew record throw', () => {
  const record = structuredClone(snapshotCampaign(act2CampaignWithDecker()));
  const mercRec = record.crew.find(c => c.archetype !== 'decker') as unknown as {
    cyber?: unknown;
  };
  mercRec.cyber = { ram: 8, intrusion: 2, iceResistance: 1 };
  assert.throws(() => restoreCampaign(record), /cyber/);
});

// --- avatar snapshot extra ------------------------------------------------------------

test('the avatar snapshot rides the entity record (hp pool) plus its extra', () => {
  const record = activeRecord();
  const avatarRec = cyberEntities(record).find(e => e.archetype === 'cyber-avatar')!;
  assert.equal(avatarRec.maxHp, DECKER_BASE_RAM);
  assert.equal(avatarRec.damageReduction, DECKER_BASE_ICE_RESISTANCE);
  assert.equal(avatarRec.hp, DECKER_BASE_RAM - 2); // damaged in activeRecord()
  assert.deepEqual(avatarRec.extra, {
    intrusionStrength: DECKER_BASE_INTRUSION,
    callsign: (record.entities.find(e => e.archetype === 'decker')!.extra as { callsign: string })
      .callsign,
  });
  // Restored avatars are real CyberAvatars.
  const { run: restored } = restore(record);
  assert.ok(layerOf(restored).avatar instanceof CyberAvatar);
});
