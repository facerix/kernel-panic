import { TILE } from './constants.js';
import type { Entity } from './Entity.js';
import type { World } from './World.js';
import type { GridPoint } from '../types.js';

/**
 * Unit vector pointing from `attacker` toward `target`, normalised to one of the
 * eight grid neighbours — i.e. the direction a body-check shoves the target
 * *away*. Returns `null` if the two share a tile. When both offsets are non-zero
 * but unequal, the larger axis wins (deterministic tie-break) so a shove stays
 * cardinal unless the displacement is genuinely diagonal. Shared by the
 * Bruiser's knockback-on-hit and the Juggernaut's cornered spacing shove.
 */
export function awayVector(attacker: Entity, target: Entity): GridPoint | null {
  const rawDx = target.x - attacker.x;
  const rawDy = target.y - attacker.y;
  if (rawDx === 0 && rawDy === 0) return null;

  const absDx = Math.abs(rawDx);
  const absDy = Math.abs(rawDy);
  if (absDx > absDy) return { x: Math.sign(rawDx), y: 0 };
  if (absDy > absDx) return { x: 0, y: Math.sign(rawDy) };
  return { x: Math.sign(rawDx), y: Math.sign(rawDy) };
}

export type KnockbackCheck =
  | { ok: true; reason?: never }
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
