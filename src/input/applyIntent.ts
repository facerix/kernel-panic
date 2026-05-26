/**
 * Shared intent applier — the single piece of game-loop glue that turns the
 * keymap/touchpad's intent objects into world mutations. Both the M7 debug
 * harness and the M8 game shell drive their input through this module so a
 * change to combat or movement plumbing only has one consumer to update.
 *
 * The intent shape is the closed enum the keymap / touch layer and other
 * callers may produce:
 *   { type: 'move' | 'special' | 'melee' | 'fire' | 'interact' | 'end-turn'
 *         | 'cancel', dx?, dy? }
 *
 * `move` into an occupied tile is resolved in `doMove`: a corp (or any
 * non-allied, non-neutral) neighbour is a bump-melee; same-faction or neutral
 * (Hub NPCs, …) delegates to the shell via `interact` without spending move AP.
 *
 * The dedicated `melee` intent is **not** emitted by the player keymap (bump
 * uses `move`); it stays in the enum so AI drivers, replay, tests, and future
 * automation can commit a melee strike without synthesizing a walk intent.
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

import { FACTION, SIGHT_RANGE, VAULT_DAMAGE, NOISE_RADIUS, AP_COST } from '../game/constants.js';
import { totalSalvage, formatSalvageCompact } from '../game/salvage.js';
import { canFireRanged, resolveRanged, canMelee, resolveMelee } from '../game/Combat.js';
import { hasLineOfSight, withinRange } from '../game/LineOfSight.js';
import { entityLabel } from '../game/Entity.js';
import { EVENT } from '../game/events.js';
import { TILE } from '../game/constants.js';
import type { Archetype } from '../game/archetypes/index.js';
import type { World } from '../game/World.js';
import type { TurnQueue } from '../game/TurnQueue.js';
import type { Rng } from '../rng.js';
import type { Tech } from '../game/archetypes/Tech.js';
import type { Merc } from '../game/archetypes/Merc.js';
import type { Razor } from '../game/archetypes/Razor.js';

export type Intent = {
  type: string;
  dx?: number;
  dy?: number;
};

export type ApplyIntentContext = {
  world: World;
  player: Archetype;
  queue: TurnQueue;
  rng: Rng;
  log: (line: string) => void;
  advanceTurn: () => void;
  resetInputModes: () => void;
  onPlayerAction: (actionName: string) => void;
  canExit?: () => boolean;
  exitBlockedMessage?: () => string;
};

const KNOWN_INTENT_TYPES = new Set([
  'move',
  'special',
  'melee',
  'fire',
  'interact',
  'inventory',
  'end-turn',
  'cancel',
]);

/*
  Player actions aren't quite intents, nor are they world events.
  They are a way to communicate actions from the game loop to the UI layer.
*/
export const PLAYER_ACTIONS = Object.freeze({
  REACHED_EXIT: 'movedToExit',
  INVENTORY: 'inventory',
  INTERACT: 'interact',
});

function gateOnApExhausted(ctx: ApplyIntentContext) {
  const { player, advanceTurn } = ctx;
  if (player.ap === 0) {
    advanceTurn();
  }
}

/**
 * Drive a single player intent against the world. Auto-ends the player's
 * turn when their AP hits zero — consistent with the M3 harness behaviour.
 */
