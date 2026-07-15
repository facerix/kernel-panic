// singleton class to manage the user's data

import {
  archiveCampaignSummary,
  cloneCampaignSummary,
  normalizeCampaignHistory,
  type CampaignSummary,
} from './game/campaignSummary.js';
import { archiveScoreableItem, normalizeUnlockedScoreableItems } from './game/scoreableUnlocks.js';
import { archiveUnlockedArchetype, normalizeUnlockedArchetypes } from './game/archetypeUnlocks.js';
import { normalizePendingArchetypeShowcase } from './game/archetypeShowcase.js';

const STORAGE_KEY = 'kp:data';
let instance: DataStore | null = null;

// shallow types for Run and Campaign are fine here
type Run = {
  id: string;
};
type Campaign = {
  id: string;
};

type KPData = {
  prefs: Record<string, string | number | boolean | object>;
  runs: Run[];
  campaign: Campaign | null;
  campaignHistory: CampaignSummary[];
  unlockedScoreableItems: string[];
  /** P3.5.M7: cross-campaign archetype unlocks (Berserk/Adept/Chimera). */
  unlockedArchetypes: string[];
  /**
   * Showcase-slot follow-up (2026-07-14): the archetype id, if any, the next
   * campaign start should reserve crew candidate slot 0 for. Set atomically
   * alongside `unlockedArchetypes` by `archiveUnlockedArchetype`; cleared by
   * `clearPendingArchetypeShowcase` once a campaign-start recruitment commits.
   */
  pendingArchetypeShowcase: string | null;
};
type KPDataObject =
  | string
  | object
  | Run
  | Campaign
  | Run[]
  | Campaign[]
  | CampaignSummary[]
  | string[];

class DataStore extends EventTarget {
  #prefs: KPData['prefs'] = {};
  #runs: KPData['runs'] = [];
  #campaign: KPData['campaign'] = null;
  #campaignHistory: KPData['campaignHistory'] = [];
  #unlockedScoreableItems: KPData['unlockedScoreableItems'] = [];
  #unlockedArchetypes: KPData['unlockedArchetypes'] = [];
  #pendingArchetypeShowcase: KPData['pendingArchetypeShowcase'] = null;

  constructor() {
    if (instance) {
      throw new Error('New instance cannot be created!!');
    }
    super();

    // oxlint-disable-next-line typescript-eslint(no-this-alias): Singleton guard stores the constructed instance.
    instance = this;
  }

