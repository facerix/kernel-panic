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
 *     entities:   [{ archetype, id, x, y, faction, hp, maxHp, ap, maxAp,
 *                    stealthed, drone?: { state, lastKnownTarget,
 *                    patrolWaypoints, patrolIndex } }, …],
 *     telemetry:  { turn, kills, archetype, seed, … },
 *   }
 *
 * `restore(record)` rebuilds a fresh Run + World + TurnQueue from the
 * record. Anything missing or out of bounds throws — silent fallback would
 * resurrect a corrupt run instead of crashing on the spot.
 *
 * The plain-array grid encoding (vs. base64 of a `Uint8Array`) is the user's
 * pick for M8: ~3× larger on disk than base64 but trivially portable across
 * browser + `node --test`, and a 24×16 grid is 384 bytes either way.
 */

import { Rng } from '../rng.js';
import { Grid } from './Grid.js';
import { World } from './World.js';
import { TurnQueue } from './TurnQueue.js';
import { EventBus } from './events.js';
import { FACTION, SALVAGE_TO_CRED_RATE } from './constants.js';
import { migrateSalvage, type TypedSalvage } from './salvage.js';
import { Entity } from './Entity.js';
import { Crew } from './Crew.js';
import { Merc } from './archetypes/Merc.js';
import { Razor } from './archetypes/Razor.js';
import { Tech } from './archetypes/Tech.js';
import { Turret } from './Turret.js';
import { CorpDrone, DRONE_STATE } from './ai/CorpDrone.js';
import { CorpCivilian } from './entities/CorpCivilian.js';
import { NeutralCivilian } from './entities/NeutralCivilian.js';
import { Terminal } from './entities/Terminal.js';
import { Pickup } from './entities/Pickup.js';
import { Contact } from './entities/Contact.js';
import { DenyTarget } from './entities/DenyTarget.js';
import { SyncPad } from './entities/SyncPad.js';
import { CorpTurret } from './entities/CorpTurret.js';
import { RelayNode } from './entities/RelayNode.js';
import { EscortNpc } from './entities/EscortNpc.js';
import { Run, RUN_STATE } from './Run.js';
import { Campaign, CAMPAIGN_STATE } from './Campaign.js';
import { normalizeContractContext, normalizeObjective } from './hub/Curator.js';
import type { CrewInit } from './Crew.js';
import type { Inventory, Gear } from './Crew.js';
import type { TurretInit } from './Turret.js';
import type { CorpDroneProps } from './ai/CorpDrone.js';
import type { CorpCivilianInit } from './entities/CorpCivilian.js';
import type { NeutralCivilianInit } from './entities/NeutralCivilian.js';
import type { TerminalInit } from './entities/Terminal.js';
import type { PickupInit } from './entities/Pickup.js';
import type { ContactInit } from './entities/Contact.js';
import type { DenyTargetInit } from './entities/DenyTarget.js';
import type { SyncPadInit } from './entities/SyncPad.js';
import type { CorpTurretInit } from './entities/CorpTurret.js';
import type { RelayNodeInit } from './entities/RelayNode.js';
import type { EscortNpcInit } from './entities/EscortNpc.js';
import type { EntityInit } from './Entity.js';
import type { FactionId } from './constants.js';
import type {
  CrewArchetypeId,
  EntityArchetypeId,
  RunEntitySnapshot,
  RunResult,
  RunSnapshot,
  RunState,
  RunTelemetry,
  ObjectiveTimerSnapshot,
  MapMemorySnapshot,
} from './Run.js';
import type { CampaignMeta, CampaignState } from './Campaign.js';

const ARCHETYPE_KEY = Symbol.for('kernel-panic.archetype');

type RestoreEntityProps = Partial<
  CrewInit &
    TurretInit &
    CorpDroneProps &
    CorpCivilianInit &
    NeutralCivilianInit &
    EntityInit &
    TerminalInit &
    PickupInit &
    ContactInit &
    DenyTargetInit &
    SyncPadInit &
    CorpTurretInit &
    RelayNodeInit &
    EscortNpcInit
