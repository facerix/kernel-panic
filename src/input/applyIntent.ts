/**
 * Shared intent applier — the single piece of game-loop glue that turns the
 * keymap/touchpad's intent objects into world mutations. Both the debug
 * harness and the game shell drive their input through this module so a
 * change to combat or movement plumbing only has one consumer to update.
 *
 * The intent shape is the closed enum the keymap / touch layer and other
 * callers may produce:
 *   { type: 'move' | 'special' | 'melee' | 'fire' | 'interact' | 'jack-out'
 *         | 'end-turn' | 'cancel', dx?, dy? }
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
 * Turret, Decker's EMP, Berserk's Surge, Adept's Influence, Chimera's Nanite
 * Repair, the CyberAvatar's cyber-grid Override) collapse into a single
 * `special` intent at the keymap layer. The `doSpecial` dispatcher below
 * routes it to the right verb based on which methods the active player class
 * exposes — `canVault` → vault, `canSlide` → slide, `canDeploy` → deploy,
 * `canEmp` → EMP, `canSurge` → surge, `canInfluence` → influence (the Adept
 * resolves the nearest visible hostile in the aimed eight-way sector),
 * `canConvertScrap` → Nanite Repair, `canOverride` → override (same picker,
 * cyber grid only). This keeps the input surface symmetric across archetypes
 * (one key, one touch button) and stays out of the player's way: the keymap
 * doesn't need to know which class is in play, and the intent dispatcher
 * doesn't need an explicit archetype switch.
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

import {
  FACTION,
  SIGHT_RANGE,
  VAULT_DAMAGE,
  NOISE_RADIUS,
  INFLUENCE_RANGE,
} from '../game/constants.js';
import { totalSalvage, formatSalvageCompact } from '../game/salvage.js';
import { canFireRanged, resolveRanged, canMelee, resolveMelee } from '../game/Combat.js';
import { isConcealedFromPlayer } from '../game/playerPerception.js';
import { hasLineOfSight, withinRange } from '../game/LineOfSight.js';
import { entityLabel } from '../game/Entity.js';
import { Interactable } from '../game/entities/Interactable.js';
import { Door } from '../game/entities/Door.js';
import { DenyTarget } from '../game/entities/DenyTarget.js';
import { EVENT } from '../game/events.js';
import { TILE } from '../game/constants.js';
import { Hostile } from '../game/Hostile.js';
import type { KeyItem } from '../types.js';
import type { Archetype } from '../game/archetypes/index.js';
import type { CyberAvatar } from '../game/cyber/CyberAvatar.js';
import type { Entity } from '../game/Entity.js';
import type { World } from '../game/World.js';
import type { TurnQueue } from '../game/TurnQueue.js';
import type { Rng } from '../rng.js';
import type { Tech } from '../game/archetypes/Tech.js';
import type { Merc } from '../game/archetypes/Merc.js';
import type { Razor } from '../game/archetypes/Razor.js';
import type { Decker } from '../game/archetypes/Decker.js';
import type { Berserk } from '../game/archetypes/Berserk.js';
import type { Adept } from '../game/archetypes/Adept.js';
import type { Chimera } from '../game/archetypes/Chimera.js';

export type Intent = {
  type: string;
  dx?: number;
  dy?: number;
};

export type ApplyIntentContext = {
  world: World;
  /**
   * P3.M3.6: the acting body — a crew archetype in Meatspace, the
   * `CyberAvatar` on the grid. The avatar exposes Override but no inventory
   * capabilities, so loot and consumables retain their refusal paths.
   */
  player: Archetype | CyberAvatar;
  queue: TurnQueue;
  rng: Rng;
  log: (line: string) => void;
  advanceTurn: () => void;
  /**
   * P3.M4.4: resolve the active operator hitting 0 AP. With independent
   * dual-deploy AP pools, exhausting one operator must not end the mutual turn
   * while another still has AP — the shell auto-flips control instead, and only
   * ends (driving the hostile phases) once the whole crew is spent. Optional:
   * contexts that don't supply it fall back to the single-operator `advanceTurn`
   * (correct for solo/single-deploy, where there is nothing to flip to).
   */
  concludeTurn?: () => void;
  /**
   * P3.M4.4: resolve a Wait (`.`). Distinct from `concludeTurn`: Wait always
   * hands control to the other operator when one exists (a consistent
   * pass/switch gesture), ending the mutual turn additionally when the crew is
   * spent. Optional: without it (solo/single-deploy harness) Wait hard-ends via
   * `advanceTurn`.
   */
  passTurn?: () => void;
  resetInputModes: () => void;
  onPlayerAction: (actionName: string) => void;
  /**
   * Resolve a thrown consumable along the supplied aim direction.
   * The shell stashes the `pendingAimItemId` when the inventory overlay
   * confirmed an aimed consumable; this callback pairs that id with the
   * direction picked in `MODE.AIM` with `aimKind: 'use-item'`. Optional — harness tests that
   * never exercise thrown items can leave it unset, and `doUseItem` will
   * crash if a `use-item` intent arrives without a handler (loud wiring
   * error per the module docstring).
   */
  onUseItem?: (aim: { dx: number; dy: number }) => void;
  /** Called after looting removes a corpse — shell clears fog memory. */
  onCorpseSalvaged?: (entity: { x: number; y: number }) => void;
  /**
   * Called when the player walks onto a keycard pickup (P2.5.M6.2). The
   * shell routes based on `siteId`: campaign-scoped keycards (with siteId)
   * go to `Campaign.addKeyItem`; run-scoped keycards (no siteId) go to
   * `Run.addKeyItem`. The entity is removed from the world by
   * `collectTileLoot` itself.
   */
  onKeycardCollected?: (keycard: {
    id: string;
    doorId: string;
    label: string;
    principalId: string | null;
  }) => void;
  /**
   * Merged key-item inventory — campaign + run-scoped (P2.5.M6.2). Passed
   * to Door.interact so a matching keycard can unlock a locked door via
   * bump-interact. Optional — tests that don't exercise keycards can omit it.
   */
  keyItems?: KeyItem[];
  /**
   * Bump- or space-interact secured an objective prop (slice, sync, handoff,
   * escort). Shell paints the flash and may defer `advanceTurn` so the burst
   * survives the player→corp handoff.
   */
  onSecuredInteract?: (entity: Interactable, opts: { apExhausted: boolean }) => void;
};

