import { Turret, type TurretAutoFireResult } from './Turret.js';
import { NeutralCivilian } from './entities/NeutralCivilian.js';
import { EscortNpc, type EscortFollowStep } from './entities/EscortNpc.js';
import { entityLabel } from './Entity.js';
import { TILE, HAZARD_DAMAGE, REP, FACTION } from './constants.js';
import { EVENT } from './events.js';
import { chebyshev, findPath } from './Pathfinding.js';
import { detonateBreachingCharge } from './breachBlast.js';
import { BreachingCharge } from './entities/BreachingCharge.js';
import type { BlastCasualty } from './breachBlast.js';
import type { Entity } from './Entity.js';
import type { NeutralCivilianTurnStep } from '../types.js';
import type { GridPoint } from '../types.js';
import type { World } from './World.js';
import type { Rng } from '../rng.js';

const ESCORT_CATCH_UP_STEPS = 4;

/**
 * Combat turn pipeline.
 *
 * This module owns the pure phase order for the combat loop:
 *
 *   player yields → player aftermath steps → corp acts → player regains control
 *
 * Shells still own presentation concerns: log surfaces, canvas paints,
 * animation locks, and wall-clock pacing. They inject those effects through
 * callbacks so this module stays testable under `node --test`.
 *
 * When you add more actors that resolve "with" the player slice of the
 * round — allied NPCs, deployables beyond turrets, map hazards — register
 * them as ordered steps inside `runPlayerAftermathSteps` and append any
 * human-readable lines from `formatPlayerAftermathLogLines`.
 *
 */
export type TurretAftermathStep = {
  type: 'turret-autofire';
  turret: Turret;
  action: TurretAutoFireResult;
};

export type NeutralCivilianAftermathStep = {
  type: 'neutral-civilian';
  entity: NeutralCivilian;
  step: NeutralCivilianTurnStep;
};

export type HazardAftermathStep = {
  type: 'hazard-damage';
  entity: Entity;
  damage: number;
  killed: boolean;
};

export type EscortAftermathStep = {
  type: 'escort-npc';
  entity: EscortNpc;
  step: EscortFollowStep;
};

export type BreachDetonateAftermathStep = {
  type: 'breach-detonate';
  charge: BreachingCharge;
  terrainBreached: number;
  casualties: BlastCasualty[];
};

export type PlayerAftermathStep =
  | BreachDetonateAftermathStep
  | TurretAftermathStep
  | NeutralCivilianAftermathStep
  | EscortAftermathStep
  | HazardAftermathStep;

/**
 * Whether an aftermath step should emit player-facing log lines.
 * Same policy as `isCorpTurnStepLogVisibleToPlayer`: unseen turret / NPC
 * activity stays off the feed; turret shots that hit the player are always shown.
 */
export function isPlayerAftermathStepLogVisible(
  step: PlayerAftermathStep,
  isTileVisible: (x: number, y: number) => boolean,
  playerId: string
): boolean {
  if (step.type === 'turret-autofire') {
    const { turret, action } = step;
    if (action.type === 'fire' && action.target.id === playerId) {
      return true;
    }
    return isTileVisible(turret.x, turret.y);
  }
  if (step.type === 'neutral-civilian') {
    return isTileVisible(step.entity.x, step.entity.y);
  }
  if (step.type === 'escort-npc') {
    return isTileVisible(step.entity.x, step.entity.y);
  }
  if (step.type === 'hazard-damage') {
    // Hazard damage to the player is always visible; other entities only when
    // the tile is in current LOS.
    if (step.entity.id === playerId) return true;
    return isTileVisible(step.entity.x, step.entity.y);
  }
  if (step.type === 'breach-detonate') {
    if (isTileVisible(step.charge.x, step.charge.y)) return true;
    for (const c of step.casualties) {
      if (c.entity.id === playerId) return true;
      if (isTileVisible(c.entity.x, c.entity.y)) return true;
    }
    return false;
  }
  return true;
}

