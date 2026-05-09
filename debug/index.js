/**
 * M5 debug harness — KeyboardController emits intents, the game loop applies
 * them. Player is a Merc; vault with `v`+dir, fire ranged with `f`+dir.
 * The renderer fogs unseen tiles and dims remembered ones. The drone is now a
 * `CorpDrone` running a patrol → investigate → engage state machine on the
 * shared `EventBus`; the harness subscribes player vision to `entity:moved`
 * so a drone walking into LOS appears immediately (closes the M4 deferred fix).
 */
import { Grid } from '/src/game/Grid.js';
import { World } from '/src/game/World.js';
import { TurnQueue } from '/src/game/TurnQueue.js';
import { Merc } from '/src/game/archetypes/Merc.js';
import { CorpDrone } from '/src/game/ai/CorpDrone.js';
import { EventBus, EVENT } from '/src/game/events.js';
import { TILE, FACTION, SIGHT_RANGE } from '/src/game/constants.js';
import { AsciiRenderer } from '/src/render/AsciiRenderer.js';
import { CrtFilter } from '/src/render/CrtFilter.js';
import { KeyboardController } from '/src/input/KeyboardController.js';
import { MODE } from '/src/input/keymap.js';
import { VisionField } from '/src/game/Vision.js';
import { hasLineOfSight, withinRange } from '/src/game/LineOfSight.js';
import { canFireRanged, resolveRanged } from '/src/game/Combat.js';
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
let vision;
let rng;
let bus;
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
  player = new Merc({ id: 'merc', x: 3, y: 3, maxAp: 4 });
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
  log(`> RUN INIT — turn ${queue.turnNumber}, ${queue.currentFaction.toUpperCase()} acts.`);
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
  document.getElementById('status').textContent =
    `TURN ${queue.turnNumber}  |  ACTING: ${queue.currentFaction.toUpperCase()}  |  ` +
    `PLAYER AP ${player.ap}/${player.maxAp} HP ${player.hp}/${player.maxHp}  |  ` +
    `${droneStatus}${aim}`;
  document.getElementById('log').textContent = logLines.slice(-12).join('\n');
}

function applyIntent(intent) {
  if (queue.currentFaction !== FACTION.PLAYER && intent.type !== 'cancel') {
    log('> NOT YOUR TURN — press space.');
    return;
  }
  switch (intent.type) {
    case 'move': {
      const check = world.canMoveEntity(player, intent.dx, intent.dy);
      if (!check.ok) {
        log(`> MOVE DENIED: ${check.reason}`);
        return;
      }
      world.moveEntity(player, intent.dx, intent.dy);
      // Vision recompute fires via the bus subscription (entity:moved).
      log(`> @ moved to (${player.x}, ${player.y}) — ${player.ap} AP left.`);
      if (player.ap === 0) {
        log('> AP EXHAUSTED — auto-ending turn.');
        advanceTurn();
      }
      return;
    }
    case 'vault': {
      const check = player.canVault(world, intent.dx, intent.dy);
      if (!check.ok) {
        log(`> VAULT DENIED: ${check.reason}`);
        return;
      }
      player.vault(world, intent.dx, intent.dy);
      // Vault doesn't go through World.moveEntity (different mechanic), so
      // refresh vision explicitly until the perk fires its own move event.
      recomputeVision();
      log(`> @ vaulted to (${player.x}, ${player.y}) — ${player.ap} AP left.`);
      if (player.ap === 0) {
        log('> AP EXHAUSTED — auto-ending turn.');
        advanceTurn();
      }
      return;
    }
    case 'fire': {
      const target = pickFireTarget(intent.dx, intent.dy);
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
        `> @ fires at ${target.id} — ` +
          `${result.hit ? 'HIT' : 'miss'} (roll ${result.roll.toFixed(2)} vs ${result.threshold.toFixed(2)}` +
          `${result.inCover ? ', cover' : ''}).` +
          (result.killed ? ` ${target.id.toUpperCase()} DOWN.` : '')
      );
      if (player.ap === 0) {
        log('> AP EXHAUSTED — auto-ending turn.');
        advanceTurn();
      }
      return;
    }
    case 'wait': {
      log(`> @ holds position (drops ${player.ap} AP).`);
      player.ap = 0;
      advanceTurn();
      return;
    }
    case 'end-turn': {
      advanceTurn();
      return;
    }
    case 'cancel': {
      log('> ACTION CANCELLED.');
      return;
    }
    default:
      log(`> UNHANDLED INTENT: ${intent.type}`);
  }
}

/**
 * Walk Bresenham-ish from the player along (dx, dy) and return the first
 * hostile we hit while LOS holds and we're inside the *Euclidean* range
 * Combat enforces. The targeting reticle in M5+ will replace this with
 * explicit picking, but for the harness it's good enough — and shares the
 * `withinRange` helper with `canFireRanged` so the harness can never offer
 * a target combat would later reject as out-of-range (the M4 review trap).
 */
function pickFireTarget(dx, dy) {
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

function advanceTurn() {
  queue.endTurn(world);
  log(`> ${queue.currentFaction.toUpperCase()} acts (turn ${queue.turnNumber}).`);
  if (queue.currentFaction === FACTION.CORP) {
    runCorpTurn();
    queue.endTurn(world);
    log(`> PLAYER acts (turn ${queue.turnNumber}).`);
  }
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

function bindUI() {
  const canvas = document.getElementById('game-canvas');
  renderer = new AsciiRenderer(canvas);
  crt = new CrtFilter(canvas);

  input = new KeyboardController({
    onIntent: intent => {
      applyIntent(intent);
      rerender(input.mode);
    },
    onModeChange: nextMode => {
      if (nextMode === MODE.VAULT_AIM) log('> VAULT — pick a direction (Esc to cancel).');
      if (nextMode === MODE.FIRE_AIM) log('> FIRE — pick a direction (Esc to cancel).');
      rerender(nextMode);
    },
  });
  input.attach();

  // Reset key isn't part of the game keymap — wire it directly.
  document.addEventListener('keydown', evt => {
    if ((evt.key === 'r' || evt.key === 'R') && !evt.ctrlKey && !evt.metaKey) {
      buildScenario();
      rerender(input.mode);
      evt.preventDefault();
    }
  });
}

bindUI();
buildScenario();
rerender();
document.getElementById('game-canvas').focus();
