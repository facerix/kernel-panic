/**
 * `Run` — one job episode inside a Campaign.
 *
 * Owns the active `Rng`, `World`, `TurnQueue`, deployed crew entity, and
 * current contract. Drives the three-state job cycle:
 *
 *   null → enterBriefing(contract) → BRIEFING
 *                                ↓ enterCombat()
 *                              COMBAT
 *                                ↓ enterResult({outcome})  (DEATH | EXIT)
 *                              RESULT
 *
 * Every transition is an explicit method that throws when called from an
 * illegal source state. No auto-coercion, no silent fallback — illegal
 * transitions are the kind of bug that corrupts a run silently if we let it
 * pass.
 *
 * Side effects are surfaced through callbacks so the shell decides how to
 * persist or display them:
 *   - `onPersist(record)` fires on every `turn:ended` while in COMBAT, and
 *     once when entering `RESULT` (death or exit) after the state flip, so
 *     storage never lags a terminal mission behind the last COMBAT autosave.
 *     Campaign/shell wires this to DataStore.
 *   - `onResult({outcome, telemetry})` fires when entering RESULT. The shell
 *     wires this to <crash-dump>.
 *
 * The class is browser-DOM-free (only depends on game/ + rng/) so it runs
 * under `node --test` and the unit tests can drive it end-to-end.
 *
 * `snapshot()` lives on this class (rather than in persistence.js) to avoid
 * a circular import: persistence imports Run for `restore`, and Run would
 * otherwise need to import persistence right back.
 */

import { Rng } from '../rng.js';
import { World } from './World.js';
import { TurnQueue } from './TurnQueue.js';
import { EventBus, EVENT } from './events.js';
import {
  FACTION,
  TILE,
  SALVAGE_DROP_MIN,
  SALVAGE_DROP_MAX,
  ENEMY_ROLE,
  factionForPrincipalGroups,
} from './constants.js';
import { coordKey, explorationReachableKeys } from './mapConnectivity.js';
import { isValidBlockingPlacement, checkPlacementIntegrity } from './placement.js';
import { makeSalvage, type TypedSalvage } from './salvage.js';
import { Entity, type LootableEntity } from './Entity.js';
import { Hostile } from './Hostile.js';
import { hasLineOfSight } from './LineOfSight.js';
import { Crew } from './Crew.js';
import { Merc } from './archetypes/Merc.js';
import { Razor } from './archetypes/Razor.js';
import { Tech } from './archetypes/Tech.js';
import { Decker } from './archetypes/Decker.js';
import { Turret } from './Turret.js';
import { Skirmisher } from './ai/Skirmisher.js';
import { Guard } from './ai/Guard.js';
import { Bruiser } from './ai/Bruiser.js';
import { Juggernaut } from './ai/Juggernaut.js';
import { Flanker } from './ai/Flanker.js';
import { Lookout } from './ai/Lookout.js';
import { Sniper } from './ai/Sniper.js';
import { Medic } from './ai/Medic.js';
import { PatrolHostile } from './ai/PatrolHostile.js';
import { composeEncounter, ENEMY_ARCHETYPE, type EnemyArchetype } from './encounters.js';
import { aliasFor } from './enemyAliases.js';
import { CorpCivilian } from './entities/CorpCivilian.js';
import { Terminal } from './entities/Terminal.js';
import { Door } from './entities/Door.js';
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
import { DataNode } from './cyber/DataNode.js';
import { ProbeIce } from './cyber/ProbeIce.js';
import { SparkIce } from './cyber/SparkIce.js';
import { GuardianIce } from './cyber/GuardianIce.js';
import { applyMutationDeltas } from './locations.js';
import { BreachingCharge } from './entities/BreachingCharge.js';
import { ITEM_ID, getItemById } from './items.js';
import { resetCorpTurnStatusCache } from './corpTurnStatusCopy.js';
import {
  objectiveProgress as resolveObjectiveProgress,
  dataNodeProgress,
  reconObjectiveProgress,
  sweepQuotaType,
  SWEEP_QUOTA,
} from './objectiveProgress.js';
import type { CyberNodeProgress } from './objectiveProgress.js';
import { NeutralCivilian } from './entities/NeutralCivilian.js';
import { VisionField } from './Vision.js';
import {
  OBJECTIVES,
  cloneObjective,
  contractRequiresCyberspace,
  isContractDifficulty,
  normalizeContractContext,
  normalizeObjective,
} from './hub/Curator.js';
import { buildMap } from './procgen/mapBuild.js';
import { normalizeMapDimensions } from './procgen/mapDimensions.js';
import { findPath } from './Pathfinding.js';
import type { Contract } from './hub/Curator.js';
import type { FactionId } from './constants.js';
import type { GridPoint, KeyItem, TileDelta, EntitySnapshotExtra } from '../types.js';
import type { CrewSnapshot } from './Crew.js';
import type { TechSnapshot } from './archetypes/Tech.js';
import type { PatrolSnapshot } from './ai/PatrolHostile.js';
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
import type { JackInPointSnapshot } from './entities/JackInPoint.js';
import type { KeyCardSnapshot } from './entities/KeyCard.js';
import type { CyberAvatarSnapshot } from './cyber/CyberAvatar.js';
import type { EntryPortSnapshot } from './cyber/EntryPort.js';
import type { DataNodeSnapshot } from './cyber/DataNode.js';
import type { DeckerSnapshot } from './archetypes/Decker.js';
import type { AlarmState } from './World.js';

export const RUN_STATE = Object.freeze({
  BRIEFING: 'BRIEFING',
  COMBAT: 'COMBAT',
  RESULT: 'RESULT',
});

export const OUTCOME = Object.freeze({
  DEATH: 'death',
  EXIT: 'exit',
});

const KNOWN_OUTCOMES = new Set(Object.values(OUTCOME));

export type RunState = (typeof RUN_STATE)[keyof typeof RUN_STATE];
export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];
export type CrewArchetypeId = 'merc' | 'razor' | 'tech' | 'decker';
export type EntityArchetypeId =
  | CrewArchetypeId
  | 'turret'
  | 'drone'
  | 'guard'
  | 'bruiser'
  | 'juggernaut'
  | 'flanker'
  | 'lookout'
  | 'sniper'
  | 'medic'
  | 'corp-civilian'
  | 'neutral-civilian'
  | 'door'
  | 'terminal'
  | 'pickup'
  | 'contact'
  | 'deny-target'
  | 'sync-pad'
  | 'corp-turret'
  | 'relay-node'
  | 'consumable-pickup'
  | 'escort-npc'
  | 'keycard'
  | 'breaching-charge'
  | 'jack-in-point'
  | 'cyber-avatar'
  | 'entry-port'
  | 'data-node'
  | 'probe-ice'
  | 'spark-ice'
  | 'guardian-ice'
  | 'entity';

export type RunTelemetry = {
  archetype: CrewArchetypeId;
  seed: number;
  turn: number;
  kills: number;
  lastDamageSource: string | null;
  lastAttacker: string | null;
  hpAtDeath: number | null;
  hpAtDamage?: number;
  cause: string | null;
  objectiveComplete?: boolean;
  objectiveExpired?: boolean;
  outcome: Outcome | null;
  [key: string]: unknown;
};

export type ObjectiveTimerSnapshot = {
  completedWithinLimit: boolean;
  expired: boolean;
  completedTurn: number | null;
  expiredTurn: number | null;
  expiryAnnounced: boolean;
};

export type MapMemorySnapshot = {
  seen: string[];
};

export type ObjectiveProgressSnapshot = {
  securedPickups: string[];
};

/** Archetype ids whose snapshot `extra` is a {@link PatrolSnapshot} block. */
export const PATROL_ARCHETYPE_IDS = Object.freeze([
  'drone',
  'guard',
  'bruiser',
  'juggernaut',
  'flanker',
  'lookout',
  'sniper',
  'medic',
  // P3.M3.5: Probe ICE shares the identical patrol state-machine block.
  'probe-ice',
  // P3.M3: Spark + Guardian ICE share the same patrol state-machine block.
  'spark-ice',
  'guardian-ice',
] as const);

export type PatrolArchetypeId = (typeof PATROL_ARCHETYPE_IDS)[number];

/**
 * P2.7.M6.2: slimmed per-entity snapshot. Common fields every entity shares,
 * plus a single opaque {@link EntitySnapshotExtra} property bag. Each archetype
 * owns the strict shape of its own slice of `extra` (its exported `XSnapshot`
 * type); the centre type stays ignorant of those shapes. This replaced the
 * former ~24-key god-union — adding an archetype no longer edits this type.
 *
 * Legacy (pre-P2.7.M6.2) saves stored those slices as named top-level
 * sub-blocks (`drone`, `terminal`, …) and crew fields at the top level.
 * `restoreEntity` normalises both shapes into `extra` on load (see
 * `normalizeEntityExtra`).
 */
export type RunEntitySnapshot = {
  archetype: EntityArchetypeId;
  id: string;
  x: number;
  y: number;
  faction: FactionId;
  glyph: string;
  hp: number;
  maxHp: number;
  damageReduction?: number;
  shieldHp?: number;
  ap: number;
  maxAp: number;
  alive: boolean;
  stealthed: boolean;
  /** Phase 2.9 principal theming — omitted for un-aliased entities (player, props). */
  displayName?: string;
  principalTag?: string;
  /** Opaque per-archetype payload; strict shape owned by the entity module. */
  extra?: EntitySnapshotExtra;
};

export type RunSnapshot = {
  id: string;
  type: 'run';
  state: RunState;
  archetype: CrewArchetypeId;
  seed: number;
  turnNumber: number;
  currentFaction: FactionId;
  rng: { seed: number; state: number };
  contract: Contract | null;
  exitTile: GridPoint | null;
  grid: { w: number; h: number; tiles: number[] };
  entities: RunEntitySnapshot[];
  telemetry: RunTelemetry;
  /** Per-facility alarm cadence. Missing in older saves → defaults to quiet. */
  alarm?: AlarmState;
  /** Legacy map-wide alarm latch. Missing in older saves → defaults to false. */
  alarmActive?: boolean;
  /** Turn-limit objective state. Missing in older saves → fresh timer state. */
  objectiveTimer?: ObjectiveTimerSnapshot;
  /** Map memory. Missing in older saves → current LOS only. */
  mapMemory?: MapMemorySnapshot;
  /** Pickup unification: removed objective pickups still count as secured. */
  objectiveProgress?: ObjectiveProgressSnapshot;
  /** Run-scoped key items / keycards without a siteId (P2.5.M6.2). Defaults to []. */
  keyItems?: KeyItemSnapshot[];
  /** Terrain/entity mutations recorded during the run (P2.5.M7.1). Defaults to []. */
  mutationDeltas?: TileDelta[];
  /**
   * P3.M4.1: the reserved meat partner for a dual-deploy. Present only when a
   * Cyberspace contract was deployed with a partner (the player-chosen meat
   * operator who spawns on jack-in). Serialized as an off-grid entity record
   * with a throwaway (0,0) position — the partner's real cell is computed at
   * jack-in (P3.M4.2). Absent on solo deploys.
   */
  partner?: RunEntitySnapshot;
  /**
   * P3.M4.2: which layer held input at save time (`'meat'` | `'cyber'`).
   * Present only while jacked in (cyber phase `active`); absent ⇒ `'meat'`.
   */
  activeLayer?: 'meat' | 'cyber';
  /**
   * P3.M3: Cyberspace layer state. Present exactly when the contract requires
   * Cyberspace (`contractRequiresCyberspace`) — a mismatch in either direction
   * is corrupt and throws on restore.
   */
  cyberspace?: RunCyberspaceSnapshot;
};

/**
 * P3.M3: serialized Cyberspace layer state.
 *
 *   - `dormant` — cyber contract, not yet jacked in. No payload; the layer
 *     spawns fresh (and deterministically) on jack-in.
 *   - `active` — the live layer: its grid, entities (avatar, exit port, and
 *     later data nodes + ICE), alarm cadence, and fog memory. All fields are
 *     required together; a partial block is corrupt and throws on restore.
 *   - `resolved` — jacked out; only the objective latch survives.
 */
export type RunCyberspaceSnapshot =
  | { phase: 'dormant' }
  | {
      phase: 'active';
      grid: { w: number; h: number; tiles: number[] };
      entities: RunEntitySnapshot[];
      entryTile: GridPoint;
      alarm: AlarmState;
      mapMemory: MapMemorySnapshot;
    }
  | { phase: 'resolved'; objectiveComplete: boolean };

/**
 * P3.M3: live Cyberspace state machine on the Run. `null` ⇔ the contract has
 * no Cyberspace component. Transitions: dormant → active (`jackIn`) →
 * resolved (`jackOut` / P3.M4 forced jack-out). Resolved is a latch — the
 * link is burned; re-entry is refused.
 */
export type CyberspaceState =
  | { phase: 'dormant' }
  | { phase: 'active'; layer: CyberspaceLayer }
  | { phase: 'resolved'; objectiveComplete: boolean };

/** Serializable run-scoped key item (P2.5.M6.2). */
type KeyItemSnapshot = {
  id: string;
  label: string;
  doorId: string;
};

export type RunResult = {
  outcome: Outcome;
  telemetry: RunTelemetry;
};

export type RunOptions = {
  id?: string;
  crewMember?: unknown;
  /** P3.M4.1: the meat partner for a dual-deploy Cyberspace contract. */
  partnerMember?: unknown;
  seed?: unknown;
  onPersist?: unknown;
  onResult?: unknown;
  /** Called when the player reaches the exit with an incomplete objective.
   *  The shell should show a confirmation prompt; call `run.confirmAbort()`
   *  to finalise the abort extraction, or do nothing to let the player
   *  stay on the exit tile and keep playing. */
  onAbortRequested?: unknown;
  /** P3.M3: called when the avatar routes out with the objective incomplete —
   *  an irreversible step (the link burns, the objective latches
   *  unsatisfiable). The shell should show a confirmation prompt; call
   *  `run.confirmJackOut()` to finalize, or do nothing to keep the layer
   *  live. No callback registered → jack out immediately (tests/harness),
   *  matching the `onAbortRequested` posture. */
  onJackOutRequested?: unknown;
  /** Shell presentation — fired after jack-in completes. */
  onJackInPresent?: unknown;
  /** Shell presentation — fired after jack-out finalizes. */
  onJackOutPresent?: unknown;
  /** P3.M4.4 shell presentation — fired when the meat partner flatlines on the
   *  field (the corp can kill it off-screen while the player is in Cyberspace),
   *  so the shell can surface an unconditional "operator down" alert. */
  onPartnerDown?: unknown;
  /** Terrain mutations from a prior visit to this location (P2.5.M7.2), replayed
   *  onto the freshly-built map in `enterCombat`. Empty/omitted for a first visit. */
  priorMutationDeltas?: unknown;
  /** Campaign key items already held for this location site (P2.5.M7.2), used to
   *  skip respawning pickup keycards on revisit (player re-opens via interact). */
  priorKeyItems?: unknown;
  /** Coordinate keys explored on prior visits to this location site (P2.5.M7.2). */
  priorSeenKeys?: unknown;
};

type EntityDamagedPayload = {
  attacker?: Entity | null;
  target: Entity;
  damage: number;
  killed: boolean;
  source?: string;
  dodged?: boolean;
};

