// singleton class to manage the user's data

const STORAGE_KEY = 'kernelPanicData';

let instance;
class DataStore extends EventTarget {
  #items = [];
  #itemsById = new Map();

  constructor() {
    if (instance) {
      throw new Error('New instance cannot be created!!');
    }
    super();

    instance = this;
  }

  #loadRecordsFromJson(json) {
    try {
      const records = JSON.parse(json);
      if (!Array.isArray(records)) {
        console.warn('[DataStore] Expected array JSON, falling back to empty list.');
        return [];
      }
      records.forEach((item, index) => {
        if (!item.id) {
          records[index].id = window.crypto.randomUUID();
        }
      });
      return records;
    } catch (error) {
      console.warn('[DataStore] Failed to parse stored JSON, resetting items.', error);
      try {
        window.localStorage.setItem(STORAGE_KEY, '[]');
      } catch (storageError) {
        console.warn('[DataStore] Failed to reset stored items.', storageError);
      }
      return [];
    }
  }

  async init() {
    let savedItemsJson = window.localStorage.getItem(STORAGE_KEY);
    if (!savedItemsJson) {
      savedItemsJson = '[]';
      window.localStorage.setItem(STORAGE_KEY, savedItemsJson);
    }
    this.#items = this.#loadRecordsFromJson(savedItemsJson);
    this.#reindex();

    setTimeout(() => {
      this.#emitChangeEvent('init', ['*']);
    }, 0);
  }

  import(jsonData) {
    const newItems = this.#loadRecordsFromJson(jsonData);
    Array.prototype.unshift.apply(this.#items, newItems);
    this.#reindex();

    setTimeout(() => {
      this.#emitChangeEvent('init', ['*']);
    }, 0);
  }

  #saveItems() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#items));
  }

  #emitChangeEvent(changeType, affectedRecords) {
    const changeEvent = new CustomEvent('change', {
      detail: {
        items: this.#items,
        changeType,
        affectedRecords,
      },
    });
    this.dispatchEvent(changeEvent);
  }

  #reindex() {
    this.#itemsById = new Map();
    this.#items.forEach(item => {
      this.#itemsById.set(item.id, item);
    });
    this.#saveItems();
  }

  get items() {
    return this.#items;
  }

  getItemById(id) {
    return this.#itemsById.get(id);
  }

  addItem(record) {
    record.id = v4WithTimestamp();
    this.#items.unshift(record);
    this.#reindex();
    this.#emitChangeEvent('add', record);
  }

  updateItem(record) {
    const index = this.#items.findIndex(rec => rec.id === record.id);
    if (index > -1) {
      this.#items[index] = record;
      this.#reindex();
      this.#emitChangeEvent('update', record);
    }
  }

  deleteItem(id) {
    if (this.#itemsById.has(id)) {
      this.#items = this.#items.filter(r => r.id !== id);
      this.#reindex();
      this.#emitChangeEvent('delete', [id]);
    }
  }
}

const singleton = Object.freeze(new DataStore());

export default singleton;
