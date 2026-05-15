/**
 * M7 debug harness. Both KeyboardController and the on-screen <touch-pad>
 * emit the same intent shape; the game loop applies them through one path.
 * Player can be a Merc (vault), a Razor (slide + stealth), or a Tech
 * (deploy turret) — toggle with `1` / `2` / `3` on reset, or via
 * `?archetype=tech` in the URL. Razor is the default since M6.
 *
 * New in M7: <touch-pad> overlay. Auto-shown on coarse pointers; force on
 * desktop with `?touch=force`. Touch and keyboard each own their own aim
 * mode (per-input). On reset, both are reset to IDLE so a stale half-press
 * can't carry into a new scenario.
 *
 * New in M1 (Phase 2): Tech archetype + auto-firing turrets. At end of every
 * player turn, before the corp turn begins, `runPlayerAftermath` in
 * `combatTurnPipeline.js` runs the player aftermath (turret autofire today;
 * allied NPCs / hazards later). The harness logs each line to the feed.
 */
import { Grid } from '/src/game/Grid.js';
import { World } from '/src/game/World.js';
import { TurnQueue } from '/src/game/TurnQueue.js';
import { Merc } from '/src/game/archetypes/Merc.js';
import { Razor } from '/src/game/archetypes/Razor.js';
import { Tech } from '/src/game/archetypes/Tech.js';
import {
  advanceFromPlayerTurn,
  formatPlayerAftermathStepLogLines,
} from '/src/game/combatTurnPipeline.js';
import { CorpDrone } from '/src/game/ai/CorpDrone.js';
import { EventBus, EVENT } from '/src/game/events.js';
import { TILE, FACTION } from '/src/game/constants.js';
import { AsciiRenderer } from '/src/render/AsciiRenderer.js';
import { CrtFilter } from '/src/render/CrtFilter.js';
import { KeyboardController } from '/src/input/KeyboardController.js';
import { MODE } from '/src/input/keymap.js';
import { applyIntent as applyPlayerIntent } from '/src/input/applyIntent.js';
import { VisionField } from '/src/game/Vision.js';
import { Rng } from '/src/rng.js';

const GRID_W = 24;
const GRID_H = 16;

let world;
let queue;
let player;
let drone;
let renderer;
let crt;
let input;
let touchPad;
let vision;
let rng;
let bus;
let archetype = (() => {
  // URL override at first load. Reset keys toggle this in `bindUI`.
  const params = new URLSearchParams(globalThis.location?.search || '');
  const a = params.get('archetype');
  if (a === 'merc') return 'merc';
  if (a === 'tech') return 'tech';
  return 'razor';
})();
const logLines = [];

function buildScenario() {
  const grid = new Grid(GRID_W, GRID_H);

  for (let x = 0; x < GRID_W; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, GRID_H - 1, TILE.WALL);
  }
  for (let y = 0; y < GRID_H; y++) {
    grid.setTile(0, y, TILE.WALL);
    grid.setTile(GRID_W - 1, y, TILE.WALL);
  }

  for (let y = 4; y <= 11; y++) grid.setTile(12, y, TILE.WALL);
  grid.setTile(12, 8, TILE.FLOOR);

  // Cover tiles arranged so the Merc has obvious vault opportunities from spawn.
  grid.setTile(4, 3, TILE.COVER);
  grid.setTile(6, 6, TILE.COVER);
  grid.setTile(7, 6, TILE.COVER);
  grid.setTile(17, 9, TILE.COVER);
  grid.setTile(18, 4, TILE.COVER);

  // Fresh bus per scenario — listeners from a previous run are dropped with
  // the bus reference, so reset is clean.
  bus = new EventBus();
  world = new World(grid, { events: bus });
  player =
    archetype === 'razor'
      ? new Razor({ id: 'razor', x: 3, y: 3, maxAp: 4 })
      : archetype === 'tech'
        ? new Tech({ id: 'tech', x: 3, y: 3, maxAp: 4 })
        : new Merc({ id: 'merc', x: 3, y: 3, maxAp: 4 });
  // Patrol the right-hand room; the drone spends most of its time visible to
  // a player who pushes east, so M5 behaviour is observable from spawn.
  drone = new CorpDrone({
    id: 'drone-1',
    x: 19,
    y: 12,
    maxAp: 3,
    patrolWaypoints: [
      { x: 19, y: 12 },
      { x: 14, y: 12 },
      { x: 14, y: 3 },
      { x: 19, y: 3 },
    ],
  });
  world.addEntity(player);
  world.addEntity(drone);
  drone.bindToBus(bus);

  queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
  vision = new VisionField();
  recomputeVision();

  // Refresh fog when *anything* moves — covers both the player's own steps
  // (cheap, idempotent) and corp drones walking into LOS during their turn.
  // This is the deferred M4 fix the plan called out under "Vision only
  // refreshes on player move."
  bus.on(EVENT.ENTITY_MOVED, () => recomputeVision());

  // Seed off the wall clock so each reset varies, but use a fresh Rng so
  // future M7 saves can capture/restore .state cleanly.
  rng = new Rng(Date.now() & 0xffffffff);
  logLines.length = 0;
  log(
    `> RUN INIT — ${archetype.toUpperCase()} archetype, turn ${queue.turnNumber}, ` +
      `${queue.currentFaction.toUpperCase()} acts.`
  );
}

