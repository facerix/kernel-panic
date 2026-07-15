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
 *   grants a defender hit-modifier (applied in combat).
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
  // Phase 2.9: gang/street allegiance. A run carries exactly one hostile faction
  // (CORP for corp/civic principals, RIVAL for rival-group principals) — they do
  // not share a map yet (mixed encounters are deferred; see docs/kaizen.md).
  RIVAL: 'rival',
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
/** P3.M3.2: the Meatspace door into Cyberspace. */
export const JACK_IN_GLYPH = 'Ω';
/** P3.M3.3: the Cyberspace door back into Meatspace. */
export const ENTRY_PORT_GLYPH = '▼';
/** P3.M3.4: the slice target on the cyber grid (`◆` is DenyTarget's). */
export const DATA_NODE_GLYPH = '◈';
/** P3.M3.5: Probe ICE — the patrol/detector of the cyber grid. */
export const PROBE_ICE_GLYPH = '¶';
/** P3.M3: Spark ICE — the fast, fragile swarm attacker. */
export const SPARK_ICE_GLYPH = '×';
/** P3.M3: Guardian ICE — the heavy guard parked on critical data nodes. */
export const GUARDIAN_ICE_GLYPH = 'Ψ';

/** Numeric tile id — one of the `TILE` values. */
export type TileId = (typeof TILE)[keyof typeof TILE];

/** Faction string — one of the `FACTION` values. */
export type FactionId = (typeof FACTION)[keyof typeof FACTION];

/**
 * Phase 2.9: a run carries exactly one hostile faction, derived from the
 * contract principal's groups. Rival-group principals (gangs/street) spawn
 * `RIVAL`; corp *and* civic principals are "the establishment" and spawn `CORP`
 * (civic folds into corp — very cyberpunk). Mixed maps are deferred — see
 * docs/kaizen.md "Inter-hostile friction".
 */
export function factionForPrincipalGroups(groups: readonly string[]): FactionId {
  return groups.includes('rival') ? FACTION.RIVAL : FACTION.CORP;
}

/**
 * Status-effect ids for the generic duration-effect channel (`Entity.effects`,
 * P3.5.M1). Duration counts in "how many times the owning entity's own
 * `refreshAp()` fires" — a duration of 1 clears by that entity's next refresh,
 * the same semantics Razor's stealth cloak always had. No stacking; reapplying
 * overwrites. New effects are added here as their milestones land.
 *
 *   - `STEALTH` — Razor's slide cloak (migrated onto this channel in M1).
 *   - `STUN` — EMP neural-shock: the entity takes 0 AP on its stunned refresh
 *     (M2). Gated in `Entity.refreshAp` *before* the tick, so a duration of 1
 *     covers the upcoming refresh, not the one that just passed.
 *   - `SURGE` / `CRASH` — Berserk's chained self-buff and mandatory payback
 *     window (M3).
 */
export const STATUS_EFFECT = Object.freeze({
  STEALTH: 'stealth',
  STUN: 'stun',
  SURGE: 'surge',
  CRASH: 'crash',
});

export type StatusEffectId = (typeof STATUS_EFFECT)[keyof typeof STATUS_EFFECT];

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
  VAULT: 2, // Merc — hop a cover tile while firing
  SLIDE: 2, // Razor — 2-tile reposition with stealth bonus
  DEPLOY: 2, // Tech — place a turret on an adjacent tile
  INFLUENCE: 2, // Adept (Meatspace) + CyberAvatar (cyber grid) — flip a hostile's/ICE's allegiance (renamed from OVERRIDE, P3.5.M4)
  EMP: 2, // Decker — self-centered AOE neural-shock stun (P3.5.M2)
  SURGE: 2, // Berserk — self-buff that always chains into CRASH (P3.5.M3)
  NANITE_HEAL: 2, // Chimera — convert scrap salvage into HP (P3.5.M5)
});

