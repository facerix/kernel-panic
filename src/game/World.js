import { AP_COST } from './constants.js';

/**
 * Owns the grid and the live entity set. Validates and applies actions; emits
 * no events yet (the event bus lands in M2 alongside the renderer). Pure
 * data — safe to step in tests without a DOM.
 *
 * Move legality returns a `{ ok, reason }` discriminator so AI and UI layers
 * can branch on the failure mode (e.g. "blocked" → try a different tile).
 */
export class World {
  constructor(grid) {
    if (!grid) throw new TypeError('World requires a grid');
    this.grid = grid;
    this.entities = new Map();
  }

  addEntity(entity) {
    if (this.entities.has(entity.id)) {
      throw new Error(`Duplicate entity id: ${entity.id}`);
    }
    if (!this.grid.isPassable(entity.x, entity.y)) {
      throw new Error(`Cannot place entity ${entity.id} on impassable tile (${entity.x}, ${entity.y})`);
    }
    if (this.entityAt(entity.x, entity.y)) {
      throw new Error(`Tile (${entity.x}, ${entity.y}) is already occupied`);
    }
    this.entities.set(entity.id, entity);
  }

  removeEntity(id) {
    if (!this.entities.has(id)) {
      throw new Error(`Unknown entity: ${id}`);
    }
    this.entities.delete(id);
  }

  /**
   * Linear scan — fine for V1 entity counts (~tens). If we ever break a
   * thousand entities on screen we'll add a position index.
   */
  entityAt(x, y) {
    for (const e of this.entities.values()) {
      if (e.alive && e.x === x && e.y === y) return e;
    }
    return null;
  }

  /**
   * Pure check — no mutation. Movement is constrained to a single Chebyshev
   * step (the 8-neighbourhood). Diagonal cost is treated the same as
   * orthogonal in V1; we'll revisit if drones feel cheaty.
   */
  canMoveEntity(entity, dx, dy) {
    if (dx === 0 && dy === 0) {
      return { ok: false, reason: 'no-op' };
    }
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      return { ok: false, reason: 'too-far' };
    }
    if (!entity.canAfford(AP_COST.MOVE)) {
      return { ok: false, reason: 'insufficient-ap' };
    }
    const nx = entity.x + dx;
    const ny = entity.y + dy;
    if (!this.grid.inBounds(nx, ny)) {
      return { ok: false, reason: 'out-of-bounds' };
    }
    if (!this.grid.isPassable(nx, ny)) {
      return { ok: false, reason: 'blocked' };
    }
    if (this.entityAt(nx, ny)) {
      return { ok: false, reason: 'occupied' };
    }
    return { ok: true };
  }

  moveEntity(entity, dx, dy) {
    const check = this.canMoveEntity(entity, dx, dy);
    if (!check.ok) {
      throw new Error(`Illegal move for ${entity.id}: ${check.reason}`);
    }
    entity.spendAp(AP_COST.MOVE);
    entity.x += dx;
    entity.y += dy;
  }
}