type EntityMovedPayload = {
  entity: Entity;
  to: GridPoint;
};

type TurnEndedPayload = {
  previous: FactionId;
  next: FactionId;
  turn: number;
};

export class Run {
  id: string;
  crewMember: Crew;
  /**
   * P3.M4.1: the meat operator reserved alongside the Decker on a dual-deploy
   * Cyberspace contract. `null` on solo deploys (no partner, or non-cyber).
   * Reserved at deploy; spawned onto the meat grid at jack-in (P3.M4.2).
   */
  partnerMember: Crew | null;
  archetype: CrewArchetypeId;
  seed: number;
  rng: Rng;
  state: RunState | null;
  world: World | null;
  queue: TurnQueue | null;
  bus: EventBus | null;
  /**
   * The Decker (the deployed primary) on a cyber contract — and, once jacked
   * in, the immobile Meatspace **body** at the port. On non-cyber runs this is
   * simply the deployed operator. Body-targeting feedback and the forced
   * jack-out (P3.M4.6) read `player` as the body; the *controllable* meat crew
   * is `meatActor` (they diverge only after a dual-deploy jack-in).
   */
  player: Crew | null;
  /**
   * P3.M4.2: the controllable Meatspace crew. Equals `player` until a
   * dual-deploy jack-in spawns the partner, after which it points at the
   * partner (the body freezes). The simstim flip (P3.M4.3) swaps `activeLayer`,
   * not this — `meatActor` is always "who moves in Meatspace".
   */
  meatActor: Crew | null;
  /**
   * P3.M4.2/M4.3: which layer currently receives player input. Only meaningful
   * while the cyber layer is active; `'meat'` everywhere else. On a dual-deploy
   * jack-in control stays in Meatspace (`'meat'`) until the first flip; a solo
   * Decker jack-in goes straight to `'cyber'` (no meat operator to hold).
   */
  activeLayer: 'meat' | 'cyber';
  contract: Contract | null;
  exitTile: GridPoint | null;
  /** P3.M3: Cyberspace state machine; `null` ⇔ no Cyberspace component. */
  cyberspace: CyberspaceState | null;
  telemetry: RunTelemetry;
  objectiveTimer: ObjectiveTimerSnapshot;
  mapSeen: Set<string>;
  /** Run-scoped key items / keycards without a siteId (P2.5.M6.2). Lost on run end. */
  keyItems: KeyItem[];
  /** Prior-visit terrain mutations replayed in `enterCombat` (P2.5.M7.2). */
  priorMutationDeltas: TileDelta[];
  /** Prior-visit exploration memory restored into shell fog on jack-in (P2.5.M7.2). */
  priorSeenKeys: string[];
  /** Site-scoped key items from a prior visit (P2.5.M7.2); see `priorKeyItems`. */
  priorKeyItems: KeyItem[];
  onPersist: ((record: RunSnapshot) => void) | null;
  onResult: ((result: RunResult) => void) | null;
  onAbortRequested: (() => void) | null;
  onJackOutRequested: (() => void) | null;
  /** Shell presentation hook — fired synchronously after jack-in completes. */
  onJackInPresent: (() => void) | null;
  /** Shell presentation hook — fired after jack-out finalizes. */
  onJackOutPresent: (() => void) | null;
  /** P3.M4.4 shell presentation hook — fired with the partner when it flatlines. */
  onPartnerDown: ((partner: Crew) => void) | null;
  _busUnsubs: (() => void)[];

  constructor({
    id,
    crewMember,
    partnerMember,
    seed,
    onPersist,
    onResult,
    onAbortRequested,
    onJackOutRequested,
    onJackInPresent,
    onJackOutPresent,
    onPartnerDown,
    priorMutationDeltas,
    priorKeyItems,
    priorSeenKeys,
  }: RunOptions = {}) {
    if (typeof seed !== 'number' || !Number.isFinite(seed)) {
      throw new TypeError(`Run requires a finite numeric seed, got ${seed}`);
    }
    if (!(crewMember instanceof Crew)) {
      throw new TypeError('Run requires a deployed Crew member');
    }
    if (crewMember.flatlined) {
      throw new Error(`Run: cannot deploy flatlined crew member "${crewMember.id}"`);
    }
    const partner = normalizePartnerMember(partnerMember, crewMember);
    if (onPersist !== undefined && typeof onPersist !== 'function') {
      throw new TypeError('Run: onPersist must be a function');
    }
    if (onResult !== undefined && typeof onResult !== 'function') {
      throw new TypeError('Run: onResult must be a function');
    }
    if (onAbortRequested !== undefined && typeof onAbortRequested !== 'function') {
      throw new TypeError('Run: onAbortRequested must be a function');
    }
    if (onJackOutRequested !== undefined && typeof onJackOutRequested !== 'function') {
      throw new TypeError('Run: onJackOutRequested must be a function');
    }
    if (onJackInPresent !== undefined && typeof onJackInPresent !== 'function') {
      throw new TypeError('Run: onJackInPresent must be a function');
    }
    if (onJackOutPresent !== undefined && typeof onJackOutPresent !== 'function') {
      throw new TypeError('Run: onJackOutPresent must be a function');
    }
    if (onPartnerDown !== undefined && typeof onPartnerDown !== 'function') {
      throw new TypeError('Run: onPartnerDown must be a function');
    }
    if (priorMutationDeltas !== undefined && !Array.isArray(priorMutationDeltas)) {
      throw new TypeError('Run: priorMutationDeltas must be an array when supplied');
    }
    if (priorKeyItems !== undefined && !Array.isArray(priorKeyItems)) {
      throw new TypeError('Run: priorKeyItems must be an array when supplied');
    }
    if (priorSeenKeys !== undefined && !Array.isArray(priorSeenKeys)) {
      throw new TypeError('Run: priorSeenKeys must be an array when supplied');
    }

    this.id = id ?? makeRunId(seed);
    this.crewMember = crewMember;
    this.partnerMember = partner;
    this.archetype = archetypeOfCrew(crewMember);
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.state = null;
    this.world = null;
    this.queue = null;
    this.bus = null;
    this.player = null;
    this.meatActor = null;
    this.activeLayer = 'meat';
    this.contract = null;
    this.exitTile = null;
    this.cyberspace = null;
    this.telemetry = freshTelemetry(this.archetype, this.seed);
    this.objectiveTimer = freshObjectiveTimer();
    this.mapSeen = new Set();
    this.keyItems = [];
    // Deltas are validated structurally on application (`applyMutationDeltas`)
    // and on campaign restore (`normalizeLocationSite`); store a shallow copy
    // so external mutation can't reach into the run.
    this.priorMutationDeltas = ((priorMutationDeltas as TileDelta[] | undefined) ?? []).map(d => ({
      ...d,
    }));
    this.priorSeenKeys = [...((priorSeenKeys as string[] | undefined) ?? [])];
    this.priorKeyItems = ((priorKeyItems as KeyItem[] | undefined) ?? []).map(k => ({ ...k }));
    this.onPersist = (onPersist as ((record: RunSnapshot) => void) | undefined) ?? null;
    this.onResult = (onResult as ((result: RunResult) => void) | undefined) ?? null;
    this.onAbortRequested = (onAbortRequested as (() => void) | undefined) ?? null;
    this.onJackOutRequested = (onJackOutRequested as (() => void) | undefined) ?? null;
    this.onJackInPresent = (onJackInPresent as (() => void) | undefined) ?? null;
    this.onJackOutPresent = (onJackOutPresent as (() => void) | undefined) ?? null;
    this.onPartnerDown = (onPartnerDown as ((partner: Crew) => void) | undefined) ?? null;

    /** @type {Array<() => void>} active bus subscriptions */
    this._busUnsubs = [];
  }

  /** Permitted from a fresh Run only. Caches the contract for `enterCombat`. */
  enterBriefing(contract: unknown): void {
    if (this.state !== null) {
      throw new Error(`Run.enterBriefing: illegal transition from ${this.state}`);
    }
    this.contract = normalizeContractForRun(contract);
    // P3.M3: latch the Cyberspace state machine off the validated contract.
    const cyber = contractRequiresCyberspace(this.contract);
    this.cyberspace = cyber ? { phase: 'dormant' } : null;
    // P3.M4.1: a meat partner only rides along on a Cyberspace dual-deploy.
    // (The Decker spawns it at jack-in.) A partner on a non-cyber run is a
    // wiring bug — crash rather than carry a reservation that never spawns.
    if (!cyber && this.partnerMember) {
      throw new Error('Run.enterBriefing: a meat partner requires a Cyberspace contract');
    }
    this.objectiveTimer = freshObjectiveTimer();
    this.mapSeen.clear();
    this.state = RUN_STATE.BRIEFING;
  }

  /**
   * Permitted from BRIEFING only. Builds the combat map (deterministic on
   * `contract.seed`), spawns the player + drones, and wires the listeners
   * that drive autosave + death detection.
   */
  enterCombat() {
    if (this.state !== RUN_STATE.BRIEFING) {
      throw new Error(`Run.enterCombat: illegal transition from ${this.state}`);
    }
    if (!this.contract) {
      throw new Error('Run.enterCombat: contract missing — call enterBriefing first');
    }
    this.#tearDownWorld();
    // Reseed the run rng to the contract seed so combat is deterministic on
    // that seed alone. The forked mapgen substream isolates terrain from
    // combat rolls (see `Rng.fork('mapgen')` inside `buildMap`).
    this.rng = new Rng(this.contract.seed);
    this.bus = new EventBus();
    const map = buildMap({
      rng: this.rng,
      width: this.contract.mapWidth,
      height: this.contract.mapHeight,
      threatCount: this.contract.threatCount,
      difficulty: this.contract.difficulty,
      includePrefabDoors: contractRequiresDoor(this.contract),
    });
    this.world = new World(map.grid, { events: this.bus });
    // Replay prior-visit terrain mutations (breach holes, removed doors) onto
    // the fresh geometry before any entity placement (P2.5.M7.2). This mutates
    // only the grid — `world.mutationDeltas` stays empty so it accumulates
    // *this* run's new breaches, which merge into the roster on extract.
    if (this.priorMutationDeltas.length > 0) {
      applyMutationDeltas(this.world.grid, this.priorMutationDeltas);
    }
    this.player = this.#makePlayer(map.spawns.player);
    // P3.M4.2: pre-jack-in the deployed operator is the sole controllable meat
    // crew; the partner (if any) is reserved off-grid until jack-in.
    this.meatActor = this.player;
    this.activeLayer = 'meat';
    this.world.addEntity(this.player);
    for (let i = 0; i < map.doors.length; i++) {
      const a = map.doors[i]!;
      // A door breached on a prior visit left its cell as RUBBLE (via the
      // companion tile delta). Skip re-placing the door so the breach persists.
      if (this.world.grid.tileAt(a.x, a.y) === TILE.RUBBLE) continue;
      this.world.addEntity(
        new Door({ id: `door-entity-${i}`, doorId: `door-${i}`, x: a.x, y: a.y })
      );
    }
    // Phase 2.9: one hostile faction per run, derived from the contract
    // principal (rival-group → RIVAL, else CORP). The queue drives that faction's
    // turn + AP refresh; index.ts's corp-turn driver targets the same.
    this.queue = new TurnQueue([FACTION.PLAYER, this.hostileFaction]);
    this.exitTile = { ...map.exitTile };
    const doorLinkedContract = contractRequiresDoor(this.contract);
    if (doorLinkedContract) {
      // Place unlock terminals and door-gated props before fodder so patrol
      // anchors cannot consume every spawn-side interactable tile.
      this.#placeObjectiveInteractables();
    }
    // Phase 2.7: resolve role composition (fodder mix + specialist + elite)
    // from the contract seed and difficulty. `composeEncounter` forks its own
    // RNG so the mix is deterministic and independent of mapgen rolls.
    const composition = composeEncounter({
      seed: this.contract.seed,
      difficulty: this.contract.difficulty,
      fodderCount: map.fodder.length,
    });
    // P2.9.M1.2: stamp principal-themed display identity onto each hostile
    // from the contract owner. Behavior/glyph are unchanged; this is label-only.
    // Every hostile carries the run's single allegiance (CORP or RIVAL).
    const principalId = this.contract.context.principal.id;
    // Stamp allegiance + principal identity onto a freshly-built hostile, before
    // it joins the world / binds the bus.
    const themeHostile = (entity: Entity, archetype: EnemyArchetype): void => {
      this.#stampAllegiance(entity);
      const alias = aliasFor(principalId, archetype);
      entity.displayName = alias.displayName;
      entity.principalTag = alias.principalTag;
    };
    const fodder = composition.entries.filter(e => e.role === ENEMY_ROLE.FODDER);
    for (let i = 0; i < map.fodder.length; i++) {
      const a = map.fodder[i]!;
      const entry = fodder[i];
      const archetype =
        entry?.archetype === ENEMY_ARCHETYPE.GUARD
          ? ENEMY_ARCHETYPE.GUARD
          : ENEMY_ARCHETYPE.SKIRMISHER;
      const hostile =
        archetype === ENEMY_ARCHETYPE.GUARD
          ? new Guard({
              id: `guard-${i}`,
              x: a.x,
              y: a.y,
              maxAp: 3,
              patrolWaypoints: a.waypoints,
              tier: entry!.tier,
            })
          : new Skirmisher({
              id: `drone-${i}`,
              x: a.x,
              y: a.y,
              maxAp: 3,
              patrolWaypoints: a.waypoints,
              tier: entry?.tier,
            });
      themeHostile(hostile, archetype);
      this.world.addEntity(hostile);
      hostile.bindToBus(this.bus);
    }
    // Specialists map 1:1 onto the specialist anchors mapgen budgeted for this
    // tier. Composition + anchor count agree by construction (both keyed to
    // difficulty), so a mismatch is a bug — fail loud rather than drop a threat.
    const specialists = composition.entries.filter(e => e.role === ENEMY_ROLE.SPECIALIST);
    if (specialists.length > map.specialists.length) {
      throw new Error(
        `Run.enterCombat: ${specialists.length} specialist(s) composed but only ` +
          `${map.specialists.length} anchor(s) for a ${this.contract.difficulty} map`
      );
    }
    for (let i = 0; i < specialists.length; i++) {
      const entry = specialists[i]!;
      const a = map.specialists[i]!;
      let specialist: PatrolHostile;
      if (entry.archetype === ENEMY_ARCHETYPE.LOOKOUT) {
        specialist = new Lookout({
          id: `lookout-${i}`,
          x: a.x,
          y: a.y,
          maxAp: 3,
          patrolWaypoints: a.waypoints,
          tier: entry.tier,
        });
      } else if (entry.archetype === ENEMY_ARCHETYPE.SNIPER) {
        // Sniper keeps the default 4 AP so it can move-then-aim in one corp turn.
        specialist = new Sniper({
          id: `sniper-${i}`,
          x: a.x,
          y: a.y,
          patrolWaypoints: a.waypoints,
          tier: entry.tier,
        });
      } else if (entry.archetype === ENEMY_ARCHETYPE.MEDIC) {
        specialist = new Medic({
          id: `medic-${i}`,
          x: a.x,
          y: a.y,
          maxAp: 3,
          patrolWaypoints: a.waypoints,
          tier: entry.tier,
        });
      } else {
        // Guards the day a new specialist joins `available` before its spawn
        // case lands here — fail loud rather than drop a composed threat.
        throw new Error(`Run.enterCombat: no spawn case for specialist "${entry.archetype}"`);
      }
      themeHostile(specialist, entry.archetype);
      this.world.addEntity(specialist);
      specialist.bindToBus(this.bus);
    }
    // Elites map 1:1 onto elite anchors. CRITICAL maps currently reserve one
    // anchor; a mismatch means composition and map budget drifted apart.
    const elites = composition.entries.filter(e => e.role === ENEMY_ROLE.ELITE);
    if (elites.length > map.elites.length) {
      throw new Error(
        `Run.enterCombat: ${elites.length} elite(s) composed but only ` +
          `${map.elites.length} anchor(s) for a ${this.contract.difficulty} map`
      );
    }
    for (let i = 0; i < elites.length; i++) {
      const entry = elites[i]!;
      const a = map.elites[i]!;
      let elite: PatrolHostile;
      if (entry.archetype === ENEMY_ARCHETYPE.BRUISER) {
        elite = new Bruiser({
          id: `bruiser-${i}`,
          x: a.x,
          y: a.y,
          patrolWaypoints: a.waypoints,
          tier: entry.tier,
        });
      } else if (entry.archetype === ENEMY_ARCHETYPE.JUGGERNAUT) {
        // Juggernaut keeps its low base AP (lifted to 4 by the T3 elite bonus)
        // so it cannot match the skirmisher's 4-AP dance.
        elite = new Juggernaut({
          id: `juggernaut-${i}`,
          x: a.x,
          y: a.y,
          patrolWaypoints: a.waypoints,
          tier: entry.tier,
        });
      } else if (entry.archetype === ENEMY_ARCHETYPE.FLANKER) {
        elite = new Flanker({
          id: `flanker-${i}`,
          x: a.x,
          y: a.y,
          patrolWaypoints: a.waypoints,
          tier: entry.tier,
        });
      } else {
        throw new Error(`Run.enterCombat: no spawn case for elite "${entry.archetype}"`);
      }
      themeHostile(elite, entry.archetype);
      this.world.addEntity(elite);
      elite.bindToBus(this.bus);
    }
    for (let i = 0; i < map.corpCivilians.length; i++) {
      const a = map.corpCivilians[i]!;
      const civ = new CorpCivilian({ id: `corp-civ-${i}`, x: a.x, y: a.y });
      this.#stampAllegiance(civ);
      this.world.addEntity(civ);
    }
    for (let i = 0; i < map.neutralCivilians.length; i++) {
      const a = map.neutralCivilians[i]!;
      const civ = new NeutralCivilian({ id: `neutral-civ-${i}`, x: a.x, y: a.y });
      this.world.addEntity(civ);
    }
    if (!doorLinkedContract) {
      this.#placeObjectiveInteractables();
    }
    this.#placeDynamicDoorEntities(map.dynamicDoors, map.doors.length);
    this.#placeConsumablePickups();
    // Post-placement safety net: verify no static interactable sealed a branch.
    if (!checkPlacementIntegrity(this.world, { x: this.player.x, y: this.player.y })) {
      console.warn(
        'Run.enterCombat: placement integrity check failed — a static entity ' +
          'may have sealed a passable branch. Seed:',
        this.contract.seed
      );
    }
    this.objectiveTimer = freshObjectiveTimer();
    this.mapSeen.clear();
    this.state = RUN_STATE.COMBAT;
    this.#recordCurrentPlayerVision();
    this._reattachCombatListeners();
  }