/**
 * Berserk Surge/Crash tuning (P3.5.M3). Surge is a short, potent spike that
 * always chains into a deliberately heavier Crash — the payback outweighs the
 * high so the ability reads as a genuine gamble, not free value.
 *
 *   - `SURGE_ARMOR_BONUS` — flat `damageReduction` while SURGE is active. The
 *     frenzy shrugs off hits mid-spike; the bonus is computed on Berserk's
 *     `damageReduction` getter (never stored), so it can't leak into a save.
 *   - Crash is longer (3 refreshes) and bites harder (−2 AP, −0.2 hit) than the
 *     Surge it pays for — playtest-tuned so the comedown actually stings.
 */
export const SURGE_DURATION = 2;
export const SURGE_DAMAGE_BONUS = 1;
export const SURGE_AP_BONUS = 1;
export const SURGE_ARMOR_BONUS = 1;
export const CRASH_DURATION = 3;
export const CRASH_AP_PENALTY = 2;
export const CRASH_HIT_PENALTY = 0.2;

/**
 * Mind Influence parameters (renamed from Decker drone-override, P3.M2 →
 * P3.5.M4). The Adept's signature Meatspace ability psychically dominates a
 * hostile's will for a few turns by reusing the existing hostile AI with a
 * faction swap (the AI targets by faction, so a dominated hostile fights its
 * former allies for free). The CyberAvatar's cyber-grid Override against ICE
 * shares this exact same machinery (`mindInfluence.ts`) — only the fiction
 * differs between the two consumers, not the numbers.
 *
 *   - `INFLUENCE_RANGE` — reach for the intrusion, matched to baseline SIGHT
 *     so the operator must have a clean LOS lane like a ranged shot.
 *   - `INFLUENCE_DURATION` — turns the target stays player-aligned before its
 *     own will reasserts control and it reverts to its original faction.
 *   - `INFLUENCE_SUCCESS_CHANCE` — probability the intrusion takes. A failed
 *     attempt still burns AP and trips the facility alarm.
 */
export const INFLUENCE_RANGE = 5;
export const INFLUENCE_DURATION = 3;
export const INFLUENCE_SUCCESS_CHANCE = 0.6;

/**
 * Decker cyber stats (P3.M3.3). Named stats with real effects from day one
 * (scope decision #4):
 *   - `DECKER_BASE_RAM` — the avatar's HP pool on the cyber grid. ICE damage
 *     burns RAM; zero RAM = flatline (avatar death is real death).
 *   - `DECKER_BASE_INTRUSION` — slice progress added per data-node interact
 *     (P3.M3.4 consumes it).
 *   - `DECKER_BASE_ICE_RESISTANCE` — the avatar's `damageReduction`; the
 *     existing min-1 mitigation in `Combat.ts` applies unchanged.
 * Per-Decker overrides validate in the `Decker` ctor (crash on bad data).
 */
export const DECKER_BASE_RAM = 8;
export const DECKER_BASE_INTRUSION = 2;
export const DECKER_BASE_ICE_RESISTANCE = 1;

/**
 * Cyberspace avatar tuning (P3.M3.3). The avatar keeps the player AP budget
 * (4) and fights at the Merc's hit chance — the grid is the Decker's home
 * turf. `Combat.resolveRanged` capability-sniffs `baseHitChance`, so the
 * non-Crew avatar plugs into combat with zero combat-code changes.
 */
export const CYBER_AVATAR_MAX_AP = 4;
export const CYBER_AVATAR_HIT_CHANCE = 0.8;
/** P3.M4: explicit jack-out drops the link hard enough to hurt the body. */
export const JACK_OUT_SHOCK_DAMAGE = 3;

