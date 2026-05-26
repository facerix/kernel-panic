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
import { FACTION, TILE, SALVAGE_DROP_MIN, SALVAGE_DROP_MAX } from './constants.js';
import { Entity, type LootableEntity } from './Entity.js';
import { Hostile } from './Hostile.js';
import { Crew } from './Crew.js';
import { Merc } from './archetypes/Merc.js';
import { Razor } from './archetypes/Razor.js';
import { Tech } from './archetypes/Tech.js';
import { Turret } from './Turret.js';
import { CorpDrone } from './ai/CorpDrone.js';
import { CorpCivilian } from './entities/CorpCivilian.js';
import { Interactable } from './entities/Interactable.js';
import { Terminal } from './entities/Terminal.js';
import { Pickup } from './entities/Pickup.js';
import { Contact } from './entities/Contact.js';
import { DenyTarget } from './entities/DenyTarget.js';
import { SyncPad } from './entities/SyncPad.js';
import { CorpTurret } from './entities/CorpTurret.js';
import { RelayNode } from './entities/RelayNode.js';
import { EscortNpc } from './entities/EscortNpc.js';
import { resetCorpTurnStatusCache } from './corpTurnStatusCopy.js';
import { NeutralCivilian } from './entities/NeutralCivilian.js';
import { VisionField } from './Vision.js';
import {
  OBJECTIVES,
  cloneObjective,
  isContractDifficulty,
  normalizeContractContext,
  normalizeObjective,
} from './hub/Curator.js';
import { buildMap } from './procgen/mapBuild.js';
import type { Contract } from './hub/Curator.js';
import type { FactionId } from './constants.js';
import type { GridPoint } from '../types.js';
import type { Inventory, Gear } from './Crew.js';
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

const COMBAT_MAP_WIDTH = 24;
const COMBAT_MAP_HEIGHT = 16;

export type RunState = (typeof RUN_STATE)[keyof typeof RUN_STATE];
export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];
export type CrewArchetypeId = 'merc' | 'razor' | 'tech';
export type EntityArchetypeId =
  | CrewArchetypeId
  | 'turret'
  | 'drone'
  | 'corp-civilian'
  | 'neutral-civilian'
  | 'terminal'
  | 'pickup'
  | 'contact'
  | 'deny-target'
  | 'sync-pad'
  | 'corp-turret'
  | 'relay-node'
  | 'escort-npc'
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

export type RunEntitySnapshot = {
  archetype: EntityArchetypeId;
  id: string;
  x: number;
  y: number;
  faction: FactionId;
  glyph: string;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  alive: boolean;
  stealthed: boolean;
  drone?: {
    state: string;
    lastKnownTarget: GridPoint | null;
    patrolWaypoints: GridPoint[];
    patrolIndex: number;
  };
  tech?: { turretReady: boolean };
  callsign?: string | null;
  flatlined?: boolean;
  inventory?: Inventory | null;
  gear?: Gear | null;
  turret?: {
    range: number;
    attackDamage: number;
    ownerId: string | null;
  };
  terminal?: {
    label: string;
    sliced: boolean;
    armed: boolean;
    raisesAlarm: boolean;
  };
  pickup?: {
    label: string;
    secured: boolean;
    armed: boolean;
  };
  contact?: {
    label: string;
    handoffComplete: boolean;
    armed: boolean;
  };
  denyTarget?: {
    label: string;
  };
  syncPad?: {
    label: string;
    synced: boolean;
    armed: boolean;
  };
  corpTurret?: {
    range: number;
    attackDamage: number;
  };
  relayNode?: {
    label: string;
  };
  escortNpc?: {
    label: string;
    activated: boolean;
    armed: boolean;
  };
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
  /** M2.1 alarm cadence. Missing in older saves → defaults to quiet. */
  alarm?: AlarmState;
  /** Legacy M5 map-wide alarm latch. Missing in pre-M5 saves → defaults to false. */
  alarmActive?: boolean;
  /** M2.9 turn-limit objective state. Missing in older saves → fresh timer state. */
  objectiveTimer?: ObjectiveTimerSnapshot;
  /** M2.11 map memory. Missing in older saves → current LOS only. */
  mapMemory?: MapMemorySnapshot;
};

