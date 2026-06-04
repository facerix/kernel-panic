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
 * The plain-array grid encoding (vs. base64 of a `Uint8Array`) is the user's
 * pick for M8: ~3× larger on disk than base64 but trivially portable across
 * browser + `node --test`, and a 24×16 grid is 384 bytes either way.
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
import { Turret } from './Turret.js';
import { Skirmisher, type SkirmisherProps } from './ai/Skirmisher.js';
import { Guard, type GuardProps } from './ai/Guard.js';
import { Bruiser, type BruiserProps } from './ai/Bruiser.js';
import { Juggernaut, type JuggernautProps } from './ai/Juggernaut.js';
import { Flanker, type FlankerProps } from './ai/Flanker.js';
import { Lookout, type LookoutProps } from './ai/Lookout.js';
import { Sniper, type SniperProps } from './ai/Sniper.js';
import { Medic, type MedicProps } from './ai/Medic.js';
import { PatrolHostile, PATROL_STATE } from './ai/PatrolHostile.js';
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
import { BreachingCharge } from './entities/BreachingCharge.js';
import type { BreachingChargeInit } from './entities/BreachingCharge.js';
import { Run, RUN_STATE, PATROL_ARCHETYPE_IDS } from './Run.js';
import { Campaign, CAMPAIGN_STATE } from './Campaign.js';
import { normalizeContractContext, normalizeObjective } from './hub/Curator.js';
import { normalizeHubReveals } from './hub/hubReveals.js';
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
import type { EntityInit } from './Entity.js';
import type { FactionId } from './constants.js';
import type {
  CrewArchetypeId,
  EntityArchetypeId,
  PatrolArchetypeId,
  PatrolSnapshotBlock,
  RunEntitySnapshot,
  RunResult,
  RunSnapshot,
  RunState,
  RunTelemetry,
  ObjectiveTimerSnapshot,
  MapMemorySnapshot,
  ObjectiveProgressSnapshot,
} from './Run.js';
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
    BreachingChargeInit
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

/**
 * The serialised {@link PatrolSnapshotBlock} for a patrol-hostile record, or
 * `null` for any other archetype. Every patrol hostile stores its block under a
 * key equal to its archetype id (`drone` = Skirmisher); the Sniper's also
 * carries `aimTargetId`. Replaces the old per-archetype ternary/if cascade.
 */
function patrolSnapshotBlock(
  rec: RunEntitySnapshot
): (PatrolSnapshotBlock & { aimTargetId?: string | null }) | null {
  switch (rec.archetype) {
    case 'drone':
      return rec.drone ?? null;
    case 'guard':
      return rec.guard ?? null;
    case 'bruiser':
      return rec.bruiser ?? null;
    case 'juggernaut':
      return rec.juggernaut ?? null;
    case 'flanker':
      return rec.flanker ?? null;
    case 'lookout':
      return rec.lookout ?? null;
    case 'sniper':
      return rec.sniper ?? null;
    case 'medic':
      return rec.medic ?? null;
    default:
      return null;
  }
}

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
  /** M5.3: crew member ids healed at Patch's clinic this Hub visit. */
  healedThisVisit?: string[];
  /** M5.4: progressive Hub introduction flags. Defaults to {} for pre-M5.4 saves. */
  hubReveals?: HubRevealsSnapshot;
  /** M5.4: count of jobs ended with EXIT (extract). Defaults to 0. */
  completedJobs?: number;
  /** M6.2: persistent key-item inventory (keycards). Defaults to []. */
  keyItems?: KeyItemSnapshot[];
  /** M7.2: remembered combat locations (site roster). Defaults to []. */
  siteRoster?: LocationSite[];
};

/** M6.2: Serializable key item. */
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
  clinicIntroduced?: boolean;
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
    healedThisVisit: [...campaign.healedThisVisit],
    hubReveals: { ...campaign.hubReveals },
    completedJobs: campaign.completedJobs,
    keyItems: campaign.keyItems.map(k => ({ ...k })),
    siteRoster: campaign.siteRoster.map(snapshotLocationSite),
  };
}

