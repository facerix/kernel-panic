import { DEFAULT_AP } from './constants.js';

/**
 * A grid-resident actor: player, drone, NPC. Pure data + AP bookkeeping; no
 * AI here — drone behaviour lands in M5.
 *
 * Crashes on illegal AP spend rather than clamping silently — a bug that
 * spends 3 AP from a 1-AP pool is data corruption we want surfaced early.
 */
export class Entity {
  constructor({ id, x, y, faction, glyph, maxAp = DEFAULT_AP }) {
    if (id === undefined || id === null || id === '') {
      throw new TypeError('Entity requires a non-empty id');
    }
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new TypeError(`Entity requires integer x,y; got (${x}, ${y})`);
    }
    if (!faction) {
      throw new TypeError('Entity requires a faction');
    }
    if (!Number.isInteger(maxAp) || maxAp < 0) {
      throw new RangeError(`Entity maxAp must be a non-negative integer, got ${maxAp}`);
    }
    this.id = id;
    this.x = x;
    this.y = y;
    this.faction = faction;
    this.glyph = glyph ?? '?';
    this.maxAp = maxAp;
    this.ap = maxAp;
    this.alive = true;
  }

  canAfford(cost) {
    return this.ap >= cost;
  }

  spendAp(cost) {
    if (!Number.isInteger(cost) || cost < 0) {
      throw new RangeError(`AP cost must be a non-negative integer, got ${cost}`);
    }
    if (cost > this.ap) {
      throw new Error(`Insufficient AP: have ${this.ap}, need ${cost}`);
    }
    this.ap -= cost;
  }

  refreshAp() {
    this.ap = this.maxAp;
  }
}
