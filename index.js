/**
 * M8 game shell. Promotes `/index.html` from the M0 scaffold to a real game:
 *
 *   - boots DataStore + service worker,
 *   - restores a saved campaign when present,
 *   - drives `Campaign` (HUB) plus one active `Run` job episode,
 *   - paints the canvas during HUB / COMBAT, swaps DOM overlays during
 *     BRIEFING / RESULT (per the M8 plan: "DOM panels above the canvas;
 *     canvas paints during HUB/COMBAT only"), plus <system-start> on a new
 *     campaign,
 *   - wires KeyboardController and <touch-pad> through the shared
 *     `applyIntent` helper that the M7 debug harness also uses,
 *   - persists snapshots on every `turn:ended` and clears the save on
 *     DEATH / EXIT (autosave-on-turn-end per the locked-in decision).
 *
 * The debug harness at `/debug/index.html` continues to be the engineer-facing
 * surface (single hand-built scenario, log feed, archetype hot-swap). Both
 * shells share `applyIntent` so movement / combat plumbing has one consumer.
 */

import { serviceWorkerManager } from '/src/ServiceWorkerManager.js';
import dataStore from '/src/DataStore.js';

import { Campaign, CAMPAIGN_STATE, willEndCampaignOnThisDeath } from '/src/game/Campaign.js';
import { RUN_STATE } from '/src/game/Run.js';
import { restoreCampaign, snapshotCampaign } from '/src/game/persistence.js';
import { runCorpTurn as driveCorpTurn } from '/src/game/corpTurnDriver.js';
import { FACTION, AP_COST } from '/src/game/constants.js';
import {
  advanceFromPlayerTurn,
  drivePlayerAftermath,
  formatPlayerAftermathStepLogLines,
} from '/src/game/combatTurnPipeline.js';
import { corpTurnStatusBody, countVisibleCorpEntities } from '/src/game/corpTurnStatusCopy.js';
import { EVENT } from '/src/game/events.js';
import { VisionField } from '/src/game/Vision.js';
import { AsciiRenderer } from '/src/render/AsciiRenderer.js';
import { CrtFilter } from '/src/render/CrtFilter.js';
import {
  ANIMATION_DURATIONS,
  createAnimationLock,
  runMuzzleFlash,
  triggerDamageFlash,
  triggerShake,
} from '/src/render/animations.js';
import { KeyboardController } from '/src/input/KeyboardController.js';
import { MODE } from '/src/input/keymap.js';
import { applyIntent, PLAYER_ACTIONS } from '/src/input/applyIntent.js';

import { placeSmoke, clearSmoke } from '/src/game/Smoke.js';

import '/components/ConfirmationModal.js';
import '/components/UpdateNotification.js';
import '/components/TouchPad.js';
import '/components/RunBriefing.js';
import '/components/CrashDump.js';
import '/components/SystemStart.js';
import '/components/CrewList.js';
import '/components/CrewRoster.js';
import '/components/FinnShop.js';
import '/components/ItemInventory.js';
import '/components/KeyHelp.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Campaign|null} */
let campaign = null;
let vision = new VisionField();
let visionMoveUnsub = null;

let canvas, statusEl, renderer, crt;
let stageEl;
let briefingEl, crashEl, systemStartEl, resumeModalEl, quitCampaignModalEl, touchPadEl;
let crewRosterEl, finnShopEl, itemInventoryEl, keyHelpEl;
let keyboard;

/**
 * Animation-lock for M0 combat feedback. Listeners on the run bus
 * (`attachAnimationListeners`) push durations as effects fire; both
 * input controllers consult `isLocked()` so a key held mid-shake doesn't
 * sneak through. See `src/render/animations.js`.
 */
const animLock = createAnimationLock();
/** Unsubscribers for the run-bus animation listeners. Re-bound on every state transition. */
let animationUnsubs = [];

let pendingJobResult = null;
/**
 * Active smoke overlays from Smoke Charge consumables. Each entry records
 * the tile position and original tile type so `clearSmoke` can restore the
 * grid. Cleared at the start of the player's next turn (`onPlayerTurnReady`).
 */
let activeSmokeOverlays = [];

/**
 * Most recent intent-result log line ("@ moved to (3,4) — 2 AP left.").
 * Tracked at module level because `applyIntent`'s `log` callback fires
 * during intent handling, but the status line is finalised later in
 * `paint()` — without this, the action line gets clobbered by the
 * subsequent statusLine() rewrite.
 */
let lastActionLine = '';

const seedFromClock = () => Date.now() & 0xffffffff;

