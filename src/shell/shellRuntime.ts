/**
 * Game shell runtime — state and orchestration extracted from index.ts.
 */
import dataStore from '/src/DataStore.js';
import { serviceWorkerManager } from '/src/ServiceWorkerManager.js';
import type {
  UpdateAvailableDetail,
  UpdateRestartRequiredDetail,
} from '/src/ServiceWorkerManager.js';

import { Campaign, CAMPAIGN_STATE, willEndCampaignAfterResult } from '/src/game/Campaign.js';
import { buildCampaignSummary } from '/src/game/campaignSummary.js';
import { totalSalvage, formatSalvageCompact } from '/src/game/salvage.js';
import {
  collectConsumablePickup,
  collectKeycardPickup,
  collectCorpseSalvage,
} from '/src/game/lootCollection.js';
import { RUN_STATE, Run } from '/src/game/Run.js';
import { restoreCampaign, snapshotCampaign } from '/src/game/persistence.js';
import { runCorpTurn as driveCorpTurn } from '/src/game/corpTurnDriver.js';
import {
  FACTION,
  AP_COST,
  TILE,
  REP,
  REP_LABEL,
  INCENDIARY_THROW_DIST,
  BREACHING_CHARGE_RANGE,
} from '/src/game/constants.js';
import {
  advanceFromPlayerTurn,
  drivePlayerAftermath,
  formatPlayerAftermathStepLogLines,
  isPlayerAftermathStepLogVisible,
} from '/src/game/combatTurnPipeline.js';
import {
  corpTurnStatusBody,
  countVisibleCorpEntities,
  formatCorpTurnStep,
  isCorpTurnStepLogVisibleToPlayer,
  isCorpTurnStepVisibleToPlayer,
} from '/src/game/corpTurnStatusCopy.js';
import { VisionField } from '/src/game/Vision.js';
import { describeTileAt } from '/src/game/describe.js';
import { AsciiRenderer } from '/src/render/AsciiRenderer.js';
import { CrtFilter } from '/src/render/CrtFilter.js';
import {
  ANIMATION_DURATIONS,
  createAnimationLock,
  runIncendiaryImpactFlash,
  runInteractSecuredFlash,
  triggerHealFlash,
  triggerShake,
} from '/src/render/animations.js';
import { Interactable } from '/src/game/entities/Interactable.js';
import { KeyboardController } from '/src/input/KeyboardController.js';
import { AIM_KIND, MODE } from '/src/input/keymap.js';
import { applyIntent, PLAYER_ACTIONS } from '/src/input/applyIntent.js';
import { recordStatusActionLine } from '/src/statusActivityRows.js';

import { placeSmoke } from '/src/game/Smoke.js';
import { placeHazardCluster } from '/src/game/Run.js';
import { blastCells } from '/src/game/breachBlast.js';
import { resolveIncendiaryImpact } from '/src/game/incendiary.js';
import { ITEM_ID, SCOREABLE_ITEMS, getItemById } from '/src/game/items.js';
import type { CampaignSnapshot } from '/src/game/persistence.js';
import type { Contract } from '/src/game/hub/Curator.js';
import { principalLabelFor } from '/src/game/hub/Curator.js';
import {
  formatHubArcStatusLines,
  scorePrincipalId,
  scoreTargetSiteId,
} from '/src/game/hub/arcSurface.js';
import {
  commitHubReveal,
  hubRevealCommitsOnDismiss,
  isTerminalAccessible,
  type HubRevealId,
} from '/src/game/hub/hubReveals.js';
import type { Crew } from '/src/game/Crew.js';
import { resolveEntityLabel, type Entity } from '/src/game/Entity.js';
import type { JackOutRequest, RunResult, RunTelemetry, Outcome } from '/src/game/Run.js';
import type { Item } from '/src/game/items.js';
import type { Intent } from '/src/input/applyIntent.js';
import type { AimKind } from '/src/input/keymap.js';
import {
  pipCameraFor,
  pipChrome,
  pipFeedFor,
  pipFollowTargetOf,
  pipWorldOf,
  shouldShowPip,
} from '/src/render/pip.js';
import type { KeyItem, TurnActionStep } from '/src/types.js';
import { installErrorBoundary, type FaultSignal } from '/src/errorBoundary.js';
import { isDevelopmentMode } from '/src/domUtils.js';
import {
  activeActorOf,
  activeTileset,
  activeWorldOf,
  cyberLayerOf,
  isCyberView,
  pickActiveVisionField,
} from '/src/shell/activeView.js';
import { buildCombatHudSnapshot } from '/src/shell/combatHudSnapshot.js';
import { perkAimForArchetype, type PerkAim } from '/src/game/archetypes/index.js';
import { buildHubHudRows, currentLocationLabel } from '/src/shell/locationHud.js';
import { SceneListenerController } from '/src/shell/sceneListeners.js';
import { isRun, resolveSceneView, type ShellScene } from '/src/shell/sceneView.js';
import {
  escapeHtml,
  formatAlertTag,
  formatHazardTag,
  formatStatusLine,
  hostileMoodTag,
  isHostileTurnSlice,
  isPlayerTurnSlice,
  joinStatusParts,
  stateLabelForSceneState,
} from '/src/shell/statusLine.js';
import { applyMeatSeenRecord, syncVisionFields } from '/src/shell/visionSync.js';
import { audioManager, musicDirector } from '/src/audio/soundBoard.js';
import { EXTRACTION_MOTIF, TRANSACTION_MOTIF } from '/src/audio/sounds.js';
import {
  HUB_PALETTE,
  HUB_TENSION,
  paletteForRun,
  tensionForAlarmPhase,
} from '/src/shell/musicScore.js';
import type {
  ChronicleArchiveElement,
  ClinicModalElement,
  ConfirmationModalElement,
  ContractSelectElement,
  CrashDumpElement,
  CrewRosterElement,
  CuratorBriefingElement,
  FaultScreenElement,
  FinnShopElement,
  GameOverElement,
  InitialRecruitElement,
  InputState,
  CombatInventoryElement,
  CrewInventoryElement,
  KeyHelpElement,
  KeyItemView,
  RunBriefingElement,
  SettingsModalElement,
  SystemStartElement,
  TouchPadElement,
  UpdateNotificationElement,
} from '/src/shell/domTypes.js';

import KeyHelp from '/components/KeyHelp.js';

type PointLike = Pick<Entity, 'x' | 'y'> | { x: number; y: number } | null | undefined;
type HelpScope = import('/src/shell/domTypes.js').HelpScope;

type PendingJobResult = {
  outcome: Outcome;
  telemetry: RunTelemetry & { outcome: Outcome };
};

/** Dev-only: `?triggerFault=corp` throws once on the next corp turn (see phase-2.6-plan). */
let devFaultTrigger: string | null = null;
let devFaultConsumed = false;

function initDevFaultTrigger(): void {
  if (!isDevelopmentMode()) return;
  const param = new URLSearchParams(location.search).get('triggerFault');
  if (!param) return;
  devFaultTrigger = param;
  if (param === 'rejection') {
    devFaultConsumed = true;
    Promise.reject(new Error('[dev] triggerFault=rejection'));
  }
}

function maybeDevFault(site: string): void {
  if (!devFaultTrigger || devFaultConsumed || devFaultTrigger !== site) return;
  devFaultConsumed = true;
  throw new Error(`[dev] triggerFault=${site}`);
}

let campaign: Campaign | null = null;
let vision = new VisionField();
/**
 * P3.M3.6: the cyber grid's own fog field — `vision` stays Meatspace-truth
 * for the body (aftermath visibility, meat corpse memory) while the avatar
 * sees through this one. Rebuilt (and re-seeded from `layer.mapSeen`) every
 * time the cyber listeners attach.
 */
let cyberVision = new VisionField();
let sceneListenerController: SceneListenerController;
let civilianHarmsThisJob = 0;

let canvas: HTMLCanvasElement;
/** P3.M3.7: meatspace CCTV overlay while jacked in. */
let pipCanvas: HTMLCanvasElement;
let statusEl: HTMLElement | null = null;
let renderer: AsciiRenderer;
let pipRenderer: AsciiRenderer;
let crt: CrtFilter;
let stageEl: HTMLElement;
let briefingEl: RunBriefingElement;
let contractSelectEl: ContractSelectElement;
let crashEl: CrashDumpElement;
let gameOverEl: GameOverElement;
let faultEl: FaultScreenElement;
let systemStartEl: SystemStartElement;
let curatorBriefingEl: CuratorBriefingElement;
/** Status line to flash after the player dismisses a Hub reveal briefing. */
let hubRevealFollowUpFlash: string | null = null;
/** Score reveal (and future deferred reveals) commit their flag on dismiss. */
let pendingHubRevealId: HubRevealId | null = null;
let initialRecruitEl: InitialRecruitElement;
let confirmationModalEl: ConfirmationModalElement;
let touchPadEl: TouchPadElement;
let crewRosterEl: CrewRosterElement;
let finnShopEl: FinnShopElement;
let clinicModalEl: ClinicModalElement;
let settingsModalEl: SettingsModalElement;
let combatInventoryEl: CombatInventoryElement;
let crewInventoryEl: CrewInventoryElement;
let chronicleArchiveEl: ChronicleArchiveElement;
let keyHelpEl: KeyHelpElement;
let updateNotificationEl: UpdateNotificationElement;
let logEl: HTMLElement;
let logHeaderEl: HTMLElement;
let logContentEl: HTMLPreElement;
let keyboard: KeyboardController;

let currentJobOptions: Contract[] = [];

/**
 * Animation-lock for combat feedback. Listeners on the run bus
 * (`attachAnimationListeners`) push durations as effects fire; both
 * input controllers consult `isLocked()` so a key held mid-shake doesn't
 * sneak through. See `src/render/animations.js`.
 */
const animLock = createAnimationLock();

let pendingJobResult: PendingJobResult | null = null;
/** Latched during tier-1 fault recovery — blocks autosave and stale turn pumps. */
let degrading = false;
/** Set when degradeToHub successfully re-read hub state from disk. */
let faultHubRestored = false;
/** Bumped to invalidate in-flight corp/aftermath setTimeout pumps after a fault. */
let combatPumpGeneration = 0;

function invalidateCombatPumps(): void {
  combatPumpGeneration += 1;
  animLock.reset();
}

function scheduleCombatPump(fn: () => void, ms: number): void {
  const generation = combatPumpGeneration;
  setTimeout(() => {
    if (generation !== combatPumpGeneration || degrading) return;
    fn();
  }, ms);
}
/** Hazard-glyph blast flash — cleared on a short timer after each detonation. */
let activeBreachBlastOverlayKeys = new Set<string>();
let breachBlastOverlayTimer: ReturnType<typeof setTimeout> | null = null;

function clearBreachBlastOverlay(repaint = false): void {
  if (breachBlastOverlayTimer) {
    clearTimeout(breachBlastOverlayTimer);
    breachBlastOverlayTimer = null;
  }
  if (activeBreachBlastOverlayKeys.size === 0) return;
  activeBreachBlastOverlayKeys.clear();
  if (repaint) paint();
}

function showBreachBlastOverlay(cx: number, cy: number): void {
  clearBreachBlastOverlay(false);
  for (const { x, y } of blastCells(cx, cy)) {
    activeBreachBlastOverlayKeys.add(`${x},${y}`);
  }
  breachBlastOverlayTimer = setTimeout(() => {
    breachBlastOverlayTimer = null;
    activeBreachBlastOverlayKeys.clear();
    paint();
  }, ANIMATION_DURATIONS.BREACH_BLAST_OVERLAY);
}

/**
 * Recent intent-result log lines (melee, fire, perk use, denials, etc.).
 * Stored newest-first, then rendered oldest-to-newest so a single interaction
 * burst stays readable: terminal side effects (door unlock, alarm/Rep) remain
 * visible beside the terminal result instead of disappearing into the log.
 */
let actionLineHistory: string[] = [];
let pendingActionLineCount = 0;
let priorityFlashLine: string | null = null;
let lookCursor: { x: number; y: number } | null = null;

/**
 * Plain-text body after `CORP —` from the last status paint while the queue
 * belonged to CORP. Surfaced again on the player slice until `flash()` runs
 * on the player's turn (new feedback replaces it; avoids snapping the third
 * row back to a stale `lastActionLine` from before the yield).
 */
let corpToneActivityBody: string | null = null;

/**
 * Rolling game-log buffer (newest first in `logLines`).
 * Tracked at module level because `applyIntent`'s `log` callback fires
 * during intent handling, but the status line is finalised later in
 * `paint()` — without this, the action line gets clobbered by the
 * subsequent statusLine() rewrite.
 */
let logLines: string[] = [];

const seedFromClock = () => Date.now() & 0xffffffff;

function mustGetElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`[shell] required element #${id} is missing`);
  }
  return el as T;
}

function mustQuery<T extends Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector(selector);
  if (!el) {
    throw new Error(`[shell] required selector "${selector}" is missing`);
  }
  return el as T;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function activeVisionField(scene: ShellScene | null): VisionField {
  return pickActiveVisionField(scene, vision, cyberVision);
}