export type PlayerAftermath = {
  steps: PlayerAftermathStep[];
  turretAutoFire: { turret: Turret; action: TurretAutoFireResult }[];
};

export type PlayerAftermathOpts = {
  /** Current campaign rep for NeutralCivilian AI. Defaults to REP.START (50). */
  rep?: number;
};

type DrivePlayerAftermathOpts = {
  onStep: (step: PlayerAftermathStep) => void;
  onFinish: () => void;
};
type DriveCorpTurnOpts = {
  onFinish: () => void;
};
export type PlayerTurnContext = {
  queue: { endTurn: (world: World) => void };
  world: World;
  rng: Rng;
  drivePlayerAftermath: (opts: DrivePlayerAftermathOpts) => void;
  driveCorpTurn: (opts: DriveCorpTurnOpts) => void;
  isTerminal: () => boolean;
  onCorpTurnReady: () => void;
  onPlayerAftermathStep: (step: PlayerAftermathStep) => void;
  onPlayerTurnReady: () => void;
};

const defaultSchedule = (fn: () => void, ms: number) => setTimeout(fn, ms);

/**
 * Advance from the end of a player-controlled turn through aftermath and
 * corp action. The corp driver may be synchronous (debug harness) or async
 * (main shell); it must call `onFinish` when corp action is fully resolved.
 */
export function advanceFromPlayerTurn(ctx: PlayerTurnContext) {
  validateAdvanceCtx(ctx);
  const {
    queue,
    world,
    rng,
    drivePlayerAftermath = opts => drivePlayerAftermathSync({ world, rng, ...opts }),
    driveCorpTurn,
    isTerminal = () => false,
    onCorpTurnReady = () => {},
    onPlayerAftermathStep = () => {},
    onPlayerTurnReady = () => {},
  } = ctx;

  // If the player's action already ended the run (e.g. stepping onto the exit
  // tile transitions to RESULT synchronously), do not advance the turn queue —
  // refreshing corp AP and bumping the turn counter on a dead run is a state
  // mutation that should never happen.
  if (isTerminal()) return;

  queue.endTurn(world);
  onCorpTurnReady();

  drivePlayerAftermath({
    onStep: onPlayerAftermathStep,
    onFinish: () => {
      if (isTerminal()) return;
      driveCorpTurn({
        onFinish: () => {
          if (isTerminal()) return;
          queue.endTurn(world);
          onPlayerTurnReady();
        },
      });
    },
  });
}

type DrivePlayerAftermathCtx = {
  world: World;
  rng: Rng;
  onStep: (step: PlayerAftermathStep) => void;
  onFinish: () => void;
  animLock?: { push: (ms: number) => void } | null;
  stepDelayMs?: number;
  lockMarginMs?: number;
  schedule?: (fn: () => void, ms: number) => void;
  rep?: number;
};

/** Subset of {@link DrivePlayerAftermathCtx} passed into the paced aftermath pump. */
type PumpPlayerAftermathCtx = {
  onStep: (step: PlayerAftermathStep) => void;
  onFinish: () => void;
  animLock: { push: (ms: number) => void } | null;
  stepDelayMs: number;
  lockMarginMs: number;
  schedule: (fn: () => void, ms: number) => void;
};

/**
 * Drive aftermath steps with optional pacing. The default scheduler is
 * `setTimeout`, but tests and debug harnesses can inject a deterministic
 * scheduler or use `drivePlayerAftermathSync`.
 */
export function drivePlayerAftermath(ctx: DrivePlayerAftermathCtx) {
  validatePlayerAftermathDriverCtx(ctx);
  const {
    world,
    rng,
    onStep,
    onFinish,
    animLock = null,
    stepDelayMs = 0,
    lockMarginMs = 0,
    schedule = defaultSchedule,
    rep,
  } = ctx;
  const steps = runPlayerAftermathSteps(world, rng, { rep });
  pumpPlayerAftermath(steps, { onStep, onFinish, animLock, stepDelayMs, lockMarginMs, schedule });
}