/** M7.2: deep-clone a roster site (including its delta list) for serialization. */
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
    hubReveals: normalizeHubReveals(record.hubReveals, 'restoreCampaign hubReveals'),
    completedJobs: record.completedJobs ?? 0,
    keyItems: record.keyItems,
    siteRoster: record.siteRoster,
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
    entityProps.callsign = rec.callsign ?? null;
    entityProps.flatlined = !!rec.flatlined;
    entityProps.inventory = rec.inventory ?? null;
    entityProps.gear = rec.gear ?? null;
  }
  if (isPatrolArchetype(rec.archetype)) {
    entityProps.patrolWaypoints = patrolSnapshotBlock(rec)?.patrolWaypoints ?? [];
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
  if (rec.archetype === 'consumable-pickup' && rec.consumablePickup) {
    entityProps.consumableId = rec.consumablePickup.consumableId;
    entityProps.label = rec.consumablePickup.label;
  }
  if (rec.archetype === 'escort-npc' && rec.escortNpc) {
    entityProps.label = rec.escortNpc.label;
    entityProps.activated = rec.escortNpc.activated;
    entityProps.armed = rec.escortNpc.armed;
  }
  if (rec.archetype === 'keycard' && rec.keycard) {
    entityProps.doorId = rec.keycard.doorId;
    entityProps.label = rec.keycard.label;
    if (rec.keycard.siteId) entityProps.siteId = rec.keycard.siteId;
  }
  if (rec.archetype === 'terminal' && rec.terminal) {
    entityProps.label = rec.terminal.label;
    entityProps.sliced = rec.terminal.sliced;
    entityProps.armed = rec.terminal.armed;
    entityProps.raisesAlarm = rec.terminal.raisesAlarm;
    entityProps.unlocksId = rec.terminal.unlocksId ?? null;
  }
  if (rec.archetype === 'door' && rec.door) {
    entityProps.doorId = rec.door.doorId;
    entityProps.locked = rec.door.locked;
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
    entityProps.requiresBreach = rec.denyTarget?.requiresBreach ?? false;
  }
  if (rec.archetype === 'sync-pad' && rec.syncPad) {
    entityProps.label = rec.syncPad.label;
    entityProps.synced = rec.syncPad.synced;
    entityProps.armed = rec.syncPad.armed;
  }
  if (rec.archetype === 'terminal' && !rec.terminal) {
    throw new TypeError(`restore: terminal entity ${rec.id} requires terminal state`);
  }
  if (rec.archetype === 'door' && !rec.door) {
    throw new TypeError(`restore: door entity ${rec.id} requires door state`);
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
  if (rec.archetype === 'keycard' && !rec.keycard) {
    throw new TypeError(`restore: keycard entity ${rec.id} requires keycard state`);
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
  if (rec.glyph) entity.glyph = rec.glyph;

  // Repair latent gear overflow on crew entities (same as restoreCrewMember).
  if (entity instanceof Crew) {
    repairGearForCrew(entity);
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

  // Patrol hostiles serialise under per-archetype keys but restore identically.
  const patrolRec = patrolSnapshotBlock(rec);
  if (patrolRec) {
    if (!(entity instanceof PatrolHostile)) {
      throw new Error(
        `restore: ${rec.archetype} entity ${rec.id} did not restore as a PatrolHostile`
      );
    }
    if (patrolRec.state && !KNOWN_PATROL_STATES.has(patrolRec.state as PatrolHostile['state'])) {
      throw new Error(`restore: ${rec.archetype} ${rec.id} has unknown state "${patrolRec.state}"`);
    }
    if (patrolRec.state) entity.state = patrolRec.state as PatrolHostile['state'];
    if (patrolRec.lastKnownTarget) {
      const lk = patrolRec.lastKnownTarget;
      if (!Number.isInteger(lk.x) || !Number.isInteger(lk.y)) {
        throw new TypeError(
          `restore: ${rec.archetype} ${rec.id} lastKnownTarget must have integer coords`
        );
      }
      entity.lastKnownTarget = { x: lk.x, y: lk.y };
    }
    if (Number.isInteger(patrolRec.patrolIndex)) {
      const idx = patrolRec.patrolIndex as number;
      const len = entity.patrolWaypoints.length;
      // Bounds-check against the restored waypoint list — `takeTurnSteps`
      // dereferences `patrolWaypoints[patrolIndex]` without a guard, so a
      // stale or corrupt index would crash mid-turn. Fail loudly here instead.
      if (idx < 0 || (len > 0 && idx >= len)) {
        throw new RangeError(
          `restore: ${rec.archetype} ${rec.id} patrolIndex=${idx} out of [0, ${len})`
        );
      }
      entity.patrolIndex = len > 0 ? idx : 0;
    }
  }

  // Sniper restores its pending held shot so a save during the aim telegraph
  // resumes fire-or-cancel on the next corp turn.
  if (rec.archetype === 'sniper' && rec.sniper && entity instanceof Sniper) {
    entity.aimTargetId = rec.sniper.aimTargetId ?? null;
  }

  if (rec.archetype === 'flanker' && rec.flanker && entity instanceof Flanker) {
    if (typeof rec.flanker.slideConcealed !== 'boolean') {
      throw new TypeError(`restore: flanker ${rec.id} slideConcealed must be boolean`);
    }
    entity.slideConcealed = rec.flanker.slideConcealed;
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
    if (
      rec.terminal.unlocksId !== undefined &&
      rec.terminal.unlocksId !== null &&
      (typeof rec.terminal.unlocksId !== 'string' || rec.terminal.unlocksId.length === 0)
    ) {
      throw new TypeError(
        `restore: terminal ${rec.id} unlocksId must be null or a non-empty string`
      );
    }
  }
  if (rec.archetype === 'door' && rec.door) {
    if (!(entity instanceof Door)) {
      throw new Error(`restore: door entity ${rec.id} did not restore as Door`);
    }
    if (typeof rec.door.doorId !== 'string' || rec.door.doorId.length === 0) {
      throw new TypeError(`restore: door ${rec.id} doorId must be a non-empty string`);
    }
    if (typeof rec.door.locked !== 'boolean') {
      throw new TypeError(`restore: door ${rec.id} locked must be boolean`);
    }
    const expectedGlyph = rec.door.locked ? DOOR_LOCKED_GLYPH : DOOR_OPEN_GLYPH;
    if (rec.glyph !== expectedGlyph) {
      throw new Error(
        `restore: door ${rec.id} glyph "${rec.glyph}" disagrees with locked=${rec.door.locked}`
      );
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
  if (rec.archetype === 'consumable-pickup' && rec.consumablePickup) {
    if (!(entity instanceof ConsumablePickup)) {
      throw new Error(
        `restore: consumable pickup entity ${rec.id} did not restore as ConsumablePickup`
      );
    }
    if (
      typeof rec.consumablePickup.consumableId !== 'string' ||
      rec.consumablePickup.consumableId.length === 0
    ) {
      throw new TypeError(
        `restore: consumable pickup ${rec.id} consumableId must be a non-empty string`
      );
    }
    if (typeof rec.consumablePickup.label !== 'string' || rec.consumablePickup.label.length === 0) {
      throw new TypeError(`restore: consumable pickup ${rec.id} label must be a non-empty string`);
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

  if (rec.archetype === 'keycard' && rec.keycard) {
    if (!(entity instanceof KeyCard)) {
      throw new Error(`restore: keycard entity ${rec.id} did not restore as KeyCard`);
    }
    if (typeof rec.keycard.doorId !== 'string' || rec.keycard.doorId.length === 0) {
      throw new TypeError(`restore: keycard ${rec.id} doorId must be a non-empty string`);
    }
    if (typeof rec.keycard.label !== 'string' || rec.keycard.label.length === 0) {
      throw new TypeError(`restore: keycard ${rec.id} label must be a non-empty string`);
    }
  }
  if (rec.archetype === 'deny-target' && rec.denyTarget) {
    if (!(entity instanceof DenyTarget)) {
      throw new Error(`restore: deny target entity ${rec.id} did not restore as DenyTarget`);
    }
    if (typeof rec.denyTarget.label !== 'string' || rec.denyTarget.label.length === 0) {
      throw new TypeError(`restore: deny target ${rec.id} label must be a non-empty string`);
    }
    if (
      rec.denyTarget.requiresBreach !== undefined &&
      typeof rec.denyTarget.requiresBreach !== 'boolean'
    ) {
      throw new TypeError(`restore: deny target ${rec.id} requiresBreach must be boolean`);
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
 * M6.2: Normalize run-scoped key items from a snapshot (or undefined for
 * pre-M6.2 saves). Validates structure. Crashes on malformed entries.
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
  throw new Error(`snapshotCampaign: cannot classify crew member ${member?.id}`);
}

function isCrewArchetype(value: string): value is CrewArchetypeId {
  return KNOWN_ARCHETYPES_SET.has(value as CrewArchetypeId);
}
