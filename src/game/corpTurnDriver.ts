import type { TurnActionSteps } from '../types.js';
import type { World } from './World.js';
import type { Rng } from '../rng.js';

export type CorpTurnDriverCtx = {
  run: {
    state: string;
    world: World;
    rng: Rng;
  };
  corpFaction: string;
  paint: () => void;
  animLock: { push: (ms: number) => void };
  actionDelayMs: number;
  lockMarginMs: number;
  onFinish: () => void;
  schedule?: (fn: () => void, ms: number) => void;
};

/**
 * Animated corp-turn driver.
 *
 * Drives one drone-action-at-a-time through `takeTurnSteps` generators so
 * the game shell can paint + delay between each yield. Without per-yield
 * pacing, a drone fire-then-move turn would leave the muzzle flash stranded
 * on the tile the drone had just vacated; with it, each yield is its own
 * visible frame.
 *
 * Pulled out of `index.js` so the state machine is testable under
 * `node --test` (the shell is DOM-heavy and otherwise impossible to drive
 * from a pure test). The shell wires DOM-side concerns (paint, animLock,
 * setTimeout) through the `ctx` arg; this module is browser-free.
 *
 * Lifecycle contract:
 *
 *   - `runCorpTurn(ctx)` is the entry point. If the run is in a terminal
 *     state (RESULT), it bails *silently and without calling onFinish* —
 *     there is no turn to advance for a dead/extracted run.
 *   - If no live corp entities are present (hub, or every drone cleared),
 *     `onFinish` fires immediately and synchronously. This is the case
 *     the M0 user-reported bug missed: the previous shell guarded the
 *     finish call with `state === COMBAT`, which dropped HUB on the floor
 *     and the turn queue stuck on CORP forever.
 *   - With live corp entities, the driver yields one action per pump,
 *     calling `paint`, pushing the lock, and `schedule`'ing the next pump
 *     `actionDelayMs` later. When every generator drains, `onFinish` fires.
 *   - On every pump entry the driver re-checks the terminal-state gate.
 *     That covers "player flatlined inside a drone's killing shot" — the
 *     enterResult transition runs synchronously inside the yield, so by
 *     the next pump tick we can detect it and stop pumping rather than
 *     racing the result screen.
 *
 * Run states in `TERMINAL_STATES` mean "the run is over" — the driver bails on
 * those without firing `onFinish`. The set is module-internal so a
 * misbehaving caller can't mutate it; the exported predicate is the only
 * public surface.
 */

const TERMINAL_STATES = Object.freeze(new Set(['RESULT']));

export function isCorpTurnTerminal(state: string): boolean {
  return TERMINAL_STATES.has(state);
}

const defaultSchedule = (fn: () => void, ms: number) => setTimeout(fn, ms);

/**
 * Kick off a corp turn. See the module docstring for the lifecycle.
 *
 * @param {object} ctx
 * @param {{ state: string, world: { entities: Map<any, any> }, rng: any }} ctx.run
 *   The Run-like object the shell holds. Only the listed fields are read.
 * @param {string} ctx.corpFaction
 *   Faction identifier — only entities matching this faction are stepped.
 * @param {() => void} ctx.paint
 *   Repaint the visible frame. Called once per yielded action.
 * @param {{ push: (ms: number) => void }} ctx.animLock
 *   The input lock. Extended on every yielded action to cover the gap
 *   until the next pump (+ a margin so a tight setTimeout doesn't race).
 * @param {number} ctx.actionDelayMs
 *   Wall-clock ms between yielded actions. Pacing knob.
 * @param {number} ctx.lockMarginMs
 *   Extra lock duration beyond `actionDelayMs` — typically the muzzle-flash
 *   duration so a fired-then-move drone's flash decays before the next yield.
 * @param {() => void} ctx.onFinish
 *   Called when every generator drains. The shell wires this to
 *   `run.queue.endTurn(world); recomputeVision(); paint();`.
 * @param {(fn: () => void, ms: number) => void} [ctx.schedule]
 *   Defaults to `setTimeout`. Injectable for tests.
 */
export function runCorpTurn(ctx: unknown): void {
  validateCtx(ctx);
  const c = ctx as CorpTurnDriverCtx;
  const { run, corpFaction, onFinish } = c;
  if (TERMINAL_STATES.has(run.state)) return;

  const steppers: TurnActionSteps[] = [];
  for (const e of run.world.entities.values()) {
    if (!e.alive || e.faction !== corpFaction) continue;
    if (typeof e.takeTurnSteps === 'function') {
      steppers.push(e.takeTurnSteps(run.world, run.rng));
    } else if (typeof e.takeTurn === 'function') {
      // Non-step-aware corp entities (none today, but keeps the seam open
      // for future static threats / camera-only AIs). Burn their turn
      // synchronously since they don't yield a pacing signal.
      e.takeTurn(run.world, run.rng);
    }
  }
  if (steppers.length === 0) {
    onFinish();
    return;
  }
  pump(c, steppers, 0);
}

function pump(ctx: CorpTurnDriverCtx, steppers: TurnActionSteps[], startIdx: number): void {
  const {
    run,
    paint,
    animLock,
    actionDelayMs,
    lockMarginMs,
    onFinish,
    schedule = defaultSchedule,
  } = ctx;
  if (TERMINAL_STATES.has(run.state)) return;
  let idx = startIdx;
  while (idx < steppers.length) {
    const result = steppers[idx].next();
    if (result.done) {
      idx++;
      continue;
    }
    paint();
    animLock.push(actionDelayMs + lockMarginMs);
    schedule(() => pump(ctx, steppers, idx), actionDelayMs);
    return;
  }
  onFinish();
}

function validateCtx(ctx: unknown): void {
  if (!ctx || typeof ctx !== 'object') {
    throw new TypeError('runCorpTurn: ctx must be an object');
  }
  const o = ctx as CorpTurnDriverCtx;
  if (!o.run || typeof o.run.state !== 'string') {
    throw new TypeError('runCorpTurn: ctx.run.state must be a string');
  }
  if (!o.run.world || typeof o.run.world.entities?.values !== 'function') {
    throw new TypeError('runCorpTurn: ctx.run.world.entities must be iterable via .values()');
  }
  if (typeof o.corpFaction !== 'string' || o.corpFaction.length === 0) {
    throw new TypeError('runCorpTurn: ctx.corpFaction must be a non-empty string');
  }
  if (typeof o.paint !== 'function') {
    throw new TypeError('runCorpTurn: ctx.paint must be a function');
  }
  if (!o.animLock || typeof o.animLock.push !== 'function') {
    throw new TypeError('runCorpTurn: ctx.animLock must expose push(ms)');
  }
  if (!Number.isFinite(o.actionDelayMs) || o.actionDelayMs < 0) {
    throw new RangeError('runCorpTurn: ctx.actionDelayMs must be a non-negative number');
  }
  if (!Number.isFinite(o.lockMarginMs) || o.lockMarginMs < 0) {
    throw new RangeError('runCorpTurn: ctx.lockMarginMs must be a non-negative number');
  }
  if (typeof o.onFinish !== 'function') {
    throw new TypeError('runCorpTurn: ctx.onFinish must be a function');
  }
  if (o.schedule !== undefined && typeof o.schedule !== 'function') {
    throw new TypeError('runCorpTurn: ctx.schedule must be a function when supplied');
  }
}
