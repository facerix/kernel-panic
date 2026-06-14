/**
 * P3.M3.3 — CyberspaceLayer: the digital tactical layer owned by `Run`.
 *
 * Owns its own EventBus / World / CyberAvatar / EntryPort. The avatar's pools
 * come from the Decker's named cyber stats: RAM = HP pool, ICE resistance =
 * damageReduction, intrusion strength carried for data-node slicing (S4).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CyberspaceLayer } from '../../../../src/game/cyber/CyberspaceLayer.js';
import { CyberAvatar } from '../../../../src/game/cyber/CyberAvatar.js';
import { EntryPort } from '../../../../src/game/cyber/EntryPort.js';
import { DataNode } from '../../../../src/game/cyber/DataNode.js';
import { ProbeIce } from '../../../../src/game/cyber/ProbeIce.js';
import { SparkIce } from '../../../../src/game/cyber/SparkIce.js';
import { GuardianIce } from '../../../../src/game/cyber/GuardianIce.js';
import { Decker } from '../../../../src/game/archetypes/Decker.js';
import { ALARM_PHASE } from '../../../../src/game/World.js';
import { EVENT } from '../../../../src/game/events.js';
import {
  AP_COST,
  CYBER_AVATAR_HIT_CHANCE,
  CYBER_AVATAR_MAX_AP,
  DECKER_BASE_ICE_RESISTANCE,
  DECKER_BASE_INTRUSION,
  DECKER_BASE_RAM,
  FACTION,
} from '../../../../src/game/constants.js';

const makeDecker = (overrides = {}) =>
  new Decker({ id: 'crew-decker', x: 0, y: 0, callsign: 'Phreak', ...overrides });

const buildLayer = (contractSeed = 12345, decker = makeDecker(), difficulty = 'standard') =>
  // nodeCount 1 matches the `cyber-data-spike` recipe (P3.M3.4).
  CyberspaceLayer.build({ contractSeed, difficulty, decker, nodeCount: 1 });

// --- Decker cyber stats ------------------------------------------------------

test('Decker ships base cyber stats', () => {
  const decker = makeDecker();
  assert.equal(decker.ram, DECKER_BASE_RAM);
  assert.equal(decker.intrusionStrength, DECKER_BASE_INTRUSION);
  assert.equal(decker.iceResistance, DECKER_BASE_ICE_RESISTANCE);
});

test('Decker cyber stat overrides are validated', () => {
  assert.throws(() => makeDecker({ ram: 0 }), /ram/);
  assert.throws(() => makeDecker({ ram: 2.5 }), /ram/);
  assert.throws(() => makeDecker({ intrusionStrength: 0 }), /intrusion/);
  assert.throws(() => makeDecker({ intrusionStrength: -1 }), /intrusion/);
  assert.throws(() => makeDecker({ iceResistance: -1 }), /resistance/i);
  assert.throws(() => makeDecker({ iceResistance: 0.5 }), /resistance/i);
  // Zero ICE resistance is legal (no mitigation); zero RAM is not (no pool).
  assert.equal(makeDecker({ iceResistance: 0 }).iceResistance, 0);
  assert.equal(makeDecker({ ram: 12 }).ram, 12);
});

// --- avatar ------------------------------------------------------------------

test('build spawns the avatar at the entry tile with stats from the Decker', () => {
  const decker = makeDecker({ ram: 10, intrusionStrength: 3, iceResistance: 2 });
  const layer = buildLayer(777, decker);
  const avatar = layer.avatar;
  assert.ok(avatar instanceof CyberAvatar);
  assert.deepEqual({ x: avatar.x, y: avatar.y }, layer.entryTile);
  assert.equal(avatar.maxHp, 10);
  assert.equal(avatar.hp, 10);
  assert.equal(avatar.damageReduction, 2);
  assert.equal(avatar.intrusionStrength, 3);
  assert.equal(avatar.callsign, 'Phreak');
  assert.equal(avatar.faction, FACTION.PLAYER);
  assert.equal(avatar.maxAp, CYBER_AVATAR_MAX_AP);
  assert.equal(avatar.baseHitChance, CYBER_AVATAR_HIT_CHANCE);
});

test('the cyber world census: avatar, exit port, data nodes, ICE roster', () => {
  // nodeCount 1 (the cyber-data-spike / Score shape): 1 data node ⇒ 1 Guardian.
  const layer = buildLayer();
  const entities = Array.from(layer.world.entities.values());
  const dataNodes = entities.filter(e => e instanceof DataNode).length;
  const guardians = entities.filter(e => e instanceof GuardianIce).length;
  const probes = entities.filter(e => e instanceof ProbeIce).length;
  const sparks = entities.filter(e => e instanceof SparkIce).length;

  assert.equal(entities.filter(e => e instanceof CyberAvatar).length, 1);
  assert.equal(entities.filter(e => e instanceof EntryPort).length, 1);
  assert.equal(dataNodes, 1, 'one contract data node');
  // One Guardian per data node (it guards the prize); the rest of the rings
  // patrol with Probes; the Sparks are the difficulty-scaled swarm (standard 1).
  assert.equal(guardians, dataNodes, 'a Guardian holds every data node');
  assert.equal(probes, layer.patrolRings.length - dataNodes, 'Probes patrol the other rings');
  assert.equal(sparks, 1, 'standard difficulty seeds one Spark');
  assert.equal(
    entities.length,
    2 + dataNodes + guardians + probes + sparks,
    'no surprise entities on the cyber grid'
  );
  const cheb = Math.max(
    Math.abs(layer.port.x - layer.avatar.x),
    Math.abs(layer.port.y - layer.avatar.y)
  );
  assert.equal(cheb, 1, 'exit port starts adjacent to the avatar');
});

test('layer layout is deterministic on the contract seed', () => {
  const a = buildLayer(424242);
  const b = buildLayer(424242);
  assert.deepEqual(Array.from(a.world.grid.tiles), Array.from(b.world.grid.tiles));
  assert.deepEqual({ x: a.avatar.x, y: a.avatar.y }, { x: b.avatar.x, y: b.avatar.y });
  assert.deepEqual({ x: a.port.x, y: a.port.y }, { x: b.port.x, y: b.port.y });
});

test('CyberAvatar validates its pools', () => {
  const props = { id: 'cyber-avatar-0', x: 1, y: 1 };
  assert.throws(
    () => new CyberAvatar({ ...props, ram: 0, intrusionStrength: 2, iceResistance: 1 }),
    /ram/i
  );
  assert.throws(
    () => new CyberAvatar({ ...props, ram: 8, intrusionStrength: 0, iceResistance: 1 }),
    /intrusion/i
  );
  assert.throws(
    () => new CyberAvatar({ ...props, ram: 8, intrusionStrength: 2, iceResistance: -1 }),
    /resistance/i
  );
});

// --- turn integration ---------------------------------------------------------

test('onTurnEnded refreshes only the incoming faction in the cyber world', () => {
  const layer = buildLayer();
  layer.avatar.spendAp(2);
  layer.onTurnEnded(FACTION.CORP);
  assert.equal(layer.avatar.ap, layer.avatar.maxAp - 2, 'corp activation leaves the avatar spent');
  layer.onTurnEnded(FACTION.PLAYER);
  assert.equal(layer.avatar.ap, layer.avatar.maxAp, 'player activation refreshes the avatar');
});

test('onTurnEnded ticks the cyber alarm on round advance (player activation)', () => {
  const layer = buildLayer();
  layer.world.raiseAlarm({ repPenalty: false });
  assert.equal(layer.world.alarm.phase, ALARM_PHASE.ALERT);
  layer.onTurnEnded(FACTION.CORP);
  assert.equal(layer.world.alarm.phase, ALARM_PHASE.ALERT, 'corp activation is mid-round');
  layer.onTurnEnded(FACTION.PLAYER);
  layer.onTurnEnded(FACTION.PLAYER);
  assert.equal(layer.world.alarm.phase, ALARM_PHASE.COOLDOWN, 'alert hold expires over rounds');
});

// --- map memory ----------------------------------------------------------------

test('recordSeen validates bounds and round-trips sorted keys', () => {
  const layer = buildLayer();
  const { x, y } = layer.entryTile;
  layer.recordSeen([`${x},${y}`, `${layer.port.x},${layer.port.y}`]);
  assert.equal(layer.mapSeenKeys().length, 2);
  assert.throws(() => layer.recordSeen(['999,999']), /bounds/);
  assert.throws(() => layer.recordSeen(['not-a-key']), /key/);
});

// --- exit port ------------------------------------------------------------------

test('the avatar interacting with the exit port emits JACK_OUT once and debits AP', () => {
  const layer = buildLayer();
  const payloads: unknown[] = [];
  layer.bus.on(EVENT.JACK_OUT, payload => payloads.push(payload));
  const apBefore = layer.avatar.ap;
  const result = layer.port.interact(layer.world, layer.avatar);
  assert.equal(result.ok, true);
  assert.equal(layer.avatar.ap, apBefore - AP_COST.INTERACT);
  assert.equal(payloads.length, 1);
  const payload = payloads[0] as { port: EntryPort; actor: unknown };
  assert.equal(payload.port, layer.port);
  assert.equal(payload.actor, layer.avatar);
});

test('a non-avatar cannot route out through the exit port', () => {
  const layer = buildLayer();
  // A meat-side Decker standing in the grid is corrupt state; the port still
  // refuses anything without the avatar capability — including a Decker.
  const decker = makeDecker();
  decker.x = layer.avatar.x;
  decker.y = layer.avatar.y;
  decker.ap = decker.maxAp = 4;
  let events = 0;
  layer.bus.on(EVENT.JACK_OUT, () => events++);
  const result = layer.port.interact(layer.world, decker);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'not-an-avatar');
  assert.equal(events, 0);
});