  /** Permitted from COMBAT only. Notifies the shell via `onResult`. */
  enterResult({
    outcome,
    telemetry,
  }: {
    outcome: Outcome;
    telemetry?: Partial<RunTelemetry>;
  }): void {
    if (this.state !== RUN_STATE.COMBAT) {
      throw new Error(`Run.enterResult: illegal transition from ${this.state}`);
    }
    if (!KNOWN_OUTCOMES.has(outcome)) {
      throw new Error(`Run.enterResult: unknown outcome "${outcome}"`);
    }
    if (telemetry && typeof telemetry === 'object') {
      this.telemetry = { ...this.telemetry, ...telemetry };
    }
    this.telemetry.outcome = outcome;
    this.telemetry.turn = this.queue?.turnNumber ?? this.telemetry.turn;
    this.#unwireCombatListeners();
    this.state = RUN_STATE.RESULT;
    if (this.onPersist) {
      this.onPersist(this.snapshot());
    }
    this.onResult?.({ outcome, telemetry: { ...this.telemetry } });
  }

  /** JSON-safe snapshot of the live run. See class docstring. */
  snapshot(): RunSnapshot {
    if (!this.world || !this.queue) {
      throw new Error('Run.snapshot: no live world to capture');
    }
    if (!this.state) {
      throw new Error('Run.snapshot: no run state to capture');
    }
    if (this.state === RUN_STATE.COMBAT) {
      this.#refreshObjectiveTimerState();
    }
    const world = this.world;
    const queue = this.queue;
    return {
      id: this.id,
      type: 'run',
      state: this.state,
      archetype: this.archetype,
      seed: this.seed,
      turnNumber: queue.turnNumber,
      currentFaction: queue.currentFaction,
      rng: { seed: this.rng.seed, state: this.rng.state },
      contract: this.contract ? cloneContract(this.contract) : null,
      exitTile: this.exitTile ? { ...this.exitTile } : null,
      grid: {
        w: world.grid.width,
        h: world.grid.height,
        tiles: Array.from(world.grid.tiles),
      },
      entities: Array.from(world.entities.values()).map(snapshotEntity),
      telemetry: { ...this.telemetry },
      alarm: world.snapshotAlarm(),
      alarmActive: world.alarmActive,
      objectiveTimer: { ...this.objectiveTimer },
      mapMemory: { seen: this.mapSeenKeys() },
      objectiveProgress: { securedPickups: world.securedPickupIds() },
      keyItems: this.keyItems.map(k => ({ id: k.id, label: k.label, doorId: k.doorId })),
      mutationDeltas: world.mutationDeltas.map(delta => ({ ...delta })),
      // P3.M4.1/M4.2: the reserved meat partner. While the cyber layer is still
      // dormant the partner is off-grid, so it serializes as an entity record
      // with a (0,0) placeholder cell. Once jacked in (active/resolved) the
      // partner is a live grid entity captured in `entities`, so the off-grid
      // record is omitted to avoid a duplicate.
      ...(this.partnerMember && this.cyberspace?.phase === 'dormant'
        ? { partner: { ...snapshotEntity(this.partnerMember), x: 0, y: 0 } }
        : {}),
      // P3.M4.2: which layer holds input. Only meaningful while jacked in;
      // captured so a mid-flip save restores to the same side.
      ...(this.cyberspace?.phase === 'active' ? { activeLayer: this.activeLayer } : {}),
      // P3.M3: present exactly when the contract has a Cyberspace component.
      ...(this.cyberspace ? { cyberspace: snapshotCyberspace(this.cyberspace) } : {}),
    };
  }

  /**
   * Terrain mutations accumulated during *this* run (P2.5.M7.2) — breaches,
   * removed doors. Merged into the location roster on extract. Empty before
   * combat.
   */
  get mutationDeltas(): TileDelta[] {
    return this.world?.mutationDeltas ?? [];
  }

  // ------------------------------------------------------------------
  // P3.M3.3 — Cyberspace layer bridge
  // ------------------------------------------------------------------

  /** True while the Decker is jacked in and the cyber layer is live. */
  get cyberActive(): boolean {
    return this.cyberspace?.phase === 'active';
  }

  /** True while a cyber layer is live *and* the active layer is Cyberspace. */
  get cyberInputActive(): boolean {
    return this.cyberspace?.phase === 'active' && this.activeLayer === 'cyber';
  }

  /**
   * The world the shell should render/drive. Honors the simstim flip
   * (`activeLayer`): Cyberspace only while jacked in *and* flipped to cyber;
   * Meatspace otherwise (including the post-jack-in pre-first-flip window).
   */
  get activeWorld(): World | null {
    return this.cyberInputActive && this.cyberspace?.phase === 'active'
      ? this.cyberspace.layer.world
      : this.world;
  }

  /**
   * The actor the shell should control: the cyber avatar while flipped to the
   * grid, else the controllable Meatspace crew (`meatActor`, which is the
   * partner after a dual-deploy jack-in, the Decker otherwise).
   */
  get activeActor(): Crew | CyberAvatar | null {
    if (this.cyberInputActive && this.cyberspace?.phase === 'active') {
      return this.cyberspace.layer.avatar;
    }
    return this.meatActor ?? this.player;
  }

  /**
   * P3.M4.2: the Decker's immobile Meatspace body while jacked in (`null`
   * otherwise). It is the deployed Decker (`player`) frozen at the port.
   */
  get deckerBody(): Crew | null {
    return this.cyberspace?.phase === 'active' && this.player instanceof Decker
      ? this.player
      : null;
  }

  /**
   * P3.M4.4: true when a dual-deploy meat partner was fielded and has flatlined
   * on the grid. The run does not end on partner death (the Decker fights on),
   * but `Campaign.onJobEnd` flatlines the partner for good once the run wraps.
   */
  get partnerDown(): boolean {
    return !!this.partnerMember && !this.partnerMember.alive;
  }

  /**
   * P3.M4.3: is there a second operator to flip control to right now?
   *   - Jacked in: flip between the controllable meat operator and the cyber
   *     avatar — but only when the meat side is actually controllable (a
   *     dual-deploy partner, not just the frozen solo body).
   *   - Post jack-out: flip between the two live meat operators (Decker ↔
   *     partner) sharing the meat grid.
   */
  canFlip(): boolean {
    if (this.state !== RUN_STATE.COMBAT) return false;
    if (this.cyberspace?.phase === 'active') {
      return !!this.meatActor && this.meatActor.alive && !this.meatActor.frozen;
    }
    return this.#aliveMeatAlternate() !== null;
  }

  /**
   * P3.M4.3: the simstim flip — swap which operator receives player input.
   * Free action. Throws if there is nothing to flip to (the shell gates on
   * {@link canFlip} first, so reaching here illegally is a wiring bug).
   */
  flip(): void {
    if (!this.canFlip()) {
      throw new Error('Run.flip: no second operator to flip to');
    }
    if (this.cyberspace?.phase === 'active') {
      this.activeLayer = this.activeLayer === 'cyber' ? 'meat' : 'cyber';
      return;
    }
    const alternate = this.#aliveMeatAlternate();
    if (alternate) this.meatActor = alternate;
  }

