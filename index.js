/**
 * M8 game shell. Promotes `/index.html` from the M0 scaffold to a real game:
 *
 *   - boots DataStore + service worker,
 *   - prompts to Resume / Abandon a saved run via <confirmation-modal>,
 *   - drives a single `Run` state machine (HUB → BRIEFING → COMBAT → RESULT),
 *   - paints the canvas during HUB / COMBAT, swaps DOM overlays during
 *     BRIEFING / RESULT (per the M8 plan: "DOM panels above the canvas;
 *     canvas paints during HUB/COMBAT only"),
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

import { Run, RUN_STATE } from '/src/game/Run.js';
import { restore } from '/src/game/persistence.js';
import { FACTION } from '/src/game/constants.js';
import { EVENT } from '/src/game/events.js';
import { VisionField } from '/src/game/Vision.js';
import { AsciiRenderer } from '/src/render/AsciiRenderer.js';
import { CrtFilter } from '/src/render/CrtFilter.js';
import { KeyboardController } from '/src/input/KeyboardController.js';
import { MODE } from '/src/input/keymap.js';
import { applyIntent } from '/src/input/applyIntent.js';

import { ARCHETYPE_IDS, ARCHETYPES, isArchetypeId } from '/src/game/archetypes/index.js';

import '/components/ConfirmationModal.js';
import '/components/UpdateNotification.js';
import '/components/TouchPad.js';
import '/components/RunBriefing.js';
import '/components/CrashDump.js';
import '/components/CharacterSelect.js';
import '/components/KeyHelp.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Run|null} */
let run = null;
/** DataStore-assigned UUID for the active run record. Null when no save exists. */
let runRecordId = null;
let vision = new VisionField();
let visionMoveUnsub = null;

let canvas, statusEl, renderer, crt;
let briefingEl, crashEl, resumeModalEl, touchPadEl;
let characterSelectEl, keyHelpEl;
let keyboard;

const DEFAULT_ARCHETYPE = 'merc';

/**
 * Most recent intent-result log line ("@ moved to (3,4) — 2 AP left.").
 * Tracked at module level because `applyIntent`'s `log` callback fires
 * during intent handling, but the status line is finalised later in
 * `paint()` — without this, the action line gets clobbered by the
 * subsequent statusLine() rewrite.
 */
let lastActionLine = '';
/**
 * Starting archetype. Filled in `boot()` after DataStore.init runs:
 *   1. URL override (`?archetype=razor`) wins for testing — same toggle the
 *      M7 harness honoured.
 *   2. Then the persisted preference (`DataStore.prefs.archetype`).
 *   3. Finally `DEFAULT_ARCHETYPE` on a fresh first load.
 * Run.setArchetype mutates this back via onPrefsChange so subsequent
 * `enterHub` calls and snapshot/restore stay in sync.
 */
let archetype = DEFAULT_ARCHETYPE;

const seedFromClock = () => Date.now() & 0xffffffff;

const allComponentsReady = Promise.all([
  customElements.whenDefined('update-notification'),
  customElements.whenDefined('confirmation-modal'),
  customElements.whenDefined('touch-pad'),
  customElements.whenDefined('character-select'),
  customElements.whenDefined('key-help'),
]);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  canvas = document.getElementById('game-canvas');
  statusEl = document.getElementById('game-status');
  briefingEl = document.getElementById('briefing');
  crashEl = document.getElementById('crash');
  resumeModalEl = document.getElementById('resume-modal');
  touchPadEl = document.getElementById('touch-pad');
  characterSelectEl = document.getElementById('character-select');
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
  });
  keyboard.attach();

  // `?` and Esc-for-help live above the keymap: `?` is a UI toggle (not a
  // game intent), and Esc must reach <key-help> before the keymap turns it
  // into a `cancel` intent. Capture phase + a return-early when the help
  // panel is open keeps both behaviours clean.
  window.addEventListener('keydown', handleGlobalKey, true);

  briefingEl.addEventListener('jack-in', onJackIn);
  crashEl.addEventListener('new-run', onNewRunRequested);

  if (characterSelectEl) {
    characterSelectEl.setArchetypes(ARCHETYPE_IDS.map(id => ARCHETYPES[id]));
    characterSelectEl.addEventListener('pick', onArchetypePicked);
    characterSelectEl.addEventListener('dismiss', onArchetypeDismissed);
  }

  if (keyHelpEl) {
    keyHelpEl.addEventListener('dismiss', () => keyHelpEl.hide());
  }

  if (touchPadEl) {
    touchPadEl.addEventListener('intent', evt => {
      handleIntent(evt.detail);
      paint();
    });
    touchPadEl.addEventListener('mode-change', evt => {
      paint(evt.detail.mode);
    });
  }

  // Update-notification wiring kept from the original scaffold.
  const updateNotification = document.querySelector('update-notification');
  window.addEventListener('sw-update-available', event => {
    updateNotification.show(event.detail.pendingWorker);
  });

  await dataStore.init();

  archetype = pickStartingArchetype();

  const savedRun = dataStore.currentRun;
  if (savedRun) {
    promptResume(savedRun);
  } else {
    startFreshRun();
  }

  // SW registration is the same posture as the M0 scaffold — kicked off last
  // so it doesn't gate the shell's first paint.
  serviceWorkerManager.register().catch(err => console.warn('[shell] sw register failed', err));
}