const allComponentsReady = Promise.all([
  customElements.whenDefined('update-notification'),
  customElements.whenDefined('confirmation-modal'),
  customElements.whenDefined('finn-shop'),
  customElements.whenDefined('item-inventory'),
  customElements.whenDefined('touch-pad'),
  customElements.whenDefined('crew-list'),
  customElements.whenDefined('crew-roster'),
  customElements.whenDefined('key-help'),
  customElements.whenDefined('system-start'),
]);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  canvas = document.getElementById('game-canvas');
  stageEl = canvas?.parentElement ?? null;
  statusEl = document.getElementById('game-status');
  briefingEl = document.getElementById('briefing');
  crashEl = document.getElementById('crash');
  systemStartEl = document.getElementById('system-start');
  resumeModalEl = document.getElementById('resume-modal');
  quitCampaignModalEl = document.getElementById('quit-campaign-modal');
  touchPadEl = document.getElementById('touch-pad');
  crewRosterEl = document.getElementById('crew-roster');
  finnShopEl = document.getElementById('finn-shop');
  itemInventoryEl = document.getElementById('item-inventory');
  keyHelpEl = document.getElementById('key-help');

  renderer = new AsciiRenderer(canvas);
  crt = new CrtFilter(canvas);

  keyboard = new KeyboardController({
    onIntent: intent => {
      handleIntent(intent);
      paint();
    },
    onModeChange: nextMode => {
      // Keep the keyboard / touchpad in lock-step so the cross-input cancel
      // rule the M7 harness established still holds in the shell.
      paint(nextMode);
    },
    isBlocked: () => animLock.isLocked() || isAnyBlockingModalOpen(),
  });
  keyboard.attach();

  // `?` and Esc-for-help live above the keymap: `?` is a UI toggle (not a
  // game intent), and Esc must reach <key-help> before the keymap turns it
  // into a `cancel` intent. Capture phase + a return-early when the help
  // panel is open keeps both behaviours clean.
  window.addEventListener('keydown', handleGlobalKey, true);

  briefingEl.addEventListener('deploy', onBriefingDeploy);
  briefingEl.addEventListener('dismiss', () => briefingEl.hide());
  crashEl.addEventListener('new-run', onNewRunRequested);
  systemStartEl?.addEventListener('hub-enter', onSystemStartHubEnter);

  if (crewRosterEl) {
    crewRosterEl.addEventListener('dismiss', () => crewRosterEl.hide());
  }

  if (finnShopEl) {
    finnShopEl.addEventListener('purchase', onFinnPurchase);
    finnShopEl.addEventListener('dismiss', () => finnShopEl.hide());
  }

  if (itemInventoryEl) {
    itemInventoryEl.addEventListener('use-item', onUseItem);
    itemInventoryEl.addEventListener('dismiss', () => itemInventoryEl.hide());
  }

  if (keyHelpEl) {
    keyHelpEl.addEventListener('dismiss', () => keyHelpEl.hide());
  }

  const keyHelpToggleEl = document.getElementById('key-help-toggle');
  if (keyHelpToggleEl && keyHelpEl) {
    keyHelpToggleEl.addEventListener('click', () => {
      if (keyHelpEl.isOpen) {
        keyHelpEl.hide();
        return;
      }
      tryShowKeyHelpOverlay();
    });
  }

  if (quitCampaignModalEl) {
    quitCampaignModalEl.addEventListener('confirm', evt => {
      if (evt.detail?.context?.kind !== 'quit-campaign') return;
      performQuitCampaign();
    });
  }

  if (touchPadEl) {
    touchPadEl.addEventListener('intent', evt => {
      handleIntent(evt.detail);
      paint();
    });
    touchPadEl.addEventListener('mode-change', evt => {
      paint(evt.detail.mode);
    });
    touchPadEl.setBlocked(() => animLock.isLocked() || isAnyBlockingModalOpen());
  }

  // Update-notification wiring kept from the original scaffold.
  const updateNotification = document.querySelector('update-notification');
  window.addEventListener('sw-update-available', event => {
    updateNotification.show(event.detail.pendingWorker);
  });

  await dataStore.init();
  if (dataStore.currentRun) {
    dataStore.deleteRun(dataStore.currentRun.id);
  }
  if (dataStore.currentCampaign) {
    resumeCampaign(dataStore.currentCampaign);
  } else {
    startFreshCampaign();
  }

  // SW registration is the same posture as the M0 scaffold — kicked off last
  // so it doesn't gate the shell's first paint.
  serviceWorkerManager.register().catch(err => console.warn('[shell] sw register failed', err));
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function startFreshCampaign() {
  campaign = new Campaign({
    seed: seedFromClock(),
    onPersist: handlePersist,
    onResult: handleResult,
  });
  handlePersist();

  pendingJobResult = null;
  attachVisionListener();
  attachAnimationListeners();
  recomputeVision();
  renderShell();
  if (systemStartEl) {
    systemStartEl.setSession({ seed: campaign.seed });
    systemStartEl.show();
  } else {
    flash('NEW RUN — Curator is in the Hub.');
  }
}

