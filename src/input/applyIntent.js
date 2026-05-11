/**
 * Shared intent applier — the single piece of game-loop glue that turns the
 * keymap/touchpad's intent objects into world mutations. Both the M7 debug
 * harness and the M8 game shell drive their input through this module so a
 * change to combat or movement plumbing only has one consumer to update.
 *
 * The intent shape is the closed enum the keymap dispatch produces:
 *   { type: 'move' | 'vault' | 'slide' | 'melee' | 'fire' | 'wait'
 *         | 'end-turn' | 'cancel', dx?, dy? }
 *
 * The function is pure-ish: it mutates `ctx.world` / `ctx.player` /
 * `ctx.queue` and emits log lines via `ctx.log`, but doesn't touch the DOM.
 * Returning `void` keeps the seam tiny — outcome is observable through
 * mutated state and the log feed.
 *
 * Crashes loudly on:
 *   - intents whose `type` we don't recognise (closed enum, like the bus)
 *   - acting out of turn unless the intent is 'cancel'
 *
 * Silent fallbacks here would mask either an input-wiring bug or a stale
 * harness assumption.
 */

import { FACTION, SIGHT_RANGE } from '../game/constants.js';
import { canFireRanged, resolveRanged, canMelee, resolveMelee } from '../game/Combat.js';
import { hasLineOfSight, withinRange } from '../game/LineOfSight.js';

/**
 * @typedef {{
 *   world: import('../game/World.js').World,
 *   player: import('../game/Entity.js').Entity,
 *   queue: import('../game/TurnQueue.js').TurnQueue,
 *   rng: import('../rng.js').Rng,
 *   log: (line: string) => void,
 *   advanceTurn: () => void,
 *   resetInputModes: () => void,
 * }} ApplyIntentContext
 */

const KNOWN_INTENT_TYPES = new Set([
  'move',
  'vault',
  'slide',
  'melee',
  'fire',
  'interact',
  'wait',
  'end-turn',
  'cancel',
]);

/**
 * Drive a single player intent against the world. Auto-ends the player's
 * turn when their AP hits zero — consistent with the M3 harness behaviour.
 *
 * @param {{ type: string, dx?: number, dy?: number }} intent
 * @param {ApplyIntentContext} ctx
 */
export function applyIntent(intent, ctx) {
  if (!intent || typeof intent !== 'object' || !KNOWN_INTENT_TYPES.has(intent.type)) {
    throw new Error(`applyIntent: unknown intent type "${intent?.type}"`);
  }
  const { player, queue, log, advanceTurn, resetInputModes } = ctx;

  if (queue.currentFaction !== FACTION.PLAYER && intent.type !== 'cancel') {
    log('> NOT YOUR TURN — press space.');
    return;
  }

  switch (intent.type) {
    case 'move':
      return doMove(intent, ctx);
    case 'vault':
      return doVault(intent, ctx);
    case 'slide':
      return doSlide(intent, ctx);
    case 'melee':
      return doMelee(intent, ctx);
    case 'fire':
      return doFire(intent, ctx);
    case 'interact':
      return doInteract(ctx);
    case 'wait':
      log(`> @ holds position (drops ${player.ap} AP).`);
      player.ap = 0;
      advanceTurn();
      return;
    case 'end-turn':
      advanceTurn();
      return;
    case 'cancel':
      // Cancel is the universal "stop aiming" — clear *both* input
      // controllers (keyboard + touch) so an Esc/CANCEL from either side
      // wipes any aim mode the other side was holding.
      resetInputModes();
      log('> ACTION CANCELLED.');
      return;
    default:
      // Unreachable — KNOWN_INTENT_TYPES gate already covered every case.
      throw new Error(`applyIntent: unhandled intent "${intent.type}"`);
  }
}

/**
 * Walk along (dx, dy) from the player and return the first hostile that's
 * inside the Combat-enforced range and visible — same geometry Combat uses,
 * so the picker can never offer a target the resolver would later reject.
 *
 * @param {ApplyIntentContext} ctx
 * @param {number} dx
 * @param {number} dy
 */
export function pickFireTarget(ctx, dx, dy) {
  const { world, player } = ctx;
  const blockers = world.blockerKeys();
  for (let step = 1; step <= SIGHT_RANGE; step++) {
    const x = player.x + dx * step;
    const y = player.y + dy * step;
    if (!world.grid.inBounds(x, y)) return null;
    if (!withinRange(player.x, player.y, x, y, SIGHT_RANGE)) return null;
    if (!hasLineOfSight(world.grid, player.x, player.y, x, y, { blockers })) return null;
    const e = world.entityAt(x, y);
    if (e && e.faction !== player.faction) return e;
  }
  return null;
}