export type RunResult = {
  outcome: Outcome;
  telemetry: RunTelemetry;
};

export type RunOptions = {
  id?: string;
  crewMember?: unknown;
  seed?: unknown;
  onPersist?: unknown;
  onResult?: unknown;
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

export class Run {
  id: string;
  crewMember: Crew;
  archetype: CrewArchetypeId;
  seed: number;
  rng: Rng;
  state: RunState | null;
  world: World | null;
  queue: TurnQueue | null;
  bus: EventBus | null;
  player: Crew | null;
  contract: Contract | null;
  exitTile: GridPoint | null;
  telemetry: RunTelemetry;
  objectiveTimer: ObjectiveTimerSnapshot;
  mapSeen: Set<string>;
  onPersist: ((record: RunSnapshot) => void) | null;
  onResult: ((result: RunResult) => void) | null;
  _busUnsubs: (() => void)[];

  constructor({ id, crewMember, seed, onPersist, onResult }: RunOptions = {}) {
    if (typeof seed !== 'number' || !Number.isFinite(seed)) {
      throw new TypeError(`Run requires a finite numeric seed, got ${seed}`);
    }
    if (!(crewMember instanceof Crew)) {
      throw new TypeError('Run requires a deployed Crew member');
    }
    if (crewMember.flatlined) {
      throw new Error(`Run: cannot deploy flatlined crew member "${crewMember.id}"`);
    }
    if (onPersist !== undefined && typeof onPersist !== 'function') {
      throw new TypeError('Run: onPersist must be a function');
    }
    if (onResult !== undefined && typeof onResult !== 'function') {
      throw new TypeError('Run: onResult must be a function');
    }

    this.id = id ?? makeRunId(seed);
    this.crewMember = crewMember;
    this.archetype = archetypeOfCrew(crewMember);
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.state = null;
    this.world = null;
    this.queue = null;
    this.bus = null;
    this.player = null;
    this.contract = null;
    this.exitTile = null;
    this.telemetry = freshTelemetry(this.archetype, this.seed);
    this.objectiveTimer = freshObjectiveTimer();
    this.mapSeen = new Set();
    this.onPersist = (onPersist as ((record: RunSnapshot) => void) | undefined) ?? null;
    this.onResult = (onResult as ((result: RunResult) => void) | undefined) ?? null;

    /** @type {Array<() => void>} active bus subscriptions */
    this._busUnsubs = [];
  }

  /** Permitted from a fresh Run only. Caches the contract for `enterCombat`. */
  enterBriefing(contract: unknown): void {
    if (this.state !== null) {
      throw new Error(`Run.enterBriefing: illegal transition from ${this.state}`);
    }
    this.contract = normalizeContractForRun(contract);
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
      width: COMBAT_MAP_WIDTH,
      height: COMBAT_MAP_HEIGHT,
      threatCount: this.contract.threatCount,
      difficulty: this.contract.difficulty,
    });
    this.world = new World(map.grid, { events: this.bus });
    this.player = this.#makePlayer(map.spawns.player);
    this.world.addEntity(this.player);
    for (let i = 0; i < map.drones.length; i++) {
      const a = map.drones[i]!;
      const drone = new CorpDrone({
        id: `drone-${i}`,
        x: a.x,
        y: a.y,
        maxAp: 3,
        patrolWaypoints: a.waypoints,
      });
      this.world.addEntity(drone);
      drone.bindToBus(this.bus);
    }
    for (let i = 0; i < map.corpCivilians.length; i++) {
      const a = map.corpCivilians[i]!;
      const civ = new CorpCivilian({ id: `corp-civ-${i}`, x: a.x, y: a.y });
      this.world.addEntity(civ);
    }
    for (let i = 0; i < map.neutralCivilians.length; i++) {
      const a = map.neutralCivilians[i]!;
      const civ = new NeutralCivilian({ id: `neutral-civ-${i}`, x: a.x, y: a.y });
      this.world.addEntity(civ);
    }
    this.queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
    this.exitTile = { ...map.exitTile };
    this.#placeObjectiveInteractables();
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
    };
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

  /** Compatibility alias for M2.11 recon tests and call sites. */
  recordReconSeen(keys: Iterable<string>): void {
    this.recordMapSeen(keys);
  }

  reconProgress(): ReconProgress {
    if (!this.world) return { mapped: 0, required: 0 };
    return reconObjectiveProgress(this.world, this.mapSeen);
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
      bus.on(EVENT.TURN_ENDED, () => this.#onTurnEnded()),
      bus.on(EVENT.ENTITY_DAMAGED, payload =>
        this.#onEntityDamaged(payload as EntityDamagedPayload)
      ),
      bus.on(EVENT.ENTITY_MOVED, payload => this.#onEntityMoved(payload as EntityMovedPayload))
    );
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  #makePlayer(spawn: GridPoint): Crew {
    this.crewMember.x = spawn.x;
    this.crewMember.y = spawn.y;
    this.crewMember.maxAp = 4;
    this.crewMember.ap = this.crewMember.maxAp;
    // HP persists across jobs — no reset. Armour Plating (via Finn) is
    // the only Hub-side HP recovery. Stims are combat-only.
    this.crewMember.alive = true;
    this.crewMember.stealthed = false;
    this.crewMember.initInventory();
    if (this.crewMember instanceof Tech) {
      this.crewMember.turretReady = true;
    }
    return this.crewMember;
  }

  #unwireCombatListeners(): void {
    for (const off of this._busUnsubs) off();
    this._busUnsubs = [];
  }

  #onTurnEnded(): void {
    if (this.state !== RUN_STATE.COMBAT) return;
    if (!this.queue) {
      throw new Error('Run.#onTurnEnded: COMBAT state without a TurnQueue');
    }
    this.telemetry.turn = this.queue.turnNumber;
    this.#refreshObjectiveTimerState();
    if (!this.onPersist) return;
    this.onPersist(this.snapshot());
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
    if (attacker === this.player && killed) {
      this.telemetry.kills = (this.telemetry.kills ?? 0) + 1;
    } else if (killed && attacker instanceof Turret && attacker.ownerId === this.player.id) {
      this.telemetry.kills = (this.telemetry.kills ?? 0) + 1;
    }
    // M5: emit civilian:harmed when a NEUTRAL entity takes damage from the
    // player (or the player's turret). The shell subscribes and adjusts Rep.
    if (
      target.faction === FACTION.NEUTRAL &&
      target !== this.player &&
      !(target instanceof Interactable)
    ) {
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
    // Unbind dead drones from the event bus immediately so their NOISE/ALARM
    // handlers stop firing for the rest of the run. (#6 adversarial review)
    if (killed && target instanceof CorpDrone) {
      target.unbind();
    }

    // M3: assign loot to killed hostiles. The loot roll uses the Run's own
    // Rng so it's deterministic on the contract seed.
    const lootTarget = target as Partial<LootableEntity>;
    if (killed && target instanceof Hostile && !lootTarget.loot) {
      lootTarget.loot = {
        salvage: this.rng.intRange(SALVAGE_DROP_MIN, SALVAGE_DROP_MAX + 1),
      };
    }
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
    if (!objectiveComplete && !objectiveExpired) return;
    this.telemetry.cause = objectiveComplete ? 'exit-reached' : 'exit-reached-objective-incomplete';
    this.enterResult({
      outcome: OUTCOME.EXIT,
      telemetry: {
        objectiveComplete,
        objectiveExpired,
      },
    });
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
    if (this.contract.objective.kind === OBJECTIVES.TERMINAL_SLICE) {
      const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
      this.world.addEntity(
        new Terminal({
          id: 'terminal-0',
          x: anchor.x,
          y: anchor.y,
          label: this.contract.objective.title,
          raisesAlarm: true,
        })
      );
    }
    if (this.contract.objective.kind === OBJECTIVES.RETRIEVE) {
      const count = objectiveCount(this.contract);
      for (let i = 0; i < count; i++) {
        const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
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
        const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
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
      for (let i = 0; i < count; i++) {
        const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
        this.world.addEntity(
          new DenyTarget({
            id: `deny-target-${i}`,
            x: anchor.x,
            y: anchor.y,
            label: objectiveTargetLabel(this.contract, i, count),
          })
        );
      }
    }
    if (this.contract.objective.kind === OBJECTIVES.DUAL_SITE) {
      const count = dualSiteObjectiveCount(this.contract);
      for (let i = 0; i < count; i++) {
        const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
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
    // M2.4: Place sweep targets (relay nodes or corp turrets) for sweep contracts.
    if (this.contract.objective.kind === OBJECTIVES.SWEEP) {
      this.#placeSweepTargets();
    }
    if (this.contract.objective.kind === OBJECTIVES.ESCORT_EXTRACT) {
      const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
      this.world.addEntity(
        new EscortNpc({
          id: 'escort-npc-0',
          x: anchor.x,
          y: anchor.y,
          label: escortNpcLabel(this.contract),
        })
      );
    }
    // M2.3: Place hazard cluster near a future pickup anchor when hazardFlavor
    // is set (e.g. "Gassed clinic data dump"). The cluster is placed around a
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
   *   - drone-all: 1 CorpTurret for ambient pressure (drones are already placed).
   */
  #placeSweepTargets(): void {
    if (!this.world || !this.player || !this.contract || !this.exitTile) return;
    const quota = sweepQuotaType(this.contract);
    switch (quota) {
      case SWEEP_QUOTA.RELAY_NODE: {
        const count = 3;
        for (let i = 0; i < count; i++) {
          const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
          this.world.addEntity(
            new RelayNode({
              id: `relay-node-${i}`,
              x: anchor.x,
              y: anchor.y,
              label: (this.contract.objective.params?.target as string) ?? 'Relay node',
            })
          );
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
      case SWEEP_QUOTA.DRONE_ALL:
      default: {
        // Drones are already placed by enterCombat; add one corp turret
        // for ambient pressure.
        this.#placeCorpTurret(0);
        break;
      }
    }
  }

  #placeCorpTurret(index: number): void {
    if (!this.world || !this.player || !this.exitTile) return;
    const anchor = findInteractableAnchor(this.world, this.player, this.exitTile, this.rng);
    this.world.addEntity(
      new CorpTurret({
        id: `corp-turret-${index}`,
        x: anchor.x,
        y: anchor.y,
      })
    );
  }

  #recordCurrentPlayerVision(): void {
    if (!this.world || !this.player) return;
    const vision = new VisionField();
    vision.recompute(this.world.grid, this.player, undefined, {
      blockers: this.world.blockerKeys(),
    });
    this.recordMapSeen(vision.seen);
  }

  #refreshObjectiveTimerState(): boolean {
    if (!this.contract) return false;
    const timing = this.#objectiveTimingContext();
    const satisfied = isObjectiveSatisfied(this.contract, this.world, timing, {
      mapSeen: this.mapSeen,
      reconSeen: this.mapSeen,
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
      // M1 only carries objective intent through contract generation, UI, and
      // saves. M2 replaces these permissive cases with family-specific state.
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
    default: {
      const exhaustive: never = kind;
      throw new Error(`Run.isObjectiveSatisfied: unknown objective kind "${exhaustive}"`);
    }
  }
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

export type ReconProgress = {
  mapped: number;
  required: number;
};

export function reconEligibleCellKeys(world: World | null | undefined): Set<string> {
  if (!world) return new Set();
  const player = playerInWorld(world);
  if (!player) return allPassableCellKeys(world);
  const eligible = new Set<string>();
  const queue: GridPoint[] = [{ x: player.x, y: player.y }];
  eligible.add(coordKey(player.x, player.y));
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i]!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = point.x + dx;
        const y = point.y + dy;
        if (!world.grid.isPassable(x, y)) continue;
        const key = coordKey(x, y);
        if (eligible.has(key)) continue;
        eligible.add(key);
        queue.push({ x, y });
      }
    }
  }
  return eligible;
}

