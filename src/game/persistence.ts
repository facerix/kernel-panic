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
import { Crew } from './Crew.js';
import { Merc } from './archetypes/Merc.js';
import { Razor } from './archetypes/Razor.js';
import { Tech } from './archetypes/Tech.js';
import { Turret } from './Turret.js';
import { CorpDrone, DRONE_STATE } from './ai/CorpDrone.js';
import { Run, RUN_STATE } from './Run.js';
import { Campaign, CAMPAIGN_STATE } from './Campaign.js';

const ARCHETYPE_KEY = Symbol.for('kernel-panic.archetype');

const ARCHETYPE_FACTORY = Object.freeze({
  merc: props => new Merc(props),
  razor: props => new Razor(props),
  tech: props => new Tech(props),
  turret: props => new Turret(props),
  drone: props => new CorpDrone(props),
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

export function snapshotCampaign(campaign) {
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
    vouch: campaign.vouch,
    meta: { ...campaign.meta },
    deployedMemberId: campaign.deployedMemberId,
    activeRun: campaign.activeRun ? snapshotActiveRun(campaign.activeRun) : null,
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
export function restore(record, options = {}) {
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
  run.contract = record.contract ? { ...record.contract } : null;
  run.exitTile = record.exitTile ? { ...record.exitTile } : null;
  run.telemetry = { ...record.telemetry };
  run.state = record.state;
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

  for (const entity of restoredEntities) {
    run.world.addEntity(entity);
    if (entity instanceof CorpDrone) {
      entity.bindToBus(run.bus);
    }
    if (entity === player) {
      run.player = entity;
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

export function restoreCampaign(record, options = {}) {
  validateCampaignRecord(record);
  const crew = record.crew.map(restoreCrewMember);
  const campaign = new Campaign({
    id: record.id,
    seed: record.seed,
    crew,
    salvage: record.salvage,
    vouch: record.vouch,
    meta: record.meta,
    onPersist: options.onPersist,
    onResult: options.onResult,
  });
  campaign.rng = new Rng(record.rng.seed);
  campaign.rng.setState(record.rng.state);

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

  if (rec.archetype === 'tech' && rec.tech) {
    // Re-apply the pre-built turret flag so a mid-job save remembers whether
    // the player already deployed. Defaults to `true` (Tech ctor) when the
    // record omits it.
    entity.turretReady = !!rec.tech.turretReady;
  }

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

const KNOWN_ARCHETYPES_SET = new Set(['merc', 'razor', 'tech']);

function snapshotCrewMember(member) {
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

function restoreCrewMember(rec) {
  if (!rec || typeof rec !== 'object') {
    throw new TypeError('restoreCampaign: crew member record missing');
  }
  if (!KNOWN_ARCHETYPES_SET.has(rec.archetype)) {
    throw new Error(`restoreCampaign: unknown crew archetype "${rec.archetype}"`);
  }
  if (typeof rec.id !== 'string' || rec.id.length === 0) {
    throw new TypeError('restoreCampaign: crew member id must be a non-empty string');
  }
  const factory = ARCHETYPE_FACTORY[rec.archetype];
  const member = factory({
    id: rec.id,
    x: 0,
    y: 0,
    callsign: rec.callsign,
    flatlined: !!rec.flatlined,
    inventory: rec.inventory ?? null,
    gear: rec.gear ?? null,
    maxHp: rec.maxHp,
    maxAp: rec.maxAp,
  });
  if (Number.isInteger(rec.hp)) member.hp = rec.hp;
  if (Number.isInteger(rec.ap)) member.ap = rec.ap;
  member.alive = rec.alive ?? member.hp > 0;
  return member;
}

function snapshotActiveRun(run) {
  const base = {
    id: run.id,
    type: 'run',
    state: run.state,
    crewMemberId: run.crewMember.id,
    archetype: run.archetype,
    seed: run.seed,
    rng: { seed: run.rng.seed, state: run.rng.state },
    contract: run.contract ? { ...run.contract } : null,
    telemetry: { ...run.telemetry },
  };
  if (run.state === RUN_STATE.COMBAT || run.state === RUN_STATE.RESULT) {
    return { ...base, snapshot: snapshot(run) };
  }
  return base;
}

function restoreActiveRun(record, member, options) {
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
  run.contract = record.contract ? { ...record.contract } : null;
  run.telemetry = { ...record.telemetry };
  run.state = record.state;
  return run;
}

function validateCampaignRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('restoreCampaign: record must be an object');
  }
  if (record.type !== 'campaign') {
    throw new Error(`restoreCampaign: record.type must be "campaign", got "${record.type}"`);
  }
  if (!Object.values(CAMPAIGN_STATE).includes(record.state)) {
    throw new Error(`restoreCampaign: unknown campaign state "${record.state}"`);
  }
  if (!Number.isFinite(record.seed)) {
    throw new TypeError('restoreCampaign: record.seed must be a finite number');
  }
  if (!record.rng || !Number.isFinite(record.rng.seed) || !Number.isFinite(record.rng.state)) {
    throw new TypeError('restoreCampaign: record.rng requires {seed, state}');
  }
  if (!Array.isArray(record.crew) || record.crew.length === 0) {
    throw new TypeError('restoreCampaign: crew must be a non-empty array');
  }
  if (!Number.isInteger(record.salvage) || record.salvage < 0) {
    throw new RangeError('restoreCampaign: salvage must be a non-negative integer');
  }
  if (!Number.isInteger(record.vouch) || record.vouch < 0 || record.vouch > 100) {
    throw new RangeError('restoreCampaign: vouch must be an integer in [0, 100]');
  }
  if (record.meta === null || typeof record.meta !== 'object' || Array.isArray(record.meta)) {
    throw new TypeError('restoreCampaign: meta must be an object');
  }
  if (record.state === CAMPAIGN_STATE.COMBAT && !record.activeRun) {
    throw new Error('restoreCampaign: COMBAT state requires activeRun');
  }
}

function archetypeOfCrew(member) {
  if (member instanceof Merc) return 'merc';
  if (member instanceof Razor) return 'razor';
  if (member instanceof Tech) return 'tech';
  throw new Error(`snapshotCampaign: cannot classify crew member ${member?.id}`);
}

function isCrewArchetype(value) {
  return KNOWN_ARCHETYPES_SET.has(value);
}