  /**
   * P3.M4.4: the operator {@link flip} would hand control to right now — the
   * other layer's operator while jacked (avatar ↔ partner), else the other
   * live meat operator. `null` when there is nothing to flip to. Used to reason
   * about the *crew's* remaining AP, not just the active actor's.
   */
  #flipAlternate(): Crew | CyberAvatar | null {
    if (!this.canFlip()) return null;
    if (this.cyberspace?.phase === 'active') {
      return this.activeLayer === 'cyber' ? this.meatActor : this.cyberspace.layer.avatar;
    }
    return this.#aliveMeatAlternate();
  }

  /**
   * P3.M4.4: independent AP pools, decoupled turn-end. The mutual turn is over
   * only when *every controllable* operator is spent — the active actor at 0 AP
   * and no flip alternate with AP left. A single-deploy/solo operator (no
   * alternate) ends at 0 as before; the frozen Decker body is never the active
   * actor nor a flip alternate, so its full pool can't keep the turn alive.
   */
  endOfTurnReady(): boolean {
    const active = this.activeActor;
    if (!active || active.ap > 0) return false;
    const alternate = this.#flipAlternate();
    return !alternate || alternate.ap === 0;
  }

  /**
   * P3.M4.4: resolve the active operator running out of AP. The shell calls
   * this wherever it used to auto-end on exhaustion:
   *   - `'continue'` — the active operator still has AP; nothing to do.
   *   - `'end'`      — the whole crew is spent; the shell drives the corp/ICE
   *                    hostile phases (which refresh every pool exactly once).
   *   - `'auto-flip'`— the active operator is spent but another still has AP;
   *                    control has been handed to it (no turn end, no refresh).
   * The flip is safe here: a spent active actor that is not {@link endOfTurnReady}
   * guarantees a live alternate with AP to flip to.
   */
  concludeActiveOperatorTurn(): 'continue' | 'auto-flip' | 'end' {
    const active = this.activeActor;
    if (!active || active.ap > 0) return 'continue';
    if (this.endOfTurnReady()) return 'end';
    this.flip();
    return 'auto-flip';
  }

  /**
   * P3.M4.4: resolve a Wait (`.`). The caller has already forfeited the active
   * operator's remaining AP; Wait is an explicit "pass *this* operator, switch
   * to the other," so — unlike running dry through actions — it **always** hands
   * control to the other operator when one exists, regardless of whether that
   * operator still has AP. Ending is orthogonal: the mutual turn ends when the
   * whole crew is spent.
   *   - `'flip'`         — control handed off; the other operator can still act.
   *   - `'flip-and-end'` — control handed off *and* the crew is spent, so the
   *                        shell also drives the hostile phases (next turn opens
   *                        on the operator we flipped to).
   *   - `'end'`          — solo / single-deploy (nobody to flip to); just end.
   */
  passActiveOperatorTurn(): 'flip' | 'flip-and-end' | 'end' {
    if (!this.#flipAlternate()) return 'end';
    this.flip();
    return this.endOfTurnReady() ? 'flip-and-end' : 'flip';
  }

  /**
   * P3.M4.4: the meat partner just flatlined. Repair the active-operator state
   * so the player is never left driving a corpse, then alert the shell. If the
   * dead partner was the meat operator, hand meat control back to the Decker
   * (`player`); while still jacked in, the body is frozen and can't act, so also
   * force the view to Cyberspace (the avatar is the only live operator). The
   * shell hook surfaces the alert even when the kill happened off-screen.
   */
  #onPartnerFlatlined(partner: Crew): void {
    if (this.meatActor === partner) {
      this.meatActor = this.player;
      if (this.cyberspace?.phase === 'active') {
        this.activeLayer = 'cyber';
      }
    }
    this.onPartnerDown?.(partner);
  }

  /**
   * The *other* live meat operator on the grid (Decker ↔ partner), distinct
   * from the current `meatActor`. `null` when there is no second one — pre-jack
   * solo runs, or after a partner flatline. Used only outside an active
   * jack-in (where the flip is meat↔cyber instead).
   */
  #aliveMeatAlternate(): Crew | null {
    const current = this.meatActor;
    for (const crew of [this.player, this.partnerMember]) {
      if (crew && crew !== current && crew.alive && this.world?.entities.has(crew.id)) {
        return crew;
      }
    }
    return null;
  }

  /**
   * Dormant → active: spawn the Cyberspace layer. Driven by the meat-bus
   * `EVENT.JACK_IN` emission from a `JackInPoint` link. The layer derives
   * from the *contract* seed, so the layout is independent of the jack-in
   * turn. Every precondition violation throws — a JACK_IN emission outside a
   * dormant cyber run is corrupt state, not a recoverable refusal.
   */
  jackIn(point: JackInPoint): void {
    if (this.state !== RUN_STATE.COMBAT) {
      throw new Error(`Run.jackIn: illegal from state ${this.state} (COMBAT only)`);
    }
    if (!this.contract) {
      throw new Error('Run.jackIn: COMBAT state without a contract');
    }
    if (!this.cyberspace) {
      throw new Error('Run.jackIn: contract has no Cyberspace component');
    }
    if (this.cyberspace.phase !== 'dormant') {
      throw new Error(`Run.jackIn: illegal from cyberspace phase "${this.cyberspace.phase}"`);
    }
    if (!(point instanceof JackInPoint) || !point.linked) {
      throw new Error('Run.jackIn: requires a linked jack-in point');
    }
    if (!(this.player instanceof Decker)) {
      throw new Error('Run.jackIn: only a Decker can enter the grid');
    }
    const decker = this.player;
    const layer = CyberspaceLayer.build({
      contractSeed: this.contract.seed,
      difficulty: this.contract.difficulty,
      decker,
      nodeCount: objectiveCount(this.contract),
    });
    this.cyberspace = { phase: 'active', layer };
    this.#wireCyberLayerListeners(layer);
    // P3.M4.2: the Decker's body is now "a vegetable" at the port — freeze it
    // (immobile, still targetable). If a meat partner was reserved, spawn it
    // onto the grid and hand it control; the player stays in Meatspace until
    // the first flip (P3.M4.3). A solo jack-in has no meat operator to hold, so
    // control drops straight to the grid.
    if (!this.world) {
      throw new Error('Run.jackIn: COMBAT state without a meat world');
    }
    decker.frozen = true;
    if (this.partnerMember) {
      const spawn = this.#partnerSpawnTile(this.world, decker);
      this.#initCombatant(this.partnerMember, spawn);
      this.world.addEntity(this.partnerMember);
      this.meatActor = this.partnerMember;
      this.activeLayer = 'meat';
    } else {
      this.meatActor = decker;
      this.activeLayer = 'cyber';
    }
    // The latch transition must never be lost — autosave explicitly.
    if (this.onPersist) {
      this.onPersist(this.snapshot());
    }
    this.onJackInPresent?.();
  }

  /**
   * Active → resolved: the avatar routed out through the exit port (cyber-bus
   * `EVENT.JACK_OUT`). Latches the objective outcome and tears the layer
   * down; the link is burned — re-entry is refused. P3.M4.6 adds the forced
   * variant (body under fire).
   */
  jackOut(): void {
    if (this.state !== RUN_STATE.COMBAT) {
      throw new Error(`Run.jackOut: illegal from state ${this.state} (COMBAT only)`);
    }
    if (this.cyberspace?.phase !== 'active') {
      throw new Error(
        `Run.jackOut: illegal from cyberspace phase "${this.cyberspace?.phase ?? 'none'}"`
      );
    }
    if (!this.contract) {
      throw new Error('Run.jackOut: COMBAT state without a contract');
    }
    const layer = this.cyberspace.layer;
    // P3.M3.4: the latch is the sliced-node tally at the moment the link
    // drops. Jacking out early leaves the objective permanently unsatisfiable
    // — extraction then routes through the existing abort-confirm flow.
    const { sliced } = dataNodeProgress(layer.world);
    const objectiveComplete = sliced >= objectiveCount(this.contract);
    // S7.5: an incomplete jack-out is irreversible — defer to the shell for
    // confirmation when a callback is registered (the port's interact AP is
    // already spent; a re-request after cancel costs it again). No callback
    // → resolve immediately, the `onAbortRequested` posture.
    if (!objectiveComplete && this.onJackOutRequested) {
      this.onJackOutRequested();
      return;
    }
    this.#finalizeJackOut(layer, objectiveComplete);
  }

  /**
   * S7.5: finalize a deferred early jack-out after the shell confirms.
   * Unlike `confirmAbort` (where walking off the exit tile legitimately
   * voids the request), nothing can legally change between request and
   * confirm — the modal blocks turn flow — so an illegal state here is a
   * wiring bug and throws rather than silently no-oping.
   */
  confirmJackOut(): void {
    if (this.state !== RUN_STATE.COMBAT || this.cyberspace?.phase !== 'active') {
      throw new Error(
        `Run.confirmJackOut: no jack-out pending (state ${this.state}, phase ${
          this.cyberspace?.phase ?? 'none'
        })`
      );
    }
    if (!this.contract) {
      throw new Error('Run.confirmJackOut: COMBAT state without a contract');
    }
    const layer = this.cyberspace.layer;
    // Recompute rather than latch `false` blindly — honest if a future flow
    // ever confirms after progress changed.
    const { sliced } = dataNodeProgress(layer.world);
    this.#finalizeJackOut(layer, sliced >= objectiveCount(this.contract));
  }

  /** Active → resolved: teardown, latch, LINK BURNED, autosave. */
  #finalizeJackOut(layer: CyberspaceLayer, objectiveComplete: boolean): void {
    layer.teardown();
    this.cyberspace = { phase: 'resolved', objectiveComplete };
    // P3.M4.2: the Decker is back in its body — unfreeze it, return control to
    // Meatspace, and make the body the active operator. The partner (if any)
    // remains on the grid as a second meat crew; the meat↔meat flip that lets
    // the player switch between them lands with P3.M4.3.
    if (this.player) {
      this.player.frozen = false;
      this.meatActor = this.player;
    }
    this.activeLayer = 'meat';
    // S5: the link is burned — re-jack-in refused for the rest of the run.
    this.#meatJackInPoint().burn();
    if (this.onPersist) {
      this.onPersist(this.snapshot());
    }
    this.onJackOutPresent?.();
  }
  #meatJackInPoint(): JackInPoint {
    if (!this.world) {
      throw new Error('Run.#meatJackInPoint: no live world');
    }
    for (const entity of this.world.entities.values()) {
      if (entity instanceof JackInPoint) return entity;
    }
    throw new Error('Run.#meatJackInPoint: cyber contract has no jack-in point in the world');
  }

  /**
   * Phase 2.9: the single hostile faction for this run, derived from the
   * contract principal's groups (rival-group → `RIVAL`, corp/civic → `CORP`).
   * Drives the turn queue and the corp-turn driver. Defaults to `CORP` when
   * there's no contract (e.g. pre-combat states).
   */
  get hostileFaction(): FactionId {
    return factionForPrincipalGroups(this.contract?.context?.principal?.groups ?? []);
  }

  /** Phase 2.9: override CORP defaults with the run's single hostile allegiance. */
  #stampAllegiance(entity: Entity): void {
    entity.faction = this.hostileFaction;
  }

  isObjectiveSatisfied(): boolean {
    return this.#refreshObjectiveTimerState();
  }

  canExtract(): boolean {
    if (!this.contract) return false;
    if (this.isObjectiveSatisfied()) return true;
    return this.#isTimedObjectiveExpired();
  }

  objectiveTurnsRemaining(): number | null {
    if (!this.contract || !this.queue) return null;
    return objectiveTurnsRemaining(this.contract, this.queue.turnNumber);
  }

  /**
   * Add a run-scoped key item (keycard with no siteId). Crashes on duplicates
   * per project policy — double-collection is always a bug.
   */
  addKeyItem(item: KeyItem): void {
    if (!item || typeof item !== 'object') {
      throw new TypeError('Run.addKeyItem: item must be an object');
    }
    if (typeof item.id !== 'string' || item.id.length === 0) {
      throw new TypeError('Run.addKeyItem: item.id must be a non-empty string');
    }
    if (typeof item.label !== 'string' || item.label.length === 0) {
      throw new TypeError('Run.addKeyItem: item.label must be a non-empty string');
    }
    if (typeof item.doorId !== 'string' || item.doorId.length === 0) {
      throw new TypeError('Run.addKeyItem: item.doorId must be a non-empty string');
    }
    if (this.keyItems.some(k => k.id === item.id)) {
      throw new Error(`Run.addKeyItem: duplicate key item "${item.id}"`);
    }
    this.keyItems.push({ id: item.id, label: item.label, doorId: item.doorId });
  }

  mapSeenKeys(): string[] {
    return [...this.mapSeen].sort(compareCoordKeys);
  }

  recordMapSeen(keys: Iterable<string>): void {
    if (!this.world) {
      throw new Error('Run.recordMapSeen: no live world to validate against');
    }
    for (const key of keys) {
      const point = parseCoordKey(key, 'Run.recordMapSeen');
      if (!this.world.grid.inBounds(point.x, point.y)) {
        throw new RangeError(`Run.recordMapSeen: key "${key}" is out of bounds`);
      }
      this.mapSeen.add(coordKey(point.x, point.y));
    }
  }

  restoreMapMemory(memory: MapMemorySnapshot | null | undefined): void {
    this.mapSeen.clear();
    if (!memory) return;
    if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
      throw new TypeError('Run.restoreMapMemory: memory must be an object');
    }
    if (!Array.isArray(memory.seen)) {
      throw new TypeError('Run.restoreMapMemory: memory.seen must be an array');
    }
    this.recordMapSeen(memory.seen);
  }

  /** Compatibility alias for `recordMapSeen` — retained for existing call sites. */
  recordReconSeen(keys: Iterable<string>): void {
    this.recordMapSeen(keys);
  }

  /** Re-derive prior site exploration memory after campaign restore. */
  refreshPriorSiteMemory(seenKeys: string[]): void {
    if (!Array.isArray(seenKeys)) {
      throw new TypeError('Run.refreshPriorSiteMemory: seenKeys must be an array');
    }
    this.priorSeenKeys = [...seenKeys];
  }

  objectiveProgress() {
    if (!this.contract) return null;
    return resolveObjectiveProgress(
      this.contract,
      this.world,
      this.mapSeen,
      this.#cyberNodeProgress() ?? null
    );
  }

  /**
   * P3.M3.4: the data-node tally per cyberspace phase — live count while the
   * layer is active, the latch once resolved, zero while dormant. `undefined`
   * for contracts without a Cyberspace component.
   */
  #cyberNodeProgress(): CyberNodeProgress | undefined {
    if (!this.contract || !this.cyberspace) return undefined;
    if (this.contract.objective.kind !== OBJECTIVES.DATA_NODE_SLICE) return undefined;
    const required = objectiveCount(this.contract);
    switch (this.cyberspace.phase) {
      case 'dormant':
        return { sliced: 0, required };
      case 'active':
        return { sliced: dataNodeProgress(this.cyberspace.layer.world).sliced, required };
      case 'resolved':
        return { sliced: this.cyberspace.objectiveComplete ? required : 0, required };
    }
  }

  /**
   * Internal hook used by `enterCombat` *and* by `persistence.restore()` to
   * re-attach the COMBAT-state bus subscriptions. Underscored rather than
   * `#`-private because cross-module restore needs to call it.
   */
  _reattachCombatListeners(): void {
    if (!this.bus) {
      throw new Error('Run._reattachCombatListeners: no EventBus attached');
    }
    this.#unwireCombatListeners();
    const bus = this.bus;
    this._busUnsubs.push(
      bus.on(EVENT.TURN_ENDED, payload => this.#onTurnEnded(payload as TurnEndedPayload)),
      bus.on(EVENT.ENTITY_DAMAGED, payload =>
        this.#onEntityDamaged(payload as EntityDamagedPayload)
      ),
      bus.on(EVENT.ENTITY_MOVED, payload => this.#onEntityMoved(payload as EntityMovedPayload)),
      // P3.M3.3: a Decker linking a JackInPoint opens the cyber layer.
      bus.on(EVENT.JACK_IN, payload => this.jackIn((payload as { point: JackInPoint }).point))
    );
    // Restored mid-jack-in: re-wire the cyber-layer listeners on the same seam.
    if (this.cyberspace?.phase === 'active') {
      this.#wireCyberLayerListeners(this.cyberspace.layer);
    }
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  #makePlayer(spawn: GridPoint): Crew {
    return this.#initCombatant(this.crewMember, spawn);
  }

  /**
   * Prep a crew member for the Meatspace grid — spawn position, full AP, combat
   * inventory. HP persists across jobs (no reset; Armour Plating via Finn is the
   * only Hub-side HP recovery, stims are combat-only). Shared by the deployed
   * operator (`#makePlayer`) and the dual-deploy partner spawned at jack-in.
   */
  #initCombatant(crew: Crew, spawn: GridPoint): Crew {
    crew.x = spawn.x;
    crew.y = spawn.y;
    crew.maxAp = 4;
    crew.ap = crew.maxAp;
    crew.alive = true;
    crew.stealthed = false;
    crew.frozen = false;
    crew.initInventory();
    if (crew instanceof Tech) {
      crew.turretReady = true;
    }
    return crew;
  }

  /**
   * P3.M4.2: choose a deterministic, *safe* Meatspace cell to drop the
   * dual-deploy partner into at jack-in — "a random cell, not directly in
   * danger, behind cover" (resolved decision). Candidates are free, unoccupied
   * floor tiles off the body's tile; we prefer tiles no live hostile can see
   * (geometry LOS) and that sit against cover (a wall neighbour). Falls back
   * through safe → any-free so a hostile-saturated map still spawns the
   * partner; an utterly full grid is corrupt and throws.
   */
  #partnerSpawnTile(world: World, body: Entity): GridPoint {
    const grid = world.grid;
    const hostiles = [...world.entities.values()].filter(
      e => e.alive && e.faction !== FACTION.PLAYER && e.faction !== FACTION.NEUTRAL
    );
    const seen = (tx: number, ty: number): boolean =>
      hostiles.some(h => hasLineOfSight(grid, h.x, h.y, tx, ty));
    const hasCover = (tx: number, ty: number): boolean =>
      !grid.isPassable(tx, ty - 1) ||
      !grid.isPassable(tx, ty + 1) ||
      !grid.isPassable(tx - 1, ty) ||
      !grid.isPassable(tx + 1, ty);

    const free: GridPoint[] = [];
    const safe: GridPoint[] = [];
    const safeCover: GridPoint[] = [];
    // Stable iteration (row-major) keeps the candidate order deterministic.
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (x === body.x && y === body.y) continue;
        if (!grid.isPassable(x, y)) continue;
        if (world.entityAt(x, y)) continue;
        const tile = { x, y };
        free.push(tile);
        if (seen(x, y)) continue;
        safe.push(tile);
        if (hasCover(x, y)) safeCover.push(tile);
      }
    }
    const pool = safeCover.length ? safeCover : safe.length ? safe : free;
    if (pool.length === 0) {
      throw new Error('Run.#partnerSpawnTile: no free Meatspace cell to spawn the partner');
    }
    return pool[this.rng.intRange(0, pool.length)]!;
  }

  #unwireCombatListeners(): void {
    for (const off of this._busUnsubs) off();
    this._busUnsubs = [];
  }

  #onTurnEnded(payload: TurnEndedPayload): void {
    if (this.state !== RUN_STATE.COMBAT) return;
    if (!this.queue) {
      throw new Error('Run.#onTurnEnded: COMBAT state without a TurnQueue');
    }
    if (!payload || typeof payload.next !== 'string') {
      throw new Error('Run.#onTurnEnded: TURN_ENDED payload missing the incoming faction');
    }
    this.telemetry.turn = this.queue.turnNumber;
    // P3.M3.3: both worlds tick on the single meat queue — refresh the
    // incoming faction's AP on the cyber grid (and its alarm on round
    // advance) before the autosave below captures the post-state.
    if (this.cyberspace?.phase === 'active') {
      this.cyberspace.layer.onTurnEnded(payload.next);
    }
    this.#refreshObjectiveTimerState();
    if (!this.onPersist) return;
    this.onPersist(this.snapshot());
  }

  /**
   * P3.M3.3: cyber-bus listeners, wired on jack-in and re-wired through
   * `_reattachCombatListeners` after a mid-jack-in restore. Unsubs join
   * `_busUnsubs`, so `enterResult`/re-wiring clears them with the meat set.
   */
  #wireCyberLayerListeners(layer: CyberspaceLayer): void {
    this._busUnsubs.push(
      layer.bus.on(EVENT.ENTITY_DAMAGED, payload =>
        this.#onCyberEntityDamaged(payload as EntityDamagedPayload)
      ),
      layer.bus.on(EVENT.JACK_OUT, () => this.jackOut())
    );
  }

  /**
   * The cyber twin of {@link #onEntityDamaged}. Avatar death is real death
   * (scope decision #3): black ICE burning the last RAM routes through the
   * existing DEATH path, and `Campaign.onJobEnd` flatlines the Decker.
   */
  #onCyberEntityDamaged({ attacker, target, damage, killed, source }: EntityDamagedPayload): void {
    if (this.state !== RUN_STATE.COMBAT) return;
    if (this.cyberspace?.phase !== 'active') return;
    const layer = this.cyberspace.layer;
    if (damage <= 0 && !killed) return;
    if (target === layer.avatar) {
      this.telemetry.lastDamageSource = source ?? null;
      this.telemetry.lastAttacker = attacker?.id ?? null;
      this.telemetry.hpAtDamage = layer.avatar.hp;
      if (killed) {
        this.telemetry.hpAtDeath = 0;
        this.telemetry.cause = `${attacker?.id ?? 'unknown'}::${source ?? 'unknown'}(${damage})`;
        this.enterResult({ outcome: OUTCOME.DEATH });
      }
      return;
    }
    if (attacker === layer.avatar && killed) {
      this.telemetry.kills = (this.telemetry.kills ?? 0) + 1;
    }
    // Unbind dead ICE patrols immediately (P3.M3.5 spawns them) — mirror of
    // the meat-side PatrolHostile unbind.
    if (killed && target instanceof PatrolHostile) {
      target.unbind();
    }
  }

  #onEntityDamaged({ attacker, target, damage, killed, source }: EntityDamagedPayload): void {
    if (this.state !== RUN_STATE.COMBAT) return;
    if (!this.player) {
      throw new Error('Run.#onEntityDamaged: COMBAT state without a player');
    }
    if (damage <= 0 && !killed) return;
    if (target === this.player) {
      this.telemetry.lastDamageSource = source ?? null;
      this.telemetry.lastAttacker = attacker?.id ?? null;
      this.telemetry.hpAtDamage = this.player.hp;
      if (killed) {
        this.telemetry.hpAtDeath = 0;
        this.telemetry.cause = `${attacker?.id ?? 'unknown'}::${source ?? 'unknown'}(${damage})`;
        this.enterResult({ outcome: OUTCOME.DEATH });
      }
      return;
    }
    // P3.M4.4: the meat partner flatlining is *not* run-ending — the Decker
    // fights on (jacked in, or post jack-out). But it loses the player a meat
    // operator, so repair control state and alert the shell unconditionally
    // (the kill can land off-screen while the player is in Cyberspace).
    if (killed && this.partnerMember && target === this.partnerMember) {
      this.#onPartnerFlatlined(this.partnerMember);
      return;
    }
    if (attacker === this.player && killed) {
      this.telemetry.kills = (this.telemetry.kills ?? 0) + 1;
    } else if (killed && attacker instanceof Turret && attacker.ownerId === this.player.id) {
      this.telemetry.kills = (this.telemetry.kills ?? 0) + 1;
    }
    // Emit civilian:harmed when a neutral *bystander* takes damage from the
    // player (or the player's turret). Corp staff (CorpCivilian) are excluded —
    // killing them is tactically valid and carries no Rep penalty.
    if (target instanceof NeutralCivilian) {
      const isPlayerSource =
        attacker === this.player ||
        (attacker instanceof Turret && attacker.ownerId === this.player.id);
      if (isPlayerSource) {
        this.telemetry.civilianHarms = ((this.telemetry.civilianHarms as number) ?? 0) + 1;
        this.world?.events?.emit(EVENT.CIVILIAN_HARMED, {
          attacker,
          target,
          damage,
          killed,
          source,
        });
      }
    }
    // Unbind dead patrol hostiles (drones, guards) from the event bus
    // immediately so their NOISE/ALARM handlers stop firing for the rest of the
    // run. (#6 adversarial review)
    if (killed && target instanceof PatrolHostile) {
      target.unbind();
    }

    // Assign typed loot to killed hostiles — fodder drops scrap (mechanical),
    // corp turrets drop chips (electronics), elites drop bio (augmentations).
    // The loot roll uses the Run's own Rng so it's deterministic on the seed.
    const lootTarget = target as Partial<LootableEntity>;
    if (killed && target instanceof Hostile && !lootTarget.loot) {
      lootTarget.loot = { salvage: this.#rollLoot(target) };
    }
  }

  /**
   * Roll typed loot for a freshly-killed hostile. Drone = scrap, turret = chips,
   * elites = bio, everything else = scrap (safe default).
   */
  #rollLoot(target: Hostile): TypedSalvage {
    if (target instanceof CorpTurret) {
      // Pure electronics — chips only. Slightly tighter range than drones
      // since turrets are infrastructure rather than mobile threats.
      return makeSalvage({ chips: this.rng.intRange(SALVAGE_DROP_MIN, SALVAGE_DROP_MAX + 1) });
    }
    if (target instanceof Bruiser || target instanceof Juggernaut || target instanceof Flanker) {
      return makeSalvage({ bio: this.rng.intRange(SALVAGE_DROP_MIN, SALVAGE_DROP_MAX + 1) });
    }
    return makeSalvage({
      scrap: this.rng.intRange(SALVAGE_DROP_MIN, SALVAGE_DROP_MAX + 1),
    });
  }

  #onEntityMoved({ entity, to }: EntityMovedPayload): void {
    if (this.state !== RUN_STATE.COMBAT) return;
    if (!this.exitTile) return;
    if (entity === this.player) {
      this.#recordCurrentPlayerVision();
      if (to.x === this.exitTile.x && to.y === this.exitTile.y) {
        this.#tryExtractFromExit();
      }
      return;
    }
    if (
      entity instanceof EscortNpc &&
      this.player?.x === this.exitTile.x &&
      this.player.y === this.exitTile.y
    ) {
      this.#tryExtractFromExit();
    }
  }

  #tryExtractFromExit(): void {
    if (!this.contract) {
      throw new Error('Run.#tryExtractFromExit: exit reached without an active contract');
    }
    const objectiveComplete = this.isObjectiveSatisfied();
    const objectiveExpired = this.#isTimedObjectiveExpired();
    if (!objectiveComplete && !objectiveExpired) {
      // Escort missions: the player often reaches the exit before the linked
      // NPC finishes catch-up in player aftermath. Wait for follow steps to
      // bring them into extraction range before treating this as an abort.
      if (this.#isEscortExtractionPending()) return;
      // Abort: objective incomplete — ask the shell for confirmation before
      // finalising. If no callback is registered, extract immediately (tests,
      // harness).
      if (this.onAbortRequested) {
        this.onAbortRequested();
        return;
      }
    }
    this.telemetry.cause = objectiveComplete
      ? 'exit-reached'
      : objectiveExpired
        ? 'exit-reached-objective-incomplete'
        : 'abort';
    this.enterResult({
      outcome: OUTCOME.EXIT,
      telemetry: {
        objectiveComplete,
        objectiveExpired,
      },
    });
  }

  /**
   * Finalise an abort extraction after the shell confirms. Safe to call only
   * while the run is still in COMBAT (if the player moved away from the exit
   * tile before confirming, the run stays live and this is a no-op).
   */
  confirmAbort(): void {
    if (this.state !== RUN_STATE.COMBAT) return;
    this.telemetry.cause = 'abort';
    this.enterResult({
      outcome: OUTCOME.EXIT,
      telemetry: {
        objectiveComplete: false,
        objectiveExpired: false,
      },
    });
  }

  /** Activated escort still catching up while the player waits on the exit tile. */
  #isEscortExtractionPending(): boolean {
    if (!this.contract || !this.world || !this.player || !this.exitTile) return false;
    if (this.contract.objective.kind !== OBJECTIVES.ESCORT_EXTRACT) return false;
    if (this.player.x !== this.exitTile.x || this.player.y !== this.exitTile.y) return false;
    for (const entity of this.world.entities.values()) {
      if (!(entity instanceof EscortNpc)) continue;
      if (!entity.alive || !entity.activated) return false;
      return !isEscortExtractSatisfied(this.world);
    }
    return false;
  }

  #tearDownWorld(): void {
    this.#unwireCombatListeners();
    if (this.world) {
      for (const e of this.world.entities.values()) {
        const maybeBound = e as Entity & { unbind?: () => void };
        if (typeof maybeBound.unbind === 'function') maybeBound.unbind();
      }
    }
    resetCorpTurnStatusCache();
    this.world = null;
    this.queue = null;
    this.player = null;
    this.exitTile = null;
    this.bus = null;
  }

  #placeObjectiveInteractables(): void {
    if (!this.world || !this.player || !this.contract || !this.exitTile) return;
    const linkedDoorId = objectiveDoorId(this.contract);
    if (linkedDoorId) {
      assertDoorExists(this.world, linkedDoorId);
      if (this.contract.objective.kind !== OBJECTIVES.TERMINAL_SLICE) {
        const revisitSiteId = this.contract.context.locationSiteId;
        const priorKey =
          revisitSiteId &&
          this.priorKeyItems.find(k => k.doorId === linkedDoorId && k.siteId === revisitSiteId);
        // Held site keycard from a prior visit → skip spawn; door stays locked
        // until interact (P2.5.M7.2).
        if (!priorKey) {
          // 50/50 roll — terminal unlock vs keycard unlock (P2.5.M6.2).
          const unlockMethod = resolveUnlockMethod(this.contract, this.rng);
          if (unlockMethod === 'terminal') {
            // Decoupled placement — terminal can land anywhere reachable from
            // spawn, not biased toward door proximity (P2.5.M6.2).
            const terminalAnchor = findDecoupledTerminalAnchor(
              this.world,
              this.player,
              this.exitTile,
              this.rng,
              linkedDoorId
            );
            this.world.addEntity(
              new Terminal({
                id: 'terminal-unlock-0',
                x: terminalAnchor.x,
                y: terminalAnchor.y,
                label: 'Access terminal',
                raisesAlarm: true,
                unlocksId: linkedDoorId,
              })
            );
          } else {
            // Keycard placed on the spawn side as an alternative unlock (P2.5.M6.2).
            const keycardAnchor = findDecoupledTerminalAnchor(
              this.world,
              this.player,
              this.exitTile,
              this.rng,
              linkedDoorId
            );
            // On a remembered-site revisit, stamp the keycard with the site id
            // so collecting it promotes the card to campaign-scoped (P2.5.M6.2
            // routing) for future revisit re-opens via interact (P2.5.M7.2).
            const keycardSiteId = this.contract.context.locationSiteId;
            this.world.addEntity(
              new KeyCard({
                id: `keycard-${linkedDoorId}`,
                x: keycardAnchor.x,
                y: keycardAnchor.y,
                doorId: linkedDoorId,
                label: 'Access keycard',
                ...(keycardSiteId ? { siteId: keycardSiteId } : {}),
              })
            );
          }
        }
      }
    }
    if (this.contract.objective.kind === OBJECTIVES.TERMINAL_SLICE) {
      const anchor = linkedDoorId
        ? findAccessibleInteractableAnchor(
            this.world,
            this.player,
            this.exitTile,
            this.rng,
            linkedDoorId
          )
        : findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
      this.world.addEntity(
        new Terminal({
          id: 'terminal-0',
          x: anchor.x,
          y: anchor.y,
          label: this.contract.objective.title,
          raisesAlarm: true,
          unlocksId: linkedDoorId,
        })
      );
    }
    if (this.contract.objective.kind === OBJECTIVES.DATA_NODE_SLICE) {
      // P3.M3.2: the Meatspace door into Cyberspace. One port per contract;
      // the data nodes themselves live on the cyber grid (P3.M3.3+).
      const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
      this.world.addEntity(
        new JackInPoint({
          id: 'jack-in-0',
          x: anchor.x,
          y: anchor.y,
        })
      );
    }
    if (this.contract.objective.kind === OBJECTIVES.RETRIEVE) {
      const count = objectiveCount(this.contract);
      for (let i = 0; i < count; i++) {
        const anchor = linkedDoorId
          ? findBehindDoorAnchor(this.world, this.player, this.exitTile, linkedDoorId, this.rng)
          : findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
        this.world.addEntity(
          new Pickup({
            id: `pickup-${i}`,
            x: anchor.x,
            y: anchor.y,
            label: pickupLabel(this.contract, i, count),
          })
        );
        if (i === 0 && this.contract.objective.params?.hazardFlavor) {
          placeHazardCluster(this.world, anchor, this.rng);
        }
      }
    }
    if (this.contract.objective.kind === OBJECTIVES.HANDOFF) {
      const count = objectiveCount(this.contract);
      for (let i = 0; i < count; i++) {
        const anchor = linkedDoorId
          ? findBehindDoorAnchor(this.world, this.player, this.exitTile, linkedDoorId, this.rng)
          : findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
        this.world.addEntity(
          new Contact({
            id: `contact-${i}`,
            x: anchor.x,
            y: anchor.y,
            label: contactLabel(this.contract, i, count),
          })
        );
      }
    }
    if (this.contract.objective.kind === OBJECTIVES.DENY) {
      const count = objectiveCount(this.contract);
      const requiresBreach = this.contract.objective.params?.requiresBreach === true;
      for (let i = 0; i < count; i++) {
        const anchor = linkedDoorId
          ? findBehindDoorAnchor(this.world, this.player, this.exitTile, linkedDoorId, this.rng)
          : findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
        const denyTarget = new DenyTarget({
          id: `deny-target-${i}`,
          x: anchor.x,
          y: anchor.y,
          label: objectiveTargetLabel(this.contract, i, count),
          requiresBreach,
        });
        this.#stampAllegiance(denyTarget);
        this.world.addEntity(denyTarget);
      }
    }
    if (this.contract.objective.kind === OBJECTIVES.DUAL_SITE) {
      const count = dualSiteObjectiveCount(this.contract);
      for (let i = 0; i < count; i++) {
        const anchor = linkedDoorId
          ? findBehindDoorAnchor(this.world, this.player, this.exitTile, linkedDoorId, this.rng)
          : findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
        this.world.addEntity(
          new SyncPad({
            id: `sync-pad-${i}`,
            x: anchor.x,
            y: anchor.y,
            label: objectiveTargetLabel(this.contract, i, count),
          })
        );
        if (i === 0 && this.contract.objective.params?.hazardFlavor) {
          placeHazardCluster(this.world, anchor, this.rng);
        }
      }
    }
    // Place sweep targets (relay nodes or corp turrets) for sweep contracts.
    if (this.contract.objective.kind === OBJECTIVES.SWEEP) {
      this.#placeSweepTargets();
    }
    if (this.contract.objective.kind === OBJECTIVES.ESCORT_EXTRACT) {
      const anchor = linkedDoorId
        ? findBehindDoorAnchor(this.world, this.player, this.exitTile, linkedDoorId, this.rng)
        : findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
      this.world.addEntity(
        new EscortNpc({
          id: 'escort-npc-0',
          x: anchor.x,
          y: anchor.y,
          label: escortNpcLabel(this.contract),
        })
      );
    }
    // Place hazard cluster near a future pickup anchor when hazardFlavor is set
    // (e.g. "Gassed clinic data dump"). The cluster is placed around a
    // candidate anchor point biased away from spawn/exit.
    if (
      this.contract.objective.kind !== OBJECTIVES.RETRIEVE &&
      this.contract.objective.kind !== OBJECTIVES.DUAL_SITE &&
      this.contract.objective.kind !== OBJECTIVES.ESCORT_EXTRACT &&
      this.contract.objective.params?.hazardFlavor
    ) {
      const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
      placeHazardCluster(this.world, anchor, this.rng);
    }
  }

  /**
   * Place sweep-objective entities based on the sweep quota type:
   *   - relay-node: 3 RelayNode entities spread across the map.
   *   - turret: 2 CorpTurret entities at defensible positions.
   *   - hostile-all: 1 CorpTurret for ambient pressure (hostiles are already placed).
   */
  #placeSweepTargets(): void {
    if (!this.world || !this.player || !this.contract || !this.exitTile) return;
    const quota = sweepQuotaType(this.contract);
    switch (quota) {
      case SWEEP_QUOTA.RELAY_NODE: {
        const count = 3;
        for (let i = 0; i < count; i++) {
          const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
          const relay = new RelayNode({
            id: `relay-node-${i}`,
            x: anchor.x,
            y: anchor.y,
            label: (this.contract.objective.params?.target as string) ?? 'Relay node',
          });
          this.#stampAllegiance(relay);
          this.world.addEntity(relay);
        }
        // Add one corp turret for pressure alongside relay nodes.
        this.#placeCorpTurret(0);
        break;
      }
      case SWEEP_QUOTA.TURRET: {
        const count = 2;
        for (let i = 0; i < count; i++) {
          this.#placeCorpTurret(i);
        }
        break;
      }
      case SWEEP_QUOTA.HOSTILE_ALL:
      case SWEEP_QUOTA.DRONE_ALL:
      default: {
        // Hostiles are already placed by enterCombat; add one corp turret
        // for ambient pressure.
        this.#placeCorpTurret(0);
        break;
      }
    }
  }

  #placeDynamicDoorEntities(
    dynamicDoors: Array<{ door: GridPoint; terminal: GridPoint }>,
    doorIndexOffset: number
  ): void {
    if (!this.world || !this.player || !this.exitTile) return;
    const spawn = { x: this.player.x, y: this.player.y };
    let placed = 0;
    for (let i = 0; i < dynamicDoors.length; i++) {
      const a = dynamicDoors[i]!;
      if (this.world.liveEntityAt(a.door.x, a.door.y)) continue;
      if (this.world.liveEntityAt(a.terminal.x, a.terminal.y)) continue;
      // Re-validate the terminal anchor in the actual populated world.
      // The anchor was originally chosen in buildMap's sparser world; entities
      // added since then (drones, civilians, objectives) may have closed off
      // the diagonal bypass routes that made this tile safe.
      if (!isValidBlockingPlacement(this.world, spawn, this.exitTile, a.terminal)) continue;
      const doorIndex = doorIndexOffset + placed;
      const door = new Door({
        id: `door-entity-${doorIndex}`,
        doorId: `door-${doorIndex}`,
        x: a.door.x,
        y: a.door.y,
      });
      const terminal = new Terminal({
        id: `terminal-dynamic-door-${placed}`,
        x: a.terminal.x,
        y: a.terminal.y,
        label: 'Access terminal',
        raisesAlarm: true,
        unlocksId: door.doorId,
      });
      this.world.addEntity(door);
      this.world.addEntity(terminal);
      if (findPath(this.world, this.player, this.exitTile, { allowOccupiedGoal: false }) === null) {
        this.world.removeEntity(terminal.id);
        this.world.removeEntity(door.id);
        continue;
      }
      placed++;
    }
  }

  #placeCorpTurret(index: number): void {
    if (!this.world || !this.player || !this.exitTile) return;
    const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
    const turret = new CorpTurret({
      id: `corp-turret-${index}`,
      x: anchor.x,
      y: anchor.y,
    });
    this.#stampAllegiance(turret);
    this.world.addEntity(turret);
  }

  /**
   * Sprinkle 0–2 walk-onto consumable pickups onto the combat map.
   * Counts and types are drawn from `this.rng`, so the same contract seed
   * always produces the same pickup placement — deterministic by snapshot.
   * Pickups are passable (do not block routing) and are placed on any
   * passable, unoccupied tile that's not the player spawn or exit; we
   * tolerate chokepoint placement since walk-through is the whole point.
   *
   * Distribution: count ∈ {0, 1, 2} weighted 0.25 / 0.5 / 0.25 (so the
   * median run has exactly one); type uniform over the shipped pool
   * (stim / smoke charge / incendiary).
   */
  #placeConsumablePickups(): void {
    if (!this.world || !this.player || !this.exitTile) return;
    const roll = this.rng.next();
    const count = roll < 0.25 ? 0 : roll < 0.75 ? 1 : 2;
    if (count === 0) return;
    const pool = [ITEM_ID.STIM, ITEM_ID.SMOKE_CHARGE, ITEM_ID.INCENDIARY];
    for (let i = 0; i < count; i++) {
      const anchor = findConsumablePickupAnchor(this.world, this.player, this.exitTile, this.rng);
      if (!anchor) break; // No legal tile left — stop trying rather than throw.
      const consumableId = this.rng.pick(pool);
      const label = getItemById(consumableId).label;
      this.world.addEntity(
        new ConsumablePickup({
          id: `consumable-pickup-${i}`,
          x: anchor.x,
          y: anchor.y,
          consumableId,
          label,
        })
      );
    }
  }

  #recordCurrentPlayerVision(): void {
    if (!this.world || !this.player) return;
    const vision = new VisionField();
    vision.recompute(this.world.grid, this.player, undefined, {
      blockers: this.world.blockerKeys(),
    });
    this.recordMapSeen(vision.visible);
  }

  #refreshObjectiveTimerState(): boolean {
    if (!this.contract) return false;
    const timing = this.#objectiveTimingContext();
    const satisfied = isObjectiveSatisfied(this.contract, this.world, timing, {
      mapSeen: this.mapSeen,
      reconSeen: this.mapSeen,
      cyber: this.#cyberNodeProgress(),
    });
    const limit = turnLimitForContract(this.contract);
    if (limit === null || !this.queue) return satisfied;

    if (this.objectiveTimer.completedWithinLimit) return true;
    if (this.objectiveTimer.expired) return false;

    const turnNumber = this.queue.turnNumber;
    if (satisfied) {
      this.objectiveTimer.completedWithinLimit = true;
      this.objectiveTimer.completedTurn = turnNumber;
      return true;
    }

    if (isTurnLimitExpired(this.contract, turnNumber)) {
      this.objectiveTimer.expired = true;
      this.objectiveTimer.expiredTurn = turnNumber;
      if (!this.objectiveTimer.expiryAnnounced) {
        this.objectiveTimer.expiryAnnounced = true;
        this.world?.events?.emit(EVENT.OBJECTIVE_TIMER_EXPIRED, {
          contract: cloneContract(this.contract),
          turnLimit: limit,
          turnNumber,
        });
      }
    }
    return false;
  }

  #objectiveTimingContext(): ObjectiveTiming | undefined {
    if (!this.contract || !this.queue || turnLimitForContract(this.contract) === null) {
      return undefined;
    }
    return {
      turnNumber: this.queue.turnNumber,
      completedWithinLimit: this.objectiveTimer.completedWithinLimit,
      expired: this.objectiveTimer.expired,
    };
  }

  #isTimedObjectiveExpired(): boolean {
    return (
      !!this.contract && turnLimitForContract(this.contract) !== null && this.objectiveTimer.expired
    );
  }
}

