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
 * - EXIT: passable, transparent; same walk rules as FLOOR but painted so the
 *   objective tile is visible. `Run` still tracks `exitTile` for transitions.
 * - RUBBLE: passable debris left by breaching charges; costs more AP to enter.
 */
export const TILE = Object.freeze({
  FLOOR: 0,
  WALL: 1,
  COVER: 2,
  EXIT: 3,
  SMOKE: 4,
  HAZARD: 5,
  RUBBLE: 6,
});

export const FACTION = Object.freeze({
  PLAYER: 'player',
  CORP: 'corp',
  NEUTRAL: 'neutral',
});

export const TERMINAL_GLYPH = '‡';
export const DOOR_LOCKED_GLYPH = '▪';
export const DOOR_OPEN_GLYPH = '▫';
export const PICKUP_GLYPH = '!';
export const CONTACT_GLYPH = '&';
export const DENY_TARGET_GLYPH = '◆';
export const SYNC_PAD_GLYPH = '§';
export const ESCORT_NPC_GLYPH = 'A';
export const KEYCARD_GLYPH = 'κ';

/** Numeric tile id — one of the `TILE` values. */
export type TileId = (typeof TILE)[keyof typeof TILE];

/** Faction string — one of the `FACTION` values. */
export type FactionId = (typeof FACTION)[keyof typeof FACTION];

/**
 * Action Point costs from the V1 blueprint. Centralised so tuning is one edit.
 */
export const AP_COST = Object.freeze({
  MOVE: 1,
  ENTER_RUBBLE: 2,
  RANGED_ATTACK: 2,
  MELEE_ATTACK: 1,
  INTERACT: 1,
  // Archetype perks (proposed; tunable):
  VAULT: 3, // Merc — hop a cover tile while firing
  SLIDE: 2, // Razor — 2-tile reposition with stealth bonus
  DEPLOY: 2, // Tech — place a turret on an adjacent tile
});

/**
 * Tech turret parameters. The turret is a placed grid entity (peer of
 * `Entity`, not an archetype) deployed by Tech at `AP_COST.DEPLOY`. Tunables:
 *   - `TURRET_MAX_HP` — destruction takes the same shots as a drone (3).
 *   - `TURRET_RANGE` — half the player's SIGHT_RANGE, so it cleans up adjacent
 *     drones but doesn't dominate the engagement.
 *   - `TURRET_DAMAGE` — flat 2; matches the Merc's heavy sidearm (see `MERC_RANGED_DAMAGE`).
 *   - `TURRET_SHOTS_PER_AFTERMATH` — two resolve passes per turret each player yield (2.6.5).
 * Deployed turrets copy the owner's {@link Crew.maxHp} at drop time (Armour Plating applies).
 */
export const TURRET_MAX_HP = 3;
export const TURRET_RANGE = 4;
export const TURRET_DAMAGE = 2;
/** Autofire passes per live player turret during {@link runPlayerAftermathSteps}. */
export const TURRET_SHOTS_PER_AFTERMATH = 2;
/** Per Ballistics Coil purchase — applies to owner ranged shots and deployed turrets. */
export const RANGED_DAMAGE_BONUS = 1;
export const RANGED_MAX_DAMAGE_BONUS = 1;

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
 * Melee combat. M7 adds a defender dodge roll so point-blank attacks keep
 * tension without becoming mushy. Damage is bumped above the old V1 value to
 * compensate for misses: when the blade connects, it should matter.
 */
export const DODGE_CHANCE = 0.2;
export const COVER_DODGE_BONUS = 0.1;
export const MELEE_DAMAGE = 3;

/**
 * Vault (Merc perk). Breach-and-clear slam: hop over cover, body-check a
 * hostile on the landing tile for VAULT_DAMAGE, knock them back 1 tile in
 * the vault direction. Repeatable (no one-shot gate). Damage matches melee
 * — the positional cost of lining up a clear knockback lane is the gate.
 */
export const VAULT_DAMAGE = 2;

/**
 * How far an entity can see/shoot, in tiles. Enforced as a Euclidean
 * (circular) distance — `dx² + dy² ≤ SIGHT_RANGE²` — so an open shot at
 * (8, 0) is in range but (8, 8) is not. Combat and Vision share the
 * `withinRange` helper in `LineOfSight.js` so this geometry is one place.
 */
export const SIGHT_RANGE = 8;

/**
 * Salvage parameters. Phase 2 salvage is generic units (no typed components).
 * Drone corpses drop a random amount in [DROP_MIN, DROP_MAX]; improvised
 * turrets cost IMPROVISED_TURRET_COST units from the crew member's inventory.
 */
/**
 * Hazard tile damage. Flat 1 HP per turn for any entity standing on a hazard
 * tile at the end of a round (resolved during player aftermath). Same damage
 * as a ranged shot — enough to punish loitering but survivable for a healthy
 * entity.
 */