/**
 * Tech turret parameters. The turret is a placed grid entity (peer of
 * `Entity`, not an archetype) deployed by Tech at `AP_COST.DEPLOY`. Tunables:
 *   - `TURRET_MAX_HP` — destruction takes the same shots as a drone (3).
 *   - `TURRET_RANGE` — half the player's SIGHT_RANGE, so it cleans up adjacent
 *     drones but doesn't dominate the engagement.
 *   - `TURRET_DAMAGE` — flat 2; matches the Merc's heavy sidearm (see `MERC_RANGED_DAMAGE`).
 *   - `TURRET_SHOTS_PER_AFTERMATH` — two resolve passes per turret each player yield (2.6.5).
 * Deployed turrets always use `TURRET_MAX_HP` — they do not inherit the owner's
 * {@link Crew.maxHp} or body augments like Bone Lacing.
 */
export const TURRET_MAX_HP = 3;
export const TURRET_RANGE = 4;
export const TURRET_DAMAGE = 2;
/** Autofire passes per live player turret during {@link runPlayerAftermathSteps}. */
export const TURRET_SHOTS_PER_AFTERMATH = 2;
/** Per RiP Rounds purchase — applies to owner ranged shots and deployed turrets. */
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

/** Merc sidearm and player/corp turrets — overrides {@link RANGED_DAMAGE}. */
export const MERC_RANGED_DAMAGE = 2;

/**
 * Melee combat. Defenders get a dodge roll so point-blank attacks keep tension
 * without becoming mushy. Default crew melee is {@link MELEE_DAMAGE}; Razor
 * and elite corp melee override with {@link HEAVY_MELEE_DAMAGE}.
 */
export const DODGE_CHANCE = 0.2;
export const COVER_DODGE_BONUS = 0.1;
export const MELEE_DAMAGE = 2;

/** Razor blade and elite corp strike — overrides {@link MELEE_DAMAGE}. */
export const HEAVY_MELEE_DAMAGE = 3;

/**
 * Vault (Merc perk). Breach-and-clear slam in two modes:
 *   - **Hop:** vault over cover; body-check a hostile on the landing tile.
 *   - **Shove:** adjacent body-check; knock the target back and step away when clear.
 * Both deal VAULT_DAMAGE and knock the target back 1 tile in the aim direction
 * when the knockback lane is clear. Repeatable — AP cost is the gate.
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
 * Skirmisher kiting band (Phase 2.7 M2.1). A ranged fodder unit (`Skirmisher`)
 * retreats instead of firing when a target closes inside this Chebyshev
 * distance — i.e. `cheb(target) < PREFERRED_MIN` triggers a kite step if a
 * legal retreat tile that keeps LOS exists. At `3`, the skirmisher refuses to
 * fight within 2 tiles, opening real spacing pressure without backpedaling
 * across the whole map. Per-instance override via the constructor.
 */
export const PREFERRED_MIN = 3;

/**
 * Lookout vision range (Phase 2.7 M3.1). The mobile T2 specialist marks the
 * player for the fireteam at a longer reach than baseline `SIGHT_RANGE` (8) so
 * it can coordinate fire from a vantage the player hasn't closed on yet. `12`
 * is the playtest ceiling if `10` proves too short. The Sniper (`12`) reaches
 * further still; the lookout sits between fodder and sniper.
 */
export const LOOKOUT_SIGHT_RANGE = 10;

/**
 * Medic parameters (Phase 2.7 M3.3). The T2 support specialist changes fight
 * math by preserving a durable patient before the player can burst it down.
 * Shields are temporary HP stored on the patient and expire on that patient's
 * next AP refresh; healing is intentionally modest so focus-fire still works.
 */
export const MEDIC_SUPPORT_RANGE = 5;
export const MEDIC_SUPPORT_AP = 2;
export const MEDIC_HEAL_AMOUNT = 1;
export const MEDIC_SHIELD_HP = 2;

