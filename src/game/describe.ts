import { AP_COST, TILE } from './constants.js';
import type { TileId } from './constants.js';
import { entityLabel, type Entity, type LootableEntity } from './Entity.js';
import { formatSalvageCompact, totalSalvage } from './salvage.js';
import { Door } from './entities/Door.js';
import { Terminal } from './entities/Terminal.js';
import { Pickup } from './entities/Pickup.js';
import { Contact } from './entities/Contact.js';
import { SyncPad } from './entities/SyncPad.js';
import { ConsumablePickup } from './entities/ConsumablePickup.js';
import { KeyCard } from './entities/KeyCard.js';
import { BreachingCharge } from './entities/BreachingCharge.js';
import { EscortNpc } from './entities/EscortNpc.js';
import { DenyTarget } from './entities/DenyTarget.js';
import type { VisionField } from './Vision.js';
import type { World } from './World.js';

export type DescribeTileOptions = {
  vision?: VisionField;
};

export function describeTileAt(
  world: World,
  tx: number,
  ty: number,
  options: DescribeTileOptions = {}
): string | null {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) {
    throw new TypeError(`describeTileAt requires integer coords, got (${tx}, ${ty})`);
  }
  if (!world.grid.inBounds(tx, ty)) return "You can't see anything there.";

  const { vision } = options;
  if (vision && !vision.isVisible(tx, ty)) {
    if (!vision.hasSeen(tx, ty)) return "You haven't seen that tile.";
    const corpseLine = describeMemorisedCorpse(world, tx, ty, vision);
    if (corpseLine) return corpseLine;
    return describeTerrain(world.grid.tileAt(tx, ty) as TileId);
  }

  const topmost = world.entitiesAt(tx, ty).at(-1);
  if (topmost) return describeEntity(topmost, { visible: true });
  return describeTerrain(world.grid.tileAt(tx, ty) as TileId);
}

function describeMemorisedCorpse(
  world: World,
  tx: number,
  ty: number,
  vision: VisionField
): string | null {
  if (!vision.memorisedCorpses.has(`${tx},${ty}`)) return null;
  const body = world.entitiesAt(tx, ty).find(e => !e.alive);
  if (!body) return null;
  return `${describeCorpse(body, { visible: false })} (memory)`;
}

function describeEntity(entity: Entity, opts: { visible: boolean }): string {
  if (!entity.alive) return describeCorpse(entity, opts);

  const hub = describeHubEntity(entity);
  if (hub) return hub;

  if (entity instanceof Door) {
    return `${neutralLabel(entity.label)} — ${entity.locked ? 'locked' : 'open'}`;
  }
  if (entity instanceof Terminal) {
    return `${neutralLabel(entity.label)} — ${entity.sliced ? 'sliced' : 'armed'}`;
  }
  if (entity instanceof Pickup)
    return `${label(entity)} — ${entity.secured ? 'secured' : 'unsecured'}`;
  if (entity instanceof Contact) {
    return `${label(entity)} — ${entity.handoffComplete ? 'complete' : 'handoff pending'}`;
  }
  if (entity instanceof SyncPad)
    return `${label(entity)} — ${entity.synced ? 'synced' : 'pending'}`;
  if (entity instanceof ConsumablePickup) return `[Neutral] ${entity.label || 'Field cache'}`;
  if (entity instanceof KeyCard) return '[Neutral] Access keycard';
  if (entity instanceof BreachingCharge) return '[Neutral] Breaching charge — armed';
  if (entity instanceof EscortNpc)
    return `${label(entity)} — ${entity.activated ? 'linked' : 'waiting'}`;
  if (entity instanceof DenyTarget) return label(entity);

  return label(entity);
}

function describeCorpse(entity: Entity, opts: { visible: boolean }): string {
  const loot = (entity as LootableEntity).loot?.salvage;
  const base = `${label(entity)} corpse`;
  if (!opts.visible) return base;
  if (loot && totalSalvage(loot) > 0) {
    return `${base} — salvageable ${formatSalvageCompact(loot)}`;
  }
  return `${base} — stripped`;
}

function describeHubEntity(entity: Entity): string | null {
  switch (entity.id) {
    case 'curator':
      return 'Curator';
    case 'finn':
      return 'Finn — shop';
    case 'clinic':
      return 'Patch — clinic';
    case 'terminal':
      return 'Crew terminal';
    default:
      return null;
  }
}

function describeTerrain(tile: TileId): string | null {
  switch (tile) {
    case TILE.FLOOR:
      return null;
    case TILE.RUBBLE:
      return `Rubble — breach debris (${AP_COST.ENTER_RUBBLE} AP to enter)`;
    case TILE.WALL:
      return 'Wall — impassable';
    case TILE.COVER:
      return 'Cover — blocks movement';
    case TILE.EXIT:
      return 'Exit — extraction point';
    case TILE.SMOKE:
      return 'Smoke — blocks line of sight';
    case TILE.HAZARD:
      return 'Hazard — damage if you stand here';
    default:
      throw new Error(`describeTerrain: unknown tile id ${tile as number}`);
  }
}

function label(entity: Entity): string {
  return entityLabel(entity).replace(']', '] ');
}

function neutralLabel(value: string): string {
  return `[Neutral] ${value}`;
}
