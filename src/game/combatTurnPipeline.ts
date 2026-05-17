import { Turret, type TurretAutoFireResult } from './Turret.js';
import type { World } from './World.js';
import type { Rng } from '../rng.js';

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
export type PlayerAftermathStep = {
  type: 'turret-autofire';
  turret: Turret;
  action: TurretAutoFireResult;
};

export type PlayerAftermath = {
  steps: PlayerAftermathStep[];
  turretAutoFire: { turret: Turret; action: TurretAutoFireResult }[];
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

  queue.endTurn(world);
  onCorpTurnReady();
  if (isTerminal()) return;

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
  } = ctx;
  const steps = runPlayerAftermathSteps(world, rng);
  pumpPlayerAftermath(steps, { onStep, onFinish, animLock, stepDelayMs, lockMarginMs, schedule });
}

/**
 * Synchronous aftermath driver. Useful for tests and the debug harness, where
 * a single repaint at the end is deliberate.
 */
export function drivePlayerAftermathSync(ctx: DrivePlayerAftermathCtx) {
  validatePlayerAftermathDriverCtx(ctx, { allowTiming: false });
  for (const step of runPlayerAftermathSteps(ctx.world, ctx.rng)) {
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
export function runPlayerAftermath(world: World, rng: Rng) {
  const steps = [...runPlayerAftermathSteps(world, rng)];
  const turretAutoFire = steps
    .filter(step => step.type === 'turret-autofire')
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
  rng: Rng
): Generator<PlayerAftermathStep, void, undefined> {
  for (const entity of world.entities.values()) {
    if (!(entity instanceof Turret)) continue;
    if (!entity.alive) continue;
    yield {
      type: 'turret-autofire',
      turret: entity,
      action: entity.autoFire(world, rng),
    };
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
  return [];
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

function formatTurretAutofireLine(turret: Turret, action: TurretAutoFireResult) {
  if (action.type === 'fire') {
    const r = action.result;
    return (
      `${turret.id} auto-fires at ${action.target.id} — ` +
      `${r.hit ? 'HIT' : 'miss'} (roll ${r.roll.toFixed(2)} vs ${r.threshold.toFixed(2)}` +
      `${r.inCover ? ', cover' : ''}).` +
      (r.killed ? ` ${action.target.id.toUpperCase()} DOWN.` : '')
    );
  }
  if (action.reason === 'no-target') {
    return `${turret.id} scans — no target in range.`;
  }
  return null;
}
