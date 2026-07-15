import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CAMPAIGN_HISTORY_CAP, type CampaignSummary } from '../../src/game/campaignSummary.js';

const STORAGE_KEY = 'kp:data';

class MemoryStorage {
  #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

function summary(index: number): CampaignSummary {
  return {
    campaignId: `campaign-${index}`,
    completedAt: '2026-06-14T19:30:00.000Z',
    result: 'win',
    endReason: 'score-complete',
    seed: index,
    completedJobs: index,
    rep: 50,
    credits: index * 100,
    crewRoster: [{ callsign: 'Phreak', archetype: 'Decker', flatlined: false }],
  };
}

test('DataStore migrates legacy data and archives idempotent capped campaign history', async () => {
  const localStorage = new MemoryStorage();
  (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = { localStorage };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ prefs: {}, runs: [], campaign: null }));
  const { default: dataStore } = await import('../../src/DataStore.js');

  await dataStore.init();
  assert.deepEqual(dataStore.campaignHistory, []);

  const original = summary(0);
  const first = dataStore.archiveCampaign(original);
  const duplicate = dataStore.archiveCampaign({
    ...original,
    completedAt: '2026-06-15T19:30:00.000Z',
    completedJobs: 999,
  });
  assert.deepEqual(duplicate, first, 'the first archived record remains canonical');

  for (let index = 1; index <= CAMPAIGN_HISTORY_CAP + 5; index++) {
    dataStore.archiveCampaign(summary(index));
  }
  assert.equal(dataStore.campaignHistory.length, CAMPAIGN_HISTORY_CAP);
  assert.equal(dataStore.campaignHistory[0].campaignId, `campaign-${CAMPAIGN_HISTORY_CAP + 5}`);
  assert.equal(
    dataStore.campaignHistory.some(entry => entry.campaignId === original.campaignId),
    false
  );

  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
    campaignHistory?: CampaignSummary[];
  };
  assert.equal(stored.campaignHistory?.length, CAMPAIGN_HISTORY_CAP);
});

function installStorage(seed: object): MemoryStorage {
  const localStorage = new MemoryStorage();
  (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = { localStorage };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  return localStorage;
}

test('DataStore normalizes an absent scoreable store to an empty list', async () => {
  installStorage({ prefs: {}, runs: [], campaign: null });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await dataStore.init();
  assert.deepEqual(dataStore.unlockedScoreableItems, []);
});

test('DataStore archives scoreable items idempotently and persists them', async () => {
  const localStorage = installStorage({ prefs: {}, runs: [], campaign: null });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await dataStore.init();

  let events = 0;
  const onChange = (evt: Event) => {
    if ((evt as CustomEvent).detail.key === 'unlockedScoreableItems') events++;
  };
  dataStore.addEventListener('change', onChange);

  const first = dataStore.archiveScoreableItem('proto-exoframe');
  assert.equal(first.added, true);
  const second = dataStore.archiveScoreableItem('mil-spec-optics');
  assert.equal(second.added, true);
  assert.deepEqual(dataStore.unlockedScoreableItems, ['proto-exoframe', 'mil-spec-optics']);
  assert.equal(events, 2, 'each new unlock emits one change event');

  // Duplicate archival is a silent no-op: no event, no growth, no save churn.
  const duplicate = dataStore.archiveScoreableItem('proto-exoframe');
  assert.equal(duplicate.added, false);
  assert.deepEqual(dataStore.unlockedScoreableItems, ['proto-exoframe', 'mil-spec-optics']);
  assert.equal(events, 2, 'a duplicate archival emits no change event');
  dataStore.removeEventListener('change', onChange);

  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
    unlockedScoreableItems?: string[];
  };
  assert.deepEqual(stored.unlockedScoreableItems, ['proto-exoframe', 'mil-spec-optics']);

  // The getter hands back a defensive copy — callers can't mutate the store.
  const snapshot = dataStore.unlockedScoreableItems;
  snapshot.push('tampered');
  assert.deepEqual(dataStore.unlockedScoreableItems, ['proto-exoframe', 'mil-spec-optics']);
});

test('DataStore throws on a structurally corrupt scoreable store rather than resetting', async () => {
  installStorage({ prefs: {}, runs: [], campaign: null, unlockedScoreableItems: [1] });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await assert.rejects(() => dataStore.init(), TypeError);
});

// --- P3.5.M7: unlockedArchetypes ------------------------------------------

test('DataStore normalizes an absent archetype store to an empty list', async () => {
  installStorage({ prefs: {}, runs: [], campaign: null });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await dataStore.init();
  assert.deepEqual(dataStore.unlockedArchetypes, []);
});

test('DataStore starts unlockedArchetypes empty even when unlockedScoreableItems has history', async () => {
  // Design decision locked 2026-07-13: nothing grandfathers in from item-unlock
  // history — unlockedArchetypes is a wholly independent store key.
  installStorage({
    prefs: {},
    runs: [],
    campaign: null,
    unlockedScoreableItems: ['proto-exoframe', 'mil-spec-optics', 'ballistics-coil'],
  });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await dataStore.init();
  assert.deepEqual(dataStore.unlockedArchetypes, []);
  assert.equal(dataStore.unlockedScoreableItems.length, 3);
});

