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
import { totalSalvage, formatSalvageCompact, type TypedSalvage } from '/src/game/salvage.js';
import { RUN_STATE } from '/src/game/Run.js';
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
import { EVENT, alarmPayloadTriggersRepPenalty } from '/src/game/events.js';
import { VisionField } from '/src/game/Vision.js';
import { describeTileAt } from '/src/game/describe.js';
import { AsciiRenderer } from '/src/render/AsciiRenderer.js';
import { CrtFilter } from '/src/render/CrtFilter.js';
import {
  ANIMATION_DURATIONS,
  createAnimationLock,
  runMuzzleFlash,
  setCorpStaticActive,
  triggerDamageFlash,
  triggerShake,
} from '/src/render/animations.js';
import { KeyboardController } from '/src/input/KeyboardController.js';
import { AIM_KIND, MODE, aimKindLabel } from '/src/input/keymap.js';
import { applyIntent, PLAYER_ACTIONS } from '/src/input/applyIntent.js';
import { recordStatusActionLine, statusActionRows } from '/src/statusActivityRows.js';

import { placeSmoke, clearSmoke } from '/src/game/Smoke.js';
import { formatObjectiveProgressTag } from '/src/game/objectiveProgress.js';
import { placeHazardCluster } from '/src/game/Run.js';
import { blastCells } from '/src/game/breachBlast.js';
import { hasLineOfSight } from '/src/game/LineOfSight.js';
import { ITEM_ID, getItemById } from '/src/game/items.js';
import type { CampaignSnapshot } from '/src/game/persistence.js';
import type { Contract } from '/src/game/hub/Curator.js';
import { isTerminalRecruitmentUnlocked } from '/src/game/hub/hubReveals.js';
import type { Crew } from '/src/game/Crew.js';
import { resolveEntityLabel, type Entity } from '/src/game/Entity.js';
import type { Run, RunResult, RunTelemetry, Outcome } from '/src/game/Run.js';
import type { Item } from '/src/game/items.js';
import type { Intent } from '/src/input/applyIntent.js';
import type { AimKind, Mode } from '/src/input/keymap.js';
import type { KeyItem, Telemetry, TurnActionStep } from '/src/types.js';
import { installErrorBoundary, type FaultSignal } from '/src/errorBoundary.js';
import { h, isDevelopmentMode } from '/src/domUtils.js';

import '/components/ConfirmationModal.js';
import '/components/UpdateNotification.js';
import '/components/TouchPad.js';
import '/components/ContractSelect.js';
import '/components/RunBriefing.js';
import '/components/CrashDump.js';
import '/components/FaultScreen.js';
import '/components/SystemStart.js';
import '/components/CuratorBriefing.js';
import type { CuratorBriefingContent } from '/components/CuratorBriefing.js';
import '/components/InitialRecruit.js';
import '/components/CrewList.js';
import '/components/CrewRoster.js';
import '/components/FinnShop.js';
import '/components/ClinicModal.js';
import '/components/ItemInventory.js';
import KeyHelp from '/components/KeyHelp.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type ShellScene = Campaign | Run;
type SmokeOverlay = ReturnType<typeof placeSmoke>[number];
type HelpScope = 'hub' | 'combat';
type PointLike = Pick<Entity, 'x' | 'y'> | { x: number; y: number } | null | undefined;

type ModalElement = HTMLElement & {
  show(): void;
  hide(): void;
  readonly isOpen: boolean;
};
type RunBriefingElement = ModalElement & {
  setContract(contract: Contract): void;
  setCrew(crew: Crew[]): void;
};
type ContractSelectElement = ModalElement & {
  setContracts(contracts: Contract[]): void;
};
type CrashDumpElement = ModalElement & {
  setTelemetry(telemetry: Record<string, unknown>): void;
};
type FaultScreenElement = ModalElement & {
  show(detail: { code?: string }): void;
};
type SystemStartElement = ModalElement & {
  setSession(session: { seed: number }): void;
};
type CuratorBriefingElement = ModalElement & {
  setBriefing(content: CuratorBriefingContent): void;
};
type InitialRecruitElement = ModalElement & {
  setCandidates(candidates: Crew[]): void;
};
type CrewRosterElement = ModalElement & {
  setCrew(
    crew: Crew[],
    opts?: {
      salvage?: TypedSalvage;
      availableRecruits?: Crew[];
      recruitedThisVisit?: boolean;
    }
  ): void;
};
type FinnShopElement = ModalElement & {
  setCatalog(
    catalog: Item[],
    crew: Crew[],
    balances: { credits: number; salvage: TypedSalvage }
  ): void;
};
type ClinicModalElement = ModalElement & {
  setPatients(crew: Crew[], balances: { credits: number; healedMemberIds?: string[] }): void;
};
type ItemInventoryElement = ModalElement & {
  setContents(contents: {
    salvage?: TypedSalvage;
    consumables?: NonNullable<Crew['inventory']>['consumables'];
    keyItems?: KeyItem[];
  }): void;
  /** Legacy single-arg API — prefer `setContents`. */
  setItems(consumables: NonNullable<Crew['inventory']>['consumables']): void;
};
type KeyHelpElement = ModalElement & {
  setScope(scope: HelpScope, archetypeId?: string): void;
};
type TouchPadElement = HTMLElement & {
  mode: Mode;
  aimKind: AimKind | null;
  setMode(mode: Mode, aimKind?: AimKind | null): void;
  setBlocked(predicate: (() => boolean) | null): void;
};
type InputState = {
  mode: Mode;
  aimKind: AimKind | null;
};
type ConfirmationModalElement = HTMLElement & {
  showModal(message: string, context?: unknown): void;
};
type UpdateNotificationElement = HTMLElement & {
  show(pendingWorker: ServiceWorker | null): void;
};

type PendingJobResult = {
  outcome: Outcome;
  telemetry: RunTelemetry & { outcome: Outcome };
};

type EntityDamagedPayload = {
  target?: Entity;
  damage?: number;
  killed?: boolean;
  source?: string;
};

type NoisePayload = {
  kind?: string;
  origin?: { x: number; y: number };
};

