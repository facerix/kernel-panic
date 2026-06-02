import { TILE } from './constants.js';
import type { Entity } from './Entity.js';
import type { World } from './World.js';

export type KnockbackCheck =
  | { ok: true }
  | { ok: false; reason: 'knockback-oob' | 'knockback-blocked' | 'knockback-occupied' };

export function canKnockbackTo(world: World, entity: Entity, x: number, y: number): KnockbackCheck {
  if (!world.grid.inBounds(x, y)) {
    return { ok: false, reason: 'knockback-oob' };
  }
  const tile = world.grid.tileAt(x, y);
  if (!world.grid.isPassable(x, y) && tile !== TILE.COVER) {
    return { ok: false, reason: 'knockback-blocked' };
  }
  const occupant = world.entityAt(x, y);
  if (occupant && occupant !== entity) {
    return { ok: false, reason: 'knockback-occupied' };
  }
  return { ok: true };
}

export function canKnockbackByOffset(
  world: World,
  entity: Entity,
  dx: number,
  dy: number
): KnockbackCheck {
  return canKnockbackTo(world, entity, entity.x + dx, entity.y + dy);
}

export function knockbackByOffset(
  world: World,
  entity: Entity,
  dx: number,
  dy: number
): { x: number; y: number } | null {
  const to = { x: entity.x + dx, y: entity.y + dy };
  const check = canKnockbackTo(world, entity, to.x, to.y);
  if (!check.ok) return null;
  world.relocateEntity(entity, to.x, to.y, { allowCover: true });
  return to;
}