function onSystemStartHubEnter() {
  systemStartEl?.hide();
  flash('HUB — Curator has contracts when you are adjacent [Space].');
}

function presentCrewRoster() {
  if (!crewRosterEl || !campaign) return;
  crewRosterEl.setCrew(campaign.crew, { salvage: campaign.salvage });
  crewRosterEl.show();
}

function presentBriefing(contract) {
  if (!briefingEl || !campaign) return;
  briefingEl.setContract(contract);
  briefingEl.setCrew(campaign.crew);
  briefingEl.show();
}

function onBriefingDeploy(evt) {
  if (!campaign) return;
  const { memberId, contract } = evt?.detail ?? {};
  const member = campaign.getCrewMember(memberId);
  if (!member || member.flatlined || !contract) return;
  briefingEl.hide();
  campaign.deployCrewMember(member.id, contract);
  flash(`CURATOR: ${member.callsign} takes ${contract.label}. JACKING IN.`);
  // Go straight into combat — the player already reviewed the contract and
  // chose their operative in the combined briefing modal.
  const run = campaign.activeRun;
  if (!run || run.state !== RUN_STATE.BRIEFING) {
    throw new Error(`[shell] expected deployed run to enter BRIEFING, got ${run?.state}`);
  }
  run.enterCombat();
  handlePersist();
  vision.resetFogState();
  attachVisionListener();
  attachAnimationListeners();
  recomputeVision();
  flash('JACKED IN. Reach the exit tile (¤) before the drones drop you.');
  renderShell();
}

function presentFinnShop() {
  if (!finnShopEl || !campaign) return;
  const catalog = campaign.finn.catalog(campaign.meta);
  finnShopEl.setCatalog(catalog, campaign.crew, campaign.salvage);
  finnShopEl.show();
}

function onFinnPurchase(evt) {
  if (!campaign) return;
  const { itemId, targetMemberId } = evt?.detail ?? {};
  try {
    campaign.purchase({ itemId, targetMemberId });
  } catch (err) {
    flash(`PURCHASE FAILED: ${err.message}`);
    return;
  }
  flash(`FINN: Purchased ${itemId}. SALVAGE ${campaign.salvage}.`);
  // Refresh the shop to reflect new balance and purchased meta upgrades.
  presentFinnShop();
}

function presentItemInventory() {
  if (!itemInventoryEl || !campaign) return;
  const run = campaign.activeRun;
  if (!run || !run.player || !run.player.inventory) return;
  itemInventoryEl.setItems(run.player.inventory.consumables);
  itemInventoryEl.show();
}

function onUseItem(evt) {
  if (!campaign) return;
  const run = campaign.activeRun;
  if (!run || !run.player) return;
  const { itemId } = evt?.detail ?? {};
  try {
    const result = run.player.useConsumable(itemId);
    if (result.type === 'stim') {
      flash(
        `Used STIM — healed ${result.healed} HP (now ${run.player.hp}/${run.player.maxHp}). ${run.player.ap} AP left.`
      );
    } else if (result.type === 'smoke') {
      const overlays = placeSmoke(run.world.grid, result.cx, result.cy, result.radius);
      activeSmokeOverlays.push(...overlays);
      recomputeVision();
      flash(
        `Used SMOKE CHARGE — LOS blocked in radius ${result.radius}. ${run.player.ap} AP left.`
      );
    }
  } catch (err) {
    flash(`USE FAILED: ${err.message}`);
    return;
  }
  itemInventoryEl.hide();
  paint();
  if (run.player.ap === 0) {
    flash('AP EXHAUSTED — auto-ending turn.');
    advanceTurn();
  }
}

function handlePersist() {
  if (!campaign) return;
  dataStore.setCampaign(snapshotCampaign(campaign));
}

function crewMemberArchetypeId(member) {
  const n = member?.constructor?.name;
  if (n === 'Merc') return 'merc';
  if (n === 'Razor') return 'razor';
  if (n === 'Tech') return 'tech';
  return 'op';
}

function telemetryForEndedCampaign(c) {
  return {
    outcome: 'campaign-over',
    seed: c.seed,
    salvage: c.salvage,
    crewRoster: c.crew.map(member => ({
      callsign: member.callsign ?? member.id,
      archetype: crewMemberArchetypeId(member),
      flatlined: !!member.flatlined,
    })),
  };
}

/**
 * Drives `<crash-dump>` and `pendingJobResult` whenever the active job is in
 * RESULT — both from a live `Run.onResult` callback and from a cold resume
 * (otherwise `renderShell` opens the overlay with no `setTelemetry` call).
 */