/**
 * Sniper parameters (Phase 2.7 M3.2). The T2 long-range specialist out-reaches
 * fodder (`SIGHT_RANGE` 8) and the lookout (10): it acquires and fires from
 * `SNIPER_SIGHT_RANGE` so the player must break LOS or close to answer it.
 *
 * It is **telegraphed** — aim on corp turn N, fire on N+1 — leaving a full
 * player turn of counterplay. `SNIPER_DAMAGE` (a guaranteed 3) is the heaviest
 * single hit on the board, so eating a held shot genuinely hurts.
 *
 * `SNIPER_CONCEAL_MIN_RANGE` is the Chebyshev distance at/above which a sniper
 * *holding aim* is hidden from the player (glyph + direct targeting); inside it
 * (≤ 5) the sniper is revealed and answerable. Player-perception only; turrets
 * and corp AI ignore it. Playtest ceiling 5–7.
 */
export const SNIPER_SIGHT_RANGE = 12;
export const SNIPER_DAMAGE = 3;
export const SNIPER_CONCEAL_MIN_RANGE = 6;

/**
 * Juggernaut parameters (Phase 2.7 M4.2). The T3 elite is the **Tech mirror** —
 * a walking suppression platform: high HP + armor, low AP, controlling a tighter
 * band than fodder. It acquires/patrols at the baseline `SIGHT_RANGE` (8) but
 * only *fires* inside `JUGGERNAUT_SUPPRESS_RANGE` (5) — tighter than a skirmisher,
 * wider than the player/corp turret bubble (4).
 *
 * Suppression is a cheap attrition chip: `JUGGERNAUT_SUPPRESS_AP` (1) per shot
 * for `JUGGERNAUT_SUPPRESS_DAMAGE` (1) damage. Lethal only over many turns —
 * dangerous while fodder/medics work, never a burst threat (no second verb).
 *
 * `JUGGERNAUT_PREFERRED_MIN` (3) is the band floor: the juggernaut band-kites
 * to maintain gunner distance (the skirmisher kite, scoped to suppress range)
 * rather than panic-fleeing. Cornered at point-blank (adjacent, no band-kite
 * tile) it body-checks the target one tile away — a **no-damage knockback** that
 * reopens the band so it can resume suppressing. This is a defensive spacing
 * reset, distinct from the Bruiser's offensive knockback-on-hit; a blocked lane
 * makes the juggernaut hold its ground instead.
 */
export const JUGGERNAUT_SUPPRESS_RANGE = 5;
export const JUGGERNAUT_SUPPRESS_AP = 1;
export const JUGGERNAUT_SUPPRESS_DAMAGE = 1;
export const JUGGERNAUT_PREFERRED_MIN = 3;
/** Base AP before the T3 elite `apBonus` (+1) — yields 4 AP at T3. */
export const JUGGERNAUT_BASE_AP = 3;

/**
 * Flanker parameters (Phase 2.7 M4.3). The T3 elite mirrors Razor's SLIDE:
 * a silent two-tile reposition that vanishes from player perception through
 * the entire following player turn. Base AP 3 plus the T3 elite bonus yields
 * the locked 4 AP cadence: slide (2) + optional stalk step (1), then strike on
 * the next corp turn after `slideConcealed` clears.
 */
export const FLANKER_BASE_AP = 3;

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
 * (TURRET_RANGE) so the threat is symmetric; damage matches {@link TURRET_DAMAGE}.
 * HP is lower than a drone — they're infrastructure,
 * not combatants, and the player needs a fast way to neutralize a firing lane.
 */
export const CORP_TURRET_RANGE = 4;
export const CORP_TURRET_DAMAGE = 2;
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
 * Chimera nanite-repair parameters (P3.5.M5). The Chimera's signature sustain
 * perk converts scrap salvage into HP — same resource-gate shape as Tech's
 * improvised turret (repeatable every turn, no per-job cap), reusing that
 * exact scrap price rather than inventing a new number.
 *
 *   - `NANITE_HEAL_AMOUNT` — flat HP restored per activation, clamped at
 *     maxHp by `Entity.heal`.
 *   - `SALVAGE_PER_NANITE_HEAL` — scrap cost, matched to
 *     {@link SALVAGE_PER_IMPROVISED_TURRET} so both scrap-gated perks compete
 *     for the same pool at the same price.
 */