function recomputeVision() {
  vision.recompute(world.grid, player, undefined, { blockers: world.blockerKeys() });
}

function log(line) {
  logLines.push(line);
  if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
}

function rerender(modeHint = '') {
  renderer.draw(world, player, { vision });
  crt.apply();
  const aim = modeHint && modeHint !== MODE.IDLE ? `  |  MODE: ${modeHint}` : '';
  const droneStatus = drone.alive
    ? `DRONE @(${drone.x},${drone.y}) HP ${drone.hp}/${drone.maxHp} [${drone.state.toUpperCase()}]`
    : 'DRONE DOWN';
  const stealthTag = player.stealthed ? ' [CLOAKED]' : '';
  // Tech-specific status: the pre-built turret token, and whether a placed
  // turret is alive on the grid.
  let turretTag = '';
  if (archetype === 'tech') {
    turretTag = player.turretReady ? ' [TURRET READY]' : ' [TURRET DEPLOYED]';
    if (player.inventory) {
      turretTag += ` SALVAGE:${player.inventory.salvage}`;
    }
  }
  document.getElementById('status').textContent =
    `TURN ${queue.turnNumber}  |  ACTING: ${queue.currentFaction.toUpperCase()}  |  ` +
    `${archetype.toUpperCase()} AP ${player.ap}/${player.maxAp} HP ${player.hp}/${player.maxHp}${stealthTag}${turretTag}  |  ` +
    `${droneStatus}${aim}`;
  document.getElementById('log').textContent = logLines.slice(-12).join('\n');
}

/**
 * Game-loop glue lives in `/src/input/applyIntent.js` so the M8 game shell
 * (and any future input source) shares a single intent-application path
 * with this harness. The closure here wraps that shared helper with the
 * harness's logger / advanceTurn / resetInputModes hooks.
 */
function applyIntent(intent) {
  applyPlayerIntent(intent, {
    world,
    player,
    queue,
    rng,
    log,
    advanceTurn,
    resetInputModes,
    // The harness has no Curator / interactables. Without this, pressing Space
    // would crash through `applyIntent`'s "interact requires onInteract" guard.
    onInteract: () => log('> Nothing to interact with here.'),
  });
}

function advanceTurn() {
  advanceFromPlayerTurn({
    queue,
    world,
    rng,
    onCorpTurnReady: () => {
      log(`> ${queue.currentFaction.toUpperCase()} acts (turn ${queue.turnNumber}).`);
    },
    onPlayerAftermathStep: step => {
      for (const line of formatPlayerAftermathStepLogLines(step)) {
        log(`> ${line}`);
      }
    },
    driveCorpTurn: ({ onFinish }) => {
      runCorpTurn();
      onFinish();
    },
    onPlayerTurnReady: () => {
      log(`> PLAYER acts (turn ${queue.turnNumber}).`);
    },
  });
}

/**
 * Drive every live corp entity through its AI for the current turn. Synchronous
 * — the renderer paints once at the end. The drone's per-action log is summarised
 * into the on-screen feed so the player can read what happened.
 */
function runCorpTurn() {
  for (const e of world.entities.values()) {
    if (!e.alive || e.faction !== FACTION.CORP) continue;
    if (typeof e.takeTurn !== 'function') continue; // plain Entity → idle
    const actions = e.takeTurn(world, rng);
    for (const action of actions) {
      log(formatCorpAction(e, action));
    }
  }
}