type DoorUnlockPayload = {
  label?: string;
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
let visionMoveUnsub: (() => void) | null = null;
let repUnsubs: (() => void)[] = [];
let civilianHarmsThisJob = 0;

let canvas: HTMLCanvasElement;
let statusEl: HTMLElement | null = null;
let renderer: AsciiRenderer;
let crt: CrtFilter;
let stageEl: HTMLElement;
let canvasStaticEl: HTMLElement;
let briefingEl: RunBriefingElement;
let contractSelectEl: ContractSelectElement;
let crashEl: CrashDumpElement;
let faultEl: FaultScreenElement;
let systemStartEl: SystemStartElement;
let curatorBriefingEl: CuratorBriefingElement;
/** Status line to flash after the player dismisses a Hub reveal briefing. */
let hubRevealFollowUpFlash: string | null = null;
let initialRecruitEl: InitialRecruitElement;
let confirmationModalEl: ConfirmationModalElement;
let touchPadEl: TouchPadElement;
let crewRosterEl: CrewRosterElement;
let finnShopEl: FinnShopElement;
let clinicModalEl: ClinicModalElement;
let itemInventoryEl: ItemInventoryElement;
let keyHelpEl: KeyHelpElement;
let logEl: HTMLElement;
let logHeaderEl: HTMLElement;
let logContentEl: HTMLPreElement;
let keyboard: KeyboardController;

let currentJobOptions: Contract[] = [];

/**
 * Animation-lock for M0 combat feedback. Listeners on the run bus
 * (`attachAnimationListeners`) push durations as effects fire; both
 * input controllers consult `isLocked()` so a key held mid-shake doesn't
 * sneak through. See `src/render/animations.js`.
 */
const animLock = createAnimationLock();
/** Unsubscribers for the run-bus animation listeners. Re-bound on every state transition. */
let animationUnsubs: (() => void)[] = [];

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
/**
 * Active smoke overlays from Smoke Charge consumables. Each entry records
 * the tile position and original tile type so `clearSmoke` can restore the
 * grid. Cleared at the start of the player's next turn (`onPlayerTurnReady`).
 */
let activeSmokeOverlays: SmokeOverlay[] = [];
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

const allComponentsReady = Promise.all([
  customElements.whenDefined('update-notification'),
  customElements.whenDefined('confirmation-modal'),
  customElements.whenDefined('finn-shop'),
  customElements.whenDefined('clinic-modal'),
  customElements.whenDefined('item-inventory'),
  customElements.whenDefined('contract-select'),
  customElements.whenDefined('fault-screen'),
  customElements.whenDefined('touch-pad'),
  customElements.whenDefined('crew-list'),
  customElements.whenDefined('crew-roster'),
  customElements.whenDefined('key-help'),
  customElements.whenDefined('system-start'),
  customElements.whenDefined('curator-briefing'),
  customElements.whenDefined('initial-recruit'),
]);

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

function isRun(scene: ShellScene): scene is Run {
  return 'archetype' in scene;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  canvas = mustGetElement<HTMLCanvasElement>('game-canvas');
  if (!canvas.parentElement) {
    throw new Error('[shell] #game-canvas requires a parent stage element');
  }
  stageEl = canvas.parentElement;
  canvasStaticEl = h('div', { className: 'game-canvas-static', ariaHidden: 'true' });
  canvas.insertAdjacentElement('afterend', canvasStaticEl);
  new ResizeObserver(() => syncCanvasStaticOverlay()).observe(canvas);
  statusEl = mustGetElement<HTMLElement>('game-status');
  contractSelectEl = mustGetElement<ContractSelectElement>('contract-select');
  briefingEl = mustGetElement<RunBriefingElement>('briefing');
  crashEl = mustGetElement<CrashDumpElement>('crash');
  faultEl = mustGetElement<FaultScreenElement>('fault-screen');
  systemStartEl = mustGetElement<SystemStartElement>('system-start');
  curatorBriefingEl = mustGetElement<CuratorBriefingElement>('curator-briefing');
  initialRecruitEl = mustGetElement<InitialRecruitElement>('initial-recruit');
  confirmationModalEl = mustGetElement<ConfirmationModalElement>('confirm-modal');
  touchPadEl = mustGetElement<TouchPadElement>('touch-pad');
  crewRosterEl = mustGetElement<CrewRosterElement>('crew-roster');
  finnShopEl = mustGetElement<FinnShopElement>('finn-shop');
  clinicModalEl = mustGetElement<ClinicModalElement>('clinic-modal');
  itemInventoryEl = mustGetElement<ItemInventoryElement>('item-inventory');
  keyHelpEl = mustGetElement<KeyHelpElement>('key-help');
  logEl = mustQuery<HTMLElement>('.game-log');
  logHeaderEl = mustQuery<HTMLElement>('.game-log h3');
  logContentEl = mustQuery<HTMLPreElement>('pre', logEl);

  renderer = new AsciiRenderer(canvas);
  crt = new CrtFilter(canvas);

  keyboard = new KeyboardController({
    onIntent: (intent: Intent) => {
      handleIntent(intent);
      paint();
    },
    onModeChange: () => {
      // Keep the keyboard / touchpad in lock-step so the cross-input cancel
      // rule the M7 harness established still holds in the shell.
      handleInputModeChange();
      paint();
    },
    isBlocked: () => animLock.isLocked() || isAnyBlockingModalOpen(),
  });
  keyboard.attach();

  // `?` and Esc-for-help live above the keymap: `?` is a UI toggle (not a
  // game intent), and Esc must reach <key-help> before the keymap turns it
  // into a `cancel` intent. Capture phase + a return-early when the help
  // panel is open keeps both behaviours clean.
  window.addEventListener('keydown', handleGlobalKey, true);

  contractSelectEl.addEventListener('contract-selected', onContractSelected);
  contractSelectEl.addEventListener('dismiss', () => contractSelectEl.hide());
  briefingEl.addEventListener('deploy', onBriefingDeploy);
  briefingEl.addEventListener('dismiss', onBriefingDismiss);
  crashEl.addEventListener('new-run', onNewRunRequested);
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

  itemInventoryEl.addEventListener('use-item', onUseItem);
  itemInventoryEl.addEventListener('dismiss', () => itemInventoryEl.hide());

  keyHelpEl.addEventListener('dismiss', () => keyHelpEl.hide());

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

  logHeaderEl.addEventListener('click', () => {
    logEl.classList.toggle('collapsed');
    syncCanvasStaticOverlay();
  });

  // Update-notification wiring kept from the original scaffold.
  const updateNotification = mustQuery<UpdateNotificationElement>('update-notification');
  window.addEventListener('sw-update-available', event => {
    const detail = (event as CustomEvent<{ pendingWorker: ServiceWorker | null }>).detail;
    updateNotification.show(detail.pendingWorker);
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
    crew: [],
    onPersist: handlePersist,
    onResult: handleResult,
  });

  pendingJobResult = null;
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
  initialRecruitEl.hide();
  // Now the crew is set — enter the hub for the first time (builds world, persists).
  campaign.enterHub();
  enterHubAndRender();
  const names = campaign.crew.map(m => m.callsign).join(' and ');
  flash(`CURATOR: ${names} on the board. Find me when you want work.`);
}

function hideBlockingShellModals(): void {
  keyHelpEl?.hide();
  briefingEl?.hide();
  crashEl?.hide();
  contractSelectEl?.hide();
  systemStartEl?.hide();
  curatorBriefingEl?.hide();
  initialRecruitEl?.hide();
  crewRosterEl?.hide();
  finnShopEl?.hide();
  clinicModalEl?.hide();
  itemInventoryEl?.hide();
}

function abortShellForFault(): void {
  hideBlockingShellModals();
  invalidateCombatPumps();
  pendingJobResult = null;
  hubRevealFollowUpFlash = null;
  corpToneActivityBody = null;
  clearBreachBlastOverlay(false);
  resetInputModes();
  activeSmokeOverlays = [];
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
  curatorBriefingEl.setBriefing({ title: reveal.title, lines: reveal.lines });
  curatorBriefingEl.show();
  return true;
}

function onCuratorBriefingDismiss(): void {
  curatorBriefingEl.hide();
  if (hubRevealFollowUpFlash) {
    flash(hubRevealFollowUpFlash);
    hubRevealFollowUpFlash = null;
  }
}

function enterHubAndRender() {
  if (!campaign?.curator) {
    throw new Error('enterHubAndRender: hub not entered — curator is missing.');
  }
  attachVisionListener();
  attachAnimationListeners();
  attachRepListeners();
  recomputeVision();
  renderShell();
  if (!presentHubRevealIfAny('HUB — Curator has contracts when you are adjacent [Space].')) {
    flash('HUB — Curator has contracts when you are adjacent [Space].');
  }
  // generate job options once on hub enter
  currentJobOptions = campaign.curator.generateContracts(campaign.rng, campaign);
}

function presentCrewRoster() {
  if (!campaign) return;
  campaign.backfillRecruitsIfEligible();
  crewRosterEl.setCrew(campaign.crew, {
    salvage: campaign.salvage,
    availableRecruits: campaign.availableRecruits,
    recruitedThisVisit: campaign.recruitedThisVisit,
  });
  crewRosterEl.show();
}

function onCrewRecruit(evt: Event) {
  if (!campaign) return;
  const { recruitId } = (evt as CustomEvent<{ recruitId: string }>).detail;
  try {
    campaign.recruit(recruitId);
    const member = campaign.getCrewMember(recruitId);
    flash(`NEW OPERATIVE: ${member?.callsign ?? recruitId} joins the collective.`);
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
  contractSelectEl.setContracts(contracts);
  contractSelectEl.show();
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
  const { memberId, contract } = (evt as CustomEvent<{ memberId?: string; contract?: Contract }>)
    .detail;
  if (!memberId || !contract) return;
  const member = campaign.getCrewMember(memberId);
  if (!member || member.flatlined) return;
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
    run = campaign.deployCrewMember(member.id, contract);
    flash(`CURATOR: ${member.callsign} takes ${contract.label}. JACKING IN.`);
  }

  // Wire abort confirmation so stepping on exit with an incomplete objective
  // pops a modal instead of silently ending the run.
  run.onAbortRequested = () => {
    confirmationModalEl.showModal(
      `Objective incomplete. Abort extraction?\n\nYou will lose all rewards and take a REP ${REP.ABORT_PENALTY} penalty.`,
      'abort-run'
    );
  };

  // Go straight into combat — the player already reviewed the contract and
  // chose their operative in the combined briefing modal.
  if (!run || run.state !== RUN_STATE.BRIEFING) {
    throw new Error(`[shell] expected deployed run to enter BRIEFING, got ${run?.state}`);
  }
  run.enterCombat();
  handlePersist();
  vision.resetFogState();
  attachVisionListener();
  attachAnimationListeners();
  attachRepListeners();
  recomputeVision();
  flash('JACKED IN. Reach the exit tile (¤) before the corpos drop you.');
  renderShell();
}

function presentFinnShop() {
  if (!campaign || !campaign.finn) return;
  const catalog = campaign.finn.catalog(campaign.rep);
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
  presentFinnShop();
}

function presentItemInventory() {
  if (!campaign) return;
  // M4.2: inventory is now available in both Hub and combat. The two states
  // surface different wallets:
  //   - Combat: the deployed crew member's job-scoped inventory (what they've
  //     picked up this run + their consumables).
  //   - Hub:    the campaign-wide accumulated salvage. No active crew member,
  //     so no consumables list — the player visits the shop or roster for
  //     per-crew loadout management.
  // This keeps the overlay's mental model simple: it always shows the
  // currently meaningful wallet for the state the player is standing in.
  if (campaign.state === CAMPAIGN_STATE.HUB) {
    itemInventoryEl.setContents({
      salvage: campaign.salvage,
      consumables: [],
      keyItems: campaign.keyItems,
    });
    itemInventoryEl.show();
    return;
  }
  const run = campaign.activeRun;
  if (!run || !run.player || !run.player.inventory) return;
  itemInventoryEl.setContents({
    salvage: run.player.inventory.salvage,
    consumables: run.player.inventory.consumables,
    keyItems: [...campaign.keyItems, ...run.keyItems],
  });
  itemInventoryEl.show();
}

/**
 * Stashed item id for M4.3 thrown-consumable aim flow. Set when the
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
    if (!run.player.canAfford(AP_COST.INTERACT)) {
      // Cheap pre-check: don't strand the player in aim mode if `useConsumable`
      // will reject the commit anyway. Crew's `canAfford(AP_COST.INTERACT)`
      // remains the source of truth at commit time.
      flash('USE FAILED: insufficient AP.');
      return;
    }
    pendingAimItemId = itemId;
    itemInventoryEl.hide();
    setInputAim(AIM_KIND.USE_ITEM);
    flash(`AIM ${descriptor.label.toUpperCase()} — pick a direction (Esc to cancel).`);
    return;
  }
  try {
    const result = run.player.useConsumable(itemId);
    applyUseConsumableResult(result, run);
  } catch (err) {
    flash(`USE FAILED: ${errorMessage(err)}`);
    return;
  }
  itemInventoryEl.hide();
  paint();
  if (run.player.ap === 0) {
    advanceTurn();
  }
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
  if (result.type === 'stim') {
    const healed = (result as { healed: number }).healed;
    flash(
      `Used STIM — healed ${healed} HP (now ${run.player.hp}/${run.player.maxHp}). ${run.player.ap} AP left.`
    );
    return;
  }
  if (result.type === 'smoke') {
    const { cx, cy, radius } = result as { cx: number; cy: number; radius: number };
    if (!Number.isInteger(cx) || !Number.isInteger(cy) || !Number.isInteger(radius)) {
      throw new Error('[shell] smoke consumable returned invalid placement data');
    }
    const overlays = placeSmoke(run.world.grid, cx, cy, radius);
    activeSmokeOverlays.push(...overlays);
    recomputeVision();
    flash(`Used SMOKE CHARGE — LOS blocked in radius ${radius}. ${run.player.ap} AP left.`);
    return;
  }
  if (result.type === 'incendiary') {
    const { cx, cy } = result as { cx: number; cy: number };
    if (!Number.isInteger(cx) || !Number.isInteger(cy)) {
      throw new Error('[shell] incendiary consumable returned invalid placement data');
    }
    // `placeHazardCluster` only stamps onto FLOOR tiles inside bounds — if
    // the target is on/past the map edge or buried in a wall, the cluster
    // simply finds zero candidates and stamps nothing. We've already paid
    // AP and consumed the charge in Crew.useConsumable; the LOS pre-check
    // in `resolveAimedUseItem` is what protects the player from "throw
    // through a wall and lose your bomb."
    const stamped = placeHazardCluster(run.world, { x: cx, y: cy }, run.rng);
    if (stamped === 0) {
      flash(`Used INCENDIARY — bomb landed on hard cover; no fire took. ${run.player.ap} AP left.`);
    } else {
      flash(
        `Used INCENDIARY — ${stamped} tile${stamped === 1 ? '' : 's'} ignited. ${run.player.ap} AP left.`
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
    flash(`BREACHING CHARGE planted. Detonates end of turn. ${run.player.ap} AP left.`);
    recomputeVision();
    return;
  }
  throw new Error(`[shell] applyUseConsumableResult: unknown result.type "${result.type}"`);
}

/**
 * Resolve an aimed `use-item { dx, dy }` intent. Pairs the keymap's direction
 * pick with the shell's stashed `pendingAimItemId` and runs the LOS-clear
 * pre-check before mutating state. Called from `applyIntent`'s onUseItem
 * callback (M4.3).
 */
function resolveAimedUseItem(aim: { dx: number; dy: number }, run: Run): void {
  if (!run.world || !run.player) throw new Error('[shell] resolveAimedUseItem: no scene');
  const itemId = pendingAimItemId;
  if (!itemId) {
    // Direction press arrived without a stashed item — shouldn't be reachable
    // (the keymap only emits use-item from MODE.AIM / use-item aimKind, which
    // only the shell can enter), but crash loud if it does so the wiring bug
    throw new Error('[shell] use-item intent received without pendingAimItemId');
  }
  pendingAimItemId = null;
  if (itemId === ITEM_ID.INCENDIARY) {
    // LOS-clear-target pre-check (M4.3 acceptance): the throw lands at
    // `player + dir * INCENDIARY_THROW_DIST`. If LOS from the thrower to
    // that tile is blocked (or the tile is out of bounds), refuse the
    // throw *before* spending AP / consuming the bomb.
    const cx = run.player.x + aim.dx * INCENDIARY_THROW_DIST;
    const cy = run.player.y + aim.dy * INCENDIARY_THROW_DIST;
    if (!run.world.grid.inBounds(cx, cy)) {
      flash('USE FAILED: target is off the map.');
      paint();
      return;
    }
    const blockers = run.world.blockerKeys();
    if (!hasLineOfSight(run.world.grid, run.player.x, run.player.y, cx, cy, { blockers })) {
      flash('USE FAILED: target is behind cover.');
      paint();
      return;
    }
  }
  if (itemId === ITEM_ID.BREACHING_CHARGE) {
    const tx = run.player.x + aim.dx * BREACHING_CHARGE_RANGE;
    const ty = run.player.y + aim.dy * BREACHING_CHARGE_RANGE;
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
    const result = run.player.useConsumable(itemId, aim);
    applyUseConsumableResult(result, run);
  } catch (err) {
    flash(`USE FAILED: ${errorMessage(err)}`);
    paint();
    return;
  }
  paint();
  if (run.player.ap === 0) {
    advanceTurn();
  }
}

function handlePersist() {
  if (!campaign || degrading) return;
  dataStore.setCampaign(snapshotCampaign(campaign));
}

function crewMemberArchetypeId(member: Crew): string {
  const n = member?.constructor?.name;
  if (n === 'Merc') return 'merc';
  if (n === 'Razor') return 'razor';
  if (n === 'Tech') return 'tech';
  return 'op';
}

function telemetryForEndedCampaign(c: Campaign): Telemetry {
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
  const campaignTerminal =
    outcome === 'death' && campaign ? willEndCampaignOnThisDeath(campaign) : false;
  crashEl.setTelemetry({
    ...tel,
    outcome,
    campaignTerminal,
  });
}

function handleResult({ outcome, telemetry }: RunResult) {
  if (degrading) return;
  pushPendingJobResultOverlay({
    ...telemetry,
    outcome: telemetry?.outcome ?? outcome,
  });
  renderShell();
}

function currentScene(): ShellScene | null {
  if (!campaign) return null;
  return campaign.activeRun ?? campaign;
}

function resumeCampaign(record: CampaignSnapshot | unknown) {
  try {
    campaign = restoreCampaign(record, {
      onPersist: () => handlePersist(),
      onResult: handleResult,
    });
    if (campaign.activeRun?.state === RUN_STATE.COMBAT) {
      vision.resetFogState();
      vision.restoreSeen(campaign.activeRun.mapSeenKeys());
    }
    attachVisionListener();
    attachAnimationListeners();
    attachRepListeners();
    recomputeVision();
    if (campaign.activeRun?.state === RUN_STATE.BRIEFING && campaign.activeRun.contract) {
      briefingEl.setContract(campaign.activeRun.contract);
      briefingEl.setCrew(campaign.crew);
    }
    resumePendingCombatSliceIfNeeded();
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
  crashEl.hide();
  crewRosterEl.hide();
  finnShopEl.hide();
  clinicModalEl.hide();
  itemInventoryEl.hide();

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
    flash('CORP TURN — controls locked until security finishes.');
    return;
  }
  enterLookMode();
}

function enterLookMode(): void {
  const run = currentScene();
  if (!run?.world || !run.player) return;
  if (lookCursor) return;
  lookCursor = { x: run.player.x, y: run.player.y };
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
    flash('CORP TURN — controls locked until security finishes.');
    return;
  }
  const run = currentScene();
  if (!run?.world || !run.player) return;
  if (!lookCursor) {
    lookCursor = { x: run.player.x, y: run.player.y };
  }
  const tx = Math.max(0, Math.min(run.world.grid.width - 1, lookCursor.x + dx));
  const ty = Math.max(0, Math.min(run.world.grid.height - 1, lookCursor.y + dy));
  if (run.state === RUN_STATE.COMBAT && !vision.hasSeen(tx, ty)) {
    flash("You haven't seen that tile.");
    return;
  }
  lookCursor = { x: tx, y: ty };
  const line = describeTileAt(run.world, tx, ty, {
    vision: run.state === RUN_STATE.COMBAT ? vision : undefined,
  });
  if (line) flash(line);
}