function pushPendingJobResultOverlay(telemetry) {
  if (!crashEl) return;
  const tel = { ...telemetry };
  const outcome = tel.outcome;
  if (outcome !== 'death' && outcome !== 'exit') {
    throw new Error(`[shell] invalid job outcome for debrief overlay: "${outcome}"`);
  }
  pendingJobResult = { outcome, telemetry: tel };
  const campaignTerminal = outcome === 'death' && campaign && willEndCampaignOnThisDeath(campaign);
  crashEl.setTelemetry({
    ...tel,
    campaignTerminal,
  });
}

function handleResult({ outcome, telemetry }) {
  pushPendingJobResultOverlay({
    ...telemetry,
    outcome: telemetry?.outcome ?? outcome,
  });
  renderShell();
}

function currentScene() {
  if (!campaign) return null;
  return campaign.activeRun ?? campaign;
}

function resumeCampaign(record) {
  try {
    campaign = restoreCampaign(record, {
      onPersist: () => handlePersist(),
      onResult: handleResult,
    });
    if (campaign.activeRun?.state === RUN_STATE.COMBAT) {
      vision.resetFogState();
    }
    attachVisionListener();
    attachAnimationListeners();
    recomputeVision();
    if (campaign.activeRun?.state === RUN_STATE.BRIEFING && campaign.activeRun.contract) {
      briefingEl.setContract(campaign.activeRun.contract);
      briefingEl.setCrew(campaign.crew);
    }
    if (campaign.state === CAMPAIGN_STATE.ENDED) {
      pendingJobResult = null;
      crashEl.setTelemetry(telemetryForEndedCampaign(campaign));
      flash('CAMPAIGN ENDED — no surviving crew in this save.');
    } else if (campaign.activeRun?.state === RUN_STATE.RESULT) {
      pushPendingJobResultOverlay({ ...campaign.activeRun.telemetry });
      flash('RESUMED — mission debrief.');
    } else {
      flash(`RESUMED — crew ${campaign.crew.filter(member => !member.flatlined).length} active.`);
    }
    renderShell();
  } catch (err) {
    console.error('[shell] failed to restore saved campaign', err);
    dataStore.deleteCampaign();
    flash('CAMPAIGN SAVE CORRUPT — starting fresh.');
    startFreshCampaign();
  }
}

// ---------------------------------------------------------------------------
// Intent handling
// ---------------------------------------------------------------------------

function isConfirmationDialogOpen(el) {
  const dialog = el?.shadowRoot?.querySelector('dialog');
  return Boolean(dialog?.open);
}

function presentQuitCampaignConfirm() {
  if (!quitCampaignModalEl || !campaign) return;
  if (isConfirmationDialogOpen(quitCampaignModalEl)) return;
  quitCampaignModalEl.showModal('Delete this campaign and all progress? This cannot be undone.', {
    kind: 'quit-campaign',
  });
}

function performQuitCampaign() {
  if (!campaign) return;
  keyHelpEl?.hide();
  briefingEl?.hide();
  crashEl?.hide();
  crewRosterEl?.hide();
  finnShopEl?.hide();
  itemInventoryEl?.hide();

  pendingJobResult = null;
  dataStore.deleteCampaign();
  startFreshCampaign();
  flash('Campaign deleted — new campaign.');
  canvas?.focus();
}

function handleIntent(intent) {
  if (intent?.type === 'quit-campaign') {
    resetInputModes();
    if (!campaign) return;
    presentQuitCampaignConfirm();
    return;
  }

  const run = currentScene();
  if (!run) return;
  // BRIEFING / RESULT swallow gameplay intents — JACK IN / NEW RUN drive
  // those transitions through the DOM buttons. Cancel is still valid (it
  // clears any stuck aim mode, per the M7 cross-input cancel rule).
  if (
    run.state === RUN_STATE.BRIEFING ||
    run.state === RUN_STATE.RESULT ||
    run.state === CAMPAIGN_STATE.ENDED
  ) {
    if (intent?.type === 'cancel') {
      resetInputModes();
    }
    return;
  }

  applyIntent(intent, {
    world: run.world,
    player: run.player,
    queue: run.queue,
    rng: run.rng,
    // Capture the action line for the next paint(); see lastActionLine docs.
    log: line => flash(line),
    advanceTurn,
    resetInputModes,
    onPlayerAction: actionName => {
      switch (actionName) {
        case PLAYER_ACTIONS.INVENTORY:
          // Only open inventory during combat when it's the player's turn.
          if (
            campaign?.state !== CAMPAIGN_STATE.COMBAT ||
            run.state !== RUN_STATE.COMBAT ||
            run.queue.currentFaction !== FACTION.PLAYER
          ) {
            flash('Inventory is only available during combat on your turn.');
            return;
          }
          presentItemInventory();
          break;
        case PLAYER_ACTIONS.INTERACT:
          handleInteract();
          break;
        case PLAYER_ACTIONS.REACHED_EXIT:
          flash('EXIT REACHED.');
          //advanceTurn();
          break;
      }
    },
  });
}

