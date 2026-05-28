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
import { AIM_KIND, MODE, aimKindLabel } from '/src/input/keymap.js';
import { applyIntent as applyPlayerIntent, PLAYER_ACTIONS } from '/src/input/applyIntent.js';
import { VisionField } from '/src/game/Vision.js';
import { Rng } from '/src/rng.js';
import type { Crew } from '/src/game/Crew';
import type { Intent } from '/src/input/applyIntent.js';
import type { Archetype } from '/src/game/archetypes';
import { entityLabel, resolveEntityLabel, type Entity } from '/src/game/Entity.js';
import type { TurnActionStep } from '/src/types.js';
import type { AimKind, Mode } from '/src/input/keymap.js';
import type TouchPad from '/components/TouchPad';
import type { PlayerAftermathStep } from '/src/game/combatTurnPipeline.js';

const GRID_W = 24;
const GRID_H = 16;

let world: World;
let queue: TurnQueue;
let player: Crew;
let drone: CorpDrone;
let renderer: AsciiRenderer;
let crt: CrtFilter;
let input: KeyboardController;
let touchPad: TouchPad | null = null;
let vision: VisionField;
let rng: Rng;
let bus: EventBus;
let archetype = (() => {
  // URL override at first load. Reset keys toggle this in `bindUI`.
  const params = new URLSearchParams(globalThis.location?.search || '');
  const a = params.get('archetype');
  if (a === 'merc') return 'merc';
  if (a === 'tech') return 'tech';
  return 'razor';
})();
const logLines: string[] = [];

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

function log(line: string) {
  logLines.push(line);
  if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
}

function rerender(state: { mode: Mode; aimKind: AimKind | null } = activeInputState()) {
  renderer.draw(world, player, { vision });
  crt.apply();
  const aim =
    state.mode === MODE.AIM && state.aimKind ? `  |  AIM: ${aimKindLabel(state.aimKind)}` : '';
  const droneStatus = drone.alive
    ? `DRONE @(${drone.x},${drone.y}) HP ${drone.hp}/${drone.maxHp} [${drone.state.toUpperCase()}]`
    : 'DRONE DOWN';
  const stealthTag = player.stealthed ? ' [CLOAKED]' : '';
  // Tech-specific status: the pre-built turret token, and whether a placed
  // turret is alive on the grid.
  let turretTag = '';
  if (archetype === 'tech') {
    turretTag = (player as Tech).turretReady ? ' [TURRET READY]' : ' [TURRET DEPLOYED]';
    if (player.inventory) {
      turretTag += ` SALVAGE:${player.inventory.salvage}`;
    }
  }
  document.getElementById('status')!.textContent =
    `TURN ${queue.turnNumber}  |  ACTING: ${queue.currentFaction.toUpperCase()}  |  ` +
    `${archetype.toUpperCase()} AP ${player.ap}/${player.maxAp} HP ${player.hp}/${player.maxHp}${stealthTag}${turretTag}  |  ` +
    `${droneStatus}${aim}`;
  document.getElementById('log')!.textContent = logLines.slice(-12).join('\n');
}

/**
 * Game-loop glue lives in `/src/input/applyIntent.js` so the M8 game shell
 * (and any future input source) shares a single intent-application path
 * with this harness. The closure here wraps that shared helper with the
 * harness's logger / advanceTurn / resetInputModes hooks.
 */