  #loadDataFromJson(json: string): KPData {
    let data: Record<string, unknown>;
    let campaignHistory: CampaignSummary[];
    try {
      data = JSON.parse(json);
      // `campaignHistory` keeps its existing posture: a structurally corrupt
      // (but parseable) history resets the whole store rather than throwing.
      campaignHistory = normalizeCampaignHistory(data.campaignHistory);
    } catch (error) {
      console.warn('[DataStore] Failed to parse stored JSON, resetting stored data.', error);
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            prefs: {},
            runs: [],
            campaign: null,
            campaignHistory: [],
            unlockedScoreableItems: [],
            unlockedArchetypes: [],
            pendingArchetypeShowcase: null,
          })
        );
      } catch (storageError) {
        console.warn('[DataStore] Failed to reset stored data.', storageError);
      }
      return {
        prefs: {},
        runs: [],
        campaign: null,
        campaignHistory: [],
        unlockedScoreableItems: [],
        unlockedArchetypes: [],
        pendingArchetypeShowcase: null,
      };
    }
    // The meta-progression store crashes loudly on structural corruption — a
    // silent reset would erase blueprints the meta-crew earned across campaigns
    // (global directive: crashing beats data corruption). The throw propagates
    // out of `init`/`import` rather than being swallowed above.
    return {
      prefs: (data.prefs as KPData['prefs']) ?? {},
      runs: (data.runs as KPData['runs']) ?? [],
      campaign: (data.campaign as KPData['campaign']) ?? null,
      campaignHistory,
      unlockedScoreableItems: normalizeUnlockedScoreableItems(data.unlockedScoreableItems),
      unlockedArchetypes: normalizeUnlockedArchetypes(data.unlockedArchetypes),
      pendingArchetypeShowcase: normalizePendingArchetypeShowcase(data.pendingArchetypeShowcase),
    };
  }

  async init() {
    let savedDataJson = window.localStorage.getItem(STORAGE_KEY);
    if (!savedDataJson) {
      savedDataJson = JSON.stringify({
        prefs: {},
        runs: [],
        campaign: null,
        campaignHistory: [],
        unlockedScoreableItems: [],
        unlockedArchetypes: [],
        pendingArchetypeShowcase: null,
      });
      window.localStorage.setItem(STORAGE_KEY, savedDataJson);
    }
    const {
      prefs,
      runs,
      campaign,
      campaignHistory,
      unlockedScoreableItems,
      unlockedArchetypes,
      pendingArchetypeShowcase,
    } = this.#loadDataFromJson(savedDataJson);
    this.#prefs = prefs;
    this.#runs = runs;
    this.#campaign = campaign;
    this.#campaignHistory = campaignHistory;
    this.#unlockedScoreableItems = unlockedScoreableItems;
    this.#unlockedArchetypes = unlockedArchetypes;
    this.#pendingArchetypeShowcase = pendingArchetypeShowcase;
    this.#emitChangeEvent('init', '*');
  }

  import(jsonData: string): void {
    const {
      prefs,
      runs,
      campaign,
      campaignHistory,
      unlockedScoreableItems,
      unlockedArchetypes,
      pendingArchetypeShowcase,
    } = this.#loadDataFromJson(jsonData);
    this.#prefs = prefs;
    this.#runs = runs;
    this.#campaign = campaign;
    this.#campaignHistory = campaignHistory;
    this.#unlockedScoreableItems = unlockedScoreableItems;
    this.#unlockedArchetypes = unlockedArchetypes;
    this.#pendingArchetypeShowcase = pendingArchetypeShowcase;
    this.#emitChangeEvent('import', '*');
  }

  #saveData() {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        prefs: this.#prefs,
        runs: this.#runs,
        campaign: this.#campaign,
        campaignHistory: this.#campaignHistory,
        unlockedScoreableItems: this.#unlockedScoreableItems,
        unlockedArchetypes: this.#unlockedArchetypes,
        pendingArchetypeShowcase: this.#pendingArchetypeShowcase,
      })
    );
  }

  #emitChangeEvent(changeType: string, key: string, data?: KPDataObject): void {
    const changeEvent = new CustomEvent('change', {
      detail: {
        key,
        data,
        changeType,
      },
    });
    this.dispatchEvent(changeEvent);
  }

  get prefs() {
    return this.#prefs;
  }

  setPref(key: string, value: string | number | boolean | object): void {
    this.#prefs = { ...this.#prefs, [key]: value };
    this.#emitChangeEvent('update', 'prefs', this.#prefs);
    this.#saveData();
  }

  get currentRun() {
    return this.#runs?.[0] ?? null;
  }

  get currentCampaign() {
    return this.#campaign;
  }

  get campaignHistory(): CampaignSummary[] {
    return this.#campaignHistory.map(cloneCampaignSummary);
  }

  /**
   * Cross-campaign meta-progression store (P3.M6): item IDs of scoreable
   * blueprints stolen via clean Score heists, in acquisition order. Returns a
   * defensive copy.
   */
  get unlockedScoreableItems(): string[] {
    return [...this.#unlockedScoreableItems];
  }

  /**
   * Record a scoreable item blueprint as stolen. Idempotent: re-archiving an
   * already-unlocked id is a no-op (no event, no save). Returns whether the
   * store changed. Written only on `score-complete` (call-site lands in M6.4).
   */
  archiveScoreableItem(id: string): { added: boolean } {
    const { list, added } = archiveScoreableItem(this.#unlockedScoreableItems, id);
    if (added) {
      this.#unlockedScoreableItems = list;
      this.#emitChangeEvent('add', 'unlockedScoreableItems', [...list]);
      this.#saveData();
    }
    return { added };
  }

  /**
   * Cross-campaign meta-progression store (P3.5.M7): archetype IDs
   * (Berserk/Adept/Chimera) unlocked via clean Score heists, in acquisition
   * order. Wholly independent of `unlockedScoreableItems` — a save that
   * unlocked every item under the pre-M7 system starts with an empty
   * archetype list. Returns a defensive copy.
   */
  get unlockedArchetypes(): string[] {
    return [...this.#unlockedArchetypes];
  }

  /**
   * Record an archetype as unlocked. Idempotent: re-archiving an
   * already-unlocked id is a no-op (no event, no save). Returns whether the
   * store changed. Written only on `score-complete` when the drawn payload
   * is an archetype reward.
   *
   * A genuinely new unlock also arms `pendingArchetypeShowcase` with the same
   * id, atomically — the next campaign start reserves crew candidate slot 0
   * for it (see `archetypeShowcase.ts`). A duplicate/no-op archive leaves any
   * already-pending showcase untouched.
   */
  archiveUnlockedArchetype(id: string): { added: boolean } {
    const { list, added } = archiveUnlockedArchetype(this.#unlockedArchetypes, id);
    if (added) {
      this.#unlockedArchetypes = list;
      this.#pendingArchetypeShowcase = id;
      this.#emitChangeEvent('add', 'unlockedArchetypes', [...list]);
      this.#saveData();
    }
    return { added };
  }

  /**
   * The archetype id, if any, the next campaign start should showcase in
   * crew candidate slot 0 (see `archetypeShowcase.ts`). `null` when nothing
   * is pending.
   */
  get pendingArchetypeShowcase(): string | null {
    return this.#pendingArchetypeShowcase;
  }

  /**
   * Clear the pending showcase. Idempotent (no event, no save if already
   * `null`). Called once a campaign-start recruitment actually commits
   * (`Campaign.recruitInitial`) — regardless of which candidate was picked,
   * the showcase's job (guaranteeing the player *saw* the option) is done.
   */
  clearPendingArchetypeShowcase(): void {
    if (this.#pendingArchetypeShowcase === null) return;
    this.#pendingArchetypeShowcase = null;
    this.#emitChangeEvent('delete', 'pendingArchetypeShowcase');
    this.#saveData();
  }

  archiveCampaign(summary: CampaignSummary): CampaignSummary {
    const archived = archiveCampaignSummary(this.#campaignHistory, summary);
    this.#campaignHistory = archived.history;
    if (archived.added) {
      this.#emitChangeEvent('add', 'campaignHistory', cloneCampaignSummary(archived.summary));
      this.#saveData();
    }
    return cloneCampaignSummary(archived.summary);
  }

  getRunById(id: string): Run | undefined {
    return this.#runs.find(run => run.id === id);
  }

  addRun(run: Run): void {
    this.#runs.unshift(run);
    this.#emitChangeEvent('add', 'runs', run);
    this.#saveData();
  }

  updateRun(run: Run): void {
    const index = this.#runs.findIndex(r => r.id === run.id);
    if (index > -1) {
      this.#runs[index] = { ...this.#runs[index], ...run };
      this.#emitChangeEvent('update', 'runs', this.#runs[index]);
      this.#saveData();
    }
  }

  deleteRun(id: string): void {
    if (this.#runs.find(r => r.id === id)) {
      this.#runs = this.#runs.filter(r => r.id !== id);
      this.#emitChangeEvent('delete', 'runs', id);
      this.#saveData();
    }
  }

  setCampaign(campaign: Campaign): void {
    this.#campaign = campaign;
    this.#emitChangeEvent(campaign ? 'update' : 'delete', 'campaign', campaign);
    this.#saveData();
  }

  deleteCampaign(): void {
    if (this.#campaign) {
      const id = this.#campaign.id;
      this.#campaign = null;
      this.#emitChangeEvent('delete', 'campaign', id);
      this.#saveData();
    }
  }
}

const singleton = Object.freeze(new DataStore());

export default singleton;
