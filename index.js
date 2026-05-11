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

import '/components/ConfirmationModal.js';
import '/components/UpdateNotification.js';
import '/components/TouchPad.js';
import '/components/RunBriefing.js';
import '/components/CrashDump.js';

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
let keyboard;

/**
 * Most recent intent-result log line ("@ moved to (3,4) — 2 AP left.").
 * Tracked at module level because `applyIntent`'s `log` callback fires
 * during intent handling, but the status line is finalised later in
 * `paint()` — without this, the action line gets clobbered by the
 * subsequent statusLine() rewrite.
 */
let lastActionLine = '';
let archetype = (() => {
  // Same URL toggle the harness uses, so a tester can pick a starting class.
  const params = new URLSearchParams(globalThis.location?.search || '');
  return params.get('archetype') === 'merc' ? 'merc' : 'razor';
})();

const seedFromClock = () => Date.now() & 0xffffffff;

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

  briefingEl.addEventListener('jack-in', onJackIn);
  crashEl.addEventListener('new-run', onNewRunRequested);

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
  customElements
    .whenDefined('update-notification')
    .then(() => {
      const updateNotification = document.querySelector('update-notification');
      window.addEventListener('sw-update-available', event => {
        updateNotification.show(event.detail.pendingWorker);
      });
    })
    .catch(err => console.warn('[shell] update-notification wiring failed', err));

  await dataStore.init();

  const savedRun = findSavedRunRecord();
  if (savedRun) {
    promptResume(savedRun);
  } else {
    startFreshRun();
  }

  // SW registration is the same posture as the M0 scaffold — kicked off last
  // so it doesn't gate the shell's first paint.
  serviceWorkerManager.register().catch(err => console.warn('[shell] sw register failed', err));
}

function findSavedRunRecord() {
  return dataStore.items.find(rec => rec && rec.type === 'run') ?? null;
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
}

function makeRun(opts) {
  return new Run({
    archetype,
    seed: opts.seed,
    onPersist: handlePersist,
    onResult: handleResult,
  });
}

function handlePersist(snapshot) {
  // First snapshot of a run: add (DataStore assigns its own UUID and mutates
  // `snapshot.id` in place — we mirror that back into Run.id so the next
  // snapshot keeps the same record). Subsequent snapshots: in-place update.
  if (!runRecordId) {
    dataStore.addItem(snapshot);
    runRecordId = snapshot.id;
    if (run) run.id = runRecordId;
  } else {
    snapshot.id = runRecordId;
    dataStore.updateItem(snapshot);
  }
}

function handleResult({ outcome, telemetry }) {
  // Death + Exit both end the run; clear the save either way per the M8 plan
  // ("Death screen clears the save"; EXIT also clears since the run is over).
  if (runRecordId) {
    dataStore.deleteItem(runRecordId);
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
    dataStore.deleteItem(record.id);
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
    dataStore.deleteItem(record.id);
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
  if (!run.curator || !isChebyshevAdjacent(run.player, run.curator)) {
    flash('Step adjacent to the Curator to receive a contract.');
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
  renderer.draw(run.world, run.player, { vision });
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

boot().catch(err => {
  console.error('[shell] boot failed', err);
  setStatus(`BOOT ERROR — ${err.message}`);
});