/**
 * Synchronous aftermath driver. Useful for tests and the debug harness, where
 * a single repaint at the end is deliberate.
 */
export function drivePlayerAftermathSync(ctx: DrivePlayerAftermathCtx) {
  validatePlayerAftermathDriverCtx(ctx, { allowTiming: false });
  for (const step of runPlayerAftermathSteps(ctx.world, ctx.rng, { rep: ctx.rep })) {
    ctx.onStep(step);
  }
  ctx.onFinish();
}

/**
 * Run every automated system that resolves after the player yields but before
 * corp AI steps.
 * Mutates `world` (e.g. turret shots). Call only after `TurnQueue.endTurn`
 * has advanced `currentFaction` to `FACTION.CORP` from the player slot.
 *
 * @param {import('./World.js').World} world
 * @param {import('../rng.js').Rng} rng
 * @returns {PlayerAftermath}
 */
export function runPlayerAftermath(world: World, rng: Rng, opts?: PlayerAftermathOpts) {
  const steps = [...runPlayerAftermathSteps(world, rng, opts)];
  const turretAutoFire = steps
    .filter((step): step is TurretAftermathStep => step.type === 'turret-autofire')
    .map(step => ({ turret: step.turret, action: step.action }));
  return { steps, turretAutoFire };
}

/**
 * Yield one aftermath action at a time. This is the mechanics surface the
 * paced driver consumes, and the place future allied/neutral/hazard steps
 * should join.
 *
 * @param {import('./World.js').World} world
 * @param {import('../rng.js').Rng} rng
 * @returns {Generator<PlayerAftermathStep>}
 */
export function* runPlayerAftermathSteps(
  world: World,
  rng: Rng,
  opts?: PlayerAftermathOpts
): Generator<PlayerAftermathStep, void, undefined> {
  // Phase 0: detonate armed breaching charges
  const charges: BreachingCharge[] = [];
  for (const entity of world.entities.values()) {
    if (entity instanceof BreachingCharge && entity.alive) charges.push(entity);
  }
  for (const charge of charges) {
    const { terrainBreached, casualties } = detonateBreachingCharge(world, charge.x, charge.y);
    yield { type: 'breach-detonate', charge, terrainBreached, casualties };
    world.removeEntity(charge.id);
  }

  // Phase 1: turret autofire
  for (const entity of world.entities.values()) {
    if (!(entity instanceof Turret)) continue;
    if (!entity.alive) continue;
    yield {
      type: 'turret-autofire',
      turret: entity,
      action: entity.autoFire(world, rng),
    };
  }
  // Phase 2: neutral civilian reactions (flee / panic / idle based on rep)
  const rep = opts?.rep ?? REP.START;
  for (const entity of world.entities.values()) {
    if (!(entity instanceof NeutralCivilian)) continue;
    if (!entity.alive) continue;
    const step = entity.takeAftermathStep(world, rng, { rep });
    if (step) {
      yield { type: 'neutral-civilian', entity, step };
    }
  }

  // Phase 3: activated escort NPCs follow during the player aftermath slice.
  for (const entity of world.entities.values()) {
    if (!(entity instanceof EscortNpc)) continue;
    if (!entity.alive) continue;
    for (const step of takeEscortFollowSteps(world, entity)) {
      yield { type: 'escort-npc', entity, step };
    }
  }

  // Phase 4: environmental hazard damage
  // Every live entity standing on a HAZARD tile takes flat damage. Emits
  // ENTITY_DAMAGED so Run's death-detection listener fires normally, and
  // HAZARD_DAMAGE for presentation (shell log lines, flash effects).
  // Objective pickups may sit on hazard anchors — they stay interactable.
  for (const entity of world.entities.values()) {
    if (!entity.alive) continue;
    if (entity.isHazardImmune()) continue;
    if (world.grid.tileAt(entity.x, entity.y) !== TILE.HAZARD) continue;
    const damage = HAZARD_DAMAGE;
    entity.hp = Math.max(0, entity.hp - damage);
    const killed = entity.hp <= 0;
    if (killed) entity.alive = false;
    world.events?.emit(EVENT.ENTITY_DAMAGED, {
      attacker: null,
      target: entity,
      damage,
      killed,
      source: 'hazard',
    });
    world.events?.emit(EVENT.HAZARD_DAMAGE, {
      entity,
      damage,
      killed,
      x: entity.x,
      y: entity.y,
    });
    yield { type: 'hazard-damage', entity, damage, killed };
  }
}

