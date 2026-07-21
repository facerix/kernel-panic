import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectConsumablePickup,
  collectKeycardPickup,
  collectCorpseSalvage,
  type CollectedKeycard,
} from '../../../src/game/lootCollection.js';
import { EVENT } from '../../../src/game/events.js';
import { emptySalvage } from '../../../src/game/salvage.js';
import type { World } from '../../../src/game/World.js';
import type { LootableEntity } from '../../../src/game/Entity.js';
import type { ConsumablePickup } from '../../../src/game/entities/ConsumablePickup.js';
import type { KeyCard } from '../../../src/game/entities/KeyCard.js';

type Emit = { type: string; payload: unknown };

function fakeWorld() {
  const removed: string[] = [];
  const emits: Emit[] = [];
  const world = {
    removeEntity(id: string) {
      removed.push(id);
    },
    events: {
      emit(type: string, payload: unknown) {
        emits.push({ type, payload });
      },
    },
  };
  return { world: world as unknown as World, removed, emits };
}

test('collectConsumablePickup adds the charge, clears the pickup, and emits', () => {
  const { world, removed, emits } = fakeWorld();
  const added: string[] = [];
  const player = { addConsumable: (id: string) => added.push(id) };
  const pickup = { id: 'c1', consumableId: 'stim' } as unknown as ConsumablePickup;

  collectConsumablePickup(world, player, pickup);

  assert.deepEqual(added, ['stim']);
  assert.deepEqual(removed, ['c1']);
  assert.deepEqual(emits, [
    { type: EVENT.ITEM_COLLECTED, payload: { kind: 'consumable', entityId: 'c1' } },
  ]);
});

test('collectKeycardPickup routes the card (principalId null when run-scoped) and emits', () => {
  const { world, removed, emits } = fakeWorld();
  const routed: CollectedKeycard[] = [];
  const keycard = { id: 'k1', doorId: 'd1', label: 'Blue Keycard' } as unknown as KeyCard;

  collectKeycardPickup(world, keycard, kc => routed.push(kc));

  assert.deepEqual(removed, ['k1']);
  assert.deepEqual(routed, [{ id: 'k1', doorId: 'd1', label: 'Blue Keycard', principalId: null }]);
  assert.equal(emits[0].type, EVENT.ITEM_COLLECTED);
  assert.deepEqual(emits[0].payload, { kind: 'keycard', entityId: 'k1' });
});

test('collectKeycardPickup preserves a campaign-scoped principalId', () => {
  const { world } = fakeWorld();
  const routed: CollectedKeycard[] = [];
  const keycard = {
    id: 'k2',
    doorId: 'd2',
    label: 'Exec Keycard',
    principalId: 'corp-7',
  } as unknown as KeyCard;

  collectKeycardPickup(world, keycard, kc => routed.push(kc));

  assert.equal(routed[0].principalId, 'corp-7');
});

test('collectCorpseSalvage delegates AP handling, emits, and returns the total', () => {
  const { world, emits } = fakeWorld();
  const calls: { spendAp?: boolean }[] = [];
  const player = {
    collectSalvage: (_w: World, _c: LootableEntity, opts?: { spendAp?: boolean }) =>
      calls.push(opts ?? {}),
  };
  const corpse = {
    id: 'z1',
    loot: { salvage: { ...emptySalvage(), scrap: 5 } },
  } as unknown as LootableEntity;

  const amount = collectCorpseSalvage(world, player, corpse, { spendAp: true });

  assert.equal(amount, 5);
  assert.deepEqual(calls, [{ spendAp: true }]);
  assert.deepEqual(emits, [
    { type: EVENT.ITEM_COLLECTED, payload: { kind: 'salvage', entityId: 'z1' } },
  ]);
});

test('collectCorpseSalvage passes spendAp:false through for the walk-onto path', () => {
  const { world } = fakeWorld();
  const calls: { spendAp?: boolean }[] = [];
  const player = {
    collectSalvage: (_w: World, _c: LootableEntity, opts?: { spendAp?: boolean }) =>
      calls.push(opts ?? {}),
  };
  const corpse = {
    id: 'z2',
    loot: { salvage: { ...emptySalvage(), chips: 3 } },
  } as unknown as LootableEntity;

  const amount = collectCorpseSalvage(world, player, corpse, { spendAp: false });

  assert.equal(amount, 3);
  assert.deepEqual(calls, [{ spendAp: false }]);
});
