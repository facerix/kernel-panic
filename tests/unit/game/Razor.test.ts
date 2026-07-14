import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Razor } from '../../../src/game/archetypes/Razor.js';
import { Entity } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { TILE, FACTION, AP_COST, STATUS_EFFECT } from '../../../src/game/constants.js';
import { EventBus, EVENT } from '../../../src/game/events.js';

const makeWorld = ({ grid, razorAt = [3, 3], extraEntities = [], bus = null } = {}) => {
  const g = grid ?? new Grid(8, 8);
  const w = new World(g, bus ? { events: bus } : {});
  const razor = new Razor({ id: 'razor', x: razorAt[0], y: razorAt[1] });
  w.addEntity(razor);
  for (const e of extraEntities) w.addEntity(e);
  return { world: w, razor };
};

test('Razor inherits Entity and is faction PLAYER by default', () => {
  const r = new Razor({ id: 'r', x: 0, y: 0 });
  assert.ok(r instanceof Entity);
  assert.equal(r.faction, FACTION.PLAYER);
});

test('Razor.canSlide rejects (0,0) as no-op', () => {
  const { world, razor } = makeWorld();
  assert.equal(razor.canSlide(world, 0, 0).reason, 'no-op');
});

test('Razor.canSlide rejects steps larger than 1 (Chebyshev unit step)', () => {
  const { world, razor } = makeWorld();
  assert.equal(razor.canSlide(world, 2, 0).reason, 'too-far');
  assert.equal(razor.canSlide(world, 0, -2).reason, 'too-far');
});

test('Razor.canSlide rejects when AP < SLIDE cost', () => {
  const { world, razor } = makeWorld();
  razor.spendAp(razor.ap - (AP_COST.SLIDE - 1));
  assert.equal(razor.canSlide(world, 1, 0).reason, 'insufficient-ap');
});

test('Razor.canSlide rejects when the intermediate tile is a wall', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.WALL);
  const { world, razor } = makeWorld({ grid: g });
  assert.equal(razor.canSlide(world, 1, 0).reason, 'blocked-step');
});

test('Razor.canSlide rejects when the intermediate tile is COVER (slide goes through floor only)', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.COVER);
  const { world, razor } = makeWorld({ grid: g });
  assert.equal(razor.canSlide(world, 1, 0).reason, 'blocked-step');
});