function initSceneListenerController(): void {
  sceneListenerController = new SceneListenerController({
    getScene: currentScene,
    getCampaign: () => campaign,
    getMeatVision: () => vision,
    getCyberVision: () => cyberVision,
    resetCyberVision: () => {
      cyberVision = new VisionField();
      return cyberVision;
    },
    dom: { stageEl, pipCanvas },
    renderers: { main: renderer, pip: pipRenderer },
    animLock,
    effects: {
      flash,
      paint,
      paintPip,
      recomputeVision,
    },
    onCivilianHarmReset: () => {
      civilianHarmsThisJob = 0;
    },
    onCivilianHarmed: killed => {
      if (killed) civilianHarmsThisJob++;
    },
    onRepAdjust: (actual, reason) => {
      flash(`REP ${actual >= 0 ? '+' : ''}${actual}: ${reason}`);
    },
    onAlarmTransition: () => {},
    onObjectiveTimerExpired: () => {},
    memoriseMeatCorpse: (target, isVisible) => {
      if (isVisible(target.x, target.y)) {
        vision.memoriseCorpse(target);
      }
    },
    memoriseCyberCorpse: (target, isVisible) => {
      if (isVisible(target.x, target.y)) {
        cyberVision.memoriseCorpse(target);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export async function boot() {
  canvas = mustGetElement<HTMLCanvasElement>('game-canvas');
  const gameStage = canvas.closest('.game-stage');
  if (!(gameStage instanceof HTMLElement)) {
    throw new Error('[shell] #game-canvas must live inside .game-stage');
  }
  stageEl = gameStage;
  statusEl = mustGetElement<HTMLElement>('game-status');
  contractSelectEl = mustGetElement<ContractSelectElement>('contract-select');
  briefingEl = mustGetElement<RunBriefingElement>('briefing');
  crashEl = mustGetElement<CrashDumpElement>('crash');
  gameOverEl = mustGetElement<GameOverElement>('game-over');
  faultEl = mustGetElement<FaultScreenElement>('fault-screen');
  systemStartEl = mustGetElement<SystemStartElement>('system-start');
  curatorBriefingEl = mustGetElement<CuratorBriefingElement>('curator-briefing');
  initialRecruitEl = mustGetElement<InitialRecruitElement>('initial-recruit');
  confirmationModalEl = mustGetElement<ConfirmationModalElement>('confirm-modal');
  touchPadEl = mustGetElement<TouchPadElement>('touch-pad');
  crewRosterEl = mustGetElement<CrewRosterElement>('crew-roster');
  finnShopEl = mustGetElement<FinnShopElement>('finn-shop');
  clinicModalEl = mustGetElement<ClinicModalElement>('clinic-modal');
  settingsModalEl = mustGetElement<SettingsModalElement>('settings-modal');
  combatInventoryEl = mustGetElement<CombatInventoryElement>('combat-inventory');
  crewInventoryEl = mustGetElement<CrewInventoryElement>('crew-inventory');
  chronicleArchiveEl = mustGetElement<ChronicleArchiveElement>('chronicle-archive');
  keyHelpEl = mustGetElement<KeyHelpElement>('key-help');
  logEl = mustQuery<HTMLElement>('.game-log');
  logHeaderEl = mustQuery<HTMLElement>('.game-log h3');
  logContentEl = mustQuery<HTMLPreElement>('pre', logEl);

  renderer = new AsciiRenderer(canvas);
  pipCanvas = mustGetElement<HTMLCanvasElement>('pip-canvas');
  pipRenderer = new AsciiRenderer(pipCanvas, { cellSize: 10, fontSize: 9 });
  crt = new CrtFilter(canvas);
  initSceneListenerController();

  keyboard = new KeyboardController({
    onIntent: (intent: Intent) => {
      handleIntent(intent);
      paint();
    },
    onModeChange: () => {
      // Keep the keyboard / touchpad in lock-step so cross-input cancel still holds.
      handleInputModeChange();
      paint();
    },
    isBlocked: () => animLock.isLocked() || isAnyBlockingModalOpen(),
    getSpecialAim: currentSpecialAim,
  });
  keyboard.attach();

  // `?` and Esc-for-help live above the keymap: `?` is a UI toggle (not a
  // game intent), and Esc must reach <key-help> before the keymap turns it
  // into a `cancel` intent. Capture phase + a return-early when the help
  // panel is open keeps both behaviours clean.
  window.addEventListener('keydown', handleGlobalKey, true);

  // Web Audio can't produce sound until a context is created/resumed after a
  // user gesture. Resume on the first keydown or pointerdown, then unsubscribe —
  // this covers every entry path (new campaign, resume, keyboard-only, touch).
  const resumeAudio = () => {
    audioManager.resume();
    // The scene is usually already up by the time the player touches anything,
    // and scene transitions before this point started a director that had no
    // audio clock to schedule against. Re-sync now that one exists.
    syncMusicToScene();
    window.removeEventListener('keydown', resumeAudio, true);
    window.removeEventListener('pointerdown', resumeAudio, true);
  };
  window.addEventListener('keydown', resumeAudio, true);
  window.addEventListener('pointerdown', resumeAudio, true);

  // Pause the score whenever the game loses the player's attention. Both event
  // families are needed, because neither covers the other:
  //   - `visibilitychange` fires when the tab is switched away or minimized, but
  //     NOT when the player alt-tabs to another application (the tab stays
  //     "visible" — it is simply behind another window).
  //   - window `blur`/`focus` catch that case, but do not fire reliably on tab
  //     switches in every browser.
  // `document.hasFocus()` is the reconciling read: it is false in both cases.
  //
  // SFX are deliberately left alone. They only fire in response to the player's
  // own actions, so an unattended tab produces none anyway — and silencing the
  // master gain would also mute the audio the player *does* trigger on return.
  const syncMusicToFocus = () => {
    const attended = document.visibilityState === 'visible' && document.hasFocus();
    audioManager.setMusicSuspended(!attended);
    if (attended) {
      // Re-derives palette/tension and restarts the director, whose beat clock
      // re-anchors to now rather than backfilling the time spent away.
      syncMusicToScene();
    } else {
      musicDirector.stop();
    }
  };
  window.addEventListener('blur', syncMusicToFocus);
  window.addEventListener('focus', syncMusicToFocus);
  document.addEventListener('visibilitychange', syncMusicToFocus);

  contractSelectEl.addEventListener('contract-selected', onContractSelected);
  contractSelectEl.addEventListener('dismiss', () => contractSelectEl.hide());
  briefingEl.addEventListener('deploy', onBriefingDeploy);
  briefingEl.addEventListener('dismiss', onBriefingDismiss);
  crashEl.addEventListener('new-run', onNewRunRequested);
  gameOverEl.addEventListener('new-run', onNewRunRequested);
  faultEl.addEventListener('return-to-hub', () => onFaultReturnToHub());
  systemStartEl.addEventListener('hub-enter', onSystemStartHubEnter);
  curatorBriefingEl.addEventListener('dismiss', onCuratorBriefingDismiss);
  initialRecruitEl.addEventListener('recruited', onInitialRecruited);

  crewRosterEl.addEventListener('dismiss', () => crewRosterEl.hide());
  crewRosterEl.addEventListener('recruit', onCrewRecruit);

  finnShopEl.addEventListener('purchase', onFinnPurchase);
  finnShopEl.addEventListener('sell-salvage', onFinnSellSalvage);
  finnShopEl.addEventListener('dismiss', () => finnShopEl.hide());

  clinicModalEl.addEventListener('heal', onClinicHeal);
  clinicModalEl.addEventListener('dismiss', onClinicDismiss);

  settingsModalEl.addEventListener('dismiss', () => settingsModalEl.hide());

  combatInventoryEl.addEventListener('use-item', onUseItem);
  combatInventoryEl.addEventListener('dismiss', () => combatInventoryEl.hide());
  crewInventoryEl.addEventListener('dismiss', () => crewInventoryEl.hide());
  chronicleArchiveEl.addEventListener('dismiss', () => chronicleArchiveEl.hide());

  keyHelpEl.addEventListener('dismiss', () => keyHelpEl.hide());

  const settingsToggleEl = document.getElementById('settings-toggle');
  if (settingsToggleEl) {
    settingsToggleEl.addEventListener('click', () => toggleSettingsModal());
  }

  const keyHelpToggleEl = document.getElementById('key-help-toggle');
  if (keyHelpToggleEl) {
    keyHelpToggleEl.addEventListener('click', () => {
      if (keyHelpEl.isOpen) {
        keyHelpEl.hide();
        return;
      }
      tryShowKeyHelpOverlay();
    });
  }
  // UI click feedback (P3.6): one observer plays `uiClick` whenever any of the
  // interactive modals toggles its `open` attribute — open or close, however it
  // was triggered (button, key, backdrop, Esc). Flow/state screens (crash,
  // game-over, fault, system-start) and the native confirm <dialog> are
  // excluded — they aren't user-toggled panels.
  const uiClickModals: HTMLElement[] = [
    contractSelectEl,
    briefingEl,
    crewRosterEl,
    finnShopEl,
    clinicModalEl,
    settingsModalEl,
    combatInventoryEl,
    crewInventoryEl,
    chronicleArchiveEl,
    keyHelpEl,
  ];
  const modalOpenState = new WeakMap<HTMLElement, boolean>();
  for (const el of uiClickModals) modalOpenState.set(el, el.hasAttribute('open'));
  const uiClickObserver = new MutationObserver(records => {
    for (const rec of records) {
      const el = rec.target as HTMLElement;
      const open = el.hasAttribute('open');
      // Dedupe: a same-value setAttribute still queues a record.
      if (modalOpenState.get(el) === open) continue;
      modalOpenState.set(el, open);
      audioManager.play(open ? 'modalOpen' : 'modalClosed');
    }
  });
  for (const el of uiClickModals) {
    uiClickObserver.observe(el, { attributes: true, attributeFilter: ['open'] });
  }

  confirmationModalEl.addEventListener('confirm', evt => {
    const detail = (evt as CustomEvent<{ context?: string }>).detail;
    switch (detail?.context) {
      case 'resume-campaign':
        // not currently implemented
        break;
      case 'quit-campaign':
        performQuitCampaign();
        break;
      case 'abort-run':
        const run = campaign?.activeRun;
        if (run) {
          run.confirmAbort();
          paint();
        }
        break;
      case 'jack-out-early': {
        const activeRun = campaign?.activeRun;
        if (activeRun) {
          activeRun.confirmJackOut();
        }
        break;
      }
    }
  });

  touchPadEl.addEventListener('intent', evt => {
    handleIntent((evt as CustomEvent<Intent>).detail);
    paint();
  });
  touchPadEl.addEventListener('mode-change', () => {
    handleInputModeChange();
    paint();
  });
  touchPadEl.setBlocked(() => animLock.isLocked() || isAnyBlockingModalOpen());
  touchPadEl.setSpecialAim(currentSpecialAim);

  logHeaderEl.addEventListener('click', () => {
    logEl.classList.toggle('collapsed');
  });

  // Update-notification wiring kept from the original scaffold.
  updateNotificationEl = mustQuery<UpdateNotificationElement>('update-notification');
  window.addEventListener('sw-update-available', event => {
    const detail = (event as CustomEvent<UpdateAvailableDetail>).detail;
    showUpdateWhenStable(() => updateNotificationEl.show(detail));
  });
  window.addEventListener('sw-update-restart-required', event => {
    const detail = (event as CustomEvent<UpdateRestartRequiredDetail>).detail;
    showUpdateWhenStable(() => updateNotificationEl.showRestartRequired(detail.release));
  });
  window.addEventListener('sw-update-error', event => {
    const detail = (event as CustomEvent<{ message: string }>).detail;
    showUpdateWhenStable(() => updateNotificationEl.showUnavailable(detail.message));
  });
  window.addEventListener('sw-update-progress', event => {
    const detail = (event as CustomEvent<{ status: string }>).detail;
    updateNotificationEl.showUpdating(detail.status);
  });
  updateNotificationEl.addEventListener('update-accepted', event => {
    const pendingWorker = (event as CustomEvent<{ pendingWorker: ServiceWorker }>).detail
      .pendingWorker;
    activateUpdateSafely(pendingWorker);
  });
  updateNotificationEl.addEventListener('update-restart-requested', () => {
    restartWithValidatedSave();
  });

  await dataStore.init();
  initDevFaultTrigger();
  installErrorBoundary({ target: window, degrade: degradeToHub });
  if (dataStore.currentRun) {
    dataStore.deleteRun(dataStore.currentRun.id);
  }
  if (dataStore.currentCampaign) {
    resumeCampaign(dataStore.currentCampaign);
  } else {
    startFreshCampaign();
  }

  // SW registration is the same posture as the debug scaffold — kicked off last
  // so it doesn't gate the shell's first paint.
  serviceWorkerManager.register().catch(err => console.warn('[shell] sw register failed', err));
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function startFreshCampaign() {
  hideBlockingShellModals();
  campaign = new Campaign({
    seed: seedFromClock(),
    crew: [],
    onPersist: handlePersist,
    onResult: handleResult,
    unlockedArchetypeIds: dataStore.unlockedArchetypes,
    // Showcase-slot follow-up (2026-07-14): peek, don't consume yet — the
    // pending flag is only cleared once campaign-start recruitment actually
    // commits (onInitialRecruited), so an abandoned/reloaded attempt at this
    // screen doesn't burn the showcase before the player ever sees it.
    showcaseArchetypeId: dataStore.pendingArchetypeShowcase,
  });

  pendingJobResult = null;
  setStatus('Booting Meatspace…');
  systemStartEl.setSession({ seed: campaign.seed });
  systemStartEl.show();
}

function onSystemStartHubEnter() {
  systemStartEl.hide();
  if (!campaign) return;
  // Fresh campaign: crew is empty — show initial recruitment overlay.
  if (campaign.crew.length === 0) {
    const candidates = campaign.generateInitialCandidates();
    initialRecruitEl.setCandidates(candidates);
    initialRecruitEl.show();
    return;
  }
  // Resumed or post-recruitment — go straight to hub.
  enterHubAndRender();
}

function onInitialRecruited(evt: Event) {
  if (!campaign) return;
  const { memberIds } = (evt as CustomEvent<{ memberIds: string[] }>).detail;
  campaign.recruitInitial(memberIds);
  // Showcase-slot follow-up (2026-07-14): the reserved candidate's job was to
  // be *offered*, not necessarily picked — clear the pending flag the moment
  // campaign-start recruitment actually commits, regardless of which two
  // candidates were chosen, so it doesn't linger for a future campaign.
  dataStore.clearPendingArchetypeShowcase();
  initialRecruitEl.hide();
  // Now the crew is set — enter the hub for the first time (builds world, persists).
  campaign.enterHub();
  enterHubAndRender();
  const names = campaign.crew.map(m => m.callsign).join(' and ');
  flash(`CURATOR: ${names} on the board. Find me when you want work.`);
}

function hideResultOverlays(): void {
  crashEl?.hide();
  gameOverEl?.hide();
}

function hideBlockingShellModals(): void {
  keyHelpEl?.hide();
  briefingEl?.hide();
  hideResultOverlays();
  contractSelectEl?.hide();
  systemStartEl?.hide();
  curatorBriefingEl?.hide();
  initialRecruitEl?.hide();
  crewRosterEl?.hide();
  finnShopEl?.hide();
  clinicModalEl?.hide();
  combatInventoryEl?.hide();
  crewInventoryEl?.hide();
  chronicleArchiveEl?.hide();
}

function abortShellForFault(): void {
  hideBlockingShellModals();
  invalidateCombatPumps();
  pendingJobResult = null;
  hubRevealFollowUpFlash = null;
  pendingHubRevealId = null;
  corpToneActivityBody = null;
  clearBreachBlastOverlay(false);
  resetInputModes();
  civilianHarmsThisJob = 0;
}

function hubSnapshotFromLastGoodSave(saved: CampaignSnapshot): CampaignSnapshot {
  return {
    ...saved,
    state: CAMPAIGN_STATE.HUB,
    activeRun: null,
    deployedMemberId: null,
  };
}

function degradeToHub(signal: FaultSignal): void {
  degrading = true;
  faultHubRestored = false;
  try {
    abortShellForFault();

    const saved = dataStore.currentCampaign as CampaignSnapshot | null;
    if (!saved) {
      faultEl.show({ code: signal.source });
      return;
    }

    resumeCampaign(hubSnapshotFromLastGoodSave(saved));
    faultHubRestored = true;
    faultEl.show({ code: signal.source });
  } catch (err) {
    try {
      console.error('[shell] degradeToHub failed:', err);
    } catch {
      // ignore
    }
    faultEl.show({ code: signal.source });
  }
}

function onFaultReturnToHub(): void {
  faultEl.hide();
  degrading = false;
  if (faultHubRestored) {
    handlePersist();
    if (campaign?.state === CAMPAIGN_STATE.ENDED) {
      renderShell();
      canvas.focus();
      return;
    }
    enterHubAndRender();
  } else {
    dataStore.deleteCampaign();
    startFreshCampaign();
  }
  canvas.focus();
}

/**
 * Attach listeners and render the hub after enterHub() has been called.
 * Shared by both the post-initial-recruitment path and the normal
 * system-start path (when crew already exists).
 */
/**
 * Show a full-screen Curator briefing for a pending Hub reveal, if any.
 * Defers `followUpFlash` to the status line until the player dismisses the modal.
 */
function presentHubRevealIfAny(followUpFlash: string): boolean {
  if (!campaign?.lastHubReveal) return false;
  const reveal = campaign.lastHubReveal;
  campaign.lastHubReveal = null;
  hubRevealFollowUpFlash = followUpFlash;
  pendingHubRevealId = hubRevealCommitsOnDismiss(reveal.id) ? reveal.id : null;
  curatorBriefingEl.setBriefing({ title: reveal.title, lines: reveal.lines });
  curatorBriefingEl.show();
  return true;
}

function onCuratorBriefingDismiss(): void {
  curatorBriefingEl.hide();
  if (pendingHubRevealId && campaign) {
    commitHubReveal(campaign, pendingHubRevealId);
    pendingHubRevealId = null;
    handlePersist();
  }
  if (hubRevealFollowUpFlash) {
    flash(hubRevealFollowUpFlash);
    hubRevealFollowUpFlash = null;
  }
}

function enterHubAndRender() {
  if (!campaign?.curator) {
    throw new Error('enterHubAndRender: hub not entered — curator is missing.');
  }
  rewireSceneListeners();
  recomputeVision();
  renderShell();
  if (!presentHubRevealIfAny('HUB — Curator has contracts when you are adjacent [Space].')) {
    flash('HUB — Curator has contracts when you are adjacent [Space].');
  }
  // generate job options once on hub enter
  currentJobOptions = generateCurrentJobOptions();
}

function presentCrewRoster() {
  if (!campaign) return;
  campaign.backfillRecruitsIfEligible();
  crewRosterEl.setCrew(campaign.crew, {
    salvage: campaign.salvage,
    campaignStatus: formatHubArcStatusLines(campaign).filter(
      (line): line is string => line !== null
    ),
    availableRecruits: campaign.availableRecruits,
    recruitedThisVisit: campaign.recruitedThisVisit,
  });
  crewRosterEl.show();
}

function presentChronicleArchive() {
  chronicleArchiveEl.setData({
    activeChronicle: campaign
      ? {
          statusLines: formatHubArcStatusLines(campaign).filter(
            (line): line is string => line !== null
          ),
          entries: campaign.chronicle,
        }
      : null,
    history: dataStore.campaignHistory,
    acquisitions: {
      unlocked: dataStore.unlockedScoreableItems.length,
      total: SCOREABLE_ITEMS.length,
    },
  });
  chronicleArchiveEl.show();
}

function onCrewRecruit(evt: Event) {
  if (!campaign) return;
  const { recruitId } = (evt as CustomEvent<{ recruitId: string }>).detail;
  try {
    campaign.recruit(recruitId);
    const member = campaign.getCrewMember(recruitId);
    flash(`NEW OPERATIVE: ${member?.callsign ?? recruitId} joins the collective.`);
    // A replacement Decker can unlock THE SCORE immediately. Preserve the
    // existing three-card board and append only the newly legal finale.
    if (
      campaign.canAttemptScore() &&
      !currentJobOptions.some(contract => contract.context.recipeId === 'score-final')
    ) {
      currentJobOptions.push(
        campaign.buildScoreContract(dataStore.unlockedScoreableItems, dataStore.unlockedArchetypes)
      );
    }
    // Refresh the roster to reflect the new crew + hide recruit section.
    presentCrewRoster();
  } catch (err) {
    flash(`RECRUITMENT FAILED: ${(err as Error).message}`);
  }
}

function presentBriefing(contract: Contract) {
  if (!campaign) return;
  briefingEl.setContract(contract);
  briefingEl.setCrew(campaign.crew);
  briefingEl.show();
}

function presentContractSelect(contracts: Contract[]) {
  contractSelectEl.setScoreTargetSiteId(campaign ? scoreTargetSiteId(campaign) : null);
  contractSelectEl.setScorePrincipalId(campaign ? scorePrincipalId(campaign) : null);
  contractSelectEl.setHeldKeycardPrincipalIds(
    campaign
      ? campaign.keyItems
          .map(k => k.principalId)
          .filter((id): id is string => typeof id === 'string')
      : []
  );
  contractSelectEl.setContracts(contracts);
  contractSelectEl.show();
}

function generateCurrentJobOptions(): Contract[] {
  if (!campaign?.curator) {
    throw new Error('generateCurrentJobOptions: hub not entered — curator is missing.');
  }
  const contracts = campaign.curator.generateContracts(campaign.rng, campaign);
  if (campaign.canAttemptScore()) {
    contracts.push(
      campaign.buildScoreContract(dataStore.unlockedScoreableItems, dataStore.unlockedArchetypes)
    );
  }
  return contracts;
}

function onContractSelected(evt: Event) {
  const { contract } = (evt as CustomEvent<{ contract?: Contract }>).detail;
  if (!contract) return;
  contractSelectEl.hide();
  flash(`CURATOR: ${contract.label} — choose an operative.`);
  presentBriefing(contract);
}

function onBriefingDismiss() {
  briefingEl.hide();
  // Hub briefing (no activeRun yet): dismiss returns to the canvas.
  // Resumed mid-briefing (activeRun in BRIEFING): deployment already
  // committed — re-present the modal instead of leaving a blank screen.
  if (campaign?.activeRun?.state === RUN_STATE.BRIEFING) {
    renderShell();
  }
}

function onBriefingDeploy(evt: Event) {
  if (!campaign) return;
  const { memberId, partnerId, contract } = (
    evt as CustomEvent<{ memberId?: string; partnerId?: string | null; contract?: Contract }>
  ).detail;
  if (!memberId || !contract) return;
  const member = campaign.getCrewMember(memberId);
  if (!member || member.flatlined) return;
  // P3.M4.1: dual-deploy rides a meat partner alongside the Decker.
  const partner = partnerId ? campaign.getCrewMember(partnerId) : null;
  if (partnerId && (!partner || partner.flatlined)) return;
  briefingEl.hide();

  let run = campaign.activeRun;
  if (run?.state === RUN_STATE.BRIEFING) {
    // Resumed save: deployCrewMember already ran before the reload.
    if (run.crewMember.id !== member.id) {
      flash(
        `DEPLOY LOCKED: ${run.crewMember.callsign ?? run.crewMember.id} is slotted for this contract.`
      );
      briefingEl.show();
      return;
    }
  } else {
    run = campaign.deployCrewMember(member.id, contract, partnerId ?? null);
    const partnerNote = partner ? ` + ${partner.callsign ?? partner.id}` : '';
    flash(`CURATOR: ${member.callsign}${partnerNote} takes ${contract.label}. JACKING IN.`);
  }

  // Wire the run's confirmation callbacks (abort extraction, early jack-out).
  wireRunConfirmations(run);

  // Go straight into combat — the player already reviewed the contract and
  // chose their operative in the combined briefing modal.
  if (!run || run.state !== RUN_STATE.BRIEFING) {
    throw new Error(`[shell] expected deployed run to enter BRIEFING, got ${run?.state}`);
  }
  run.enterCombat();
  handlePersist();
  vision.resetFogState();
  if (run.priorSeenKeys.length > 0) {
    vision.restoreSeen(run.priorSeenKeys);
  }
  rewireSceneListeners();
  recomputeVision();
  flash('JACKED IN. Reach the exit tile (¤) before the corpos drop you.');
  renderShell();
}

function presentFinnShop() {
  if (!campaign || !campaign.finn) return;
  // P3.M6.3: stock = default items + scoreable blueprints stolen across all
  // campaigns. Read live from the meta-store so a Score unlock surfaces at the
  // next shop visit; rep no longer influences stock.
  const catalog = campaign.finn.catalog(dataStore.unlockedScoreableItems);
  finnShopEl.setCatalog(catalog, campaign.crew, {
    credits: campaign.credits,
    salvage: campaign.salvage,
  });
  finnShopEl.show();
}

function presentClinic() {
  if (!campaign || !campaign.clinic) return;
  clinicModalEl.setPatients(campaign.crew, {
    credits: campaign.credits,
    healedMemberIds: [...campaign.healedThisVisit],
  });
  clinicModalEl.show();
}

function onClinicHeal(evt: Event) {
  if (!campaign) return;
  const { memberId } = (evt as CustomEvent<{ memberId?: string }>).detail;
  if (!memberId) return;
  const member = campaign.getCrewMember(memberId);
  try {
    campaign.healMember(memberId);
  } catch (err) {
    flash(`HEAL FAILED: ${errorMessage(err)}`);
    return;
  }
  const label = member?.callsign ?? memberId;
  flash(`PATCH: ${label} patched up. CREDS ${campaign.credits}.`);
  // Same `heal` cue as Stim and the Chimera's Nanite Repair — the hub has no
  // Run/bus to route through, so this is a direct call like the rest of this
  // function's effects.
  audioManager.play('heal');
  presentClinic();
}

function onClinicDismiss() {
  clinicModalEl.hide();
}

function onFinnPurchase(evt: Event) {
  if (!campaign) return;
  const { itemId, targetMemberId } = (
    evt as CustomEvent<{
      itemId?: string;
      targetMemberId?: string;
    }>
  ).detail;
  try {
    campaign.purchase({ itemId, targetMemberId });
  } catch (err) {
    flash(`PURCHASE FAILED: ${errorMessage(err)}`);
    return;
  }
  flash(`FINN: Purchased ${itemId}. CREDS ${campaign.credits}.`);
  // Same `transaction` cha-ching for buy and sell — the hub has no Run/bus to
  // route through, so this is a direct call like the Clinic's `heal` cue.
  audioManager.playSequence('transaction', TRANSACTION_MOTIF);
  // Refresh the shop to reflect new balance and purchased meta upgrades.
  presentFinnShop();
}

function onFinnSellSalvage(evt: Event) {
  if (!campaign) return;
  const { quantity, type } = (evt as CustomEvent<{ quantity?: number; type?: string }>).detail;
  try {
    if (quantity === undefined) {
      throw new TypeError('sell-salvage quantity is required');
    }
    const creditsBefore = campaign.credits;
    campaign.sellSalvage(quantity, type as import('/src/game/salvage.js').SalvageType | undefined);
    const earned = campaign.credits - creditsBefore;
    flash(`FINN: Bought ${quantity} salvage for ${earned} Cr.`);
  } catch (err) {
    flash(`SALE FAILED: ${errorMessage(err)}`);
    return;
  }
  // Same `transaction` cha-ching as onFinnPurchase (see comment there).
  audioManager.playSequence('transaction', TRANSACTION_MOTIF);
  presentFinnShop();
}

function presentInventory() {
  if (!campaign) return;
  // Two distinct surfaces for the two states:
  //   - Hub:    <crew-inventory> — the campaign-wide stash (accumulated salvage
  //     + stolen keycards). Read-only; no operator, so no consumables.
  //   - Combat: <combat-inventory> — the deployed operator's live job-scoped
  //     wallet, held keycards, and their navigable consumables list.
  if (campaign.state === CAMPAIGN_STATE.HUB) {
    crewInventoryEl.setContents({
      salvage: campaign.salvage,
      keyItems: keyItemsWithLocation(campaign.keyItems),
    });
    crewInventoryEl.show();
    return;
  }
  const run = campaign.activeRun;
  if (!run || !run.player) return;
  // The active operator owns the live job-scoped wallet — the Decker before
  // jack-in, the partner while jacked in, and whichever crewmate has control
  // after jack-out (the simstim flip swaps `activeActor`). This overlay is
  // gated to Meatspace upstream, so `activeActor` is always a Crew here.
  const operator = activeActorOf(run) as Crew | null;
  if (!operator || !operator.inventory) return;
  combatInventoryEl.setContents({
    salvage: operator.inventory.salvage,
    consumables: operator.inventory.consumables,
    // Combat renders keycards as the generic "Access keycard" — the locked
    // door is in front of you, so no location lookup is needed here. Scope to
    // this run's site so other sites' held cards don't render as phantom
    // duplicates (P3.1).
    keyItems: run.effectiveKeyItems(campaign.keyItems),
  });
  combatInventoryEl.show();
}

/**
 * Enrich key items with their owning principal's name for the inventory tag.
 * Keycards are scoped to a principal (owner), not a single site (P3.1-balance),
 * so the tag names the owner — resolved from the static lexicon, so it renders
 * even after every site that owner controlled has left the roster. Cards with an
 * unknown/absent principal simply render without a tag.
 */
function keyItemsWithLocation(items: KeyItem[]): KeyItemView[] {
  return items.map(item => {
    const locationName = item.principalId ? principalLabelFor(item.principalId) : null;
    if (!locationName) return { ...item };
    return { ...item, locationName };
  });
}

/**
 * Stashed item id for thrown-consumable aim flow. Set when the
 * inventory overlay confirmed an aimed consumable (incendiary) and we
 * flipped the input controllers into `MODE.AIM` with `aimKind: 'use-item'`;
 * consumed when the subsequent `use-item { dx, dy }` intent arrives or cleared
 * on cancel.
 *
 * Kept at module scope (not inside `onUseItem`) because the aim resolution
 * happens in a separate event tick from the inventory click — the keypress
 * routes through KeyboardController → applyIntent → ctx.onUseItem.
 */
let pendingAimItemId: string | null = null;

function onUseItem(evt: Event) {
  if (!campaign) return;
  const run = campaign.activeRun;
  if (!run || !run.player) return;
  if (!run.world) throw new Error('[shell] active combat run has no world');
  // Consumables act through whichever operator currently has control — the
  // Decker before jack-in, the partner while jacked in, the flipped-to crewmate
  // after jack-out. Routing through `run.player` would apply the item to the
  // frozen Decker body whenever the partner is the one in control.
  const operator = activeActorOf(run) as Crew;
  const { itemId } = (evt as CustomEvent<{ itemId?: string }>).detail;
  if (!itemId) return;
  // Aimed consumables (incendiary): close the inventory overlay, switch the
  // input controllers into unified aim mode, and wait for the next direction.
  // Crew.useConsumable will be called from `resolveAimedUseItem` once the
  // aim direction is in.
  let descriptor: Item;
  try {
    descriptor = getItemById(itemId) as Item;
  } catch (err) {
    flash(`USE FAILED: ${errorMessage(err)}`);
    return;
  }
  if (descriptor.needsAim) {
    if (!operator.canAfford(AP_COST.INTERACT)) {
      // Cheap pre-check: don't strand the player in aim mode if `useConsumable`
      // will reject the commit anyway. Crew's `canAfford(AP_COST.INTERACT)`
      // remains the source of truth at commit time.
      flash('USE FAILED: insufficient AP.');
      return;
    }
    pendingAimItemId = itemId;
    combatInventoryEl.hide();
    setInputAim(AIM_KIND.USE_ITEM);
    flash(`AIM ${descriptor.label.toUpperCase()} — pick a direction (Esc to cancel).`);
    return;
  }
  try {
    const result = operator.useConsumable(itemId);
    applyUseConsumableResult(result, run);
  } catch (err) {
    flash(`USE FAILED: ${errorMessage(err)}`);
    return;
  }
  combatInventoryEl.hide();
  paint();
  concludeOperatorTurn();
}

/**
 * Common world-side effects for a `useConsumable` result. Split out so the
 * direct (non-aim) inventory flow and the aimed-throw flow share one place
 * to translate Crew's pure descriptors into grid mutations.
 */
function applyUseConsumableResult(
  result: ReturnType<NonNullable<Run['player']>['useConsumable']>,
  run: Run
): void {
  if (!run.world || !run.player) throw new Error('[shell] applyUseConsumableResult: no scene');
  // The acting operator — whoever currently has control — so HP/AP readouts
  // reflect who actually used the item, not the frozen Decker body.
  const operator = activeActorOf(run) as Crew;
  if (result.type === 'stim') {
    const healed = (result as { healed: number }).healed;
    flash(
      `Used STIM — healed ${healed} HP (now ${operator.hp}/${operator.maxHp}). ${operator.ap} AP left.`
    );
    // Same green heal pulse — and the same `heal` cue — as the Chimera's
    // Nanite Repair: shared "HP restored" beat, direct triggers since
    // useConsumable doesn't route through the bus (see
    // pulseSecuredInteractable for the same shape).
    triggerHealFlash(stageEl);
    animLock.push(ANIMATION_DURATIONS.HEAL_FLASH);
    audioManager.play('heal');
    return;
  }
  if (result.type === 'smoke') {
    const { cx, cy, radius } = result as { cx: number; cy: number; radius: number };
    if (!Number.isInteger(cx) || !Number.isInteger(cy) || !Number.isInteger(radius)) {
      throw new Error('[shell] smoke consumable returned invalid placement data');
    }
    // Lifetime is World's — `tickTileEffects` clears the cloud at the round
    // boundary, so there's no shell-side overlay list to keep in sync (and
    // none to be lost across a save).
    placeSmoke(run.world, cx, cy, radius);
    recomputeVision();
    flash(`Used SMOKE CHARGE — LOS blocked in radius ${radius}. ${operator.ap} AP left.`);
    return;
  }
  if (result.type === 'incendiary') {
    const { dx, dy } = result as { dx: number; dy: number };
    // Crew reports the aim; the ray is resolved here because it needs World
    // (P3.6). Resolving it a second time after the pre-check in
    // `resolveAimedUseItem` is deliberate and cheap: the function is pure over
    // grid + entity state, `useConsumable` only touches the operator's AP and
    // inventory in between, and both calls run in one synchronous tick — so
    // they cannot disagree. Same shape as the breaching charge's
    // `canPlaceBreachingCharge` → `placeBreachingCharge` pair.
    const impact = resolveIncendiaryImpact(run.world, operator, { dx, dy }, INCENDIARY_THROW_DIST);
    if (!impact) {
      // Unreachable: the pre-check refuses this before any AP is spent. If it
      // fires, the two call sites have drifted apart and the player has just
      // silently eaten a charge — crash loud rather than swallow it.
      throw new Error(
        `[shell] incendiary resolved to no impact after the pre-check passed (aim ${dx},${dy})`
      );
    }
    // The impact tile is always FLOOR or a body standing on something, so the
    // cluster has somewhere to take. `placed === 0` is still reachable — a body
    // caught it while standing on rubble, or on the map edge with every
    // neighbour a wall — so the dry-throw copy stays.
    const { placed, casualties } = placeHazardCluster(run.world, impact, run.rng, {
      thrown: true,
      attacker: operator,
    });
    // Ignition burst on the impact tile, before the fire is drawn under it.
    // Fires whatever the throw hit, so a dry throw still reads as a throw.
    const burst = runIncendiaryImpactFlash(renderer, paint, impact.x, impact.y);
    if (burst) animLock.push(ANIMATION_DURATIONS.INCENDIARY_IMPACT_FLASH);
    // The impact burst is unconditional (a throw reads as a throw), but the
    // `fire` sound tracks actual ignition — a dry throw that takes nowhere stays
    // silent rather than crackling with no fire on the ground.
    if (placed > 0) audioManager.play('fire');
    const caught = casualties.length;
    const downed = casualties.filter(c => c.killed).length;
    const hit = caught === 0 ? '' : ` ${caught} caught${downed > 0 ? `, ${downed} DOWN` : ''}.`;
    if (placed === 0) {
      flash(`Used MOLOTOV — nothing there would take. ${operator.ap} AP left.`);
    } else {
      // Only claim "square on" when the body it hit actually burned. A body
      // caught on the one unburnable-but-standable tile (EXIT) is the impact
      // point yet takes no impact damage, so it is not in `casualties` — without
      // this guard the flash would read "Caught X square on. 0 caught." and lie.
      const struckBody =
        impact.intercepted && casualties.some(c => c.entity === impact.intercepted)
          ? impact.intercepted
          : null;
      const short = struckBody
        ? ` Caught ${resolveEntityLabel(struckBody.id, run.world.entities)} square on.`
        : '';
      flash(
        `Used MOLOTOV — ${placed} tile${placed === 1 ? '' : 's'} ignited.${short}${hit} ` +
          `${operator.ap} AP left.`
      );
    }
    recomputeVision();
    return;
  }
  if (result.type === 'breach') {
    const { tx, ty } = result as { tx: number; ty: number };
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) {
      throw new Error('[shell] breaching charge returned invalid target data');
    }
    run.world.placeBreachingCharge(tx, ty);
    flash(`BREACHING CHARGE planted. Detonates end of turn. ${operator.ap} AP left.`);
    recomputeVision();
    return;
  }
  throw new Error(`[shell] applyUseConsumableResult: unknown result.type "${result.type}"`);
}

/**
 * Resolve an aimed `use-item { dx, dy }` intent. Pairs the keymap's direction
 * pick with the shell's stashed `pendingAimItemId` and runs the LOS-clear
 * pre-check before mutating state. Called from `applyIntent`'s onUseItem
 * callback.
 */
function resolveAimedUseItem(aim: { dx: number; dy: number }, run: Run): void {
  if (!run.world || !run.player) throw new Error('[shell] resolveAimedUseItem: no scene');
  // P3.M3.6: items are meat gear; the inventory gate blocks new aims while
  // jacked in, but an aim pending across the jack-in interact must also die.
  if (isCyberView(run)) {
    pendingAimItemId = null;
    flash('USE FAILED: jacked in — your gear is back in Meatspace.');
    resetInputModes();
    return;
  }
  // The thrower is whichever operator currently has control, so throws
  // originate from their tile, not the frozen Decker body's. (We've already
  // bailed above if we're flipped to Cyberspace.)
  const operator = activeActorOf(run) as Crew;
  const itemId = pendingAimItemId;
  if (!itemId) {
    // Direction press arrived without a stashed item — shouldn't be reachable
    // (the keymap only emits use-item from MODE.AIM / use-item aimKind, which
    // only the shell can enter), but crash loud if it does so the wiring bug
    throw new Error('[shell] use-item intent received without pendingAimItemId');
  }
  pendingAimItemId = null;
  if (itemId === ITEM_ID.MOLOTOV) {
    // P3.6: a molotov no longer refuses on geometry — it flies until something
    // stops it and burns there, walls and cover included. The one case left
    // with no answer is a ray that never crosses ground fire can take (facing
    // an adjacent wall, or throwing off the map edge). Refuse that *before*
    // `useConsumable` spends the AP and the charge; Rylee's call is that this
    // stays a refusal rather than smashing the bottle at your own feet.
    if (!resolveIncendiaryImpact(run.world, operator, aim, INCENDIARY_THROW_DIST)) {
      flash('USE FAILED: no clear ground to throw at.');
      paint();
      return;
    }
  }
  if (itemId === ITEM_ID.BREACHING_CHARGE) {
    const tx = operator.x + aim.dx * BREACHING_CHARGE_RANGE;
    const ty = operator.y + aim.dy * BREACHING_CHARGE_RANGE;
    const plantCheck = run.world.canPlaceBreachingCharge(tx, ty);
    if (!plantCheck.ok) {
      const msg =
        plantCheck.reason === 'blocked'
          ? 'USE FAILED: need clear ground to plant.'
          : plantCheck.reason === 'occupied' || plantCheck.reason === 'charge-present'
            ? 'USE FAILED: that tile is blocked.'
            : 'USE FAILED: target is off the map.';
      flash(msg);
      paint();
      return;
    }
  }
  try {
    const result = operator.useConsumable(itemId, aim);
    applyUseConsumableResult(result, run);
  } catch (err) {
    flash(`USE FAILED: ${errorMessage(err)}`);
    paint();
    return;
  }
  paint();
  concludeOperatorTurn();
}

function handlePersist() {
  if (!campaign || degrading) return;
  dataStore.setCampaign(snapshotCampaign(campaign));
}

function showUpdateWhenStable(show: () => void): void {
  if (animLock.isLocked() || isAnyBlockingModalOpen()) {
    window.setTimeout(() => showUpdateWhenStable(show), 100);
    return;
  }
  show();
}

function persistValidatedCampaignForRestart(): void {
  if (!campaign || degrading) return;
  const snapshot = snapshotCampaign(campaign);
  // Constructing a second campaign verifies the serialized boundary before
  // the live page is allowed to unload. It deliberately has no persistence or
  // result callbacks, so validation cannot mutate the active session.
  restoreCampaign(structuredClone(snapshot));
  dataStore.setCampaign(snapshot);
}

async function activateUpdateSafely(pendingWorker: ServiceWorker): Promise<void> {
  try {
    persistValidatedCampaignForRestart();
    await serviceWorkerManager.handleUpdateNow(pendingWorker);
  } catch (error) {
    console.error('[shell] Failed to activate service-worker update:', error);
    updateNotificationEl.showFailure('Update failed. Your current campaign remains saved.');
  }
}

function restartWithValidatedSave(): void {
  try {
    persistValidatedCampaignForRestart();
    window.location.reload();
  } catch (error) {
    console.error('[shell] Refusing restart because campaign validation failed:', error);
    updateNotificationEl.showFailure('Restart blocked: campaign save validation failed.');
  }
}

function presentEndedCampaignOverlay(c: Campaign): void {
  // P3.M6.4 / P3.5.M7: commit exactly one drawn reward — a stolen blueprint or
  // an unlocked archetype, never both — to the cross-campaign meta-store before
  // archiving the summary. Idempotent (duplicate id → no-op), so it's safe on
  // both live Score completion and a restored already-ended save.
  const unlockedItemId = c.scoreUnlockedItemId;
  if (unlockedItemId) dataStore.archiveScoreableItem(unlockedItemId);
  const unlockedArchetypeId = c.scoreUnlockedArchetypeId;
  if (unlockedArchetypeId) dataStore.archiveUnlockedArchetype(unlockedArchetypeId);
  // The summary captures the stolen blueprint (P3.M6.4) for the win screen and
  // the M7 Chronicle; `<game-over>` reads it straight off the summary.
  const summary = dataStore.archiveCampaign(buildCampaignSummary(c, new Date().toISOString()));
  gameOverEl.setSummary(summary);
}

function presentCampaignEnd(c: Campaign): void {
  presentEndedCampaignOverlay(c);
  renderShell();
}

function finishEndedCampaign(): void {
  dataStore.deleteCampaign();
  startFreshCampaign();
}

/**
 * Stage one result for settlement. Non-terminal jobs show `<crash-dump>`;
 * terminal outcomes are settled immediately by `handleResult` and route to
 * the Chronicle-backed `<game-over>` screen.
 */
function pushPendingJobResultOverlay(telemetry: Partial<RunTelemetry> & { outcome?: unknown }) {
  const tel = { ...telemetry };
  const outcome = tel.outcome;
  if (outcome !== 'death' && outcome !== 'exit') {
    throw new Error(`[shell] invalid job outcome for debrief overlay: "${outcome}"`);
  }
  pendingJobResult = {
    outcome,
    telemetry: { ...tel, outcome } as RunTelemetry & { outcome: Outcome },
  };
  crashEl.setTelemetry({
    ...tel,
    outcome,
    cause: tel.cause ?? undefined,
  });
}

function pendingResultEndsCampaign(result: PendingJobResult): boolean {
  if (!campaign) return false;
  return willEndCampaignAfterResult(
    campaign,
    result.outcome,
    result.outcome === 'exit' && result.telemetry.objectiveComplete !== false
  );
}

function handleResult({ outcome, telemetry }: RunResult) {
  if (degrading) return;
  // The terminal sting, fired once on the live transition into RESULT (this is
  // the onResult callback — the save-resume path calls pushPendingJobResultOverlay
  // directly, so a reload never re-plays it). Death flatlines; a clean exit gets
  // the rising extraction motif.
  if (outcome === 'death') {
    audioManager.play('flatline');
  } else if (outcome === 'exit') {
    audioManager.playSequence('extracted', EXTRACTION_MOTIF);
  }
  pushPendingJobResultOverlay({
    ...telemetry,
    outcome: telemetry?.outcome ?? outcome,
  });
  if (pendingJobResult && pendingResultEndsCampaign(pendingJobResult)) {
    settlePendingJobResult();
    return;
  }
  renderShell();
}

function currentScene(): ShellScene | null {
  if (!campaign) return null;
  return campaign.activeRun ?? campaign;
}

/**
 * Resolve the live archetype's perk-aim for the keymap so `x` fires a
 * self-centered perk (Decker EMP, future self-buffs) immediately. The active
 * actor changes with simstim flips and partner swaps, so this reads it fresh
 * each press. Only a Crew carries an `archetype` string; the CyberAvatar (its
 * Override perk is aimed) and any non-combat scene fall back to `'directional'`.
 */
function currentSpecialAim(): PerkAim {
  const scene = currentScene();
  if (!scene || !isRun(scene)) return 'directional';
  const archetype = (activeActorOf(scene) as { archetype?: unknown } | null)?.archetype;
  return typeof archetype === 'string' ? perkAimForArchetype(archetype) : 'directional';
}

/**
 * Wire the confirmation callbacks a Run raises mid-combat. Callbacks do not
 * persist, so this runs at deploy AND on campaign resume — a restored run
 * without them would silently skip both confirmations (the no-callback
 * harness fallback).
 */
function wireRunConfirmations(run: Run): void {
  run.onAbortRequested = () => {
    confirmationModalEl.showModal(
      `Objective incomplete. Abort extraction?\n\nYou will lose all rewards and take a REP ${REP.ABORT_PENALTY} penalty.`,
      'abort-run'
    );
  };
  run.onJackOutRequested = request => {
    confirmationModalEl.showModal(jackOutConfirmationCopy(request), 'jack-out-early');
  };
  run.onJackInPresent = () => {
    // Via the shared helper (not `rewire()` directly) so the score switches to
    // the cyber palette as the grid comes up.
    rewireSceneListeners();
    recomputeVision();
    flash('LINK ESTABLISHED — entering // THE GRID //.');
    paint();
  };
  run.onJackOutPresent = () => completeJackOutShellSwap();
  run.onPartnerDown = partner => {
    // P3.M4.4: the corp can flatline the partner on the meat grid while the
    // player is jacked into Cyberspace and never sees it — so the alert is
    // unconditional. The model force-flips control off the corpse (the body is
    // frozen), so recompute vision + repaint to match the new active operator.
    const who = partner.callsign ?? partner.id;
    recomputeVision();
    paint();
    flash(`⚠ OPERATOR DOWN — ${who} flatlined. Your meat cover is gone.`);
  };
  run.onDeckerDown = decker => {
    // P3.6: on the Score, losing the Decker no longer ends the run — the
    // partner still has a payload to walk out. The model has already resolved
    // the dead layer and handed the grid back, so mirror the partner alert and
    // repaint onto the surviving operator.
    const who = decker?.callsign ?? decker?.id ?? 'The Decker';
    recomputeVision();
    paint();
    flash(`⚠ DECKER FLATLINED — ${who} is gone. Finish it and get out.`);
  };
}

function jackOutConfirmationCopy(request: JackOutRequest): string {
  if (request.reason === 'explicit-key') {
    const objectiveLine = request.objectiveComplete
      ? 'Cyberspace objective is complete.'
      : 'Cyberspace objective is incomplete and will fail.';
    return (
      `Emergency jack-out?\n\n${objectiveLine}\n` +
      `The link will burn and neural shock will deal ${request.shockDamage} HP.`
    );
  }
  return (
    'Objective incomplete. Jack out anyway?\n\n' +
    'The link will burn — you cannot re-enter the grid this run.'
  );
}

function resumeCampaign(record: CampaignSnapshot | unknown) {
  try {
    campaign = restoreCampaign(record, {
      onPersist: () => handlePersist(),
      onResult: handleResult,
      unlockedArchetypeIds: dataStore.unlockedArchetypes,
    });
    if (campaign.activeRun) {
      wireRunConfirmations(campaign.activeRun);
    }
    if (campaign.activeRun?.state === RUN_STATE.COMBAT) {
      vision.resetFogState();
      vision.restoreSeen(campaign.activeRun.mapSeenKeys());
    }
    rewireSceneListeners();
    recomputeVision();
    if (campaign.activeRun?.state === RUN_STATE.BRIEFING && campaign.activeRun.contract) {
      briefingEl.setContract(campaign.activeRun.contract);
      briefingEl.setCrew(campaign.crew);
    }
    resumePendingCombatSliceIfNeeded();
    const resumeFlashMessage = `RESUMED — crew ${campaign.crew.filter(member => !member.flatlined).length} active.`;
    if (campaign.state === CAMPAIGN_STATE.ENDED) {
      pendingJobResult = null;
      presentEndedCampaignOverlay(campaign);
      flash(
        campaign.endReason === 'clock-expired'
          ? 'WINDOW CLOSED — Score contract went cold.'
          : campaign.endReason === 'score-complete'
            ? 'SCORE COMPLETE — campaign archived.'
            : 'CAMPAIGN ENDED — this save has reached a terminal state.'
      );
      renderShell();
    } else if (campaign.activeRun?.state === RUN_STATE.RESULT) {
      pushPendingJobResultOverlay({ ...campaign.activeRun.telemetry });
      if (pendingJobResult && pendingResultEndsCampaign(pendingJobResult)) {
        settlePendingJobResult();
      } else {
        flash('RESUMED — mission debrief.');
        renderShell();
      }
    } else if (campaign.state === CAMPAIGN_STATE.HUB && campaign.curator) {
      renderShell();
      if (!presentHubRevealIfAny(resumeFlashMessage)) {
        flash(resumeFlashMessage);
      }
      currentJobOptions = generateCurrentJobOptions();
    } else {
      flash(resumeFlashMessage);
      renderShell();
    }
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

function isConfirmationDialogOpen(el: HTMLElement | null | undefined): boolean {
  const dialog = el?.shadowRoot?.querySelector('dialog');
  return Boolean(dialog?.open);
}

function presentQuitCampaignConfirm() {
  if (!campaign) return;
  if (isConfirmationDialogOpen(confirmationModalEl)) return;
  confirmationModalEl.showModal(
    'Delete this campaign and all progress? This cannot be undone.',
    'quit-campaign'
  );
}

function performQuitCampaign(): void {
  if (!campaign) return;
  keyHelpEl.hide();
  briefingEl.hide();
  hideResultOverlays();
  crewRosterEl.hide();
  finnShopEl.hide();
  clinicModalEl.hide();
  combatInventoryEl.hide();
  crewInventoryEl.hide();

  pendingJobResult = null;
  dataStore.deleteCampaign();
  startFreshCampaign();
  flash('Campaign deleted — new campaign.');
  canvas.focus();
}

function handleInputModeChange(): void {
  const state = activeInputState();
  if (state.mode !== MODE.LOOK) return;
  if (isCorpControlsLocked()) {
    resetInputModes();
    flash('HOSTILES ACTIVE — controls locked until security finishes.');
    return;
  }
  enterLookMode();
}

function enterLookMode(): void {
  const run = currentScene();
  if (!run?.world || !run.player) return;
  if (lookCursor) return;
  const actor = activeActorOf(run);
  if (!actor) return;
  lookCursor = { x: actor.x, y: actor.y };
  keyboard.mode = MODE.LOOK;
  keyboard.aimKind = null;
  if (touchPadEl.mode !== MODE.LOOK) touchPadEl.setMode(MODE.LOOK);
  flash('LOOK — move cursor (Esc to cancel).');
}

function exitLookMode(): void {
  lookCursor = null;
  resetInputModes();
}

function isCorpControlsLocked(): boolean {
  const run = currentScene();
  return run?.state === RUN_STATE.COMBAT && run.queue?.currentFaction !== FACTION.PLAYER;
}

function handleLookMove(dx = 0, dy = 0): void {
  if (isCorpControlsLocked()) {
    flash('HOSTILES ACTIVE — controls locked until security finishes.');
    return;
  }
  const run = currentScene();
  if (!run?.world || !run.player) return;
  // P3.M3.6: the look cursor roams whichever grid is on screen.
  const world = activeWorldOf(run);
  const actor = activeActorOf(run);
  if (!world || !actor) return;
  const fog = activeVisionField(run);
  if (!lookCursor) {
    lookCursor = { x: actor.x, y: actor.y };
  }
  const tx = Math.max(0, Math.min(world.grid.width - 1, lookCursor.x + dx));
  const ty = Math.max(0, Math.min(world.grid.height - 1, lookCursor.y + dy));
  if (run.state === RUN_STATE.COMBAT && !fog.hasSeen(tx, ty)) {
    flash("You haven't seen that tile.");
    return;
  }
  lookCursor = { x: tx, y: ty };
  const line = describeTileAt(world, tx, ty, {
    vision: run.state === RUN_STATE.COMBAT ? fog : undefined,
    showStats: true,
  });
  if (line) flash(line);
}

function handleFlip(): void {
  const run = currentScene();
  if (!run || !isRun(run) || run.state !== RUN_STATE.COMBAT) return;
  if (isCorpControlsLocked()) {
    flash('HOSTILES ACTIVE — controls locked until security finishes.');
    return;
  }
  if (!run.canFlip()) {
    flash('SIMSTIM: no second operator to flip to.');
    return;
  }
  // The look cursor + any aim mode are layer-specific — clear them before the
  // view swaps out from under them.
  run.flip();
  repaintAfterFlip(run, 'SIMSTIM');
}

/**
 * Shared post-flip presentation: the look cursor + any aim mode are
 * layer-specific, so clear them before the view swaps, then recompute vision,
 * repaint, and flash where control landed. `prefix` distinguishes a manual
 * flip (`SIMSTIM`) from an auto-flip on AP exhaustion (`OPERATOR SPENT …`).
 * The flip mutation itself has already happened on the `Run` by the time we
 * get here.
 */
function repaintAfterFlip(run: Run, prefix: string): void {
  lookCursor = null;
  resetInputModes();
  recomputeVision();
  paint();
  const actor = activeActorOf(run);
  const where = isCyberView(run) ? 'CYBERSPACE' : 'MEATSPACE';
  const who = actor && 'callsign' in actor && actor.callsign ? ` · ${actor.callsign}` : '';
  flash(`${prefix} → ${where}${who}`);
}

/**
 * P3.M4.4: resolve the active operator running out of AP. Replaces the bare
 * `advanceTurn()` at every auto-end-on-exhaustion site. Independent AP pools
 * mean exhausting one operator does *not* end the mutual turn while another
 * still has AP — `Run.concludeActiveOperatorTurn()` auto-flips control to it
 * instead; only when the whole crew is spent do we drive the hostile phases.
 * Explicit Wait (`end-turn`) keeps its own hard `advanceTurn()` escape hatch.
 */
function concludeOperatorTurn(): void {
  const run = currentScene();
  if (!run || !isRun(run)) {
    advanceTurn();
    return;
  }
  switch (run.concludeActiveOperatorTurn()) {
    case 'continue':
      return;
    case 'end':
      advanceTurn();
      return;
    case 'auto-flip':
      repaintAfterFlip(run, 'OPERATOR SPENT');
      return;
  }
}

/**
 * P3.M4.4: resolve a Wait (`.`). The active operator has forfeited its AP;
 * Wait always hands control to the other operator when one exists (consistent
 * "pass/switch" gesture), and additionally ends the mutual turn — driving the
 * hostile phases — once the whole crew is spent.
 */
function passOperatorTurn(): void {
  const run = currentScene();
  if (!run || !isRun(run)) {
    advanceTurn();
    return;
  }
  switch (run.passActiveOperatorTurn()) {
    case 'end':
      advanceTurn();
      return;
    case 'flip':
      repaintAfterFlip(run, 'WAIT');
      return;
    case 'flip-and-end':
      // Control handed to the other operator (so next turn opens there), then
      // the crew-spent turn ends; repaint first so the corp/ICE phases animate
      // on the operator we flipped to.
      repaintAfterFlip(run, 'WAIT');
      advanceTurn();
      return;
  }
}

export function handleIntent(intent: Intent): void {
  if (intent?.type === 'quit-campaign') {
    resetInputModes();
    if (!campaign) return;
    presentQuitCampaignConfirm();
    return;
  }

  if (intent?.type === 'look-move') {
    handleLookMove(intent.dx, intent.dy);
    return;
  }

  if (intent?.type === 'flip') {
    handleFlip();
    return;
  }

  if (intent?.type === 'cancel' && lookCursor) {
    exitLookMode();
    return;
  }

  const run = currentScene();
  if (!run) return;
  // BRIEFING / RESULT swallow gameplay intents — JACK IN / NEW RUN drive
  // those transitions through the DOM buttons. Cancel is still valid (it
  // clears any stuck aim mode, per the cross-input cancel rule).
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

  if (!run.world || !run.player || !run.queue) {
    throw new Error(`[shell] state "${run.state}" is missing playable scene wiring`);
  }

  // P3.M3.6: intents drive whoever the player is being — the crew body in
  // Meatspace, the avatar on the grid (same queue either way).
  const intentWorld = activeWorldOf(run);
  const intentActor = activeActorOf(run);
  if (!intentWorld || !intentActor) {
    throw new Error(`[shell] state "${run.state}" has no active world/actor for intents`);
  }

  let keyItems: KeyItem[] = [];
  if (run.state === 'COMBAT') {
    keyItems = (run as Run).effectiveKeyItems(campaign?.keyItems ?? []);
  } else {
    keyItems = run.keyItems;
  }

  applyIntent(intent, {
    world: intentWorld,
    player: intentActor as Parameters<typeof applyIntent>[1]['player'],
    queue: run.queue,
    rng: run.rng,
    // Capture the action line for the next paint(); see lastActionLine docs.
    log: (line: string) => flash(line),
    advanceTurn,
    concludeTurn: concludeOperatorTurn,
    passTurn: passOperatorTurn,
    resetInputModes,
    onUseItem: (aim: { dx: number; dy: number }) => {
      resolveAimedUseItem(aim, run as Run);
    },
    onCorpseSalvaged: entity => {
      activeVisionField(run).forgetCorpse(entity);
    },
    keyItems,
    onKeycardCollected: kc => {
      // Picked-up keycards are run-scoped during the run — still usable for
      // in-run door unlock via ctx.keyItems. Campaign.onJobEnd promotes the
      // principal-stamped ones into the persistent inventory on live extraction.
      (run as Run).addKeyItem({
        id: kc.id,
        label: kc.label,
        doorId: kc.doorId,
        ...(kc.principalId ? { principalId: kc.principalId } : {}),
      });
    },
    onSecuredInteract: (entity, opts) => handleSecuredInteract(run as Run, entity, opts),
    onPlayerAction: (actionName: string) => {
      switch (actionName) {
        case PLAYER_ACTIONS.INVENTORY:
          // Inventory opens in Hub *and* combat. In combat we still
          // restrict to the player's turn so peeking doesn't dodge corp
          // tempo; in Hub there's no turn queue gating to worry about.
          if (campaign?.state === CAMPAIGN_STATE.COMBAT) {
            if (run.state !== RUN_STATE.COMBAT || run.queue?.currentFaction !== FACTION.PLAYER) {
              flash('Inventory is only available on your turn.');
              return;
            }
            // P3.M3.6: the avatar has no pockets — gear stays with the body
            // until the P3.M4 simstim flip makes split control real.
            if (isCyberView(run)) {
              flash('Jacked in — your meatspace gear is out of reach.');
              return;
            }
          }
          presentInventory();
          break;
        case PLAYER_ACTIONS.INTERACT:
          handleInteract();
          break;
        case PLAYER_ACTIONS.JACK_OUT:
          handleExplicitJackOut(run as Run);
          break;
        case PLAYER_ACTIONS.REACHED_EXIT:
          if (campaign?.state === CAMPAIGN_STATE.HUB) {
            flash('Curator: Hang tight! Come talk to me to claim a contract.');
          }
          // Moving onto an extraction tile synchronously emits the run result.
          // Score settlement may therefore clear the active run and tear down
          // the campaign world before this callback resumes. Only advance when
          // the captured scene is still playable (incomplete abort/escort wait,
          // or the Hub's decorative exit tile).
          if (run.state === RUN_STATE.COMBAT || run.state === CAMPAIGN_STATE.HUB) {
            advanceTurn();
          }
          break;
      }
    },
  });
}

/**
 * Pacing between drone actions when the corp turn is animated step-by-step.
 * Tuned just above MUZZLE_FLASH duration so the firing flash decays cleanly
 * before the same drone takes its next action (move, second shot, etc.) —
 * the original user-reported bug where a "fire then move" turn left the flash
 * stranded on the tile the drone had just vacated.
 */
const CORP_ACTION_DELAY_MS = 130;
const PLAYER_AFTERMATH_ACTION_DELAY_MS = 130;

function driveCombatTurnPipeline(run: Run, options: { resumeFromCorpSlice?: boolean } = {}): void {
  if (degrading) return;
  if (!run.world || !run.queue) {
    throw new Error(`[shell] cannot advance turn without world/queue in state "${run.state}"`);
  }
  const world = run.world;
  const queue = run.queue;
  advanceFromPlayerTurn({
    resumeFromCorpSlice: options.resumeFromCorpSlice,
    queue,
    world,
    rng: run.rng,
    isTerminal: () => run.state === RUN_STATE.RESULT,
    drivePlayerAftermath: ({ onStep, onFinish }) => {
      const finishMeatAftermath = () => {
        if (degrading) return;
        clearBreachBlastOverlay(false);
        const layer = cyberLayerOf(run);
        if (!layer) {
          onFinish();
          return;
        }
        drivePlayerAftermath({
          world: layer.world,
          rng: run.rng,
          onStep,
          onFinish,
          animLock,
          stepDelayMs: PLAYER_AFTERMATH_ACTION_DELAY_MS,
          lockMarginMs: ANIMATION_DURATIONS.MUZZLE_FLASH,
          player: layer.avatar,
          schedule: scheduleCombatPump,
        });
      };
      drivePlayerAftermath({
        world,
        rng: run.rng,
        onStep,
        onFinish: finishMeatAftermath,
        animLock,
        stepDelayMs: PLAYER_AFTERMATH_ACTION_DELAY_MS,
        lockMarginMs: ANIMATION_DURATIONS.MUZZLE_FLASH,
        rep: campaign?.rep,
        player: run.player,
        schedule: scheduleCombatPump,
      });
    },
    onCorpTurnReady: () => {
      if (degrading) return;
      clearBreachBlastOverlay(false);
      recomputeVision();
      paint();
    },
    onPlayerAftermathStep: step => {
      if (degrading) return;
      const scene = currentScene();
      // P3.M3.6: aftermath is a Meatspace phase — while jacked in it still
      // *applies*, but the canvas is showing the grid, so skip its
      // presentation (overlays/shake/log lines).
      const jacked = isCyberView(scene);
      const cyberLayer = cyberLayerOf(scene);
      const isCyberStep =
        cyberLayer !== null &&
        step.type === 'overridden-drone' &&
        cyberLayer.world.entities.has(step.entity.id);
      if (step.type === 'breach-detonate' && !jacked) {
        showBreachBlastOverlay(step.charge.x, step.charge.y);
        audioManager.play('explosion');
        if (scene?.player && vision.isVisible(step.charge.x, step.charge.y)) {
          triggerShake(stageEl);
          animLock.push(ANIMATION_DURATIONS.SHAKE);
        }
      }
      if (
        isCyberStep &&
        cyberLayer &&
        isPlayerAftermathStepLogVisible(
          step,
          (x, y) => cyberVision.isVisible(x, y),
          cyberLayer.avatar.id
        )
      ) {
        for (const line of formatPlayerAftermathStepLogLines(step)) {
          flash(line);
        }
      } else if (
        !jacked &&
        scene?.player &&
        isPlayerAftermathStepLogVisible(step, (x, y) => vision.isVisible(x, y), scene.player.id)
      ) {
        for (const line of formatPlayerAftermathStepLogLines(step)) {
          flash(line);
        }
      }
      paint();
    },
    driveCorpTurn: ({ onFinish }) => {
      runCorpTurn(() => {
        if (degrading) return;
        onFinish();
      });
    },
    onPlayerTurnReady: () => {
      if (degrading) return;
      // Expired smoke/fire has already been cleared by `tickTileEffects` inside
      // advanceFromPlayerTurn — vision recompute below picks up the sightlines
      // that just reopened. Stealth may also have changed during the corp turn.
      recomputeVision();
      paint();
    },
  });
}

function advanceTurn(): void {
  if (degrading) return;
  const scene = currentScene();
  if (!scene) return;
  if (!scene.world || !scene.queue) {
    throw new Error(`[shell] cannot advance turn without world/queue in state "${scene.state}"`);
  }

  if (isRun(scene)) {
    driveCombatTurnPipeline(scene);
    return;
  }

  // Hub — no corp actors; sync PLAYER→CORP→PLAYER flip refreshes operator AP.
  advanceFromPlayerTurn({
    queue: scene.queue,
    world: scene.world,
    rng: scene.rng,
    isTerminal: () => false,
    drivePlayerAftermath: ({ onFinish }) => onFinish(),
    driveCorpTurn: ({ onFinish }) => onFinish(),
    onPlayerTurnReady: () => paint(),
  });
}

/**
 * Autosave fires at the player→corp `turn:ended` before the animated aftermath
 * and corp slice run. On cold resume (or fault recovery that reloads that
 * checkpoint), kick the pipeline from the corp slice without flipping the
 * queue again.
 */
function resumePendingCombatSliceIfNeeded(): void {
  const run = campaign?.activeRun;
  if (!run || run.state !== RUN_STATE.COMBAT || !run.world || !run.queue) return;
  if (run.queue.currentFaction === FACTION.PLAYER) return;
  driveCombatTurnPipeline(run, { resumeFromCorpSlice: true });
}

/**
 * Kick off the animated corp turn. Delegates to `corpTurnDriver.runCorpTurn`,
 * which iterates each corp entity's `takeTurnSteps` generator one yield at
 * a time, paints between each, and fires `onFinish` once every generator
 * drains (or immediately when the world has zero corp entities — hub, or a
 * combat map the player has cleared). The driver lives in `/src/game/` so
 * its state machine is testable under `node --test`.
 */
function runCorpTurn(onFinish: () => void): void {
  if (degrading) return;
  maybeDevFault('corp');
  const run = currentScene();
  if (!run) return;
  if (!(run instanceof Run)) return;
  if (!run.world) {
    throw new Error(`[shell] cannot drive corp turn without world in state "${run.state}"`);
  }
  // P3.M3.6: while the Decker is jacked in, the corp slice chains two
  // driver passes — meat hostiles on the meat world (silent: the canvas is
  // showing the grid), then ICE on the cyber world. Both consume the shared
  // run rng in this fixed order, keeping the turn deterministic. If the meat
  // pass flatlines the body the driver bails terminally and the ICE pass
  // (correctly) never runs.
  const icePass = () => {
    if (degrading) return;
    const layer = cyberLayerOf(currentScene());
    if (!layer) {
      onFinish();
      return;
    }
    driveCorpTurn({
      run: { state: run.state ?? '', world: layer.world, rng: run.rng },
      corpFaction: FACTION.CORP,
      paint,
      animLock,
      actionDelayMs: CORP_ACTION_DELAY_MS,
      lockMarginMs: ANIMATION_DURATIONS.MUZZLE_FLASH,
      onFinish,
      schedule: scheduleCombatPump,
      shouldAnimateStep: (entityId: string, step: TurnActionStep) => {
        if (degrading) return true;
        return isCorpTurnStepVisibleToPlayer(layer.world, layer.avatar.id, entityId, step, (x, y) =>
          cyberVision.isVisible(x, y)
        );
      },
      onStep: (entityId: string, step: TurnActionStep) => {
        if (degrading) return;
        const resolve = (id: string) => resolveEntityLabel(id, layer.world.entities);
        const line = formatCorpTurnStep(resolve(entityId), step, resolve);
        if (
          !line ||
          !isCorpTurnStepLogVisibleToPlayer(layer.world, layer.avatar.id, entityId, step, (x, y) =>
            cyberVision.isVisible(x, y)
          )
        ) {
          return;
        }
        flash(line);
      },
    });
  };

  driveCorpTurn({
    run: {
      state: run.state ?? '',
      world: run.world,
      rng: run.rng,
    },
    corpFaction: run.hostileFaction,
    paint,
    animLock,
    actionDelayMs: CORP_ACTION_DELAY_MS,
    lockMarginMs: ANIMATION_DURATIONS.MUZZLE_FLASH,
    onFinish: icePass,
    schedule: scheduleCombatPump,
    shouldAnimateStep: (entityId: string, step: TurnActionStep) => {
      if (degrading) return true;
      const scene = currentScene();
      if (!scene?.world || !scene.player) return true;
      // Jacked in: meat steps still *apply*, but the canvas is showing the
      // grid — drain them silently rather than pacing invisible frames.
      if (isCyberView(scene)) return false;
      return isCorpTurnStepVisibleToPlayer(scene.world, scene.player.id, entityId, step, (x, y) =>
        vision.isVisible(x, y)
      );
    },
    onStep: (entityId: string, step: TurnActionStep) => {
      if (degrading) return;
      const scene = currentScene();
      if (!scene?.world || !scene.player) return;
      if (isCyberView(scene)) {
        paintPip();
        const resolve = (id: string) => resolveEntityLabel(id, scene.world!.entities);
        const line = formatCorpTurnStep(resolve(entityId), step, resolve);
        if (
          line &&
          isCorpTurnStepLogVisibleToPlayer(scene.world, scene.player.id, entityId, step, (x, y) =>
            vision.isVisible(x, y)
          )
        ) {
          flash(line);
        }
        return;
      }
      const resolve = (id: string) => resolveEntityLabel(id, scene.world!.entities);
      const line = formatCorpTurnStep(resolve(entityId), step, resolve);
      if (
        !line ||
        !isCorpTurnStepLogVisibleToPlayer(scene.world, scene.player.id, entityId, step, (x, y) =>
          vision.isVisible(x, y)
        )
      ) {
        return;
      }
      flash(line);
    },
  });
}

/*
 * `advanceFromPlayerTurn` owns the final CORP→PLAYER queue transition; the
 * shell callback above only refreshes presentation state after that happens.
 */

function handleInteract(): void {
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
  if (campaign.player && campaign.finn && isChebyshevAdjacent(campaign.player, campaign.finn)) {
    flash('FINN — browse the shop.');
    presentFinnShop();
    return;
  }
  if (campaign.player && campaign.clinic && isChebyshevAdjacent(campaign.player, campaign.clinic)) {
    flash('PATCH — clinic services.');
    presentClinic();
    return;
  }
  if (
    campaign.player &&
    campaign.archiveTerminal &&
    isChebyshevAdjacent(campaign.player, campaign.archiveTerminal)
  ) {
    flash('ARCHIVE — Chronicle and campaign history.');
    presentChronicleArchive();
    return;
  }
  if (
    campaign.player &&
    campaign.terminal &&
    isChebyshevAdjacent(campaign.player, campaign.terminal)
  ) {
    if (!isTerminalAccessible(campaign.hubReveals)) {
      flash('TERMINAL — access denied. Systems locked.');
      return;
    }
    flash('TERMINAL — crew roster.');
    presentCrewRoster();
    return;
  }
  if (
    !campaign.player ||
    !campaign.curator ||
    !isChebyshevAdjacent(campaign.player, campaign.curator)
  ) {
    const hints = ['Curator (contract)'];
    if (campaign.finn) hints.unshift('Finn (shop)');
    if (campaign.clinic) hints.push('Patch (clinic)');
    hints.push('Archive (Chronicle)');
    hints.push('Terminal (roster)');
    flash(`Step adjacent to ${hints.join(', ')}.`);
    return;
  }
  // Gate: can't take contracts with no deployable crew.
  if (campaign.crew.filter(m => !m.flatlined).length === 0) {
    flash('CURATOR: You need a crew first. Try the Terminal.');
    return;
  }
  if (currentJobOptions.length === 0) {
    currentJobOptions = generateCurrentJobOptions();
  }
  flash(
    currentJobOptions.some(contract => contract.context.recipeId === 'score-final')
      ? 'CURATOR: Three jobs on the board. The Score is your call.'
      : 'CURATOR: Three jobs on the board. Pick your trouble.'
  );
  presentContractSelect(currentJobOptions);
}

function handleExplicitJackOut(run: Run): void {
  if (run.state !== RUN_STATE.COMBAT || run.cyberspace?.phase !== 'active') {
    flash('No active Cyberspace link to jack out from.');
    return;
  }
  run.requestJackOut();
}

/**
 * Combat interact — scan Chebyshev-adjacent tiles for a lootable corpse.
 * If found: call `player.collectSalvage`, flash result, auto-end turn on AP
 * exhaustion. If not found: show a no-loot hint.
 */
function pulseSecuredInteractable(entity: Entity): boolean {
  if (!(entity instanceof Interactable) || !entity.secured || !entity.alive) return false;
  const fired = runInteractSecuredFlash(renderer, paint, entity.x, entity.y, entity.glyph);
  if (fired) animLock.push(ANIMATION_DURATIONS.INTERACT_SECURED_FLASH);
  return fired;
}

function handleSecuredInteract(
  run: Run,
  entity: Interactable,
  { apExhausted }: { apExhausted: boolean }
): void {
  const fired = pulseSecuredInteractable(entity);
  // Multi-step objectives (dual-site, escort) fire this on an interim beat —
  // a sync pad touched or the escort contact linked — that doesn't finish the
  // objective yet. `secured` is reserved for the full completion `paint()`
  // detects below; here we play the smaller `checkpoint` cue instead, and
  // only when this interaction didn't just complete the objective outright
  // (single-target objectives resolve on this same interact, so they get
  // `secured` alone via `paint()` — no `checkpoint` first).
  if (fired && !run.isObjectiveSatisfied()) {
    audioManager.play('checkpoint');
  }
  if (!apExhausted) return;
  if (fired) {
    scheduleCombatPump(() => concludeOperatorTurn(), ANIMATION_DURATIONS.INTERACT_SECURED_FLASH);
  } else {
    concludeOperatorTurn();
  }
}

function handleCombatInteract(): void {
  if (!campaign) return;
  const run = campaign.activeRun;
  if (!run || !run.player) return;
  if (!run.world) throw new Error('[shell] active combat run has no world');
  // P3.M3.6: interact targets the world the player is being in — meat props
  // for the body, data nodes / the exit port for the avatar.
  const world = activeWorldOf(run);
  const player = activeActorOf(run);
  if (!world || !player) throw new Error('[shell] combat interact requires an active world/actor');
  // Field looting needs pockets — the avatar (no inventory) skips straight to
  // interactables. ICE leaves no salvage in this slice.
  const inventory = 'inventory' in player ? (player as Crew).inventory : null;
  if (!isCyberView(run) && !inventory) {
    throw new Error('[shell] combat player inventory is not initialised');
  }

  // Priority 1: a secured / objective interactable. Objective *retrieve* pickups
  // are Interactables (`Pickup.interact`) and resolve here too, so they outrank
  // field loot per the interact priority.
  const interactable = world.adjacentInteractables(player)[0];
  if (interactable) {
    const result = interactable.interact(world, player);
    flash(result.message);
    if (
      result.ok &&
      interactable instanceof Interactable &&
      interactable.secured &&
      interactable.alive
    ) {
      handleSecuredInteract(run, interactable, { apExhausted: player.ap === 0 });
    } else if (result.ok && player.ap === 0) {
      concludeOperatorTurn();
    }
    if (result.ok) {
      // some object can't be interacted with (e.g. an already open door); only bail if our interaction succeeds
      paint();
      return;
    }
  }

  // Priority 2-4: adjacent field pickups — a deliberate action costing INTERACT
  // AP, one item per press, by priority: keycard > consumable > corpse salvage.
  // Scans the player's own tile plus the 8 neighbours (Chebyshev ≤ 1).
  if (inventory) {
    const scanAdjacent = <T>(query: (x: number, y: number) => T | null): T | null => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const hit = query(player.x + dx, player.y + dy);
          if (hit) return hit;
        }
      }
      return null;
    };

    const keycard = scanAdjacent((x, y) => world.keycardAt(x, y));
    const consumable = keycard ? null : scanAdjacent((x, y) => world.consumablePickupAt(x, y));
    const corpse =
      keycard || consumable
        ? null
        : scanAdjacent((x, y) => {
            const c = world.lootableCorpseAt(x, y);
            return c && !c.alive && c.loot && totalSalvage(c.loot.salvage) > 0 ? c : null;
          });

    if (keycard || consumable || corpse) {
      if (!player.canAfford(AP_COST.INTERACT)) {
        flash('Insufficient AP to loot.');
        return;
      }
      if (keycard) {
        collectKeycardPickup(world, keycard, kc =>
          (run as Run).addKeyItem({
            id: kc.id,
            label: kc.label,
            doorId: kc.doorId,
            ...(kc.principalId ? { principalId: kc.principalId } : {}),
          })
        );
        (player as Crew).spendAp(AP_COST.INTERACT);
        flash(`Picked up ${keycard.label}. ${player.ap} AP left.`);
      } else if (consumable) {
        collectConsumablePickup(world, player as Crew, consumable);
        (player as Crew).spendAp(AP_COST.INTERACT);
        flash(`Picked up ${consumable.label}. ${player.ap} AP left.`);
      } else if (corpse) {
        // Standalone interact salvage pays its own INTERACT AP.
        const amount = collectCorpseSalvage(world, player as Crew, corpse, { spendAp: true });
        activeVisionField(run).forgetCorpse(corpse);
        flash(
          `Salvaged +${amount} — carrying ${formatSalvageCompact(inventory.salvage)}. ${player.ap} AP left.`
        );
      }
      paint();
      concludeOperatorTurn();
      return;
    }
  }

  flash('Nothing to interact with nearby.');
}

// onJackIn removed — combat entry is handled in onBriefingDeploy.

function settlePendingJobResult(): 'ended' | 'hub' {
  if (!campaign || !pendingJobResult) {
    throw new Error('settlePendingJobResult requires an active campaign result');
  }
  const jobResult = pendingJobResult;
  const { outcome } = jobResult;
  pendingJobResult = null;
  // Extract typed salvage from the deployed crew member's inventory on exit.
  // Death outcomes pass `undefined`, preserving the existing forfeiture rule.
  const member = campaign.deployedMemberId
    ? campaign.getCrewMember(campaign.deployedMemberId)
    : null;
  const salvage = member?.inventory?.salvage;
  const objectiveComplete =
    outcome === 'exit' ? jobResult.telemetry.objectiveComplete !== false : false;
  // P3.6: the run's own verdict on the Score. `score-partial` is a costly win —
  // objectives complete, payload extracted, an operative lost.
  const costlyScore = jobResult.telemetry.cause === 'score-partial';
  const scoreRun = campaign.activeRun?.contract?.context.recipeId === 'score-final';
  // Apply the clean completion bonus before `onJobEnd`, so the terminal
  // Chronicle record sees the final Rep value and Hub recruitment gates retain
  // their existing ordering on non-terminal jobs. A Score that cost an operator
  // is not a "clean extraction" by any reading — skip the bonus and its line.
  if (outcome === 'exit' && objectiveComplete && civilianHarmsThisJob === 0 && !costlyScore) {
    const actual = campaign.adjustRep(REP.CLEAN_COMPLETION_BONUS);
    flash(`REP +${actual}: clean extraction — no civilian casualties.`);
  }
  if (outcome === 'exit' && !objectiveComplete) {
    // The Score's abort is terminal and takes no Rep penalty (`Campaign`
    // skips it) — promising one here was a lie the player could read.
    flash(
      scoreRun
        ? 'SCORE ABANDONED: you walked out with nothing.'
        : `ABORT: Objective abandoned. REP ${REP.ABORT_PENALTY}.`
    );
  }
  if (costlyScore) {
    flash('SCORE SECURED — at a cost. The payload is out; the crew is not whole.');
  }
  campaign.onJobEnd({ outcome, salvage, completed: objectiveComplete });
  if (campaign.state === CAMPAIGN_STATE.ENDED) {
    presentCampaignEnd(campaign);
    return 'ended';
  }
  if (!presentHubRevealIfAny('HUB — choose the next job.')) {
    flash('HUB — choose the next job.');
  }
  if (!campaign.curator) {
    throw new Error('settlePendingJobResult: hub not entered — curator is missing.');
  }
  currentJobOptions = generateCurrentJobOptions();
  return 'hub';
}

function onNewRunRequested(): void {
  if (!campaign) return;
  if (pendingJobResult) {
    if (settlePendingJobResult() === 'ended') return;
  } else if (campaign.state === CAMPAIGN_STATE.ENDED) {
    finishEndedCampaign();
    return;
  }
  hideResultOverlays();
  rewireSceneListeners();
  recomputeVision();
  renderShell();
}

// ---------------------------------------------------------------------------
// Vision (mirrors the debug harness rule: refresh on every entity move)
// ---------------------------------------------------------------------------

function rewireSceneListeners(): void {
  sceneListenerController.rewire();
  syncMusicToScene();
}

/**
 * Point the generative score at whatever is on screen now.
 *
 * Called on every scene transition (and on jack in/out), so it is the one place
 * that decides whether music plays at all, in which palette, and at what
 * tension. Everything it calls is idempotent, so re-running it on an unchanged
 * scene is free.
 *
 * Deriving tension from persisted alarm *state* here — rather than relying only
 * on the ALARM_CHANGED listener in `sceneListeners` — is what makes a run saved
 * mid-alarm reload scored as tense. Both paths share `musicScore.ts`.
 */
function syncMusicToScene(): void {
  const scene = currentScene();

  // No campaign yet: the title screen is deliberately unscored. Cut any tail
  // still ringing from a previous campaign rather than letting it play under it.
  if (!scene) {
    musicDirector.stop();
    audioManager.stopMusic();
    return;
  }

  if (!isRun(scene)) {
    musicDirector.setPalette(HUB_PALETTE);
    musicDirector.setTension(HUB_TENSION);
    musicDirector.start();
    return;
  }

  // Palette tracks the *run*: a job with a cyberspace component is scored cyber
  // start to finish, whether or not the grid is currently on screen.
  musicDirector.setPalette(paletteForRun(scene));

  // Tension tracks whichever layer the player is actually looking at — while
  // flipped to the grid, the cyber layer runs its own world and its own alarm
  // cadence, so the meat grid's alarm says nothing about the danger on screen.
  const world = isCyberView(scene) ? cyberLayerOf(scene)?.world : scene.world;
  musicDirector.setTension(tensionForAlarmPhase(world?.alarm?.phase));
  musicDirector.start();
}

function completeJackOutShellSwap(): void {
  sceneListenerController.detachCyber();
  // Back in the body: tension re-reads the meat grid's alarm. The palette stays
  // cyber — this is still a net run, and flipping the key on jack-out would
  // churn it every time the Decker surfaces.
  syncMusicToScene();
  pipCanvas.hidden = true;
  flash('LINK DROPPED — back in your body.', { priority: true });
  recomputeVision();
  paint();
}

function recomputeVision(): void {
  const scene = currentScene();
  const result = syncVisionFields({ scene, meatVision: vision, cyberVision });
  if (result.recordMeatSeen && result.meatVisible && scene && isRun(scene)) {
    applyMeatSeenRecord(scene, result.meatVisible);
  }
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function renderShell(): void {
  if (!campaign) return;
  const run = currentScene();
  const state = run?.state;
  switch (state) {
    case CAMPAIGN_STATE.HUB:
    case RUN_STATE.COMBAT:
      canvas.hidden = false;
      briefingEl.hide();
      hideResultOverlays();
      break;
    case RUN_STATE.BRIEFING:
      // The combined briefing modal handles its own show/hide. If we land
      // here on resume, re-present the briefing so the player can pick an
      // operative.
      canvas.hidden = true;
      if (!briefingEl.isOpen) {
        if (!campaign.activeRun?.contract) {
          throw new Error('[shell] briefing state without an active contract');
        }
        briefingEl.setContract(campaign.activeRun.contract);
        briefingEl.setCrew(campaign.crew);
        briefingEl.show();
      }
      hideResultOverlays();
      break;
    case RUN_STATE.RESULT:
      canvas.hidden = true;
      briefingEl.hide();
      gameOverEl.hide();
      crashEl.show();
      break;
    case CAMPAIGN_STATE.ENDED:
      canvas.hidden = true;
      briefingEl.hide();
      crashEl.hide();
      gameOverEl.show();
      break;
    default:
      throw new Error(`[shell] unknown state "${state}"`);
  }
  paint();
}

function paintPip(): void {
  const view = resolveSceneView(campaign);
  if (
    !view ||
    view.kind !== 'run' ||
    view.scene.state !== RUN_STATE.COMBAT ||
    !shouldShowPip(view.scene)
  ) {
    pipCanvas.hidden = true;
    return;
  }
  const run = view.scene;
  // P3.M4.5: the PIP shows whichever layer the player is *not* driving — meat
  // (body/partner CCTV) while viewing the grid, the cyber grid while viewing meat.
  const feed = pipFeedFor(run);
  const world = pipWorldOf(run);
  const follow = pipFollowTargetOf(run);
  if (!feed || !world || !follow) {
    pipCanvas.hidden = true;
    return;
  }
  pipCanvas.hidden = false;
  const cyberFeed = feed === 'cyber';
  pipCanvas.classList.toggle('pip-cyber', cyberFeed);
  pipRenderer.draw(world, follow, {
    camera: pipCameraFor(follow, world),
    vision: cyberFeed ? cyberVision : vision,
    player: follow,
    tileset: cyberFeed ? 'cyber' : 'meat',
    principalId: cyberFeed ? undefined : campaign?.activeRun?.contract?.context?.principal?.id,
    hudRows: pipChrome(run),
  });
}

// The run instance we've already played the `secured` sting for, so objective
// completion chimes exactly once per run (paint runs after every action, and
// the objective can be satisfied by any of them).
let objectiveSecuredForScene: object | null = null;

export function paint(stateHint: InputState = activeInputState()): void {
  const run = currentScene();
  // P3.M4.3: surface the simstim FLIP fab only when a flip target exists right
  // now — same gate as the keyboard `Tab` (dual-deploy / post-jack-out crews).
  // Set before the early-returns below so non-combat / hidden-canvas paints
  // always clear a stale fab.
  touchPadEl.setFlipAvailable(!!run && isRun(run) && run.canFlip());
  if (canvas.hidden) {
    setStatus(statusLine(stateHint));
    return;
  }
  if (!run || !run.world || !run.player) return;
  // P3.M3.6: the rendered pair — meat body in Meatspace, avatar on the grid.
  const world = activeWorldOf(run);
  const actor = activeActorOf(run);
  if (!world || !actor) return;
  const jacked = isCyberView(run);
  canvas.classList.toggle('cyber', jacked);
  // Hub is a safe space — no fog of war. Vision is only meaningful during
  // combat where LOS and drone stealth detection matter.
  const activeVision = run.state === RUN_STATE.COMBAT ? activeVisionField(run) : undefined;
  // Breach blasts are a Meatspace effect — never painted onto the grid.
  const blastOverlayKeys =
    run.state === RUN_STATE.COMBAT && !jacked && activeBreachBlastOverlayKeys.size > 0
      ? activeBreachBlastOverlayKeys
      : undefined;
  const principalId =
    run.state === RUN_STATE.COMBAT && !jacked
      ? campaign?.activeRun?.contract?.context?.principal?.id
      : undefined;
  const combatHud = buildCombatHudSnapshot(run);
  renderer.draw(world, actor, {
    vision: activeVision,
    player: actor,
    blastOverlayKeys,
    lookCursor,
    principalId,
    tileset: activeTileset(run),
    locationLabel: currentLocationLabel(campaign, run),
    hudRows: buildHubHudRows(campaign, run),
    combatHud,
  });
  // `secured` on the objective flipping to done — once per run.
  if (combatHud?.objective?.done && objectiveSecuredForScene !== run) {
    objectiveSecuredForScene = run;
    audioManager.play('secured');
  }
  crt.alertTint = run.state === RUN_STATE.COMBAT && world.alarmActive;
  crt.apply();
  paintPip();
  setStatus(statusLine(stateHint));
}

function statusLine(state: InputState): string {
  const run = currentScene();
  if (!run) return '';
  if (run.state !== RUN_STATE.COMBAT) {
    corpToneActivityBody = null;
  }
  const label = stateLabelForSceneState(run.state);
  if (!run.player) return label;
  if (!run.queue) return label;

  let contextHtml = '';
  let hubIdentity: string | undefined;
  let combatHud = null;
  let corpMood = null;
  let latchedCorpMood = null;

  if (run.state === RUN_STATE.COMBAT) {
    if (!isRun(run)) {
      throw new Error('[shell] combat status requires an active run');
    }
    combatHud = buildCombatHudSnapshot(run);
    if (!combatHud) {
      throw new Error('[shell] combat status requires HUD summary data');
    }
    const statusWorld = activeWorldOf(run);
    const statusActor = activeActorOf(run);
    const alarm = statusWorld?.alarm;
    const alertTag = alarm ? formatAlertTag(alarm) : '';
    const onHazard =
      statusWorld &&
      statusActor &&
      statusWorld.grid.tileAt(statusActor.x, statusActor.y) === TILE.HAZARD;
    contextHtml = joinStatusParts([formatHazardTag(!!onHazard), alertTag]);

    const jacked = isCyberView(run);
    const hintText = proximityHint();
    if (
      !hintText &&
      isHostileTurnSlice(run.state, run.queue.currentFaction, run.hostileFaction, jacked)
    ) {
      const corpWorld = activeWorldOf(run);
      if (!corpWorld) throw new Error('[shell] combat status requires a world');
      const visibleHostiles = countVisibleCorpEntities(
        corpWorld.entities.values(),
        (x: number, y: number) => activeVisionField(run).isVisible(x, y),
        jacked ? FACTION.CORP : run.hostileFaction
      );
      const body = corpTurnStatusBody(visibleHostiles, run.queue.turnNumber);
      corpMood = { hostileTag: hostileMoodTag(jacked, run.hostileFaction), body };
    } else if (
      !hintText &&
      isPlayerTurnSlice(run.state, run.queue.currentFaction) &&
      corpToneActivityBody !== null
    ) {
      latchedCorpMood = {
        hostileTag: hostileMoodTag(isCyberView(run), run.hostileFaction),
        body: corpToneActivityBody,
      };
      corpToneActivityBody = null;
    }
  } else {
    if (!campaign) return label;
    const repLabel = REP_LABEL.find(b => campaign!.rep >= b.min)?.label ?? 'UNKNOWN';
    contextHtml = joinStatusParts(
      formatHubArcStatusLines(campaign)
        .filter((line): line is string => line !== null)
        .map(escapeHtml)
    );
    hubIdentity = `CREW ${campaign.crew.filter(member => !member.flatlined).length}/${campaign.crew.length} CREDS ${campaign.credits ?? 0} REP ${campaign.rep} (${escapeHtml(repLabel)})`;
  }

  const { html, nextCorpMoodBody } = formatStatusLine({
    stateLabel: label,
    sceneState: run.state,
    input: state,
    hasPlayer: !!run.player,
    hasQueue: !!run.queue,
    combatHud,
    contextHtml,
    hubIdentity,
    proximityHint: proximityHint() || undefined,
    corpMood,
    latchedCorpMood,
    actionHistory: actionLineHistory,
    pendingActionCount: pendingActionLineCount,
    priorityFlash: priorityFlashLine,
  });
  if (nextCorpMoodBody !== null) {
    corpToneActivityBody = nextCorpMoodBody;
  }
  pendingActionLineCount = 0;
  return html;
}

/**
 * Player-facing nudge for whatever interactable is within reach. Computed
 * fresh every paint so it always reflects the *current* player position
 * (vs. caching at action-time, which would let a stale hint linger after a
 * corp turn shuffled the world).
 *
 * When non-empty, the hint takes the upper activity row in the status bar,
 * bumping the previous action log line. It is *not* pushed into the
 * rolling logLines buffer — it's a transient, positional display.
 *
 * Add a case here when new interactables land (terminals, dropped weapons,
 * etc.).
 */
function proximityHint(): string {
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
    if (run.clinic && isChebyshevAdjacent(run.player, run.clinic)) {
      return 'PATCH — press [Space] for clinic.';
    }
    if (run.exitTile && isChebyshevAdjacent(run.player, run.exitTile)) {
      return 'EXIT (¤) one step away.';
    }
    return '';
  }
  if (run.state === RUN_STATE.COMBAT) {
    // P3.M3.6: hints follow the active body — meat props for the crew,
    // nodes/exit port for the avatar.
    const world = activeWorldOf(run);
    const p = activeActorOf(run);
    const jacked = isCyberView(run);
    if (world && p) {
      // Loot hint: adjacent lootable corpses (needs pockets — avatar skips).
      if (!jacked) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const e = world.lootableCorpseAt(p.x + dx, p.y + dy);
            if (e && !e.alive && e.loot && totalSalvage(e.loot.salvage) > 0) {
              return 'SALVAGE nearby — press [Space] to loot.';
            }
          }
        }
      }
      const interactable = world.adjacentInteractables(p)[0];
      if (interactable) {
        return `${interactable.label.toUpperCase()} nearby — press [Space] to interact.`;
      }
    }
    if (!jacked && run.exitTile && isChebyshevAdjacent(run.player, run.exitTile)) {
      return 'EXIT (¤) one step away.';
    }
  }
  return '';
}

/** Stash a one-shot message that the next paint surfaces in the status bar. */
function flash(line: string, opts: { priority?: boolean } = {}): void {
  const scene = currentScene();
  if (scene?.state === RUN_STATE.COMBAT && scene.queue?.currentFaction === FACTION.PLAYER) {
    corpToneActivityBody = null;
    if (!opts.priority) {
      priorityFlashLine = null;
    }
  }
  actionLineHistory = recordStatusActionLine(actionLineHistory, line);
  pendingActionLineCount = Math.min(pendingActionLineCount + 1, actionLineHistory.length);
  if (opts.priority) {
    priorityFlashLine = actionLineHistory[0] ?? line;
  }
  const currentActionLine = actionLineHistory[0] ?? '';
  if (currentActionLine) {
    logLines.unshift(`> ${currentActionLine}`);
    if (logLines.length > 20) logLines.splice(20);
    logContentEl.textContent = logLines.join('\n');
  }
}

function setStatus(richText: string): void {
  if (statusEl) statusEl.innerHTML = richText;
}

function activeInputState(): InputState {
  if (touchPadEl && touchPadEl.mode !== MODE.IDLE) {
    return { mode: touchPadEl.mode, aimKind: touchPadEl.aimKind ?? null };
  }
  return { mode: keyboard?.mode ?? MODE.IDLE, aimKind: keyboard?.aimKind ?? null };
}

function setInputAim(aimKind: AimKind): void {
  keyboard.mode = MODE.AIM;
  keyboard.aimKind = aimKind;
  touchPadEl.setMode(MODE.AIM, aimKind);
  paint({ mode: MODE.AIM, aimKind });
}

function resetInputModes(): void {
  lookCursor = null;
  keyboard.mode = MODE.IDLE;
  keyboard.aimKind = null;
  touchPadEl.setMode(MODE.IDLE);
  // Clear any half-armed thrown-consumable aim. Esc-cancel from
  // aim mode, or a cross-controller cancel, must not leave a stashed item
  // hanging — a later inventory click would otherwise mismatch.
  pendingAimItemId = null;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function isChebyshevAdjacent(a: PointLike, b: PointLike): boolean {
  return chebyshevDistance(a, b) === 1;
}

function chebyshevDistance(a: PointLike, b: PointLike): number {
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
function tryShowKeyHelpOverlay(): 'ok' | 'blocking' | 'no-scope' | 'none' {
  if (isAnyBlockingModalOpen()) return 'blocking';
  const scope = helpScopeForRunState();
  if (!scope) return 'no-scope';
  const scene = currentScene();
  const archetypeId = scene && isRun(scene) ? scene.archetype : undefined;
  keyHelpEl.setScope(scope, archetypeId);
  keyHelpEl.show();
  return 'ok';
}

/**
 * `o`/`O` toggles <settings-modal> — same rules as the header toolbar button.
 * Suppressed while another blocking modal owns the foreground (falls through
 * un-prevented so, e.g., typing "o" into a search field inside that modal
 * still works); closing an already-open settings modal always succeeds.
 */
function toggleSettingsModal(): boolean {
  if (settingsModalEl.isOpen) {
    settingsModalEl.hide();
    return true;
  }
  if (isAnyBlockingModalOpen()) return false;
  settingsModalEl.show();
  return true;
}

/**
 * `?` toggles the help overlay. Esc, when the help overlay is open, dismisses
 * it (and we swallow the event so the keymap doesn't also turn it into a
 * `cancel` intent for whatever aim mode was active).
 *
 * `?` is suppressed while any blocking modal owns the foreground — opening
 * help over a briefing or crew-roster would just stack panels.
 * `o`/`O` for Options follows the same rule (see `toggleSettingsModal`).
 */
export function handleGlobalKey(evt: KeyboardEvent): void {
  if (evt.ctrlKey || evt.metaKey || evt.altKey) return;

  // While <key-help> is open it owns the foreground entirely: `?` and Esc
  // close it; every other key is swallowed so a held WASD doesn't pump
  // moves into the game underneath. (Tested manually — gameplay events
  // routing through this layer was the bug we hit during touchpad
  // testing too.)
  if (keyHelpEl.isOpen) {
    if (evt.key === '?' || evt.key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      keyHelpEl.hide();
      return;
    }
    // Tab navigation: prevent scroll/focus churn but let <key-help> handle it.
    if (KeyHelp.isTabNavKey(evt.key)) {
      evt.preventDefault();
      return;
    }
    // Everything else: block, don't process.
    evt.preventDefault();
    evt.stopPropagation();
    return;
  }

  if (evt.key === 'o' || evt.key === 'O') {
    if (toggleSettingsModal()) evt.preventDefault();
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

function helpScopeForRunState(): HelpScope | null {
  const run = currentScene();
  if (!run) return null;
  if (run.state === CAMPAIGN_STATE.HUB) return 'hub';
  if (run.state === RUN_STATE.COMBAT) return 'combat';
  return null;
}

function isAnyBlockingModalOpen(): boolean {
  if (contractSelectEl?.isOpen) return true;
  if (briefingEl?.isOpen) return true;
  if (crashEl?.isOpen) return true;
  if (gameOverEl?.isOpen) return true;
  if (systemStartEl?.isOpen) return true;
  if (curatorBriefingEl?.isOpen) return true;
  if (initialRecruitEl?.isOpen) return true;
  if (crewRosterEl?.isOpen) return true;
  if (finnShopEl?.isOpen) return true;
  if (clinicModalEl?.isOpen) return true;
  if (settingsModalEl?.isOpen) return true;
  if (combatInventoryEl?.isOpen) return true;
  if (crewInventoryEl?.isOpen) return true;
  if (chronicleArchiveEl?.isOpen) return true;
  if (keyHelpEl?.isOpen) return true;
  if (faultEl?.isOpen) return true;
  if (updateNotificationEl?.isOpen) return true;
  // <confirmation-modal> uses a native <dialog> internally; treat any open
  // attribute as "blocking".
  if (isConfirmationDialogOpen(confirmationModalEl)) return true;
  return false;
}
