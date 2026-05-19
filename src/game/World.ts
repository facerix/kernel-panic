import { AP_COST, NOISE_RADIUS } from './constants.js';
import { EVENT } from './events.js';
import type { Grid } from './Grid.js';
import type { Entity, LootableEntity } from './Entity.js';
import type { EventBus } from './events.js';

/**
 * Owns the grid and the live entity set. Validates and applies actions and,
 * when an event bus is attached, emits domain events for AI / vision / UI
 * subscribers. Pure data — safe to step in tests without a DOM.
 *
 * Move legality returns a `{ ok, reason }` discriminator so AI and UI layers
 * can branch on the failure mode (e.g. "blocked" → try a different tile).
 *
 * The event bus is **optional**: tests that don't care about emissions can
 * omit it entirely. Wiring tests pass one in and assert the payload shape.
 */

export type WorldOptions = {
  events?: EventBus | null;
};
export class World {
  grid: Grid;
  entities: Map<string, Entity>;
  events: EventBus | null;

  /** Map-wide alarm latch. Once raised by a CorpCivilian, stays true for the run. */
  alarmActive: boolean;

  constructor(grid: Grid, options: WorldOptions = {}) {
    if (!grid) throw new TypeError('World requires a grid');
    this.grid = grid;
    this.entities = new Map();
    this.events = options.events ?? null;
    this.alarmActive = false;
  }

  addEntity(entity: Entity) {
    if (this.entities.has(entity.id)) {
      throw new Error(`Duplicate entity id: ${entity.id}`);
    }
    if (!this.grid.isPassable(entity.x, entity.y)) {
      throw new Error(
        `Cannot place entity ${entity.id} on impassable tile (${entity.x}, ${entity.y})`
      );
    }
    if (this.entityAt(entity.x, entity.y)) {
      throw new Error(`Tile (${entity.x}, ${entity.y}) is already occupied`);
    }
    this.entities.set(entity.id, entity);
  }

  removeEntity(id: string) {
    if (!this.entities.has(id)) {
      throw new Error(`Unknown entity: ${id}`);
    }
    this.entities.delete(id);
  }

  /**
   * Linear scan — fine for V1 entity counts (~tens). If we ever break a
   * thousand entities on screen we'll add a position index.
   *
   * Live entities only — corpses stay in `entities` for salvage / rendering
   * but must not block movement or register as LOS blockers (see
   * `blockerKeys`). Use {@link anyEntityAt} for any occupant regardless of
   * `alive`, or {@link lootableCorpseAt} for salvage targets (including when a
   * live actor shares the tile).
   */
  entityAt(x: number, y: number): Entity | null {
    for (const e of this.entities.values()) {
      if (e.alive && e.x === x && e.y === y) return e;
    }
    return null;
  }

  /**
   * First entity at `(x, y)` whether living or dead. Map iteration order is
   * undefined — prefer {@link lootableCorpseAt} when you need a corpse on a
   * tile that may also hold a live actor (e.g. player standing on salvage).
   */
  anyEntityAt(x: number, y: number): Entity | null {
    for (const e of this.entities.values()) {
      if (e.x === x && e.y === y) return e;
    }
    return null;
  }

  /**
   * Dead entity on `(x, y)` with `loot.salvage > 0`, if any. Scans every
   * occupant so co-located live + corpse (legal after moving onto a body)
   * still resolves the lootable target.
   */
  lootableCorpseAt(x: number, y: number): LootableEntity | null {
    for (const e of this.entities.values()) {
      if (e.x !== x || e.y !== y) continue;
      if (!e.alive && (e as LootableEntity).loot && (e as LootableEntity).loot.salvage > 0)
        return e as LootableEntity;
    }
    return null;
  }

  /**
   * Pure check — no mutation. Movement is constrained to a single Chebyshev
   * step (the 8-neighbourhood). Diagonal cost is treated the same as
   * orthogonal in V1; we'll revisit if drones feel cheaty.
   *
   * Crashes on non-integer offsets (data-corruption guard — `Math.abs(0.5)`
   * would otherwise quietly slide an entity onto a fractional tile).
   */
  canMoveEntity(entity: Entity, dx: number, dy: number): { ok: boolean; reason?: string } {
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
      throw new TypeError(`canMoveEntity requires integer offsets, got (${dx}, ${dy})`);
    }
    if (!entity.alive) {
      return { ok: false, reason: 'dead' };
    }
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

  /**
   * Coordinate keys (`"x,y"`) for every live entity. Cheap enough to rebuild
   * per LOS query at V1 entity counts; if engagement scenes ever push past
   * dozens of actors we'll cache it and invalidate on move/death. Used by
   * `LineOfSight.hasLineOfSight` to enforce entity occlusion.
   */
  blockerKeys(): Set<string> {
    const set = new Set<string>();
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      set.add(`${e.x},${e.y}`);
    }
    return set;
  }

  /**
   * Commit a move. Pass `{ silent: true }` to suppress the `noise` emission —
   * the Razor's Slide is the canonical caller (a stealth move is, by design,
   * inaudible). Listeners on `entity:moved` always fire either way; vision
   * recompute and AI hooks can't be opted out of by mistake.
   */
  /**
   * Move an entity to an absolute position without AP cost or noise.
   * Validates bounds, passability, and occupancy — crashes on violations
   * (same contract as `moveEntity`). Emits `ENTITY_MOVED` so vision
   * recompute and AI hooks still fire.
   *
   * Use cases: vault knockback, neutral civilian flee — movements that are
   * mechanically free but must still update the world consistently.
   */
  relocateEntity(entity: Entity, x: number, y: number) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new TypeError(`relocateEntity requires integer coords, got (${x}, ${y})`);
    }
    if (!entity.alive) {
      throw new Error(`Cannot relocate dead entity ${entity.id}`);
    }
    if (!this.grid.inBounds(x, y)) {
      throw new Error(`relocateEntity: (${x}, ${y}) is out of bounds`);
    }
    if (!this.grid.isPassable(x, y)) {
      throw new Error(`relocateEntity: (${x}, ${y}) is not passable`);
    }
    const blocker = this.entityAt(x, y);
    if (blocker && blocker !== entity) {
      throw new Error(`relocateEntity: (${x}, ${y}) is occupied by ${blocker.id}`);
    }
    const from = { x: entity.x, y: entity.y };
    entity.x = x;
    entity.y = y;
    this.events?.emit(EVENT.ENTITY_MOVED, {
      entity,
      from,
      to: { x: entity.x, y: entity.y },
    });
  }

  moveEntity(entity: Entity, dx: number, dy: number, options: { silent?: boolean } = {}) {
    const check = this.canMoveEntity(entity, dx, dy);
    if (!check.ok) {
      throw new Error(`Illegal move for ${entity.id}: ${check.reason}`);
    }
    const from = { x: entity.x, y: entity.y };
    entity.spendAp(AP_COST.MOVE);
    entity.x += dx;
    entity.y += dy;
    // Emit AFTER the commit so listeners (vision recompute, AI hooks) see the
    // post-move state. Bus is optional — tests that don't subscribe pay nothing.
    this.events?.emit(EVENT.ENTITY_MOVED, {
      entity,
      from,
      to: { x: entity.x, y: entity.y },
    });
    if (!options.silent) {
      this.events?.emit(EVENT.NOISE, {
        origin: { x: entity.x, y: entity.y },
        radius: NOISE_RADIUS.MOVE,
        source: entity,
        kind: 'move',
      });
    }
  }
}
