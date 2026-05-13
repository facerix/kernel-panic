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
import { FACTION } from './constants.js';
import { Entity } from './Entity.js';
import { Crew } from './Crew.js';
import { Merc } from './archetypes/Merc.js';
import { Razor } from './archetypes/Razor.js';
import { Tech } from './archetypes/Tech.js';
import { Turret } from './Turret.js';
import { CorpDrone } from './ai/CorpDrone.js';
import { isObjective } from './hub/Curator.js';
import { buildMap } from './procgen/mapBuild.js';

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

export class Run {
  constructor({ id, crewMember, seed, onPersist, onResult } = {}) {
    if (!Number.isFinite(seed)) {
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
    this.onPersist = onPersist ?? null;
    this.onResult = onResult ?? null;

    /** @type {Array<() => void>} active bus subscriptions */
    this._busUnsubs = [];
  }

  /** Permitted from a fresh Run only. Caches the contract for `enterCombat`. */
  enterBriefing(contract) {
    if (this.state !== null) {
      throw new Error(`Run.enterBriefing: illegal transition from ${this.state}`);
    }
    validateContract(contract);
    this.contract = { ...contract };
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
    });
    this.world = new World(map.grid, { events: this.bus });
    this.player = this.#makePlayer(map.spawns.player);
    this.world.addEntity(this.player);
    for (let i = 0; i < map.drones.length; i++) {
      const a = map.drones[i];
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
    this.queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
    this.exitTile = { ...map.exitTile };
    this.state = RUN_STATE.COMBAT;
    this._reattachCombatListeners();
  }

  /** Permitted from COMBAT only. Notifies the shell via `onResult`. */
  enterResult({ outcome, telemetry } = {}) {
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
  snapshot() {
    if (!this.world || !this.queue) {
      throw new Error('Run.snapshot: no live world to capture');
    }
    return {
      id: this.id,
      type: 'run',
      state: this.state,
      archetype: this.archetype,
      seed: this.seed,
      turnNumber: this.queue.turnNumber,
      currentFaction: this.queue.currentFaction,
      rng: { seed: this.rng.seed, state: this.rng.state },
      contract: this.contract ? { ...this.contract } : null,
      exitTile: this.exitTile ? { ...this.exitTile } : null,
      grid: {
        w: this.world.grid.width,
        h: this.world.grid.height,
        tiles: Array.from(this.world.grid.tiles),
      },
      entities: Array.from(this.world.entities.values()).map(snapshotEntity),
      telemetry: { ...this.telemetry },
    };
  }

  /**
   * Internal hook used by `enterCombat` *and* by `persistence.restore()` to
   * re-attach the COMBAT-state bus subscriptions. Underscored rather than
   * `#`-private because cross-module restore needs to call it.
   */
  _reattachCombatListeners() {
    this.#unwireCombatListeners();
    this._busUnsubs.push(
      this.bus.on(EVENT.TURN_ENDED, () => this.#onTurnEnded()),
      this.bus.on(EVENT.ENTITY_DAMAGED, payload => this.#onEntityDamaged(payload)),
      this.bus.on(EVENT.ENTITY_MOVED, payload => this.#onEntityMoved(payload))
    );
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  #makePlayer(spawn) {
    this.crewMember.x = spawn.x;
    this.crewMember.y = spawn.y;
    this.crewMember.maxAp = 4;
    this.crewMember.ap = this.crewMember.maxAp;
    this.crewMember.hp = this.crewMember.maxHp;
    this.crewMember.alive = true;
    this.crewMember.stealthed = false;
    if (this.crewMember instanceof Tech) {
      this.crewMember.turretReady = true;
    }
    return this.crewMember;
  }

  #unwireCombatListeners() {
    for (const off of this._busUnsubs) off();
    this._busUnsubs = [];
  }

  #onTurnEnded() {
    if (this.state !== RUN_STATE.COMBAT) return;
    this.telemetry.turn = this.queue.turnNumber;
    if (!this.onPersist) return;
    this.onPersist(this.snapshot());
  }

  #onEntityDamaged({ attacker, target, damage, killed, source }) {
    if (this.state !== RUN_STATE.COMBAT) return;
    if (target === this.player) {
      this.telemetry.lastDamageSource = source;
      this.telemetry.lastAttacker = attacker?.id ?? null;
      this.telemetry.hpAtDamage = this.player.hp;
      if (killed) {
        this.telemetry.hpAtDeath = 0;
        this.telemetry.cause = `${attacker?.id ?? 'unknown'}::${source}(${damage})`;
        this.enterResult({ outcome: OUTCOME.DEATH });
      }
      return;
    }
    if (attacker === this.player && killed) {
      this.telemetry.kills = (this.telemetry.kills ?? 0) + 1;
    } else if (killed && attacker instanceof Turret && attacker.ownerId === this.player.id) {
      this.telemetry.kills = (this.telemetry.kills ?? 0) + 1;
    }
  }

  #onEntityMoved({ entity, to }) {
    if (this.state !== RUN_STATE.COMBAT) return;
    if (entity !== this.player || !this.exitTile) return;
    if (to.x === this.exitTile.x && to.y === this.exitTile.y) {
      this.telemetry.cause = 'exit-reached';
      this.enterResult({ outcome: OUTCOME.EXIT });
    }
  }

