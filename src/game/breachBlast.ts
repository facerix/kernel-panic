import { BREACH_BLAST_DAMAGE, TILE } from './constants.js';
import { chebyshev } from './Pathfinding.js';
import { BreachingCharge } from './entities/BreachingCharge.js';
import { DenyTarget } from './entities/DenyTarget.js';
import { Door } from './entities/Door.js';
import { EVENT } from './events.js';
import type { Entity } from './Entity.js';
import type { World } from './World.js';

export type BlastCasualty = {
  entity: Entity;
  damage: number;
  killed: boolean;
};

export type BreachDetonationResult = {
  terrainBreached: number;
  casualties: BlastCasualty[];
};

/** Cells in a Chebyshev-1 blast (3×3) centered on `(cx, cy)`. */
export function blastCells(cx: number, cy: number): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      cells.push({ x: cx + dx, y: cy + dy });
    }
  }
  return cells;
}

export function isInBlast(cx: number, cy: number, x: number, y: number): boolean {
  return chebyshev(cx, cy, x, y) <= 1;
}

/**
 * Resolve one armed charge: terrain breach in radius, then entity blast damage.
 * Does not remove the charge entity — caller removes after yielding the step.
 */
export function detonateBreachingCharge(
  world: World,
  cx: number,
  cy: number
): BreachDetonationResult {
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) {
    throw new TypeError(`detonateBreachingCharge requires integer cx,cy; got (${cx}, ${cy})`);
  }
  let terrainBreached = 0;
  const processedDoors = new Set<string>();
  const processedDeny = new Set<string>();

  for (const { x, y } of blastCells(cx, cy)) {
    if (!world.grid.inBounds(x, y)) continue;

    if (world.grid.tileAt(x, y) === TILE.WALL) {
      world.breachWall(x, y);
      terrainBreached++;
    }

    const door = world.doorAt(x, y);
    if (door && door.locked && !processedDoors.has(door.doorId)) {
      world.breachDoor(door.doorId);
      processedDoors.add(door.doorId);
      terrainBreached++;
    }

    for (const entity of world.entities.values()) {
      if (!(entity instanceof DenyTarget) || !entity.requiresBreach || !entity.alive) continue;
      if (entity.x !== x || entity.y !== y || processedDeny.has(entity.id)) continue;
      entity.destroyByBreach();
      processedDeny.add(entity.id);
      terrainBreached++;
    }
  }

  const casualties: BlastCasualty[] = [];
  const damagedIds = new Set<string>();

  for (const entity of world.entities.values()) {
    if (!entity.alive) continue;
    if (entity instanceof BreachingCharge) continue;
    if (entity instanceof Door) continue;
    if (entity.isHazardImmune()) continue;
    if (!entity.isBlastDamageable()) continue;
    if (entity instanceof DenyTarget && entity.requiresBreach) continue;
    if (!isInBlast(cx, cy, entity.x, entity.y)) continue;
    if (damagedIds.has(entity.id)) continue;

    const damage = BREACH_BLAST_DAMAGE;
    const applied = entity.damage(damage);
    const killed = !entity.alive;
    damagedIds.add(entity.id);
    casualties.push({ entity, damage: applied, killed });

    world.events?.emit(EVENT.ENTITY_DAMAGED, {
      attacker: null,
      target: entity,
      damage: applied,
      killed,
      source: 'breach-blast',
    });
  }

  return { terrainBreached, casualties };
}
