import { AP_COST, NOISE_RADIUS } from './constants.js';
import { EVENT } from './events.js';
import { Interactable } from './entities/Interactable.js';
import { totalSalvage } from './salvage.js';
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

export const ALARM_PHASE = Object.freeze({
  QUIET: 'quiet',
  ALERT: 'alert',
  COOLDOWN: 'cooldown',
});

export const ALARM_CADENCE = Object.freeze({
  HOLD_TURNS: 2,
  COOLDOWN_TURNS: 2,
});

export type AlarmPhase = (typeof ALARM_PHASE)[keyof typeof ALARM_PHASE];

export type AlarmState = {
  phase: AlarmPhase;
  level: 0 | 1;
  holdTurnsRemaining: number;
  cooldownTurnsRemaining: number;
  triggers: number;
};

export type AlarmRaiseContext = {
  source?: Entity | null;
  target?: Entity | null;
  origin?: { x: number; y: number } | null;
};

export class World {
  grid: Grid;
  entities: Map<string, Entity>;
  events: EventBus | null;

  /** Tunable alarm cadence. `alarmActive` remains as the legacy alert-phase view. */
  alarm: AlarmState;

  constructor(grid: Grid, options: WorldOptions = {}) {
    if (!grid) throw new TypeError('World requires a grid');
    this.grid = grid;
    this.entities = new Map();
    this.events = options.events ?? null;
    this.alarm = quietAlarm();
  }

  get alarmActive(): boolean {
    return this.alarm.phase === ALARM_PHASE.ALERT;
  }

  set alarmActive(value: boolean) {
    if (value) {
      this.alarm = alertAlarm(this.alarm.triggers);
      return;
    }
    this.alarm = quietAlarm(this.alarm.triggers);
  }

  raiseAlarm(context: AlarmRaiseContext = {}): boolean {
    if (this.alarm.phase === ALARM_PHASE.ALERT) return false;
    const previous = { ...this.alarm };
    this.alarm = alertAlarm(previous.triggers + 1);
    this.events?.emit(EVENT.ALARM, {
      ...context,
      previous,
      alarm: this.snapshotAlarm(),
    });
    this.events?.emit(EVENT.ALARM_CHANGED, {
      transition: 'raised',
      previous,
      alarm: this.snapshotAlarm(),
    });
    return true;
  }

  tickAlarm(): AlarmState {
    const previous = { ...this.alarm };
    if (this.alarm.phase === ALARM_PHASE.ALERT) {
      if (this.alarm.holdTurnsRemaining > 1) {
        this.alarm = {
          ...this.alarm,
          holdTurnsRemaining: this.alarm.holdTurnsRemaining - 1,
        };
        return this.snapshotAlarm();
      }
      this.alarm = {
        phase: ALARM_PHASE.COOLDOWN,
        level: 0,
        holdTurnsRemaining: 0,
        cooldownTurnsRemaining: ALARM_CADENCE.COOLDOWN_TURNS,
        triggers: this.alarm.triggers,
      };
      this.#emitAlarmChanged('cooldown', previous);
      return this.snapshotAlarm();
    }

    if (this.alarm.phase === ALARM_PHASE.COOLDOWN) {
      if (this.alarm.cooldownTurnsRemaining > 1) {
        this.alarm = {
          ...this.alarm,
          cooldownTurnsRemaining: this.alarm.cooldownTurnsRemaining - 1,
        };
        return this.snapshotAlarm();
      }
      this.alarm = quietAlarm(this.alarm.triggers);
      this.#emitAlarmChanged('quiet', previous);
      return this.snapshotAlarm();
    }

    return this.snapshotAlarm();
  }

  snapshotAlarm(): AlarmState {
    return { ...this.alarm };
  }

  restoreAlarm(alarm: AlarmState): void {
    this.alarm = normalizeAlarmState(alarm);
  }

