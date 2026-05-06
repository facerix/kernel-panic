/**
 * M1 debug harness — manual smoke test for the grid + turn engine.
 *
 * Renders the world as text in a <pre>; canvas/CRT rendering lands in M2.
 * Drone has no AI yet (M5), so it just stands there to prove turn rotation
 * and AP refresh are working.
 */
import { Grid } from '/src/game/Grid.js';
import { Entity } from '/src/game/Entity.js';
import { World } from '/src/game/World.js';
import { TurnQueue } from '/src/game/TurnQueue.js';
import { TILE, FACTION } from '/src/game/constants.js';

const GRID_W = 16;
const GRID_H = 10;

const TILE_GLYPH = {
  [TILE.FLOOR]: '.',
  [TILE.WALL]: '#',
  [TILE.COVER]: '+',
};

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

  // A divider with a doorway, plus a couple of cover tiles to test Vault later.
  for (let y = 3; y <= 6; y++) grid.setTile(8, y, TILE.WALL);
  grid.setTile(8, 5, TILE.FLOOR); // doorway
  grid.setTile(5, 4, TILE.COVER);
  grid.setTile(11, 6, TILE.COVER);

  world = new World(grid);
  player = new Entity({
    id: 'player',
    x: 2,
    y: 2,
    faction: FACTION.PLAYER,
    glyph: '@',
    maxAp: 4,
  });
  drone = new Entity({
    id: 'drone-1',
    x: 13,
    y: 7,
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

function renderGrid() {
  const rows = [];
  for (let y = 0; y < world.grid.height; y++) {
    let row = '';
    for (let x = 0; x < world.grid.width; x++) {
      const ent = world.entityAt(x, y);
      row += ent ? ent.glyph : TILE_GLYPH[world.grid.tileAt(x, y)];
    }
    rows.push(row);
  }
  document.getElementById('grid').textContent = rows.join('\n');
}

function renderStatus() {
  const apBar = '▮'.repeat(player.ap) + '▯'.repeat(Math.max(0, player.maxAp - player.ap));
  document.getElementById('status').textContent =
    `TURN ${queue.turnNumber}  |  ACTING: ${queue.currentFaction.toUpperCase()}  |  ` +
    `PLAYER AP ${player.ap}/${player.maxAp} [${apBar}]  |  ` +
    `DRONE @(${drone.x},${drone.y}) AP ${drone.ap}/${drone.maxAp}`;
}

function renderLog() {
  document.getElementById('log').textContent = logLines.slice(-12).join('\n');
}

function log(line) {
  logLines.push(line);
  // Cap to avoid unbounded growth in long sessions.
  if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
}

function rerender() {
  renderGrid();
  renderStatus();
  renderLog();
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
  // End the current faction's turn. The drone has no AI yet (M5), so a
  // CORP turn just rotates straight back to PLAYER.
  queue.endTurn(world);
  log(`> ${queue.currentFaction.toUpperCase()} acts (turn ${queue.turnNumber}).`);
  if (queue.currentFaction === FACTION.CORP) {
    // Auto-pass the corp turn until M5 lands.
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
  // Don't fight the browser on modifier combos.
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

buildScenario();
rerender();
document.getElementById('grid').focus();
