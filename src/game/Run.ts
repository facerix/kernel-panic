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
import { CorpTurret } from './entities/CorpTurret.js';
import { RelayNode } from './entities/RelayNode.js';
import { resetCorpTurnStatusCache } from './corpTurnStatusCopy.js';
import { NeutralCivilian } from './entities/NeutralCivilian.js';
import {
  OBJECTIVES,
  cloneObjective,
  isContractDifficulty,
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
  | 'corp-turret'
  | 'relay-node'
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
  outcome: Outcome | null;
  [key: string]: unknown;
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
  corpTurret?: {
    range: number;
    attackDamage: number;
  };
  relayNode?: {
    label: string;
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
    this.state = RUN_STATE.COMBAT;
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
    };
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
    if (entity !== this.player || !this.exitTile) return;
    if (to.x === this.exitTile.x && to.y === this.exitTile.y) {
      if (!this.contract) {
        throw new Error('Run.#onEntityMoved: exit reached without an active contract');
      }
      if (!isObjectiveSatisfied(this.contract, this.world)) return;
      this.telemetry.cause = 'exit-reached';
      this.enterResult({ outcome: OUTCOME.EXIT });
    }
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
    // M2.4: Place sweep targets (relay nodes or corp turrets) for sweep contracts.
    if (this.contract.objective.kind === OBJECTIVES.SWEEP) {
      this.#placeSweepTargets();
    }
    // M2.3: Place hazard cluster near a future pickup anchor when hazardFlavor
    // is set (e.g. "Glassed clinic data dump"). The cluster is placed around a
    // candidate anchor point biased away from spawn/exit.
    if (
      this.contract.objective.kind !== OBJECTIVES.RETRIEVE &&
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
}

export function isObjectiveSatisfied(contract: Contract, world?: World | null): boolean {
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
    case OBJECTIVES.DUAL_SITE:
      // M1 only carries objective intent through contract generation, UI, and
      // saves. M2 replaces these permissive cases with family-specific state.
      return true;
    case OBJECTIVES.SWEEP:
      return isSweepSatisfied(contract, world);
    default: {
      const exhaustive: never = kind;
      throw new Error(`Run.isObjectiveSatisfied: unknown objective kind "${exhaustive}"`);
    }
  }
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
  if (entity instanceof CorpTurret) return 'corp-turret';
  if (entity instanceof RelayNode) return 'relay-node';
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

function objectiveCount(contract: Contract): number {
  const countParam = contract.objective.params?.count;
  return Number.isInteger(countParam) && Number(countParam) > 0 ? Number(countParam) : 1;
}

function pickupLabel(contract: Contract, index: number, count: number): string {
  const target = contract.objective.params?.target;
  const base =
    typeof target === 'string' && target.length > 0
      ? targetLabel(target)
      : contract.objective.title;
  return count > 1 ? `${base} ${index + 1}` : base;
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
  return {
    seed,
    objective,
    difficulty,
    threatCount,
    label: candidate.label,
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
    reward: { ...contract.reward },
  };
}

function makeRunId(seed: number): string {
  // Browser-friendly id without crypto: seed + millisecond. Persistence
  // stores it verbatim inside the surrounding campaign snapshot.
  return `run-${(seed >>> 0).toString(16)}-${Date.now().toString(36)}`;
}