export type ObjectiveTiming = {
  turnNumber?: number;
  completedWithinLimit?: boolean;
  expired?: boolean;
};

export type ObjectiveState = {
  mapSeen?: ReadonlySet<string> | readonly string[];
  reconSeen?: ReadonlySet<string> | readonly string[];
  /** P3.M3.4: data-node tally for `data-node-slice` contracts. */
  cyber?: CyberNodeProgress;
};

export function isObjectiveSatisfied(
  contract: Contract,
  world?: World | null,
  timing?: ObjectiveTiming,
  objectiveState?: ObjectiveState
): boolean {
  if (timing?.completedWithinLimit) return true;
  if (timing?.expired) return false;
  const limit = turnLimitForContract(contract);
  if (
    limit !== null &&
    timing?.turnNumber !== undefined &&
    isTurnLimitExpired(contract, timing.turnNumber)
  ) {
    return false;
  }
  return isObjectiveFamilySatisfied(contract, world, objectiveState);
}

function isObjectiveFamilySatisfied(
  contract: Contract,
  world?: World | null,
  objectiveState?: ObjectiveState
): boolean {
  const kind = contract.objective.kind;
  switch (kind) {
    case OBJECTIVES.REACH_EXIT:
      return true;
    case OBJECTIVES.RETRIEVE:
      return isRetrieveSatisfied(contract, world);
    case OBJECTIVES.HANDOFF:
      return isHandoffSatisfied(contract, world);
    case OBJECTIVES.TERMINAL_SLICE:
      return isTerminalSliceSatisfied(contract, world);
    case OBJECTIVES.DENY:
      return isDenySatisfied(contract, world);
    case OBJECTIVES.DUAL_SITE:
      return isDualSiteSatisfied(contract, world);
    case OBJECTIVES.SWEEP:
      return isSweepSatisfied(contract, world);
    case OBJECTIVES.RECON:
      return isReconSatisfied(world, objectiveState);
    case OBJECTIVES.ESCORT_EXTRACT:
      return isEscortExtractSatisfied(world);
    case OBJECTIVES.DATA_NODE_SLICE: {
      // P3.M3.4: `Run` threads the per-phase node tally through
      // `ObjectiveState.cyber` (live count / resolved latch / dormant zero).
      // Without it — e.g. a bare `isObjectiveSatisfied` call — the objective
      // is honestly unsatisfiable and extraction stays gated.
      const cyber = objectiveState?.cyber;
      return !!cyber && cyber.required > 0 && cyber.sliced >= cyber.required;
    }
    default: {
      const exhaustive: never = kind;
      throw new Error(`Run.isObjectiveSatisfied: unknown objective kind "${exhaustive}"`);
    }
  }
}