/**
 * Flat log lines for everything that happened in {@link runPlayerAftermath}.
 * Shells choose how to display them (`flash` vs debug `log`, `>` prefixes, etc.).
 *
 * @param {PlayerAftermath} aftermath
 * @returns {string[]}
 */
export function formatPlayerAftermathLogLines(aftermath: PlayerAftermath) {
  const lines = [];
  for (const step of aftermath.steps) {
    lines.push(...formatPlayerAftermathStepLogLines(step));
  }
  return lines;
}

/**
 * Flat log lines for one aftermath step.
 *
 * @param {PlayerAftermathStep} step
 * @returns {string[]}
 */
export function formatPlayerAftermathStepLogLines(step: PlayerAftermathStep) {
  if (step.type === 'turret-autofire') {
    const line = formatTurretAutofireLine(step.turret, step.action);
    return line ? [line] : [];
  }
  if (step.type === 'neutral-civilian') {
    return formatNeutralCivilianLine(step.entity, step.step);
  }
  if (step.type === 'escort-npc') {
    return formatEscortNpcLine(step.entity, step.step);
  }
  if (step.type === 'hazard-damage') {
    return formatHazardDamageLine(step);
  }
  if (step.type === 'breach-detonate') {
    return formatBreachDetonateLines(step);
  }
  return [];
}

function formatBreachDetonateLines(step: BreachDetonateAftermathStep): string[] {
  const lines = ['BREACHING CHARGE detonated.'];
  if (step.terrainBreached > 0) {
    lines.push(
      `Blast breached ${step.terrainBreached} structure${step.terrainBreached === 1 ? '' : 's'}.`
    );
  }
  for (const { entity, damage, killed } of step.casualties) {
    const label = entityLabel(entity);
    lines.push(killed ? `Blast killed ${label}.` : `Blast hit ${label} for ${damage} damage.`);
  }
  return lines;
}

function validateAdvanceCtx(ctx: PlayerTurnContext) {
  if (!ctx || typeof ctx !== 'object') {
    throw new TypeError('advanceFromPlayerTurn: ctx must be an object');
  }
  if (!ctx.queue || typeof ctx.queue.endTurn !== 'function') {
    throw new TypeError('advanceFromPlayerTurn: ctx.queue.endTurn must be a function');
  }
  if (!ctx.world || typeof ctx.world.entities?.values !== 'function') {
    throw new TypeError('advanceFromPlayerTurn: ctx.world.entities must be iterable');
  }
  if (!ctx.rng || typeof ctx.rng.next !== 'function') {
    throw new TypeError('advanceFromPlayerTurn: ctx.rng must be an Rng-like object');
  }
  if (typeof ctx.driveCorpTurn !== 'function') {
    throw new TypeError('advanceFromPlayerTurn: ctx.driveCorpTurn must be a function');
  }
  if (ctx.drivePlayerAftermath !== undefined && typeof ctx.drivePlayerAftermath !== 'function') {
    throw new TypeError(
      'advanceFromPlayerTurn: ctx.drivePlayerAftermath must be a function when supplied'
    );
  }
  if (ctx.isTerminal !== undefined && typeof ctx.isTerminal !== 'function') {
    throw new TypeError('advanceFromPlayerTurn: ctx.isTerminal must be a function when supplied');
  }
  if (ctx.onCorpTurnReady !== undefined && typeof ctx.onCorpTurnReady !== 'function') {
    throw new TypeError(
      'advanceFromPlayerTurn: ctx.onCorpTurnReady must be a function when supplied'
    );
  }
  if (ctx.onPlayerAftermathStep !== undefined && typeof ctx.onPlayerAftermathStep !== 'function') {
    throw new TypeError(
      'advanceFromPlayerTurn: ctx.onPlayerAftermathStep must be a function when supplied'
    );
  }
  if (ctx.onPlayerTurnReady !== undefined && typeof ctx.onPlayerTurnReady !== 'function') {
    throw new TypeError(
      'advanceFromPlayerTurn: ctx.onPlayerTurnReady must be a function when supplied'
    );
  }
}