/**
 * Pacing between drone actions when the corp turn is animated step-by-step.
 * Tuned just above MUZZLE_FLASH duration so the firing flash decays cleanly
 * before the same drone takes its next action (move, second shot, etc.) —
 * the M0 user-reported bug where a "fire then move" turn left the flash
 * stranded on the tile the drone had just vacated.
 */
const CORP_ACTION_DELAY_MS = 130;
const PLAYER_AFTERMATH_ACTION_DELAY_MS = 130;

function advanceTurn() {
  const run = currentScene();
  if (!run) return;
  advanceFromPlayerTurn({
    queue: run.queue,
    world: run.world,
    rng: run.rng,
    isTerminal: () => run?.state === RUN_STATE.RESULT,
    drivePlayerAftermath: ({ onStep, onFinish }) => {
      drivePlayerAftermath({
        world: run.world,
        rng: run.rng,
        onStep,
        onFinish,
        animLock,
        stepDelayMs: PLAYER_AFTERMATH_ACTION_DELAY_MS,
        lockMarginMs: ANIMATION_DURATIONS.MUZZLE_FLASH,
      });
    },
    onPlayerAftermathStep: step => {
      for (const line of formatPlayerAftermathStepLogLines(step)) {
        flash(line);
      }
      paint();
    },
    driveCorpTurn: ({ onFinish }) => {
      runCorpTurn(onFinish);
    },
    onPlayerTurnReady: () => {
      // Clear any smoke from last turn before the player acts.
      if (activeSmokeOverlays.length > 0 && run.world) {
        clearSmoke(run.world.grid, activeSmokeOverlays);
        activeSmokeOverlays = [];
      }
      // Stealth & vision may both have changed during the corp turn.
      recomputeVision();
      paint();
    },
  });
}

/**
 * Kick off the animated corp turn. Delegates to `corpTurnDriver.runCorpTurn`,
 * which iterates each corp entity's `takeTurnSteps` generator one yield at
 * a time, paints between each, and fires `onFinish` once every generator
 * drains (or immediately when the world has zero corp entities — hub, or a
 * combat map the player has cleared). The driver lives in `/src/game/` so
 * its state machine is testable under `node --test`.
 */
function runCorpTurn(onFinish) {
  const run = currentScene();
  if (!run) return;
  driveCorpTurn({
    run,
    corpFaction: FACTION.CORP,
    paint,
    animLock,
    actionDelayMs: CORP_ACTION_DELAY_MS,
    lockMarginMs: ANIMATION_DURATIONS.MUZZLE_FLASH,
    onFinish,
  });
}

/*
 * `advanceFromPlayerTurn` owns the final CORP→PLAYER queue transition; the
 * shell callback above only refreshes presentation state after that happens.
 */

function handleInteract() {
  if (!campaign) return;
  // Combat interact: check for adjacent lootable corpses first.
  if (campaign.state === CAMPAIGN_STATE.COMBAT && campaign.activeRun?.state === RUN_STATE.COMBAT) {
    handleCombatInteract();
    return;
  }
  if (campaign.state !== CAMPAIGN_STATE.HUB) {
    flash('Nothing to interact with here.');
    return;
  }
  if (campaign.finn && isChebyshevAdjacent(campaign.player, campaign.finn)) {
    flash('FINN — browse the shop.');
    presentFinnShop();
    return;
  }
  if (campaign.terminal && isChebyshevAdjacent(campaign.player, campaign.terminal)) {
    flash('TERMINAL — crew roster.');
    presentCrewRoster();
    return;
  }
  if (!campaign.curator || !isChebyshevAdjacent(campaign.player, campaign.curator)) {
    flash('Step adjacent to Finn (shop), Curator (contract), or Terminal (roster).');
    return;
  }
  const contract = campaign.curator.generateContract(campaign.rng);
  flash(`CURATOR: ${contract.label} — review and deploy.`);
  presentBriefing(contract);
}

/**
 * Combat interact — scan Chebyshev-adjacent tiles for a lootable corpse.
 * If found: call `player.collectSalvage`, flash result, auto-end turn on AP
 * exhaustion. If not found: show a no-loot hint.
 */
function handleCombatInteract() {
  const run = campaign.activeRun;
  if (!run || !run.player) return;
  const player = run.player;
  // Scan the 8 neighbours plus the player's own tile for lootable corpses.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = player.x + dx;
      const ty = player.y + dy;
      const entity = run.world.lootableCorpseAt(tx, ty);
      if (entity && !entity.alive && entity.loot && entity.loot.salvage > 0) {
        if (!player.canAfford(AP_COST.INTERACT)) {
          flash('Insufficient AP to loot.');
          return;
        }
        const amount = entity.loot.salvage;
        player.collectSalvage(run.world, entity);
        flash(
          `Salvaged +${amount} — carrying ${player.inventory.salvage} total. ${player.ap} AP left.`
        );
        paint();
        if (player.ap === 0) {
          flash('AP EXHAUSTED — auto-ending turn.');
          advanceTurn();
        }
        return;
      }
    }
  }
  flash('Nothing to loot nearby.');
}