  #emitAlarmChanged(transition: 'cooldown' | 'quiet', previous: AlarmState): void {
    this.events?.emit(EVENT.ALARM_CHANGED, {
      transition,
      previous,
      alarm: this.snapshotAlarm(),
    });
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
   * Dead entity on `(x, y)` with non-empty typed `loot.salvage`, if any. Scans
   * every occupant so co-located live + corpse (legal after moving onto a
   * body) still resolves the lootable target.
   */
  lootableCorpseAt(x: number, y: number): LootableEntity | null {
    for (const e of this.entities.values()) {
      if (e.x !== x || e.y !== y) continue;
      const loot = (e as LootableEntity).loot;
      if (!e.alive && loot && loot.salvage && totalSalvage(loot.salvage) > 0)
        return e as LootableEntity;
    }
    return null;
  }

  interactableAt(x: number, y: number): Interactable | null {
    const entity = this.entityAt(x, y);
    return entity instanceof Interactable ? entity : null;
  }

  adjacentInteractables(actor: Entity): Interactable[] {
    const interactables: Interactable[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const entity = this.interactableAt(actor.x + dx, actor.y + dy);
        if (entity) interactables.push(entity);
      }
    }
    return interactables;
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

function quietAlarm(triggers = 0): AlarmState {
  return {
    phase: ALARM_PHASE.QUIET,
    level: 0,
    holdTurnsRemaining: 0,
    cooldownTurnsRemaining: 0,
    triggers,
  };
}

function alertAlarm(triggers: number): AlarmState {
  return {
    phase: ALARM_PHASE.ALERT,
    level: 1,
    holdTurnsRemaining: ALARM_CADENCE.HOLD_TURNS,
    cooldownTurnsRemaining: 0,
    triggers,
  };
}

function normalizeAlarmState(alarm: AlarmState): AlarmState {
  if (!alarm || typeof alarm !== 'object') {
    throw new TypeError('World.restoreAlarm requires an alarm state object');
  }
  if (!Object.values(ALARM_PHASE).includes(alarm.phase)) {
    throw new Error(`World.restoreAlarm: unknown alarm phase "${alarm.phase}"`);
  }
  if (alarm.level !== 0 && alarm.level !== 1) {
    throw new RangeError(`World.restoreAlarm: level must be 0 or 1, got ${alarm.level}`);
  }
  if (!Number.isInteger(alarm.holdTurnsRemaining) || alarm.holdTurnsRemaining < 0) {
    throw new RangeError('World.restoreAlarm: holdTurnsRemaining must be a non-negative integer');
  }
  if (!Number.isInteger(alarm.cooldownTurnsRemaining) || alarm.cooldownTurnsRemaining < 0) {
    throw new RangeError(
      'World.restoreAlarm: cooldownTurnsRemaining must be a non-negative integer'
    );
  }
  if (!Number.isInteger(alarm.triggers) || alarm.triggers < 0) {
    throw new RangeError('World.restoreAlarm: triggers must be a non-negative integer');
  }
  if (alarm.phase === ALARM_PHASE.QUIET) {
    return quietAlarm(alarm.triggers);
  }
  if (alarm.phase === ALARM_PHASE.ALERT) {
    if (alarm.level !== 1 || alarm.holdTurnsRemaining < 1) {
      throw new Error('World.restoreAlarm: alert phase requires level 1 and hold turns');
    }
    return {
      phase: ALARM_PHASE.ALERT,
      level: 1,
      holdTurnsRemaining: alarm.holdTurnsRemaining,
      cooldownTurnsRemaining: 0,
      triggers: alarm.triggers,
    };
  }
  if (alarm.level !== 0 || alarm.cooldownTurnsRemaining < 1) {
    throw new Error('World.restoreAlarm: cooldown phase requires level 0 and cooldown turns');
  }
  return {
    phase: ALARM_PHASE.COOLDOWN,
    level: 0,
    holdTurnsRemaining: 0,
    cooldownTurnsRemaining: alarm.cooldownTurnsRemaining,
    triggers: alarm.triggers,
  };
}