> & {
  id: string;
  x: number;
  y: number;
  faction?: FactionId;
  glyph?: string;
  maxAp?: number;
  maxHp?: number;
};

const ARCHETYPE_FACTORY: Record<EntityArchetypeId, (props: RestoreEntityProps) => Entity> =
  Object.freeze({
    merc: (props: RestoreEntityProps) => new Merc(props as CrewInit),
    razor: (props: RestoreEntityProps) => new Razor(props as CrewInit),
    tech: (props: RestoreEntityProps) => new Tech(props as CrewInit),
    turret: (props: RestoreEntityProps) => new Turret(props as TurretInit),
    drone: (props: RestoreEntityProps) => new CorpDrone(props as CorpDroneProps),
    'corp-civilian': (props: RestoreEntityProps) => new CorpCivilian(props as CorpCivilianInit),
    'neutral-civilian': (props: RestoreEntityProps) =>
      new NeutralCivilian(props as NeutralCivilianInit),
    terminal: (props: RestoreEntityProps) => new Terminal(props as TerminalInit),
    pickup: (props: RestoreEntityProps) => new Pickup(props as PickupInit),
    contact: (props: RestoreEntityProps) => new Contact(props as ContactInit),
    'deny-target': (props: RestoreEntityProps) => new DenyTarget(props as DenyTargetInit),
    'sync-pad': (props: RestoreEntityProps) => new SyncPad(props as SyncPadInit),
    'corp-turret': (props: RestoreEntityProps) => new CorpTurret(props as CorpTurretInit),
    'relay-node': (props: RestoreEntityProps) => new RelayNode(props as RelayNodeInit),
    'escort-npc': (props: RestoreEntityProps) => new EscortNpc(props as EscortNpcInit),
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
const KNOWN_DRONE_STATES = new Set(Object.values(DRONE_STATE));

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
   * M4.2: typed salvage wallet. Pre-M4.2 saves stored a legacy `number` here
   * (generic salvage units); `restoreCampaign` / `migrateSalvage` buckets
   * those into `scrap` on load. New saves write the typed shape directly.
   */
  salvage: number | TypedSalvage;
  /** M8+: campaign money. Defaults to 0 for pre-Creds saves. */
  credits?: number;
  rep: number;
  meta: CampaignMeta;
  deployedMemberId: string | null;
  activeRun: CampaignActiveRunSnapshot | null;
  /** M6: recruit candidates available this hub visit. Defaults to [] for pre-M6 saves. */
  availableRecruits?: CampaignCrewSnapshot[];
  /** M6: true if the player already recruited this hub visit. Defaults to false. */
  recruitedThisVisit?: boolean;
  /** M8: contract reward waiting to produce one recruit on next Hub entry. */
  pendingRecruitReward?: boolean;
  /** M8: available recruit ids that bypass the Rep gate because they were job rewards. */
  rewardRecruitIds?: string[];
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
    deployedMemberId: campaign.deployedMemberId,
    activeRun: campaign.activeRun ? snapshotActiveRun(campaign.activeRun) : null,
    availableRecruits: campaign.availableRecruits.map(snapshotCrewMember),
    recruitedThisVisit: campaign.recruitedThisVisit,
    pendingRecruitReward: campaign.pendingRecruitReward,
    rewardRecruitIds: [...campaign.rewardRecruitIds],
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
  run.exitTile = record.exitTile ? { ...record.exitTile } : null;
  run.telemetry = { ...record.telemetry };
  run.objectiveTimer = normalizeObjectiveTimer(record.objectiveTimer);
  run.state = record.state;
  run.bus = new EventBus();
  run.world = new World(grid, { events: run.bus });
  if (record.alarm) {
    run.world.restoreAlarm(record.alarm);
  } else {
    run.world.alarmActive = record.alarmActive ?? false;
  }
  run.restoreMapMemory(normalizeMapMemory(record.mapMemory));

  const factionOrder = [FACTION.PLAYER, FACTION.CORP];
  if (record.currentFaction !== FACTION.PLAYER && record.currentFaction !== FACTION.CORP) {
    throw new Error(`restore: unknown currentFaction "${record.currentFaction}"`);
  }
  run.queue = new TurnQueue(factionOrder);
  run.queue.turnNumber = record.turnNumber;
  const factionIndex = factionOrder.indexOf(record.currentFaction);
  if (factionIndex < 0) {
    throw new Error(`restore: unknown currentFaction "${record.currentFaction}"`);
  }
  run.queue.index = factionIndex;

  for (const entity of restoredEntities) {
    run.world.addEntity(entity);
    if (entity instanceof CorpDrone) {
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
    onPersist: options.onPersist,
    onResult: options.onResult,
  });
  campaign.rng = new Rng(record.rng.seed);
  campaign.rng.setState(record.rng.state);

  // Restore M6 recruitment state (overrides whatever enterHub() generated
  // during construction — the constructor's rng state was wrong until above).
  campaign.availableRecruits = (record.availableRecruits ?? []).map(restoreCrewMember);
  campaign.recruitedThisVisit = record.recruitedThisVisit ?? false;
  campaign.pendingRecruitReward = record.pendingRecruitReward ?? false;
  campaign.rewardRecruitIds = new Set(record.rewardRecruitIds ?? []);

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
    campaign.deployedMemberId = member.id;
    campaign.state = CAMPAIGN_STATE.COMBAT;
    campaign.world = null;
    campaign.queue = null;
    campaign.bus = null;
    campaign.player = null;
    campaign.curator = null;
    campaign.finn = null;
    campaign.terminal = null;
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
  if (rec.faction && !KNOWN_FACTIONS.has(rec.faction)) {
    throw new Error(`restore: entity ${rec.id} has unknown faction "${rec.faction}"`);
  }

  const entityProps: RestoreEntityProps = {
    id: rec.id,
    x: rec.x,
    y: rec.y,
    maxAp: rec.maxAp,
    maxHp: rec.maxHp,
  };
  if (isCrewArchetype(rec.archetype)) {
    entityProps.callsign = rec.callsign ?? null;
    entityProps.flatlined = !!rec.flatlined;
    entityProps.inventory = rec.inventory ?? null;
    entityProps.gear = rec.gear ?? null;
  }
  if (rec.archetype === 'drone') {
    entityProps.patrolWaypoints = rec.drone?.patrolWaypoints ?? [];
  }
  if (rec.archetype === 'turret' && rec.turret) {
    // Turret's range/attackDamage are tunables that survive a round-trip;
    // passing them through the constructor keeps a custom-tuned improvised
    // turret (M3) behaving identically after restore.
    if (Number.isInteger(rec.turret.range)) entityProps.range = rec.turret.range;
    if (Number.isInteger(rec.turret.attackDamage)) {
      entityProps.attackDamage = rec.turret.attackDamage;
    }
    if (rec.turret.ownerId !== undefined) entityProps.ownerId = rec.turret.ownerId;
  }
  if (rec.archetype === 'corp-turret' && rec.corpTurret) {
    if (Number.isInteger(rec.corpTurret.range)) entityProps.range = rec.corpTurret.range;
    if (Number.isInteger(rec.corpTurret.attackDamage)) {
      entityProps.attackDamage = rec.corpTurret.attackDamage;
    }
  }
  if (rec.archetype === 'relay-node') {
    entityProps.label = rec.relayNode?.label ?? 'Relay node';
  }
  if (rec.archetype === 'escort-npc' && rec.escortNpc) {
    entityProps.label = rec.escortNpc.label;
    entityProps.activated = rec.escortNpc.activated;
    entityProps.armed = rec.escortNpc.armed;
  }
  if (rec.archetype === 'terminal' && rec.terminal) {
    entityProps.label = rec.terminal.label;
    entityProps.sliced = rec.terminal.sliced;
    entityProps.armed = rec.terminal.armed;
    entityProps.raisesAlarm = rec.terminal.raisesAlarm;
  }
  if (rec.archetype === 'pickup' && rec.pickup) {
    entityProps.label = rec.pickup.label;
    entityProps.secured = rec.pickup.secured;
    entityProps.armed = rec.pickup.armed;
  }
  if (rec.archetype === 'contact' && rec.contact) {
    entityProps.label = rec.contact.label;
    entityProps.handoffComplete = rec.contact.handoffComplete;
    entityProps.armed = rec.contact.armed;
  }
  if (rec.archetype === 'deny-target') {
    entityProps.label = rec.denyTarget?.label ?? 'Deny target';
  }
  if (rec.archetype === 'sync-pad' && rec.syncPad) {
    entityProps.label = rec.syncPad.label;
    entityProps.synced = rec.syncPad.synced;
    entityProps.armed = rec.syncPad.armed;
  }
  if (rec.archetype === 'terminal' && !rec.terminal) {
    throw new TypeError(`restore: terminal entity ${rec.id} requires terminal state`);
  }
  if (rec.archetype === 'pickup' && !rec.pickup) {
    throw new TypeError(`restore: pickup entity ${rec.id} requires pickup state`);
  }
  if (rec.archetype === 'contact' && !rec.contact) {
    throw new TypeError(`restore: contact entity ${rec.id} requires contact state`);
  }
  if (rec.archetype === 'deny-target' && !rec.denyTarget) {
    throw new TypeError(`restore: deny target entity ${rec.id} requires deny target state`);
  }
  if (rec.archetype === 'sync-pad' && !rec.syncPad) {
    throw new TypeError(`restore: sync pad entity ${rec.id} requires sync pad state`);
  }
  if (rec.archetype === 'escort-npc' && !rec.escortNpc) {
    throw new TypeError(`restore: escort NPC entity ${rec.id} requires escort state`);
  }
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
  entity.hp = rec.hp;
  entity.alive = rec.alive ?? rec.hp > 0;
  if (Number.isInteger(rec.ap)) {
    if (rec.ap < 0 || rec.ap > entity.maxAp) {
      throw new RangeError(`restore: entity ${rec.id} ap=${rec.ap} out of [0, ${entity.maxAp}]`);
    }
    entity.ap = rec.ap;
  }
  entity.stealthed = !!rec.stealthed;
  if (rec.glyph) entity.glyph = rec.glyph;

  // Repair latent hitBonus overflow on crew entities (same migration as
  // restoreCrewMember, but for mid-combat run snapshots).
  if (entity instanceof Crew && entity.gear) {
    if (entity.gear.hitBonus > entity.maxHitBonus) {
      entity.gear.hitBonus = entity.maxHitBonus;
    }
    const dodgeBonus = entity.gear.dodgeBonus ?? 0;
    if (dodgeBonus > entity.maxDodgeBonus) {
      entity.gear.dodgeBonus = entity.maxDodgeBonus;
    }
  }

  if (rec.archetype === 'tech' && rec.tech) {
    if (!(entity instanceof Tech)) {
      throw new Error(`restore: tech entity ${rec.id} did not restore as Tech`);
    }
    // Re-apply the pre-built turret flag so a mid-job save remembers whether
    // the player already deployed. Defaults to `true` (Tech ctor) when the
    // record omits it.
    entity.turretReady = !!rec.tech.turretReady;
  }

  if (rec.archetype === 'drone' && rec.drone) {
    if (!(entity instanceof CorpDrone)) {
      throw new Error(`restore: drone entity ${rec.id} did not restore as CorpDrone`);
    }
    if (rec.drone.state && !KNOWN_DRONE_STATES.has(rec.drone.state as CorpDrone['state'])) {
      throw new Error(`restore: drone ${rec.id} has unknown state "${rec.drone.state}"`);
    }
    if (rec.drone.state) entity.state = rec.drone.state as CorpDrone['state'];
    if (rec.drone.lastKnownTarget) {
      const lk = rec.drone.lastKnownTarget;
      if (!Number.isInteger(lk.x) || !Number.isInteger(lk.y)) {
        throw new TypeError(`restore: drone ${rec.id} lastKnownTarget must have integer coords`);
      }
      entity.lastKnownTarget = { x: lk.x, y: lk.y };
    }
    if (Number.isInteger(rec.drone.patrolIndex)) {
      const idx = rec.drone.patrolIndex as number;
      const len = entity.patrolWaypoints.length;
      // Bounds-check against the restored waypoint list — `takeTurnSteps`
      // dereferences `patrolWaypoints[patrolIndex]` without a guard, so a
      // stale or corrupt index would crash mid-turn. Fail loudly here instead.
      if (idx < 0 || (len > 0 && idx >= len)) {
        throw new RangeError(`restore: drone ${rec.id} patrolIndex=${idx} out of [0, ${len})`);
      }
      entity.patrolIndex = len > 0 ? idx : 0;
    }
  }

  if (rec.archetype === 'terminal' && rec.terminal) {
    if (!(entity instanceof Terminal)) {
      throw new Error(`restore: terminal entity ${rec.id} did not restore as Terminal`);
    }
    if (typeof rec.terminal.label !== 'string' || rec.terminal.label.length === 0) {
      throw new TypeError(`restore: terminal ${rec.id} label must be a non-empty string`);
    }
    if (typeof rec.terminal.sliced !== 'boolean') {
      throw new TypeError(`restore: terminal ${rec.id} sliced must be boolean`);
    }
    if (typeof rec.terminal.armed !== 'boolean') {
      throw new TypeError(`restore: terminal ${rec.id} armed must be boolean`);
    }
    if (typeof rec.terminal.raisesAlarm !== 'boolean') {
      throw new TypeError(`restore: terminal ${rec.id} raisesAlarm must be boolean`);
    }
  }
  if (rec.archetype === 'pickup' && rec.pickup) {
    if (!(entity instanceof Pickup)) {
      throw new Error(`restore: pickup entity ${rec.id} did not restore as Pickup`);
    }
    if (typeof rec.pickup.label !== 'string' || rec.pickup.label.length === 0) {
      throw new TypeError(`restore: pickup ${rec.id} label must be a non-empty string`);
    }
    if (typeof rec.pickup.secured !== 'boolean') {
      throw new TypeError(`restore: pickup ${rec.id} secured must be boolean`);
    }
    if (typeof rec.pickup.armed !== 'boolean') {
      throw new TypeError(`restore: pickup ${rec.id} armed must be boolean`);
    }
  }
  if (rec.archetype === 'contact' && rec.contact) {
    if (!(entity instanceof Contact)) {
      throw new Error(`restore: contact entity ${rec.id} did not restore as Contact`);
    }
    if (typeof rec.contact.label !== 'string' || rec.contact.label.length === 0) {
      throw new TypeError(`restore: contact ${rec.id} label must be a non-empty string`);
    }
    if (typeof rec.contact.handoffComplete !== 'boolean') {
      throw new TypeError(`restore: contact ${rec.id} handoffComplete must be boolean`);
    }
    if (typeof rec.contact.armed !== 'boolean') {
      throw new TypeError(`restore: contact ${rec.id} armed must be boolean`);
    }
  }
  if (rec.archetype === 'deny-target' && rec.denyTarget) {
    if (!(entity instanceof DenyTarget)) {
      throw new Error(`restore: deny target entity ${rec.id} did not restore as DenyTarget`);
    }
    if (typeof rec.denyTarget.label !== 'string' || rec.denyTarget.label.length === 0) {
      throw new TypeError(`restore: deny target ${rec.id} label must be a non-empty string`);
    }
  }
  if (rec.archetype === 'sync-pad' && rec.syncPad) {
    if (!(entity instanceof SyncPad)) {
      throw new Error(`restore: sync pad entity ${rec.id} did not restore as SyncPad`);
    }
    if (typeof rec.syncPad.label !== 'string' || rec.syncPad.label.length === 0) {
      throw new TypeError(`restore: sync pad ${rec.id} label must be a non-empty string`);
    }
    if (typeof rec.syncPad.synced !== 'boolean') {
      throw new TypeError(`restore: sync pad ${rec.id} synced must be boolean`);
    }
    if (typeof rec.syncPad.armed !== 'boolean') {
      throw new TypeError(`restore: sync pad ${rec.id} armed must be boolean`);
    }
  }
  if (rec.archetype === 'escort-npc' && rec.escortNpc) {
    if (!(entity instanceof EscortNpc)) {
      throw new Error(`restore: escort NPC entity ${rec.id} did not restore as EscortNpc`);
    }
    if (typeof rec.escortNpc.label !== 'string' || rec.escortNpc.label.length === 0) {
      throw new TypeError(`restore: escort NPC ${rec.id} label must be a non-empty string`);
    }
    if (typeof rec.escortNpc.activated !== 'boolean') {
      throw new TypeError(`restore: escort NPC ${rec.id} activated must be boolean`);
    }
    if (typeof rec.escortNpc.armed !== 'boolean') {
      throw new TypeError(`restore: escort NPC ${rec.id} armed must be boolean`);
    }
  }

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

const KNOWN_ARCHETYPES_SET = new Set<CrewArchetypeId>(['merc', 'razor', 'tech']);

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
  // M4.2: migrate legacy `inventory.salvage: number` into the typed wallet
  // before the archetype factory consumes it. Snapshots written before M4.2
  // store a plain integer; new saves store a TypedSalvage object. The
  // `migrateSalvage` helper handles both shapes and crashes on anything
  // else (silent fallback would corrupt the wallet on every reload).
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
  });
  if (!(member instanceof Crew)) {
    throw new Error(`restoreCampaign: crew archetype "${rec.archetype}" did not restore as Crew`);
  }
  if (Number.isInteger(rec.hp)) member.hp = rec.hp;
  if (Number.isInteger(rec.ap)) member.ap = rec.ap;
  member.alive = rec.alive ?? member.hp > 0;

  // Repair latent data corruption: a previous bug allowed hitBonus to
  // accumulate past the archetype's cap, causing resolveRanged to throw.
  if (member.gear) {
    if (member.gear.hitBonus > member.maxHitBonus) {
      member.gear.hitBonus = member.maxHitBonus;
    }
    const dodgeBonus = member.gear.dodgeBonus ?? 0;
    if (dodgeBonus > member.maxDodgeBonus) {
      member.gear.dodgeBonus = member.maxDodgeBonus;
    }
  }

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
  if (!reward) {
    return {
      ...raw,
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
  // M4.2: accept either a legacy non-negative integer (pre-M4.2 saves) or a
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
  if (candidate.state === CAMPAIGN_STATE.COMBAT && !candidate.activeRun) {
    throw new Error('restoreCampaign: COMBAT state requires activeRun');
  }
  // M6 fields are optional for backwards compat with pre-M6 saves.
  if (candidate.availableRecruits !== undefined && !Array.isArray(candidate.availableRecruits)) {
    throw new TypeError('restoreCampaign: availableRecruits must be an array when present');
  }
  if (
    candidate.recruitedThisVisit !== undefined &&
    typeof candidate.recruitedThisVisit !== 'boolean'
  ) {
    throw new TypeError('restoreCampaign: recruitedThisVisit must be a boolean when present');
  }
}

function archetypeOfCrew(member: Crew): CrewArchetypeId {
  if (member instanceof Merc) return 'merc';
  if (member instanceof Razor) return 'razor';
  if (member instanceof Tech) return 'tech';
  throw new Error(`snapshotCampaign: cannot classify crew member ${member?.id}`);
}

function isCrewArchetype(value: string): value is CrewArchetypeId {
  return KNOWN_ARCHETYPES_SET.has(value as CrewArchetypeId);
}