function formatCorpAction(actor, action) {
  switch (action.type) {
    case 'fire': {
      const r = action.result;
      return (
        `> ${actor.id} fires at ${action.target} — ` +
        `${r.hit ? 'HIT' : 'miss'} (roll ${r.roll.toFixed(2)} vs ${r.threshold.toFixed(2)}` +
        `${r.inCover ? ', cover' : ''}).` +
        (r.killed ? ` ${action.target.toUpperCase()} DOWN.` : '')
      );
    }
    case 'fire-blocked':
      return `> ${actor.id} can't fire: ${action.reason}.`;
    case 'move-engage':
      return `> ${actor.id} closes to (${action.to.x}, ${action.to.y}).`;
    case 'move-investigate':
      return `> ${actor.id} investigates → (${action.to.x}, ${action.to.y}).`;
    case 'move-patrol':
      return `> ${actor.id} patrols → (${action.to.x}, ${action.to.y}).`;
    case 'patrol-arrived':
      return `> ${actor.id} reached waypoint (${action.waypoint.x}, ${action.waypoint.y}).`;
    case 'patrol-skipped':
      return `> ${actor.id} skipped waypoint (${action.waypoint.x}, ${action.waypoint.y}).`;
    case 'investigate-cleared':
      return `> ${actor.id} found nothing — back to patrol.`;
    case 'investigate-abandoned':
      return `> ${actor.id} lost the trail.`;
    default:
      return `> ${actor.id} ${action.type}`;
  }
}

function logModeChange(nextMode) {
  if (nextMode === MODE.FIRE_AIM) log('> FIRE — pick a direction (Esc to cancel).');
  if (nextMode === MODE.MELEE_AIM) log('> MELEE — pick a direction (Esc to cancel).');
  if (nextMode === MODE.SPECIAL_AIM) {
    // Surface the archetype-specific verb so the banner still reads naturally
    // even though the keystroke and mode are now shared.
    const verb =
      archetype === 'merc'
        ? 'VAULT'
        : archetype === 'razor'
          ? 'SLIDE'
          : archetype === 'tech'
            ? 'DEPLOY'
            : 'SPECIAL';
    log(`> ${verb} — pick a direction (Esc to cancel).`);
  }
}

function activeMode() {
  // Show whichever input is currently aiming. Touch wins ties so the banner
  // matches the visible highlight on the pad.
  if (touchPad && touchPad.mode !== MODE.IDLE) return touchPad.mode;
  return input?.mode ?? MODE.IDLE;
}

function resetInputModes() {
  if (touchPad) touchPad.setMode(MODE.IDLE);
  if (input) input.mode = MODE.IDLE;
}

function bindUI() {
  const canvas = document.getElementById('game-canvas');
  renderer = new AsciiRenderer(canvas);
  crt = new CrtFilter(canvas);

  input = new KeyboardController({
    onIntent: intent => {
      if (intent?.type === 'quit-campaign') {
        log('> QUIT CAMPAIGN is only wired in the M8 shell (no-op in harness).');
        resetInputModes();
        rerender(activeMode());
        return;
      }
      applyIntent(intent);
      rerender(activeMode());
    },
    onModeChange: nextMode => {
      logModeChange(nextMode);
      rerender(activeMode());
    },
  });
  input.attach();

  touchPad = document.getElementById('touch-pad');
  if (touchPad) {
    touchPad.addEventListener('intent', evt => {
      const intent = evt.detail;
      if (intent?.type === 'quit-campaign') {
        log('> QUIT CAMPAIGN is only wired in the M8 shell (no-op in harness).');
        resetInputModes();
        rerender(activeMode());
        return;
      }
      applyIntent(intent);
      rerender(activeMode());
    });
    touchPad.addEventListener('mode-change', evt => {
      logModeChange(evt.detail.mode);
      rerender(activeMode());
    });
  }

  // Reset / archetype toggles aren't part of the game keymap — wire directly.
  document.addEventListener('keydown', evt => {
    if (evt.ctrlKey || evt.metaKey) return;
    if (evt.key === 'r' || evt.key === 'R') {
      buildScenario();
      resetInputModes();
      rerender(activeMode());
      evt.preventDefault();
    } else if (evt.key === '1') {
      archetype = 'merc';
      buildScenario();
      resetInputModes();
      rerender(activeMode());
      evt.preventDefault();
    } else if (evt.key === '2') {
      archetype = 'razor';
      buildScenario();
      resetInputModes();
      rerender(activeMode());
      evt.preventDefault();
    } else if (evt.key === '3') {
      archetype = 'tech';
      buildScenario();
      resetInputModes();
      rerender(activeMode());
      evt.preventDefault();
    }
  });
}

bindUI();
buildScenario();
rerender();
document.getElementById('game-canvas').focus();