export function applyIntent(intent: Intent, ctx: ApplyIntentContext) {
  if (!intent || typeof intent !== 'object' || !KNOWN_INTENT_TYPES.has(intent.type)) {
    throw new Error(`applyIntent: unknown intent type "${intent?.type}"`);
  }
  const { player, queue, log, advanceTurn, resetInputModes } = ctx;

  if (queue.currentFaction !== FACTION.PLAYER && intent.type !== 'cancel') {
    log('> CORP TURN — controls locked until security finishes.');
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
    case 'inventory':
      return doInventory(ctx);
    case 'end-turn': {
      const apBefore = player.ap;
      log(`> ${entityLabel(player)} waits (drops ${apBefore} AP).`);
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
 */
export function pickFireTarget(ctx: ApplyIntentContext, dx: number, dy: number) {
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

function doMove(intent: Intent, ctx: ApplyIntentContext) {
  const { world, player, log } = ctx;
  const nx = player.x + (intent?.dx ?? 0);
  const ny = player.y + (intent?.dy ?? 0);
  const occupant = world.entityAt(nx, ny);
  if (occupant) {
    if (occupant.faction === FACTION.NEUTRAL || occupant.faction === player.faction) {
      return doInteract(ctx);
    }
    return doMelee({ type: 'melee', dx: intent.dx, dy: intent.dy }, ctx);
  }
  const check = world.canMoveEntity(player, intent.dx!, intent.dy!);
  if (!check.ok) {
    log(`> MOVE DENIED: ${check.reason}`);
    return;
  }
  world.moveEntity(player, intent.dx!, intent.dy!);
  if (world.grid.tileAt(nx, ny) === TILE.EXIT) {
    if (ctx.canExit && !ctx.canExit()) {
      log(`> ${ctx.exitBlockedMessage?.() ?? 'Complete your objective before extraction.'}`);
      gateOnApExhausted(ctx);
      return;
    }
    log(`> ${entityLabel(player)} moved to (${nx}, ${ny}) — EXIT REACHED.`);
    ctx.onPlayerAction(PLAYER_ACTIONS.REACHED_EXIT);
    return;
  } else {
    // just clear the line to flush any existing stale log line
    log('');
  }
  // M4.1: stepping onto a lootable corpse auto-salvages it. Parallels the
  // walk-onto-tile pattern that M4.3 consumable pickups will use. If the
  // player can't afford the INTERACT AP we leave the corpse for next turn
  // (Space-interact still works) — crashing here would punish a legitimate
  // gameplay state, not a bug.
  const corpse =
    player.inventory && player.alive ? world.lootableCorpseAt(player.x, player.y) : null;
  if (corpse) {
    if (player.canAfford(AP_COST.INTERACT)) {
      // M4.2: typed salvage. Show the picked-up total + the wallet's
      // post-pickup compact breakdown so the player sees both the immediate
      // delta and the running typed total.
      const amount = totalSalvage(corpse.loot!.salvage);
      player.collectSalvage(world, corpse);
      log(
        `> ${entityLabel(player)} salvages +${amount} — carrying ${formatSalvageCompact(player.inventory!.salvage)}, ${player.ap} AP left.`
      );
    } else {
      log(`> ${entityLabel(player)} stands on salvage — not enough AP to loot this turn.`);
    }
  }
  // Intentionally no per-step move line — coordinates + AP spammed the game log.
  gateOnApExhausted(ctx);
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
function doSpecial(intent: Intent, ctx: ApplyIntentContext) {
  const { player, log } = ctx;
  // The dispatch order is fixed (deploy before vault before slide) so an
  // archetype mix-up surfaces here rather than silently picking the wrong
  // perk. Only Tech exposes canDeploy in M1; only Merc exposes canVault;
  // only Razor exposes canSlide.
  if (typeof (player as Tech).canDeploy === 'function') {
    return doDeploy(intent, ctx);
  }
  if (typeof (player as Merc).canVault === 'function') {
    return doVault(intent, ctx);
  }
  if (typeof (player as Razor).canSlide === 'function') {
    return doSlide(intent, ctx);
  }
  log('> SPECIAL: this archetype has no perk action.');
}

function doDeploy(intent: Intent, ctx: ApplyIntentContext) {
  const { world, player, log } = ctx;
  const tech = player as Tech;
  const playerLabel = entityLabel(player);
  const check = tech.canDeploy(world, intent.dx!, intent.dy!);
  if (check?.ok) {
    const turret = tech.deployTurret(world, intent.dx!, intent.dy!);
    log(
      `> ${playerLabel} deploys ${entityLabel(turret)} at (${turret.x}, ${turret.y}) — ${player.ap} AP left.`
    );
    gateOnApExhausted(ctx);
    return;
  }
  // M3: if the pre-built turret is spent, try an improvised turret from salvage.
  if (check.reason === 'no-turret' && typeof tech.canImproviseTurret === 'function') {
    const impCheck = tech.canImproviseTurret(world, intent.dx!, intent.dy!);
    if (impCheck.ok) {
      const turret = tech.improviseTurret(world, intent.dx!, intent.dy!);
      log(
        `> ${playerLabel} improvises ${entityLabel(turret)} at (${turret.x}, ${turret.y}) — ` +
          `${player.inventory!.salvage.scrap} scrap left, ${player.ap} AP left.`
      );
      gateOnApExhausted(ctx);
      return;
    }
    // Fall through to the original deny — surface the most helpful reason.
    log(`> DEPLOY DENIED: ${impCheck.reason}`);
    return;
  }
  log(`> DEPLOY DENIED: ${check.reason}`);
}

function doVault(intent: Intent, ctx: ApplyIntentContext) {
  const { world, player, log } = ctx;
  const merc = player as Merc;
  const playerLabel = entityLabel(player);
  const check = merc.canVault(world, intent.dx!, intent.dy!);
  if (!check?.ok) {
    log(`> ${playerLabel} VAULT DENIED: ${check?.reason}`);
    return;
  }

  // vault() handles the hop, knockback displacement, and AP debit.
  // It returns the occupant (if any) so we can apply damage here — keeping
  // Combat event wiring in the intent layer, not inside the archetype.
  const { occupant } = merc.vault(world, intent.dx!, intent.dy!);

  if (occupant) {
    // Body-check: guaranteed hit, VAULT_DAMAGE, no RNG roll.
    occupant.damage(VAULT_DAMAGE);
    const killed = !occupant.alive;
    world.events?.emit(EVENT.ENTITY_DAMAGED, {
      attacker: player,
      target: occupant,
      damage: VAULT_DAMAGE,
      killed,
      source: 'vault',
    });
    // A charging slam is loud — same noise radius as melee.
    world.events?.emit(EVENT.NOISE, {
      origin: { x: player.x, y: player.y },
      radius: NOISE_RADIUS.MELEE,
      source: player,
      kind: 'vault',
    });
    log(
      `> ${playerLabel} vaulted to (${player.x}, ${player.y}) — SLAMMED ${entityLabel(occupant)} for ${VAULT_DAMAGE} damage!` +
        (killed ? ` ${entityLabel(occupant).toUpperCase()} DOWN.` : '') +
        ` — ${player.ap} AP left.`
    );
  } else {
    log(`> ${playerLabel} vaulted to (${player.x}, ${player.y}) — ${player.ap} AP left.`);
  }

  gateOnApExhausted(ctx);
}

function doSlide(intent: Intent, ctx: ApplyIntentContext) {
  const { world, player, log } = ctx;
  const razor = player as Razor;
  const playerLabel = entityLabel(player);
  // `doSpecial` already gated this on `canSlide`, so the method must exist;
  // we go straight into the legality check.
  const check = razor.canSlide(world, intent.dx!, intent.dy!);
  if (!check.ok) {
    log(`> ${playerLabel} SLIDE DENIED: ${check.reason}`);
    return;
  }
  razor.slide(world, intent.dx!, intent.dy!);
  log(
    `> ${playerLabel} slid to (${player.x}, ${player.y}) — CLOAKED until next turn (` +
      `${player.ap} AP left).`
  );
  gateOnApExhausted(ctx);
}

function doMelee(intent: Intent, ctx: ApplyIntentContext) {
  const { world, player, log } = ctx;
  const target = world.entityAt(player.x + intent.dx!, player.y + intent.dy!);
  if (!target) {
    log('> MELEE: no target on that tile.');
    return;
  }
  const check = canMelee(world, player, target);
  if (!check.ok) {
    log(`> MELEE DENIED: ${check.reason}`);
    return;
  }
  const result = resolveMelee(world, player, target, ctx.rng);
  if (result.dodged) {
    log(
      `> ${entityLabel(player)} slashes at ${entityLabel(target)} — DODGED ` +
        `(roll ${result.roll.toFixed(2)} vs ${result.dodgeThreshold.toFixed(2)}` +
        `${result.inCover ? ', cover' : ''}).`
    );
  } else {
    log(
      `> ${entityLabel(player)} slashes ${entityLabel(target)} for ${result.damage}` +
        (result.killed ? ` — ${entityLabel(target).toUpperCase()} DOWN.` : '.')
    );
  }
  gateOnApExhausted(ctx);
}

function doInteract(ctx: ApplyIntentContext) {
  // Interact is the universal "use the thing in front of me" verb. The shape
  // of "the thing" depends on Run.state (Hub: Curator → briefing; future
  // combat terminals → unlock doors / hack), so applyIntent doesn't know the
  // semantics — it just routes the intent to a shell-supplied handler. Crash
  // rather than silent no-op if the shell forgot to provide one; otherwise an
  // unbound interact key would feel like a dead button instead of a wiring bug.
  if (typeof ctx.onPlayerAction !== 'function') {
    throw new Error('applyIntent: interact intent received but ctx.onPlayerAction is missing');
  }
  ctx.onPlayerAction(PLAYER_ACTIONS.INTERACT);
}

function doInventory(ctx: ApplyIntentContext) {
  // Inventory is a UI-layer verb — the shell presents the consumable list
  // and handles the `use-item` event. Same delegation pattern as `interact`.
  if (typeof ctx.onPlayerAction !== 'function') {
    throw new Error('applyIntent: inventory intent received but ctx.onPlayerAction is missing');
  }
  ctx.onPlayerAction(PLAYER_ACTIONS.INVENTORY);
}

function doFire(intent: Intent, ctx: ApplyIntentContext) {
  const { world, player, rng, log } = ctx;
  const target = pickFireTarget(ctx, intent.dx!, intent.dy!);
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
    `> ${entityLabel(player)} fires at ${entityLabel(target)} — ` +
      `${result.hit ? 'HIT' : 'miss'} (roll ${result.roll.toFixed(2)} vs ${result.threshold.toFixed(2)}` +
      `${result.inCover ? ', cover' : ''}).` +
      (result.killed ? ` ${entityLabel(target).toUpperCase()} DOWN.` : '')
  );
  gateOnApExhausted(ctx);
}