export const HAZARD_DAMAGE = 1;

/** Flat damage from a detonating breaching charge (Chebyshev-1 blast). */
export const BREACH_BLAST_DAMAGE = 2;

export const BREACHING_CHARGE_GLYPH = 'ø';

/**
 * AP to spend when stepping onto a tile. Rubble uses ENTER_RUBBLE; all other
 * passable destinations use MOVE (including leaving rubble).
 */
export function moveStepApCost(destTile: TileId): number {
  return destTile === TILE.RUBBLE ? AP_COST.ENTER_RUBBLE : AP_COST.MOVE;
}

/**
 * Corp turret parameters. Stationary CORP-faction hostile that fires at
 * PLAYER entities during the corp turn. Range matches the player turret
 * (TURRET_RANGE) so the threat is symmetric; damage is flat 1 to match
 * drone/turret convention. HP is lower than a drone — they're infrastructure,
 * not combatants, and the player needs a fast way to neutralize a firing lane.
 */
export const CORP_TURRET_RANGE = 4;
export const CORP_TURRET_DAMAGE = 1;
export const CORP_TURRET_HP = 2;

/**
 * Relay node parameters. Destructible CORP-faction entity used as a sweep
 * target. Low HP — one ranged hit or melee strike takes it down. No AI,
 * no movement, no attack.
 */
export const RELAY_NODE_HP = 1;
export const DENY_TARGET_HP = 2;

export const SALVAGE_DROP_MIN = 1;
export const SALVAGE_DROP_MAX = 3;
export const SALVAGE_PER_IMPROVISED_TURRET = 2;

/**
 * Finn's shop — item tuning constants. Job-scoped consumables are lost on
 * job end; campaign-scoped gear persists until campaign wipe; meta upgrades
 * survive even a full campaign wipe.
 */
export const STIM_HEAL = 2;
export const SMOKE_RADIUS = 2;
export const SMOKE_DURATION_TURNS = 1;
/**
 * Incendiary bomb (M4.3): thrown along an aim direction (dx, dy) selected via
 * `MODE.AIM` with `aimKind: 'use-item'`. The target tile is `thrower + dir * INCENDIARY_THROW_DIST`;
 * LOS from thrower → target must be clear (no lobbing through walls). The
 * hazard cluster shape and size come from `placeHazardCluster` (M2.3 — a
 * 5–9 tile diamond/cross of `TILE.HAZARD`), so we don't need a separate
 * radius constant. Damage per tile is `HAZARD_DAMAGE` (M2.3).
 */
export const INCENDIARY_THROW_DIST = 3;
/** Breaching charges are placed against an adjacent tile/entity. */
export const BREACHING_CHARGE_RANGE = 1;
export const TARGETING_BONUS = 0.1;
export const DODGE_BONUS = 0.1;

/**
 * Legacy flat salvage-to-Cred rate. Retained for backward-compat references
 * (e.g. TRUSTED tier rewardFloorBump calculation). New sell paths use the
 * per-type `SALVAGE_SELL_RATE` instead.
 */
export const SALVAGE_TO_CRED_RATE = 10;

/**
 * M5.2: per-type salvage sell rates. Each salvage type has a distinct
 * Cred-per-unit value — makes typed salvage economically meaningful.
 *   Scrap  8 — common, lowest value (drone drops)
 *   Chips 12 — electronics (terminals, turrets, relays)
 *   Bio   15 — rare organic samples (clinic/bio pickups)
 *   Data  18 — informational (dossiers, ledgers, slices)
 */
export const SALVAGE_SELL_RATE = Object.freeze({
  scrap: 8,
  chips: 12,
  bio: 15,
  data: 18,
} as const);

export const SHOP_COST = Object.freeze({
  STIM: 20,
  SMOKE_CHARGE: 30,
  INCENDIARY: 40,
  BREACHING_CHARGE: 45,
  ARMOUR_PLATING: 60,
  TARGETING_CHIP: 80,
  REFLEX_WEAVE: 80,
  BALLISTICS_COIL: 80,
});

/** M5.3: Patch clinic — Creds per HP restored (partial heal not offered). */
export const CLINIC_COST_PER_HP = 15;

/**
 * Curator contract tiers (M8). `threatCount` is stored directly on each
 * generated contract; difficulty drives civilian caps and patrol pressure.
 */
export const CONTRACT_DIFFICULTY = Object.freeze({
  STANDARD: 'standard',
  ELEVATED: 'elevated',
  CRITICAL: 'critical',
});

export type ContractDifficulty = (typeof CONTRACT_DIFFICULTY)[keyof typeof CONTRACT_DIFFICULTY];

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

/**
 * Rep meter parameters. Campaign-level social standing — 0 (BURNED) to 100
 * (TRUSTED), starting at 50 (UNKNOWN). Adjusted by in-job events (kills,
 * alarms) and clean contract completions. Gates NeutralCivilian behaviour
 * (M5) and recruitment (M6).
 */
