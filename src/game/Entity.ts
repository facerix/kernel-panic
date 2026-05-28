import { DEFAULT_AP, DEFAULT_HP, FACTION, type FactionId } from './constants.js';
import type { TurnActionStep, TurnActionSteps } from '../types.js';
import type { Rng } from '../rng.js';
import type { World } from './World.js';
import type { TypedSalvage } from './salvage.js';

export interface EntityInit {
  id: string;
  x: number;
  y: number;
  faction: FactionId;
  glyph?: string;
  maxAp?: number;
  maxHp?: number;
  /**
   * If true, the entity does not block movement or LOS — actors can walk
   * onto/through its tile, drones plan paths through it, and `World.entityAt`
   * / `blockerKeys` skip it. Default `false`. Used by M4.3 ConsumablePickup
   * (loose items on the floor) and reserved for future walk-through props
   * (floor signs, location markers).
   *
   * This is a separate axis from `alive`: a passable entity is still alive
   * for rendering purposes (full-bright glyph, not corpse styling), it just
   * doesn't physically obstruct the grid.
   */
  passable?: boolean;
  /**
   * If true, this entity is permanently fixed to its placement tile — it
   * cannot move or be moved during gameplay. Used by the placement integrity
   * check to identify entities that can permanently seal a corridor if placed
   * on a chokepoint. Default `false`.
   *
   * Typical anchored entities: terminals, deny targets, sync pads, escort NPCs.
   * Typical non-anchored: player, drones, civilians (they can walk off a tile).
   * Doors are anchored but handled separately (they unlock to become passable).
   */
  anchored?: boolean;
}

/**
 * A grid-resident actor: player, drone, NPC. Pure data + AP/HP bookkeeping; no
 * AI here — drone behaviour lands in M5.
 *
 * Crashes on illegal AP spend or negative damage rather than clamping
 * silently — a bug that spends 3 AP from a 1-AP pool, or rolls negative
 * damage, is data corruption we want surfaced early.
 */
export interface LootableEntity extends Entity {
  loot: { salvage: TypedSalvage };
}

export class Entity {
  id: string;
  x: number;
  y: number;
  faction: FactionId;
  glyph: string;
  maxAp: number;
  ap: number;
  maxHp: number;
  hp: number;
  alive: boolean;
  stealthed: boolean;
  passable: boolean;
  anchored: boolean;

  constructor({
    id,
    x,
    y,
    faction,
    glyph,
    maxAp = DEFAULT_AP,
    maxHp = DEFAULT_HP,
    passable = false,
    anchored = false,
  }: EntityInit) {
    if (id === undefined || id === null || id === '') {
      throw new TypeError('Entity requires a non-empty id');
    }
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new TypeError(`Entity requires integer x,y; got (${x}, ${y})`);
    }
    if (!faction) {
      throw new TypeError('Entity requires a faction');
    }
    if (!Number.isInteger(maxAp) || maxAp < 0) {
      throw new RangeError(`Entity maxAp must be a non-negative integer, got ${maxAp}`);
    }
    if (!Number.isInteger(maxHp) || maxHp <= 0) {
      throw new RangeError(`Entity maxHp must be a positive integer, got ${maxHp}`);
    }
    this.id = id;
    this.x = x;
    this.y = y;
    this.faction = faction;
    this.glyph = glyph ?? '?';
    this.maxAp = maxAp;
    this.ap = maxAp;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.alive = true;
    /**
     * Stealth flag. The Razor's `slide` perk sets this true; it clears on the
     * archetype's next AP refresh (so it lasts through the corp turn but no
     * further). Generic so future cyberware (cloak, ghost-protocol) can flip
     * the same field without touching observer code. CorpDrone uses
     * `isSpottableBy` to honour it.
     */
    this.stealthed = false;
    this.passable = passable;
    this.anchored = anchored;
  }

  canAfford(cost: number): boolean {
    return this.ap >= cost;
  }

  /** Environmental hazards skip entities that override this to `true`. */
  isHazardImmune(): boolean {
    return false;
  }

  /** Breaching-charge blasts skip entities that override this to `false`. */
  isBlastDamageable(): boolean {
    return true;
  }

  /**
   * Whether `observer` can perceive this entity right now. Default yes;
   * stealthed entities require Chebyshev adjacency (dx,dy ∈ [-1,1]) — slide
   * past a sentry and you're invisible until you bump into them. Drones
   * call this *after* their LOS+range check, so a peeking sentry still has
   * to physically see the tile, just not the actor on it.
   */
  isSpottableBy(observer: { x: number; y: number }): boolean {
    if (!this.stealthed) return true;
    const dx = Math.abs(observer.x - this.x);
    const dy = Math.abs(observer.y - this.y);
    return Math.max(dx, dy) <= 1;
  }

  spendAp(cost: number): void {
    if (!Number.isInteger(cost) || cost < 0) {
      throw new RangeError(`AP cost must be a non-negative integer, got ${cost}`);
    }
    if (cost > this.ap) {
      throw new Error(`Insufficient AP: have ${this.ap}, need ${cost}`);
    }
    this.ap -= cost;
  }

  refreshAp(): void {
    this.ap = this.maxAp;
  }

  /**
   * Apply damage. Crashes on negative or non-integer input — silent clamping
   * here would mask combat bugs (e.g. negative damage healing the target).
   * Reaching 0 HP flips `alive` to false; further damage on a corpse throws.
   */
  damage(amount: number): number {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError(`damage amount must be a non-negative integer, got ${amount}`);
    }
    if (!this.alive) {
      throw new Error(`Cannot damage ${this.id}: already dead`);
    }
    const before = this.hp;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return before - this.hp;
  }
}