// onJackIn removed — combat entry is handled in onBriefingDeploy.

function onNewRunRequested() {
  if (!campaign) return;
  if (pendingJobResult) {
    const { outcome } = pendingJobResult;
    pendingJobResult = null;
    // M3: extract salvage from the deployed crew member's inventory on exit.
    const member = campaign.getCrewMember(campaign.deployedMemberId);
    const salvage = member?.inventory?.salvage ?? 0;
    campaign.onJobEnd({ outcome, salvage });
    if (campaign.state === CAMPAIGN_STATE.ENDED) {
      dataStore.deleteCampaign();
      startFreshCampaign();
      return;
    }
  } else if (campaign.state === CAMPAIGN_STATE.ENDED) {
    dataStore.deleteCampaign();
    startFreshCampaign();
    return;
  }
  crashEl.hide();
  attachVisionListener();
  attachAnimationListeners();
  recomputeVision();
  flash('HUB — choose the next job.');
  renderShell();
}

// ---------------------------------------------------------------------------
// Vision (mirrors the M5 harness rule: refresh on every entity move)
// ---------------------------------------------------------------------------

function attachVisionListener() {
  if (visionMoveUnsub) {
    visionMoveUnsub();
    visionMoveUnsub = null;
  }
  const run = currentScene();
  if (!run?.bus) return;
  visionMoveUnsub = run.bus.on(EVENT.ENTITY_MOVED, () => recomputeVision());
}

/**
 * Subscribe the M0 combat-feedback animations to the active run's bus.
 *
 *   - `entity:damaged` where the player is the target → shake + reddening
 *     (~300ms lock).
 *   - `noise` of `kind: 'ranged'` or `'melee'` → muzzle flash on the
 *     shooter's tile (~80ms lock). Fires for *any* attacker so the player
 *     also sees drones return fire.
 *
 * Re-attached on every Run state transition because Run.#tearDownWorld
 * recreates `bus` from scratch — same posture as `attachVisionListener`.
 */
function attachAnimationListeners() {
  for (const off of animationUnsubs) off();
  animationUnsubs = [];
  const run = currentScene();
  if (!run?.bus) return;
  animationUnsubs.push(
    run.bus.on(EVENT.ENTITY_DAMAGED, ({ target, killed, source }) => {
      // Player-side feedback: screen shake + red vignette when *we* get hit.
      if (run?.player && target === run.player && stageEl) {
        triggerShake(stageEl);
        triggerDamageFlash(stageEl);
        animLock.push(ANIMATION_DURATIONS.DAMAGE_FLASH);
      }
      // Melee impact: the strike reads as landing on the *target*, not
      // hovering above the attacker. Ranged stays on the NOISE path so
      // misses still get a muzzle flash on the shooter's tile.
      if (source === 'melee' && target && renderer) {
        const fired = runMuzzleFlash(renderer, paint, target.x, target.y);
        if (fired) animLock.push(ANIMATION_DURATIONS.MUZZLE_FLASH);
      }
      // M3: memorise corpse position when a kill occurs within current LOS.
      if (killed && target && vision.isVisible(target.x, target.y)) {
        vision.memoriseCorpse(target);
      }
    }),
    run.bus.on(EVENT.NOISE, payload => {
      // Muzzle flash on the shooter's tile. Melee is handled via
      // ENTITY_DAMAGED above (so we know the *target* position); NOISE
      // for melee would only know the attacker.
      if (!payload || payload.kind !== 'ranged') return;
      const origin = payload.origin;
      if (!origin || !renderer) return;
      const fired = runMuzzleFlash(renderer, paint, origin.x, origin.y);
      if (fired) animLock.push(ANIMATION_DURATIONS.MUZZLE_FLASH);
    })
  );
}