function contractRequiresDoor(contract: Contract): boolean {
  return !!objectiveDoorId(contract) || contract.objective.params?.requiresUnlock === true;
}

function objectiveDoorId(contract: Contract): string | null {
  const doorId = contract.objective.params?.doorId;
  if (doorId === undefined || doorId === null) {
    return contract.objective.params?.requiresUnlock === true ? 'door-0' : null;
  }
  if (typeof doorId !== 'string' || doorId.length === 0) {
    throw new TypeError('Run: objective params.doorId must be a non-empty string when set');
  }
  return doorId;
}

export type UnlockMethod = 'terminal' | 'keycard';

/**
 * Determine unlock method for a door-locked contract (P2.5.M6.2). If the
 * contract params specify `unlockMethod`, use it; otherwise 50/50 from the
 * seed rng. Deterministic per seed.
 */
function resolveUnlockMethod(contract: Contract, rng: Rng): UnlockMethod {
  const explicit = contract.objective.params?.unlockMethod;
  if (explicit === 'terminal' || explicit === 'keycard') return explicit;
  return rng.next() < 0.5 ? 'terminal' : 'keycard';
}

export function turnLimitForContract(contract: Contract): number | null {
  const turnLimit = contract.objective.params?.turnLimit;
  return Number.isInteger(turnLimit) && Number(turnLimit) > 0 ? Number(turnLimit) : null;
}

export function objectiveTurnsRemaining(contract: Contract, turnNumber: number): number | null {
  if (!Number.isInteger(turnNumber) || turnNumber < 1) {
    throw new RangeError(`objectiveTurnsRemaining: turnNumber must be >= 1, got ${turnNumber}`);
  }
  const limit = turnLimitForContract(contract);
  if (limit === null) return null;
  return Math.max(0, limit - (turnNumber - 1));
}

function isTurnLimitExpired(contract: Contract, turnNumber: number): boolean {
  const remaining = objectiveTurnsRemaining(contract, turnNumber);
  return remaining !== null && remaining <= 0;
}