// Class + interface merge is the usual TS pattern for optional hooks on a
// base class; oxlint flags it — the runtime class has no duplicate fields.
// oxlint-disable-next-line typescript-eslint(no-unsafe-declaration-merging)
export interface Entity {
  takeTurn?(world: World, rng: Rng): void | TurnActionStep[];
  takeTurnSteps?(world: World, rng: Rng): TurnActionSteps;
}

// ---------------------------------------------------------------------------
// Display labels — human-readable names for log messages
// ---------------------------------------------------------------------------

/**
 * Derive a kind label from an entity ID's prefix convention.
 * IDs follow `<kind>-<index>` (e.g. `drone-0`, `neutral-civ-2`).
 */
function kindFromId(id: string): string {
  if (id.startsWith('drone')) return 'Drone';
  if (id.startsWith('neutral-civ')) return 'Civilian';
  if (id.startsWith('corp-civ')) return 'Civilian';
  if (id.startsWith('terminal')) return 'Terminal';
  if (id.startsWith('pickup')) return 'Pickup';
  if (id.startsWith('contact')) return 'Contact';
  if (id.startsWith('deny-target')) return 'Asset';
  if (id.startsWith('sync-pad')) return 'Sync Pad';
  if (id.startsWith('corp-turret')) return 'Turret';
  if (id.startsWith('relay-node')) return 'Relay';
  if (id.startsWith('escort-npc')) return 'Escort';
  if (id.startsWith('keycard')) return 'Keycard';
  if (id.includes('turret')) return 'Turret';
  if (id.startsWith('crew')) return 'Operative';
  return id;
}

function factionTag(faction: string): string {
  switch (faction) {
    case FACTION.CORP:
      return '[Corp]';
    case FACTION.NEUTRAL:
      return '[Neutral]';
    case FACTION.PLAYER:
      // Player-faction entities (crew, turrets) don't need a tag —
      // they're identified by callsign or kind alone.
      return '';
    default:
      return `[${faction}]`;
  }
}

/**
 * Player-facing label for an entity: callsign for crew members,
 * `[Faction]Kind` for everyone else (e.g. `[Corp]Drone`, `[Neutral]Civilian`,
 * `Turret`).
 */
export function entityLabel(entity: {
  id: string;
  faction: string;
  callsign?: string | null;
}): string {
  if (entity.callsign) return entity.callsign;
  return `${factionTag(entity.faction)}${kindFromId(entity.id)}`;
}

/**
 * Resolve a string entity ID to a display label using a World's entity map.
 * Falls back to `kindFromId` if the entity isn't found (e.g. already removed).
 */
export function resolveEntityLabel(
  id: string,
  entities: { get(id: string): Entity | undefined }
): string {
  const e = entities.get(id);
  if (e) return entityLabel(e as Entity & { callsign?: string | null });
  // Entity gone (dead + removed) — best-effort from the ID pattern.
  return kindFromId(id);
}