function recomputeVision() {
  const run = currentScene();
  if (!run || !run.world || !run.player) return;
  vision.recompute(run.world.grid, run.player, undefined, {
    blockers: run.world.blockerKeys(),
  });
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function renderShell() {
  if (!campaign) return;
  const run = currentScene();
  const state = run?.state;
  switch (state) {
    case CAMPAIGN_STATE.HUB:
    case RUN_STATE.COMBAT:
      canvas.hidden = false;
      briefingEl.hide();
      crashEl.hide();
      break;
    case RUN_STATE.BRIEFING:
      // The combined briefing modal handles its own show/hide. If we land
      // here on resume, re-present the briefing so the player can pick an
      // operative.
      canvas.hidden = true;
      if (!briefingEl.isOpen) {
        briefingEl.setContract(campaign.activeRun.contract);
        briefingEl.setCrew(campaign.crew);
        briefingEl.show();
      }
      crashEl.hide();
      break;
    case RUN_STATE.RESULT:
      canvas.hidden = true;
      briefingEl.hide();
      crashEl.show();
      break;
    case CAMPAIGN_STATE.ENDED:
      canvas.hidden = true;
      briefingEl.hide();
      crashEl.show();
      break;
    default:
      throw new Error(`[shell] unknown state "${state}"`);
  }
  paint();
}

function paint(modeHint = activeMode()) {
  const run = currentScene();
  if (canvas.hidden) {
    setStatus(statusLine(modeHint));
    return;
  }
  if (!run || !run.world || !run.player) return;
  // Hub is a safe space — no fog of war. Vision is only meaningful during
  // combat where LOS and drone stealth detection matter.
  const activeVision = run.state === RUN_STATE.COMBAT ? vision : undefined;
  renderer.draw(run.world, run.player, { vision: activeVision });
  crt.apply();
  setStatus(statusLine(modeHint));
}

function statusLine(modeHint) {
  const run = currentScene();
  if (!run) return '';
  const aim = modeHint && modeHint !== MODE.IDLE ? `  |  AIM: ${modeHint}` : '';
  const player = run.player;
  if (!player) return stateLabel();
  const stealthTag = player.stealthed ? ' [CLOAKED]' : '';
  let identity;
  if (run.state === RUN_STATE.COMBAT) {
    const salvageTag = player.inventory ? ` SAL:${player.inventory.salvage}` : '';
    identity = `${run.player.callsign ?? run.archetype} ${run.archetype.toUpperCase()}${salvageTag}`;
  } else {
    identity = `CREW ${campaign.crew.filter(member => !member.flatlined).length}/${campaign.crew.length} SALVAGE ${campaign.salvage}`;
  }
  const statsInner =
    `${stateLabel()}  |  ${identity} ` +
    `AP ${player.ap}/${player.maxAp} HP ${player.hp}/${player.maxHp}${stealthTag}` +
    `  |  TURN ${run.queue.turnNumber} (${run.queue.currentFaction.toUpperCase()})${aim}`;
  const stats = `<span class="game-shell__stats">${statsInner}</span>`;
  // Proximity hint and action line each render in their own reserved-height
  // row so the status block's geometry is constant — appearing/disappearing
  // hints change text, not the height of the bar. See `.game-shell__hint`
  // and `.game-shell__activity` in main.css.
  const hint = `<span class="game-shell__hint">${proximityHint()}</span>`;
  let action = '';
  if (run.state === RUN_STATE.COMBAT && run.queue.currentFaction === FACTION.CORP) {
    const visibleCorp = countVisibleCorpEntities(run.world.entities.values(), (x, y) =>
      vision.isVisible(x, y)
    );
    const body = corpTurnStatusBody(visibleCorp, run.queue.turnNumber);
    action = `<span class="game-shell__activity corp"><span class="faction-tag">CORP</span> — ${body}</span>`;
  } else {
    action = `<span class="game-shell__activity">${lastActionLine ?? ''}</span>`;
  }
  return stats + hint + action;
}

/**
 * Player-facing nudge for whatever interactable is within reach. Computed
 * fresh every paint so it always reflects the *current* player position
 * (vs. caching at action-time, which would let a stale hint linger after a
 * corp turn shuffled the world).
 *
 * Today the only HUB interactable is the Curator; the only COMBAT
 * "interactable" is the EXIT tile (auto-trigger on step-on, hint on
 * adjacency). Both extend naturally — add a case here when new
 * interactables land (terminals, dropped weapons, etc.).
 */
function proximityHint() {
  const run = currentScene();
  if (!run || !run.player) return '';
  if (run.state === CAMPAIGN_STATE.HUB) {
    if (run.finn && isChebyshevAdjacent(run.player, run.finn)) {
      return 'FINN — press [Space] to shop.';
    }
    if (run.curator && isChebyshevAdjacent(run.player, run.curator)) {
      return 'CURATOR — press [Space] for a contract.';
    }
    if (run.terminal && isChebyshevAdjacent(run.player, run.terminal)) {
      return 'TERMINAL — press [Space] for roster.';
    }
    if (run.exitTile && isChebyshevAdjacent(run.player, run.exitTile)) {
      return 'EXIT (¤) one step away.';
    }
    return '';
  }
  if (run.state === RUN_STATE.COMBAT) {
    // Loot hint: check for adjacent lootable corpses.
    if (run.world && run.player) {
      const p = run.player;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const e = run.world.lootableCorpseAt(p.x + dx, p.y + dy);
          if (e && !e.alive && e.loot && e.loot.salvage > 0) {
            return 'SALVAGE nearby — press [Space] to loot.';
          }
        }
      }
    }
    if (run.exitTile && isChebyshevAdjacent(run.player, run.exitTile)) {
      return 'EXIT (¤) one step away.';
    }
  }
  return '';
}

