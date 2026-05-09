import { DEFAULT_AP, DEFAULT_HP } from './constants.js';

/**
 * A grid-resident actor: player, drone, NPC. Pure data + AP/HP bookkeeping; no
 * AI here — drone behaviour lands in M5.
 *
 * Crashes on illegal AP spend or negative damage rather than clamping
 * silently — a bug that spends 3 AP from a 1-AP pool, or rolls negative
 * damage, is data corruption we want surfaced early.
 */
export class Entity {
  constructor({ id, x, y, faction, glyph, maxAp = DEFAULT_AP, maxHp = DEFAULT_HP }) {
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
    if (!Number.isInteger(maxHp) || maxHp <= 0) {
      throw new RangeError(`Entity maxHp must be a positive integer, got ${maxHp}`);
    }
    this.id = id;
    this.x = x;
    this.y = y;
    this.faction = faction;
    this.glyph = glyph ?? '?';
    this.maxAp = maxAp;
    this.ap = maxAp;
    this.maxHp = maxHp;
    this.hp = maxHp;
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

  /**
   * Apply damage. Crashes on negative or non-integer input — silent clamping
   * here would mask combat bugs (e.g. negative damage healing the target).
   * Reaching 0 HP flips `alive` to false; further damage on a corpse throws.
   */
  damage(amount) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError(`damage amount must be a non-negative integer, got ${amount}`);
    }
    if (!this.alive) {
      throw new Error(`Cannot damage ${this.id}: already dead`);
    }
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }
}