// ---------------------------------------------------------------------------

function doMove(intent, ctx) {
  const { world, player, log, advanceTurn } = ctx;
  const check = world.canMoveEntity(player, intent.dx, intent.dy);
  if (!check.ok) {
    log(`> MOVE DENIED: ${check.reason}`);
    return;
  }
  world.moveEntity(player, intent.dx, intent.dy);
  log(`> @ moved to (${player.x}, ${player.y}) — ${player.ap} AP left.`);
  if (player.ap === 0) {
    log('> AP EXHAUSTED — auto-ending turn.');
    advanceTurn();
  }
}

function doVault(intent, ctx) {
  const { world, player, log, advanceTurn } = ctx;
  if (typeof player.canVault !== 'function') {
    log('> VAULT: only the Merc can vault.');
    return;
  }
  const check = player.canVault(world, intent.dx, intent.dy);
  if (!check.ok) {
    log(`> VAULT DENIED: ${check.reason}`);
    return;
  }
  player.vault(world, intent.dx, intent.dy);
  log(`> @ vaulted to (${player.x}, ${player.y}) — ${player.ap} AP left.`);
  if (player.ap === 0) {
    log('> AP EXHAUSTED — auto-ending turn.');
    advanceTurn();
  }
}

function doSlide(intent, ctx) {
  const { world, player, log, advanceTurn } = ctx;
  if (typeof player.canSlide !== 'function') {
    log('> SLIDE: only the Razor can slide.');
    return;
  }
  const check = player.canSlide(world, intent.dx, intent.dy);
  if (!check.ok) {
    log(`> SLIDE DENIED: ${check.reason}`);
    return;
  }
  player.slide(world, intent.dx, intent.dy);
  log(
    `> @ slid to (${player.x}, ${player.y}) — CLOAKED until next turn (` + `${player.ap} AP left).`
  );
  if (player.ap === 0) {
    log('> AP EXHAUSTED — auto-ending turn.');
    advanceTurn();
  }
}

function doMelee(intent, ctx) {
  const { world, player, log, advanceTurn } = ctx;
  const target = world.entityAt(player.x + intent.dx, player.y + intent.dy);
  if (!target) {
    log('> MELEE: no target on that tile.');
    return;
  }
  const check = canMelee(world, player, target);
  if (!check.ok) {
    log(`> MELEE DENIED: ${check.reason}`);
    return;
  }
  const result = resolveMelee(world, player, target);
  log(
    `> @ slashes ${target.id} for ${result.damage}` +
      (result.killed ? ` — ${target.id.toUpperCase()} DOWN.` : '.')
  );
  if (player.ap === 0) {
    log('> AP EXHAUSTED — auto-ending turn.');
    advanceTurn();
  }
}

function doInteract(ctx) {
  // Interact is the universal "use the thing in front of me" verb. The shape
  // of "the thing" depends on Run.state (Hub: Curator → briefing; future
  // combat terminals → unlock doors / hack), so applyIntent doesn't know the
  // semantics — it just routes the intent to a shell-supplied handler. Crash
  // rather than silent no-op if the shell forgot to provide one; otherwise an
  // unbound `i` key would feel like a dead button instead of a wiring bug.
  if (typeof ctx.onInteract !== 'function') {
    throw new Error('applyIntent: interact intent received but ctx.onInteract is missing');
  }
  ctx.onInteract();
}

function doFire(intent, ctx) {
  const { world, player, rng, log, advanceTurn } = ctx;
  const target = pickFireTarget(ctx, intent.dx, intent.dy);
  if (!target) {
    log('> FIRE: no hostile in that direction.');
    return;
  }
  const check = canFireRanged(world, player, target);
  if (!check.ok) {
    log(`> FIRE DENIED: ${check.reason}`);
    return;
  }
  const result = resolveRanged(world, player, target, rng);
  log(
    `> @ fires at ${target.id} — ` +
      `${result.hit ? 'HIT' : 'miss'} (roll ${result.roll.toFixed(2)} vs ${result.threshold.toFixed(2)}` +
      `${result.inCover ? ', cover' : ''}).` +
      (result.killed ? ` ${target.id.toUpperCase()} DOWN.` : '')
  );
  if (player.ap === 0) {
    log('> AP EXHAUSTED — auto-ending turn.');
    advanceTurn();
  }
}
