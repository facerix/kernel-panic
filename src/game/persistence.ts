/**
 * Pure snapshot/restore for a `Run`. No DOM, no DataStore — the shell wires
 * the round-trip into storage; this module just does the data conversion.
 *
 * The snapshot is a plain JSON-safe record:
 *
 *   {
 *     id, type: 'run',
 *     state: 'HUB' | 'BRIEFING' | 'COMBAT' | 'RESULT',
 *     archetype, seed,
 *     turnNumber, currentFaction,
 *     rng:        { seed, state },
 *     contract:   { seed, objective, difficulty, threatCount, label, context, reward } | null,
 *     exitTile:   { x, y } | null,
 *     grid:       { w, h, tiles: number[] },          // plain array of u8 bytes
 *     entities:   [{ archetype, id, x, y, faction, hp, maxHp,
 *                    damageReduction, ap, maxAp, stealthed,
 *                    drone?: { state, lastKnownTarget,
 *                    patrolWaypoints, patrolIndex } }, …],
 *     telemetry:  { turn, kills, archetype, seed, … },
 *   }
 *
 * `restore(record)` rebuilds a fresh Run + World + TurnQueue from the
 * record. Anything missing or out of bounds throws — silent fallback would
 * resurrect a corrupt run instead of crashing on the spot.
 *
 * The plain-array grid encoding (vs. base64 of a `Uint8Array`) is ~3× larger
 * on disk but trivially portable across browser + `node --test`, and a 24×16
 * grid is 384 bytes either way.
 */

import { Rng } from '../rng.js';
import { Grid } from './Grid.js';
import { World } from './World.js';
import { TurnQueue } from './TurnQueue.js';
import { EventBus } from './events.js';
import {
  DOOR_LOCKED_GLYPH,
  DOOR_OPEN_GLYPH,
  FACTION,
  SALVAGE_TO_CRED_RATE,
  TILE,
} from './constants.js';
import { migrateSalvage, type TypedSalvage } from './salvage.js';
import { Entity } from './Entity.js';
import { Crew } from './Crew.js';
import { Merc } from './archetypes/Merc.js';
import { Razor } from './archetypes/Razor.js';
import { Tech } from './archetypes/Tech.js';
import { Decker } from './archetypes/Decker.js';
import { Turret } from './Turret.js';
import { Skirmisher, type SkirmisherProps } from './ai/Skirmisher.js';
import { Guard, type GuardProps } from './ai/Guard.js';
import { Bruiser, type BruiserProps } from './ai/Bruiser.js';
import { Juggernaut, type JuggernautProps } from './ai/Juggernaut.js';
import { Flanker, type FlankerProps } from './ai/Flanker.js';
import { Lookout, type LookoutProps } from './ai/Lookout.js';
import { Sniper, type SniperProps } from './ai/Sniper.js';
import { Medic, type MedicProps } from './ai/Medic.js';
import { PatrolHostile, PATROL_STATE, type PatrolSnapshot } from './ai/PatrolHostile.js';
import { CorpCivilian } from './entities/CorpCivilian.js';
import { NeutralCivilian } from './entities/NeutralCivilian.js';
import { Door } from './entities/Door.js';
import { Terminal } from './entities/Terminal.js';
import { Pickup } from './entities/Pickup.js';
import { Contact } from './entities/Contact.js';
import { DenyTarget } from './entities/DenyTarget.js';
import { SyncPad } from './entities/SyncPad.js';
import { CorpTurret } from './entities/CorpTurret.js';
import { RelayNode } from './entities/RelayNode.js';
import { ConsumablePickup } from './entities/ConsumablePickup.js';
import { EscortNpc } from './entities/EscortNpc.js';
import { KeyCard } from './entities/KeyCard.js';
import { JackInPoint } from './entities/JackInPoint.js';
import { CyberspaceLayer } from './cyber/CyberspaceLayer.js';
import { CyberAvatar } from './cyber/CyberAvatar.js';
import { EntryPort } from './cyber/EntryPort.js';
import { BreachingCharge } from './entities/BreachingCharge.js';
import type { BreachingChargeInit } from './entities/BreachingCharge.js';
import type { CyberAvatarInit, CyberAvatarSnapshot } from './cyber/CyberAvatar.js';
import type { EntryPortInit, EntryPortSnapshot } from './cyber/EntryPort.js';
import { DataNode } from './cyber/DataNode.js';
import type { DataNodeInit, DataNodeSnapshot } from './cyber/DataNode.js';
import type { DeckerInit, DeckerSnapshot } from './archetypes/Decker.js';
import { Run, RUN_STATE, PATROL_ARCHETYPE_IDS } from './Run.js';
import { Campaign, CAMPAIGN_STATE, normalizeCampaignArc } from './Campaign.js';
import {
  contractRequiresCyberspace,
  normalizeContractContext,
  normalizeObjective,
} from './hub/Curator.js';
import {
  migrateLegacyHubReveals,
  normalizeHubReveals,
  snapshotHubReveals,
} from './hub/hubReveals.js';
import type { CrewInit } from './Crew.js';
import type { Inventory, Gear } from './Crew.js';
import type { TurretInit } from './Turret.js';
import type { CorpCivilianInit } from './entities/CorpCivilian.js';
import type { NeutralCivilianInit } from './entities/NeutralCivilian.js';
import type { DoorInit } from './entities/Door.js';
import type { TerminalInit } from './entities/Terminal.js';
import type { PickupInit } from './entities/Pickup.js';
import type { ContactInit } from './entities/Contact.js';
import type { DenyTargetInit } from './entities/DenyTarget.js';
import type { SyncPadInit } from './entities/SyncPad.js';
import type { CorpTurretInit } from './entities/CorpTurret.js';
import type { RelayNodeInit } from './entities/RelayNode.js';
import type { ConsumablePickupInit } from './entities/ConsumablePickup.js';
import type { EscortNpcInit } from './entities/EscortNpc.js';
import type { KeyCardInit } from './entities/KeyCard.js';
import type { JackInPointInit, JackInPointSnapshot } from './entities/JackInPoint.js';
import type { EntityInit } from './Entity.js';
import type { CampaignArc } from './Campaign.js';
import type { FactionId } from './constants.js';
import type {
  CrewArchetypeId,
  EntityArchetypeId,
  PatrolArchetypeId,
  RunEntitySnapshot,
  RunResult,
  RunSnapshot,
  RunState,
  RunTelemetry,
  ObjectiveTimerSnapshot,
  MapMemorySnapshot,
  ObjectiveProgressSnapshot,
  CyberspaceState,
} from './Run.js';
import type { CrewSnapshot } from './Crew.js';
import type { TechSnapshot } from './archetypes/Tech.js';
import type { SniperSnapshot } from './ai/Sniper.js';
import type { FlankerSnapshot } from './ai/Flanker.js';
import type { TurretSnapshot } from './Turret.js';
import type { CorpTurretSnapshot } from './entities/CorpTurret.js';
import type { TerminalSnapshot } from './entities/Terminal.js';
import type { DoorSnapshot } from './entities/Door.js';
import type { PickupSnapshot } from './entities/Pickup.js';
import type { ContactSnapshot } from './entities/Contact.js';
import type { DenyTargetSnapshot } from './entities/DenyTarget.js';
import type { SyncPadSnapshot } from './entities/SyncPad.js';
import type { RelayNodeSnapshot } from './entities/RelayNode.js';
import type { ConsumablePickupSnapshot } from './entities/ConsumablePickup.js';
import type { EscortNpcSnapshot } from './entities/EscortNpc.js';
import type { KeyCardSnapshot } from './entities/KeyCard.js';
import type { EntitySnapshotExtra } from '../types.js';
import type { CampaignMeta, CampaignState } from './Campaign.js';
import { normalizeLocationSite } from './locations.js';
import { normalizeMapDimensions } from './procgen/mapDimensions.js';
import type { KeyItem, LocationSite, TileDelta } from '../types.js';

const ARCHETYPE_KEY = Symbol.for('kernel-panic.archetype');

type RestoreEntityProps = Partial<
  CrewInit &
    TurretInit &
    SkirmisherProps &
    GuardProps &
    BruiserProps &
    JuggernautProps &
    FlankerProps &
    LookoutProps &
    SniperProps &
    MedicProps &
    CorpCivilianInit &
    NeutralCivilianInit &
    DoorInit &
    EntityInit &
    TerminalInit &
    PickupInit &
    ContactInit &
    DenyTargetInit &
    SyncPadInit &
    CorpTurretInit &
    RelayNodeInit &
    ConsumablePickupInit &
    EscortNpcInit &
    KeyCardInit &
    BreachingChargeInit &
    JackInPointInit &
    CyberAvatarInit &
    EntryPortInit &
    DataNodeInit &
    DeckerInit
> & {
  id: string;
  x: number;
  y: number;
  faction?: FactionId;
  glyph?: string;
  maxAp?: number;
  maxHp?: number;
  damageReduction?: number;
  shieldHp?: number;
};

const ARCHETYPE_FACTORY: Record<EntityArchetypeId, (props: RestoreEntityProps) => Entity> =
  Object.freeze({
    merc: (props: RestoreEntityProps) => new Merc(props as CrewInit),
    razor: (props: RestoreEntityProps) => new Razor(props as CrewInit),
    tech: (props: RestoreEntityProps) => new Tech(props as CrewInit),
    decker: (props: RestoreEntityProps) => new Decker(props as DeckerInit),
    turret: (props: RestoreEntityProps) => new Turret(props as TurretInit),
    drone: (props: RestoreEntityProps) => new Skirmisher(props as SkirmisherProps),
    guard: (props: RestoreEntityProps) => new Guard(props as GuardProps),
    bruiser: (props: RestoreEntityProps) => new Bruiser(props as BruiserProps),
    juggernaut: (props: RestoreEntityProps) => new Juggernaut(props as JuggernautProps),
    flanker: (props: RestoreEntityProps) => new Flanker(props as FlankerProps),
    lookout: (props: RestoreEntityProps) => new Lookout(props as LookoutProps),
    sniper: (props: RestoreEntityProps) => new Sniper(props as SniperProps),
    medic: (props: RestoreEntityProps) => new Medic(props as MedicProps),
    'corp-civilian': (props: RestoreEntityProps) => new CorpCivilian(props as CorpCivilianInit),
    'neutral-civilian': (props: RestoreEntityProps) =>
      new NeutralCivilian(props as NeutralCivilianInit),
    door: (props: RestoreEntityProps) => new Door(props as DoorInit),
    terminal: (props: RestoreEntityProps) => new Terminal(props as TerminalInit),
    pickup: (props: RestoreEntityProps) => new Pickup(props as PickupInit),
    contact: (props: RestoreEntityProps) => new Contact(props as ContactInit),
    'deny-target': (props: RestoreEntityProps) => new DenyTarget(props as DenyTargetInit),
    'sync-pad': (props: RestoreEntityProps) => new SyncPad(props as SyncPadInit),
    'corp-turret': (props: RestoreEntityProps) => new CorpTurret(props as CorpTurretInit),
    'relay-node': (props: RestoreEntityProps) => new RelayNode(props as RelayNodeInit),
    'consumable-pickup': (props: RestoreEntityProps) =>
      new ConsumablePickup(props as ConsumablePickupInit),
    'escort-npc': (props: RestoreEntityProps) => new EscortNpc(props as EscortNpcInit),
    keycard: (props: RestoreEntityProps) => new KeyCard(props as KeyCardInit),
    'jack-in-point': (props: RestoreEntityProps) => new JackInPoint(props as JackInPointInit),
    'cyber-avatar': (props: RestoreEntityProps) => new CyberAvatar(props as CyberAvatarInit),
    'entry-port': (props: RestoreEntityProps) => new EntryPort(props as EntryPortInit),
    'data-node': (props: RestoreEntityProps) => new DataNode(props as DataNodeInit),
    'breaching-charge': (props: RestoreEntityProps) =>
      new BreachingCharge(props as BreachingChargeInit),
    // Generic fallback so a future `Entity` subclass (NPCs, items) doesn't break
    // the round-trip when the full archetype landed but the loader hasn't.
    entity: (props: RestoreEntityProps) =>
      new Entity({
        ...props,
        faction: props.faction ?? FACTION.NEUTRAL,
        glyph: props.glyph ?? '?',
      }),
  });

