import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { Entity } from '../../../src/game/Entity.js';
import { World } from '../../../src/game/World.js';
import {
  TILE,
  FACTION,
  DEFAULT_HP,
  DEFAULT_AP,
  AP_COST,
  SNIPER_SIGHT_RANGE,
  SNIPER_DAMAGE,
  ENEMY_TIER,
} from '../../../src/game/constants.js';
import { Sniper } from '../../../src/game/ai/Sniper.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { PatrolHostile, PATROL_STATE } from '../../../src/game/ai/PatrolHostile.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import { Rng } from '../../../src/rng.js';

const openWorld = (w = 18, h = 8) => new World(new Grid(w, h), { events: new EventBus() });

const addPlayer = (world, x, y, maxHp = 5) => {
  const player = new Entity({ id: 'player', x, y, faction: FACTION.PLAYER, glyph: '@', maxHp });
  world.addEntity(player);
  return player;
};

// --- identity ----------------------------------------------------------------

test('Sniper is a corp PatrolHostile with its own glyph and the longest sight', () => {
  const sniper = new Sniper({ id: 'sniper-0', x: 1, y: 1 });
  assert.ok(sniper instanceof PatrolHostile, 'shares the patrol state machine');
  assert.ok(!(sniper instanceof Skirmisher), 'is a sibling of Skirmisher, not a subclass');
  assert.equal(sniper.faction, FACTION.CORP);
  assert.equal(sniper.glyph, 's');
  assert.equal(sniper.sightRange, SNIPER_SIGHT_RANGE);
  assert.equal(sniper.aimTargetId, null);
});

test('Sniper at T2 has baseline specialist HP/AP and no armor', () => {
  const sniper = new Sniper({ id: 'sniper-0', x: 1, y: 1, tier: ENEMY_TIER.T2 });
  assert.equal(sniper.maxHp, DEFAULT_HP, 'specialist T2 hp multiplier is 1.0×');
  assert.equal(sniper.maxAp, DEFAULT_AP, 'default 4 AP — room to move-then-aim');
  assert.equal(sniper.damageReduction, 0);
});

// --- telegraph: aim on N, fire on N+1 ----------------------------------------

test('Sniper in range commits aim (2 AP, no NOISE) instead of firing immediately', () => {
  const world = openWorld();
  const player = addPlayer(world, 2, 3);
  const sniper = new Sniper({ id: 'sniper-0', x: 12, y: 3 });
  world.addEntity(sniper);
  const noises = [];
  world.events.on(EVENT.NOISE, p => noises.push(p));

  const log = sniper.takeTurn(world, new Rng(1));
  assert.ok(
    log.some(step => step.type === 'aim' && step.target === 'player'),
    'yields an aim step on the player'
  );
  assert.ok(!log.some(step => step.type === 'fire'), 'does not fire the same turn');
  assert.equal(sniper.aimTargetId, 'player', 'holds the shot');
  assert.equal(sniper.ap, DEFAULT_AP - AP_COST.RANGED_ATTACK, 'aim costs a ranged action');
  assert.equal(noises.length, 0, 'aim is silent — no NOISE telegraph');
  assert.equal(player.hp, 5, 'no damage yet');
});

test('Sniper fires the held shot next turn — guaranteed hit, heavy damage, loud', () => {
  const world = openWorld();
  const player = addPlayer(world, 2, 3);
  const sniper = new Sniper({ id: 'sniper-0', x: 12, y: 3 });
  world.addEntity(sniper);
  sniper.takeTurn(world, new Rng(1)); // aim

  const noises = [];
  world.events.on(EVENT.NOISE, p => noises.push(p));
  sniper.refreshAp();
  const log = sniper.takeTurn(world, new Rng(2)); // fire

  const fire = log.find(step => step.type === 'fire');
  assert.ok(fire, 'fires the held shot');
  assert.equal(fire.result.hit, true, 'committed shot is guaranteed to hit');
  assert.equal(fire.result.damage, SNIPER_DAMAGE);
  assert.equal(player.hp, 5 - SNIPER_DAMAGE);
  assert.equal(sniper.aimTargetId, null, 'aim cleared after firing');
  assert.ok(noises.length >= 1, 'the shot itself is loud');
});

// --- counterplay: cancel paths -----------------------------------------------

test('held shot cancels when the player breaks LOS', () => {
  const world = openWorld();
  const player = addPlayer(world, 2, 3);
  const sniper = new Sniper({ id: 'sniper-0', x: 12, y: 3 });
  world.addEntity(sniper);
  sniper.takeTurn(world, new Rng(1)); // aim with clear LOS

  for (let y = 0; y < 8; y++) world.grid.setTile(6, y, TILE.WALL); // wall the lane
  sniper.refreshAp();
  const log = sniper.takeTurn(world, new Rng(2));

  assert.ok(
    log.some(step => step.type === 'aim-cancelled'),
    'cancels rather than shooting through a wall'
  );
  assert.ok(!log.some(step => step.type === 'fire'));
  assert.equal(player.hp, 5, 'no damage on a cancelled shot');
  assert.equal(sniper.aimTargetId, null);
});