/**
 * Resolve the starting archetype across the three sources, in priority order.
 * Falls back to DEFAULT_ARCHETYPE only on a fresh-ever load with no prefs
 * record yet — the first `pick` will write one via `dataStore.setPref()`.
 */
function pickStartingArchetype() {
  const params = new URLSearchParams(globalThis.location?.search || '');
  const urlPick = params.get('archetype');
  if (isArchetypeId(urlPick)) {
    return urlPick;
  }
  if (isArchetypeId(dataStore.prefs.archetype)) {
    return dataStore.prefs.archetype;
  }
  return DEFAULT_ARCHETYPE;
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function startFreshRun() {
  flash('NEW RUN — Curator is in the Hub.');
  run = makeRun({ seed: seedFromClock() });
  run.enterHub();
  attachVisionListener();
  recomputeVision();
  renderShell();
  if (!dataStore.prefs.archetype) {
    presentCharacterSelect();
  }
}

/**
 * Mount <character-select> with the current archetype highlighted. Called on
 * every Hub entry and on Terminal interact. Dismissable: closing without
 * picking leaves the existing archetype in effect.
 */
function presentCharacterSelect() {
  if (!characterSelectEl) return;
  if (!run || run.state !== RUN_STATE.HUB) return;
  characterSelectEl.setCurrent(run.archetype);
  characterSelectEl.show();
}

function onArchetypePicked(evt) {
  const id = evt?.detail?.archetypeId;
  if (!isArchetypeId(id)) return;
  if (!run) return;
  // Setting the same archetype is intentional — first-load default is 'merc'
  // and no prefs record exists yet; the setArchetype call writes one through
  // onPrefsChange. Idempotent at the entity layer.
  if (run.state === RUN_STATE.HUB) {
    run.setArchetype(id);
    flash(`OPERATOR: ${id.toUpperCase()}.`);
  }
  characterSelectEl.hide();
  paint();
}

function onArchetypeDismissed() {
  characterSelectEl.hide();
}

function makeRun(opts) {
  return new Run({
    archetype,
    seed: opts.seed,
    onPersist: handlePersist,
    onResult: handleResult,
    onPrefsChange: id => {
      // Run already updated its own `archetype` field; mirror the shell's
      // module-level copy so the *next* `makeRun()` picks the same value,
      // and persist for future page loads.
      archetype = id;
      dataStore.setPref('archetype', id);
    },
  });
}

function handlePersist(snapshot) {
  // First snapshot of a run: add (DataStore assigns its own UUID and mutates
  // `snapshot.id` in place — we mirror that back into Run.id so the next
  // snapshot keeps the same record). Subsequent snapshots: in-place update.
  if (!runRecordId) {
    dataStore.addRun(snapshot);
    runRecordId = snapshot.id;
    if (run) run.id = runRecordId;
  } else {
    snapshot.id = runRecordId;
    dataStore.updateRun(snapshot);
  }
}

function handleResult({ outcome, telemetry }) {
  // Death + Exit both end the run; clear the save either way per the M8 plan
  // ("Death screen clears the save"; EXIT also clears since the run is over).
  if (runRecordId) {
    dataStore.deleteRun(runRecordId);
    runRecordId = null;
  }
  crashEl.setTelemetry({ outcome, ...telemetry });
  renderShell();
}

// ---------------------------------------------------------------------------
// Resume flow
// ---------------------------------------------------------------------------

function promptResume(record) {
  flash(`Saved run found — turn ${record.turnNumber}, ${record.archetype.toUpperCase()}.`);

  const onConfirm = () => {
    cleanup();
    resumeFromRecord(record);
  };
  const onCancel = () => {
    cleanup();
    dataStore.deleteRun(record.id);
    runRecordId = null;
    startFreshRun();
  };
  function cleanup() {
    resumeModalEl.removeEventListener('confirm', onConfirm);
    resumeModalEl.removeEventListener('cancel', onCancel);
  }

  resumeModalEl.addEventListener('confirm', onConfirm);
  resumeModalEl.addEventListener('cancel', onCancel);
  resumeModalEl.showModal(
    `Resume your last run? (turn ${record.turnNumber}, ${record.archetype.toUpperCase()})`
  );
}

function resumeFromRecord(record) {
  try {
    const { run: restoredRun } = restore(record, {
      onPersist: handlePersist,
      onResult: handleResult,
    });
    run = restoredRun;
    runRecordId = record.id;
    archetype = restoredRun.archetype;
    attachVisionListener();
    recomputeVision();
    flash(
      `RESUMED — ${restoredRun.archetype.toUpperCase()} | turn ${restoredRun.queue.turnNumber}`
    );
    renderShell();
  } catch (err) {
    // Corrupt record — log and start fresh rather than booting into a half-state.
    console.error('[shell] failed to restore saved run', err);
    dataStore.deleteRun(record.id);
    runRecordId = null;
    flash('SAVE CORRUPT — starting a new run.');
    startFreshRun();
  }
}

// ---------------------------------------------------------------------------
// Intent handling
// ---------------------------------------------------------------------------

function handleIntent(intent) {
  if (!run) return;
  // BRIEFING / RESULT swallow gameplay intents — JACK IN / NEW RUN drive
  // those transitions through the DOM buttons. Cancel is still valid (it
  // clears any stuck aim mode, per the M7 cross-input cancel rule).
  if (run.state === RUN_STATE.BRIEFING || run.state === RUN_STATE.RESULT) {
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

function advanceTurn() {
  if (!run) return;
  run.queue.endTurn(run.world);
  if (run.queue.currentFaction === FACTION.CORP) {
    runCorpTurn();
    // Same shape the harness uses: end the CORP turn synchronously so control
    // returns to the player on the same input event.
    run.queue.endTurn(run.world);
  }
  // Stealth & vision may both have changed during the corp turn.
  recomputeVision();
}

function runCorpTurn() {
  if (!run) return;
  for (const e of run.world.entities.values()) {
    if (!e.alive || e.faction !== FACTION.CORP) continue;
    if (typeof e.takeTurn !== 'function') continue; // Curator / inert entities.
    e.takeTurn(run.world, run.rng);
  }
}

function handleInteract() {
  if (!run) return;
  if (run.state !== RUN_STATE.HUB) {
    flash('Nothing to interact with here.');
    return;
  }
  // Terminal first — adjacency to the loadout kiosk re-opens character
  // select. Curator second — receive a contract. Both checked before the
  // "step adjacent" fallback so a player standing between the two gets the
  // Terminal interaction (closer in the typical layout).
  if (run.terminal && isChebyshevAdjacent(run.player, run.terminal)) {
    flash('TERMINAL — pick an operator.');
    presentCharacterSelect();
    return;
  }
  if (!run.curator || !isChebyshevAdjacent(run.player, run.curator)) {
    flash('Step adjacent to the Curator (contract) or Terminal (loadout).');
    return;
  }
  const contract = run.curator.generateContract(run.rng);
  run.enterBriefing(contract);
  briefingEl.setContract(contract);
  flash(`CURATOR: ${contract.label} — review contract.`);
  renderShell();
}

function onJackIn() {
  if (!run || run.state !== RUN_STATE.BRIEFING) return;
  run.enterCombat();
  // enterCombat rebuilds bus + world; re-attach the vision listener so live
  // entity moves keep refreshing fog-of-war.
  attachVisionListener();
  recomputeVision();
  flash('JACKED IN. Reach the exit tile (¤) before the drones drop you.');
  renderShell();
}

function onNewRunRequested() {
  // RESULT → HUB. Clear any half-state and start fresh on a new seed.
  if (!run) return;
  crashEl.hide();
  run.enterHub();
  // enterHub also rebuilds the world; re-attach vision.
  attachVisionListener();
  recomputeVision();
  flash('NEW RUN — Curator is in the Hub.');
  renderShell();
  presentCharacterSelect();
}

// ---------------------------------------------------------------------------
// Vision (mirrors the M5 harness rule: refresh on every entity move)
// ---------------------------------------------------------------------------

function attachVisionListener() {
  if (visionMoveUnsub) {
    visionMoveUnsub();
    visionMoveUnsub = null;
  }
  if (!run?.bus) return;
  visionMoveUnsub = run.bus.on(EVENT.ENTITY_MOVED, () => recomputeVision());
}

function recomputeVision() {
  if (!run || !run.world || !run.player) return;
  vision.recompute(run.world.grid, run.player, undefined, {
    blockers: run.world.blockerKeys(),
  });
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function renderShell() {
  if (!run) return;
  switch (run.state) {
    case RUN_STATE.HUB:
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
    default:
      throw new Error(`[shell] unknown run state "${run.state}"`);
  }
  paint();
}

function paint(modeHint = activeMode()) {
  if (!run || !run.world || !run.player) return;
  if (canvas.hidden) return; // Briefing / Result panels own the viewport.
  // Hub is a safe space — no fog of war. Vision is only meaningful during
  // combat where LOS and drone stealth detection matter.
  const activeVision = run.state === RUN_STATE.COMBAT ? vision : undefined;
  renderer.draw(run.world, run.player, { vision: activeVision });
  crt.apply();
  setStatus(statusLine(modeHint));
}

function statusLine(modeHint) {
  if (!run) return '';
  const aim = modeHint && modeHint !== MODE.IDLE ? `  |  AIM: ${modeHint}` : '';
  const player = run.player;
  if (!player) return stateLabel();
  const stealthTag = player.stealthed ? ' [CLOAKED]' : '';
  const stats =
    `${stateLabel()}  |  ${run.archetype.toUpperCase()} ` +
    `AP ${player.ap}/${player.maxAp} HP ${player.hp}/${player.maxHp}${stealthTag}` +
    `  |  TURN ${run.queue.turnNumber} (${run.queue.currentFaction.toUpperCase()})${aim}`;
  const hint = proximityHint();
  const action = lastActionLine ? `  ·  ${lastActionLine}` : '';
  return stats + (hint ? `  |  ${hint}` : '') + action;
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
  if (!run || !run.player) return '';
  if (run.state === RUN_STATE.HUB) {
    if (run.curator && isChebyshevAdjacent(run.player, run.curator)) {
      return 'CURATOR — press [i] for a contract.';
    }
    if (run.terminal && isChebyshevAdjacent(run.player, run.terminal)) {
      return 'TERMINAL — press [i] to change operator.';
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
  if (!run) return 'BOOTING';
  switch (run.state) {
    case RUN_STATE.HUB:
      return '[HUB]';
    case RUN_STATE.BRIEFING:
      return '[BRIEFING]';
    case RUN_STATE.COMBAT:
      return '[COMBAT]';
    case RUN_STATE.RESULT:
      return '[DEBRIEF]';
    default:
      return run.state ?? '';
  }
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
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
 * `?` toggles the help overlay. Esc, when the help overlay is open, dismisses
 * it (and we swallow the event so the keymap doesn't also turn it into a
 * `cancel` intent for whatever aim mode was active).
 *
 * `?` is suppressed while any blocking modal owns the foreground — opening
 * help over a briefing or character-select would just stack panels.
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
  if (isAnyBlockingModalOpen()) {
    // Briefing / Crash / Resume / Character-select own focus — silently drop
    // `?` rather than stacking yet another overlay over them.
    evt.preventDefault();
    return;
  }
  const scope = helpScopeForRunState();
  if (!scope) return;
  evt.preventDefault();
  keyHelpEl.setScope(scope);
  keyHelpEl.show();
}

function helpScopeForRunState() {
  if (!run) return null;
  if (run.state === RUN_STATE.HUB) return 'hub';
  if (run.state === RUN_STATE.COMBAT) return 'combat';
  return null;
}

function isAnyBlockingModalOpen() {
  if (briefingEl?.isOpen) return true;
  if (crashEl?.isOpen) return true;
  if (characterSelectEl?.isOpen) return true;
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