const KNOWN_FACTIONS = new Set(Object.values(FACTION));
const KNOWN_RUN_STATES = new Set(Object.values(RUN_STATE));
const KNOWN_PATROL_STATES = new Set(Object.values(PATROL_STATE));
const PATROL_ARCHETYPE_SET = new Set<EntityArchetypeId>(PATROL_ARCHETYPE_IDS);

function isPatrolArchetype(archetype: EntityArchetypeId): archetype is PatrolArchetypeId {
  return PATROL_ARCHETYPE_SET.has(archetype);
}

// ---------------------------------------------------------------------------
// P2.7.M6.2 — Data-Mapper entity restore registry.
//
// The on-disk entity layout is a slim common record plus a single opaque
// `extra` property bag (see `RunEntitySnapshot`). `normalizeEntityExtra`
// produces that bag from new *or* legacy saves; `ENTITY_RESTORE` then owns the
// per-archetype `buildProps`/`apply` logic, replacing the former ~30-block
// `if (rec.archetype === 'X')` cascade. `Run.snapshotEntity`'s
// `SNAPSHOT_EXTRACTORS` is the symmetric write path.
// ---------------------------------------------------------------------------

/** Pre-P2.7.M6.2 named sub-block key for each non-crew/non-patrol archetype. */
const LEGACY_EXTRA_KEY: Partial<Record<EntityArchetypeId, string>> = Object.freeze({
  turret: 'turret',
  'corp-turret': 'corpTurret',
  terminal: 'terminal',
  door: 'door',
  pickup: 'pickup',
  contact: 'contact',
  'deny-target': 'denyTarget',
  'sync-pad': 'syncPad',
  'relay-node': 'relayNode',
  'consumable-pickup': 'consumablePickup',
  'escort-npc': 'escortNpc',
  keycard: 'keycard',
});

function asObjectBag(value: unknown): EntitySnapshotExtra | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as EntitySnapshotExtra)
    : null;
}

/**
 * Reconstruct the `extra` bag from a *legacy* (pre-P2.7.M6.2) record that
 * still stores per-archetype slices as named top-level sub-blocks (`drone`,
 * `terminal`, …) and crew fields at the top level. New saves carry `extra`
 * directly and never reach here.
 */
function legacyEntityExtra(rec: RunEntitySnapshot): EntitySnapshotExtra {
  const legacy = rec as unknown as Record<string, unknown>;
  const archetype = rec.archetype;
  if (isPatrolArchetype(archetype)) {
    return asObjectBag(legacy[archetype]) ?? {};
  }
  if (isCrewArchetype(archetype)) {
    const extra: Record<string, unknown> = {
      callsign: (legacy.callsign as string | null | undefined) ?? null,
      flatlined: !!legacy.flatlined,
      inventory: legacy.inventory ?? null,
      gear: legacy.gear ?? null,
    };
    const tech = asObjectBag(legacy.tech);
    if (tech && 'turretReady' in tech) extra.turretReady = !!tech.turretReady;
    return extra as EntitySnapshotExtra;
  }
  const key = LEGACY_EXTRA_KEY[archetype];
  if (key) return asObjectBag(legacy[key]) ?? {};
  return {};
}

/**
 * Produce the opaque per-entity property bag for a record. New saves carry it
 * under `extra`; legacy saves normalise from their named sub-blocks. A
 * malformed `extra` crashes — silent fallback would resurrect a corrupt entity.
 */
function normalizeEntityExtra(rec: RunEntitySnapshot): EntitySnapshotExtra {
  if (rec.extra !== undefined && rec.extra !== null) {
    const obj = asObjectBag(rec.extra);
    if (!obj) throw new TypeError(`restore: entity ${rec.id} extra must be an object`);
    return obj;
  }
  return legacyEntityExtra(rec);
}

function hasNoState(extra: EntitySnapshotExtra): boolean {
  return Object.keys(extra).length === 0;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(message);
  return value;
}

function requireBoolean(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(message);
  return value;
}

// --- Per-entity strict readers (validate the bag → typed snapshot) ----------

function readTerminal(extra: EntitySnapshotExtra, id: string): TerminalSnapshot {
  if (hasNoState(extra))
    throw new TypeError(`restore: terminal entity ${id} requires terminal state`);
  const t = extra as Partial<TerminalSnapshot>;
  if (
    t.unlocksId !== undefined &&
    t.unlocksId !== null &&
    (typeof t.unlocksId !== 'string' || t.unlocksId.length === 0)
  ) {
    throw new TypeError(`restore: terminal ${id} unlocksId must be null or a non-empty string`);
  }
  return {
    label: requireString(t.label, `restore: terminal ${id} label must be a non-empty string`),
    sliced: requireBoolean(t.sliced, `restore: terminal ${id} sliced must be boolean`),
    armed: requireBoolean(t.armed, `restore: terminal ${id} armed must be boolean`),
    raisesAlarm: requireBoolean(
      t.raisesAlarm,
      `restore: terminal ${id} raisesAlarm must be boolean`
    ),
    unlocksId: (t.unlocksId as string | null | undefined) ?? null,
  };
}

function readJackInPoint(extra: EntitySnapshotExtra, id: string): JackInPointSnapshot {
  if (hasNoState(extra)) {
    throw new TypeError(`restore: jack-in point entity ${id} requires jack-in state`);
  }
  const p = extra as Partial<JackInPointSnapshot>;
  return {
    label: requireString(p.label, `restore: jack-in point ${id} label must be a non-empty string`),
    linked: requireBoolean(p.linked, `restore: jack-in point ${id} linked must be boolean`),
  };
}

function readDataNode(extra: EntitySnapshotExtra, id: string): DataNodeSnapshot {
  if (hasNoState(extra)) {
    throw new TypeError(`restore: data node entity ${id} requires slice state`);
  }
  const n = extra as Partial<DataNodeSnapshot>;
  if (!Number.isInteger(n.sliceDifficulty) || (n.sliceDifficulty as number) <= 0) {
    throw new TypeError(`restore: data node ${id} sliceDifficulty must be a positive integer`);
  }
  if (!Number.isInteger(n.sliceProgress) || (n.sliceProgress as number) < 0) {
    throw new TypeError(`restore: data node ${id} sliceProgress must be a non-negative integer`);
  }
  return {
    label: requireString(n.label, `restore: data node ${id} label must be a non-empty string`),
    sliceDifficulty: n.sliceDifficulty as number,
    sliceProgress: n.sliceProgress as number,
  };
}

function readCyberAvatar(extra: EntitySnapshotExtra, id: string): CyberAvatarSnapshot {
  if (hasNoState(extra)) {
    throw new TypeError(`restore: cyber avatar entity ${id} requires avatar state`);
  }
  const a = extra as Partial<CyberAvatarSnapshot>;
  if (!Number.isInteger(a.intrusionStrength) || (a.intrusionStrength as number) <= 0) {
    throw new TypeError(`restore: cyber avatar ${id} intrusionStrength must be a positive integer`);
  }
  const callsign = a.callsign ?? null;
  if (callsign !== null && (typeof callsign !== 'string' || callsign.length === 0)) {
    throw new TypeError(`restore: cyber avatar ${id} callsign must be a non-empty string or null`);
  }
  return { intrusionStrength: a.intrusionStrength as number, callsign };
}

/**
 * P3.M3.3: Decker named cyber stats from the run-entity `extra`. All three
 * absent → pre-P3.M3.3 save, base stats apply (legacy normalization). Any
 * present-but-malformed or half-populated set is corrupt and throws.
 */
function readDeckerCyberStats(extra: EntitySnapshotExtra, id: string): Partial<DeckerInit> {
  const d = extra as Partial<DeckerSnapshot>;
  if (d.ram === undefined && d.intrusionStrength === undefined && d.iceResistance === undefined) {
    return {};
  }
  if (!Number.isInteger(d.ram) || (d.ram as number) <= 0) {
    throw new TypeError(`restore: decker ${id} ram must be a positive integer`);
  }
  if (!Number.isInteger(d.intrusionStrength) || (d.intrusionStrength as number) <= 0) {
    throw new TypeError(`restore: decker ${id} intrusionStrength must be a positive integer`);
  }
  if (!Number.isInteger(d.iceResistance) || (d.iceResistance as number) < 0) {
    throw new TypeError(`restore: decker ${id} iceResistance must be a non-negative integer`);
  }
  return {
    ram: d.ram as number,
    intrusionStrength: d.intrusionStrength as number,
    iceResistance: d.iceResistance as number,
  };
}

function readDoor(extra: EntitySnapshotExtra, id: string): DoorSnapshot {
  if (hasNoState(extra)) throw new TypeError(`restore: door entity ${id} requires door state`);
  const d = extra as Partial<DoorSnapshot>;
  return {
    doorId: requireString(d.doorId, `restore: door ${id} doorId must be a non-empty string`),
    locked: requireBoolean(d.locked, `restore: door ${id} locked must be boolean`),
  };
}

