/**
 * Kernel Panic — game-domain constants.
 * Pure data; no DOM, no canvas, no DataStore. Safe to import from anywhere.
 */

/**
 * Tile types. Stored as small integers so a Grid can pack them into a typed
 * array.
 *
 * - FLOOR: passable, transparent.
 * - WALL: blocks movement and line of sight.
 * - COVER: blocks movement (Vault perk hops it), does NOT block LOS — instead
 *   grants a defender hit-modifier (applied in M4 combat).
 */
export const TILE = Object.freeze({
  FLOOR: 0,
  WALL: 1,
  COVER: 2,
});

export const FACTION = Object.freeze({
  PLAYER: 'player',
  CORP: 'corp',
  NEUTRAL: 'neutral',
});

/**
 * Action Point costs from the V1 blueprint. Centralised so tuning is one edit.
 */
export const AP_COST = Object.freeze({
  MOVE: 1,
  RANGED_ATTACK: 2,
  MELEE_ATTACK: 1,
  INTERACT: 1,
  // Archetype perks (proposed; tunable):
  VAULT: 3, // Merc — hop a cover tile while firing
  SLIDE: 2, // Razor — 2-tile reposition with stealth bonus
});

/**
 * Default AP per turn for an entity. Not in the blueprint — picked so that a
 * player can move-shoot-shoot OR move four tiles. Tune as combat lands.
 */
export const DEFAULT_AP = 4;

/**
 * Default hit points. V1 baseline — three shots to drop a generic entity. The
 * Merc and Razor will get archetype-specific values when their kits land.
 * Tunable per-entity via the constructor.
 */
export const DEFAULT_HP = 3;

/**
 * Ranged combat parameters. Hit chance is a probability in [0, 1] compared
 * against an RNG roll; cover applied when the line of fire crosses a COVER
 * tile (LineOfSight.hasCoverBetween). Damage is flat for V1 — no critical
 * tiers yet.
 */
export const BASE_HIT_CHANCE = 0.75;
export const COVER_HIT_PENALTY = 0.3;
export const RANGED_DAMAGE = 1;

/**
 * Melee combat. V1 keeps it deterministic — adjacency + AP buys a guaranteed
 * hit. Hit-chance can grow back when archetype kits (parry, dodge) land.
 * Damage is flat; bumped above ranged because melee requires standing on the
 * target's tile (a real positional cost).
 */
export const MELEE_DAMAGE = 2;

/**
 * How far an entity can see/shoot, in tiles. Enforced as a Euclidean
 * (circular) distance — `dx² + dy² ≤ SIGHT_RANGE²` — so an open shot at
 * (8, 0) is in range but (8, 8) is not. Combat and Vision share the
 * `withinRange` helper in `LineOfSight.js` so this geometry is one place.
 */
export const SIGHT_RANGE = 8;

/**
 * Noise radii (Euclidean tiles) for actions that emit `noise` events. The
 * blueprint's stealth loop pivots on this: louder actions reach more drones,
 * Slide is intentionally silent, ranged fire is the loudest signature in
 * V1. Tunable so a future suppressor / silenced loadout is one constant.
 *
 * Sentries within radius (and not in ENGAGE) latch onto the origin as
 * `lastKnownTarget`; same-faction noise is filtered at the listener so
 * drones don't investigate each other's footsteps.
 */
export const NOISE_RADIUS = Object.freeze({
  MOVE: 3,
  MELEE: 5,
  RANGED: SIGHT_RANGE, // a gunshot is heard as far as it could have travelled
});
