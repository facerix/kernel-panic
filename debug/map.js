/**
 * M8 map builder debug harness — full procgen map in one view (no camera follow,
 * no fog). Matches Run.enterCombat placement: player + corp drones on the grid.
 */
import { Grid } from '/src/game/Grid.js';
import { World } from '/src/game/World.js';
import { Merc } from '/src/game/archetypes/Merc.js';
import { CorpDrone } from '/src/game/ai/CorpDrone.js';
import { EventBus } from '/src/game/events.js';
import { buildMap } from '/src/game/procgen/mapBuild.js';
import { Rng } from '/src/rng.js';
import { AsciiRenderer } from '/src/render/AsciiRenderer.js';
import { CrtFilter } from '/src/render/CrtFilter.js';

/** CSS pixels — canvas backing store is sized from grid × cell; display scales down */
const MAX_VIEW_WIDTH = 1120;
const MAX_VIEW_HEIGHT = 720;
const MIN_CELL = 8;
const DEFAULT_CELL = 20;

let world;
let renderer;
let crt;

function parseSeed(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return Date.now() >>> 0;
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new RangeError('Seed must be a finite number');
  }
  return n >>> 0;
}

function fitCellSize(gridW, gridH) {
  const w = Math.floor(MAX_VIEW_WIDTH / gridW);
  const h = Math.floor(MAX_VIEW_HEIGHT / gridH);
  const cell = Math.min(DEFAULT_CELL, w, h);
  return Math.max(MIN_CELL, cell);
}

function buildScenario(width, height, seed, threatCount) {
  const rng = new Rng(seed);
  const map = buildMap({ rng, width, height, threatCount });
  const bus = new EventBus();
  const w = new World(map.grid, { events: bus });

  const player = new Merc({
    id: 'merc',
    x: map.spawns.player.x,
    y: map.spawns.player.y,
    maxAp: 4,
  });
  w.addEntity(player);

  for (let i = 0; i < map.drones.length; i++) {
    const a = map.drones[i];
    const drone = new CorpDrone({
      id: `drone-${i}`,
      x: a.x,
      y: a.y,
      maxAp: 3,
      patrolWaypoints: a.waypoints,
    });
    w.addEntity(drone);
    drone.bindToBus(bus);
  }

  return { world: w, meta: map };
}

function resizeCanvasToGrid(canvas, gridW, gridH) {
  const cell = fitCellSize(gridW, gridH);
  renderer.cellSize = cell;
  renderer.fontSize = Math.round(cell * 0.9);
  canvas.width = gridW * cell;
  canvas.height = gridH * cell;
}

function rerender(metaLine = '') {
  const canvas = document.getElementById('map-canvas');
  const grid = world.grid;
  resizeCanvasToGrid(canvas, grid.width, grid.height);

  const camera = { x: 0, y: 0, width: grid.width, height: grid.height };
  renderer.draw(world, world.entities.get('merc'), {
    camera,
  });
  crt.apply();

  const metaEl = document.getElementById('map-meta');
  if (metaEl) metaEl.textContent = metaLine;
}

function bindUI() {
  const canvas = document.getElementById('map-canvas');
  renderer = new AsciiRenderer(canvas);
  crt = new CrtFilter(canvas);

  const form = document.getElementById('map-builder-form');
  form.addEventListener('submit', evt => {
    evt.preventDefault();
    const width = Number(form.width.value);
    const height = Number(form.height.value);
    const threatCount = Number(form.threatCount.value);
    if (width < 20 || height < 10) {
      alert('Width and height must be at least 20 and 10, respectively.');
      return;
    }
    if (!Number.isInteger(threatCount) || threatCount < 0 || threatCount > 12) {
      alert('Threat count must be an integer from 0 to 12.');
      return;
    }
    let seed;
    try {
      seed = parseSeed(form.seed.value);
    } catch (e) {
      alert(e.message);
      return;
    }
    try {
      const { world: next, meta } = buildScenario(width, height, seed, threatCount);
      world = next;
      rerender(
        `Seed ${seed} (u32)  ·  ${width}×${height}  ·  threats ${threatCount}  ·  exit (${meta.exitTile.x},${meta.exitTile.y})`
      );
    } catch (err) {
      console.error(err);
      alert(`Generation failed: ${err.message}`);
    }
  });
}

bindUI();

try {
  const { world: initial, meta } = buildScenario(24, 16, 0xdecafbad >>> 0, 2);
  world = initial;
  rerender(
    `Seed ${0xdecafbad >>> 0} (u32)  ·  24×16  ·  threats 2  ·  exit (${meta.exitTile.x},${meta.exitTile.y})`
  );
} catch (err) {
  console.error(err);
  const g = new Grid(24, 16);
  world = new World(g);
  world.addEntity(new Merc({ id: 'merc', x: 0, y: 0, maxAp: 4 }));
  rerender(`Fallback floor grid — hit Generate after fixing: ${err.message}`);
}

document.getElementById('map-canvas').focus();
