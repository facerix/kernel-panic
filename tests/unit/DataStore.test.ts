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