function readPickup(extra: EntitySnapshotExtra, id: string): PickupSnapshot {
  if (hasNoState(extra)) throw new TypeError(`restore: pickup entity ${id} requires pickup state`);
  const p = extra as Partial<PickupSnapshot>;
  return {
    label: requireString(p.label, `restore: pickup ${id} label must be a non-empty string`),
    secured: requireBoolean(p.secured, `restore: pickup ${id} secured must be boolean`),
    armed: requireBoolean(p.armed, `restore: pickup ${id} armed must be boolean`),
  };
}

function readContact(extra: EntitySnapshotExtra, id: string): ContactSnapshot {
  if (hasNoState(extra))
    throw new TypeError(`restore: contact entity ${id} requires contact state`);
  const c = extra as Partial<ContactSnapshot>;
  return {
    label: requireString(c.label, `restore: contact ${id} label must be a non-empty string`),
    handoffComplete: requireBoolean(
      c.handoffComplete,
      `restore: contact ${id} handoffComplete must be boolean`
    ),
    armed: requireBoolean(c.armed, `restore: contact ${id} armed must be boolean`),
  };
}

function readDenyTarget(extra: EntitySnapshotExtra, id: string): DenyTargetSnapshot {
  if (hasNoState(extra)) {
    throw new TypeError(`restore: deny target entity ${id} requires deny target state`);
  }
  const d = extra as Partial<DenyTargetSnapshot>;
  if (d.requiresBreach !== undefined && typeof d.requiresBreach !== 'boolean') {
    throw new TypeError(`restore: deny target ${id} requiresBreach must be boolean`);
  }
  return {
    label: requireString(d.label, `restore: deny target ${id} label must be a non-empty string`),
    requiresBreach: d.requiresBreach ?? false,
  };
}

function readSyncPad(extra: EntitySnapshotExtra, id: string): SyncPadSnapshot {
  if (hasNoState(extra))
    throw new TypeError(`restore: sync pad entity ${id} requires sync pad state`);
  const s = extra as Partial<SyncPadSnapshot>;
  return {
    label: requireString(s.label, `restore: sync pad ${id} label must be a non-empty string`),
    synced: requireBoolean(s.synced, `restore: sync pad ${id} synced must be boolean`),
    armed: requireBoolean(s.armed, `restore: sync pad ${id} armed must be boolean`),
  };
}

function readConsumablePickup(extra: EntitySnapshotExtra, id: string): ConsumablePickupSnapshot {
  if (hasNoState(extra)) {
    throw new TypeError(`restore: consumable pickup entity ${id} requires consumable state`);
  }
  const c = extra as Partial<ConsumablePickupSnapshot>;
  return {
    consumableId: requireString(
      c.consumableId,
      `restore: consumable pickup ${id} consumableId must be a non-empty string`
    ),
    label: requireString(
      c.label,
      `restore: consumable pickup ${id} label must be a non-empty string`
    ),
  };
}

function readEscortNpc(extra: EntitySnapshotExtra, id: string): EscortNpcSnapshot {
  if (hasNoState(extra))
    throw new TypeError(`restore: escort NPC entity ${id} requires escort state`);
  const n = extra as Partial<EscortNpcSnapshot>;
  return {
    label: requireString(n.label, `restore: escort NPC ${id} label must be a non-empty string`),
    activated: requireBoolean(n.activated, `restore: escort NPC ${id} activated must be boolean`),
    armed: requireBoolean(n.armed, `restore: escort NPC ${id} armed must be boolean`),
  };
}

function readKeyCard(extra: EntitySnapshotExtra, id: string): KeyCardSnapshot {
  if (hasNoState(extra))
    throw new TypeError(`restore: keycard entity ${id} requires keycard state`);
  const k = extra as Partial<KeyCardSnapshot>;
  if (k.siteId !== undefined && k.siteId !== null && typeof k.siteId !== 'string') {
    throw new TypeError(`restore: keycard ${id} siteId must be a string`);
  }
  return {
    doorId: requireString(k.doorId, `restore: keycard ${id} doorId must be a non-empty string`),
    label: requireString(k.label, `restore: keycard ${id} label must be a non-empty string`),
    siteId: (k.siteId as string | null | undefined) ?? null,
  };
}

/**
 * Re-apply the shared {@link PatrolSnapshot} state machine. Every patrol
 * hostile round-trips this identically; subclass extras (Sniper `aimTargetId`,
 * Flanker `slideConcealed`) are applied by their registry `apply` hooks.
 */
function restorePatrolState(
  entity: PatrolHostile,
  extra: EntitySnapshotExtra,
  rec: RunEntitySnapshot
): void {
  const patrol = extra as Partial<PatrolSnapshot>;
  if (patrol.state && !KNOWN_PATROL_STATES.has(patrol.state as PatrolHostile['state'])) {
    throw new Error(`restore: ${rec.archetype} ${rec.id} has unknown state "${patrol.state}"`);
  }
  if (patrol.state) entity.state = patrol.state as PatrolHostile['state'];
  if (patrol.lastKnownTarget) {
    const lk = patrol.lastKnownTarget;
    if (!Number.isInteger(lk.x) || !Number.isInteger(lk.y)) {
      throw new TypeError(
        `restore: ${rec.archetype} ${rec.id} lastKnownTarget must have integer coords`
      );
    }
    entity.lastKnownTarget = { x: lk.x, y: lk.y };
  }
  if (Number.isInteger(patrol.patrolIndex)) {
    const idx = patrol.patrolIndex as number;
    const len = entity.patrolWaypoints.length;
    // Bounds-check against the restored waypoint list — `takeTurnSteps`
    // dereferences `patrolWaypoints[patrolIndex]` without a guard, so a stale
    // or corrupt index would crash mid-turn. Fail loudly here instead.
    if (idx < 0 || (len > 0 && idx >= len)) {
      throw new RangeError(
        `restore: ${rec.archetype} ${rec.id} patrolIndex=${idx} out of [0, ${len})`
      );
    }
    entity.patrolIndex = len > 0 ? idx : 0;
  }
  restoreOverrideState(entity, patrol, rec);
}

/**
 * Re-apply Decker drone-override bookkeeping (P3.M2). The two fields travel as
 * a pair: a live hijack has a positive countdown *and* a recorded prior
 * faction. Either one present without the other — or a countdown that isn't a
 * positive integer, or a prior faction that isn't a known faction — is corrupt
 * mid-override state and throws, rather than silently restoring a drone that
 * can never revert.
 */
function restoreOverrideState(
  entity: PatrolHostile,
  patrol: Partial<PatrolSnapshot>,
  rec: RunEntitySnapshot
): void {
  const hasTurns = patrol.overrideTurnsRemaining !== undefined;
  const hasPrior =
    patrol.factionBeforeOverride !== undefined && patrol.factionBeforeOverride !== null;
  if (!hasTurns && !hasPrior) return;
  if (hasTurns !== hasPrior) {
    throw new Error(
      `restore: ${rec.archetype} ${rec.id} override state is half-populated ` +
        `(turns=${patrol.overrideTurnsRemaining}, prior=${patrol.factionBeforeOverride})`
    );
  }
  const turns = patrol.overrideTurnsRemaining as number;
  if (!Number.isInteger(turns) || turns <= 0) {
    throw new RangeError(
      `restore: ${rec.archetype} ${rec.id} overrideTurnsRemaining must be a positive integer, got ${turns}`
    );
  }
  const prior = patrol.factionBeforeOverride as FactionId;
  if (!KNOWN_FACTIONS.has(prior)) {
    throw new Error(
      `restore: ${rec.archetype} ${rec.id} factionBeforeOverride "${prior}" is not a known faction`
    );
  }
  entity.overrideTurnsRemaining = turns;
  entity.factionBeforeOverride = prior;
}

type RestoreEntry = {
  /** Build constructor props from the bag (throws on missing/malformed state). */
  buildProps?: (extra: EntitySnapshotExtra, rec: RunEntitySnapshot) => Partial<RestoreEntityProps>;
  /** Post-construct state + cheap instanceof guard (throws on a mis-wired create). */
  apply?: (entity: Entity, extra: EntitySnapshotExtra, rec: RunEntitySnapshot) => void;
};

