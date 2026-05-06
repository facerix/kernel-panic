/**
 * M2 debug harness — wires the canvas renderer + CRT filter onto the M1
 * grid/turn engine. Drone has no AI yet (M5), so the corp turn auto-passes.
 */
import { Grid } from '/src/game/Grid.js';
import { Entity } from '/src/game/Entity.js';
import { World } from '/src/game/World.js';
import { TurnQueue } from '/src/game/TurnQueue.js';
import { TILE, FACTION } from '/src/game/constants.js';
import { AsciiRenderer } from '/src/render/AsciiRenderer.js';
import { CrtFilter } from '/src/render/CrtFilter.js';

const GRID_W = 24;
const GRID_H = 16;

const KEY_TO_DELTA = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  q: [-1, -1],
  e: [1, -1],
  z: [-1, 1],
  c: [1, 1],
};

let world;
let queue;
let player;
let drone;
let renderer;
let crt;
const logLines = [];

function buildScenario() {
  const grid = new Grid(GRID_W, GRID_H);

  // Border walls.
  for (let x = 0; x < GRID_W; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, GRID_H - 1, TILE.WALL);
  }
  for (let y = 0; y < GRID_H; y++) {
    grid.setTile(0, y, TILE.WALL);
    grid.setTile(GRID_W - 1, y, TILE.WALL);
  }

  // A divider wall with a single doorway.
  for (let y = 4; y <= 11; y++) grid.setTile(12, y, TILE.WALL);
  grid.setTile(12, 8, TILE.FLOOR);

  // Some cover tiles to test passability + Vault later.
  grid.setTile(6, 6, TILE.COVER);
  grid.setTile(7, 6, TILE.COVER);
  grid.setTile(17, 9, TILE.COVER);
  grid.setTile(18, 4, TILE.COVER);

  world = new World(grid);
  player = new Entity({
    id: 'player',
    x: 3,
    y: 3,
    faction: FACTION.PLAYER,
    glyph: '@',
    maxAp: 4,
  });
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

function rerender() {
  renderer.draw(world, player);
  crt.apply();
  document.getElementById('status').textContent =
    `TURN ${queue.turnNumber}  |  ACTING: ${queue.currentFaction.toUpperCase()}  |  ` +
    `PLAYER AP ${player.ap}/${player.maxAp}  |  ` +
    `DRONE @(${drone.x},${drone.y}) AP ${drone.ap}/${drone.maxAp}`;
  document.getElementById('log').textContent = logLines.slice(-12).join('\n');
}

function tryMovePlayer(dx, dy) {
  if (queue.currentFaction !== FACTION.PLAYER) {
    log('> NOT YOUR TURN — press space.');
    return;
  }
  const check = world.canMoveEntity(player, dx, dy);
  if (!check.ok) {
    log(`> MOVE DENIED: ${check.reason}`);
    return;
  }
  world.moveEntity(player, dx, dy);
  log(`> @ moved to (${player.x}, ${player.y}) — ${player.ap} AP left.`);
  if (player.ap === 0) {
    log('> AP EXHAUSTED — auto-ending turn.');
    advanceTurn();
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

function waitTurn() {
  if (queue.currentFaction !== FACTION.PLAYER) return;
  log(`> @ holds position (drops ${player.ap} AP).`);
  player.ap = 0;
  advanceTurn();
}

document.addEventListener('keydown', evt => {
  if (evt.ctrlKey || evt.metaKey || evt.altKey) return;

  if (evt.key === 'r' || evt.key === 'R') {
    buildScenario();
    rerender();
    evt.preventDefault();
    return;
  }
  if (evt.key === ' ') {
    advanceTurn();
    rerender();
    evt.preventDefault();
    return;
  }
  if (evt.key === '.') {
    waitTurn();
    rerender();
    evt.preventDefault();
    return;
  }
  const delta = KEY_TO_DELTA[evt.key];
  if (delta) {
    tryMovePlayer(delta[0], delta[1]);
    rerender();
    evt.preventDefault();
  }
});

const canvas = document.getElementById('game-canvas');
renderer = new AsciiRenderer(canvas);
crt = new CrtFilter(canvas);
buildScenario();
rerender();
canvas.focus();
