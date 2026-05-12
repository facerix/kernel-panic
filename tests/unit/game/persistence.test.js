import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE } from '../../../src/game/Run.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { FACTION } from '../../../src/game/constants.js';

const fakeContract = (overrides = {}) => ({
  seed: 12345,
  objective: OBJECTIVES.REACH_EXIT,
  threatCount: 1,
  label: 'test job',
  ...overrides,
});

function freshCombatRun(seed = 1) {
  const run = new Run({ archetype: 'razor', seed });
  run.enterHub();
  run.enterBriefing(fakeContract());
  run.enterCombat();
  return run;
}

test('snapshot → restore → snapshot is byte-for-byte stable', () => {
  const run = freshCombatRun(0xfeedface);
  const recA = snapshot(run);
  const { run: restoredRun } = restore(recA);
  const recB = snapshot(restoredRun);
  // The id field is generated from Date.now() inside Run; snapshot copies
  // it verbatim, so both records carry the same id (passed through restore).
  assert.deepEqual(recB, recA, 'round-trip should reproduce the source record');
});

test('snapshot/restore round-trips a Tech with a placed turret (M1)', () => {
  const run = new Run({ archetype: 'tech', seed: 0xc0ffee });
  run.enterHub();
  run.enterBriefing(fakeContract());
  run.enterCombat();
  // Deploy the pre-built turret on an adjacent passable tile. The combat
  // mapgen guarantees a passable spawn, so we scan the 8-neighbourhood for
  // the first free floor tile and deploy there.
  const tech = run.player;
  let placed = null;
  for (let dy = -1; dy <= 1 && !placed; dy++) {
    for (let dx = -1; dx <= 1 && !placed; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (tech.canDeploy(run.world, dx, dy).ok) {
        placed = tech.deployTurret(run.world, dx, dy);
      }
    }
  }
  assert.ok(placed, 'should have found at least one legal deploy tile around the Tech');
  assert.equal(tech.turretReady, false);

  // Damage the turret a bit to make the round-trip non-trivial.
  placed.hp = 2;

  const rec = snapshot(run);
  const { run: restoredRun, world: restoredWorld } = restore(rec);
  // Tech's turretReady should survive — both `false` here.
  assert.equal(restoredRun.player.turretReady, false);
  const restoredTurret = [...restoredWorld.entities.values()].find(e => e.id === placed.id);
  assert.ok(restoredTurret, 'restored world should contain the deployed turret');
  assert.equal(restoredTurret.faction, FACTION.PLAYER);
  assert.equal(restoredTurret.hp, 2);
  assert.equal(restoredTurret.ownerId, tech.id);
  // Method (Entity.prototype.damage) survives the round-trip — regression
  // pin for the `this.damage = number` shadowing bug.
  assert.equal(typeof restoredTurret.damage, 'function');
});

test('restored Rng produces the same next 5 numbers as the live one', () => {
  const run = freshCombatRun(7);
  // Take a few rolls so rng.state advances past the seed.
  run.rng.next();
  run.rng.next();
  run.rng.next();
  const liveValues = [];
  // Snapshot first, then pull values from the live rng.
  const rec = snapshot(run);
  for (let i = 0; i < 5; i++) liveValues.push(run.rng.next());

  const { rng: restoredRng } = restore(rec);
  const restoredValues = [];
  for (let i = 0; i < 5; i++) restoredValues.push(restoredRng.next());
  assert.deepEqual(restoredValues, liveValues);
});

test('restore reconstructs world entities with their HP / AP / stealth state', () => {
  const run = freshCombatRun(42);
  // Bash the player's hp + ap to non-default values; flip stealth.
  run.player.hp = 1;
  run.player.ap = 2;
  run.player.stealthed = true;
  const rec = snapshot(run);
  const { player } = restore(rec);
  assert.equal(player.hp, 1);
  assert.equal(player.ap, 2);
  assert.equal(player.stealthed, true);
});

test('restore preserves drone AI state (mode + lastKnownTarget + patrol index)', () => {
  const run = freshCombatRun(0xdead);
  const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone, 'expected at least one drone for threatCount=1');
  drone.state = 'investigate';
  drone.lastKnownTarget = { x: 5, y: 7 };
  drone.patrolIndex = 1;
  const rec = snapshot(run);
  const { world: restoredWorld } = restore(rec);
  const restoredDrone = [...restoredWorld.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.equal(restoredDrone.state, 'investigate');
  assert.deepEqual(restoredDrone.lastKnownTarget, { x: 5, y: 7 });
  assert.equal(restoredDrone.patrolIndex, 1);
});

test('restore preserves turnNumber and currentFaction', () => {
  const run = freshCombatRun(11);
  run.queue.endTurn(run.world);
  run.queue.endTurn(run.world);
  const rec = snapshot(run);
  const { queue } = restore(rec);
  assert.equal(queue.turnNumber, run.queue.turnNumber);
  assert.equal(queue.currentFaction, run.queue.currentFaction);
});

test('restore throws on missing rng', () => {
  const run = freshCombatRun(1);
  const rec = snapshot(run);
  delete rec.rng;
  assert.throws(() => restore(rec), /rng/);
});

test('restore throws on grid tile-count mismatch', () => {
  const run = freshCombatRun(1);
  const rec = snapshot(run);
  rec.grid.tiles.pop();
  assert.throws(() => restore(rec), /tile count mismatch/);
});

test('restore throws on out-of-bounds entity', () => {
  const run = freshCombatRun(1);
  const rec = snapshot(run);
  rec.entities[0].x = rec.grid.w + 5;
  assert.throws(() => restore(rec), /out of bounds/);
});

test('restore throws on unknown archetype', () => {
  const run = freshCombatRun(1);
  const rec = snapshot(run);
  rec.entities[0].archetype = 'wizard';
  assert.throws(() => restore(rec), /unknown archetype/);
});

test('restore throws on hp > maxHp (corruption guard)', () => {
  const run = freshCombatRun(1);
  const rec = snapshot(run);
  rec.entities[0].hp = rec.entities[0].maxHp + 1;
  assert.throws(() => restore(rec), /hp/);
});

test('restore throws on alive=true with hp=0 (semantic mismatch)', () => {
  const run = freshCombatRun(1);
  const rec = snapshot(run);
  rec.entities[0].hp = 0;
  rec.entities[0].alive = true;
  assert.throws(() => restore(rec));
});

test('restore throws on unknown run state', () => {
  const run = freshCombatRun(1);
  const rec = snapshot(run);
  rec.state = 'WIBBLE';
  assert.throws(() => restore(rec), /unknown run state/);
});

test('restore throws on record.type !== "run"', () => {
  const run = freshCombatRun(1);
  const rec = snapshot(run);
  rec.type = 'other';
  assert.throws(() => restore(rec), /type/);
});

test('snapshot in HUB state captures Curator + Terminal + player', () => {
  const run = new Run({ archetype: 'merc', seed: 1 });
  run.enterHub();
  const rec = snapshot(run);
  assert.equal(rec.state, RUN_STATE.HUB);
  const archetypes = rec.entities.map(e => e.archetype).sort();
  assert.deepEqual(archetypes, ['curator', 'merc', 'terminal']);
});

test('snapshot before any state set throws', () => {
  const run = new Run({ archetype: 'razor', seed: 1 });
  assert.throws(() => snapshot(run), /no live world/);
});

test('snapshot without a Run instance throws TypeError', () => {
  assert.throws(() => snapshot({}), TypeError);
  assert.throws(() => snapshot(null), TypeError);
});
