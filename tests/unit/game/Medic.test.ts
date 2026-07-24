import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Medic } from '../../../src/game/ai/Medic.js';
import { Juggernaut } from '../../../src/game/ai/Juggernaut.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { PatrolHostile } from '../../../src/game/ai/PatrolHostile.js';
import { Entity } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import {
  ENEMY_TIER,
  FACTION,
  MEDIC_HEAL_AMOUNT,
  MEDIC_SHIELD_HP,
} from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';

const openWorld = () => new World(new Grid(14, 8));

const addPlayer = (world: World, x = 2, y = 2) => {
  const player = new Entity({ id: 'player', x, y, faction: FACTION.PLAYER, glyph: '@' });
  world.addEntity(player);
  return player;
};

test('Medic is a corp specialist PatrolHostile with the medic glyph', () => {
  const medic = new Medic({ id: 'medic-0', x: 1, y: 1 });
  assert.ok(medic instanceof PatrolHostile);
  assert.equal(medic.faction, FACTION.CORP);
  assert.equal(medic.glyph, 'm');
});

test('Medic shields a durable ally proactively before HP is lost', () => {
  const world = openWorld();
  addPlayer(world);
  const patient = new Juggernaut({ id: 'juggernaut-0', x: 5, y: 2, tier: ENEMY_TIER.T3 });
  const medic = new Medic({ id: 'medic-0', x: 6, y: 2, maxAp: 2 });
  world.addEntity(patient);
  world.addEntity(medic);

  const log = medic.takeTurn(world, new Rng(1));

  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'shield');
  assert.equal(log[0].target, patient.id);
  assert.equal(log[0].amount, MEDIC_SHIELD_HP);
  assert.equal(patient.shieldHp, MEDIC_SHIELD_HP);
  assert.equal(patient.hp, patient.maxHp, 'shield is proactive, not a heal substitute');
});

test('Medic heals a wounded durable ally before adding shield', () => {
  const world = openWorld();
  addPlayer(world);
  const patient = new Juggernaut({ id: 'juggernaut-0', x: 5, y: 2, tier: ENEMY_TIER.T3 });
  patient.damage(2);
  const medic = new Medic({ id: 'medic-0', x: 6, y: 2, maxAp: 2 });
  world.addEntity(patient);
  world.addEntity(medic);

  const log = medic.takeTurn(world, new Rng(1));

  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'heal');
  assert.equal(log[0].target, patient.id);
  assert.equal(log[0].amount, MEDIC_HEAL_AMOUNT);
  assert.equal(patient.hp, patient.maxHp - 1);
  assert.equal(patient.shieldHp, 0);
});

test('Medic moves toward a durable patient outside support range', () => {
  const world = openWorld();
  addPlayer(world);
  const patient = new Juggernaut({ id: 'juggernaut-0', x: 11, y: 2, tier: ENEMY_TIER.T3 });
  const medic = new Medic({ id: 'medic-0', x: 3, y: 2, maxAp: 1 });
  world.addEntity(patient);
  world.addEntity(medic);

  const log = medic.takeTurn(world, new Rng(1));

  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'move-engage');
  assert.ok(medic.x > 3, 'closed toward the patient');
});

test('Medic ignores fragile fodder when a durable patient is available', () => {
  const world = openWorld();
  addPlayer(world);
  const fodder = new Skirmisher({ id: 'drone-0', x: 5, y: 2 });
  fodder.damage(1);
  const patient = new Juggernaut({ id: 'juggernaut-0', x: 6, y: 2, tier: ENEMY_TIER.T3 });
  const medic = new Medic({ id: 'medic-0', x: 7, y: 2, maxAp: 2 });
  world.addEntity(fodder);
  world.addEntity(patient);
  world.addEntity(medic);

  const log = medic.takeTurn(world, new Rng(1));

  assert.equal(log[0].type, 'shield');
  assert.equal(log[0].target, patient.id);
  assert.equal(patient.shieldHp, MEDIC_SHIELD_HP);
  assert.equal(fodder.hp, fodder.maxHp - 1, 'fodder is not the priority patient');
});