function applyIntent(intent: Intent) {
  applyPlayerIntent(intent, {
    world,
    player: player as Archetype,
    queue,
    rng,
    log,
    advanceTurn,
    resetInputModes,
    // The harness has no Curator / interactables. Without this, pressing Space
    // would crash through `applyIntent`'s "interact requires onPlayerAction" guard.
    onPlayerAction: actionName => {
      switch (actionName) {
        case PLAYER_ACTIONS.INTERACT:
          log('> Nothing to interact with here.');
          break;
      }
    },
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
    onPlayerAftermathStep: (step: PlayerAftermathStep) => {
      for (const line of formatPlayerAftermathStepLogLines(step)) {
        log(`> ${line}`);
      }
    },
    driveCorpTurn: ({ onFinish }: { onFinish: () => void }) => {
      runCorpTurn();
      onFinish();
    },
    onPlayerTurnReady: () => {
      log(`> PLAYER acts (turn ${queue.turnNumber}).`);
    },
    drivePlayerAftermath: () => {
      // debug isn't going to worry about turret autofire right now; just a placeholder so the type checker is happy
      return;
    },
    isTerminal: () => {
      return false;
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
    const actions = e.takeTurn(world, rng) ?? [];
    for (const action of actions) {
      log(formatCorpAction(e, action));
    }
  }
}

function formatCorpAction(actor: Entity, action: TurnActionStep) {
  const label = entityLabel(actor);
  switch (action.type) {
    case 'fire': {
      const r = action.result;
      const targetLabel = resolveEntityLabel(action.target, world.entities);
      return (
        `> ${label} fires at ${targetLabel} — ` +
        `${r.hit ? 'HIT' : 'miss'} (roll ${r.roll.toFixed(2)} vs ${r.threshold.toFixed(2)}` +
        `${r.inCover ? ', cover' : ''}).` +
        (r.killed ? ` ${targetLabel.toUpperCase()} DOWN.` : '')
      );
    }
    case 'fire-blocked':
      return `> ${label} can't fire: ${action.reason}.`;
    case 'move-engage':
      return `> ${label} closes to (${action.to.x}, ${action.to.y}).`;
    case 'move-investigate':
      return `> ${label} investigates → (${action.to.x}, ${action.to.y}).`;
    case 'move-patrol':
      return `> ${label} patrols → (${action.to.x}, ${action.to.y}).`;
    case 'patrol-arrived':
      return `> ${label} reached waypoint (${action.waypoint.x}, ${action.waypoint.y}).`;
    case 'patrol-skipped':
      return `> ${label} skipped waypoint (${action.waypoint.x}, ${action.waypoint.y}).`;
    case 'investigate-cleared':
      return `> ${label} found nothing — back to patrol.`;
    case 'investigate-abandoned':
      return `> ${label} lost the trail.`;
    default:
      return `> ${label} ${(action as { type: string }).type}`;
  }
}

function logModeChange(state: { mode: Mode; aimKind: AimKind | null }) {
  if (state.mode !== MODE.AIM || !state.aimKind) return;
  if (state.aimKind === AIM_KIND.FIRE) log('> FIRE — pick a direction (Esc to cancel).');
  if (state.aimKind === AIM_KIND.SPECIAL) {
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

function activeInputState(): { mode: Mode; aimKind: AimKind | null } {
  // Show whichever input is currently aiming. Touch wins ties so the banner
  // matches the visible highlight on the pad.
  if (touchPad && touchPad.mode !== MODE.IDLE) {
    return { mode: touchPad.mode, aimKind: touchPad.aimKind ?? null };
  }
  return { mode: input.mode ?? MODE.IDLE, aimKind: input.aimKind ?? null };
}

function resetInputModes() {
  if (touchPad) touchPad.setMode(MODE.IDLE);
  if (input) {
    input.mode = MODE.IDLE;
    input.aimKind = null;
  }
}

function bindUI() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  renderer = new AsciiRenderer(canvas);
  crt = new CrtFilter(canvas);

  input = new KeyboardController({
    onIntent: intent => {
      if (intent?.type === 'quit-campaign') {
        log('> QUIT CAMPAIGN is only wired in the M8 shell (no-op in harness).');
        resetInputModes();
        rerender();
        return;
      }
      applyIntent(intent);
      rerender();
    },
    onModeChange: () => {
      logModeChange(activeInputState());
      rerender();
    },
  });
  input.attach();

  touchPad = document.getElementById('touch-pad') as unknown as TouchPad;
  if (touchPad) {
    touchPad.addEventListener('intent', evt => {
      const intent = (evt as CustomEvent<Intent>).detail;
      if (intent?.type === 'quit-campaign') {
        log('> QUIT CAMPAIGN is only wired in the M8 shell (no-op in harness).');
        resetInputModes();
        rerender();
        return;
      }
      applyIntent(intent);
      rerender();
    });
    touchPad.addEventListener('mode-change', () => {
      logModeChange(activeInputState());
      rerender();
    });
  }

  // Reset / archetype toggles aren't part of the game keymap — wire directly.
  document.addEventListener('keydown', evt => {
    if (evt.ctrlKey || evt.metaKey) return;
    if (evt.key === 'r' || evt.key === 'R') {
      buildScenario();
      resetInputModes();
      rerender();
      evt.preventDefault();
    } else if (evt.key === '1') {
      archetype = 'merc';
      buildScenario();
      resetInputModes();
      rerender();
      evt.preventDefault();
    } else if (evt.key === '2') {
      archetype = 'razor';
      buildScenario();
      resetInputModes();
      rerender();
      evt.preventDefault();
    } else if (evt.key === '3') {
      archetype = 'tech';
      buildScenario();
      resetInputModes();
      rerender();
      evt.preventDefault();
    }
  });
}

bindUI();
buildScenario();
rerender();

const gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (gameCanvas) gameCanvas.focus();
