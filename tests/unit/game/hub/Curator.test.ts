import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../../../../src/rng.js';
import {
  CONTRACT_DIFFICULTY,
  FACTION,
  SALVAGE_TO_CRED_RATE,
  TILE,
} from '../../../../src/game/constants.js';
import {
  Curator,
  assertLabelObjectiveRegistryInSync,
  isObjective,
} from '../../../../src/game/hub/Curator.js';
import { buildHub } from '../../../../src/game/hub/SafeSpace.js';

test('Curator constructs with NEUTRAL faction and zero AP', () => {
  const c = new Curator({ x: 2, y: 3 });
  assert.equal(c.faction, FACTION.NEUTRAL);
  assert.equal(c.maxAp, 0);
  assert.equal(c.glyph, 'C');
  assert.equal(c.x, 2);
  assert.equal(c.y, 3);
  assert.equal(c.alive, true);
});

test('generateContract is deterministic for the same Rng state', () => {
  const a = new Curator().generateContract(new Rng(123));
  const b = new Curator().generateContract(new Rng(123));
  assert.deepEqual(a, b);
});

test('generateContracts returns a deterministic board of 3 tiered contracts', () => {
  const a = new Curator().generateContracts(new Rng(123));
  const b = new Curator().generateContracts(new Rng(123));
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  for (const contract of a) {
    assert.ok(isObjective(contract.objective), `unknown objective ${contract.objective}`);
    assert.ok(
      Object.values(CONTRACT_DIFFICULTY).includes(contract.difficulty),
      `unknown difficulty ${contract.difficulty}`
    );
    assert.ok(contract.threatCount >= 2);
    assert.ok(Number.isInteger(contract.reward.credits) && contract.reward.credits >= 0);
    assert.ok(Number.isInteger(contract.reward.repDelta));
  }
});

test('contract objective is in the known set and threatCount > 0', () => {
  const contract = new Curator().generateContract(new Rng(0xdeadbeef));
  assert.ok(isObjective(contract.objective), `unknown objective ${contract.objective}`);
  assert.ok(typeof contract.objective.title === 'string' && contract.objective.title.length > 0);
  assert.ok(
    typeof contract.objective.briefing === 'string' && contract.objective.briefing.length > 0
  );
  assert.ok(Object.values(CONTRACT_DIFFICULTY).includes(contract.difficulty));
  assert.ok(contract.threatCount > 0);
  assert.ok(typeof contract.label === 'string' && contract.label.length > 0);
  assert.ok(Number.isInteger(contract.seed) && contract.seed >= 0);
  assert.ok(Number.isInteger(contract.reward.credits));
  assert.ok(Number.isInteger(contract.reward.repDelta));
});

test('contract label pool matches objective registry', () => {
  assertLabelObjectiveRegistryInSync();
});

test('different Rng states yield different seeds (no constant return)', () => {
  // Pull two contracts from different streams; with five labels + 2³¹ seeds
  // the seeds collision probability is negligible, so two distinct rngs
  // producing identical seeds would be a sign generateContract isn't
  // actually consuming randomness.
  const a = new Curator().generateContract(new Rng(1));
  const b = new Curator().generateContract(new Rng(2));
  assert.notEqual(a.seed, b.seed, 'expected different seeds from different rngs');
});

test('generateContract throws on missing rng', () => {
  assert.throws(() => new Curator().generateContract(null), /requires an Rng/);
});

test('better-contracts shifts the board toward elevated/critical tiers and raises Cred floors', () => {
  const normalCounts = { elevatedOrCritical: 0, credits: 0 };
  const betterCounts = { elevatedOrCritical: 0, credits: 0 };
  for (let seed = 0; seed < 200; seed++) {
    for (const contract of new Curator().generateContracts(new Rng(seed), { meta: {} })) {
      if (contract.difficulty !== CONTRACT_DIFFICULTY.STANDARD) normalCounts.elevatedOrCritical++;
      normalCounts.credits += contract.reward.credits;
    }
    for (const contract of new Curator().generateContracts(new Rng(seed), {
      meta: { betterContracts: true },
    })) {
      if (contract.difficulty !== CONTRACT_DIFFICULTY.STANDARD) betterCounts.elevatedOrCritical++;
      betterCounts.credits += contract.reward.credits;
      assert.ok(
        contract.reward.credits >= 20 + 2 * SALVAGE_TO_CRED_RATE,
        'better-contracts should raise reward floors by 20 Cr'
      );
    }
  }
  assert.ok(
    betterCounts.elevatedOrCritical > normalCounts.elevatedOrCritical,
    'better-contracts should offer more elevated/critical jobs'
  );
  assert.ok(
    betterCounts.credits > normalCounts.credits,
    'better-contracts should improve aggregate Cred rewards'
  );
});

test('Curator is immobile — refreshAp keeps ap at 0', () => {
  const c = new Curator();
  c.refreshAp();
  assert.equal(c.ap, 0);
  assert.equal(c.canAfford(1), false);
});

test('buildHub places spawn and curator on FLOOR; exit on TILE.EXIT', () => {
  const hub = buildHub();
  assert.equal(hub.grid.isPassable(hub.playerSpawn.x, hub.playerSpawn.y), true);
  assert.equal(hub.grid.isPassable(hub.curatorSpawn.x, hub.curatorSpawn.y), true);
  assert.equal(hub.grid.isPassable(hub.exitTile.x, hub.exitTile.y), true);
  assert.equal(hub.grid.tileAt(hub.exitTile.x, hub.exitTile.y), TILE.EXIT);
});

test('buildHub returns a stable layout (idempotent)', () => {
  const a = buildHub();
  const b = buildHub();
  assert.deepEqual(Array.from(a.grid.tiles), Array.from(b.grid.tiles));
  assert.deepEqual(a.playerSpawn, b.playerSpawn);
  assert.deepEqual(a.curatorSpawn, b.curatorSpawn);
  assert.deepEqual(a.exitTile, b.exitTile);
  assert.deepEqual(a.terminalSpawn, b.terminalSpawn);
});

test('buildHub returns a terminalSpawn distinct from other interactables', () => {
  const hub = buildHub();
  assert.ok(hub.terminalSpawn, 'expected terminalSpawn in buildHub() result');
  assert.equal(typeof hub.terminalSpawn.x, 'number');
  assert.equal(typeof hub.terminalSpawn.y, 'number');
  // Terminal must occupy a walkable tile so the player can stand adjacent.
  assert.equal(hub.grid.isPassable(hub.terminalSpawn.x, hub.terminalSpawn.y), true);
  // …and must not collide with the player spawn, Curator, or door.
  const same = (a, b) => a.x === b.x && a.y === b.y;
  assert.ok(!same(hub.terminalSpawn, hub.playerSpawn), 'terminal overlaps player spawn');
  assert.ok(!same(hub.terminalSpawn, hub.curatorSpawn), 'terminal overlaps curator');
  assert.ok(!same(hub.terminalSpawn, hub.exitTile), 'terminal overlaps exit tile');
});
