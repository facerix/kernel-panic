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
 */

/**
 * Run states that mean "the run is over" — the driver bails on these
 * without firing `onFinish`. Module-internal so a misbehaving caller can't
 * mutate the set out from under the driver (and have every COMBAT corp turn
 * silently skip). The exported predicate is the only public surface.
 */
const TERMINAL_STATES = Object.freeze(new Set(['RESULT']));

export function isCorpTurnTerminal(state) {
  return TERMINAL_STATES.has(state);
}

const defaultSchedule = (fn, ms) => setTimeout(fn, ms);

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
export function runCorpTurn(ctx) {
  validateCtx(ctx);
  const { run, corpFaction, onFinish } = ctx;
  if (TERMINAL_STATES.has(run.state)) return;

  /** @type {Generator<object>[]} */
  const steppers = [];
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
  pump(ctx, steppers, 0);
}

function pump(ctx, steppers, startIdx) {
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

function validateCtx(ctx) {
  if (!ctx || typeof ctx !== 'object') {
    throw new TypeError('runCorpTurn: ctx must be an object');
  }
  if (!ctx.run || typeof ctx.run.state !== 'string') {
    throw new TypeError('runCorpTurn: ctx.run.state must be a string');
  }
  if (!ctx.run.world || typeof ctx.run.world.entities?.values !== 'function') {
    throw new TypeError('runCorpTurn: ctx.run.world.entities must be iterable via .values()');
  }
  if (typeof ctx.corpFaction !== 'string' || ctx.corpFaction.length === 0) {
    throw new TypeError('runCorpTurn: ctx.corpFaction must be a non-empty string');
  }
  if (typeof ctx.paint !== 'function') {
    throw new TypeError('runCorpTurn: ctx.paint must be a function');
  }
  if (!ctx.animLock || typeof ctx.animLock.push !== 'function') {
    throw new TypeError('runCorpTurn: ctx.animLock must expose push(ms)');
  }
  if (!Number.isFinite(ctx.actionDelayMs) || ctx.actionDelayMs < 0) {
    throw new RangeError('runCorpTurn: ctx.actionDelayMs must be a non-negative number');
  }
  if (!Number.isFinite(ctx.lockMarginMs) || ctx.lockMarginMs < 0) {
    throw new RangeError('runCorpTurn: ctx.lockMarginMs must be a non-negative number');
  }
  if (typeof ctx.onFinish !== 'function') {
    throw new TypeError('runCorpTurn: ctx.onFinish must be a function');
  }
  if (ctx.schedule !== undefined && typeof ctx.schedule !== 'function') {
    throw new TypeError('runCorpTurn: ctx.schedule must be a function when supplied');
  }
}
