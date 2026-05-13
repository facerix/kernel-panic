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
import { FACTION } from '/src/game/constants.js';
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
import { applyIntent } from '/src/input/applyIntent.js';

import '/components/ConfirmationModal.js';
import '/components/UpdateNotification.js';
import '/components/TouchPad.js';
import '/components/RunBriefing.js';
import '/components/CrashDump.js';
import '/components/SystemStart.js';
import '/components/CrewRoster.js';
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
let briefingEl, crashEl, systemStartEl, resumeModalEl, touchPadEl;
let crewRosterEl, keyHelpEl;
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

let pendingContract = null;
let pendingJobResult = null;

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
  customElements.whenDefined('touch-pad'),
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
  touchPadEl = document.getElementById('touch-pad');
  crewRosterEl = document.getElementById('crew-roster');
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

  briefingEl.addEventListener('jack-in', onJackIn);
  crashEl.addEventListener('new-run', onNewRunRequested);
  systemStartEl?.addEventListener('hub-enter', onSystemStartHubEnter);

  if (crewRosterEl) {
    crewRosterEl.addEventListener('deploy', onCrewDeployPicked);
    crewRosterEl.addEventListener('dismiss', () => crewRosterEl.hide());
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
  pendingContract = null;
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
  flash('HUB — Curator has contracts when you are adjacent [i].');
}

function presentCrewRoster(mode) {
  if (!crewRosterEl || !campaign) return;
  crewRosterEl.setCrew(campaign.crew, { mode, salvage: campaign.salvage });
  crewRosterEl.show();
}

function onCrewDeployPicked(evt) {
  if (!campaign || !pendingContract) return;
  const memberId = evt?.detail?.memberId;
  const member = campaign.getCrewMember(memberId);
  if (!member || member.flatlined) return;
  crewRosterEl.hide();
  campaign.deployCrewMember(member.id, pendingContract);
  const activeRun = campaign.activeRun;
  briefingEl.setContract(pendingContract);
  flash(`CURATOR: ${member.callsign} takes ${pendingContract.label}.`);
  pendingContract = null;
  attachVisionListener();
  attachAnimationListeners();
  renderShell();
  if (activeRun?.state !== RUN_STATE.BRIEFING) {
    throw new Error(`[shell] expected deployed run to enter BRIEFING, got ${activeRun?.state}`);
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
    attachVisionListener();
    attachAnimationListeners();
    recomputeVision();
    if (campaign.activeRun?.state === RUN_STATE.BRIEFING && campaign.activeRun.contract) {
      briefingEl.setContract(campaign.activeRun.contract);
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

function handleIntent(intent) {
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
    onInteract: handleInteract,
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
  if (campaign.state !== CAMPAIGN_STATE.HUB) {
    flash('Nothing to interact with here.');
    return;
  }
  if (campaign.terminal && isChebyshevAdjacent(campaign.player, campaign.terminal)) {
    flash('TERMINAL — crew roster.');
    presentCrewRoster('view');
    return;
  }
  if (!campaign.curator || !isChebyshevAdjacent(campaign.player, campaign.curator)) {
    flash('Step adjacent to the Curator (contract) or Terminal (roster).');
    return;
  }
  pendingContract = campaign.curator.generateContract(campaign.rng);
  flash(`CURATOR: ${pendingContract.label} — choose crew.`);
  presentCrewRoster('deploy');
}

function onJackIn() {
  const run = campaign?.activeRun;
  if (!run || run.state !== RUN_STATE.BRIEFING) return;
  run.enterCombat();
  handlePersist();
  // enterCombat rebuilds bus + world; re-attach the vision listener so live
  // entity moves keep refreshing fog-of-war.
  attachVisionListener();
  attachAnimationListeners();
  recomputeVision();
  flash('JACKED IN. Reach the exit tile (¤) before the drones drop you.');
  renderShell();
}

function onNewRunRequested() {
  if (!campaign) return;
  if (pendingJobResult) {
    const { outcome } = pendingJobResult;
    pendingJobResult = null;
    campaign.onJobEnd({ outcome });
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
    run.bus.on(EVENT.ENTITY_DAMAGED, ({ target, source }) => {
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
      canvas.hidden = true;
      briefingEl.show();
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
  const identity =
    run.state === RUN_STATE.COMBAT
      ? `${run.player.callsign ?? run.archetype} ${run.archetype.toUpperCase()}`
      : `CREW ${campaign.crew.filter(member => !member.flatlined).length}/${campaign.crew.length} SALVAGE ${campaign.salvage}`;
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
    if (run.curator && isChebyshevAdjacent(run.player, run.curator)) {
      return 'CURATOR — press [i] for a contract.';
    }
    if (run.terminal && isChebyshevAdjacent(run.player, run.terminal)) {
      return 'TERMINAL — press [i] for roster.';
    }
    return '';
  }
  if (run.state === RUN_STATE.COMBAT && run.exitTile) {
    const d = chebyshevDistance(run.player, run.exitTile);
    // d === 0 fires `Run.#onEntityMoved` → enterResult on the same tick, so
    // by the time the next paint runs we're in RESULT — covered by the
    // outer state gate. Adjacency is the warning that you can JACK OUT next
    // step.
    if (d === 1) return 'EXIT (¤) one step away.';
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
  // <confirmation-modal> uses a native <dialog> internally; treat any open
  // attribute as "blocking".
  if (resumeModalEl?.hasAttribute('open')) return true;
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