function parseCoordKey(key: string, context: string): GridPoint {
  if (typeof key !== 'string') {
    throw new TypeError(`${context}: coordinate key must be a string`);
  }
  const match = /^(-?\d+),(-?\d+)$/.exec(key);
  if (!match) {
    throw new TypeError(`${context}: malformed coordinate key "${key}"`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

function compareCoordKeys(a: string, b: string): number {
  const pa = parseCoordKey(a, 'compareCoordKeys');
  const pb = parseCoordKey(b, 'compareCoordKeys');
  return pa.y === pb.y ? pa.x - pb.x : pa.y - pb.y;
}

function playerInWorld(world: World): Entity | null {
  for (const entity of world.entities.values()) {
    if (entity instanceof EscortNpc) continue;
    if (entity.faction === FACTION.PLAYER && entity.alive) return entity;
  }
  return null;
}

function exitTileInWorld(world: World): GridPoint | null {
  for (let y = 0; y < world.grid.height; y++) {
    for (let x = 0; x < world.grid.width; x++) {
      if (world.grid.tileAt(x, y) === TILE.EXIT) return { x, y };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Module-private serialisation helpers — kept outside the class so the
// persistence module can stay symmetric (restore lives there, snapshot here).
// ---------------------------------------------------------------------------

/** Shared patrol state-machine slice (Skirmisher, Guard, Bruiser, …). */
function patrolSnapshotExtra(e: PatrolHostile): PatrolSnapshot {
  const snap: PatrolSnapshot = {
    state: e.state,
    lastKnownTarget: e.lastKnownTarget ? { x: e.lastKnownTarget.x, y: e.lastKnownTarget.y } : null,
    patrolWaypoints: e.patrolWaypoints.map(wp => ({ x: wp.x, y: wp.y })),
    patrolIndex: e.patrolIndex,
  };
  // Only serialise override fields while the hijack is live — keeps the common
  // (never-overridden) snapshot identical to its pre-P3 shape.
  if (e.isOverridden) {
    snap.overrideTurnsRemaining = e.overrideTurnsRemaining;
    snap.factionBeforeOverride = e.factionBeforeOverride;
  }
  return snap;
}

/** Shared crew slice (Merc, Razor, Tech). Inventory/Gear are JSON-safe at runtime. */
function crewSnapshotExtra(e: Crew): CrewSnapshot {
  return {
    callsign: e.callsign,
    flatlined: !!e.flatlined,
    inventory: e.inventory,
    gear: e.gear,
  };
}

/**
 * P2.7.M6.2: per-archetype `extra` producers. The symmetric counterpart of
 * persistence's `ENTITY_RESTORE` registry — both keyed by archetype id, no
 * `instanceof` cascade. Archetypes absent here (corp-civilian, neutral-civilian,
 * breaching-charge, entity) carry no `extra`.
 *
 * Crew/Tech cast across the `EntitySnapshotExtra` boundary because `Inventory`/
 * `Gear` aren't statically provable as `JsonValue` (they are JSON-safe at run
 * time); every other slice is a clean primitive bag the compiler verifies.
 */
const SNAPSHOT_EXTRACTORS: Partial<Record<EntityArchetypeId, (e: Entity) => EntitySnapshotExtra>> =
  {
    merc: e => crewSnapshotExtra(e as Crew) as unknown as EntitySnapshotExtra,
    razor: e => crewSnapshotExtra(e as Crew) as unknown as EntitySnapshotExtra,
    decker: e => {
      const d = e as Decker;
      return {
        ...crewSnapshotExtra(d),
        // P3.M3.3: named cyber stats ride the run-entity path too, so a
        // mid-job save can't lose a stat upgrade.
        ram: d.ram,
        intrusionStrength: d.intrusionStrength,
        iceResistance: d.iceResistance,
      } satisfies DeckerSnapshot as unknown as EntitySnapshotExtra;
    },
    tech: e =>
      ({
        ...crewSnapshotExtra(e as Crew),
        turretReady: !!(e as Tech).turretReady,
      }) satisfies TechSnapshot as unknown as EntitySnapshotExtra,
    drone: e => patrolSnapshotExtra(e as PatrolHostile),
    guard: e => patrolSnapshotExtra(e as PatrolHostile),
    bruiser: e => patrolSnapshotExtra(e as PatrolHostile),
    juggernaut: e => patrolSnapshotExtra(e as PatrolHostile),
    lookout: e => patrolSnapshotExtra(e as PatrolHostile),
    medic: e => patrolSnapshotExtra(e as PatrolHostile),
    sniper: e =>
      ({
        ...patrolSnapshotExtra(e as PatrolHostile),
        aimTargetId: (e as Sniper).aimTargetId,
      }) satisfies SniperSnapshot,
    flanker: e =>
      ({
        ...patrolSnapshotExtra(e as PatrolHostile),
        slideConcealed: (e as Flanker).slideConcealed,
      }) satisfies FlankerSnapshot,
    turret: e => {
      const t = e as Turret;
      return {
        range: t.range,
        attackDamage: t.attackDamage,
        ownerId: t.ownerId,
      } satisfies TurretSnapshot;
    },
    'corp-turret': e => {
      const t = e as CorpTurret;
      return { range: t.range, attackDamage: t.attackDamage } satisfies CorpTurretSnapshot;
    },
    terminal: e => {
      const t = e as Terminal;
      return {
        label: t.label,
        sliced: t.sliced,
        armed: t.armed,
        raisesAlarm: t.raisesAlarm,
        unlocksId: t.unlocksId,
      } satisfies TerminalSnapshot;
    },
    door: e => {
      const d = e as Door;
      return { doorId: d.doorId, locked: d.locked } satisfies DoorSnapshot;
    },
    pickup: e => {
      const p = e as Pickup;
      return { label: p.label, secured: p.secured, armed: p.armed } satisfies PickupSnapshot;
    },
    contact: e => {
      const c = e as Contact;
      return {
        label: c.label,
        handoffComplete: c.handoffComplete,
        armed: c.armed,
      } satisfies ContactSnapshot;
    },
    'deny-target': e => {
      const d = e as DenyTarget;
      return { label: d.label, requiresBreach: d.requiresBreach } satisfies DenyTargetSnapshot;
    },
    'sync-pad': e => {
      const s = e as SyncPad;
      return { label: s.label, synced: s.synced, armed: s.armed } satisfies SyncPadSnapshot;
    },
    'relay-node': e => {
      const r = e as RelayNode;
      return { label: r.label } satisfies RelayNodeSnapshot;
    },
    'consumable-pickup': e => {
      const c = e as ConsumablePickup;
      return {
        consumableId: c.consumableId,
        label: c.label,
      } satisfies ConsumablePickupSnapshot;
    },
    'escort-npc': e => {
      const n = e as EscortNpc;
      return { label: n.label, activated: n.activated, armed: n.armed } satisfies EscortNpcSnapshot;
    },
    keycard: e => {
      const k = e as KeyCard;
      return {
        doorId: k.doorId,
        label: k.label,
        siteId: k.siteId ?? null,
      } satisfies KeyCardSnapshot;
    },
    'jack-in-point': e => {
      const p = e as JackInPoint;
      return { label: p.label, linked: p.linked, burned: p.burned } satisfies JackInPointSnapshot;
    },
    'cyber-avatar': e => {
      const a = e as CyberAvatar;
      return {
        intrusionStrength: a.intrusionStrength,
        callsign: a.callsign,
      } satisfies CyberAvatarSnapshot;
    },
    'entry-port': e => {
      return { label: (e as EntryPort).label } satisfies EntryPortSnapshot;
    },
    'data-node': e => {
      const n = e as DataNode;
      return {
        label: n.label,
        sliceDifficulty: n.sliceDifficulty,
        sliceProgress: n.sliceProgress,
      } satisfies DataNodeSnapshot;
    },
    'probe-ice': e => patrolSnapshotExtra(e as PatrolHostile),
    'spark-ice': e => patrolSnapshotExtra(e as PatrolHostile),
    'guardian-ice': e => patrolSnapshotExtra(e as PatrolHostile),
  };

/**
 * P3.M3: serialize the Cyberspace state machine. Dormant carries no payload;
 * active serializes the live layer (grid + entities + alarm + fog memory)
 * with the same entity codec as the meat world; resolved keeps only its
 * objective latch.
 */
function snapshotCyberspace(state: CyberspaceState): RunCyberspaceSnapshot {
  if (state.phase === 'dormant') return { phase: 'dormant' };
  if (state.phase === 'active') {
    const layer = state.layer;
    return {
      phase: 'active',
      grid: {
        w: layer.world.grid.width,
        h: layer.world.grid.height,
        tiles: Array.from(layer.world.grid.tiles),
      },
      entities: Array.from(layer.world.entities.values()).map(snapshotEntity),
      entryTile: { ...layer.entryTile },
      alarm: layer.world.snapshotAlarm(),
      mapMemory: { seen: layer.mapSeenKeys() },
    };
  }
  if (state.phase === 'resolved') {
    return { phase: 'resolved', objectiveComplete: state.objectiveComplete };
  }
  throw new Error(`Run.snapshot: unknown cyberspace phase "${(state as { phase: string }).phase}"`);
}

function snapshotEntity(entity: Entity): RunEntitySnapshot {
  const archetype = archetypeOf(entity);
  const base: RunEntitySnapshot = {
    archetype,
    id: entity.id,
    x: entity.x,
    y: entity.y,
    faction: entity.faction,
    glyph: entity.glyph,
    hp: entity.hp,
    maxHp: entity.maxHp,
    damageReduction: entity.damageReduction,
    shieldHp: entity.shieldHp,
    ap: entity.ap,
    maxAp: entity.maxAp,
    alive: entity.alive,
    stealthed: !!entity.stealthed,
  };
  // Only serialize identity when present, so un-aliased entities (player, props)
  // keep a byte-stable snapshot and pre-2.9 saves stay unaffected.
  if (entity.displayName !== undefined) base.displayName = entity.displayName;
  if (entity.principalTag !== undefined) base.principalTag = entity.principalTag;
  const extract = SNAPSHOT_EXTRACTORS[archetype];
  if (extract) base.extra = extract(entity);
  return base;
}

function archetypeOf(entity: Entity): EntityArchetypeId {
  if (entity instanceof Merc) return 'merc';
  if (entity instanceof Razor) return 'razor';
  if (entity instanceof Tech) return 'tech';
  if (entity instanceof Decker) return 'decker';
  if (entity instanceof Turret) return 'turret';
  if (entity instanceof Bruiser) return 'bruiser';
  if (entity instanceof Juggernaut) return 'juggernaut';
  if (entity instanceof Flanker) return 'flanker';
  if (entity instanceof Sniper) return 'sniper';
  if (entity instanceof Medic) return 'medic';
  if (entity instanceof Lookout) return 'lookout';
  if (entity instanceof Guard) return 'guard';
  if (entity instanceof Skirmisher) return 'drone';
  if (entity instanceof CorpCivilian) return 'corp-civilian';
  if (entity instanceof NeutralCivilian) return 'neutral-civilian';
  if (entity instanceof Door) return 'door';
  if (entity instanceof Terminal) return 'terminal';
  if (entity instanceof Pickup) return 'pickup';
  if (entity instanceof Contact) return 'contact';
  if (entity instanceof DenyTarget) return 'deny-target';
  if (entity instanceof SyncPad) return 'sync-pad';
  if (entity instanceof CorpTurret) return 'corp-turret';
  if (entity instanceof RelayNode) return 'relay-node';
  if (entity instanceof ConsumablePickup) return 'consumable-pickup';
  if (entity instanceof EscortNpc) return 'escort-npc';
  if (entity instanceof KeyCard) return 'keycard';
  if (entity instanceof JackInPoint) return 'jack-in-point';
  if (entity instanceof CyberAvatar) return 'cyber-avatar';
  if (entity instanceof EntryPort) return 'entry-port';
  if (entity instanceof DataNode) return 'data-node';
  if (entity instanceof ProbeIce) return 'probe-ice';
  if (entity instanceof SparkIce) return 'spark-ice';
  if (entity instanceof GuardianIce) return 'guardian-ice';
  if (entity instanceof BreachingCharge) return 'breaching-charge';
  if (entity instanceof Entity) return 'entity';
  throw new Error(`archetypeOf: cannot classify entity ${(entity as Entity | undefined)?.id}`);
}

function isTerminalSliceSatisfied(contract: Contract, world?: World | null): boolean {
  if (!world) return false;
  const required = objectiveCount(contract);
  let sliced = 0;
  for (const entity of world.entities.values()) {
    if (entity instanceof Terminal && entity.sliced && /^terminal-\d+$/.test(entity.id)) sliced++;
  }
  return sliced >= required;
}

function isRetrieveSatisfied(contract: Contract, world?: World | null): boolean {
  if (!world) return false;
  const required = objectiveCount(contract);
  const secured = new Set(world.securedPickupIds());
  for (const entity of world.entities.values()) {
    if (entity instanceof Pickup && entity.secured) secured.add(entity.id);
  }
  return secured.size >= required;
}

function isHandoffSatisfied(contract: Contract, world?: World | null): boolean {
  if (!world) return false;
  const required = objectiveCount(contract);
  let completed = 0;
  for (const entity of world.entities.values()) {
    if (entity instanceof Contact && entity.handoffComplete) completed++;
  }
  return completed >= required;
}

function isDenySatisfied(contract: Contract, world?: World | null): boolean {
  if (!world) return false;
  const required = objectiveCount(contract);
  let destroyed = 0;
  for (const entity of world.entities.values()) {
    if (entity instanceof DenyTarget && !entity.alive) destroyed++;
  }
  return destroyed >= required;
}

function isDualSiteSatisfied(contract: Contract, world?: World | null): boolean {
  if (!world) return false;
  const required = dualSiteObjectiveCount(contract);
  let synced = 0;
  for (const entity of world.entities.values()) {
    if (entity instanceof SyncPad && entity.synced) synced++;
  }
  return synced >= required;
}

function isReconSatisfied(world?: World | null, objectiveState: ObjectiveState = {}): boolean {
  if (!world) return false;
  const seen = objectiveState.reconSeen ?? objectiveState.mapSeen ?? [];
  const progress = reconObjectiveProgress(world, seen);
  return progress.required > 0 && progress.mapped >= progress.required;
}

function isEscortExtractSatisfied(world?: World | null): boolean {
  if (!world) return false;
  const exit = exitTileInWorld(world);
  if (!exit) return false;
  const player = playerInWorld(world);
  if (!player || chebyshev(player, exit) > 1) return false;
  for (const entity of world.entities.values()) {
    if (!(entity instanceof EscortNpc)) continue;
    if (!entity.alive || !entity.activated) return false;
    return chebyshev(entity, exit) <= 1;
  }
  return false;
}

function objectiveCount(contract: Contract): number {
  const countParam = contract.objective.params?.count;
  return Number.isInteger(countParam) && Number(countParam) > 0 ? Number(countParam) : 1;
}

function dualSiteObjectiveCount(contract: Contract): number {
  const countParam = contract.objective.params?.count;
  return Number.isInteger(countParam) && Number(countParam) > 0 ? Number(countParam) : 2;
}

function pickupLabel(contract: Contract, index: number, count: number): string {
  return objectiveTargetLabel(contract, index, count);
}

function contactLabel(contract: Contract, index: number, count: number): string {
  const contact = contract.objective.params?.contact;
  const target = contract.objective.params?.target;
  const source = typeof contact === 'string' && contact.length > 0 ? contact : target;
  const base =
    typeof source === 'string' && source.length > 0
      ? targetLabel(source)
      : contract.objective.title;
  return count > 1 ? `${base} ${index + 1}` : base;
}

function escortNpcLabel(contract: Contract): string {
  const contact = contract.objective.params?.contact;
  const target = contract.objective.params?.target;
  const source = typeof contact === 'string' && contact.length > 0 ? contact : target;
  return typeof source === 'string' && source.length > 0
    ? targetLabel(source)
    : contract.objective.title;
}

function objectiveTargetLabel(contract: Contract, index: number, count: number): string {
  const target = contract.objective.params?.target;
  const base =
    typeof target === 'string' && target.length > 0
      ? targetLabel(target)
      : contract.objective.title;
  return count > 1 ? `${base} ${index + 1}` : base;
}

function targetLabel(target: string): string {
  return target
    .split('-')
    .filter(part => part.length > 0)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
}

function isSweepSatisfied(contract: Contract, world?: World | null): boolean {
  if (!world) return false;
  const quota = sweepQuotaType(contract);
  switch (quota) {
    case SWEEP_QUOTA.HOSTILE_ALL:
    case SWEEP_QUOTA.DRONE_ALL: {
      for (const entity of world.entities.values()) {
        if (entity instanceof Hostile && entity.alive) {
          return false;
        }
      }
      return true;
    }
    case SWEEP_QUOTA.RELAY_NODE: {
      const countParam = contract.objective.params?.count;
      if (Number.isInteger(countParam) && Number(countParam) > 0) {
        // Explicit count: need at least N relay nodes destroyed.
        let destroyed = 0;
        for (const entity of world.entities.values()) {
          if (entity instanceof RelayNode && !entity.alive) destroyed++;
        }
        return destroyed >= Number(countParam);
      }
      // No count: all relay nodes on the map must be dead.
      for (const entity of world.entities.values()) {
        if (entity instanceof RelayNode && entity.alive) return false;
      }
      return true;
    }
    case SWEEP_QUOTA.TURRET: {
      const countParam = contract.objective.params?.count;
      if (Number.isInteger(countParam) && Number(countParam) > 0) {
        let destroyed = 0;
        for (const entity of world.entities.values()) {
          if (entity instanceof CorpTurret && !entity.alive) destroyed++;
        }
        return destroyed >= Number(countParam);
      }
      for (const entity of world.entities.values()) {
        if (entity instanceof CorpTurret && entity.alive) return false;
      }
      return true;
    }
    default:
      return true;
  }
}

function findInteractableAnchor(
  world: World,
  player: Entity,
  exitTile: GridPoint,
  rng: Rng
): GridPoint {
  const spawn = { x: player.x, y: player.y };
  const candidates: GridPoint[] = [];
  for (let y = 1; y < world.grid.height - 1; y++) {
    for (let x = 1; x < world.grid.width - 1; x++) {
      if (!isValidBlockingPlacement(world, spawn, exitTile, { x, y })) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) {
    throw new Error('Run: objective contract has no legal interactable anchor');
  }
  const remote = candidates.filter(
    candidate =>
      chebyshev(candidate, exitTile) > 1 &&
      manhattan(candidate, exitTile) >= 6 &&
      manhattan(candidate, player) >= 4
  );
  if (remote.length > 0) return rng.pick(remote);

  const notExitAdjacent = candidates.filter(candidate => chebyshev(candidate, exitTile) > 1);
  if (notExitAdjacent.length > 0) return rng.pick(notExitAdjacent);

  return rng.pick(candidates);
}

function findAccessibleInteractableAnchor(
  world: World,
  player: Entity,
  exitTile: GridPoint,
  rng: Rng,
  doorId: string
): GridPoint {
  return findInteractableAnchorByReachability(world, player, exitTile, rng, 'accessible', doorId);
}

/**
 * Decoupled terminal/keycard placement (P2.5.M6.2) — find a reachable tile on
 * the spawn side of the locked door, WITHOUT biasing toward door proximity. The
 * entity (terminal or keycard) can land anywhere reachable from spawn, turning
 * "find the unlock" into a routing puzzle.
 *
 * Reachability is validated by pathfinding from player spawn to the candidate
 * with the door still locked (impassable). Candidates must not sit on exploration
 * chokepoints on the spawn side. Falls back to near-door placement (P2.5.M6.1
 * behavior) if no remote tile qualifies.
 */
function findDecoupledTerminalAnchor(
  world: World,
  player: Entity,
  exitTile: GridPoint,
  rng: Rng,
  doorId: string
): GridPoint {
  assertDoorExists(world, doorId);
  const spawn = { x: player.x, y: player.y };
  const candidates: GridPoint[] = [];
  for (let y = 1; y < world.grid.height - 1; y++) {
    for (let x = 1; x < world.grid.width - 1; x++) {
      // Door stays locked during this check — isValidBlockingPlacement sees
      // the spawn-side chokepoint graph with the door still impassable.
      if (!isValidBlockingPlacement(world, spawn, exitTile, { x, y })) continue;
      // Must be reachable NOW (door still locked).
      const reachableNow = findPath(world, spawn, { x, y }, { allowOccupiedGoal: false }) !== null;
      if (!reachableNow) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) {
    // Fall back to P2.5.M6.1 near-door behavior.
    return findAccessibleInteractableAnchor(world, player, exitTile, rng, doorId);
  }
  // Prefer remote tiles — the routing puzzle is more interesting when the
  // player has to explore the spawn side.
  const door = assertDoorExists(world, doorId);
  const remote = candidates.filter(
    c => chebyshev(c, door) > 2 && manhattan(c, exitTile) >= 4 && manhattan(c, player) >= 3
  );
  if (remote.length > 0) return rng.pick(remote);
  return rng.pick(candidates);
}

function findBehindDoorAnchor(
  world: World,
  player: Entity,
  exitTile: GridPoint,
  doorId: string,
  rng: Rng
): GridPoint {
  assertDoorExists(world, doorId);
  return findInteractableAnchorByReachability(world, player, exitTile, rng, 'behind-door', doorId);
}

function findInteractableAnchorByReachability(
  world: World,
  player: Entity,
  exitTile: GridPoint,
  rng: Rng,
  mode: 'accessible' | 'behind-door',
  doorId?: string
): GridPoint {
  const door = doorId ? assertDoorExists(world, doorId) : null;
  const spawn = { x: player.x, y: player.y };
  const candidates: GridPoint[] = [];
  const nearDoorCandidates: GridPoint[] = [];
  for (let y = 1; y < world.grid.height - 1; y++) {
    for (let x = 1; x < world.grid.width - 1; x++) {
      const anchor = { x, y };
      const reachableNow = findPath(world, spawn, anchor, { allowOccupiedGoal: false }) !== null;
      if (mode === 'accessible') {
        if (!doorId) throw new Error('Run: accessible door anchor search missing doorId');
        // Door stays locked — validate against spawn-side graph.
        if (!isValidBlockingPlacement(world, spawn, exitTile, anchor)) continue;
        if (!reachableNow) continue;
        candidates.push(anchor);
        if (door && chebyshev(anchor, door) <= 2) nearDoorCandidates.push(anchor);
        continue;
      }
      if (reachableNow) continue;
      if (!doorId) throw new Error('Run: behind-door anchor search missing doorId');
      // Temporarily unlock door to validate behind-door chokepoint.
      const wasLocked = door!.locked;
      try {
        door!.unlock();
        if (!isValidBlockingPlacement(world, spawn, exitTile, anchor)) continue;
      } finally {
        if (wasLocked) door!.lock();
      }
      if (isReachableWithDoorUnlocked(world, player, anchor, doorId)) candidates.push(anchor);
    }
  }
  if (mode === 'accessible') {
    if (candidates.length === 0) {
      throw new Error('Run: door-linked contract has no accessible terminal anchor');
    }
    return rng.pick(nearDoorCandidates.length > 0 ? nearDoorCandidates : candidates);
  }
  if (candidates.length === 0 && doorId) {
    return findBehindDoorFallbackAnchor(world, player, exitTile, rng, doorId);
  }
  if (candidates.length === 0) {
    throw new Error(`Run: door-linked contract has no legal anchor behind ${doorId}`);
  }
  return rng.pick(candidates);
}

function findBehindDoorFallbackAnchor(
  world: World,
  player: Entity,
  exitTile: GridPoint,
  rng: Rng,
  doorId: string
): GridPoint {
  const door = assertDoorExists(world, doorId);
  const spawn = { x: player.x, y: player.y };
  const spawnSide = explorationReachableKeys(world, spawn);
  const candidates: GridPoint[] = [];
  for (let y = 1; y < world.grid.height - 1; y++) {
    for (let x = 1; x < world.grid.width - 1; x++) {
      const anchor = { x, y };
      if (spawnSide.has(coordKey(x, y))) continue;
      if (!isReachableWithDoorUnlocked(world, player, anchor, doorId)) continue;
      // Temporarily unlock door to validate behind-door chokepoint.
      const wasLocked = door.locked;
      try {
        door.unlock();
        if (!isValidBlockingPlacement(world, spawn, exitTile, anchor)) continue;
      } finally {
        if (wasLocked) door.lock();
      }
      candidates.push(anchor);
    }
  }
  if (candidates.length === 0) {
    throw new Error(`Run: door-linked contract has no legal anchor behind ${doorId}`);
  }
  return rng.pick(candidates);
}

function assertDoorExists(world: World, doorId: string): Door {
  if (typeof doorId !== 'string' || doorId.length === 0) {
    throw new TypeError('Run: doorId must be a non-empty string');
  }
  let found: Door | null = null;
  for (const entity of world.entities.values()) {
    if (!(entity instanceof Door) || entity.doorId !== doorId) continue;
    if (found) {
      throw new Error(`Run: duplicate doorId "${doorId}"`);
    }
    found = entity;
  }
  if (!found) {
    throw new Error(`Run: no door with doorId "${doorId}"`);
  }
  return found;
}

function isReachableWithDoorUnlocked(
  world: World,
  player: Entity,
  target: GridPoint,
  doorId: string
): boolean {
  const door = assertDoorExists(world, doorId);
  const wasLocked = door.locked;
  try {
    door.unlock();
    return (
      findPath(world, { x: player.x, y: player.y }, target, { allowOccupiedGoal: false }) !== null
    );
  } finally {
    if (wasLocked) door.lock();
    else door.unlock();
  }
}

/**
 * Anchor finder for **passable** props (walk-onto consumable pickups). Unlike
 * `findInteractableAnchor`, this does *not* run the exploration-reachability
 * check — a passable entity cannot seal a corridor. Returns `null` when no
 * legal tile is available, leaving the caller to gracefully stop placing
 * rather than crash an otherwise valid run.
 *
 * Excludes the player spawn tile, the exit tile, and tiles already occupied
 * by any entity (live or dead — so we don't overlay a pickup on a corpse
 * the player will later want to salvage).
 */
function findConsumablePickupAnchor(
  world: World,
  player: Entity,
  exitTile: GridPoint,
  rng: Rng
): GridPoint | null {
  const candidates: GridPoint[] = [];
  for (let y = 1; y < world.grid.height - 1; y++) {
    for (let x = 1; x < world.grid.width - 1; x++) {
      if (!world.grid.isPassable(x, y)) continue;
      if (x === player.x && y === player.y) continue;
      if (x === exitTile.x && y === exitTile.y) continue;
      if (world.anyEntityAt(x, y)) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return null;
  return rng.pick(candidates);
}

/**
 * Place a cluster of HAZARD tiles near `center`. Stomps FLOOR tiles only —
 * walls, cover, exit, and tiles occupied by entities are left alone. The
 * cluster is a diamond/cross shape (center + cardinal neighbours) with a
 * random subset of diagonal neighbours, giving an organic 5–9 tile footprint.
 *
 * Exported for testing.
 */
export function placeHazardCluster(world: World, center: GridPoint, rng: Rng): number {
  const candidates: GridPoint[] = [center];
  // Cardinal neighbours (always included when legal)
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    candidates.push({ x: center.x + dx, y: center.y + dy });
  }
  // Diagonal neighbours (randomly included for organic shape)
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    if (rng.next() < 0.5) {
      candidates.push({ x: center.x + dx, y: center.y + dy });
    }
  }
  let placed = 0;
  for (const { x, y } of candidates) {
    if (!world.grid.inBounds(x, y)) continue;
    if (world.grid.tileAt(x, y) !== TILE.FLOOR) continue;
    if (world.entityAt(x, y)) continue;
    world.grid.setTile(x, y, TILE.HAZARD);
    placed++;
  }
  return placed;
}

function manhattan(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function chebyshev(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function archetypeOfCrew(entity: Entity): CrewArchetypeId {
  if (entity instanceof Merc) return 'merc';
  if (entity instanceof Razor) return 'razor';
  if (entity instanceof Tech) return 'tech';
  if (entity instanceof Decker) return 'decker';
  throw new Error(
    `archetypeOfCrew: cannot classify crew member ${(entity as Entity | undefined)?.id}`
  );
}

/**
 * P3.M4.1: validate a dual-deploy meat partner. Returns the partner (or `null`
 * when none supplied). Contract-dependent require/forbid lives in
 * `enterBriefing` — this only enforces the partner's intrinsic shape so a
 * malformed reservation crashes at construction rather than at jack-in.
 */
function normalizePartnerMember(partnerMember: unknown, primary: Crew): Crew | null {
  if (partnerMember === undefined || partnerMember === null) return null;
  if (!(partnerMember instanceof Crew)) {
    throw new TypeError('Run: partnerMember must be a Crew member when supplied');
  }
  if (partnerMember instanceof Decker) {
    throw new Error('Run: the meat partner cannot be a Decker (the Decker jacks in)');
  }
  if (partnerMember.flatlined) {
    throw new Error(`Run: cannot deploy flatlined partner "${partnerMember.id}"`);
  }
  if (partnerMember.id === primary.id) {
    throw new Error('Run: partner must differ from the deployed operator');
  }
  return partnerMember;
}

function freshTelemetry(archetype: CrewArchetypeId, seed: number): RunTelemetry {
  return {
    archetype,
    seed,
    turn: 1,
    kills: 0,
    lastDamageSource: null,
    lastAttacker: null,
    hpAtDeath: null,
    cause: null,
    outcome: null,
  };
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

function normalizeContractForRun(contract: unknown): Contract {
  if (!contract || typeof contract !== 'object') {
    throw new TypeError('contract must be an object');
  }
  const candidate = contract as Partial<Contract>;
  const seed = candidate.seed;
  const threatCount = candidate.threatCount;
  const difficulty = candidate.difficulty;
  if (!Number.isInteger(seed) || seed === undefined || seed < 0) {
    throw new TypeError(`contract.seed must be a non-negative integer, got ${seed}`);
  }
  const objective = normalizeObjective(candidate.objective);
  if (!Number.isInteger(threatCount) || threatCount === undefined || threatCount < 0) {
    throw new TypeError(`contract.threatCount must be a non-negative integer, got ${threatCount}`);
  }
  if (!difficulty || !isContractDifficulty(difficulty)) {
    throw new Error(`contract.difficulty "${difficulty}" is not a known difficulty`);
  }
  if (!candidate.reward || typeof candidate.reward !== 'object') {
    throw new TypeError('contract.reward must be an object');
  }
  if (!Number.isInteger(candidate.reward.credits) || candidate.reward.credits < 0) {
    throw new TypeError('contract.reward.credits must be a non-negative integer');
  }
  if (!Number.isInteger(candidate.reward.repDelta)) {
    throw new TypeError('contract.reward.repDelta must be an integer');
  }
  if (candidate.reward.recruit !== undefined && candidate.reward.recruit !== true) {
    throw new TypeError('contract.reward.recruit must be true when present');
  }
  if (typeof candidate.label !== 'string' || candidate.label.length === 0) {
    throw new TypeError('contract.label must be a non-empty string');
  }
  const context = normalizeContractContext(candidate.context);
  const dimensions = normalizeMapDimensions(candidate.mapWidth, candidate.mapHeight, 'contract');
  return {
    seed,
    mapWidth: dimensions.width,
    mapHeight: dimensions.height,
    objective,
    difficulty,
    threatCount,
    label: candidate.label,
    context,
    reward: {
      credits: candidate.reward.credits,
      repDelta: candidate.reward.repDelta,
      ...(candidate.reward.recruit === true ? { recruit: true as const } : {}),
    },
  };
}

function cloneContract(contract: Contract): Contract {
  return {
    ...contract,
    objective: cloneObjective(contract.objective),
    context: normalizeContractContext(contract.context),
    reward: { ...contract.reward },
  };
}

function makeRunId(seed: number): string {
  // Browser-friendly id without crypto: seed + millisecond. Persistence
  // stores it verbatim inside the surrounding campaign snapshot.
  return `run-${(seed >>> 0).toString(16)}-${Date.now().toString(36)}`;
}
