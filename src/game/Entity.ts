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
  damageReduction?: number;
  /**
   * If true, the entity does not block movement or LOS — actors can walk
   * onto/through its tile, drones plan paths through it, and `World.entityAt`
   * / `blockerKeys` skip it. Default `false`. Used by walk-onto ConsumablePickup
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
  /**
   * Phase 2.9 principal theming. Diegetic name shown in log / describe / status
   * copy (e.g. `"Auditor"`), resolved from the contract principal at spawn via
   * `enemyAliases.aliasFor`. Undefined for un-aliased entities (player, props,
   * pre-2.9 saves) — `entityLabel` falls back to `kindFromId` then.
   */
  displayName?: string;
  /** Short bracket prefix, e.g. `"Matsuda"` → `[Matsuda]Auditor`. Undefined when no owner tag applies. */
  principalTag?: string;
}

/**
 * A grid-resident actor: player, drone, NPC. Pure data + AP/HP bookkeeping; no
 * AI here.
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
  shieldHp: number;
  damageReduction: number;
  alive: boolean;
  stealthed: boolean;
  passable: boolean;
  anchored: boolean;
  displayName?: string;
  principalTag?: string;

  constructor({
    id,
    x,
    y,
    faction,
    glyph,
    maxAp = DEFAULT_AP,
    maxHp = DEFAULT_HP,
    damageReduction = 0,
    passable = false,
    anchored = false,
    displayName,
    principalTag,
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
    if (!Number.isInteger(damageReduction) || damageReduction < 0) {
      throw new RangeError(
        `Entity damageReduction must be a non-negative integer, got ${damageReduction}`
      );
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
    this.shieldHp = 0;
    this.damageReduction = damageReduction;
    this.alive = true;
    /**
     * Stealth flag. The Razor's `slide` perk sets this true; it clears on the
     * archetype's next AP refresh (so it lasts through the corp turn but no
     * further). Generic so future cyberware (cloak, ghost-protocol) can flip
     * the same field without touching observer code. Skirmisher uses
     * `isSpottableBy` to honour it.
     */
    this.stealthed = false;
    this.passable = passable;
    this.anchored = anchored;
    this.displayName = displayName;
    this.principalTag = principalTag;
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
    this.shieldHp = 0;
  }

  /**
   * Restore HP without exceeding maxHp. Healing a corpse is a state bug:
   * revives need an explicit mechanic, not accidental negative damage.
   */
  heal(amount: number): number {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError(`heal amount must be a non-negative integer, got ${amount}`);
    }
    if (!this.alive) {
      throw new Error(`Cannot heal ${this.id}: already dead`);
    }
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  /**
   * Add temporary shield HP. Shields are intentionally short-lived; they are
   * cleared by `refreshAp`, which for corp units means "survives the player's
   * response window, expires before the next corp activation."
   */
  addShield(amount: number): number {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new RangeError(`shield amount must be a positive integer, got ${amount}`);
    }
    if (!this.alive) {
      throw new Error(`Cannot shield ${this.id}: already dead`);
    }
    this.shieldHp += amount;
    return amount;
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
    const shieldAbsorbed = Math.min(this.shieldHp, amount);
    this.shieldHp -= shieldAbsorbed;
    const hpDamage = amount - shieldAbsorbed;
    this.hp -= hpDamage;
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
  if (id.startsWith('guard')) return 'Guard';
  if (id.startsWith('bruiser')) return 'Bruiser';
  if (id.startsWith('juggernaut')) return 'Juggernaut';
  if (id.startsWith('flanker')) return 'Flanker';
  if (id.startsWith('lookout')) return 'Lookout';
  if (id.startsWith('sniper')) return 'Sniper';
  if (id.startsWith('medic')) return 'Medic';
  if (id.startsWith('neutral-civ')) return 'Civilian';
  if (id.startsWith('corp-civ')) return 'Staff';
  if (id.startsWith('terminal')) return 'Terminal';
  if (id.startsWith('pickup')) return 'Pickup';
  if (id.startsWith('contact')) return 'Contact';
  if (id.startsWith('deny-target')) return 'Asset';
  if (id.startsWith('sync-pad')) return 'Sync Pad';
  if (id.startsWith('corp-turret')) return 'Turret';
  if (id.startsWith('relay-node')) return 'Relay';
  if (id.startsWith('escort-npc')) return 'Escort';
  if (id.startsWith('keycard')) return 'Keycard';
  if (id.startsWith('jack-in')) return 'Jack-in Port';
  if (id.startsWith('cyber-avatar')) return 'Avatar';
  if (id.startsWith('entry-port')) return 'Exit Port';
  if (id.startsWith('data-node')) return 'Data Node';
  if (id.startsWith('probe-ice')) return 'Probe';
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

type LabelableEntity = {
  id: string;
  faction: string;
  callsign?: string | null;
  displayName?: string;
  principalTag?: string;
  maxAp: number;
  hp: number;
  maxHp: number;
  shieldHp: number;
};

/**
 * Player-facing label for an entity, in priority order:
 *   1. `callsign` — crew members (e.g. `Vega`).
 *   2. Phase 2.9 principal identity — `[principalTag]displayName` (e.g.
 *      `[Matsuda]Auditor`), or bare `displayName` if no tag applies.
 *   3. Legacy `[Faction]Kind` from the id prefix (e.g. `[Corp]Drone`,
 *      `[Neutral]Civilian`, `Turret`) — un-aliased entities and pre-2.9 saves.
 */
export function entityLabel(entity: LabelableEntity, showStats: boolean = false): string {
  if (entity.callsign) return entity.callsign;
  const stats = `${entity.hp}/${entity.maxHp} HP, ${entity.maxAp} AP${entity.shieldHp > 0 ? `, ${entity.shieldHp} shield` : ''}`;
  if (entity.displayName) {
    const tag = entity.principalTag ? `[${entity.principalTag}]` : '';
    return `${tag}${entity.displayName}${showStats ? ` (${stats})` : ''}`;
  }
  return `${factionTag(entity.faction)}${kindFromId(entity.id)}${showStats ? ` (${stats})` : ''}`;
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