export const REP = Object.freeze({
  MIN: 0,
  MAX: 100,
  START: 20,
  /** Rep thresholds for NeutralCivilian behaviour. */
  NEUTRAL_IDLE_THRESHOLD: 70,
  NEUTRAL_FLEE_THRESHOLD: 30,
  /** Rep threshold for recruitment (M6). */
  RECRUIT_THRESHOLD: 65,
  /** Rep adjustments. */
  CLEAN_COMPLETION_BONUS: 10,
  CIVILIAN_KILL_PENALTY: -20,
  ALARM_PENALTY: -5,
  /** Rep cost for aborting a run (exiting without completing the objective). */
  ABORT_PENALTY: -10,
});

/**
 * Recruitment parameters (M6). Controls candidate pool size, campaign-start
 * picks, and archetype weight distribution.
 */
export const RECRUIT = Object.freeze({
  /** Mid-campaign: minimum recruits offered per hub visit (when Rep gate met). */
  POOL_MIN: 1,
  /** Mid-campaign: maximum recruits offered per hub visit. */
  POOL_MAX: 2,
  /** Campaign start: number of candidates generated. */
  INITIAL_CANDIDATES: 3,
  /** Campaign start: number the player must pick. */
  INITIAL_PICKS: 2,
});

/**
 * Rep tier definitions — each tier carries a label, a lower bound, and a
 * difficulty pool that the Curator uses when rolling contracts. Ordered from
 * highest to lowest so `repTierForRep(rep)` can do a simple first-match scan.
 *
 * M5.1: Replaces the old `better-contracts` meta upgrade. The player's
 * current Rep now determines the contract difficulty pool directly.
 */
export const REP_TIER = Object.freeze({
  BURNED: 'BURNED',
  UNKNOWN: 'UNKNOWN',
  KNOWN: 'KNOWN',
  TRUSTED: 'TRUSTED',
});

export type RepTierId = (typeof REP_TIER)[keyof typeof REP_TIER];

export type RepTierDef = {
  id: RepTierId;
  label: string;
  min: number;
  pool: readonly ContractDifficulty[];
  rewardFloorBump: number;
};

export const REP_TIERS: readonly RepTierDef[] = Object.freeze([
  Object.freeze({
    id: REP_TIER.TRUSTED,
    label: 'TRUSTED',
    min: 80,
    pool: Object.freeze([
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.ELEVATED,
      CONTRACT_DIFFICULTY.ELEVATED,
      CONTRACT_DIFFICULTY.ELEVATED,
      CONTRACT_DIFFICULTY.CRITICAL,
      CONTRACT_DIFFICULTY.CRITICAL,
      CONTRACT_DIFFICULTY.CRITICAL,
      CONTRACT_DIFFICULTY.CRITICAL,
    ]),
    rewardFloorBump: 2 * SALVAGE_TO_CRED_RATE,
  }),
  Object.freeze({
    id: REP_TIER.KNOWN,
    label: 'KNOWN',
    min: 50,
    pool: Object.freeze([
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.ELEVATED,
      CONTRACT_DIFFICULTY.ELEVATED,
      CONTRACT_DIFFICULTY.ELEVATED,
      CONTRACT_DIFFICULTY.ELEVATED,
      CONTRACT_DIFFICULTY.CRITICAL,
      CONTRACT_DIFFICULTY.CRITICAL,
    ]),
    rewardFloorBump: 0,
  }),
  Object.freeze({
    id: REP_TIER.UNKNOWN,
    label: 'UNKNOWN',
    min: 20,
    pool: Object.freeze([
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.ELEVATED,
      CONTRACT_DIFFICULTY.ELEVATED,
      CONTRACT_DIFFICULTY.ELEVATED,
      CONTRACT_DIFFICULTY.CRITICAL,
    ]),
    rewardFloorBump: 0,
  }),
  Object.freeze({
    id: REP_TIER.BURNED,
    label: 'BURNED',
    min: 0,
    pool: Object.freeze([
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
      CONTRACT_DIFFICULTY.STANDARD,
    ]),
    rewardFloorBump: 0,
  }),
]);

/**
 * Return the Rep tier definition for a given Rep value.
 * Scans from highest to lowest; the first tier whose `min` the value meets
 * or exceeds is the match. Falls back to BURNED (min 0) if nothing matches
 * (shouldn't happen unless Rep is negative, which is already clamped).
 */
export function repTierForRep(rep: number): RepTierDef {
  for (const tier of REP_TIERS) {
    if (rep >= tier.min) return tier;
  }
  return REP_TIERS[REP_TIERS.length - 1];
}

/**
 * Legacy compat alias — the shell uses `REP_LABEL` to look up the label for a
 * given Rep. Point it at the new `REP_TIERS` shape so existing call sites work
 * without changes.
 */
export const REP_LABEL = REP_TIERS;
