// singleton class to manage the user's data

const STORAGE_KEY = 'kp:data';
let instance;
class DataStore extends EventTarget {
  #prefs = {};
  #runs = [];
  #campaign = null;

  constructor() {
    if (instance) {
      throw new Error('New instance cannot be created!!');
    }
    super();

    instance = this;
  }

  #loadDataFromJson(json) {
    try {
      const data = JSON.parse(json);
      return { prefs: data.prefs ?? {}, runs: data.runs ?? [], campaign: data.campaign ?? null };
    } catch (error) {
      console.warn('[DataStore] Failed to parse stored JSON, resetting stored data.', error);
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ prefs: {}, runs: [], campaign: null })
        );
      } catch (storageError) {
        console.warn('[DataStore] Failed to reset stored data.', storageError);
      }
      return { prefs: {}, runs: [], campaign: null };
    }
  }

  async init() {
    let savedDataJson = window.localStorage.getItem(STORAGE_KEY);
    if (!savedDataJson) {
      savedDataJson = JSON.stringify({ prefs: {}, runs: [], campaign: null });
      window.localStorage.setItem(STORAGE_KEY, savedDataJson);
    }
    const { prefs, runs, campaign } = this.#loadDataFromJson(savedDataJson);
    this.#prefs = prefs;
    this.#runs = runs;
    this.#campaign = campaign;
    this.#emitChangeEvent('init', ['*']);
  }

  import(jsonData) {
    const { prefs, runs, campaign } = this.#loadDataFromJson(jsonData);
    this.#prefs = prefs;
    this.#runs = runs;
    this.#campaign = campaign;
    this.#emitChangeEvent('import', ['*']);
  }

  #saveData() {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ prefs: this.#prefs, runs: this.#runs, campaign: this.#campaign })
    );
  }

  #emitChangeEvent(changeType, key, data) {
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

  setPref(key, value) {
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

  getRunById(id) {
    return this.#runs.find(run => run.id === id);
  }

  addRun(run) {
    this.#runs.unshift(run);
    this.#emitChangeEvent('add', 'runs', run);
    this.#saveData();
  }

  updateRun(run) {
    const index = this.#runs.findIndex(r => r.id === run.id);
    if (index > -1) {
      this.#runs[index] = { ...this.#runs[index], ...run };
      this.#emitChangeEvent('update', 'runs', this.#runs[index]);
      this.#saveData();
    }
  }

  deleteRun(id) {
    if (this.#runs.find(r => r.id === id)) {
      this.#runs = this.#runs.filter(r => r.id !== id);
      this.#emitChangeEvent('delete', 'runs', id);
      this.#saveData();
    }
  }

  setCampaign(campaign) {
    this.#campaign = campaign;
    this.#emitChangeEvent(campaign ? 'update' : 'delete', 'campaign', campaign);
    this.#saveData();
  }

  deleteCampaign() {
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