test('DataStore archives unlocked archetypes idempotently and persists them', async () => {
  const localStorage = installStorage({ prefs: {}, runs: [], campaign: null });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await dataStore.init();

  let events = 0;
  const onChange = (evt: Event) => {
    if ((evt as CustomEvent).detail.key === 'unlockedArchetypes') events++;
  };
  dataStore.addEventListener('change', onChange);

  const first = dataStore.archiveUnlockedArchetype('berserk');
  assert.equal(first.added, true);
  const second = dataStore.archiveUnlockedArchetype('adept');
  assert.equal(second.added, true);
  assert.deepEqual(dataStore.unlockedArchetypes, ['berserk', 'adept']);
  assert.equal(events, 2, 'each new unlock emits one change event');

  // Duplicate archival is a silent no-op: no event, no growth, no save churn.
  const duplicate = dataStore.archiveUnlockedArchetype('berserk');
  assert.equal(duplicate.added, false);
  assert.deepEqual(dataStore.unlockedArchetypes, ['berserk', 'adept']);
  assert.equal(events, 2, 'a duplicate archival emits no change event');
  dataStore.removeEventListener('change', onChange);

  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
    unlockedArchetypes?: string[];
  };
  assert.deepEqual(stored.unlockedArchetypes, ['berserk', 'adept']);

  // The getter hands back a defensive copy — callers can't mutate the store.
  const snapshot = dataStore.unlockedArchetypes;
  snapshot.push('tampered');
  assert.deepEqual(dataStore.unlockedArchetypes, ['berserk', 'adept']);
});

test('DataStore throws on a structurally corrupt archetype store rather than resetting', async () => {
  installStorage({ prefs: {}, runs: [], campaign: null, unlockedArchetypes: [1] });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await assert.rejects(() => dataStore.init(), TypeError);
});

// --- showcase-slot follow-up (2026-07-14): pendingArchetypeShowcase -------

test('DataStore normalizes an absent pendingArchetypeShowcase to null', async () => {
  installStorage({ prefs: {}, runs: [], campaign: null });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await dataStore.init();
  assert.equal(dataStore.pendingArchetypeShowcase, null);
});

test('archiveUnlockedArchetype arms pendingArchetypeShowcase atomically with a genuinely new unlock', async () => {
  const localStorage = installStorage({ prefs: {}, runs: [], campaign: null });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await dataStore.init();

  const first = dataStore.archiveUnlockedArchetype('berserk');
  assert.equal(first.added, true);
  assert.equal(dataStore.pendingArchetypeShowcase, 'berserk');

  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
    pendingArchetypeShowcase?: string | null;
  };
  assert.equal(stored.pendingArchetypeShowcase, 'berserk');

  // A second, later unlock re-arms the showcase to the newer id.
  dataStore.archiveUnlockedArchetype('adept');
  assert.equal(dataStore.pendingArchetypeShowcase, 'adept');
});

test('a duplicate archiveUnlockedArchetype call leaves an already-pending showcase untouched', async () => {
  installStorage({ prefs: {}, runs: [], campaign: null });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await dataStore.init();

  dataStore.archiveUnlockedArchetype('berserk');
  dataStore.clearPendingArchetypeShowcase();
  assert.equal(dataStore.pendingArchetypeShowcase, null);

  // Re-archiving the same (already-unlocked) id is a no-op — must NOT re-arm
  // a showcase the player already saw and moved past.
  const duplicate = dataStore.archiveUnlockedArchetype('berserk');
  assert.equal(duplicate.added, false);
  assert.equal(dataStore.pendingArchetypeShowcase, null);
});

test('clearPendingArchetypeShowcase is idempotent and persists the clear', async () => {
  const localStorage = installStorage({ prefs: {}, runs: [], campaign: null });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await dataStore.init();
  dataStore.archiveUnlockedArchetype('berserk');

  let events = 0;
  const onChange = (evt: Event) => {
    if ((evt as CustomEvent).detail.key === 'pendingArchetypeShowcase') events++;
  };
  dataStore.addEventListener('change', onChange);

  dataStore.clearPendingArchetypeShowcase();
  assert.equal(dataStore.pendingArchetypeShowcase, null);
  assert.equal(events, 1);

  // Clearing an already-clear store is a silent no-op.
  dataStore.clearPendingArchetypeShowcase();
  assert.equal(events, 1, 'no event on a redundant clear');
  dataStore.removeEventListener('change', onChange);

  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
    pendingArchetypeShowcase?: string | null;
  };
  assert.equal(stored.pendingArchetypeShowcase, null);
});

test('DataStore throws on a structurally corrupt pendingArchetypeShowcase rather than resetting', async () => {
  installStorage({ prefs: {}, runs: [], campaign: null, pendingArchetypeShowcase: 7 });
  const { default: dataStore } = await import('../../src/DataStore.js');
  await assert.rejects(() => dataStore.init(), TypeError);
});
