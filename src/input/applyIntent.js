/**
 * Shared intent applier — the single piece of game-loop glue that turns the
 * keymap/touchpad's intent objects into world mutations. Both the M7 debug
 * harness and the M8 game shell drive their input through this module so a
 * change to combat or movement plumbing only has one consumer to update.
 *
 * The intent shape is the closed enum the keymap dispatch produces:
 *   { type: 'move' | 'special' | 'melee' | 'fire' | 'interact' | 'end-turn'
 *         | 'cancel', dx?, dy? }
 *
 * The archetype-specific perks (Merc's Vault, Razor's Slide, Tech's Deploy
 * Turret) collapse into a single `special` intent at the keymap layer. The
 * `doSpecial` dispatcher below routes it to the right verb based on which
 * methods the active player class exposes — `canVault` → vault, `canSlide` →
 * slide, `canDeploy` → deploy. This keeps the input surface symmetric across
 * archetypes (one key, one touch button) and stays out of the player's way:
 * the keymap doesn't need to know which class is in play, and the intent
 * dispatcher doesn't need an explicit archetype switch.
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
  'special',
  'melee',
  'fire',
  'interact',
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
    log('> NOT YOUR TURN — press . to wait.');
    return;
  }

  switch (intent.type) {
    case 'move':
      return doMove(intent, ctx);
    case 'special':
      return doSpecial(intent, ctx);
    case 'melee':
      return doMelee(intent, ctx);
    case 'fire':
      return doFire(intent, ctx);
    case 'interact':
      return doInteract(ctx);
    case 'end-turn': {
      const apBefore = player.ap;
      log(`> @ waits (drops ${apBefore} AP).`);
      player.ap = 0;
      advanceTurn();
      return;
    }
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

/**
 * Archetype dispatcher for the unified `special` intent. Picks the perk verb
 * by capability check on the live player:
 *   - `canDeploy` → Tech's Deploy Turret
 *   - `canVault`  → Merc's Vault
 *   - `canSlide`  → Razor's Slide
 *
 * Capability sniffing (vs. a class `instanceof` check) keeps this module free
 * of the archetype-class imports — applyIntent stays a thin glue layer. A
 * player class that exposed both `canVault` and `canDeploy` would crash the
 * test suite, which is the failure mode we want if a future archetype
 * stacks perks ambiguously.
 *
 * If the player class has no perk method, we log a legibility message rather
 * than silently dropping the press; same shape as the old "only the Merc can
 * vault" guard.
 */
function doSpecial(intent, ctx) {
  const { player, log } = ctx;
  // The dispatch order is fixed (deploy before vault before slide) so an
  // archetype mix-up surfaces here rather than silently picking the wrong
  // perk. Only Tech exposes canDeploy in M1; only Merc exposes canVault;
  // only Razor exposes canSlide.
  if (typeof player.canDeploy === 'function') {
    return doDeploy(intent, ctx);
  }
  if (typeof player.canVault === 'function') {
    return doVault(intent, ctx);
  }
  if (typeof player.canSlide === 'function') {
    return doSlide(intent, ctx);
  }
  log('> SPECIAL: this archetype has no perk action.');
}

function doDeploy(intent, ctx) {
  const { world, player, log, advanceTurn } = ctx;
  const check = player.canDeploy(world, intent.dx, intent.dy);
  if (!check.ok) {
    log(`> DEPLOY DENIED: ${check.reason}`);
    return;
  }
  const turret = player.deployTurret(world, intent.dx, intent.dy);
  log(`> @ deploys turret ${turret.id} at (${turret.x}, ${turret.y}) — ` + `${player.ap} AP left.`);
  if (player.ap === 0) {
    log('> AP EXHAUSTED — auto-ending turn.');
    advanceTurn();
  }
}

function doVault(intent, ctx) {
  const { world, player, rng, log, advanceTurn } = ctx;
  // `doSpecial` already gated this on `canVault`, so the method must exist;
  // we go straight into the legality check.
  const check = player.canVault(world, intent.dx, intent.dy);
  if (!check.ok) {
    log(`> VAULT DENIED: ${check.reason}`);
    return;
  }
  player.vault(world, intent.dx, intent.dy);

  // Vault-while-firing: attempt a free shot in the vault direction from the
  // landing position. The 3 AP vault cost covers both the hop and the shot
  // (blueprint: "Hop over cover while firing"). If no hostile is in the
  // vault direction, the vault still succeeds as a pure movement perk.
  const target = pickFireTarget(ctx, intent.dx, intent.dy);
  if (target) {
    const fireCheck = canFireRanged(world, player, target, { freeShot: true });
    if (fireCheck.ok) {
      const result = resolveRanged(world, player, target, rng, { freeShot: true });
      log(
        `> @ vaulted to (${player.x}, ${player.y}) and fires at ${target.id} — ` +
          `${result.hit ? 'HIT' : 'miss'} (roll ${result.roll.toFixed(2)} vs ${result.threshold.toFixed(2)}` +
          `${result.inCover ? ', cover' : ''}).` +
          (result.killed ? ` ${target.id.toUpperCase()} DOWN.` : '') +
          ` — ${player.ap} AP left.`
      );
      if (player.ap === 0) {
        log('> AP EXHAUSTED — auto-ending turn.');
        advanceTurn();
      }
      return;
    }
  }

  log(`> @ vaulted to (${player.x}, ${player.y}) — ${player.ap} AP left.`);
  if (player.ap === 0) {
    log('> AP EXHAUSTED — auto-ending turn.');
    advanceTurn();
  }
}

function doSlide(intent, ctx) {
  const { world, player, log, advanceTurn } = ctx;
  // `doSpecial` already gated this on `canSlide`, so the method must exist;
  // we go straight into the legality check.
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
