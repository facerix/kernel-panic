/**
 * Player-perception helpers — what the deployed crew can see and target.
 * Hostile AI uses its own acquisition rules; these gates only affect the
 * shell (renderer, crew ranged/melee). Sniper range conceal and Flanker
 * cover/slide conceal live here.
 */

import { SNIPER_CONCEAL_MIN_RANGE } from './constants.js';
import { Flanker } from './ai/Flanker.js';
import { Sniper } from './ai/Sniper.js';
import { hasConcealedLineOfSight } from './LineOfSight.js';
import { chebyshev } from './Pathfinding.js';
import type { Entity } from './Entity.js';
import type { World } from './World.js';

/**
 * True when `entity` should be hidden from the player's map view and direct
 * crew targeting. Sniper conceal is range-based while holding aim; Flanker
 * conceal is active after SLIDE or passive when cover occludes player LOS.
 */
export function isConcealedFromPlayer(entity: Entity, player: Entity, world?: World): boolean {
  if (entity instanceof Flanker) {
    if (entity.slideConcealed) {
      return chebyshev(entity.x, entity.y, player.x, player.y) > 1;
    }
    if (!world) return false;
    return !hasConcealedLineOfSight(world.grid, player.x, player.y, entity.x, entity.y, {
      blockers: world.blockerKeys(),
    });
  }

  if (entity instanceof Sniper) {
    if (!entity.aimTargetId) return false;
    return chebyshev(entity.x, entity.y, player.x, player.y) >= SNIPER_CONCEAL_MIN_RANGE;
  }

  return false;
}

/**
 * World tiles painted with the sniper aim crosshair during the telegraph
 * window. One entry per held shot (typically one sniper, one target).
 */
export function sniperAimOverlayTiles(world: { entities: ReadonlyMap<string, Entity> }): Array<{
  x: number;
  y: number;
}> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (const entity of world.entities.values()) {
    if (!(entity instanceof Sniper) || !entity.alive || !entity.aimTargetId) continue;
    const target = world.entities.get(entity.aimTargetId);
    if (!target?.alive) continue;
    tiles.push({ x: target.x, y: target.y });
  }
  return tiles;
}