test('Razor.canSlide rejects when the intermediate tile is occupied', () => {
  const g = new Grid(8, 8);
  const drone = new Entity({ id: 'd', x: 4, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const { world, razor } = makeWorld({ grid: g, extraEntities: [drone] });
  assert.equal(razor.canSlide(world, 1, 0).reason, 'occupied-step');
});

test('Razor.canSlide rejects when the landing tile is impassable', () => {
  const g = new Grid(8, 8);
  g.setTile(5, 3, TILE.WALL);
  const { world, razor } = makeWorld({ grid: g });
  assert.equal(razor.canSlide(world, 1, 0).reason, 'blocked');
});

test('Razor.canSlide rejects when the landing tile is occupied', () => {
  const g = new Grid(8, 8);
  const drone = new Entity({ id: 'd', x: 5, y: 3, faction: FACTION.CORP, glyph: 'd' });
  const { world, razor } = makeWorld({ grid: g, extraEntities: [drone] });
  assert.equal(razor.canSlide(world, 1, 0).reason, 'occupied');
});

test('Razor.canSlide accepts a clean orthogonal slide across two floor tiles', () => {
  const { world, razor } = makeWorld();
  assert.equal(razor.canSlide(world, 1, 0).ok, true);
});

test('Razor.canSlide accepts a clean diagonal slide', () => {
  const { world, razor } = makeWorld();
  assert.equal(razor.canSlide(world, 1, 1).ok, true);
});

test('Razor.canSlide throws on non-integer offsets (data-corruption guard)', () => {
  const { world, razor } = makeWorld();
  assert.throws(() => razor.canSlide(world, 0.5, 0), TypeError);
  assert.throws(() => razor.canSlide(world, 0, Number.NaN), TypeError);
});

test('Razor.slide commits position by (2*dx, 2*dy) and debits SLIDE AP', () => {
  const { world, razor } = makeWorld();
  const apBefore = razor.ap;
  razor.slide(world, 1, 0);
  assert.equal(razor.x, 5);
  assert.equal(razor.y, 3);
  assert.equal(razor.ap, apBefore - AP_COST.SLIDE);
});

test('Razor.slide sets stealthed=true on commit', () => {
  const { world, razor } = makeWorld();
  assert.equal(razor.stealthed, false, 'stealth starts false');
  razor.slide(world, 1, 0);
  assert.equal(razor.stealthed, true, 'slide engages stealth');
});

test('Razor.slide throws on illegal slide and leaves state untouched', () => {
  const g = new Grid(8, 8);
  g.setTile(4, 3, TILE.WALL); // intermediate blocked
  const { world, razor } = makeWorld({ grid: g });
  const apBefore = razor.ap;
  const xBefore = razor.x;
  const stealthBefore = razor.stealthed;
  assert.throws(() => razor.slide(world, 1, 0), /Illegal slide/);
  assert.equal(razor.x, xBefore);
  assert.equal(razor.ap, apBefore);
  assert.equal(razor.stealthed, stealthBefore, 'no stealth on a thrown slide');
});

test('Razor.slide emits entity:moved with the from/to delta', () => {
  const bus = new EventBus();
  const { world, razor } = makeWorld({ bus });
  const moves = [];
  bus.on(EVENT.ENTITY_MOVED, payload => moves.push(payload));
  razor.slide(world, 1, 0);
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].from, { x: 3, y: 3 });
  assert.deepEqual(moves[0].to, { x: 5, y: 3 });
});

test('Razor.slide does NOT emit a noise event (perk is silent)', () => {
  const bus = new EventBus();
  const { world, razor } = makeWorld({ bus });
  const noises = [];
  bus.on(EVENT.NOISE, payload => noises.push(payload));
  razor.slide(world, 1, 0);
  assert.deepEqual(noises, [], 'slide is silent — that is the whole point');
});

test('Razor.refreshAp clears the stealthed flag (turn rotation drops cloak)', () => {
  const { world, razor } = makeWorld();
  razor.slide(world, 1, 0);
  assert.equal(razor.stealthed, true);
  razor.refreshAp();
  assert.equal(razor.stealthed, false, 'stealth ends at the next AP refresh');
  // And refresh actually refreshes AP, so subclass didn't break super().
  assert.equal(razor.ap, razor.maxAp);
});

test('Razor.slide arms the generic STEALTH effect (P3.5.M1 channel)', () => {
  const { world, razor } = makeWorld();
  assert.equal(razor.hasEffect(STATUS_EFFECT.STEALTH), false);
  razor.slide(world, 1, 0);
  assert.equal(
    razor.hasEffect(STATUS_EFFECT.STEALTH),
    true,
    'slide sets STEALTH via the effect channel'
  );
  assert.equal(razor.effectTurnsRemaining(STATUS_EFFECT.STEALTH), 1, 'one own-refresh of cloak');
});

test('Razor slide -> wait -> slide re-cloaks (second slide re-arms stealth)', () => {
  const g = new Grid(12, 12);
  const { world, razor } = makeWorld({ grid: g, razorAt: [2, 2] });
  razor.slide(world, 1, 0); // lands (4,2), cloaked
  assert.equal(razor.stealthed, true);
  // The refresh that would have dropped the cloak also re-opens the AP budget,
  // then a second slide re-arms stealth for another turn.
  razor.refreshAp();
  assert.equal(razor.stealthed, false, 'cloak dropped at refresh');
  razor.slide(world, 1, 0); // lands (6,2)
  assert.equal(razor.stealthed, true, 'second slide re-cloaks');
  assert.equal(razor.effectTurnsRemaining(STATUS_EFFECT.STEALTH), 1);
});