export function reconObjectiveProgress(
  world: World | null | undefined,
  seen: ReadonlySet<string> | readonly string[] = []
): ReconProgress {
  const eligible = reconEligibleCellKeys(world);
  const seenSet = asKeySet(seen);
  let mapped = 0;
  for (const key of eligible) {
    if (seenSet.has(key)) mapped++;
  }
  return { mapped, required: eligible.size };
}

function isTurnLimitExpired(contract: Contract, turnNumber: number): boolean {
  const remaining = objectiveTurnsRemaining(contract, turnNumber);
  return remaining !== null && remaining <= 0;
}

function coordKey(x: number, y: number): string {
  return `${x},${y}`;
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

function asKeySet(keys: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return keys instanceof Set ? keys : new Set(keys);
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

function allPassableCellKeys(world: World): Set<string> {
  const keys = new Set<string>();
  for (let y = 0; y < world.grid.height; y++) {
    for (let x = 0; x < world.grid.width; x++) {
      if (world.grid.isPassable(x, y)) keys.add(coordKey(x, y));
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Module-private serialisation helpers — kept outside the class so the
// persistence module can stay symmetric (restore lives there, snapshot here).
// ---------------------------------------------------------------------------

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
    ap: entity.ap,
    maxAp: entity.maxAp,
    alive: entity.alive,
    stealthed: !!entity.stealthed,
  };
  if (entity instanceof CorpDrone) {
    base.drone = {
      state: entity.state,
      lastKnownTarget: entity.lastKnownTarget ? { ...entity.lastKnownTarget } : null,
      patrolWaypoints: entity.patrolWaypoints.map(wp => ({ x: wp.x, y: wp.y })),
      patrolIndex: entity.patrolIndex,
    };
  }
  if (entity instanceof Tech) {
    // M1 design lock: the Tech's pre-built turret is a flag, not a count. M3
    // will rework this into an inventory-based item once the salvage loop
    // lands; for now snapshotting the bool is enough to round-trip a run
    // where the player did or did not deploy mid-job.
    base.tech = { turretReady: !!entity.turretReady };
  }
  if (entity instanceof Merc || entity instanceof Razor || entity instanceof Tech) {
    base.callsign = entity.callsign;
    base.flatlined = !!entity.flatlined;
    base.inventory = entity.inventory;
    base.gear = entity.gear;
  }
  if (entity instanceof Turret) {
    base.turret = {
      range: entity.range,
      attackDamage: entity.attackDamage,
      ownerId: entity.ownerId,
    };
  }
  if (entity instanceof Terminal) {
    base.terminal = {
      label: entity.label,
      sliced: entity.sliced,
      armed: entity.armed,
      raisesAlarm: entity.raisesAlarm,
    };
  }
  if (entity instanceof Pickup) {
    base.pickup = {
      label: entity.label,
      secured: entity.secured,
      armed: entity.armed,
    };
  }
  if (entity instanceof Contact) {
    base.contact = {
      label: entity.label,
      handoffComplete: entity.handoffComplete,
      armed: entity.armed,
    };
  }
  if (entity instanceof DenyTarget) {
    base.denyTarget = {
      label: entity.label,
    };
  }
  if (entity instanceof SyncPad) {
    base.syncPad = {
      label: entity.label,
      synced: entity.synced,
      armed: entity.armed,
    };
  }
  if (entity instanceof CorpTurret) {
    base.corpTurret = {
      range: entity.range,
      attackDamage: entity.attackDamage,
    };
  }
  if (entity instanceof RelayNode) {
    base.relayNode = {
      label: entity.label,
    };
  }
  if (entity instanceof EscortNpc) {
    base.escortNpc = {
      label: entity.label,
      activated: entity.activated,
      armed: entity.armed,
    };
  }
  return base;
}

function archetypeOf(entity: Entity): EntityArchetypeId {
  if (entity instanceof Merc) return 'merc';
  if (entity instanceof Razor) return 'razor';
  if (entity instanceof Tech) return 'tech';
  if (entity instanceof Turret) return 'turret';
  if (entity instanceof CorpDrone) return 'drone';
  if (entity instanceof CorpCivilian) return 'corp-civilian';
  if (entity instanceof NeutralCivilian) return 'neutral-civilian';
  if (entity instanceof Terminal) return 'terminal';
  if (entity instanceof Pickup) return 'pickup';
  if (entity instanceof Contact) return 'contact';
  if (entity instanceof DenyTarget) return 'deny-target';
  if (entity instanceof SyncPad) return 'sync-pad';
  if (entity instanceof CorpTurret) return 'corp-turret';
  if (entity instanceof RelayNode) return 'relay-node';
  if (entity instanceof EscortNpc) return 'escort-npc';
  if (entity instanceof Entity) return 'entity';
  throw new Error(`archetypeOf: cannot classify entity ${(entity as Entity | undefined)?.id}`);
}

function isTerminalSliceSatisfied(contract: Contract, world?: World | null): boolean {
  if (!world) return false;
  const required = objectiveCount(contract);
  let sliced = 0;
  for (const entity of world.entities.values()) {
    if (entity instanceof Terminal && entity.sliced) sliced++;
  }
  return sliced >= required;
}

function isRetrieveSatisfied(contract: Contract, world?: World | null): boolean {
  if (!world) return false;
  const required = objectiveCount(contract);
  let secured = 0;
  for (const entity of world.entities.values()) {
    if (entity instanceof Pickup && entity.secured) secured++;
  }
  return secured >= required;
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

/**
 * Sweep quota types:
 *   - `drone-all`:   All CorpDrone entities dead.
 *   - `relay-node`:  All RelayNode entities dead (or a params.count subset).
 *   - `turret`:      All CorpTurret entities dead (or a params.count subset).
 *
 * The quota type is inferred from `params.sweepTarget` (explicit) or
 * `params.target` (label-driven default). If no recognizable target is set,
 * falls back to `drone-all` — kill every drone on the map.
 */
export const SWEEP_QUOTA = Object.freeze({
  DRONE_ALL: 'drone-all',
  RELAY_NODE: 'relay-node',
  TURRET: 'turret',
});

function sweepQuotaType(contract: Contract): string {
  const target = (contract.objective.params?.sweepTarget ?? contract.objective.params?.target) as
    | string
    | undefined;
  if (!target) return SWEEP_QUOTA.DRONE_ALL;
  if (target === 'relay-node' || target === 'skybridge-relay') return SWEEP_QUOTA.RELAY_NODE;
  if (target === 'turret' || target === 'corp-turret') return SWEEP_QUOTA.TURRET;
  return SWEEP_QUOTA.DRONE_ALL;
}

function isSweepSatisfied(contract: Contract, world?: World | null): boolean {
  if (!world) return false;
  const quota = sweepQuotaType(contract);
  switch (quota) {
    case SWEEP_QUOTA.DRONE_ALL: {
      for (const entity of world.entities.values()) {
        if (entity instanceof CorpDrone && entity.alive) return false;
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
  const candidates: GridPoint[] = [];
  for (let y = 1; y < world.grid.height - 1; y++) {
    for (let x = 1; x < world.grid.width - 1; x++) {
      if (!world.grid.isPassable(x, y)) continue;
      if (x === player.x && y === player.y) continue;
      if (x === exitTile.x && y === exitTile.y) continue;
      if (world.entityAt(x, y)) continue;
      if (!hasAdjacentPassableTile(world, x, y)) continue;
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

function hasAdjacentPassableTile(world: World, x: number, y: number): boolean {
  const offsets = [
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
  ];
  return offsets.some(({ dx, dy }) => {
    const tx = x + dx;
    const ty = y + dy;
    return world.grid.inBounds(tx, ty) && world.grid.isPassable(tx, ty) && !world.entityAt(tx, ty);
  });
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
  throw new Error(
    `archetypeOfCrew: cannot classify crew member ${(entity as Entity | undefined)?.id}`
  );
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
  return {
    seed,
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
