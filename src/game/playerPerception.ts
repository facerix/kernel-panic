/**
 * Player-perception helpers — what the deployed crew can see and target.
 * Hostile AI uses its own acquisition rules; these gates only affect the
 * shell (renderer, crew ranged/melee). Introduced for Sniper range conceal
 * (M3.2); Flanker cover conceal (M4.3) will extend this module.
 */

import { SNIPER_CONCEAL_MIN_RANGE } from './constants.js';
import { Sniper } from './ai/Sniper.js';
import type { Entity } from './Entity.js';

/**
 * True when `entity` should be hidden from the player's map view and direct
 * crew targeting. Today: a Sniper holding aim at Chebyshev ≥ 6 from the player.
 * Not active before aim commits — the sniper is visible during patrol.
 */
export function isConcealedFromPlayer(entity: Entity, player: Entity): boolean {
  if (!(entity instanceof Sniper)) return false;
  if (!entity.aimTargetId) return false;
  const cheb = Math.max(Math.abs(entity.x - player.x), Math.abs(entity.y - player.y));
  return cheb >= SNIPER_CONCEAL_MIN_RANGE;
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