export const NANITE_HEAL_AMOUNT = 1;
export const SALVAGE_PER_NANITE_HEAL = SALVAGE_PER_IMPROVISED_TURRET;

/**
 * Finn's shop — item tuning constants. Job-scoped consumables are lost on
 * job end; campaign-scoped gear persists until campaign wipe; meta upgrades
 * survive even a full campaign wipe.
 */
export const STIM_HEAL = 2;
export const SMOKE_RADIUS = 2;
export const SMOKE_DURATION_TURNS = 1;

/**
 * Decker EMP blast parameters (P3.5.M2). The Decker's Meatspace signature: a
 * self-centered neural-shock/EMP that stuns *everyone* alive in radius — friend
 * and foe alike, excepting only the Decker themselves. (matches the deliberately
 * blurred organic/mechanical enemy theming). A stunned entity takes 0 AP on its
 * next refresh (see `STATUS_EFFECT.STUN`).
 *
 *   - `EMP_RADIUS` — Chebyshev reach, matched to {@link SMOKE_RADIUS} (2): a
 *     "clears a room" footprint.
 *   - `EMP_STUN_DURATION` — one skipped activation per caught entity.
 */
export const EMP_RADIUS = SMOKE_RADIUS;
export const EMP_STUN_DURATION = 1;
/**
 * Incendiary bomb: thrown along an aim direction (dx, dy) selected via
 * `MODE.AIM` with `aimKind: 'use-item'`. The target tile is `thrower + dir *
 * INCENDIARY_THROW_DIST`; LOS from thrower → target must be clear (no lobbing
 * through walls). Hazard cluster shape and size come from `placeHazardCluster`
 * (5–9 tile diamond/cross of `TILE.HAZARD`). Damage per tile: `HAZARD_DAMAGE`.
 */
export const INCENDIARY_THROW_DIST = 3;
/** Breaching charges are placed against an adjacent tile/entity. */
export const BREACHING_CHARGE_RANGE = 1;
export const TARGETING_BONUS = 0.1;
export const DODGE_BONUS = 0.1;

/**
 * Net-new scoreable gear tuning (P3.M6.2). Each fills a stat channel that
 * existing shop gear never touched — the reward fiction is a stolen prototype,
 * not a bigger number on an existing chip (premium variants were rejected:
 * random unlock order and no equip limit make "bigger X" incoherent). Caps
 * mirror the {@link RANGED_DAMAGE_BONUS} pattern (bonus equals cap → a second
 * purchase is a harmless no-op).
 *
 *   - **Monoblade** (`MELEE_DAMAGE_BONUS`) — the Razor's signature attack had no
 *     gear path. +1 melee damage, applied via {@link Crew.meleeAttackDamage}.
 *   - **Subdermal Plating** (`ARMOR_BONUS`) — flat `damageReduction` (min-1 floor
 *     in `Combat.applyDamageReduction`); the channel existed but no crew gear set it.
 *   - **Adrenal Spike** (`AP_BONUS`) — +1 `maxAp`, the master action resource.
 *     Capped hard at 1: two extra AP would warp the turn economy.
 *   - **Phase Shield** (`SHIELD_REGEN`) — re-grants `shieldHp` at the start of each
 *     crew turn via {@link Crew.refreshAp}. Free and uncontested (unlike the
 *     Medic's AP-costed {@link MEDIC_SHIELD_HP}), so kept to +1.
 *   - **Regen Mesh** (`HP_REGEN`) — heals real HP each turn via the same refresh
 *     hook; slow in-combat sustain distinct from the shield's resettable buffer.
 */
export const MELEE_DAMAGE_BONUS = 1;
export const MELEE_MAX_DAMAGE_BONUS = 1;
export const ARMOR_BONUS = 1;
export const MAX_ARMOR_BONUS = 1;
export const AP_BONUS = 1;
export const MAX_AP_BONUS = 1;
export const SHIELD_REGEN = 1;
export const MAX_SHIELD_REGEN = 1;
export const HP_REGEN = 1;
export const MAX_HP_REGEN = 1;

