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
 *     contract:   { seed, objective, threatCount, label } | null,
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
import { FACTION } from './constants.js';
import { Entity } from './Entity.js';
import { Merc } from './archetypes/Merc.js';
import { Razor } from './archetypes/Razor.js';
import { CorpDrone, DRONE_STATE } from './ai/CorpDrone.js';
import { Curator } from './hub/Curator.js';
import { Run, RUN_STATE } from './Run.js';

const ARCHETYPE_KEY = Symbol.for('kernel-panic.archetype');

const ARCHETYPE_FACTORY = Object.freeze({
  merc: props => new Merc(props),
  razor: props => new Razor(props),
  drone: props => new CorpDrone(props),
  curator: props => new Curator(props),
  // Generic fallback so a future `Entity` subclass (NPCs, items) doesn't break
  // the round-trip when the full archetype landed but the loader hasn't.
  entity: props => new Entity({ faction: FACTION.NEUTRAL, glyph: '?', ...props }),
});

const KNOWN_FACTIONS = new Set(Object.values(FACTION));
const KNOWN_RUN_STATES = new Set(Object.values(RUN_STATE));
const KNOWN_DRONE_STATES = new Set(Object.values(DRONE_STATE));

/**
 * Thin re-export so callers can keep importing `snapshot` from persistence
 * even though the implementation lives on `Run` (necessary to avoid a
 * snapshot ↔ restore import cycle). Same shape as `Run.prototype.snapshot`.
 */
export function snapshot(run) {
  if (!run || !(run instanceof Run)) {
    throw new TypeError('snapshot requires a Run instance');
  }
  return run.snapshot();
}

/**
 * Rebuild a `Run` from a snapshot record. Returns `{ run, world, queue, rng,
 * player }` — the pieces the shell typically wires into the renderer.
 *
 * Validation is exhaustive: missing required fields, unknown archetypes, OOB
 * entity positions, grid byte length mismatches, etc. all throw with a
 * useful message.
 */
export function restore(record, options = {}) {
  validateRecord(record);

  const run = new Run({
    id: record.id,
    archetype: record.archetype,
    seed: record.seed,
    onPersist: options.onPersist,
    onResult: options.onResult,
  });
  run.rng = new Rng(record.rng.seed);
  run.rng.setState(record.rng.state);
  run.contract = record.contract ? { ...record.contract } : null;
  run.exitTile = record.exitTile ? { ...record.exitTile } : null;
  run.telemetry = { ...record.telemetry };
  run.state = record.state;

  const grid = new Grid(record.grid.w, record.grid.h);
  if (record.grid.tiles.length !== grid.tiles.length) {
    throw new Error(
      `restore: grid tile count mismatch — record ${record.grid.tiles.length}, expected ${grid.tiles.length}`
    );
  }
  for (let i = 0; i < record.grid.tiles.length; i++) {
    grid.tiles[i] = record.grid.tiles[i] & 0xff;
  }

  run.bus = new EventBus();
  run.world = new World(grid, { events: run.bus });

  const factionOrder = [FACTION.PLAYER, FACTION.CORP];
  run.queue = new TurnQueue(factionOrder);
  run.queue.turnNumber = record.turnNumber;
  const factionIndex = factionOrder.indexOf(record.currentFaction);
  if (factionIndex < 0) {
    throw new Error(`restore: unknown currentFaction "${record.currentFaction}"`);
  }
  run.queue.index = factionIndex;

  for (const entityRec of record.entities) {
    const entity = restoreEntity(entityRec, grid);
    run.world.addEntity(entity);
    if (entity instanceof CorpDrone) {
      entity.bindToBus(run.bus);
    }
    if (entity[ARCHETYPE_KEY] === run.archetype) {
      run.player = entity;
    }
    if (entity instanceof Curator) {
      run.curator = entity;
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

function restoreEntity(rec, grid) {
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

  const entityProps = {
    id: rec.id,
    x: rec.x,
    y: rec.y,
    maxAp: rec.maxAp,
    maxHp: rec.maxHp,
  };
  if (rec.archetype === 'drone') {
    entityProps.patrolWaypoints = rec.drone?.patrolWaypoints ?? [];
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

  if (rec.archetype === 'drone' && rec.drone) {
    if (rec.drone.state && !KNOWN_DRONE_STATES.has(rec.drone.state)) {
      throw new Error(`restore: drone ${rec.id} has unknown state "${rec.drone.state}"`);
    }
    if (rec.drone.state) entity.state = rec.drone.state;
    if (rec.drone.lastKnownTarget) {
      const lk = rec.drone.lastKnownTarget;
      if (!Number.isInteger(lk.x) || !Number.isInteger(lk.y)) {
        throw new TypeError(`restore: drone ${rec.id} lastKnownTarget must have integer coords`);
      }
      entity.lastKnownTarget = { x: lk.x, y: lk.y };
    }
    if (Number.isInteger(rec.drone.patrolIndex)) {
      entity.patrolIndex = rec.drone.patrolIndex;
    }
  }

  // Stash archetype tag on the instance so the caller can later recover the
  // player from a heterogeneous entity set.
  entity[ARCHETYPE_KEY] = rec.archetype;
  return entity;
}

function validateRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('restore: record must be an object');
  }
  if (record.type !== 'run') {
    throw new Error(`restore: record.type must be "run", got "${record.type}"`);
  }
  if (!KNOWN_RUN_STATES.has(record.state)) {
    throw new Error(`restore: unknown run state "${record.state}"`);
  }
  if (!KNOWN_ARCHETYPES_SET.has(record.archetype)) {
    throw new Error(`restore: unknown archetype "${record.archetype}"`);
  }
  if (!Number.isFinite(record.seed)) {
    throw new TypeError('restore: record.seed must be a finite number');
  }
  if (!record.rng || !Number.isFinite(record.rng.seed) || !Number.isFinite(record.rng.state)) {
    throw new TypeError('restore: record.rng requires {seed, state}');
  }
  if (!record.grid || !Number.isInteger(record.grid.w) || !Number.isInteger(record.grid.h)) {
    throw new TypeError('restore: record.grid requires integer w/h');
  }
  if (!Array.isArray(record.grid.tiles)) {
    throw new TypeError('restore: record.grid.tiles must be an array');
  }
  if (!Number.isInteger(record.turnNumber) || record.turnNumber < 1) {
    throw new RangeError(`restore: record.turnNumber must be ≥ 1, got ${record.turnNumber}`);
  }
  if (!Array.isArray(record.entities)) {
    throw new TypeError('restore: record.entities must be an array');
  }
}

const KNOWN_ARCHETYPES_SET = new Set(['merc', 'razor']);
