/**
 * M6.2: KeyCard entity, Campaign.keyItems, decoupled terminal placement,
 * 50/50 unlock method roll, Door keycard interaction, and persistence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { Entity } from '../../../src/game/Entity.js';
import { Campaign, SITE_ROSTER_CAP } from '../../../src/game/Campaign.js';
import { OUTCOME, Run } from '../../../src/game/Run.js';
import { generateSiteId, siteIdForContract } from '../../../src/game/locations.js';
import { emptySalvage } from '../../../src/game/salvage.js';
import { Door } from '../../../src/game/entities/Door.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { Pickup } from '../../../src/game/entities/Pickup.js';
import { KeyCard, keycardIdFor, migrateLegacyKeycardId } from '../../../src/game/entities/KeyCard.js';
import { findPath } from '../../../src/game/Pathfinding.js';
import {
  snapshot,
  restore,
  snapshotCampaign,
  restoreCampaign,
} from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { applyIntent } from '../../../src/input/applyIntent.js';
import {
  DOOR_OPEN_GLYPH,
  FACTION,
  TILE,
  KEYCARD_GLYPH,
  AP_COST,
} from '../../../src/game/constants.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { Rng } from '../../../src/rng.js';
import { TurnQueue } from '../../../src/game/TurnQueue.js';
import { testContractContext } from './contractTestUtils.js';
import type { KeyItem, LocationSite } from '../../../src/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function corridorWorld() {
  // 7-wide corridor: walls on top/bottom, floor tiles 1..5
  const grid = new Grid(7, 3);
  for (let x = 0; x < 7; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, 2, TILE.WALL);
  }
  return new World(grid);
}

function makePlayer(x = 1, y = 1) {
  return new Entity({ id: 'crew-test', x, y, faction: FACTION.PLAYER, glyph: '@' });
}

function makeCrew() {
  return buildCrewMember('razor', { x: 0, y: 0 }, new Rng(100), { id: 'crew-razor' });
}

function fakeContract(overrides = {}) {
  return {
    seed: 12345,
    objective: {
      kind: OBJECTIVES.REACH_EXIT,
      title: 'Extract clean',
      briefing: 'Reach the exit.',
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'test job',
    context: testContractContext(OBJECTIVES.REACH_EXIT),
    reward: { credits: 0, repDelta: 0 },
    ...overrides,
  };
}

function keycardDoorContract(seed: number, overrides = {}) {
  return fakeContract({
    seed,
    objective: {
      kind: OBJECTIVES.RETRIEVE,
      title: 'Secure locked cache',
      briefing: 'Find the keycard and retrieve the cache.',
      params: { target: 'locked-cache', doorId: 'door-0', unlockMethod: 'keycard', ...overrides },
    },
    label: 'keycard test job',
    context: testContractContext(OBJECTIVES.RETRIEVE),
  });
}

function terminalDoorContract(seed: number) {
  return fakeContract({
    seed,
    objective: {
      kind: OBJECTIVES.RETRIEVE,
      title: 'Secure locked cache',
      briefing: 'Hack the terminal and retrieve the cache.',
      params: { target: 'locked-cache', doorId: 'door-0', unlockMethod: 'terminal' },
    },
    label: 'terminal test job',
    context: testContractContext(OBJECTIVES.RETRIEVE),
  });
}

function makeCampaign(overrides = {}) {
  return new Campaign({
    seed: 42,
    onPersist: () => {},
    ...overrides,
  });
}

// ─── KeyCard entity ──────────────────────────────────────────────────────────

test('KeyCard: constructs as a passable neutral entity with the keycard glyph', () => {
  const kc = new KeyCard({ id: 'kc-1', x: 3, y: 1, doorId: 'door-0', label: 'Access keycard' });
  assert.equal(kc.glyph, KEYCARD_GLYPH);
  assert.equal(kc.faction, FACTION.NEUTRAL);
  assert.equal(kc.passable, true);
  assert.equal(kc.doorId, 'door-0');
  assert.equal(kc.label, 'Access keycard');
  assert.equal(kc.maxAp, 0);
  assert.equal(kc.maxHp, 1);
  assert.equal(kc.siteId, null, 'siteId defaults to null (run-scoped)');
});

test('KeyCard: siteId marks a campaign-scoped keycard', () => {
  const kc = new KeyCard({
    id: 'kc-1',
    x: 3,
    y: 1,
    doorId: 'door-0',
    label: 'Site card',
    siteId: 'site-42',
  });
  assert.equal(kc.siteId, 'site-42');
});

test('KeyCard: throws on empty siteId', () => {
  assert.throws(
    () => new KeyCard({ id: 'kc-1', x: 3, y: 1, doorId: 'door-0', label: 'test', siteId: '' }),
    /non-empty string/
  );
});

test('KeyCard: throws on empty doorId', () => {
  assert.throws(
    () => new KeyCard({ id: 'kc-1', x: 3, y: 1, doorId: '', label: 'test' }),
    /non-empty doorId/
  );
});

test('KeyCard: throws on empty label', () => {
  assert.throws(
    () => new KeyCard({ id: 'kc-1', x: 3, y: 1, doorId: 'door-0', label: '' }),
    /non-empty label/
  );
});

test('KeyCard: World.keycardAt returns the keycard on its tile', () => {
  const world = corridorWorld();
  const kc = new KeyCard({ id: 'kc-1', x: 3, y: 1, doorId: 'door-0', label: 'Access keycard' });
  world.addEntity(kc);
  assert.equal(world.keycardAt(3, 1), kc);
  assert.equal(world.keycardAt(4, 1), null);
});

test('KeyCard: keycardAt ignores dead keycards', () => {
  const world = corridorWorld();
  const kc = new KeyCard({ id: 'kc-1', x: 3, y: 1, doorId: 'door-0', label: 'Access keycard' });
  world.addEntity(kc);
  kc.alive = false;
  assert.equal(world.keycardAt(3, 1), null);
});

test('KeyCard: entityAt skips passable keycards (does not block movement)', () => {
  const world = corridorWorld();
  const kc = new KeyCard({ id: 'kc-1', x: 3, y: 1, doorId: 'door-0', label: 'Access keycard' });
  world.addEntity(kc);
  assert.equal(world.entityAt(3, 1), null, 'passable entity should not block tile');
});

// ─── Campaign.keyItems ───────────────────────────────────────────────────────

test('Campaign.keyItems: defaults to empty array', () => {
  const c = makeCampaign();
  assert.deepEqual(c.keyItems, []);
});

test('Campaign.addKeyItem: adds a key item and persists', () => {
  let persisted = false;
  const c = makeCampaign({
    onPersist: () => {
      persisted = true;
    },
  });
  c.addKeyItem({ id: 'kc-1', label: 'Access keycard', doorId: 'door-0' });
  assert.equal(c.keyItems.length, 1);
  assert.equal(c.keyItems[0]!.id, 'kc-1');
  assert.equal(c.keyItems[0]!.doorId, 'door-0');
  assert.ok(persisted, 'should persist after addKeyItem');
});

test('Campaign.addKeyItem: throws on duplicate id', () => {
  const c = makeCampaign();
  c.addKeyItem({ id: 'kc-1', label: 'Card A', doorId: 'door-0' });
  assert.throws(() => c.addKeyItem({ id: 'kc-1', label: 'Card B', doorId: 'door-1' }), /duplicate/);
});

test('Campaign.addKeyItem: throws on missing fields', () => {
  const c = makeCampaign();
  assert.throws(() => c.addKeyItem({ id: '', label: 'test', doorId: 'door-0' }), /non-empty/);
  assert.throws(() => c.addKeyItem({ id: 'kc-1', label: '', doorId: 'door-0' }), /non-empty/);
  assert.throws(() => c.addKeyItem({ id: 'kc-1', label: 'test', doorId: '' }), /non-empty/);
});

test('Campaign.keyItems: preserves optional siteId', () => {
  const c = makeCampaign();
  c.addKeyItem({ id: 'kc-1', label: 'Card A', doorId: 'door-0', siteId: 'site-42' });
  assert.equal(c.keyItems[0]!.siteId, 'site-42');
});

// ─── Campaign.keyItems persistence ───────────────────────────────────────────

test('Campaign.keyItems snapshot round-trip', () => {
  const c = makeCampaign();
  c.addKeyItem({ id: 'kc-1', label: 'Card A', doorId: 'door-0' });
  c.addKeyItem({ id: 'kc-2', label: 'Card B', doorId: 'door-1', siteId: 'site-1' });
  const snap = snapshotCampaign(c);
  assert.ok(snap.keyItems);
  assert.equal(snap.keyItems!.length, 2);
  assert.equal(snap.keyItems![0]!.doorId, 'door-0');
  assert.equal(snap.keyItems![1]!.siteId, 'site-1');

  const restored = restoreCampaign(snap);
  assert.equal(restored.keyItems.length, 2);
  assert.equal(restored.keyItems[0]!.id, 'kc-1');
  assert.equal(restored.keyItems[0]!.doorId, 'door-0');
  assert.equal(restored.keyItems[1]!.siteId, 'site-1');
});

test('Campaign.keyItems: pre-M6.2 saves default to empty array', () => {
  const c = makeCampaign();
  const snap = snapshotCampaign(c);
  delete (snap as Record<string, unknown>).keyItems;
  const restored = restoreCampaign(snap);
  assert.deepEqual(restored.keyItems, []);
});

// ─── Run.keyItems (run-scoped keys) ─────────────────────────────────────────

test('Run.keyItems: defaults to empty array', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 99 });
  assert.deepEqual(run.keyItems, []);
});

test('Run.addKeyItem: adds a run-scoped key item', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 99 });
  run.addKeyItem({ id: 'kc-1', label: 'Access card', doorId: 'door-0' });
  assert.equal(run.keyItems.length, 1);
  assert.equal(run.keyItems[0]!.id, 'kc-1');
  assert.equal(run.keyItems[0]!.doorId, 'door-0');
});

test('Run.addKeyItem: throws on duplicate id', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 99 });
  run.addKeyItem({ id: 'kc-1', label: 'Card A', doorId: 'door-0' });
  assert.throws(
    () => run.addKeyItem({ id: 'kc-1', label: 'Card B', doorId: 'door-1' }),
    /duplicate/
  );
});

test('Run.addKeyItem: throws on missing fields', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 99 });
  assert.throws(() => run.addKeyItem({ id: '', label: 'test', doorId: 'door-0' }), /non-empty/);
  assert.throws(() => run.addKeyItem({ id: 'kc-1', label: '', doorId: 'door-0' }), /non-empty/);
  assert.throws(() => run.addKeyItem({ id: 'kc-1', label: 'test', doorId: '' }), /non-empty/);
});

test('Run.keyItems snapshot round-trip', () => {
  const crew = makeCrew();
  const run = new Run({ crewMember: crew, seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  run.addKeyItem({ id: 'kc-run-1', label: 'Run card', doorId: 'door-0' });

  const rec = snapshot(run);
  assert.ok(rec.keyItems);
  assert.equal(rec.keyItems!.length, 1);
  assert.equal(rec.keyItems![0]!.id, 'kc-run-1');
  assert.equal(rec.keyItems![0]!.doorId, 'door-0');

  const { run: restoredRun } = restore(rec);
  assert.equal(restoredRun.keyItems.length, 1);
  assert.equal(restoredRun.keyItems[0]!.id, 'kc-run-1');
  assert.equal(restoredRun.keyItems[0]!.doorId, 'door-0');
});

test('Run.keyItems: pre-M6.2 saves default to empty array', () => {
  const crew = makeCrew();
  const run = new Run({ crewMember: crew, seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  const rec = snapshot(run);
  delete (rec as Record<string, unknown>).keyItems;
  const { run: restoredRun } = restore(rec);
  assert.deepEqual(restoredRun.keyItems, []);
});

// ─── onKeycardCollected scope routing ───────────────────────────────────────

test('onKeycardCollected: run-scoped keycard (no siteId) passes siteId: null', () => {
  const world = corridorWorld();
  const crew = makeCrew();
  crew.x = 2;
  crew.y = 1;
  crew.ap = 4;
  world.addEntity(crew);
  const kc = new KeyCard({ id: 'kc-1', x: 3, y: 1, doorId: 'door-0', label: 'Run card' });
  world.addEntity(kc);
  const queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);

  let collected: { id: string; doorId: string; label: string; siteId: string | null } | null = null;
  applyIntent(
    { type: 'move', dx: 1, dy: 0 },
    {
      world,
      player: crew,
      queue,
      rng: new Rng(42),
      log: () => {},
      advanceTurn: () => {},
      resetInputModes: () => {},
      onPlayerAction: () => {},
      onKeycardCollected: kc => {
        collected = kc;
      },
    }
  );

  assert.ok(collected);
  assert.equal(collected!.siteId, null, 'run-scoped keycard should have siteId: null');
});

test('onKeycardCollected: campaign-scoped keycard (with siteId) passes siteId through', () => {
  const world = corridorWorld();
  const crew = makeCrew();
  crew.x = 2;
  crew.y = 1;
  crew.ap = 4;
  world.addEntity(crew);
  const kc = new KeyCard({
    id: 'kc-1',
    x: 3,
    y: 1,
    doorId: 'door-0',
    label: 'Site card',
    siteId: 'site-42',
  });
  world.addEntity(kc);
  const queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);

  let collected: { id: string; doorId: string; label: string; siteId: string | null } | null = null;
  applyIntent(
    { type: 'move', dx: 1, dy: 0 },
    {
      world,
      player: crew,
      queue,
      rng: new Rng(42),
      log: () => {},
      advanceTurn: () => {},
      resetInputModes: () => {},
      onPlayerAction: () => {},
      onKeycardCollected: kc => {
        collected = kc;
      },
    }
  );

  assert.ok(collected);
  assert.equal(collected!.siteId, 'site-42', 'campaign-scoped keycard should pass siteId');
});

// ─── Door + keycard interaction ──────────────────────────────────────────────

test('Door.interact with matching keycard unlocks the door', () => {
  const world = corridorWorld();
  const door = new Door({ id: 'door-1', doorId: 'door-0', x: 3, y: 1, locked: true });
  world.addEntity(door);
  const player = makePlayer(2, 1);
  world.addEntity(player);
  player.ap = 4;

  const keyItems: KeyItem[] = [{ id: 'kc-1', label: 'Test Card', doorId: 'door-0' }];
  const result = door.interact(world, player, keyItems);
  assert.equal(result.ok, true);
  assert.equal(door.locked, false);
  assert.equal(door.passable, true);
  assert.equal(door.glyph, DOOR_OPEN_GLYPH);
  assert.equal(player.ap, 4 - AP_COST.INTERACT);
  assert.ok(result.message.includes('Test Card'));
});

test('Door.interact without matching keycard remains locked', () => {
  const world = corridorWorld();
  const door = new Door({ id: 'door-1', doorId: 'door-0', x: 3, y: 1, locked: true });
  world.addEntity(door);
  const player = makePlayer(2, 1);
  world.addEntity(player);
  player.ap = 4;

  const keyItems: KeyItem[] = [{ id: 'kc-1', label: 'Wrong Card', doorId: 'door-999' }];
  const result = door.interact(world, player, keyItems);
  assert.equal(result.ok, false);
  assert.equal(door.locked, true);
  assert.equal(player.ap, 4, 'AP should not be spent');
});

test('Door.interact with no keyItems falls back to locked message', () => {
  const world = corridorWorld();
  const door = new Door({ id: 'door-1', doorId: 'door-0', x: 3, y: 1, locked: true });
  world.addEntity(door);
  const player = makePlayer(2, 1);
  world.addEntity(player);
  player.ap = 4;

  const result = door.interact(world, player);
  assert.equal(result.ok, false);
  assert.equal(door.locked, true);
  assert.ok(result.message.includes('locked'));
});

test('Door.interact with keycard on already-open door returns open message', () => {
  const world = corridorWorld();
  const door = new Door({ id: 'door-1', doorId: 'door-0', x: 3, y: 1, locked: false });
  world.addEntity(door);
  const player = makePlayer(2, 1);
  world.addEntity(player);

  const keyItems: KeyItem[] = [{ id: 'kc-1', label: 'Card', doorId: 'door-0' }];
  const result = door.interact(world, player, keyItems);
  assert.equal(result.ok, false);
  assert.ok(result.message.includes('open'));
});

test('Door.interact with keycard but insufficient AP fails', () => {
  const world = corridorWorld();
  const door = new Door({ id: 'door-1', doorId: 'door-0', x: 3, y: 1, locked: true });
  world.addEntity(door);
  const player = makePlayer(2, 1);
  world.addEntity(player);
  player.ap = 0;

  const keyItems: KeyItem[] = [{ id: 'kc-1', label: 'Card', doorId: 'door-0' }];
  const result = door.interact(world, player, keyItems);
  assert.equal(result.ok, false);
  assert.equal(door.locked, true);
});

test('Door.interact with keycard — keycard stays in inventory (not consumed)', () => {
  const world = corridorWorld();
  const door = new Door({ id: 'door-1', doorId: 'door-0', x: 3, y: 1, locked: true });
  world.addEntity(door);
  const player = makePlayer(2, 1);
  world.addEntity(player);
  player.ap = 4;

  const keyItems: KeyItem[] = [{ id: 'kc-1', label: 'Card', doorId: 'door-0' }];
  door.interact(world, player, keyItems);
  assert.equal(keyItems.length, 1, 'keycard should remain in inventory');
  assert.equal(keyItems[0]!.id, 'kc-1');
});

// ─── KeyCard walk-onto collection via applyIntent ────────────────────────────

test('collectTileLoot picks up keycard and invokes onKeycardCollected', () => {
  const world = corridorWorld();
  const crew = makeCrew();
  crew.x = 2;
  crew.y = 1;
  crew.ap = 4;
  world.addEntity(crew);
  const kc = new KeyCard({ id: 'kc-1', x: 3, y: 1, doorId: 'door-0', label: 'Access keycard' });
  world.addEntity(kc);
  const queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);

  let collected: { id: string; doorId: string; label: string } | null = null;
  const log: string[] = [];
  applyIntent(
    { type: 'move', dx: 1, dy: 0 },
    {
      world,
      player: crew,
      queue,
      rng: new Rng(42),
      log: (line: string) => log.push(line),
      advanceTurn: () => {},
      resetInputModes: () => {},
      onPlayerAction: () => {},
      onKeycardCollected: kc => {
        collected = kc;
      },
    }
  );

  assert.ok(collected, 'onKeycardCollected should fire');
  assert.equal(collected!.id, 'kc-1');
  assert.equal(collected!.doorId, 'door-0');
  assert.equal(world.keycardAt(3, 1), null, 'keycard removed from world');
  assert.ok(log.some(l => l.includes('Access keycard')));
});

test('collectTileLoot: duplicate campaign keycard pickup does not throw', () => {
  const world = corridorWorld();
  const crew = makeCrew();
  crew.x = 2;
  crew.y = 1;
  crew.ap = 4;
  world.addEntity(crew);
  const kc = new KeyCard({
    id: 'keycard-door-0',
    x: 3,
    y: 1,
    doorId: 'door-0',
    label: 'Access keycard',
    siteId: 'site-42',
  });
  world.addEntity(kc);
  const queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
  const campaign = makeCampaign();
  campaign.addKeyItem({
    id: 'keycard-door-0',
    label: 'Access keycard',
    doorId: 'door-0',
    siteId: 'site-42',
  });

  applyIntent(
    { type: 'move', dx: 1, dy: 0 },
    {
      world,
      player: crew,
      queue,
      rng: new Rng(42),
      log: () => {},
      advanceTurn: () => {},
      resetInputModes: () => {},
      onPlayerAction: () => {},
      onKeycardCollected: collected => {
        if (collected.siteId && campaign.keyItems.some(k => k.id === collected.id)) {
          return;
        }
        campaign.addKeyItem({
          id: collected.id,
          label: collected.label,
          doorId: collected.doorId,
          siteId: collected.siteId!,
        });
      },
    }
  );

  assert.equal(campaign.keyItems.length, 1, 'inventory unchanged when keycard already held');
  assert.equal(world.keycardAt(3, 1), null, 'pickup still removed from world');
});

// ─── KeyCard entity snapshot round-trip ──────────────────────────────────────

test('KeyCard snapshot round-trips through Run snapshot/restore', () => {
  const crew = makeCrew();
  const run = new Run({ crewMember: crew, seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();

  // Find an unoccupied passable tile for the keycard.
  let anchor = null;
  for (let y = 1; y < run.world!.grid.height - 1 && !anchor; y++) {
    for (let x = 1; x < run.world!.grid.width - 1 && !anchor; x++) {
      if (!run.world!.grid.isPassable(x, y)) continue;
      if (run.world!.liveEntityAt(x, y)) continue;
      anchor = { x, y };
    }
  }
  assert.ok(anchor);
  run.world!.addEntity(
    new KeyCard({
      id: 'keycard-test',
      x: anchor.x,
      y: anchor.y,
      doorId: 'door-0',
      label: 'Test card',
    })
  );

  const rec = snapshot(run);
  const kcRec = rec.entities.find(e => e.archetype === 'keycard');
  assert.ok(kcRec);
  assert.equal(kcRec!.extra?.doorId, 'door-0');
  assert.equal(kcRec!.extra?.label, 'Test card');

  const { world } = restore(rec);
  const restoredKc = [...world.entities.values()].find(e => e instanceof KeyCard);
  assert.ok(restoredKc instanceof KeyCard);
  assert.equal(restoredKc.doorId, 'door-0');
  assert.equal(restoredKc.label, 'Test card');
  assert.equal(restoredKc.glyph, KEYCARD_GLYPH);
  assert.equal(restoredKc.passable, true);
});

test('KeyCard entity snapshot preserves siteId through round-trip', () => {
  const crew = makeCrew();
  const run = new Run({ crewMember: crew, seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();

  let anchor = null;
  for (let y = 1; y < run.world!.grid.height - 1 && !anchor; y++) {
    for (let x = 1; x < run.world!.grid.width - 1 && !anchor; x++) {
      if (!run.world!.grid.isPassable(x, y)) continue;
      if (run.world!.liveEntityAt(x, y)) continue;
      anchor = { x, y };
    }
  }
  assert.ok(anchor);
  run.world!.addEntity(
    new KeyCard({
      id: 'keycard-site',
      x: anchor.x,
      y: anchor.y,
      doorId: 'door-0',
      label: 'Site card',
      siteId: 'site-42',
    })
  );

  const rec = snapshot(run);
  const kcRec = rec.entities.find(e => e.archetype === 'keycard');
  assert.ok(kcRec);
  assert.equal(kcRec!.extra?.siteId, 'site-42');

  const { world } = restore(rec);
  const restoredKc = [...world.entities.values()].find(e => e instanceof KeyCard) as KeyCard;
  assert.ok(restoredKc);
  assert.equal(restoredKc.siteId, 'site-42');
});

test('KeyCard entity snapshot stores siteId as null when unset', () => {
  const crew = makeCrew();
  const run = new Run({ crewMember: crew, seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();

  let anchor = null;
  for (let y = 1; y < run.world!.grid.height - 1 && !anchor; y++) {
    for (let x = 1; x < run.world!.grid.width - 1 && !anchor; x++) {
      if (!run.world!.grid.isPassable(x, y)) continue;
      if (run.world!.liveEntityAt(x, y)) continue;
      anchor = { x, y };
    }
  }
  assert.ok(anchor);
  run.world!.addEntity(
    new KeyCard({
      id: 'keycard-nositeId',
      x: anchor.x,
      y: anchor.y,
      doorId: 'door-0',
      label: 'Run card',
    })
  );

  const rec = snapshot(run);
  const kcRec = rec.entities.find(e => e.archetype === 'keycard');
  assert.ok(kcRec);
  assert.equal(
    kcRec!.extra?.siteId,
    null,
    'siteId is bag-hygienic null (not undefined) when unset'
  );
});

// ─── Unlock method roll ──────────────────────────────────────────────────────

test('50/50 unlock method roll is deterministic per seed and produces both outcomes', () => {
  const terminalSeeds: number[] = [];
  const keycardSeeds: number[] = [];
  for (let seed = 1; seed <= 100; seed++) {
    let run = null;
    try {
      const candidate = new Run({ crewMember: makeCrew(), seed });
      candidate.enterBriefing(
        fakeContract({
          seed,
          objective: {
            kind: OBJECTIVES.RETRIEVE,
            title: 'Locked cache',
            briefing: 'test',
            params: { target: 'cache', doorId: 'door-0' },
          },
          label: `test-${seed}`,
          context: testContractContext(OBJECTIVES.RETRIEVE),
        })
      );
      candidate.enterCombat();
      run = candidate;
    } catch {
      continue;
    }
    const hasTerminal = [...run.world!.entities.values()].some(
      e => e instanceof Terminal && (e as Terminal).unlocksId === 'door-0'
    );
    const hasKeycard = [...run.world!.entities.values()].some(e => e instanceof KeyCard);
    if (hasTerminal) terminalSeeds.push(seed);
    if (hasKeycard) keycardSeeds.push(seed);
  }
  assert.ok(
    terminalSeeds.length > 0,
    `expected at least one terminal-unlock seed, got ${terminalSeeds.length}`
  );
  assert.ok(
    keycardSeeds.length > 0,
    `expected at least one keycard-unlock seed, got ${keycardSeeds.length}`
  );
});

test('explicit unlockMethod: terminal always places a terminal', () => {
  let run = null;
  for (let seed = 1; seed < 80 && !run; seed++) {
    const candidate = new Run({ crewMember: makeCrew(), seed });
    candidate.enterBriefing(terminalDoorContract(seed));
    try {
      candidate.enterCombat();
      run = candidate;
    } catch {
      continue;
    }
  }
  assert.ok(run, 'need at least one seed for a door-linked layout');
  const terminal = [...run.world!.entities.values()].find(
    e => e instanceof Terminal && (e as Terminal).unlocksId === 'door-0'
  );
  assert.ok(terminal instanceof Terminal);
  const keycard = [...run.world!.entities.values()].find(e => e instanceof KeyCard);
  assert.equal(keycard, undefined, 'no keycard when unlockMethod is terminal');
});

test('explicit unlockMethod: keycard always places a keycard', () => {
  let run = null;
  for (let seed = 1; seed < 80 && !run; seed++) {
    const candidate = new Run({ crewMember: makeCrew(), seed });
    candidate.enterBriefing(keycardDoorContract(seed));
    try {
      candidate.enterCombat();
      run = candidate;
    } catch {
      continue;
    }
  }
  assert.ok(run, 'need at least one seed for a door-linked layout');
  const keycard = [...run.world!.entities.values()].find(e => e instanceof KeyCard);
  assert.ok(keycard instanceof KeyCard);
  assert.equal(keycard.doorId, 'door-0');
  const unlockTerminal = [...run.world!.entities.values()].find(
    e => e instanceof Terminal && (e as Terminal).unlocksId === 'door-0'
  );
  assert.equal(unlockTerminal, undefined, 'no unlock terminal when unlockMethod is keycard');
});

// ─── Decoupled terminal placement ────────────────────────────────────────────

test('decoupled terminal placement is reachable from spawn (not through locked door)', () => {
  let run = null;
  for (let seed = 1; seed < 80 && !run; seed++) {
    const candidate = new Run({ crewMember: makeCrew(), seed });
    candidate.enterBriefing(terminalDoorContract(seed));
    try {
      candidate.enterCombat();
      run = candidate;
    } catch {
      continue;
    }
  }
  assert.ok(run);
  const terminal = [...run.world!.entities.values()].find(
    e => e instanceof Terminal && (e as Terminal).unlocksId === 'door-0'
  );
  assert.ok(terminal instanceof Terminal);
  // Terminal must be reachable from spawn without unlocking the door.
  const path = findPath(
    run.world!,
    { x: run.player!.x, y: run.player!.y },
    { x: terminal.x, y: terminal.y },
    { allowOccupiedGoal: true }
  );
  assert.ok(path, 'terminal must be reachable from spawn with door locked');
});

test('keycard placement is reachable from spawn (not through locked door)', () => {
  let run = null;
  for (let seed = 1; seed < 80 && !run; seed++) {
    const candidate = new Run({ crewMember: makeCrew(), seed });
    candidate.enterBriefing(keycardDoorContract(seed));
    try {
      candidate.enterCombat();
      run = candidate;
    } catch {
      continue;
    }
  }
  assert.ok(run);
  const keycard = [...run.world!.entities.values()].find(e => e instanceof KeyCard);
  assert.ok(keycard instanceof KeyCard);
  const path = findPath(
    run.world!,
    { x: run.player!.x, y: run.player!.y },
    { x: keycard.x, y: keycard.y },
    { allowOccupiedGoal: true }
  );
  assert.ok(path, 'keycard must be reachable from spawn with door locked');
});

// ─── Golden path: keycard unlock → retrieve → extract ────────────────────────

test('golden path: pick up keycard → walk to locked door → door unlocks → retrieve → extract allowed', () => {
  let run = null;
  for (let seed = 1; seed < 80 && !run; seed++) {
    const candidate = new Run({ crewMember: makeCrew(), seed });
    candidate.enterBriefing(keycardDoorContract(seed));
    try {
      candidate.enterCombat();
      run = candidate;
    } catch {
      continue;
    }
  }
  assert.ok(run, 'need at least one seed for a keycard door layout');

  const door = [...run.world!.entities.values()].find(e => e instanceof Door) as Door;
  const keycard = [...run.world!.entities.values()].find(e => e instanceof KeyCard) as KeyCard;
  const pickup = [...run.world!.entities.values()].find(e => e instanceof Pickup) as Pickup;
  assert.ok(door);
  assert.ok(keycard);
  assert.ok(pickup);
  assert.equal(door.locked, true);

  // Simulate: collect keycard
  const keyItems: KeyItem[] = [];
  run.world!.removeEntity(keycard.id);
  keyItems.push({ id: keycard.id, doorId: keycard.doorId, label: keycard.label });

  // Simulate: interact with door using keycard
  run.world!.relocateEntity(run.player!, door.x - 1 >= 1 ? door.x - 1 : door.x + 1, door.y);
  run.player!.ap = 4;
  const result = door.interact(run.world!, run.player!, keyItems);
  assert.equal(result.ok, true, 'door should unlock with keycard');
  assert.equal(door.locked, false);

  // After door unlock, pickup should be reachable.
  const pathToPickup = findPath(
    run.world!,
    { x: run.player!.x, y: run.player!.y },
    { x: pickup.x, y: pickup.y },
    { allowOccupiedGoal: true }
  );
  assert.ok(pathToPickup, 'pickup should be reachable after door unlock');

  // Secure the pickup.
  pickup.secureWalkOnto(run.world!);
  assert.equal(pickup.secured, true);

  // Objective should now be satisfied.
  assert.equal(run.isObjectiveSatisfied(), true);
});

// ─── Keycard persists in campaign after extraction ───────────────────────────

test('keycard persists in campaign inventory across snapshot/restore', () => {
  const campaign = makeCampaign();
  campaign.addKeyItem({ id: 'kc-door-0', label: 'Level 1 keycard', doorId: 'door-0' });
  const snap = snapshotCampaign(campaign);
  const restored = restoreCampaign(snap);
  assert.equal(restored.keyItems.length, 1);
  assert.equal(restored.keyItems[0]!.id, 'kc-door-0');
  assert.equal(restored.keyItems[0]!.doorId, 'door-0');
  assert.equal(restored.keyItems[0]!.label, 'Level 1 keycard');
});

// ─── Door locked message mentions keycard ────────────────────────────────────

test('Door locked message mentions keycard as unlock option', () => {
  const world = corridorWorld();
  const door = new Door({ id: 'door-1', doorId: 'door-0', x: 3, y: 1, locked: true });
  world.addEntity(door);
  const player = makePlayer(2, 1);
  world.addEntity(player);
  player.ap = 4;

  const result = door.interact(world, player);
  assert.ok(result.message.includes('keycard'), 'locked message should mention keycard');
  assert.ok(result.message.includes('terminal'), 'locked message should mention terminal');
});

// ─── Bump-interact with door while holding keycard ───────────────────────────

test('bump into locked door with keycard in ctx.keyItems unlocks via applyIntent', () => {
  const world = corridorWorld();
  const crew = makeCrew();
  crew.x = 2;
  crew.y = 1;
  crew.ap = 4;
  world.addEntity(crew);
  const door = new Door({ id: 'door-1', doorId: 'door-0', x: 3, y: 1, locked: true });
  world.addEntity(door);
  const queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);

  const keyItems: KeyItem[] = [{ id: 'kc-1', label: 'Test Card', doorId: 'door-0' }];
  const log: string[] = [];
  applyIntent(
    { type: 'move', dx: 1, dy: 0 },
    {
      world,
      player: crew,
      queue,
      rng: new Rng(42),
      log: (line: string) => log.push(line),
      advanceTurn: () => {},
      resetInputModes: () => {},
      onPlayerAction: () => {},
      keyItems,
    }
  );

  assert.equal(door.locked, false, 'door should be unlocked after bump with keycard');
  assert.ok(
    log.some(l => l.includes('Test Card')),
    'log should mention the keycard'
  );
});

test('bump into locked door without keycard keeps door locked', () => {
  const world = corridorWorld();
  const crew = makeCrew();
  crew.x = 2;
  crew.y = 1;
  crew.ap = 4;
  world.addEntity(crew);
  const door = new Door({ id: 'door-1', doorId: 'door-0', x: 3, y: 1, locked: true });
  world.addEntity(door);
  const queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);

  const log: string[] = [];
  applyIntent(
    { type: 'move', dx: 1, dy: 0 },
    {
      world,
      player: crew,
      queue,
      rng: new Rng(42),
      log: (line: string) => log.push(line),
      advanceTurn: () => {},
      resetInputModes: () => {},
      onPlayerAction: () => {},
      keyItems: [],
    }
  );

  assert.equal(door.locked, true, 'door should remain locked');
});

// ─── Keycard site-id stamping (P3.1 balance) ─────────────────────────────────

test('spawned keycard is stamped with the contract-derived site id (no explicit locationSiteId)', () => {
  let run = null;
  let contract = null;
  for (let seed = 1; seed < 80 && !run; seed++) {
    const candidate = new Run({ crewMember: makeCrew(), seed });
    const c = keycardDoorContract(seed);
    candidate.enterBriefing(c);
    try {
      candidate.enterCombat();
      run = candidate;
      contract = c;
    } catch {
      continue;
    }
  }
  assert.ok(run, 'need a keycard-door layout');
  // The fresh contract carries no locationSiteId — the keycard should still be
  // stamped with the seed-derived roster id (not left run-scoped/null).
  assert.equal(contract!.context.locationSiteId, undefined);
  const keycard = [...run!.world!.entities.values()].find(e => e instanceof KeyCard) as KeyCard;
  assert.ok(keycard);
  assert.equal(keycard.siteId, siteIdForContract(contract!));
  assert.equal(keycard.siteId, generateSiteId(contract!.seed as number));
});

// ─── Run-scoped keycards carry siteId ────────────────────────────────────────

test('Run.addKeyItem preserves siteId', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 99 });
  run.addKeyItem({ id: 'kc-1', label: 'Site card', doorId: 'door-0', siteId: 'site-7' });
  assert.equal(run.keyItems[0]!.siteId, 'site-7');
});

test('Run.keyItems snapshot round-trip preserves siteId', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  run.addKeyItem({ id: 'kc-site', label: 'Site card', doorId: 'door-0', siteId: 'site-9' });
  const rec = snapshot(run);
  assert.equal(rec.keyItems![0]!.siteId, 'site-9');
  const { run: restored } = restore(rec);
  assert.equal(restored.keyItems[0]!.siteId, 'site-9');
});

// ─── Run-end promotion into campaign inventory ───────────────────────────────

function deployWithRun(campaign: Campaign, contract = fakeContract()) {
  const member = campaign.crew[1]!;
  const run = campaign.deployCrewMember(member.id, contract);
  run.enterCombat();
  return run;
}

test('onJobEnd promotes a site-stamped run keycard into the campaign inventory on live extraction', () => {
  const campaign = makeCampaign();
  const run = deployWithRun(campaign);
  run.addKeyItem({
    id: 'kc-promote',
    label: 'Site card',
    doorId: 'door-0',
    siteId: 'site-promote',
  });
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: emptySalvage() });
  assert.equal(campaign.keyItems.length, 1);
  assert.equal(campaign.keyItems[0]!.id, 'kc-promote');
  assert.equal(campaign.keyItems[0]!.siteId, 'site-promote');
});

test('onJobEnd promotes carried keycards even on an aborted (incomplete) extraction', () => {
  const campaign = makeCampaign();
  const run = deployWithRun(campaign);
  run.addKeyItem({ id: 'kc-abort', label: 'Site card', doorId: 'door-0', siteId: 'site-abort' });
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: emptySalvage(), completed: false });
  assert.equal(campaign.keyItems.length, 1);
  assert.equal(campaign.keyItems[0]!.id, 'kc-abort');
});

test('onJobEnd does NOT promote keycards when the operator flatlines', () => {
  const campaign = makeCampaign();
  const run = deployWithRun(campaign);
  run.addKeyItem({ id: 'kc-dead', label: 'Site card', doorId: 'door-0', siteId: 'site-dead' });
  campaign.onJobEnd({ outcome: OUTCOME.DEATH });
  assert.deepEqual(campaign.keyItems, []);
});

test('onJobEnd does not promote run-scoped keycards lacking a siteId', () => {
  const campaign = makeCampaign();
  const run = deployWithRun(campaign);
  run.addKeyItem({ id: 'kc-runonly', label: 'Run card', doorId: 'door-0' });
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: emptySalvage() });
  assert.deepEqual(campaign.keyItems, []);
});

test('onJobEnd promotion is idempotent against an already-held campaign keycard', () => {
  const campaign = makeCampaign();
  campaign.addKeyItem({ id: 'kc-dup', label: 'Site card', doorId: 'door-0', siteId: 'site-dup' });
  const run = deployWithRun(campaign);
  run.addKeyItem({ id: 'kc-dup', label: 'Site card', doorId: 'door-0', siteId: 'site-dup' });
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, salvage: emptySalvage() });
  assert.equal(campaign.keyItems.length, 1, 'no duplicate, no crash');
});

// ─── Eviction drops the evicted site's keycards ──────────────────────────────

function makeSite(id: string, lastVisitedJob: number): LocationSite {
  return {
    id,
    seed: id,
    mapWidth: 24,
    mapHeight: 16,
    label: `// site ${id}`,
    tier: 'roster',
    scoreTarget: false,
    mutationDeltas: [],
    seenKeys: [],
    lastVisitedJob,
  };
}

// ─── P3.1: site-unique keycard ids (collision fix) ───────────────────────────

test('keycardIdFor: encodes the site id so distinct sites get distinct ids', () => {
  assert.equal(keycardIdFor('door-0', 'siteA'), 'keycard-door-0-siteA');
  assert.equal(keycardIdFor('door-0', 'siteB'), 'keycard-door-0-siteB');
  assert.notEqual(keycardIdFor('door-0', 'siteA'), keycardIdFor('door-0', 'siteB'));
});

test('keycardIdFor: run-scoped card (no site id) keeps the bare id', () => {
  assert.equal(keycardIdFor('door-0'), 'keycard-door-0');
  assert.equal(keycardIdFor('door-0', null), 'keycard-door-0');
});

test('spawned keycard id is site-unique (not the bare keycard-door-0)', () => {
  let run = null;
  let contract = null;
  for (let seed = 1; seed < 80 && !run; seed++) {
    const candidate = new Run({ crewMember: makeCrew(), seed });
    const c = keycardDoorContract(seed);
    candidate.enterBriefing(c);
    try {
      candidate.enterCombat();
      run = candidate;
      contract = c;
    } catch {
      continue;
    }
  }
  assert.ok(run, 'need a keycard-door layout');
  const keycard = [...run!.world!.entities.values()].find(e => e instanceof KeyCard) as KeyCard;
  assert.ok(keycard);
  const siteId = siteIdForContract(contract!);
  assert.equal(keycard.id, keycardIdFor('door-0', siteId));
  assert.notEqual(keycard.id, 'keycard-door-0', 'legacy bare id would collide across sites');
});

// ─── P3.1: legacy id migration on restore ────────────────────────────────────

test('migrateLegacyKeycardId: re-stamps a legacy bare id with its site id', () => {
  const migrated = migrateLegacyKeycardId({
    id: 'keycard-door-0',
    label: 'Access keycard',
    doorId: 'door-0',
    siteId: 'site-42',
  });
  assert.equal(migrated.id, 'keycard-door-0-site-42');
});

test('migrateLegacyKeycardId: idempotent on an already-migrated id', () => {
  const item = {
    id: 'keycard-door-0-site-42',
    label: 'Access keycard',
    doorId: 'door-0',
    siteId: 'site-42',
  };
  assert.equal(migrateLegacyKeycardId(item).id, 'keycard-door-0-site-42');
});

test('migrateLegacyKeycardId: leaves run-scoped (no siteId) and custom ids untouched', () => {
  assert.equal(
    migrateLegacyKeycardId({ id: 'keycard-door-0', label: 'x', doorId: 'door-0' }).id,
    'keycard-door-0',
    'no siteId → nothing to disambiguate'
  );
  assert.equal(
    migrateLegacyKeycardId({ id: 'kc-1', label: 'x', doorId: 'door-0', siteId: 's' }).id,
    'kc-1',
    'non-legacy custom id is preserved'
  );
});

test('Campaign restore migrates a legacy bare keycard id to a site-unique id', () => {
  const c = makeCampaign();
  const snap = snapshotCampaign(c);
  (snap as Record<string, unknown>).keyItems = [
    { id: 'keycard-door-0', label: 'Access keycard', doorId: 'door-0', siteId: '210241126' },
  ];
  const restored = restoreCampaign(snap);
  assert.equal(restored.keyItems[0]!.id, 'keycard-door-0-210241126');
  assert.equal(restored.keyItems[0]!.siteId, '210241126');
});

test('Run restore migrates a legacy bare keycard id to a site-unique id', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 42 });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  const rec = snapshot(run);
  (rec as Record<string, unknown>).keyItems = [
    { id: 'keycard-door-0', label: 'Access keycard', doorId: 'door-0', siteId: '1062993016' },
  ];
  const { run: restored } = restore(rec);
  assert.equal(restored.keyItems[0]!.id, 'keycard-door-0-1062993016');
});

test('migration repro: two colliding legacy cards survive as distinct cards', () => {
  // The reported bug: a held Vuong card and a freshly-picked auction card both
  // serialized as `keycard-door-0`. After migration they are distinct ids so
  // promotion no longer silently drops one.
  const campaign = makeCampaign();
  const snap = snapshotCampaign(campaign);
  (snap as Record<string, unknown>).keyItems = [
    { id: 'keycard-door-0', label: 'Access keycard', doorId: 'door-0', siteId: '210241126' },
  ];
  const restored = restoreCampaign(snap);
  // Simulate the run-carried auction card promoting on extraction.
  const runCardId = keycardIdFor('door-0', '1062993016');
  assert.notEqual(runCardId, restored.keyItems[0]!.id, 'ids no longer collide');
  restored.addKeyItem({
    id: runCardId,
    label: 'Access keycard',
    doorId: 'door-0',
    siteId: '1062993016',
  });
  assert.equal(restored.keyItems.length, 2, 'both site cards retained');
});

// ─── P3.1: Run.effectiveKeyItems scopes to the current site ───────────────────

test('Run.effectiveKeyItems: includes only campaign cards for the current site', () => {
  let run = null;
  let contract = null;
  for (let seed = 1; seed < 80 && !run; seed++) {
    const candidate = new Run({ crewMember: makeCrew(), seed });
    const c = keycardDoorContract(seed);
    candidate.enterBriefing(c);
    try {
      candidate.enterCombat();
      run = candidate;
      contract = c;
    } catch {
      continue;
    }
  }
  assert.ok(run, 'need a keycard-door layout');
  const siteId = siteIdForContract(contract!);
  const campaignKeyItems: KeyItem[] = [
    { id: keycardIdFor('door-0', siteId), label: 'This site', doorId: 'door-0', siteId },
    {
      id: keycardIdFor('door-0', 'other-site'),
      label: 'Other site',
      doorId: 'door-0',
      siteId: 'other-site',
    },
  ];
  const effective = run!.effectiveKeyItems(campaignKeyItems);
  assert.ok(
    effective.some(k => k.siteId === siteId),
    'current-site card is included'
  );
  assert.ok(
    !effective.some(k => k.siteId === 'other-site'),
    'other-site card is excluded (was the phantom second keycard)'
  );
});

test('Run.effectiveKeyItems: always includes run-scoped pickups and dedups by id', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 42 });
  run.enterBriefing(keycardDoorContract(42));
  const siteId = siteIdForContract(run.contract!);
  const sharedId = keycardIdFor('door-0', siteId);
  run.addKeyItem({ id: sharedId, label: 'Picked up', doorId: 'door-0', siteId });
  // Campaign also lists the same card (shouldn't double-render).
  const effective = run.effectiveKeyItems([
    { id: sharedId, label: 'Held', doorId: 'door-0', siteId },
  ]);
  assert.equal(effective.filter(k => k.id === sharedId).length, 1, 'deduped by id');
});

test('Run.addKeyItem: canonicalizes a bare legacy id picked up off a pre-P3.1 map', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 99 });
  // Simulates onKeycardCollected feeding a legacy entity id + its siteId.
  run.addKeyItem({
    id: 'keycard-door-0',
    label: 'Access keycard',
    doorId: 'door-0',
    siteId: '1062993016',
  });
  assert.equal(run.keyItems[0]!.id, 'keycard-door-0-1062993016');
});

test('Run.effectiveKeyItems: no contract → only run-scoped pickups', () => {
  const run = new Run({ crewMember: makeCrew(), seed: 42 });
  run.addKeyItem({ id: 'kc-run', label: 'Run card', doorId: 'door-0' });
  const effective = run.effectiveKeyItems([
    { id: 'kc-camp', label: 'Camp card', doorId: 'door-0', siteId: 'site-x' },
  ]);
  assert.deepEqual(
    effective.map(k => k.id),
    ['kc-run']
  );
});

test('addSiteToRoster eviction removes keycards belonging to the evicted site', () => {
  const campaign = makeCampaign();
  // Fill the roster to capacity; site-0 is the oldest (lowest lastVisitedJob).
  for (let i = 0; i < SITE_ROSTER_CAP; i++) {
    campaign.addSiteToRoster(makeSite(`site-${i}`, i));
  }
  campaign.addKeyItem({ id: 'kc-old', label: 'Old card', doorId: 'door-0', siteId: 'site-0' });
  campaign.addKeyItem({ id: 'kc-keep', label: 'Kept card', doorId: 'door-1', siteId: 'site-1' });

  // One more site evicts the oldest (site-0).
  campaign.addSiteToRoster(makeSite('site-new', SITE_ROSTER_CAP + 1));

  assert.equal(campaign.findRosterSite('site-0'), null, 'oldest site evicted');
  assert.equal(campaign.keyItems.length, 1, 'evicted-site keycard dropped');
  assert.equal(campaign.keyItems[0]!.id, 'kc-keep', 'surviving-site keycard retained');
});