/**
 * Legacy flat salvage-to-Cred rate. Retained for backward-compat references
 * (e.g. TRUSTED tier rewardFloorBump calculation). New sell paths use the
 * per-type `SALVAGE_SELL_RATE` instead.
 */
export const SALVAGE_TO_CRED_RATE = 10;

/**
 * Per-type salvage sell rates (P2.5.M5.2). Each type has a distinct
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
  MOLOTOV: 40,
  BREACHING_CHARGE: 45,
  BONE_LACING: 60,
  TARGETING_CHIP: 80,
  GHOST_WEAVE: 80,
  RIP_ROUNDS: 80,
  // Net-new scoreable gear (P3.M6.2) — priced above baseline KNOWN gear; the
  // reward is the unlock, the Cred cost is the install. Adrenal Spike (+1 AP)
  // is the priciest, matching its outsized impact on the turn economy.
  MONOBLADE: 90,
  SUBDERMAL_PLATING: 100,
  ADRENAL_SPIKE: 150,
  PHASE_SHIELD: 110,
  REGEN_MESH: 120,
});

/** Patch clinic — Creds per HP restored (partial heal not offered). */
export const CLINIC_COST_PER_HP = 15;

/**
 * Curator contract difficulty tiers. `threatCount` is stored directly on each
 * generated contract; difficulty drives civilian caps and patrol pressure.
 */
export const CONTRACT_DIFFICULTY = Object.freeze({
  STANDARD: 'standard',
  ELEVATED: 'elevated',
  CRITICAL: 'critical',
});

export type ContractDifficulty = (typeof CONTRACT_DIFFICULTY)[keyof typeof CONTRACT_DIFFICULTY];

/**
 * Enemy tier doctrine (Phase 2.7). Contract difficulty maps directly to the
 * roster tier used by encounter composition and role-specific stat scaling.
 */
export const ENEMY_TIER = Object.freeze({
  T1: 't1',
  T2: 't2',
  T3: 't3',
});

export type EnemyTier = (typeof ENEMY_TIER)[keyof typeof ENEMY_TIER];

export const ENEMY_ROLE = Object.freeze({
  FODDER: 'fodder',
  SPECIALIST: 'specialist',
  ELITE: 'elite',
});

export type EnemyRole = (typeof ENEMY_ROLE)[keyof typeof ENEMY_ROLE];

export type EnemyStatProfile = Readonly<{
  hpMultiplier: number;
  apBonus: number;
  armorFloor: number;
}>;

export type EnemyBaseStats = Readonly<{
  maxHp?: number;
  maxAp?: number;
  damageReduction?: number;
}>;

export type ResolvedEnemyStats = Readonly<{
  maxHp: number;
  maxAp: number;
  damageReduction: number;
}>;

const ENEMY_TIER_BY_DIFFICULTY: Record<ContractDifficulty, EnemyTier> = Object.freeze({
  [CONTRACT_DIFFICULTY.STANDARD]: ENEMY_TIER.T1,
  [CONTRACT_DIFFICULTY.ELEVATED]: ENEMY_TIER.T2,
  [CONTRACT_DIFFICULTY.CRITICAL]: ENEMY_TIER.T3,
});