/** Stash a one-shot message that the next paint surfaces in the status bar. */
function flash(line) {
  lastActionLine = String(line ?? '').replace(/^>\s*/, '');
}

function stateLabel() {
  const run = currentScene();
  if (!run) return 'BOOTING';
  switch (run.state) {
    case CAMPAIGN_STATE.HUB:
      return '[HUB]';
    case RUN_STATE.BRIEFING:
      return '[BRIEFING]';
    case RUN_STATE.COMBAT:
      return '[COMBAT]';
    case RUN_STATE.RESULT:
      return '[DEBRIEF]';
    case CAMPAIGN_STATE.ENDED:
      return '[ENDED]';
    default:
      return run.state ?? '';
  }
}

function setStatus(richText) {
  if (statusEl) statusEl.innerHTML = richText;
}

function activeMode() {
  if (touchPadEl && touchPadEl.mode && touchPadEl.mode !== MODE.IDLE) return touchPadEl.mode;
  return keyboard?.mode ?? MODE.IDLE;
}

function resetInputModes() {
  if (touchPadEl) touchPadEl.setMode(MODE.IDLE);
  if (keyboard) keyboard.mode = MODE.IDLE;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function isChebyshevAdjacent(a, b) {
  return chebyshevDistance(a, b) === 1;
}

function chebyshevDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ---------------------------------------------------------------------------
// Global keys (UI-layer, not routed through keymap.js)
// ---------------------------------------------------------------------------

/**
 * Opens <key-help> when Hub/Combat and no blocking modal — same rules as the
 * `?` shortcut and the header toolbar button.
 *
 * @returns {'ok'|'blocking'|'no-scope'|'none'}
 */
function tryShowKeyHelpOverlay() {
  if (!keyHelpEl) return 'none';
  if (isAnyBlockingModalOpen()) return 'blocking';
  const scope = helpScopeForRunState();
  if (!scope) return 'no-scope';
  keyHelpEl.setScope(scope);
  keyHelpEl.show();
  return 'ok';
}

/**
 * `?` toggles the help overlay. Esc, when the help overlay is open, dismisses
 * it (and we swallow the event so the keymap doesn't also turn it into a
 * `cancel` intent for whatever aim mode was active).
 *
 * `?` is suppressed while any blocking modal owns the foreground — opening
 * help over a briefing or crew-roster would just stack panels.
 */
function handleGlobalKey(evt) {
  if (!keyHelpEl) return;
  if (evt.ctrlKey || evt.metaKey || evt.altKey) return;

  // While <key-help> is open it owns the foreground entirely: `?` and Esc
  // close it; every other key is swallowed so a held WASD doesn't pump
  // moves into the game underneath. (Tested manually — gameplay events
  // routing through this layer was the bug we hit during M7 touchpad
  // testing too.)
  if (keyHelpEl.isOpen) {
    if (evt.key === '?' || evt.key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      keyHelpEl.hide();
      return;
    }
    // Everything else: block, don't process.
    evt.preventDefault();
    evt.stopPropagation();
    return;
  }

  if (evt.key !== '?') return;
  const opened = tryShowKeyHelpOverlay();
  if (opened === 'ok') {
    evt.preventDefault();
    return;
  }
  if (opened === 'blocking') {
    // Briefing / Crash / System start / Resume / Character-select own focus — silently drop
    // `?` rather than stacking yet another overlay over them.
    evt.preventDefault();
  }
}

function helpScopeForRunState() {
  const run = currentScene();
  if (!run) return null;
  if (run.state === CAMPAIGN_STATE.HUB) return 'hub';
  if (run.state === RUN_STATE.COMBAT) return 'combat';
  return null;
}

function isAnyBlockingModalOpen() {
  if (briefingEl?.isOpen) return true;
  if (crashEl?.isOpen) return true;
  if (systemStartEl?.isOpen) return true;
  if (crewRosterEl?.isOpen) return true;
  if (finnShopEl?.isOpen) return true;
  if (itemInventoryEl?.isOpen) return true;
  // <confirmation-modal> uses a native <dialog> internally; treat any open
  // attribute as "blocking".
  if (isConfirmationDialogOpen(resumeModalEl)) return true;
  if (isConfirmationDialogOpen(quitCampaignModalEl)) return true;
  return false;
}

// ---------------------------------------------------------------------------

allComponentsReady
  .then(() => {
    boot().catch(err => {
      console.error('[shell] boot failed', err);
      setStatus(`BOOT ERROR — ${err.message}`);
    });
  })
  .catch(err => {
    console.error('[shell] display components failed to load', err);
    setStatus(`BOOT ERROR — ${err.message}`);
  });