function handleIntent(intent: Intent): void {
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

  if (intent?.type === 'cancel' && lookCursor) {
    exitLookMode();
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

  if (!run.world || !run.player || !run.queue) {
    throw new Error(`[shell] state "${run.state}" is missing playable scene wiring`);
  }

  applyIntent(intent, {
    world: run.world,
    player: run.player as Parameters<typeof applyIntent>[1]['player'],
    queue: run.queue,
    rng: run.rng,
    // Capture the action line for the next paint(); see lastActionLine docs.
    log: (line: string) => flash(line),
    advanceTurn,
    resetInputModes,
    onUseItem: (aim: { dx: number; dy: number }) => {
      resolveAimedUseItem(aim, run as Run);
    },
    onCorpseSalvaged: entity => {
      vision.forgetCorpse(entity);
    },
    keyItems: [...(campaign?.keyItems ?? []), ...(run as Run).keyItems],
    onKeycardCollected: kc => {
      if (kc.siteId) {
        // Campaign-scoped: persists across runs (M7.2).
        if (campaign?.keyItems.some(k => k.id === kc.id)) {
          return;
        }
        campaign?.addKeyItem({ id: kc.id, label: kc.label, doorId: kc.doorId, siteId: kc.siteId });
      } else {
        // Run-scoped: lives only in this run, discarded on run end.
        (run as Run).addKeyItem({ id: kc.id, label: kc.label, doorId: kc.doorId });
      }
    },
    onPlayerAction: (actionName: string) => {
      switch (actionName) {
        case PLAYER_ACTIONS.INVENTORY:
          // M4.2: inventory opens in Hub *and* combat. In combat we still
          // restrict to the player's turn so peeking doesn't dodge corp
          // tempo; in Hub there's no turn queue gating to worry about.
          if (campaign?.state === CAMPAIGN_STATE.COMBAT) {
            if (run.state !== RUN_STATE.COMBAT || run.queue?.currentFaction !== FACTION.PLAYER) {
              flash('Inventory is only available on your turn.');
              return;
            }
          }
          presentItemInventory();
          break;
        case PLAYER_ACTIONS.INTERACT:
          handleInteract();
          break;
        case PLAYER_ACTIONS.REACHED_EXIT:
          if (campaign?.state === CAMPAIGN_STATE.HUB) {
            flash('Curator: Hang tight! Come talk to me to claim a contract.');
          }
          advanceTurn();
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
      drivePlayerAftermath({
        world,
        rng: run.rng,
        onStep,
        onFinish: () => {
          if (degrading) return;
          clearBreachBlastOverlay(false);
          onFinish();
        },
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
      if (step.type === 'breach-detonate') {
        showBreachBlastOverlay(step.charge.x, step.charge.y);
        if (scene?.player && vision.isVisible(step.charge.x, step.charge.y)) {
          triggerShake(stageEl);
          animLock.push(ANIMATION_DURATIONS.SHAKE);
        }
      }
      if (
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
      // Clear any smoke from last turn before the player acts.
      if (activeSmokeOverlays.length > 0) {
        clearSmoke(world.grid, activeSmokeOverlays);
        activeSmokeOverlays = [];
      }
      // Stealth & vision may both have changed during the corp turn.
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
  if (run.queue.currentFaction !== FACTION.CORP) return;
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
  if (!run.world) {
    throw new Error(`[shell] cannot drive corp turn without world in state "${run.state}"`);
  }
  driveCorpTurn({
    run: {
      state: run.state ?? '',
      world: run.world,
      rng: run.rng,
    },
    corpFaction: FACTION.CORP,
    paint,
    animLock,
    actionDelayMs: CORP_ACTION_DELAY_MS,
    lockMarginMs: ANIMATION_DURATIONS.MUZZLE_FLASH,
    onFinish,
    schedule: scheduleCombatPump,
    shouldAnimateStep: (entityId: string, step: TurnActionStep) => {
      if (degrading) return true;
      const scene = currentScene();
      if (!scene?.world || !scene.player) return true;
      return isCorpTurnStepVisibleToPlayer(scene.world, scene.player.id, entityId, step, (x, y) =>
        vision.isVisible(x, y)
      );
    },
    onStep: (entityId: string, step: TurnActionStep) => {
      if (degrading) return;
      const scene = currentScene();
      if (!scene?.world || !scene.player) return;
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
    campaign.terminal &&
    isChebyshevAdjacent(campaign.player, campaign.terminal)
  ) {
    if (!isTerminalRecruitmentUnlocked(campaign.hubReveals)) {
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
    currentJobOptions = campaign.curator.generateContracts(campaign.rng, campaign);
  }
  flash('CURATOR: Three jobs on the board. Pick your trouble.');
  presentContractSelect(currentJobOptions);
}

/**
 * Combat interact — scan Chebyshev-adjacent tiles for a lootable corpse.
 * If found: call `player.collectSalvage`, flash result, auto-end turn on AP
 * exhaustion. If not found: show a no-loot hint.
 */
function handleCombatInteract(): void {
  if (!campaign) return;
  const run = campaign.activeRun;
  if (!run || !run.player) return;
  if (!run.world) throw new Error('[shell] active combat run has no world');
  const player = run.player;
  if (!player.inventory) throw new Error('[shell] combat player inventory is not initialised');
  // Scan the 8 neighbours plus the player's own tile for lootable corpses.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = player.x + dx;
      const ty = player.y + dy;
      const entity = run.world.lootableCorpseAt(tx, ty);
      if (entity && !entity.alive && entity.loot && totalSalvage(entity.loot.salvage) > 0) {
        if (!player.canAfford(AP_COST.INTERACT)) {
          flash('Insufficient AP to loot.');
          return;
        }
        // M4.2: typed salvage — show pickup total + post-pickup compact wallet.
        const amount = totalSalvage(entity.loot.salvage);
        player.collectSalvage(run.world, entity);
        vision.forgetCorpse(entity);
        flash(
          `Salvaged +${amount} — carrying ${formatSalvageCompact(player.inventory.salvage)}. ${player.ap} AP left.`
        );
        paint();
        if (player.ap === 0) {
          advanceTurn();
        }
        return;
      }
    }
  }

  const interactable = run.world.adjacentInteractables(player)[0];
  if (interactable) {
    const result = interactable.interact(run.world, player);
    flash(result.message);
    paint();
    if (result.ok && player.ap === 0) {
      advanceTurn();
    }
    return;
  }

  flash('Nothing to interact with nearby.');
}

// onJackIn removed — combat entry is handled in onBriefingDeploy.

function onNewRunRequested(): void {
  if (!campaign) return;
  if (pendingJobResult) {
    const jobResult = pendingJobResult;
    const { outcome } = jobResult;
    pendingJobResult = null;
    // M3 + M4.2: extract typed salvage from the deployed crew member's
    // inventory on exit. Death outcomes pass `undefined` so onJobEnd defaults
    // to an empty wallet (loot forfeited on flatline).
    const member = campaign.deployedMemberId
      ? campaign.getCrewMember(campaign.deployedMemberId)
      : null;
    const salvage = member?.inventory?.salvage;
    const objectiveComplete =
      outcome === 'exit' ? jobResult.telemetry.objectiveComplete !== false : false;
    // M5: clean completion bonus — must run *before* `onJobEnd` so `enterHub` →
    // `generateRecruits()` sees the updated Rep (M6 recruitment gates at 65).
    if (outcome === 'exit' && objectiveComplete && civilianHarmsThisJob === 0) {
      const actual = campaign.adjustRep(REP.CLEAN_COMPLETION_BONUS);
      flash(`REP +${actual}: clean extraction — no civilian casualties.`);
    }
    if (outcome === 'exit' && !objectiveComplete) {
      flash(`ABORT: Objective abandoned. REP ${REP.ABORT_PENALTY}.`);
    }
    campaign.onJobEnd({ outcome, salvage, completed: objectiveComplete });
    if (campaign.state === CAMPAIGN_STATE.ENDED) {
      dataStore.deleteCampaign();
      startFreshCampaign();
      return;
    } else {
      if (!presentHubRevealIfAny('HUB — choose the next job.')) {
        flash('HUB — choose the next job.');
      }
      // reset the current job options
      if (!campaign.curator) {
        throw new Error('onNewRunRequested: hub not entered — curator is missing.');
      }
      currentJobOptions = campaign.curator.generateContracts(campaign.rng, campaign);
    }
  } else if (campaign.state === CAMPAIGN_STATE.ENDED) {
    dataStore.deleteCampaign();
    startFreshCampaign();
    return;
  }
  crashEl.hide();
  attachVisionListener();
  attachAnimationListeners();
  attachRepListeners();
  recomputeVision();
  renderShell();
}

// ---------------------------------------------------------------------------
// Vision (mirrors the M5 harness rule: refresh on every entity move)
// ---------------------------------------------------------------------------

function attachVisionListener(): void {
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
function attachAnimationListeners(): void {
  for (const off of animationUnsubs) off();
  animationUnsubs = [];
  const run = currentScene();
  if (!run?.bus) return;
  animationUnsubs.push(
    run.bus.on(EVENT.ENTITY_DAMAGED, payload => {
      const { target, damage = 0, killed, source } = (payload ?? {}) as EntityDamagedPayload;
      // Player-side feedback: screen shake + red vignette when *we* get hit.
      if (run?.player && target === run.player && damage > 0) {
        triggerShake(stageEl);
        triggerDamageFlash(stageEl);
        animLock.push(ANIMATION_DURATIONS.DAMAGE_FLASH);
      }
      // Melee impact: the strike reads as landing on the *target*, not
      // hovering above the attacker. Ranged stays on the NOISE path so
      // misses still get a muzzle flash on the shooter's tile.
      if (source === 'melee' && target && damage > 0) {
        const fired = runMuzzleFlash(renderer, paint, target.x, target.y);
        if (fired) animLock.push(ANIMATION_DURATIONS.MUZZLE_FLASH);
      }
      // M3: memorise corpse position when a kill occurs within current LOS.
      if (killed && target && vision.isVisible(target.x, target.y)) {
        vision.memoriseCorpse(target);
      }
    }),
    run.bus.on(EVENT.NOISE, payload => {
      const noise = (payload ?? {}) as NoisePayload;
      // Muzzle flash on the shooter's tile. Melee is handled via
      // ENTITY_DAMAGED above (so we know the *target* position); NOISE
      // for melee would only know the attacker.
      if (noise.kind !== 'ranged') return;
      const origin = noise.origin;
      if (!origin) return;
      const fired = runMuzzleFlash(renderer, paint, origin.x, origin.y);
      if (fired) animLock.push(ANIMATION_DURATIONS.MUZZLE_FLASH);
    }),
    run.bus.on(EVENT.DOOR_UNLOCKED, payload => {
      const { label = 'Door' } = (payload ?? {}) as DoorUnlockPayload;
      flash(`${label} unlocked — passage open.`);
    })
  );
}

/**
 * Subscribe M5 Rep-affecting events to the active run's bus.
 *
 *   - `civilian:harmed` → -20 Rep per kill, track all harm for clean completion.
 *   - `alarm` with `kind: 'facility'` → -5 Rep per facility raise (complicity).
 *     Lookout `kind: 'lookout'` pings do not adjust Rep.
 *
 * Re-attached on every Run state transition (same posture as animations).
 */
function attachRepListeners(): void {
  for (const off of repUnsubs) off();
  repUnsubs = [];
  civilianHarmsThisJob = 0;
  const run = currentScene();
  if (!run?.bus || !campaign) return;
  repUnsubs.push(
    run.bus.on(EVENT.CIVILIAN_HARMED, payload => {
      if (!campaign) return;
      civilianHarmsThisJob++;
      const { killed } = (payload ?? {}) as { killed?: boolean };
      if (killed) {
        const actual = campaign.adjustRep(REP.CIVILIAN_KILL_PENALTY);
        flash(`REP ${actual >= 0 ? '+' : ''}${actual}: civilian killed.`);
      }
    }),
    run.bus.on(EVENT.ALARM, payload => {
      if (!campaign || !alarmPayloadTriggersRepPenalty(payload)) return;
      const actual = campaign.adjustRep(REP.ALARM_PENALTY);
      flash(`REP ${actual >= 0 ? '+' : ''}${actual}: facility alarm triggered.`);
    }),
    run.bus.on(EVENT.ALARM_CHANGED, payload => {
      const transition = (payload as { transition?: string } | undefined)?.transition;
      if (transition === 'cooldown') {
        flash('ALERT: heat tapering — corp net entering cooldown.');
      } else if (transition === 'quiet') {
        flash('ALERT: facility net quiet.');
      }
    }),
    run.bus.on(EVENT.OBJECTIVE_TIMER_EXPIRED, payload => {
      const contract = (payload as { contract?: { objective?: { title?: string } } } | undefined)
        ?.contract;
      const title = contract?.objective?.title ?? 'objective';
      flash(`WINDOW CLOSED: ${title} can no longer be completed cleanly.`);
    })
  );
}

function recomputeVision(): void {
  const run = currentScene();
  if (!run || !run.world || !run.player) return;
  vision.recompute(run.world.grid, run.player, undefined, {
    blockers: run.world.blockerKeys(),
  });
  if (isRun(run) && run.state === RUN_STATE.COMBAT) {
    run.recordMapSeen(vision.seen);
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
      crashEl.hide();
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

/**
 * M7.2: the persistent location chip text for the canvas top-left. Combat shows
 * the contract's site flavor label (bracketed by `//`); the Hub shows
 * "// Safe House //" so the corner always answers "where am I".
 */
function currentLocationLabel(): string | undefined {
  if (!campaign) return undefined;
  if (campaign.state === CAMPAIGN_STATE.COMBAT && campaign.activeRun?.contract) {
    const { principal, site } = campaign.activeRun.contract.context;
    const siteName = site?.label ?? 'Location Unknown';
    const labelName = `${principal.label} - ${siteName}`;
    return `// ${labelName} //`;
  }
  if (campaign.state === CAMPAIGN_STATE.HUB) {
    return '// Safe House //';
  }
  return undefined;
}

function paint(stateHint: InputState = activeInputState()): void {
  const run = currentScene();
  if (canvas.hidden) {
    setStatus(statusLine(stateHint));
    return;
  }
  if (!run || !run.world || !run.player) return;
  // Hub is a safe space — no fog of war. Vision is only meaningful during
  // combat where LOS and drone stealth detection matter.
  const activeVision = run.state === RUN_STATE.COMBAT ? vision : undefined;
  const blastOverlayKeys =
    run.state === RUN_STATE.COMBAT && activeBreachBlastOverlayKeys.size > 0
      ? activeBreachBlastOverlayKeys
      : undefined;
  renderer.draw(run.world, run.player, {
    vision: activeVision,
    player: run.player,
    blastOverlayKeys,
    lookCursor,
    locationLabel: currentLocationLabel(),
  });
  crt.alertTint = run.state === RUN_STATE.COMBAT && run.world.alarmActive;
  crt.apply();
  updateCorpWaitChrome(run);
  setStatus(statusLine(stateHint));
}

/** Static overlay when hostiles act off-screen during the corp turn. */
function updateCorpWaitChrome(run: ReturnType<typeof currentScene>): void {
  syncCanvasStaticOverlay();
  const show =
    run?.state === RUN_STATE.COMBAT &&
    run.queue?.currentFaction === FACTION.CORP &&
    run.world &&
    countVisibleCorpEntities(run.world.entities.values(), (x, y) => vision.isVisible(x, y)) === 0;
  setCorpStaticActive(canvasStaticEl, !!show);
}

/** Keep the static layer aligned with #game-canvas as the log sidebar expands/collapses. */
function syncCanvasStaticOverlay(): void {
  if (!canvasStaticEl || !stageEl || !canvas) return;
  const stageRect = stageEl.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  canvasStaticEl.style.left = `${canvasRect.left - stageRect.left}px`;
  canvasStaticEl.style.top = `${canvasRect.top - stageRect.top}px`;
  canvasStaticEl.style.width = `${canvasRect.width}px`;
  canvasStaticEl.style.height = `${canvasRect.height}px`;
}

function statusLine(state: InputState): string {
  const run = currentScene();
  if (!run) return '';
  if (run.state !== RUN_STATE.COMBAT) {
    corpToneActivityBody = null;
  }
  const aim = state.mode === MODE.AIM && state.aimKind ? `AIM ${aimKindLabel(state.aimKind)}` : '';
  const look = state.mode === MODE.LOOK ? 'LOOK' : '';
  const player = run.player;
  if (!player) return stateLabel();
  if (!run.queue) return stateLabel();
  const stealthTag = player.stealthed ? ' [CLOAKED]' : '';
  let identity;
  let aphp = '';
  let turnInfo = '';
  let context = '';
  if (run.state === RUN_STATE.COMBAT) {
    if (!isRun(run)) {
      throw new Error('[shell] combat status requires an active run');
    }
    // M4.2 (revised): salvage display moved out of the status bar and into
    // the `<item-inventory>` overlay (full bucket names there). The status
    // bar stayed too dense once typed salvage landed — `SAL S:0 C:0 B:0 D:0`
    // crowded the line and the initials were hard to parse. Press `i` to
    // see the wallet.
    const salvageTag = '';
    const objectiveTag = objectiveStatusTag(run);
    const alarm = run.world?.alarm;
    const alertTag =
      alarm?.phase === 'alert'
        ? `<span class="alert-tag">ALERT ${alarm.holdTurnsRemaining}</span>`
        : alarm?.phase === 'cooldown'
          ? `<span class="alert-tag">COOL ${alarm.cooldownTurnsRemaining}</span>`
          : '';
    const onHazard =
      run.world && run.player && run.world.grid.tileAt(run.player.x, run.player.y) === TILE.HAZARD;
    const hazardTag = onHazard
      ? '<span class="hazard-tag">▓ HAZARD — move or take damage</span>'
      : '';
    const lockTag =
      run.queue.currentFaction === FACTION.CORP
        ? '<span class="control-lock">CORP TURN - controls locked</span>'
        : '';
    identity = `${escapeHtml(run.player?.callsign ?? run.archetype)} ${escapeHtml(run.archetype.toUpperCase())}`;
    aphp = `AP ${player.ap}/${player.maxAp} HP ${player.hp}/${player.maxHp}`;
    context = joinStatusParts([lockTag, hazardTag, objectiveTag, salvageTag, alertTag]);
  } else {
    if (!campaign) return stateLabel();
    const repLabel = REP_LABEL.find(b => campaign!.rep >= b.min)?.label ?? 'UNKNOWN';
    // M4.2 (revised): Hub identity drops the typed-salvage compact tag —
    // the inventory overlay (`i` in Hub) is the canonical wallet view with
    // full bucket names. Total Cred / Rep / crew counts stay on this line.
    identity = `CREW ${campaign.crew.filter(member => !member.flatlined).length}/${campaign.crew.length} CREDS ${campaign.credits ?? 0} REP ${campaign.rep} (${escapeHtml(repLabel)})`;
  }
  turnInfo =
    run.state === RUN_STATE.COMBAT
      ? joinStatusParts([
          `TURN ${run.queue.turnNumber}`,
          escapeHtml(run.queue.currentFaction.toUpperCase()),
          aim,
          look,
        ])
      : '';
  const modeTag = look && run.state !== RUN_STATE.COMBAT ? look : '';
  const statsInner = joinStatusParts([
    stateLabel(),
    identity,
    `${aphp}${stealthTag}`,
    turnInfo,
    modeTag,
  ]);
  const stats = `<span class="game-shell__stats">${statsInner}</span>`;
  const contextRow = `<span class="game-shell__context">${context}</span>`;
  // Two activity rows below the stable status rows. A single fresh action can
  // share the HUD with ephemeral, non-logged status (proximity hints, corp
  // mood). Short same-interaction bursts take both rows so side effects like
  // door unlocks stay visible instead of disappearing into the log.
  let ephemeral = '';
  const hintText = proximityHint();
  if (hintText) {
    ephemeral = `<span class="game-shell__activity hint">${hintText}</span>`;
  } else if (run.state === RUN_STATE.COMBAT && run.queue.currentFaction === FACTION.CORP) {
    if (!run.world) throw new Error('[shell] combat status requires a world');
    const visibleCorp = countVisibleCorpEntities(
      run.world.entities.values(),
      (x: number, y: number) => vision.isVisible(x, y)
    );
    const body = corpTurnStatusBody(visibleCorp, run.queue.turnNumber);
    corpToneActivityBody = body;
    ephemeral = `<span class="game-shell__activity corp"><span class="faction-tag">CORP</span> — ${body}</span>`;
  } else if (
    run.state === RUN_STATE.COMBAT &&
    run.queue.currentFaction === FACTION.PLAYER &&
    corpToneActivityBody !== null
  ) {
    // show the last corp mood until the player acts and flushes it
    ephemeral = `<span class="game-shell__activity corp"><span class="faction-tag">CORP</span> — ${corpToneActivityBody}</span>`;
    corpToneActivityBody = null;
  }
  const activityRows = statusActionRows(actionLineHistory, pendingActionLineCount, !!ephemeral);
  pendingActionLineCount = 0;
  const [upper, lower] = activityRows.map(row => {
    if (row.source === 'ephemeral') return ephemeral;
    return `<span class="game-shell__activity">${escapeHtml(row.text)}</span>`;
  });
  return stats + contextRow + upper + lower;
}

function objectiveStatusTag(run: Run): string {
  if (!run.contract || !run.world) return '';
  const done = run.isObjectiveSatisfied();
  const remaining = run.objectiveTurnsRemaining();
  const turnTag =
    remaining === null || done ? '' : ` <span class="todo">[TURN:${remaining}]</span>`;
  const progressTag = formatObjectiveProgressTag(run.objectiveProgress());
  return `<span class="objective-tag">OBJ ${escapeHtml(run.contract.objective.title)} <span class="${done ? 'done' : 'todo'}">[${done ? 'DONE' : 'TODO'}]</span>${turnTag}${progressTag}</span>`;
}

function joinStatusParts(parts: Array<string | null | undefined>): string {
  return parts
    .filter(part => part && part.trim().length > 0)
    .join(' <span class="status-sep">|</span> ');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
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
    // Loot hint: check for adjacent lootable corpses.
    if (run.world && run.player) {
      const p = run.player;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const e = run.world.lootableCorpseAt(p.x + dx, p.y + dy);
          if (e && !e.alive && e.loot && totalSalvage(e.loot.salvage) > 0) {
            return 'SALVAGE nearby — press [Space] to loot.';
          }
        }
      }
      const interactable = run.world.adjacentInteractables(p)[0];
      if (interactable) {
        return `${interactable.label.toUpperCase()} nearby — press [Space] to interact.`;
      }
    }
    if (run.exitTile && isChebyshevAdjacent(run.player, run.exitTile)) {
      return 'EXIT (¤) one step away.';
    }
  }
  return '';
}

/** Stash a one-shot message that the next paint surfaces in the status bar. */
function flash(line: string): void {
  const scene = currentScene();
  if (scene?.state === RUN_STATE.COMBAT && scene.queue?.currentFaction === FACTION.PLAYER) {
    corpToneActivityBody = null;
  }
  actionLineHistory = recordStatusActionLine(actionLineHistory, line);
  pendingActionLineCount = Math.min(pendingActionLineCount + 1, actionLineHistory.length);
  const currentActionLine = actionLineHistory[0] ?? '';
  if (currentActionLine) {
    logLines.unshift(`> ${currentActionLine}`);
    if (logLines.length > 20) logLines.splice(20);
    logContentEl.textContent = logLines.join('\n');
  }
}

function stateLabel(): string {
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
  // Clear any half-armed thrown-consumable aim (M4.3). Esc-cancel from
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
 * `?` toggles the help overlay. Esc, when the help overlay is open, dismisses
 * it (and we swallow the event so the keymap doesn't also turn it into a
 * `cancel` intent for whatever aim mode was active).
 *
 * `?` is suppressed while any blocking modal owns the foreground — opening
 * help over a briefing or crew-roster would just stack panels.
 */
function handleGlobalKey(evt: KeyboardEvent): void {
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
  if (systemStartEl?.isOpen) return true;
  if (curatorBriefingEl?.isOpen) return true;
  if (initialRecruitEl?.isOpen) return true;
  if (crewRosterEl?.isOpen) return true;
  if (finnShopEl?.isOpen) return true;
  if (clinicModalEl?.isOpen) return true;
  if (itemInventoryEl?.isOpen) return true;
  if (keyHelpEl?.isOpen) return true;
  if (faultEl?.isOpen) return true;
  // <confirmation-modal> uses a native <dialog> internally; treat any open
  // attribute as "blocking".
  if (isConfirmationDialogOpen(confirmationModalEl)) return true;
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
