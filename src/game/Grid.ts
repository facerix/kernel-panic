import { TILE } from './constants.js';

/**
 * 2D tile grid backed by a flat Uint8Array.
 *
 * Coordinates are (x, y) with origin at the top-left, y growing downward —
 * matching the canvas coordinate system we'll render onto in M2.
 */
export class Grid {
  width: number;
  height: number;
  tiles: Uint8Array;

  constructor(width: number, height: number, fillTile: number = TILE.FLOOR) {
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

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  #index(x: number, y: number): number {
    if (!this.inBounds(x, y)) {
      throw new RangeError(`(${x}, ${y}) is out of bounds for ${this.width}x${this.height} grid`);
    }
    return y * this.width + x;
  }

  tileAt(x: number, y: number): number {
    return this.tiles[this.#index(x, y)];
  }

  setTile(x: number, y: number, tile: number): void {
    this.tiles[this.#index(x, y)] = tile;
  }

  /**
   * Movement passability. Cover blocks normal movement — the Merc's Vault perk
   * is the deliberate exception. Out-of-bounds is impassable (no throw, this
   * is called in hot paths like A* expansion).
   */
  isPassable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const t = this.tiles[y * this.width + x];
    return (
      t === TILE.FLOOR ||
      t === TILE.EXIT ||
      t === TILE.SMOKE ||
      t === TILE.HAZARD ||
      t === TILE.RUBBLE
    );
  }

  /**
   * Line-of-sight occluders. Only WALL fully blocks. COVER lets sightlines
   * through but will apply a hit modifier in M4.
   */
  blocksLineOfSight(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    const t = this.tiles[y * this.width + x];
    return t === TILE.WALL || t === TILE.SMOKE;
  }
}