function pumpPlayerAftermath(
  steps: Generator<PlayerAftermathStep, void, undefined>,
  ctx: PumpPlayerAftermathCtx
) {
  const result = steps.next();
  if (result.done) {
    ctx.onFinish();
    return;
  }
  ctx.onStep(result.value);
  ctx.animLock?.push(Number(ctx.stepDelayMs) + Number(ctx.lockMarginMs));
  scheduleNextAftermathStep(() => pumpPlayerAftermath(steps, ctx), ctx);
}

function scheduleNextAftermathStep(fn: () => void, ctx: PumpPlayerAftermathCtx) {
  if (ctx.stepDelayMs === 0) {
    fn();
    return;
  }
  ctx.schedule(fn, Number(ctx.stepDelayMs));
}

function validatePlayerAftermathDriverCtx(
  ctx: DrivePlayerAftermathCtx,
  { allowTiming = true } = {}
) {
  if (!ctx || typeof ctx !== 'object') {
    throw new TypeError('drivePlayerAftermath: ctx must be an object');
  }
  if (!ctx.world || typeof ctx.world.entities?.values !== 'function') {
    throw new TypeError('drivePlayerAftermath: ctx.world.entities must be iterable');
  }
  if (!ctx.rng || typeof ctx.rng.next !== 'function') {
    throw new TypeError('drivePlayerAftermath: ctx.rng must be an Rng-like object');
  }
  if (typeof ctx.onStep !== 'function') {
    throw new TypeError('drivePlayerAftermath: ctx.onStep must be a function');
  }
  if (typeof ctx.onFinish !== 'function') {
    throw new TypeError('drivePlayerAftermath: ctx.onFinish must be a function');
  }
  if (!allowTiming) return;
  if (
    ctx.animLock !== undefined &&
    ctx.animLock !== null &&
    typeof ctx.animLock.push !== 'function'
  ) {
    throw new TypeError('drivePlayerAftermath: ctx.animLock must expose push(ms) when supplied');
  }
  if (ctx.stepDelayMs !== undefined && (!Number.isFinite(ctx.stepDelayMs) || ctx.stepDelayMs < 0)) {
    throw new RangeError('drivePlayerAftermath: ctx.stepDelayMs must be a non-negative number');
  }
  if (
    ctx.lockMarginMs !== undefined &&
    (!Number.isFinite(ctx.lockMarginMs) || ctx.lockMarginMs < 0)
  ) {
    throw new RangeError('drivePlayerAftermath: ctx.lockMarginMs must be a non-negative number');
  }
  if (ctx.schedule !== undefined && typeof ctx.schedule !== 'function') {
    throw new TypeError('drivePlayerAftermath: ctx.schedule must be a function when supplied');
  }
}

