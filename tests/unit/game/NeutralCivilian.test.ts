import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NeutralCivilian } from '../../../src/game/entities/NeutralCivilian.js';
import { Entity } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import { FACTION, TILE, REP } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';

function makeWorld(opts: { width?: number; height?: number } = {}) {
  const w = opts.width ?? 10;
  const h = opts.height ?? 10;
  const grid = new Grid(w, h, TILE.FLOOR);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  return { grid, bus, world };
}

function makePlayer(x: number, y: number) {
  return new Entity({ id: 'player', x, y, faction: FACTION.PLAYER, glyph: '@' });
}

// --- Construction ------------------------------------------------------------

test('NeutralCivilian is NEUTRAL faction with glyph "n"', () => {
  const civ = new NeutralCivilian({ id: 'nciv-0', x: 3, y: 3 });
  assert.equal(civ.faction, FACTION.NEUTRAL);
  assert.equal(civ.glyph, 'n');
  assert.equal(civ.maxHp, 1);
  assert.equal(civ.maxAp, 1);
});

test('NeutralCivilian constructor validates sightRange', () => {
  assert.throws(() => new NeutralCivilian({ id: 'x', x: 0, y: 0, sightRange: -1 }), /sightRange/);
});

// --- High rep (≥70): idle ----------------------------------------------------

test('NeutralCivilian idles at rep ≥ NEUTRAL_IDLE_THRESHOLD', () => {
  const { world } = makeWorld();
  const civ = new NeutralCivilian({ id: 'nciv-0', x: 3, y: 3 });
  const player = makePlayer(5, 3);
  world.addEntity(civ);
  world.addEntity(player);

  const step = civ.act(world, new Rng(1), { rep: REP.NEUTRAL_IDLE_THRESHOLD });
  assert.ok(step);
  assert.equal(step.type, 'neutral-idle');
  // Position unchanged.
  assert.equal(civ.x, 3);
  assert.equal(civ.y, 3);
});

// --- Mid rep (30..69): flee --------------------------------------------------

test('NeutralCivilian flees one tile away from player at mid rep', () => {
  const { world } = makeWorld();
  // Player at (3,3), civilian at (4,3) — civilian should flee right (+x).
  const civ = new NeutralCivilian({ id: 'nciv-0', x: 4, y: 3 });
  const player = makePlayer(3, 3);
  world.addEntity(civ);
  world.addEntity(player);

  const step = civ.act(world, new Rng(1), { rep: 50 });
  assert.ok(step);
  assert.equal(step.type, 'neutral-flee');
  // Should have moved away from the player (increasing x distance).
  assert.ok(
    Math.max(Math.abs(civ.x - player.x), Math.abs(civ.y - player.y)) > 1,
    `civilian at (${civ.x},${civ.y}) should be further from player at (${player.x},${player.y})`
  );
});

test('NeutralCivilian reports cornered when no flee tile is available', () => {
  // Tiny world: civilian surrounded by walls on all sides except the player.
  const grid = new Grid(3, 3, TILE.WALL);
  grid.setTile(1, 1, TILE.FLOOR); // civilian
  grid.setTile(1, 0, TILE.FLOOR); // player
  const bus = new EventBus();
  const world = new World(grid, { events: bus });

  const civ = new NeutralCivilian({ id: 'nciv-0', x: 1, y: 1 });
  const player = makePlayer(1, 0);
  world.addEntity(civ);
  world.addEntity(player);

  const step = civ.act(world, new Rng(1), { rep: 50 });
  assert.ok(step);
  assert.equal(step.type, 'neutral-cornered');
  assert.equal(civ.x, 1, 'position unchanged when cornered');
  assert.equal(civ.y, 1);
});

test('NeutralCivilian flee emits entity:moved', () => {
  const { world, bus } = makeWorld();
  const civ = new NeutralCivilian({ id: 'nciv-0', x: 5, y: 5 });
  const player = makePlayer(3, 5);
  world.addEntity(civ);
  world.addEntity(player);

  const moved: unknown[] = [];
  bus.on(EVENT.ENTITY_MOVED, (p: unknown) => moved.push(p));

  civ.act(world, new Rng(1), { rep: 50 });
  assert.equal(moved.length, 1, 'flee should emit entity:moved');
});

// --- Low rep (<30): panic + noise --------------------------------------------

test('NeutralCivilian emits noise at rep < NEUTRAL_FLEE_THRESHOLD', () => {
  const { world, bus } = makeWorld();
  const civ = new NeutralCivilian({ id: 'nciv-0', x: 3, y: 3 });
  const player = makePlayer(5, 3);
  world.addEntity(civ);
  world.addEntity(player);

  const noises: unknown[] = [];
  bus.on(EVENT.NOISE, (p: unknown) => noises.push(p));

  const step = civ.act(world, new Rng(1), { rep: REP.NEUTRAL_FLEE_THRESHOLD - 1 });
  assert.ok(step);
  assert.equal(step.type, 'neutral-panic');
  assert.equal(noises.length, 1);
  const payload = noises[0] as Record<string, unknown>;
  assert.deepEqual(payload.origin, { x: 3, y: 3 });
  assert.equal(payload.source, civ);
  assert.equal(payload.kind, 'civilian-panic');
});

// --- No player visible -------------------------------------------------------

test('NeutralCivilian returns null when no player is visible', () => {
  const { world } = makeWorld();
  const civ = new NeutralCivilian({ id: 'nciv-0', x: 3, y: 3 });
  world.addEntity(civ);
  // No player on the map at all.

  const step = civ.act(world, new Rng(1), { rep: 10 });
  assert.equal(step, null, 'no action without a visible player');
});

test('NeutralCivilian returns null when dead', () => {
  const { world } = makeWorld();
  const civ = new NeutralCivilian({ id: 'nciv-0', x: 3, y: 3 });
  const player = makePlayer(5, 3);
  world.addEntity(civ);
  world.addEntity(player);
  civ.damage(1); // kill

  const step = civ.act(world, new Rng(1), { rep: 10 });
  assert.equal(step, null, 'dead civilian does nothing');
});

test('NeutralCivilian.act throws on non-finite rep', () => {
  const { world } = makeWorld();
  const civ = new NeutralCivilian({ id: 'nciv-0', x: 3, y: 3 });
  world.addEntity(civ);
  assert.throws(() => civ.act(world, new Rng(1), { rep: NaN }), /finite/);
});
