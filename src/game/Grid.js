import { TILE } from './constants.js';

/**
 * 2D tile grid backed by a flat Uint8Array.
 *
 * Coordinates are (x, y) with origin at the top-left, y growing downward —
 * matching the canvas coordinate system we'll render onto in M2.
 */
export class Grid {
  constructor(width, height, fillTile = TILE.FLOOR) {
    if (!Number.isInteger(width) || width <= 0) {
      throw new RangeError(`Grid width must be a positive integer, got ${width}`);
    }
    if (!Number.isInteger(height) || height <= 0) {
      throw new RangeError(`Grid height must be a positive integer, got ${height}`);
    }
    this.width = width;
    this.height = height;
    this.tiles = new Uint8Array(width * height).fill(fillTile);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  #index(x, y) {
    if (!this.inBounds(x, y)) {
      throw new RangeError(`(${x}, ${y}) is out of bounds for ${this.width}x${this.height} grid`);
    }
    return y * this.width + x;
  }

  tileAt(x, y) {
    return this.tiles[this.#index(x, y)];
  }

  setTile(x, y, tile) {
    this.tiles[this.#index(x, y)] = tile;
  }

  /**
   * Movement passability. Cover blocks normal movement — the Merc's Vault perk
   * is the deliberate exception. Out-of-bounds is impassable (no throw, this
   * is called in hot paths like A* expansion).
   */
  isPassable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.tiles[y * this.width + x];
    return t === TILE.FLOOR || t === TILE.EXIT;
  }

  /**
   * Line-of-sight occluders. Only WALL fully blocks. COVER lets sightlines
   * through but will apply a hit modifier in M4.
   */
  blocksLineOfSight(x, y) {
    if (!this.inBounds(x, y)) return true;
    return this.tiles[y * this.width + x] === TILE.WALL;
  }
}