const ENTITY_RESTORE: Partial<Record<EntityArchetypeId, RestoreEntry>> = Object.freeze({
  decker: {
    // P3.M3.3: named cyber stats ride the crew extra. Absent on legacy saves
    // (base stats apply); half-populated or malformed throws.
    buildProps(extra, rec) {
      return readDeckerCyberStats(extra, rec.id);
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof Decker)) {
        throw new Error(`restore: decker entity ${rec.id} did not restore as Decker`);
      }
    },
  },
  'cyber-avatar': {
    buildProps(extra, rec) {
      const a = readCyberAvatar(extra, rec.id);
      // The HP pool rides the base entity record: maxHp IS the RAM pool,
      // damageReduction IS the ICE resistance.
      return {
        ram: rec.maxHp,
        iceResistance: rec.damageReduction ?? 0,
        intrusionStrength: a.intrusionStrength,
        callsign: a.callsign,
      };
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof CyberAvatar)) {
        throw new Error(`restore: cyber avatar entity ${rec.id} did not restore as CyberAvatar`);
      }
    },
  },
  'entry-port': {
    buildProps(extra, rec) {
      const p = extra as Partial<EntryPortSnapshot>;
      return {
        label: requireString(
          p.label,
          `restore: entry port ${rec.id} label must be a non-empty string`
        ),
      };
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof EntryPort)) {
        throw new Error(`restore: entry port entity ${rec.id} did not restore as EntryPort`);
      }
    },
  },
  'data-node': {
    buildProps(extra, rec) {
      return readDataNode(extra, rec.id);
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof DataNode)) {
        throw new Error(`restore: data node entity ${rec.id} did not restore as DataNode`);
      }
    },
  },
  tech: {
    // Re-apply the pre-built turret flag (default `true` from the Tech ctor when
    // a legacy record omits it — preserve that by only assigning when present).
    apply(entity, extra) {
      if (!(entity instanceof Tech)) return;
      const t = extra as Partial<TechSnapshot>;
      if (t.turretReady !== undefined) entity.turretReady = !!t.turretReady;
    },
  },
  sniper: {
    // Resume the pending held shot so a save during the aim telegraph resolves
    // fire-or-cancel on the next corp turn.
    apply(entity, extra) {
      if (!(entity instanceof Sniper)) return;
      const s = extra as Partial<SniperSnapshot>;
      entity.aimTargetId = typeof s.aimTargetId === 'string' ? s.aimTargetId : null;
    },
  },
  flanker: {
    apply(entity, extra, rec) {
      if (!(entity instanceof Flanker)) return;
      const f = extra as Partial<FlankerSnapshot>;
      if (typeof f.slideConcealed !== 'boolean') {
        throw new TypeError(`restore: flanker ${rec.id} slideConcealed must be boolean`);
      }
      entity.slideConcealed = f.slideConcealed;
    },
  },
  turret: {
    // range/attackDamage are tunables that survive a round-trip; passing them
    // through the ctor keeps a custom-tuned improvised turret behaving identically.
    buildProps(extra) {
      const t = extra as Partial<TurretSnapshot>;
      const props: Partial<RestoreEntityProps> = {};
      if (Number.isInteger(t.range)) props.range = t.range as number;
      if (Number.isInteger(t.attackDamage)) props.attackDamage = t.attackDamage as number;
      if (t.ownerId !== undefined) props.ownerId = (t.ownerId as string | null) ?? null;
      return props;
    },
  },
  'corp-turret': {
    buildProps(extra) {
      const t = extra as Partial<CorpTurretSnapshot>;
      const props: Partial<RestoreEntityProps> = {};
      if (Number.isInteger(t.range)) props.range = t.range as number;
      if (Number.isInteger(t.attackDamage)) props.attackDamage = t.attackDamage as number;
      return props;
    },
  },
  'relay-node': {
    buildProps(extra) {
      const r = extra as Partial<RelayNodeSnapshot>;
      return { label: typeof r.label === 'string' && r.label.length > 0 ? r.label : 'Relay node' };
    },
  },
  'jack-in-point': {
    buildProps(extra, rec) {
      const p = readJackInPoint(extra, rec.id);
      return { label: p.label, linked: p.linked };
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof JackInPoint)) {
        throw new Error(`restore: jack-in point entity ${rec.id} did not restore as JackInPoint`);
      }
    },
  },
  terminal: {
    buildProps(extra, rec) {
      const t = readTerminal(extra, rec.id);
      return {
        label: t.label,
        sliced: t.sliced,
        armed: t.armed,
        raisesAlarm: t.raisesAlarm,
        unlocksId: t.unlocksId,
      };
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof Terminal)) {
        throw new Error(`restore: terminal entity ${rec.id} did not restore as Terminal`);
      }
    },
  },
  door: {
    buildProps(extra, rec) {
      const d = readDoor(extra, rec.id);
      return { doorId: d.doorId, locked: d.locked };
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof Door)) {
        throw new Error(`restore: door entity ${rec.id} did not restore as Door`);
      }
      const expectedGlyph = entity.locked ? DOOR_LOCKED_GLYPH : DOOR_OPEN_GLYPH;
      if (rec.glyph !== expectedGlyph) {
        throw new Error(
          `restore: door ${rec.id} glyph "${rec.glyph}" disagrees with locked=${entity.locked}`
        );
      }
    },
  },
  pickup: {
    buildProps(extra, rec) {
      const p = readPickup(extra, rec.id);
      return { label: p.label, secured: p.secured, armed: p.armed };
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof Pickup)) {
        throw new Error(`restore: pickup entity ${rec.id} did not restore as Pickup`);
      }
    },
  },
  contact: {
    buildProps(extra, rec) {
      const c = readContact(extra, rec.id);
      return { label: c.label, handoffComplete: c.handoffComplete, armed: c.armed };
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof Contact)) {
        throw new Error(`restore: contact entity ${rec.id} did not restore as Contact`);
      }
    },
  },
  'deny-target': {
    buildProps(extra, rec) {
      const d = readDenyTarget(extra, rec.id);
      return { label: d.label, requiresBreach: d.requiresBreach };
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof DenyTarget)) {
        throw new Error(`restore: deny target entity ${rec.id} did not restore as DenyTarget`);
      }
    },
  },
  'sync-pad': {
    buildProps(extra, rec) {
      const s = readSyncPad(extra, rec.id);
      return { label: s.label, synced: s.synced, armed: s.armed };
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof SyncPad)) {
        throw new Error(`restore: sync pad entity ${rec.id} did not restore as SyncPad`);
      }
    },
  },
  'consumable-pickup': {
    buildProps(extra, rec) {
      const c = readConsumablePickup(extra, rec.id);
      return { consumableId: c.consumableId, label: c.label };
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof ConsumablePickup)) {
        throw new Error(
          `restore: consumable pickup entity ${rec.id} did not restore as ConsumablePickup`
        );
      }
    },
  },
  'escort-npc': {
    buildProps(extra, rec) {
      const n = readEscortNpc(extra, rec.id);
      return { label: n.label, activated: n.activated, armed: n.armed };
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof EscortNpc)) {
        throw new Error(`restore: escort NPC entity ${rec.id} did not restore as EscortNpc`);
      }
    },
  },
  keycard: {
    buildProps(extra, rec) {
      const k = readKeyCard(extra, rec.id);
      const props: Partial<RestoreEntityProps> = { doorId: k.doorId, label: k.label };
      if (k.siteId) props.siteId = k.siteId;
      return props;
    },
    apply(entity, _extra, rec) {
      if (!(entity instanceof KeyCard)) {
        throw new Error(`restore: keycard entity ${rec.id} did not restore as KeyCard`);
      }
    },
  },
});

type RestoreOptions = {
  onPersist?: (record: RunSnapshot) => void;
  onResult?: (result: RunResult) => void;
};

type RestoreCampaignOptions = {
  onPersist?: (campaign: Campaign) => void;
  onResult?: (result: RunResult) => void;
};

type CampaignCrewSnapshot = {
  archetype: CrewArchetypeId;
  id: string;
  callsign: string | null;
  flatlined: boolean;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  alive: boolean;
  inventory: Inventory | null;
  gear: Gear | null;
  /**
   * P3.M3.3: Decker named cyber stats — written for deckers only. Absent on
   * legacy saves (base stats apply); half-populated/malformed throws; present
   * on a non-decker throws.
   */
  cyber?: { ram: number; intrusion: number; iceResistance: number };
};

type CampaignActiveRunSnapshot = {
  id: string;
  type: 'run';
  state: RunState;
  crewMemberId: string;
  archetype: CrewArchetypeId;
  seed: number;
  rng: { seed: number; state: number };
  contract: RunSnapshot['contract'];
  telemetry: RunTelemetry;
  snapshot?: RunSnapshot;
};

export type CampaignSnapshot = {
  id: string;
  type: 'campaign';
  state: CampaignState;
  seed: number;
  rng: { seed: number; state: number };
  crew: CampaignCrewSnapshot[];
  /**
   * Typed salvage wallet. Pre-P2.5.M4.2 saves stored a legacy `number` here
   * (generic units); `restoreCampaign` / `migrateSalvage` buckets those into
   * `scrap` on load. New saves write the typed shape directly.
   */
  salvage: number | TypedSalvage;
  /** Campaign money. Defaults to 0 for pre-P2.M8 saves. */
  credits?: number;
  rep: number;
  meta: CampaignMeta;
  /** Phase 3 campaign arc state. Defaults to Act 1 for pre-P3 saves. */
  arc?: CampaignArc;
  deployedMemberId: string | null;
  activeRun: CampaignActiveRunSnapshot | null;
  /** Recruit candidates available this hub visit. Defaults to [] for pre-P2.M6 saves. */
  availableRecruits?: CampaignCrewSnapshot[];
  /** True if the player already recruited this hub visit. Defaults to false for pre-P2.M6 saves. */
  recruitedThisVisit?: boolean;
  /** Contract reward waiting to produce one recruit on next Hub entry. Defaults to false for pre-P2.M8 saves. */
  pendingRecruitReward?: boolean;
  /** Recruit ids that bypass the Rep gate because they were job rewards. Defaults to [] for pre-P2.M8 saves. */
  rewardRecruitIds?: string[];
  /** Crew member ids healed at Patch's clinic this Hub visit. Defaults to [] for pre-P2.5.M5.3 saves. */
  healedThisVisit?: string[];
  /** Progressive Hub introduction flags. Defaults to {} for pre-P2.5.M5.4 saves. */
  hubReveals?: HubRevealsSnapshot;
  /** Count of completed jobs. Abort extractions do not increment this arc counter. */
  completedJobs?: number;
  /** Act-2/3 deploys that drive Clock heat. Defaults to 0 for pre-P3.M1.5 saves. */
  clockJobsTaken?: number;
  /** Persistent key-item inventory (keycards). Defaults to [] for pre-P2.5.M6.2 saves. */
  keyItems?: KeyItemSnapshot[];
  /** Remembered combat locations (site roster). Defaults to [] for pre-P2.5.M7.2 saves. */
  siteRoster?: LocationSite[];
};

/** Serializable key item (P2.5.M6.2). */
export type KeyItemSnapshot = {
  id: string;
  label: string;
  doorId: string;
  siteId?: string;
};

/** Serializable shape of `Campaign.hubReveals`. */
export type HubRevealsSnapshot = {
  finnIntroduced?: boolean;
  terminalExplained?: boolean;
  terminalRecruitmentExplained?: boolean;
  clinicIntroduced?: boolean;
  scoreBriefingPresented?: boolean;
  clockBriefingPresented?: boolean;
  act3BriefingPresented?: boolean;
};

/**
 * Thin re-export so callers can keep importing `snapshot` from persistence
 * even though the implementation lives on `Run` (necessary to avoid a
 * snapshot ↔ restore import cycle). Same shape as `Run.prototype.snapshot`.
 */
export function snapshot(run: Run): RunSnapshot {
  if (!run || !(run instanceof Run)) {
    throw new TypeError('snapshot requires a Run instance');
  }
  return run.snapshot();
}

export function snapshotCampaign(campaign: Campaign): CampaignSnapshot {
  if (!campaign || !(campaign instanceof Campaign)) {
    throw new TypeError('snapshotCampaign requires a Campaign instance');
  }
  return {
    id: campaign.id,
    type: 'campaign',
    state: campaign.state,
    seed: campaign.seed,
    rng: { seed: campaign.rng.seed, state: campaign.rng.state },
    crew: campaign.crew.map(snapshotCrewMember),
    salvage: campaign.salvage,
    credits: campaign.credits,
    rep: campaign.rep,
    meta: { ...campaign.meta },
    arc: { ...campaign.arc },
    deployedMemberId: campaign.deployedMemberId,
    activeRun: campaign.activeRun ? snapshotActiveRun(campaign.activeRun) : null,
    availableRecruits: campaign.availableRecruits.map(snapshotCrewMember),
    recruitedThisVisit: campaign.recruitedThisVisit,
    pendingRecruitReward: campaign.pendingRecruitReward,
    rewardRecruitIds: [...campaign.rewardRecruitIds],
    healedThisVisit: [...campaign.healedThisVisit],
    hubReveals: snapshotHubReveals(campaign.hubReveals),
    completedJobs: campaign.completedJobs,
    clockJobsTaken: campaign.clockJobsTaken,
    keyItems: campaign.keyItems.map(k => ({ ...k })),
    siteRoster: campaign.siteRoster.map(snapshotLocationSite),
  };
}