  #tearDownWorld() {
    this.#unwireCombatListeners();
    if (this.world) {
      for (const e of this.world.entities.values()) {
        if (typeof e.unbind === 'function') e.unbind();
      }
    }
    this.world = null;
    this.queue = null;
    this.player = null;
    this.exitTile = null;
    this.bus = null;
  }
}

// ---------------------------------------------------------------------------
// Module-private serialisation helpers — kept outside the class so the
// persistence module can stay symmetric (restore lives there, snapshot here).
// ---------------------------------------------------------------------------

function snapshotEntity(entity) {
  const archetype = archetypeOf(entity);
  const base = {
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
  return base;
}

function archetypeOf(entity) {
  if (entity instanceof Merc) return 'merc';
  if (entity instanceof Razor) return 'razor';
  if (entity instanceof Tech) return 'tech';
  if (entity instanceof Turret) return 'turret';
  if (entity instanceof CorpDrone) return 'drone';
  if (entity instanceof Entity) return 'entity';
  throw new Error(`archetypeOf: cannot classify entity ${entity?.id}`);
}

function archetypeOfCrew(entity) {
  if (entity instanceof Merc) return 'merc';
  if (entity instanceof Razor) return 'razor';
  if (entity instanceof Tech) return 'tech';
  throw new Error(`archetypeOfCrew: cannot classify crew member ${entity?.id}`);
}

function freshTelemetry(archetype, seed) {
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

function validateContract(contract) {
  if (!contract || typeof contract !== 'object') {
    throw new TypeError('contract must be an object');
  }
  if (!Number.isInteger(contract.seed) || contract.seed < 0) {
    throw new TypeError(`contract.seed must be a non-negative integer, got ${contract.seed}`);
  }
  if (!isObjective(contract.objective)) {
    throw new Error(`contract.objective "${contract.objective}" is not a known objective`);
  }
  if (!Number.isInteger(contract.threatCount) || contract.threatCount < 0) {
    throw new TypeError(
      `contract.threatCount must be a non-negative integer, got ${contract.threatCount}`
    );
  }
  if (typeof contract.label !== 'string' || contract.label.length === 0) {
    throw new TypeError('contract.label must be a non-empty string');
  }
}

function makeRunId(seed) {
  // Browser-friendly id without crypto: seed + millisecond. Persistence
  // stores it verbatim inside the surrounding campaign snapshot.
  return `run-${(seed >>> 0).toString(16)}-${Date.now().toString(36)}`;
}
