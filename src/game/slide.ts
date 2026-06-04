import { AP_COST } from './constants.js';
import { EVENT } from './events.js';
import type { Entity } from './Entity.js';
import type { World } from './World.js';
import type { GridPoint } from '../types.js';

export type SlideCheck = { ok: true } | { ok: false; reason: string };

/**
 * Shared two-tile SLIDE geometry for Razor and Flanker.
 * `dx`/`dy` are unit offsets; the committed move lands at `2 * offset`.
 */
export function canSlideTwoTiles(world: World, entity: Entity, dx: number, dy: number): SlideCheck {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
    throw new TypeError(`canSlideTwoTiles requires integer offsets, got (${dx}, ${dy})`);
  }
  if (dx === 0 && dy === 0) return { ok: false, reason: 'no-op' };
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return { ok: false, reason: 'too-far' };
  if (!entity.canAfford(AP_COST.SLIDE)) return { ok: false, reason: 'insufficient-ap' };
  if (!entity.alive) return { ok: false, reason: 'dead' };

  const stepX = entity.x + dx;
  const stepY = entity.y + dy;
  const landX = entity.x + 2 * dx;
  const landY = entity.y + 2 * dy;

  if (!world.grid.isPassable(stepX, stepY)) return { ok: false, reason: 'blocked-step' };
  if (world.entityAt(stepX, stepY)) return { ok: false, reason: 'occupied-step' };
  if (!world.grid.isPassable(landX, landY)) return { ok: false, reason: 'blocked' };
  if (world.entityAt(landX, landY)) return { ok: false, reason: 'occupied' };
  return { ok: true };
}

/**
 * Commit a silent two-tile slide. Emits `entity:moved`, never `noise`.
 */
export function slideTwoTiles(world: World, entity: Entity, dx: number, dy: number): GridPoint {
  const check = canSlideTwoTiles(world, entity, dx, dy);
  if (!check.ok) {
    throw new Error(`Illegal slide for ${entity.id}: ${check.reason}`);
  }
  const from = { x: entity.x, y: entity.y };
  entity.spendAp(AP_COST.SLIDE);
  entity.x += 2 * dx;
  entity.y += 2 * dy;
  world.events?.emit(EVENT.ENTITY_MOVED, {
    entity,
    from,
    to: { x: entity.x, y: entity.y },
  });
  return { x: entity.x, y: entity.y };
}