/** Deep-clone a roster site (including its delta list) for serialization. */
function snapshotLocationSite(site: LocationSite): LocationSite {
  return {
    id: site.id,
    seed: site.seed,
    mapWidth: site.mapWidth,
    mapHeight: site.mapHeight,
    label: site.label,
    tier: site.tier,
    scoreTarget: site.scoreTarget,
    mutationDeltas: site.mutationDeltas.map(delta => ({ ...delta })),
    seenKeys: [...site.seenKeys],
    lastVisitedJob: site.lastVisitedJob,
    ...(site.principal
      ? { principal: { ...site.principal, groups: [...site.principal.groups] } }
      : {}),
    ...(site.site ? { site: { ...site.site, groups: [...site.site.groups] } } : {}),
  };
}

/**
 * Rebuild a `Run` from a snapshot record. Returns `{ run, world, queue, rng,
 * player }` — the pieces the shell typically wires into the renderer.
 *
 * Validation is exhaustive: missing required fields, unknown archetypes, OOB
 * entity positions, grid byte length mismatches, etc. all throw with a
 * useful message.
 */
export function restore(record: unknown, options: RestoreOptions = {}) {
  validateRecord(record);

  const grid = new Grid(record.grid.w, record.grid.h);
  if (record.grid.tiles.length !== grid.tiles.length) {
    throw new Error(
      `restore: grid tile count mismatch — record ${record.grid.tiles.length}, expected ${grid.tiles.length}`
    );
  }
  for (let i = 0; i < record.grid.tiles.length; i++) {
    grid.tiles[i] = record.grid.tiles[i] & 0xff;
  }

  let player = null;
  const restoredEntities = record.entities.map(entityRec => restoreEntity(entityRec, grid));
  for (const entity of restoredEntities) {
    if (entity instanceof Crew && entity.faction === FACTION.PLAYER) {
      if (player) {
        throw new Error('restore: run snapshot has multiple player crew entities');
      }
      player = entity;
    }
  }
  if (!player) {
    throw new Error('restore: run snapshot has no player crew entity');
  }

  const run = new Run({
    id: record.id,
    crewMember: player,
    seed: record.seed,
    onPersist: options.onPersist,
    onResult: options.onResult,
  });
  run.rng = new Rng(record.rng.seed);
  run.rng.setState(record.rng.state);
  run.contract = normalizeContract(record.contract);
  run.cyberspace = restoreCyberspace(
    record,
    run.contract !== null && contractRequiresCyberspace(run.contract)
  );
  run.exitTile = record.exitTile ? { ...record.exitTile } : null;
  run.telemetry = { ...record.telemetry };
  run.objectiveTimer = normalizeObjectiveTimer(record.objectiveTimer);
  run.state = record.state;
  run.bus = new EventBus();
  run.world = new World(grid, { events: run.bus });
  run.world.restoreSecuredPickups(
    normalizeObjectiveProgress(record.objectiveProgress).securedPickups
  );
  run.world.mutationDeltas = normalizeMutationDeltas(record.mutationDeltas, grid);
  if (record.alarm) {
    run.world.restoreAlarm(record.alarm);
  } else {
    run.world.alarmActive = record.alarmActive ?? false;
  }
  run.restoreMapMemory(normalizeMapMemory(record.mapMemory));
  normalizeRunKeyItems(record.keyItems).forEach(k => run.addKeyItem(k));

  // Phase 2.9: the hostile slot is the run's single allegiance (CORP or RIVAL),
  // derived from the restored contract principal — keeping the queue consistent
  // with how `Run.enterCombat` built it.
  const factionOrder = [FACTION.PLAYER, run.hostileFaction];
  run.queue = new TurnQueue(factionOrder);
  run.queue.turnNumber = record.turnNumber;
  const factionIndex = factionOrder.indexOf(record.currentFaction);
  if (factionIndex < 0) {
    throw new Error(
      `restore: currentFaction "${record.currentFaction}" not in run faction order ` +
        `[${factionOrder.join(', ')}]`
    );
  }
  run.queue.index = factionIndex;

  for (const entity of restoredEntities) {
    run.world.addEntity(entity);
    if (entity instanceof PatrolHostile) {
      entity.bindToBus(run.bus);
    }
    if (entity === player) {
      run.player = player;
    }
  }
  if (run.state === RUN_STATE.COMBAT && !run.player) {
    throw new Error(
      `restore: COMBAT snapshot has no player entity matching archetype "${run.archetype}"`
    );
  }

  if (run.state === RUN_STATE.COMBAT) {
    run._reattachCombatListeners();
  }

  return { run, world: run.world, queue: run.queue, rng: run.rng, player: run.player };
}

/**
 * P3.M3: rebuild the Cyberspace state machine from its snapshot block.
 *
 * Invariant (both directions): a contract with a Cyberspace component
 * (`contractRequiresCyberspace`) carries a `cyberspace` block, and only such
 * contracts do. Any mismatch, unknown phase, payload smuggled onto the
 * `dormant`/`resolved` phases, or a partial `active` block is tier-1 corrupt
 * state and throws.
 */
function restoreCyberspace(
  record: RunSnapshot,
  requiresCyberspace: boolean
): CyberspaceState | null {
  const block = record.cyberspace;
  if (!requiresCyberspace) {
    if (block !== undefined && block !== null) {
      throw new Error(
        'restore: cyberspace block present on a contract without a Cyberspace component'
      );
    }
    return null;
  }
  if (block === undefined || block === null) {
    throw new Error('restore: Cyberspace contract snapshot is missing its cyberspace block');
  }
  if (typeof block !== 'object' || Array.isArray(block)) {
    throw new TypeError('restore: cyberspace block must be an object');
  }
  const phase = (block as { phase?: unknown }).phase;
  if (phase === 'dormant') {
    assertCyberspaceBlockKeys(block, ['phase'], 'dormant');
    return { phase: 'dormant' };
  }
  if (phase === 'resolved') {
    assertCyberspaceBlockKeys(block, ['phase', 'objectiveComplete'], 'resolved');
    const latch = (block as { objectiveComplete?: unknown }).objectiveComplete;
    if (typeof latch !== 'boolean') {
      throw new TypeError('restore: resolved cyberspace block requires boolean objectiveComplete');
    }
    return { phase: 'resolved', objectiveComplete: latch };
  }
  if (phase === 'active') {
    assertCyberspaceBlockKeys(
      block,
      ['phase', 'grid', 'entities', 'entryTile', 'alarm', 'mapMemory'],
      'active'
    );
    return {
      phase: 'active',
      layer: restoreCyberspaceLayer(
        record,
        block as Extract<NonNullable<RunSnapshot['cyberspace']>, { phase: 'active' }>
      ),
    };
  }
  throw new Error(`restore: unknown cyberspace phase "${String(phase)}"`);
}

/** Cross-phase payload smuggling (e.g. a grid on `resolved`) is corrupt — throw. */
function assertCyberspaceBlockKeys(block: object, allowed: readonly string[], phase: string): void {
  const rogue = Object.keys(block).filter(key => !allowed.includes(key));
  if (rogue.length > 0) {
    throw new Error(
      `restore: ${phase} cyberspace block carries illegal payload [${rogue.join(', ')}]`
    );
  }
}

/**
 * P3.M3.3: rebuild the live cyber layer. Every field of the `active` block is
 * required; entities are bounds-checked against the *cyber* grid via the same
 * `restoreEntity` codec as the meat world. Exactly one avatar and one exit
 * port must exist (the avatar must be alive while the run is mid-COMBAT —
 * avatar death transitions to RESULT before the snapshot is cut).
 */
function restoreCyberspaceLayer(
  record: RunSnapshot,
  block: Extract<NonNullable<RunSnapshot['cyberspace']>, { phase: 'active' }>
): CyberspaceLayer {
  const gridRec = block.grid;
  if (!gridRec || !Number.isInteger(gridRec.w) || !Number.isInteger(gridRec.h)) {
    throw new TypeError('restore: active cyberspace block requires a grid with integer w/h');
  }
  if (!Array.isArray(gridRec.tiles)) {
    throw new TypeError('restore: active cyberspace block requires a grid tiles array');
  }
  const grid = new Grid(gridRec.w, gridRec.h);
  if (gridRec.tiles.length !== grid.tiles.length) {
    throw new Error(
      `restore: cyberspace grid tile count mismatch — record ${gridRec.tiles.length}, ` +
        `expected ${grid.tiles.length}`
    );
  }
  for (let i = 0; i < gridRec.tiles.length; i++) {
    const tile = gridRec.tiles[i];
    // Cyber maps are FLOOR/WALL only by construction (`buildCyberMap`); any
    // other tile id is corruption, not an old save.
    if (tile !== TILE.FLOOR && tile !== TILE.WALL) {
      throw new Error(`restore: cyberspace grid tile ${i} has non-cyber tile id ${tile}`);
    }
    grid.tiles[i] = tile;
  }

  const entryTile = block.entryTile;
  if (!entryTile || !Number.isInteger(entryTile.x) || !Number.isInteger(entryTile.y)) {
    throw new TypeError('restore: active cyberspace block requires an integer entryTile');
  }
  if (!grid.inBounds(entryTile.x, entryTile.y) || !grid.isPassable(entryTile.x, entryTile.y)) {
    throw new RangeError(
      `restore: cyberspace entryTile (${entryTile.x}, ${entryTile.y}) is not a passable cyber tile`
    );
  }

  if (!Array.isArray(block.entities)) {
    throw new TypeError('restore: active cyberspace block requires an entities array');
  }
  if (!block.alarm) {
    throw new Error('restore: active cyberspace block requires alarm state');
  }
  if (!block.mapMemory || !Array.isArray(block.mapMemory.seen)) {
    throw new TypeError('restore: active cyberspace block requires mapMemory with a seen array');
  }

  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  world.restoreAlarm(block.alarm);

  let avatar: CyberAvatar | null = null;
  let port: EntryPort | null = null;
  let dataNodes = 0;
  for (const rec of block.entities) {
    const entity = restoreEntity(rec, grid);
    if (entity instanceof DataNode) dataNodes++;
    if (entity instanceof CyberAvatar) {
      if (avatar) {
        throw new Error('restore: active cyberspace block has multiple cyber-avatar entities');
      }
      avatar = entity;
    }
    if (entity instanceof EntryPort) {
      if (port) {
        throw new Error('restore: active cyberspace block has multiple entry-port entities');
      }
      port = entity;
    }
    world.addEntity(entity);
    if (entity instanceof PatrolHostile) {
      entity.bindToBus(bus);
    }
  }
  if (!avatar) {
    throw new Error('restore: active cyberspace block has no cyber-avatar');
  }
  if (record.state === RUN_STATE.COMBAT && !avatar.alive) {
    throw new Error('restore: COMBAT snapshot carries a dead cyber-avatar in an active layer');
  }
  if (!port) {
    throw new Error('restore: active cyberspace block has no entry-port');
  }
  // P3.M3.4: nodes never despawn (sliced nodes stay in the world), so the
  // entity count must equal the contract objective's count exactly.
  const requiredNodes = (record.contract?.objective?.params as { count?: unknown } | undefined)
    ?.count;
  if (!Number.isInteger(requiredNodes) || (requiredNodes as number) <= 0) {
    throw new TypeError('restore: cyber contract objective count must be a positive integer');
  }
  if (dataNodes !== requiredNodes) {
    throw new Error(
      `restore: active cyberspace block has ${dataNodes} data-node entities, ` +
        `contract requires ${requiredNodes}`
    );
  }

  const layer = new CyberspaceLayer({ bus, world, avatar, port, entryTile });
  layer.recordSeen(block.mapMemory.seen);
  return layer;
}

