// singleton class to manage the user's data

import {
  archiveCampaignSummary,
  cloneCampaignSummary,
  normalizeCampaignHistory,
  type CampaignSummary,
} from './game/campaignSummary.js';

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
};
type KPDataObject = string | object | Run | Campaign | Run[] | Campaign[] | CampaignSummary[];

class DataStore extends EventTarget {
  #prefs: KPData['prefs'] = {};
  #runs: KPData['runs'] = [];
  #campaign: KPData['campaign'] = null;
  #campaignHistory: KPData['campaignHistory'] = [];

  constructor() {
    if (instance) {
      throw new Error('New instance cannot be created!!');
    }
    super();

    // oxlint-disable-next-line typescript-eslint(no-this-alias): Singleton guard stores the constructed instance.
    instance = this;
  }

  #loadDataFromJson(json: string): KPData {
    try {
      const data = JSON.parse(json);
      return {
        prefs: data.prefs ?? {},
        runs: data.runs ?? [],
        campaign: data.campaign ?? null,
        campaignHistory: normalizeCampaignHistory(data.campaignHistory),
      };
    } catch (error) {
      console.warn('[DataStore] Failed to parse stored JSON, resetting stored data.', error);
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ prefs: {}, runs: [], campaign: null, campaignHistory: [] })
        );
      } catch (storageError) {
        console.warn('[DataStore] Failed to reset stored data.', storageError);
      }
      return { prefs: {}, runs: [], campaign: null, campaignHistory: [] };
    }
  }

  async init() {
    let savedDataJson = window.localStorage.getItem(STORAGE_KEY);
    if (!savedDataJson) {
      savedDataJson = JSON.stringify({ prefs: {}, runs: [], campaign: null, campaignHistory: [] });
      window.localStorage.setItem(STORAGE_KEY, savedDataJson);
    }
    const { prefs, runs, campaign, campaignHistory } = this.#loadDataFromJson(savedDataJson);
    this.#prefs = prefs;
    this.#runs = runs;
    this.#campaign = campaign;
    this.#campaignHistory = campaignHistory;
    this.#emitChangeEvent('init', '*');
  }

  import(jsonData: string): void {
    const { prefs, runs, campaign, campaignHistory } = this.#loadDataFromJson(jsonData);
    this.#prefs = prefs;
    this.#runs = runs;
    this.#campaign = campaign;
    this.#campaignHistory = campaignHistory;
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