const ENEMY_STAT_PROFILES: Record<EnemyRole, Record<EnemyTier, EnemyStatProfile>> = Object.freeze({
  [ENEMY_ROLE.FODDER]: Object.freeze({
    [ENEMY_TIER.T1]: Object.freeze({ hpMultiplier: 1, apBonus: 0, armorFloor: 0 }),
    [ENEMY_TIER.T2]: Object.freeze({ hpMultiplier: 1, apBonus: 0, armorFloor: 0 }),
    [ENEMY_TIER.T3]: Object.freeze({ hpMultiplier: 1, apBonus: 0, armorFloor: 0 }),
  }),
  [ENEMY_ROLE.SPECIALIST]: Object.freeze({
    [ENEMY_TIER.T1]: Object.freeze({ hpMultiplier: 1, apBonus: 0, armorFloor: 0 }),
    [ENEMY_TIER.T2]: Object.freeze({ hpMultiplier: 1, apBonus: 0, armorFloor: 0 }),
    [ENEMY_TIER.T3]: Object.freeze({ hpMultiplier: 1.25, apBonus: 0, armorFloor: 0 }),
  }),
  [ENEMY_ROLE.ELITE]: Object.freeze({
    [ENEMY_TIER.T1]: Object.freeze({ hpMultiplier: 1, apBonus: 0, armorFloor: 0 }),
    [ENEMY_TIER.T2]: Object.freeze({ hpMultiplier: 1.25, apBonus: 0, armorFloor: 0 }),
    [ENEMY_TIER.T3]: Object.freeze({ hpMultiplier: 1.5, apBonus: 1, armorFloor: 1 }),
  }),
});

export function enemyTierForDifficulty(difficulty: ContractDifficulty): EnemyTier {
  const tier = ENEMY_TIER_BY_DIFFICULTY[difficulty];
  if (!tier) {
    throw new Error(`Unknown contract difficulty "${difficulty}"`);
  }
  return tier;
}

export function enemyStatProfileFor(role: EnemyRole, tier: EnemyTier): EnemyStatProfile {
  const profile = ENEMY_STAT_PROFILES[role]?.[tier];
  if (!profile) {
    throw new Error(`Unknown enemy stat profile for role="${role}" tier="${tier}"`);
  }
  return profile;
}

export function resolveEnemyStats(
  base: EnemyBaseStats,
  role: EnemyRole,
  tier: EnemyTier
): ResolvedEnemyStats {
  const maxHp = base.maxHp ?? DEFAULT_HP;
  const maxAp = base.maxAp ?? DEFAULT_AP;
  const damageReduction = base.damageReduction ?? 0;
  if (!Number.isInteger(maxHp) || maxHp <= 0) {
    throw new RangeError(`resolveEnemyStats maxHp must be positive integer, got ${maxHp}`);
  }
  if (!Number.isInteger(maxAp) || maxAp < 0) {
    throw new RangeError(`resolveEnemyStats maxAp must be non-negative integer, got ${maxAp}`);
  }
  if (!Number.isInteger(damageReduction) || damageReduction < 0) {
    throw new RangeError(
      `resolveEnemyStats damageReduction must be non-negative integer, got ${damageReduction}`
    );
  }
  const profile = enemyStatProfileFor(role, tier);
  return Object.freeze({
    maxHp: Math.ceil(maxHp * profile.hpMultiplier),
    maxAp: maxAp + profile.apBonus,
    damageReduction: Math.max(damageReduction, profile.armorFloor),
  });
}

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
 * and recruitment.
 */
export const REP = Object.freeze({
  MIN: 0,
  MAX: 100,
  START: 20,
  /** Rep thresholds for NeutralCivilian behaviour. */
  NEUTRAL_IDLE_THRESHOLD: 70,
  NEUTRAL_FLEE_THRESHOLD: 30,
  /** Rep threshold for recruitment — matches KNOWN tier floor (50). */
  RECRUIT_THRESHOLD: 50,
  /** Rep adjustments. */
  CLEAN_COMPLETION_BONUS: 10,
  CIVILIAN_KILL_PENALTY: -20,
  ALARM_PENALTY: -5,
  /** Rep cost for aborting a run (exiting without completing the objective). */
  ABORT_PENALTY: -10,
});

/**
 * Recruitment parameters. Controls candidate pool size, campaign-start picks,
 * and archetype weight distribution.
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
 * Replaces the old `better-contracts` meta upgrade (removed in P2.5.M5.1).
 * The player's current Rep determines the contract difficulty pool directly.
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