export function restoreCampaign(record: unknown, options: RestoreCampaignOptions = {}): Campaign {
  validateCampaignRecord(record);
  const crew = record.crew.map(restoreCrewMember);
  const campaign = new Campaign({
    id: record.id,
    seed: record.seed,
    crew,
    salvage: record.salvage,
    credits: record.credits ?? 0,
    rep: record.rep,
    meta: record.meta,
    arc: record.arc,
    hubReveals: normalizeHubReveals(
      migrateLegacyHubReveals(record.hubReveals, {
        rep: record.rep,
        pendingRecruitReward: record.pendingRecruitReward,
      }),
      'restoreCampaign hubReveals'
    ),
    completedJobs: record.completedJobs ?? 0,
    clockJobsTaken: record.clockJobsTaken ?? 0,
    keyItems: record.keyItems,
    siteRoster: record.siteRoster,
    onPersist: options.onPersist,
    onResult: options.onResult,
  });
  campaign.rng = new Rng(record.rng.seed);
  campaign.rng.setState(record.rng.state);

  // Restore recruitment state (overrides whatever enterHub() generated during
  // construction — the constructor's rng state was wrong until above).
  campaign.availableRecruits = (record.availableRecruits ?? []).map(restoreCrewMember);
  campaign.recruitedThisVisit = record.recruitedThisVisit ?? false;
  campaign.pendingRecruitReward = record.pendingRecruitReward ?? false;
  campaign.rewardRecruitIds = new Set(record.rewardRecruitIds ?? []);
  campaign.healedThisVisit = new Set(record.healedThisVisit ?? []);

  if (record.activeRun) {
    const member = campaign.getCrewMember(record.activeRun.crewMemberId);
    if (!member) {
      throw new Error(
        `restoreCampaign: activeRun references unknown crew "${record.activeRun.crewMemberId}"`
      );
    }
    campaign.activeRun = restoreActiveRun(record.activeRun, member, {
      onPersist: () => options.onPersist?.(campaign),
      onResult: options.onResult,
    });
    // M7.2: a run resumed at BRIEFING has not yet built its map — re-derive the
    // prior-visit deltas from the (already-restored) roster so the upcoming
    // enterCombat replays them. COMBAT/RESULT runs restore their full snapshot
    // (grid mutations already baked in), so they need no re-seeding here.
    if (campaign.activeRun.state === RUN_STATE.BRIEFING && campaign.activeRun.contract) {
      campaign.activeRun.priorMutationDeltas = campaign.priorDeltasForContract(
        campaign.activeRun.contract
      );
      campaign.activeRun.refreshPriorSiteMemory(
        campaign.priorSeenKeysForContract(campaign.activeRun.contract)
      );
      campaign.activeRun.priorKeyItems = campaign.priorKeyItemsForContract(
        campaign.activeRun.contract
      );
    }
    campaign.deployedMemberId = member.id;
    campaign.state = CAMPAIGN_STATE.COMBAT;
    campaign.world = null;
    campaign.queue = null;
    campaign.bus = null;
    campaign.player = null;
    campaign.curator = null;
    campaign.finn = null;
    campaign.terminal = null;
    campaign.clinic = null;
    campaign.exitTile = null;
  } else {
    campaign.state = record.state;
  }

  if (record.state === CAMPAIGN_STATE.ENDED) {
    campaign.state = CAMPAIGN_STATE.ENDED;
    campaign.world = null;
    campaign.queue = null;
    campaign.bus = null;
    campaign.player = null;
    campaign.curator = null;
    campaign.finn = null;
    campaign.terminal = null;
    campaign.clinic = null;
    campaign.exitTile = null;
  }

  return campaign;
}

function restoreEntity(rec: RunEntitySnapshot, grid: Grid): Entity {
  if (!rec || typeof rec !== 'object') {
    throw new TypeError('restore: entity record missing');
  }
  const factory = ARCHETYPE_FACTORY[rec.archetype];
  if (!factory) {
    throw new Error(`restore: unknown archetype "${rec.archetype}"`);
  }
  if (!Number.isInteger(rec.x) || !Number.isInteger(rec.y)) {
    throw new TypeError(`restore: entity ${rec.id} requires integer x,y; got (${rec.x}, ${rec.y})`);
  }
  if (!grid.inBounds(rec.x, rec.y)) {
    throw new RangeError(
      `restore: entity ${rec.id} at (${rec.x}, ${rec.y}) is out of bounds for ${grid.width}x${grid.height} grid`
    );
  }
  if (!Number.isInteger(rec.hp) || rec.hp < 0) {
    throw new RangeError(`restore: entity ${rec.id} has invalid hp=${rec.hp}`);
  }
  if (!Number.isInteger(rec.maxHp) || rec.maxHp <= 0) {
    throw new RangeError(`restore: entity ${rec.id} has invalid maxHp=${rec.maxHp}`);
  }
  if (
    rec.damageReduction !== undefined &&
    (!Number.isInteger(rec.damageReduction) || rec.damageReduction < 0)
  ) {
    throw new RangeError(
      `restore: entity ${rec.id} has invalid damageReduction=${rec.damageReduction}`
    );
  }
  if (rec.shieldHp !== undefined && (!Number.isInteger(rec.shieldHp) || rec.shieldHp < 0)) {
    throw new RangeError(`restore: entity ${rec.id} has invalid shieldHp=${rec.shieldHp}`);
  }
  if (rec.faction && !KNOWN_FACTIONS.has(rec.faction)) {
    throw new Error(`restore: entity ${rec.id} has unknown faction "${rec.faction}"`);
  }

  const extra = normalizeEntityExtra(rec);
  const entry = ENTITY_RESTORE[rec.archetype];

  const entityProps: RestoreEntityProps = {
    id: rec.id,
    x: rec.x,
    y: rec.y,
    maxAp: rec.maxAp,
    maxHp: rec.maxHp,
    damageReduction: rec.damageReduction ?? 0,
    shieldHp: rec.shieldHp ?? 0,
  };
  if (isCrewArchetype(rec.archetype)) {
    const crew = extra as Partial<CrewSnapshot>;
    entityProps.callsign = crew.callsign ?? null;
    entityProps.flatlined = !!crew.flatlined;
    entityProps.inventory = crew.inventory ?? null;
    entityProps.gear = crew.gear ?? null;
  }
  if (isPatrolArchetype(rec.archetype)) {
    entityProps.patrolWaypoints = (extra as Partial<PatrolSnapshot>).patrolWaypoints ?? [];
  }
  if (entry?.buildProps) Object.assign(entityProps, entry.buildProps(extra, rec));

  const entity = factory(entityProps);
  // Re-apply the live HP / AP / alive / stealth state. We can't pass current
  // HP through the constructor (Entity always starts at full health), so we
  // assign post-construction. This is the boundary where a corrupt record
  // (hp > maxHp, alive but hp 0) needs to crash, not silently round.
  if (rec.hp > rec.maxHp) {
    throw new RangeError(`restore: entity ${rec.id} hp=${rec.hp} exceeds maxHp=${rec.maxHp}`);
  }
  if (rec.alive === false && rec.hp > 0) {
    throw new Error(`restore: entity ${rec.id} flagged dead with hp=${rec.hp}`);
  }
  if (rec.alive === true && rec.hp === 0) {
    throw new Error(`restore: entity ${rec.id} flagged alive with hp=0`);
  }
  if (rec.alive === false && (rec.shieldHp ?? 0) > 0) {
    throw new Error(`restore: entity ${rec.id} flagged dead with shieldHp=${rec.shieldHp}`);
  }
  entity.hp = rec.hp;
  entity.alive = rec.alive ?? rec.hp > 0;
  entity.shieldHp = rec.shieldHp ?? 0;
  if (Number.isInteger(rec.ap)) {
    if (rec.ap < 0 || rec.ap > entity.maxAp) {
      throw new RangeError(`restore: entity ${rec.id} ap=${rec.ap} out of [0, ${entity.maxAp}]`);
    }
    entity.ap = rec.ap;
  }
  entity.stealthed = !!rec.stealthed;
  if (rec.faction) entity.faction = rec.faction;
  if (rec.glyph) entity.glyph = rec.glyph;
  // Phase 2.9 principal theming. Missing on pre-2.9 saves → stays undefined and
  // `entityLabel` falls back to `kindFromId` (backward compatible).
  if (rec.displayName !== undefined) entity.displayName = rec.displayName;
  if (rec.principalTag !== undefined) entity.principalTag = rec.principalTag;

  // Repair latent gear overflow on crew entities (same as restoreCrewMember).
  if (entity instanceof Crew) {
    repairGearForCrew(entity);
  }

  // Patrol hostiles share one state-machine block; subclass extras land in apply.
  if (isPatrolArchetype(rec.archetype)) {
    if (!(entity instanceof PatrolHostile)) {
      throw new Error(
        `restore: ${rec.archetype} entity ${rec.id} did not restore as a PatrolHostile`
      );
    }
    restorePatrolState(entity, extra, rec);
  }

  // Per-archetype post-construct state + cheap instanceof guards.
  entry?.apply?.(entity, extra, rec);

  // Stash archetype tag on the instance so the caller can later recover the
  // player from a heterogeneous entity set.
  (entity as Entity & { [ARCHETYPE_KEY]?: EntityArchetypeId })[ARCHETYPE_KEY] = rec.archetype;
  return entity;
}