function formatNeutralCivilianLine(
  entity: NeutralCivilian,
  step: NeutralCivilianTurnStep
): string[] {
  const label = entityLabel(entity);
  switch (step.type) {
    case 'neutral-flee':
      return [`${label} flees to (${step.to.x},${step.to.y}).`];
    case 'neutral-cornered':
      return [`${label} is cornered — nowhere to flee.`];
    case 'neutral-panic':
      return [`${label} PANICS — noise draws attention!`];
    case 'neutral-idle':
    default:
      return [];
  }
}

function formatHazardDamageLine(step: HazardAftermathStep): string[] {
  const label = entityLabel(step.entity);
  const line = `${label} takes ${step.damage} hazard damage.${step.killed ? ` ${label.toUpperCase()} DOWN.` : ''}`;
  return [line];
}

function formatEscortNpcLine(entity: EscortNpc, step: EscortFollowStep): string[] {
  const label = entityLabel(entity);
  if (step.type === 'escort-follow') {
    return [`${label} follows to (${step.to.x},${step.to.y}).`];
  }
  if (step.reason === 'blocked') {
    return [`${label} waits — path blocked.`];
  }
  return [];
}

function formatTurretAutofireLine(turret: Turret, action: TurretAutoFireResult) {
  const turretLabel = entityLabel(turret);
  if (action.type === 'fire') {
    const r = action.result;
    const targetLabel = entityLabel(action.target);
    return (
      `${turretLabel} auto-fires at ${targetLabel} — ` +
      `${r.hit ? 'HIT' : 'miss'} (roll ${r.roll.toFixed(2)} vs ${r.threshold.toFixed(2)}` +
      `${r.inCover ? ', cover' : ''}).` +
      (r.killed ? ` ${targetLabel.toUpperCase()} DOWN.` : '')
    );
  }
  if (action.reason === 'no-target') {
    return `${turretLabel} scans — no target in range.`;
  }
  return null;
}

function* takeEscortFollowSteps(
  world: World,
  escort: EscortNpc
): Generator<EscortFollowStep, void, undefined> {
  if (!escort.activated) {
    yield { type: 'escort-wait', reason: 'inactive' };
    return;
  }
  const player = playerInWorld(world);
  if (!player) {
    yield { type: 'escort-wait', reason: 'no-player' };
    return;
  }

  for (let i = 0; i < ESCORT_CATCH_UP_STEPS; i++) {
    if (chebyshev(escort.x, escort.y, player.x, player.y) <= 1) {
      if (i === 0) yield { type: 'escort-wait', reason: 'adjacent' };
      return;
    }
    const path = shortestPathToPlayerAdjacency(world, escort, player);
    if (!path || path.length === 0) {
      yield { type: 'escort-wait', reason: 'blocked' };
      return;
    }
    const next = path[0]!;
    const from = { x: escort.x, y: escort.y };
    world.relocateEntity(escort, next.x, next.y);
    yield { type: 'escort-follow', from, to: { x: escort.x, y: escort.y } };
  }
}

function shortestPathToPlayerAdjacency(
  world: World,
  escort: EscortNpc,
  player: Entity
): GridPoint[] | null {
  let best: GridPoint[] | null = null;
  for (const target of adjacentOpenTiles(world, player)) {
    const path = findPath(world, { x: escort.x, y: escort.y }, target, {
      allowOccupiedGoal: false,
    });
    if (!path) continue;
    if (!best || path.length < best.length) best = path;
  }
  return best;
}

function adjacentOpenTiles(world: World, center: Entity): GridPoint[] {
  const tiles: GridPoint[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = center.x + dx;
      const y = center.y + dy;
      if (!world.grid.inBounds(x, y)) continue;
      if (!world.grid.isPassable(x, y)) continue;
      if (world.entityAt(x, y)) continue;
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function playerInWorld(world: World): Entity | null {
  for (const entity of world.entities.values()) {
    if (entity.faction === FACTION.PLAYER && entity.alive && !(entity instanceof EscortNpc)) {
      return entity;
    }
  }
  return null;
}
