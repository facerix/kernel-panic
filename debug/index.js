/**
 * M3 debug harness — KeyboardController emits intents, the game loop applies
 * them. Player is a Merc; press `v` then a direction to vault over cover.
 * Drone has no AI yet (M5), so the corp turn auto-passes.
 */
import { Grid } from '/src/game/Grid.js';
import { Entity } from '/src/game/Entity.js';
import { World } from '/src/game/World.js';
import { TurnQueue } from '/src/game/TurnQueue.js';
import { Merc } from '/src/game/archetypes/Merc.js';
import { TILE, FACTION } from '/src/game/constants.js';
import { AsciiRenderer } from '/src/render/AsciiRenderer.js';
import { CrtFilter } from '/src/render/CrtFilter.js';
import { KeyboardController } from '/src/input/KeyboardController.js';
import { MODE } from '/src/input/keymap.js';

const GRID_W = 24;
const GRID_H = 16;

let world;
let queue;
let player;
let drone;
let renderer;
let crt;
let input;
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

  world = new World(grid);
  player = new Merc({ id: 'merc', x: 3, y: 3, maxAp: 4 });
  drone = new Entity({
    id: 'drone-1',
    x: 19,
    y: 12,
    faction: FACTION.CORP,
    glyph: 'd',
    maxAp: 3,
  });
  world.addEntity(player);
  world.addEntity(drone);

  queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
  logLines.length = 0;
  log(`> RUN INIT — turn ${queue.turnNumber}, ${queue.currentFaction.toUpperCase()} acts.`);
}

function log(line) {
  logLines.push(line);
  if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
}

function rerender(modeHint = '') {
  renderer.draw(world, player);
  crt.apply();
  const aim = modeHint && modeHint !== MODE.IDLE ? `  |  MODE: ${modeHint}` : '';
  document.getElementById('status').textContent =
    `TURN ${queue.turnNumber}  |  ACTING: ${queue.currentFaction.toUpperCase()}  |  ` +
    `PLAYER AP ${player.ap}/${player.maxAp}  |  ` +
    `DRONE @(${drone.x},${drone.y}) AP ${drone.ap}/${drone.maxAp}${aim}`;
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
      log(`> @ vaulted to (${player.x}, ${player.y}) — ${player.ap} AP left.`);
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

function advanceTurn() {
  queue.endTurn(world);
  log(`> ${queue.currentFaction.toUpperCase()} acts (turn ${queue.turnNumber}).`);
  if (queue.currentFaction === FACTION.CORP) {
    queue.endTurn(world);
    log(`> CORP idled — back to PLAYER (turn ${queue.turnNumber}).`);
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