function validateRecord(record: unknown): asserts record is RunSnapshot {
  if (!record || typeof record !== 'object') {
    throw new TypeError('restore: record must be an object');
  }
  const candidate = record as Partial<RunSnapshot>;
  if (candidate.type !== 'run') {
    throw new Error(`restore: record.type must be "run", got "${candidate.type}"`);
  }
  if (!candidate.state || !KNOWN_RUN_STATES.has(candidate.state)) {
    throw new Error(`restore: unknown run state "${candidate.state}"`);
  }
  if (!candidate.archetype || !KNOWN_ARCHETYPES_SET.has(candidate.archetype)) {
    throw new Error(`restore: unknown archetype "${candidate.archetype}"`);
  }
  if (!Number.isFinite(candidate.seed)) {
    throw new TypeError('restore: record.seed must be a finite number');
  }
  if (
    !candidate.rng ||
    !Number.isFinite(candidate.rng.seed) ||
    !Number.isFinite(candidate.rng.state)
  ) {
    throw new TypeError('restore: record.rng requires {seed, state}');
  }
  if (
    !candidate.grid ||
    !Number.isInteger(candidate.grid.w) ||
    !Number.isInteger(candidate.grid.h)
  ) {
    throw new TypeError('restore: record.grid requires integer w/h');
  }
  if (!Array.isArray(candidate.grid.tiles)) {
    throw new TypeError('restore: record.grid.tiles must be an array');
  }
  const turnNumber = candidate.turnNumber;
  if (!Number.isInteger(turnNumber) || turnNumber === undefined || turnNumber < 1) {
    throw new RangeError(`restore: record.turnNumber must be ≥ 1, got ${turnNumber}`);
  }
  if (!Array.isArray(candidate.entities)) {
    throw new TypeError('restore: record.entities must be an array');
  }
}

const KNOWN_ARCHETYPES_SET = new Set<CrewArchetypeId>(['merc', 'razor', 'tech', 'decker']);

/** Clamp gear bonuses to archetype caps after restore. */
function repairGearForCrew(member: Crew) {
  if (!member.gear) return;
  const gear = member.gear;
  if (gear.hitBonus > member.maxHitBonus) {
    gear.hitBonus = member.maxHitBonus;
  }
  const dodgeBonus = gear.dodgeBonus ?? 0;
  if (dodgeBonus > member.maxDodgeBonus) {
    gear.dodgeBonus = member.maxDodgeBonus;
  }
  const rangedBonus = gear.rangedDamageBonus ?? 0;
  if (rangedBonus > member.maxRangedDamageBonus) {
    gear.rangedDamageBonus = member.maxRangedDamageBonus;
  }
}

function snapshotCrewMember(member: Crew): CampaignCrewSnapshot {
  const archetype = archetypeOfCrew(member);
  return {
    archetype,
    id: member.id,
    callsign: member.callsign,
    flatlined: !!member.flatlined,
    hp: member.hp,
    maxHp: member.maxHp,
    ap: member.ap,
    maxAp: member.maxAp,
    alive: !!member.alive,
    inventory: member.inventory,
    gear: member.gear,
    // P3.M3.3: Decker cyber stats persist through the campaign crew path too.
    ...(member instanceof Decker
      ? {
          cyber: {
            ram: member.ram,
            intrusion: member.intrusionStrength,
            iceResistance: member.iceResistance,
          },
        }
      : {}),
  };
}

/**
 * P3.M3.3: validate + translate the campaign crew `cyber` block into Decker
 * ctor props. Absent → `{}` (legacy save, base stats). Present on a
 * non-decker, half-populated, or malformed → throw.
 */
function readCampaignCrewCyber(rec: CampaignCrewSnapshot): Partial<DeckerInit> {
  const cyber = rec.cyber;
  if (cyber === undefined || cyber === null) return {};
  if (rec.archetype !== 'decker') {
    throw new Error(`restoreCampaign: crew "${rec.id}" carries cyber stats but is not a decker`);
  }
  if (typeof cyber !== 'object' || Array.isArray(cyber)) {
    throw new TypeError(`restoreCampaign: crew "${rec.id}" cyber block must be an object`);
  }
  if (!Number.isInteger(cyber.ram) || cyber.ram <= 0) {
    throw new TypeError(`restoreCampaign: crew "${rec.id}" cyber.ram must be a positive integer`);
  }
  if (!Number.isInteger(cyber.intrusion) || cyber.intrusion <= 0) {
    throw new TypeError(
      `restoreCampaign: crew "${rec.id}" cyber.intrusion must be a positive integer`
    );
  }
  if (!Number.isInteger(cyber.iceResistance) || cyber.iceResistance < 0) {
    throw new TypeError(
      `restoreCampaign: crew "${rec.id}" cyber.iceResistance must be a non-negative integer`
    );
  }
  return {
    ram: cyber.ram,
    intrusionStrength: cyber.intrusion,
    iceResistance: cyber.iceResistance,
  };
}

function restoreCrewMember(rec: CampaignCrewSnapshot): Crew {
  if (!rec || typeof rec !== 'object') {
    throw new TypeError('restoreCampaign: crew member record missing');
  }
  if (!KNOWN_ARCHETYPES_SET.has(rec.archetype)) {
    throw new Error(`restoreCampaign: unknown crew archetype "${rec.archetype}"`);
  }
  if (typeof rec.id !== 'string' || rec.id.length === 0) {
    throw new TypeError('restoreCampaign: crew member id must be a non-empty string');
  }
  // Migrate legacy `inventory.salvage: number` (pre-P2.5.M4.2) into the typed
  // wallet before the archetype factory consumes it. `migrateSalvage` handles
  // both shapes and crashes on anything else — silent fallback would corrupt
  // the wallet on every reload.
  let inventory = rec.inventory ?? null;
  if (inventory && 'salvage' in inventory) {
    inventory = {
      ...inventory,
      salvage: migrateSalvage(
        inventory.salvage,
        `restoreCampaign: crew "${rec.id}" inventory.salvage`
      ),
    };
  }
  const factory = ARCHETYPE_FACTORY[rec.archetype];
  const member = factory({
    id: rec.id,
    x: 0,
    y: 0,
    callsign: rec.callsign,
    flatlined: !!rec.flatlined,
    inventory,
    gear: rec.gear ?? null,
    maxHp: rec.maxHp,
    maxAp: rec.maxAp,
    // P3.M3.3: Decker cyber stats (validated; throws on a non-decker record).
    ...readCampaignCrewCyber(rec),
  });
  if (!(member instanceof Crew)) {
    throw new Error(`restoreCampaign: crew archetype "${rec.archetype}" did not restore as Crew`);
  }
  if (Number.isInteger(rec.hp)) member.hp = rec.hp;
  if (Number.isInteger(rec.ap)) member.ap = rec.ap;
  member.alive = rec.alive ?? member.hp > 0;

  // Repair latent gear overflow.
  repairGearForCrew(member);

  return member;
}

function snapshotActiveRun(run: Run): CampaignActiveRunSnapshot {
  if (!run.state) {
    throw new Error('snapshotActiveRun: run has no state');
  }
  const base: Omit<CampaignActiveRunSnapshot, 'snapshot'> = {
    id: run.id,
    type: 'run',
    state: run.state,
    crewMemberId: run.crewMember.id,
    archetype: run.archetype,
    seed: run.seed,
    rng: { seed: run.rng.seed, state: run.rng.state },
    contract: normalizeContract(run.contract),
    telemetry: { ...run.telemetry },
  };
  if (run.state === RUN_STATE.COMBAT || run.state === RUN_STATE.RESULT) {
    return { ...base, snapshot: snapshot(run) };
  }
  return base;
}

function restoreActiveRun(
  record: CampaignActiveRunSnapshot,
  member: Crew,
  options: RestoreOptions
): Run {
  if (record.snapshot) {
    const restored = restore(record.snapshot, options).run;
    restored.crewMember = member;
    return restored;
  }
  const run = new Run({
    id: record.id,
    crewMember: member,
    seed: record.seed,
    onPersist: options.onPersist,
    onResult: options.onResult,
  });
  run.rng = new Rng(record.rng.seed);
  run.rng.setState(record.rng.state);
  run.contract = normalizeContract(record.contract);
  run.telemetry = { ...record.telemetry };
  run.state = record.state;
  return run;
}

type LegacyContractReward = {
  credits?: unknown;
  salvage?: unknown;
  repDelta?: unknown;
  recruit?: unknown;
};

function normalizeContract(
  contract: RunSnapshot['contract'] | null | undefined
): RunSnapshot['contract'] {
  if (!contract) return null;
  const raw = contract as Omit<NonNullable<RunSnapshot['contract']>, 'reward'> & {
    reward?: LegacyContractReward;
  };
  const reward = raw.reward;
  const context = normalizeContractContext(raw.context);
  const dimensions = normalizeMapDimensions(raw.mapWidth, raw.mapHeight, 'restore: contract');
  if (!reward) {
    return {
      ...raw,
      mapWidth: dimensions.width,
      mapHeight: dimensions.height,
      objective: normalizeObjective(raw.objective),
      context,
      reward: { credits: 0, repDelta: 0 },
    };
  }
  const credits = Number.isInteger(reward.credits)
    ? (reward.credits as number)
    : Number.isInteger(reward.salvage)
      ? (reward.salvage as number) * SALVAGE_TO_CRED_RATE
      : undefined;
  if (credits === undefined || credits < 0) {
    throw new RangeError('restore: contract reward credits must be a non-negative integer');
  }
  const repDelta = reward.repDelta ?? 0;
  if (!Number.isInteger(repDelta)) {
    throw new RangeError('restore: contract reward repDelta must be an integer');
  }
  return {
    ...raw,
    mapWidth: dimensions.width,
    mapHeight: dimensions.height,
    objective: normalizeObjective(raw.objective),
    context,
    reward: {
      credits,
      repDelta: repDelta as number,
      ...(reward.recruit === true ? { recruit: true as const } : {}),
    },
  };
}

function normalizeObjectiveTimer(timer: unknown): ObjectiveTimerSnapshot {
  if (timer === undefined || timer === null) return freshObjectiveTimer();
  if (!timer || typeof timer !== 'object' || Array.isArray(timer)) {
    throw new TypeError('restore: objectiveTimer must be an object');
  }
  const candidate = timer as Partial<ObjectiveTimerSnapshot>;
  if (typeof candidate.completedWithinLimit !== 'boolean') {
    throw new TypeError('restore: objectiveTimer.completedWithinLimit must be boolean');
  }
  if (typeof candidate.expired !== 'boolean') {
    throw new TypeError('restore: objectiveTimer.expired must be boolean');
  }
  if (
    candidate.completedTurn !== null &&
    candidate.completedTurn !== undefined &&
    (!Number.isInteger(candidate.completedTurn) || candidate.completedTurn < 1)
  ) {
    throw new RangeError('restore: objectiveTimer.completedTurn must be null or turn >= 1');
  }
  if (
    candidate.expiredTurn !== null &&
    candidate.expiredTurn !== undefined &&
    (!Number.isInteger(candidate.expiredTurn) || candidate.expiredTurn < 1)
  ) {
    throw new RangeError('restore: objectiveTimer.expiredTurn must be null or turn >= 1');
  }
  if (typeof candidate.expiryAnnounced !== 'boolean') {
    throw new TypeError('restore: objectiveTimer.expiryAnnounced must be boolean');
  }
  return {
    completedWithinLimit: candidate.completedWithinLimit,
    expired: candidate.expired,
    completedTurn: candidate.completedTurn ?? null,
    expiredTurn: candidate.expiredTurn ?? null,
    expiryAnnounced: candidate.expiryAnnounced,
  };
}