test('held shot cancels when the target re-stealths beyond Chebyshev 1', () => {
  const world = openWorld();
  const player = addPlayer(world, 2, 3);
  const sniper = new Sniper({ id: 'sniper-0', x: 12, y: 3 });
  world.addEntity(sniper);
  sniper.takeTurn(world, new Rng(1)); // aim

  player.stealthed = true; // SLIDE away
  sniper.refreshAp();
  const log = sniper.takeTurn(world, new Rng(2));
  const cancel = log.find(step => step.type === 'aim-cancelled');
  assert.ok(cancel, 'cancels on a re-stealthed distant target');
  assert.equal(cancel.reason, 'concealed-target');
  assert.equal(player.hp, 5);
});

test('damage during the aim window breaks the held shot', () => {
  const world = openWorld();
  addPlayer(world, 2, 3);
  const sniper = new Sniper({ id: 'sniper-0', x: 12, y: 3 });
  world.addEntity(sniper);
  sniper.bindToBus(world.events);
  sniper.takeTurn(world, new Rng(1)); // aim
  assert.equal(sniper.aimTargetId, 'player');

  // Focus fire lands on the sniper while it holds aim.
  world.events.emit(EVENT.ENTITY_DAMAGED, { target: sniper, damage: 1 });
  assert.equal(sniper.aimTargetId, null, 'the held shot is broken');

  // Next turn it must re-acquire and re-aim, not fire.
  sniper.refreshAp();
  const log = sniper.takeTurn(world, new Rng(2));
  assert.ok(
    log.some(step => step.type === 'aim'),
    're-aims after losing the shot'
  );
  assert.ok(!log.some(step => step.type === 'fire'), 'cannot fire a shot it never held');
});

// --- positioning -------------------------------------------------------------

test('Sniper kites a closing target, then aims from range the same turn', () => {
  const world = openWorld();
  addPlayer(world, 4, 3);
  const sniper = new Sniper({ id: 'sniper-0', x: 6, y: 3 }); // cheb 2 < preferredMin 3
  world.addEntity(sniper);

  const log = sniper.takeTurn(world, new Rng(1));
  assert.ok(
    log.some(step => step.type === 'move-engage'),
    'kites away from the closing target'
  );
  assert.ok(
    log.some(step => step.type === 'aim'),
    'then commits aim from the new range'
  );
  assert.ok(sniper.x > 6, 'moved away, not toward');
  assert.equal(sniper.aimTargetId, 'player');
});

test('Sniper investigating a lead seeks max-distance vantage, not a blind close', () => {
  const world = openWorld();
  const sniper = new Sniper({ id: 'sniper-0', x: 5, y: 3, maxAp: 1 });
  world.addEntity(sniper);
  sniper.state = PATROL_STATE.INVESTIGATE;
  sniper.lastKnownTarget = { x: 1, y: 3 };

  const log = sniper.takeTurn(world, new Rng(1));
  assert.ok(
    log.some(step => step.type === 'move-investigate'),
    'repositions while investigating'
  );
  assert.ok(sniper.x > 5, 'moved away from the lead (vantage), not toward it');
});

test('Sniper abandons a lead when no vantage restores LOS — never charges in', () => {
  const world = openWorld(10, 7);
  for (let y = 0; y < 7; y++) world.grid.setTile(4, y, TILE.WALL);
  world.grid.setTile(4, 5, TILE.FLOOR);
  const sniper = new Sniper({ id: 'sniper-0', x: 6, y: 1, maxAp: 1 });
  world.addEntity(sniper);
  sniper.state = PATROL_STATE.INVESTIGATE;
  sniper.lastKnownTarget = { x: 1, y: 1 };

  const startX = sniper.x;
  const log = sniper.takeTurn(world, new Rng(1));
  assert.ok(
    log.some(step => step.type === 'investigate-abandoned'),
    'drops the lead instead of pathing toward it'
  );
  assert.equal(sniper.x, startX, 'held position — no blind charge through the door');
});

test('Sniper with 1 AP in range holds rather than closing for a shot it cannot afford', () => {
  const world = openWorld();
  addPlayer(world, 2, 3);
  const sniper = new Sniper({ id: 'sniper-0', x: 12, y: 3, maxAp: 1 });
  world.addEntity(sniper);

  const log = sniper.takeTurn(world, new Rng(1));
  assert.ok(!log.some(step => step.type === 'aim'), 'cannot aim without 2 AP');
  assert.ok(!log.some(step => step.type === 'move-engage'), 'does not burn the last AP closing');
});