const KNOWN_INTENT_TYPES = new Set([
  'move',
  'special',
  'melee',
  'fire',
  'interact',
  'inventory',
  'jack-out',
  'use-item',
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
  JACK_OUT: 'jack-out',
});

function gateOnApExhausted(ctx: ApplyIntentContext) {
  const { player, advanceTurn, concludeTurn } = ctx;
  if (player.ap !== 0) return;
  // P3.M4.4: defer the end-vs-auto-flip decision to the shell when wired;
  // otherwise fall back to a hard end (single-operator semantics).
  (concludeTurn ?? advanceTurn)();
}

function finishBumpInteract(
  ctx: ApplyIntentContext,
  entity: Interactable,
  result: { ok: boolean }
): void {
  if (!result.ok) return;
  if (entity.secured && entity.alive) {
    ctx.onSecuredInteract?.(entity, { apExhausted: ctx.player.ap === 0 });
    return;
  }
  gateOnApExhausted(ctx);
}

/**
 * Drive a single player intent against the world. Auto-ends the player's
 * turn when their AP hits zero.
 */
export function applyIntent(intent: Intent, ctx: ApplyIntentContext) {
  if (!intent || typeof intent !== 'object' || !KNOWN_INTENT_TYPES.has(intent.type)) {
    throw new Error(`applyIntent: unknown intent type "${intent?.type}"`);
  }
  const { player, queue, log, advanceTurn, resetInputModes } = ctx;

  if (queue.currentFaction !== FACTION.PLAYER && intent.type !== 'cancel') {
    log('> HOSTILES ACTIVE — controls locked.');
    return;
  }

  // P3.5.M1: a stunned (EMP'd) player-faction entity starts its turn at 0 AP.
  // Every action intent would immediately trip `Entity.spendAp`'s overspend
  // crash, since the AP-exhaustion gate normally ends the turn *before* the
  // player is handed an intent at exactly 0. Conclude the turn here instead —
  // same `concludeTurn ?? advanceTurn` fallback the exhaustion gate uses.
  // `end-turn` (Wait) and `cancel` already no-op cleanly at 0 AP.
  if (player.ap === 0 && intent.type !== 'end-turn' && intent.type !== 'cancel') {
    log(`> ${entityLabel(player)} is STUNNED — no AP this turn.`);
    (ctx.concludeTurn ?? advanceTurn)();
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
    case 'jack-out':
      return doJackOut(ctx);
    case 'use-item':
      return doUseItem(intent, ctx);
    case 'end-turn': {
      // P3.M4.4: Wait passes *this* operator — forfeit its remaining AP, then
      // hand control to the other operator if it can still act (auto-flip via
      // `concludeTurn`), ending the mutual turn only once the whole crew is
      // spent. Without a `concludeTurn` (solo/single-deploy harness) this is a
      // hard end, same as before.
      const apBefore = player.ap;
      log(`> ${entityLabel(player)} waits (drops ${apBefore} AP).`);
      player.ap = 0;
      (ctx.passTurn ?? advanceTurn)();
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
    if (e && e.faction !== player.faction) {
      if (isConcealedFromPlayer(e, player, world)) return null;
      return e;
    }
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
      if (occupant instanceof Interactable) {
        // Door.interact accepts keyItems (P2.5.M6.2) so a bump into a locked
        // door checks for a matching keycard in the campaign inventory.
        const result =
          occupant instanceof Door
            ? occupant.interact(world, player, ctx.keyItems)
            : occupant.interact(world, player);
        if (result.message) log(result.message);
        finishBumpInteract(ctx, occupant, result);
        return;
      }
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
    log(`> ${entityLabel(player)} moved to (${nx}, ${ny}) — EXIT REACHED.`);
    ctx.onPlayerAction(PLAYER_ACTIONS.REACHED_EXIT);
    return;
  } else {
    // just clear the line to flush any existing stale log line
    log('');
  }
  collectTileLoot(ctx);
  // Intentionally no per-step move line — coordinates + AP spammed the game log.
  gateOnApExhausted(ctx);
}

/**
 * Walk-onto loot for the player's current tile — objective pickups, consumable
 * pickups, and lootable corpses. Shared by normal moves, Vault, and Slide so
 * perk landings behave like stepping onto the tile.
 */
function collectTileLoot(ctx: ApplyIntentContext) {
  const { world, player, log } = ctx;
  const objectivePickup = player.alive ? world.objectivePickupAt(player.x, player.y) : null;
  if (objectivePickup) {
    const flavor = objectivePickup.detail;
    objectivePickup.secureWalkOnto(world);
    log(`> ${entityLabel(player)} secures ${objectivePickup.label}.`);
    // P3.M6.4: a Score blueprint carries a flavor beat — surface what was stolen.
    if (flavor) log(`> ${flavor}`);
  }
  // Capability sniff (P3.M3.6): the CyberAvatar carries no gear — pickups
  // stay on the tile for whoever has pockets.
  const consumablePickup =
    'addConsumable' in player && player.alive ? world.consumablePickupAt(player.x, player.y) : null;
  if (consumablePickup && 'addConsumable' in player) {
    player.addConsumable(consumablePickup.consumableId);
    world.removeEntity(consumablePickup.id);
    log(`> ${entityLabel(player)} picks up ${consumablePickup.label}.`);
  }
  // Walk-onto keycard collection (P2.5.M6.2). principalId determines scope:
  //   - principalId set → campaign-scoped (persists across runs)
  //   - no principalId  → run-scoped (discarded on run end)
  const keycard = player.alive ? world.keycardAt(player.x, player.y) : null;
  if (keycard) {
    world.removeEntity(keycard.id);
    ctx.onKeycardCollected?.({
      id: keycard.id,
      doorId: keycard.doorId,
      label: keycard.label,
      principalId: keycard.principalId,
    });
    log(`> ${entityLabel(player)} picks up ${keycard.label}.`);
  }
  const corpse =
    'inventory' in player && player.inventory && player.alive
      ? world.lootableCorpseAt(player.x, player.y)
      : null;
  if (corpse && 'inventory' in player) {
    const amount = totalSalvage(corpse.loot!.salvage);
    player.collectSalvage(world, corpse, { spendAp: false });
    ctx.onCorpseSalvaged?.(corpse);
    log(
      `> ${entityLabel(player)} salvages +${amount} — carrying ${formatSalvageCompact(player.inventory!.salvage)}, ${player.ap} AP left.`
    );
  }
}

/**
 * Archetype dispatcher for the unified `special` intent. Picks the perk verb
 * by capability check on the live player:
 *   - `canDeploy`    → Tech's Deploy Turret
 *   - `canVault`     → Merc's Vault
 *   - `canSlide`     → Razor's Slide
 *   - `canEmp`       → Decker's EMP neural-shock (self-centered AOE stun)
 *   - `canSurge`     → Berserk's Surge self-buff
 *   - `canInfluence` → Adept's Influence (Meatspace mind control)
 *   - `canConvertScrap` → Chimera's Nanite Repair (scrap-to-HP sustain)
 *   - `canOverride`  → CyberAvatar's ICE override (cyber grid only)
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
  // perk. Only Tech exposes canDeploy; only Merc exposes canVault; only
  // Razor exposes canSlide.
  if (typeof (player as Tech).canDeploy === 'function') {
    return doDeploy(intent, ctx);
  }
  if (typeof (player as Merc).canVault === 'function') {
    return doVault(intent, ctx);
  }
  if (typeof (player as Razor).canSlide === 'function') {
    return doSlide(intent, ctx);
  }
  if (typeof (player as Decker).canEmp === 'function') {
    return doEmp(ctx);
  }
  if (typeof (player as Berserk).canSurge === 'function') {
    return doSurge(ctx);
  }
  if (typeof (player as Adept).canInfluence === 'function') {
    return doInfluence(intent, ctx);
  }
  if (typeof (player as Chimera).canConvertScrap === 'function') {
    return doConvertScrap(ctx);
  }
  // Only the CyberAvatar still exposes canOverride (P3.5.M2 moved the Decker's
  // Meatspace perk to EMP; P3.5.M4 gave the Adept the renamed Influence perk
  // — the CyberAvatar keeps its own "Override" name/fiction for the cyber
  // grid, delegating to the same underlying mindInfluence.ts machinery).
  if (typeof (player as CyberAvatar).canOverride === 'function') {
    return doOverride(intent, ctx);
  }
  log('> SPECIAL: this archetype has no perk action.');
}

/** Trigger the Berserk's self-targeted Surge. */
function doSurge(ctx: ApplyIntentContext) {
  const { world, player, log } = ctx;
  const berserk = player as Berserk;
  const playerLabel = entityLabel(player);
  const check = berserk.canSurge();
  if (!check.ok) {
    log(`> ${playerLabel} SURGE DENIED: ${check.reason}`);
    return;
  }
  berserk.surge();
  log(`> ${playerLabel} SURGES — power spikes before the crash (${player.ap} AP left).`);
  // Presentation hook (P3.5.M3): the shell listens for this to pulse the surge
  // spike. Gameplay is already committed above — this carries no state.
  world.events?.emit(EVENT.BERSERK_SURGED, { origin: { x: player.x, y: player.y } });
  gateOnApExhausted(ctx);
}

/**
 * Trigger the Chimera's self-targeted Nanite Repair: convert scrap salvage
 * into HP. Log copy stays deliberately ambiguous about the mechanism (nanite
 * swarm vs. android self-repair) per the archetype's unresolved fiction.
 */
function doConvertScrap(ctx: ApplyIntentContext) {
  const { world, player, log } = ctx;
  const chimera = player as Chimera;
  const playerLabel = entityLabel(player);
  const check = chimera.canConvertScrap();
  if (!check.ok) {
    log(`> ${playerLabel} NANITE REPAIR DENIED: ${check.reason}`);
    return;
  }
  const healed = chimera.convertScrapToHp();
  log(
    `> ${playerLabel} converts scrap into tissue — +${healed} HP ` +
      `(${chimera.inventory!.salvage.scrap} scrap left, ${player.ap} AP left).`
  );
  // Presentation hook (P3.5.M5): the shell listens for this to pulse the
  // nanite-heal flash. Gameplay is already committed above — this carries
  // no state. Mirrors BERSERK_SURGED's shape exactly.
  world.events?.emit(EVENT.NANITE_HEALED, {
    origin: { x: player.x, y: player.y },
    healed,
  });
  gateOnApExhausted(ctx);
}

/**
 * Detonate the Decker's self-centered EMP: no aim, stuns everyone alive in
 * radius (friend, foe, and the Decker). Reports the stun count for legibility.
 */
function doEmp(ctx: ApplyIntentContext) {
  const { world, player, log } = ctx;
  const decker = player as Decker;
  const playerLabel = entityLabel(player);
  const check = decker.canEmp();
  if (!check.ok) {
    log(`> ${playerLabel} EMP DENIED: ${check.reason}`);
    return;
  }
  const { stunned } = decker.detonateEmp(world);
  log(
    `> ${playerLabel} detonates an EMP — ${stunned.length} caught in the blast ` +
      `(${player.ap} AP left).`
  );
  gateOnApExhausted(ctx);
}

/**
 * Acquire a hostile in the CyberAvatar's aimed eight-way sector and attempt
 * the ICE hijack. Range, LOS, and perception match the resolver and combat
 * targeting; a failed roll trips the alarm, while an empty sector yields a
 * legible deny. Shares `pickInfluenceTarget`/`isInAimSector` with the Adept's
 * `doInfluence` below — same picker, same underlying `mindInfluence.ts`
 * mechanic, different fiction (ICE vs. a hostile mind) and different method
 * names on the acting class.
 */
type OverrideActor = ApplyIntentContext['player'] & {
  canOverride(world: World, target: Entity | null): ReturnType<CyberAvatar['canOverride']>;
  overrideDrone(world: World, target: Entity, rng: Rng): ReturnType<CyberAvatar['overrideDrone']>;
};

function doOverride(intent: Intent, ctx: ApplyIntentContext) {
  const { world, player, log } = ctx;
  const avatar = player as OverrideActor;
  const playerLabel = entityLabel(player);
  const target = pickInfluenceTarget(ctx, intent.dx!, intent.dy!);
  const check = avatar.canOverride(world, target);
  if (!check.ok) {
    log(`> ${playerLabel} OVERRIDE DENIED: ${check.reason}`);
    return;
  }
  const result = avatar.overrideDrone(world, target!, ctx.rng);
  const targetLabel = entityLabel(target!);
  if (result.success) {
    log(`> ${playerLabel} OVERRIDES ${targetLabel} — it fights for you! (${player.ap} AP left).`);
  } else {
    log(
      `> ${playerLabel} OVERRIDE FAILED on ${targetLabel}` +
        `${result.alarm ? ' — ALARM TRIPPED' : ''} (${player.ap} AP left).`
    );
  }
  // Presentation hook (P3.5.M5): the shell listens for this to pulse the
  // target's tile whether the roll landed or not. Gameplay is already
  // committed above — this carries no state.
  world.events?.emit(EVENT.MIND_INFLUENCED, { actor: player, target, success: result.success });
  gateOnApExhausted(ctx);
}

/**
 * Acquire a hostile in the Adept's aimed eight-way sector and attempt to
 * dominate its will. Same picker/range/LOS/perception as the CyberAvatar's
 * `doOverride` above — a failed roll trips the alarm, an empty sector yields
 * a legible deny.
 */
type InfluenceActor = ApplyIntentContext['player'] & {
  canInfluence(world: World, target: Entity | null): ReturnType<Adept['canInfluence']>;
  influenceTarget(world: World, target: Entity, rng: Rng): ReturnType<Adept['influenceTarget']>;
};

function doInfluence(intent: Intent, ctx: ApplyIntentContext) {
  const { world, player, log } = ctx;
  const adept = player as InfluenceActor;
  const playerLabel = entityLabel(player);
  const target = pickInfluenceTarget(ctx, intent.dx!, intent.dy!);
  const check = adept.canInfluence(world, target);
  if (!check.ok) {
    log(`> ${playerLabel} INFLUENCE DENIED: ${check.reason}`);
    return;
  }
  const result = adept.influenceTarget(world, target!, ctx.rng);
  const targetLabel = entityLabel(target!);
  if (result.success) {
    log(
      `> ${playerLabel} DOMINATES ${targetLabel}'s will — it fights for you! (${player.ap} AP left).`
    );
  } else {
    log(
      `> ${playerLabel} INFLUENCE FAILED on ${targetLabel}` +
        `${result.alarm ? ' — ALARM TRIPPED' : ''} (${player.ap} AP left).`
    );
  }
  // Presentation hook (P3.5.M5): the shell listens for this to pulse the
  // target's tile whether the roll landed or not. Gameplay is already
  // committed above — this carries no state.
  world.events?.emit(EVENT.MIND_INFLUENCED, { actor: player, target, success: result.success });
  gateOnApExhausted(ctx);
}

/**
 * Nearest live hostile in the aimed eight-way sector within `INFLUENCE_RANGE`
 * and LOS. The 22.5-degree half-angle partitions arbitrary target offsets
 * across the eight directions supplied by keyboard and touch controls, so a
 * moving target does not need to be perfectly collinear with the operator.
 * Shared by the CyberAvatar's cyber-grid Override and the Adept's Influence —
 * the picker itself has no archetype-specific behavior.
 */
function pickInfluenceTarget(ctx: ApplyIntentContext, dx: number, dy: number) {
  const { world, player } = ctx;
  const blockers = world.blockerKeys();
  let best: Hostile | null = null;
  let bestDistanceSquared = Infinity;
  let bestAlignment = -Infinity;

  for (const entity of world.entities.values()) {
    if (!(entity instanceof Hostile) || !entity.alive) continue;
    const offsetX = entity.x - player.x;
    const offsetY = entity.y - player.y;
    if (!isInAimSector(dx, dy, offsetX, offsetY)) continue;
    if (!withinRange(player.x, player.y, entity.x, entity.y, INFLUENCE_RANGE)) continue;
    if (
      !hasLineOfSight(world.grid, player.x, player.y, entity.x, entity.y, {
        blockers,
      })
    ) {
      continue;
    }
    if (isConcealedFromPlayer(entity, player, world)) continue;

    const distanceSquared = offsetX * offsetX + offsetY * offsetY;
    const alignment = offsetX * dx + offsetY * dy;
    if (
      distanceSquared < bestDistanceSquared ||
      (distanceSquared === bestDistanceSquared && alignment > bestAlignment) ||
      (distanceSquared === bestDistanceSquared &&
        alignment === bestAlignment &&
        best !== null &&
        entity.id < best.id)
    ) {
      best = entity;
      bestDistanceSquared = distanceSquared;
      bestAlignment = alignment;
    }
  }
  return best;
}

function isInAimSector(dx: number, dy: number, offsetX: number, offsetY: number): boolean {
  const aimMagnitude = Math.hypot(dx, dy);
  const targetMagnitude = Math.hypot(offsetX, offsetY);
  if (aimMagnitude === 0 || targetMagnitude === 0) return false;
  const cosine = (dx * offsetX + dy * offsetY) / (aimMagnitude * targetMagnitude);
  return cosine >= Math.cos(Math.PI / 8) - Number.EPSILON;
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
  // If the pre-built turret is spent, try an improvised turret from salvage.
  if (check.reason === 'no-turret' && typeof tech.canImproviseTurret === 'function') {
    const impCheck = tech.canImproviseTurret(world, intent.dx!, intent.dy!);
    if (impCheck.ok) {
      const turret = tech.improviseTurret(world, intent.dx!, intent.dy!);
      log(
        `> ${playerLabel} improvises ${entityLabel(turret)} at (${turret.x}, ${turret.y}) — ` +
          `${tech.inventory!.salvage.scrap} scrap left, ${player.ap} AP left.`
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
    log(`> ${playerLabel} BREAK DENIED: ${check?.reason}`);
    return;
  }

  // vault() handles the hop, knockback displacement, and AP debit.
  // It returns the occupant (if any) so we can apply damage here — keeping
  // Combat event wiring in the intent layer, not inside the archetype.
  const { occupant, mode } = merc.vault(world, intent.dx!, intent.dy!);

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
    const slamTail =
      (killed ? ` ${entityLabel(occupant).toUpperCase()} DOWN.` : '') + ` — ${player.ap} AP left.`;
    if (mode === 'shove') {
      log(
        `> ${playerLabel} shoved ${entityLabel(occupant)} back — SLAMMED for ${VAULT_DAMAGE} damage!${slamTail}`
      );
    } else {
      log(
        `> ${playerLabel} broke through to (${player.x}, ${player.y}) — SLAMMED ${entityLabel(occupant)} for ${VAULT_DAMAGE} damage!${slamTail}`
      );
    }
  } else {
    log(`> ${playerLabel} broke through to (${player.x}, ${player.y}) — ${player.ap} AP left.`);
  }

  collectTileLoot(ctx);
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
  // Presentation hook (P3.5.M5): the shell listens for this to pulse the
  // Razor's own landing tile. Gameplay is already committed above — this
  // carries no state.
  world.events?.emit(EVENT.RAZOR_CLOAKED, { actor: player });
  collectTileLoot(ctx);
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
  const result = resolveMelee(world, player, target, ctx.rng, {
    damage: 'meleeDamage' in player ? player.meleeDamage : undefined,
  });
  if (
    !result.dodged &&
    result.damage === 0 &&
    target instanceof DenyTarget &&
    target.requiresBreach
  ) {
    log(`> ${entityLabel(target)} is reinforced — use a breaching charge.`);
    gateOnApExhausted(ctx);
    return;
  }
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

function doJackOut(ctx: ApplyIntentContext) {
  // Explicit jack-out is a Run-level transition, not an active-world action:
  // it can eject the Decker even while the player is controlling the meat
  // partner. The shell owns the active-Cyberspace gate and confirmation copy.
  if (typeof ctx.onPlayerAction !== 'function') {
    throw new Error('applyIntent: jack-out intent received but ctx.onPlayerAction is missing');
  }
  ctx.onPlayerAction(PLAYER_ACTIONS.JACK_OUT);
}

/**
 * Thrown-consumable resolution. The keymap emits `use-item { dx, dy }`
 * from `MODE.AIM` / `aimKind: 'use-item'`; the shell stashes the pending `itemId` when it
 * entered that mode (so the keymap can stay item-agnostic, mirroring the
 * `special` intent's archetype-agnostic shape). We delegate to the shell's
 * `onUseItem` callback because Crew lives outside the World — the shell
 * owns the world-mutation side (stamping hazard / smoke tiles, paying AP,
 * and ending the turn). A missing handler is a wiring bug, not a runtime
 * choice — crash rather than swallow the press.
 */
function doUseItem(intent: Intent, ctx: ApplyIntentContext) {
  if (typeof ctx.onUseItem !== 'function') {
    throw new Error('applyIntent: use-item intent received but ctx.onUseItem is missing');
  }
  const { dx, dy } = intent;
  if (
    typeof dx !== 'number' ||
    typeof dy !== 'number' ||
    !Number.isInteger(dx) ||
    !Number.isInteger(dy) ||
    (dx === 0 && dy === 0) ||
    Math.abs(dx) > 1 ||
    Math.abs(dy) > 1
  ) {
    throw new Error(
      `applyIntent: use-item requires a non-zero integer unit aim (got ${dx}, ${dy})`
    );
  }
  ctx.onUseItem({ dx, dy });
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
  if (result.hit && result.damage === 0 && target instanceof DenyTarget && target.requiresBreach) {
    log(`> ${entityLabel(target)} is reinforced — use a breaching charge.`);
    gateOnApExhausted(ctx);
    return;
  }
  log(
    `> ${entityLabel(player)} fires at ${entityLabel(target)} — ` +
      `${result.hit ? 'HIT' : 'miss'} (roll ${result.roll.toFixed(2)} vs ${result.threshold.toFixed(2)}` +
      `${result.inCover ? ', cover' : ''}).` +
      (result.killed ? ` ${entityLabel(target).toUpperCase()} DOWN.` : '')
  );
  gateOnApExhausted(ctx);
}