function normalizeMapMemory(memory: unknown): MapMemorySnapshot | null {
  if (memory === undefined || memory === null) return null;
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('restore: mapMemory must be an object');
  }
  const candidate = memory as Partial<MapMemorySnapshot>;
  if (!Array.isArray(candidate.seen)) {
    throw new TypeError('restore: mapMemory.seen must be an array');
  }
  for (const key of candidate.seen) {
    if (typeof key !== 'string' || !/^-?\d+,-?\d+$/.test(key)) {
      throw new TypeError('restore: mapMemory.seen entries must be coordinate strings');
    }
  }
  return { seen: [...candidate.seen] };
}

function normalizeObjectiveProgress(progress: unknown): ObjectiveProgressSnapshot {
  if (progress === undefined || progress === null) return { securedPickups: [] };
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    throw new TypeError('restore: objectiveProgress must be an object');
  }
  const candidate = progress as Partial<ObjectiveProgressSnapshot>;
  if (!Array.isArray(candidate.securedPickups)) {
    throw new TypeError('restore: objectiveProgress.securedPickups must be an array');
  }
  for (const id of candidate.securedPickups) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('restore: objectiveProgress.securedPickups entries must be strings');
    }
  }
  return { securedPickups: [...candidate.securedPickups] };
}

/**
 * Normalize run-scoped key items from a snapshot (or undefined for
 * pre-P2.5.M6.2 saves). Validates structure. Crashes on malformed entries.
 */
function normalizeRunKeyItems(raw: unknown): KeyItem[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new TypeError('restore: run keyItems must be an array when supplied');
  }
  return (raw as KeyItem[]).map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new TypeError(`restore: run keyItems[${i}] must be an object`);
    }
    if (typeof item.id !== 'string' || item.id.length === 0) {
      throw new TypeError(`restore: run keyItems[${i}].id must be a non-empty string`);
    }
    if (typeof item.label !== 'string' || item.label.length === 0) {
      throw new TypeError(`restore: run keyItems[${i}].label must be a non-empty string`);
    }
    if (typeof item.doorId !== 'string' || item.doorId.length === 0) {
      throw new TypeError(`restore: run keyItems[${i}].doorId must be a non-empty string`);
    }
    return { id: item.id, label: item.label, doorId: item.doorId };
  });
}

function normalizeMutationDeltas(raw: unknown, grid: Grid): TileDelta[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new TypeError('restore: mutationDeltas must be an array when supplied');
  }
  const knownTiles = new Set<number>(Object.values(TILE));
  return raw.map((delta, i) => {
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
      throw new TypeError(`restore: mutationDeltas[${i}] must be an object`);
    }
    const rec = delta as Partial<TileDelta>;
    if (rec.kind === 'tile') {
      if (!Number.isInteger(rec.x) || !Number.isInteger(rec.y)) {
        throw new TypeError(`restore: mutationDeltas[${i}] tile delta requires integer x,y`);
      }
      const x = rec.x as number;
      const y = rec.y as number;
      if (!grid.inBounds(x, y)) {
        throw new RangeError(`restore: mutationDeltas[${i}] tile delta is out of bounds`);
      }
      if (!knownTiles.has(rec.from as number) || !knownTiles.has(rec.to as number)) {
        throw new RangeError(`restore: mutationDeltas[${i}] tile delta has unknown tile id`);
      }
      return {
        kind: 'tile',
        x,
        y,
        from: rec.from as number,
        to: rec.to as number,
      };
    }
    if (rec.kind === 'entity-removed') {
      if (typeof rec.id !== 'string' || rec.id.length === 0) {
        throw new TypeError(`restore: mutationDeltas[${i}] entity removal requires id`);
      }
      if (!Number.isInteger(rec.x) || !Number.isInteger(rec.y)) {
        throw new TypeError(`restore: mutationDeltas[${i}] entity removal requires integer x,y`);
      }
      const x = rec.x as number;
      const y = rec.y as number;
      if (!grid.inBounds(x, y)) {
        throw new RangeError(`restore: mutationDeltas[${i}] entity removal is out of bounds`);
      }
      if (typeof rec.archetype !== 'string' || rec.archetype.length === 0) {
        throw new TypeError(`restore: mutationDeltas[${i}] entity removal requires archetype`);
      }
      return {
        kind: 'entity-removed',
        id: rec.id,
        x,
        y,
        archetype: rec.archetype,
      };
    }
    throw new Error(`restore: mutationDeltas[${i}] has unknown kind "${String(rec.kind)}"`);
  });
}

function freshObjectiveTimer(): ObjectiveTimerSnapshot {
  return {
    completedWithinLimit: false,
    expired: false,
    completedTurn: null,
    expiredTurn: null,
    expiryAnnounced: false,
  };
}

function validateCampaignRecord(record: unknown): asserts record is CampaignSnapshot {
  if (!record || typeof record !== 'object') {
    throw new TypeError('restoreCampaign: record must be an object');
  }
  const candidate = record as Partial<CampaignSnapshot>;
  if (candidate.type !== 'campaign') {
    throw new Error(`restoreCampaign: record.type must be "campaign", got "${candidate.type}"`);
  }
  if (!candidate.state || !Object.values(CAMPAIGN_STATE).includes(candidate.state)) {
    throw new Error(`restoreCampaign: unknown campaign state "${candidate.state}"`);
  }
  if (!Number.isFinite(candidate.seed)) {
    throw new TypeError('restoreCampaign: record.seed must be a finite number');
  }
  if (
    !candidate.rng ||
    !Number.isFinite(candidate.rng.seed) ||
    !Number.isFinite(candidate.rng.state)
  ) {
    throw new TypeError('restoreCampaign: record.rng requires {seed, state}');
  }
  if (!Array.isArray(candidate.crew) || candidate.crew.length === 0) {
    throw new TypeError('restoreCampaign: crew must be a non-empty array');
  }
  const salvage = candidate.salvage;
  const credits = candidate.credits ?? 0;
  // Migrate legacy saves that used "vouch" → "rep"
  const legacy = candidate as Record<string, unknown>;
  if (candidate.rep === undefined && legacy.vouch !== undefined) {
    candidate.rep = legacy.vouch as number;
    delete legacy.vouch;
  }
  const rep = candidate.rep;
  // Accept either a legacy non-negative integer (pre-P2.5.M4.2 saves) or a
  // structurally valid TypedSalvage wallet. The Campaign constructor runs
  // `migrateSalvage` to normalize the field; here we only ensure the shape
  // is one of the two recognized forms — anything else is data corruption
  // and crashes the load (per project policy).
  if (typeof salvage === 'number') {
    if (!Number.isInteger(salvage) || salvage < 0) {
      throw new RangeError('restoreCampaign: legacy salvage must be a non-negative integer');
    }
  } else if (salvage === null || typeof salvage !== 'object' || Array.isArray(salvage)) {
    throw new TypeError('restoreCampaign: salvage must be a number (legacy) or TypedSalvage');
  } else {
    // TypedSalvage validation is deferred to `migrateSalvage` in the
    // Campaign constructor — duplicating it here would just risk drift.
  }
  if (!Number.isInteger(credits) || credits < 0) {
    throw new RangeError('restoreCampaign: credits must be a non-negative integer');
  }
  if (!Number.isInteger(rep) || rep === undefined || rep < 0 || rep > 100) {
    throw new RangeError('restoreCampaign: rep must be an integer in [0, 100]');
  }
  if (
    candidate.meta === null ||
    typeof candidate.meta !== 'object' ||
    Array.isArray(candidate.meta)
  ) {
    throw new TypeError('restoreCampaign: meta must be an object');
  }
  if (candidate.arc !== undefined) {
    normalizeCampaignArc(candidate.arc, 'restoreCampaign arc');
  }
  if (candidate.state === CAMPAIGN_STATE.COMBAT && !candidate.activeRun) {
    throw new Error('restoreCampaign: COMBAT state requires activeRun');
  }
  // Recruitment fields are optional for backwards compat with pre-P2.M6 saves.
  if (candidate.availableRecruits !== undefined && !Array.isArray(candidate.availableRecruits)) {
    throw new TypeError('restoreCampaign: availableRecruits must be an array when present');
  }
  if (
    candidate.recruitedThisVisit !== undefined &&
    typeof candidate.recruitedThisVisit !== 'boolean'
  ) {
    throw new TypeError('restoreCampaign: recruitedThisVisit must be a boolean when present');
  }
  if (candidate.healedThisVisit !== undefined && !Array.isArray(candidate.healedThisVisit)) {
    throw new TypeError('restoreCampaign: healedThisVisit must be an array when present');
  }
  if (candidate.hubReveals !== undefined) {
    normalizeHubReveals(candidate.hubReveals, 'restoreCampaign hubReveals');
  }
  if (candidate.completedJobs !== undefined) {
    if (!Number.isInteger(candidate.completedJobs) || candidate.completedJobs < 0) {
      throw new RangeError('restoreCampaign: completedJobs must be a non-negative integer');
    }
  }
  if (candidate.clockJobsTaken !== undefined) {
    if (!Number.isInteger(candidate.clockJobsTaken) || candidate.clockJobsTaken < 0) {
      throw new RangeError('restoreCampaign: clockJobsTaken must be a non-negative integer');
    }
  }
  if (candidate.siteRoster !== undefined) {
    if (!Array.isArray(candidate.siteRoster)) {
      throw new TypeError('restoreCampaign: siteRoster must be an array when present');
    }
    // Validate each entry up front so a corrupt roster crashes on load rather
    // than producing a bad map on a later revisit.
    candidate.siteRoster.forEach(entry => normalizeLocationSite(entry));
  }
}

function archetypeOfCrew(member: Crew): CrewArchetypeId {
  if (member instanceof Merc) return 'merc';
  if (member instanceof Razor) return 'razor';
  if (member instanceof Tech) return 'tech';
  if (member instanceof Decker) return 'decker';
  throw new Error(`snapshotCampaign: cannot classify crew member ${member?.id}`);
}

function isCrewArchetype(value: string): value is CrewArchetypeId {
  return KNOWN_ARCHETYPES_SET.has(value as CrewArchetypeId);
}
