/*
 * Homeless types — structural contracts that don't belong to a single class.
 *
 * Class-backed types (Entity, Grid, World, EventBus, TurnQueue, Rng) live in
 * their own files.  Consumers that need the shape without a runtime dependency
 * use `import type { Entity } from './game/Entity.js'` — the import is erased
 * at compile time, so no circular runtime imports.
 *
 * This file stays import-free so `Entity` (and others) can reference turn-step
 * shapes without circular module graphs.
 */

/** Integer tile on the tactical grid. */
export type GridPoint = { x: number; y: number };

/** Phase 3 campaign arc stage, shared by Campaign saves and Curator contract context. */
export type CampaignArcStage = 'act-1' | 'act-2' | 'act-3' | 'score';

/** Why a campaign reached `ENDED` — drives terminal debrief copy in the shell. */
export type CampaignEndReason = 'crew-wipe' | 'clock-expired' | 'score-complete';

/**
 * A JSON-safe value. The persistence layer's opaque entity property bag
 * (`EntitySnapshotExtra`) is keyed to this so anything stashed in a snapshot
 * survives `JSON.stringify` / `JSON.parse` byte-for-byte. `undefined` is
 * deliberately excluded — it is not JSON, so bag fields use `null` instead.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Opaque per-entity property bag at the centre of `RunEntitySnapshot`
 * (P2.7.M6.2). Each archetype owns the strict shape of its own slice
 * (exported as `XSnapshot` from the entity module); the centre type only knows
 * it is a JSON object. This dissolves the former ~24-key god-union.
 */
export type EntitySnapshotExtra = { [key: string]: JsonValue };

/**
 * Terrain-relevant mutations captured during a run (P2.5.M7.1). Location
 * memory (P2.5.M7.2) consumes these deltas when persisting site changes.
 */
export type TileDelta =
  | { kind: 'tile'; x: number; y: number; from: number; to: number }
  | { kind: 'entity-removed'; id: string; x: number; y: number; archetype: string };

/**
 * Outcome of a committed ranged shot (`resolveRanged`). Shared with turn logs
 * and any UI that replays combat ticks.
 */
export type RangedAttackResult = {
  hit: boolean;
  roll: number;
  threshold: number;
  inCover: boolean;
  damage: number;
  killed: boolean;
};

/** Outcome of a committed melee strike (`resolveMelee`). */
export type MeleeAttackResult = {
  hit: boolean;
  dodged: boolean;
  roll: number;
  dodgeThreshold: number;
  inCover: boolean;
  damage: number;
  killed: boolean;
};

/** Movement yields from `PatrolHostile` pathing (`stepToward`). */
export type PatrolHostileMoveKind = 'engage' | 'investigate' | 'patrol';

export type PatrolHostileMoveStep = {
  type: `move-${PatrolHostileMoveKind}`;
  to: GridPoint;
};

/**
 * One yield from `PatrolHostile#takeTurnSteps` — a discrete committed mutation or
 * a no-AP status line the shell can still pace (patrol-arrived, etc.).
 */
export type PatrolHostileTurnStep =
  | { type: 'fire'; target: string; result: RangedAttackResult }
  // `melee` is shared by all PatrolHostiles — Guard's close-and-strike
  // counterpart to the skirmisher's `fire`. Lives in this union so the corp-turn
  // driver, status copy, and tests treat every patrol-hostile yield uniformly.
  | { type: 'melee'; target: string; result: MeleeAttackResult; knockback?: GridPoint | null }
  | { type: 'fire-blocked'; reason: string }
  | { type: 'investigate-cleared' }
  | { type: 'investigate-abandoned' }
  | { type: 'patrol-arrived'; waypoint: GridPoint }
  | { type: 'patrol-skipped'; waypoint: GridPoint }
  | PatrolHostileMoveStep;

/** CorpCivilian alarm step — yielded when a corp non-combatant spots the player. */
export type CorpCivilianTurnStep = { type: 'alarm'; target: string };

/**
 * Lookout target-share step (Phase 2.7 M3.1) — yielded each corp turn the
 * lookout holds LOS and pings the fireteam with the target's fresh coords. The
 * lookout never attacks, so this is its only combat-relevant yield.
 */
export type LookoutTurnStep = { type: 'spot'; target: string };

/**
 * Medic support steps (Phase 2.7 M3.3). `heal` restores real HP; `shield`
 * grants temporary shield HP that absorbs damage before health and expires on
 * the patient's next AP refresh.
 */
export type MedicTurnStep =
  | { type: 'heal'; target: string; amount: number }
  | { type: 'shield'; target: string; amount: number };

/**
 * Sniper telegraph steps (Phase 2.7 M3.2). `aim` is yielded the corp turn the
 * sniper commits a held shot (target marked, crosshair painted, no NOISE);
 * `aim-cancelled` when that shot is voided at fire time (target dead, out of
 * range, LOS broken, or re-stealthed). The shot itself reuses the shared `fire`
 * step so combat logging/visibility stay uniform.
 */
export type SniperTurnStep =
  | { type: 'aim'; target: string }
  | { type: 'aim-cancelled'; reason: string };

/**
 * Juggernaut steps (Phase 2.7 M4.2). `suppress` is the 1-AP / 1-damage chip from
 * the suppress band (carries the `RangedAttackResult` so logging/visibility treat
 * it like any incoming fire). `shove` is the cornered, point-blank **body-check**:
 * a no-damage knockback that pushes the target one tile away (to `to`) to reopen
 * the band so the elite can resume suppressing — distinct from the Bruiser's
 * offensive knockback-on-hit. Only emitted when the lane is clear; a blocked lane
 * makes the juggernaut hold its ground (no step).
 */
export type JuggernautTurnStep =
  | { type: 'suppress'; target: string; result: RangedAttackResult }
  | { type: 'shove'; target: string; to: GridPoint };

/** Flanker SLIDE — a silent two-tile reposition that vanishes from player view. */
export type FlankerTurnStep = { type: 'slide'; to: GridPoint };

/**
 * Probe ICE trace flare (P3.M3.5) — yielded the moment a probe's acquisition
 * actually raises the cyber alarm (the raise self-gates while already ALERT),
 * dragging every listening probe onto the avatar.
 */
export type ProbeIceTurnStep = { type: 'trace-alarm'; target: string };

/** NeutralCivilian aftermath steps — yielded during the player aftermath phase. */
export type NeutralCivilianTurnStep =
  | { type: 'neutral-idle' }
  | { type: 'neutral-flee'; to: GridPoint }
  | { type: 'neutral-cornered' }
  | { type: 'neutral-panic' };

/**
 * Discriminated union of every paced turn-step yield today. New step-aware
 * AIs should extend this union so `corpTurnDriver` and tests can treat
 * generators uniformly.
 */
export type TurnActionStep =
  | PatrolHostileTurnStep
  | CorpCivilianTurnStep
  | LookoutTurnStep
  | MedicTurnStep
  | SniperTurnStep
  | JuggernautTurnStep
  | FlankerTurnStep
  | ProbeIceTurnStep
  | NeutralCivilianTurnStep;

/**
 * Generator contract for entities the corp turn driver paces one yield at a
 * time (`takeTurnSteps`). Completion value is always `void`; callers only
 * read `IteratorResult.value`.
 */
export type TurnActionSteps = Generator<TurnActionStep, void, undefined>;

/**
 * Key-item — keycards used to unlock doors (P2.5.M6.2). Comes in two scopes:
 *   - **Campaign-scoped** (`siteId` set): stored in `Campaign.keyItems`,
 *     survives across runs. Not consumed on use (P2.5.M7.2 revisit).
 *   - **Run-scoped** (no `siteId`): stored in `Run.keyItems`, discarded
 *     when the run ends.
 */
export type KeyItem = {
  /** Unique id (e.g. `'keycard-door-0-<seed>'`). */
  id: string;
  /** Display label for UI / log. */
  label: string;
  /** Stable `doorId` of the door this key opens. */
  doorId: string;
  /** Optional site id — populated by P2.5.M7.2 location memory. */
  siteId?: string;
};

/**
 * Structural mirror of Curator's `ContractContextToken` (this file stays
 * import-free). A tagged lexicon token: stable id, display label, group tags.
 */
export type LocationToken = { id: string; label: string; groups: string[] };

/**
 * A remembered combat location in the campaign's site roster (P2.5.M7.2).
 * When the Curator sends the player back to a roster site, the map is rebuilt
 * from `seed` and the accumulated `mutationDeltas` (breach holes, removed
 * doors) are replayed onto the fresh geometry before fresh enemies/objectives
 * spawn.
 *
 * A location's *identity* is its **principal** (and **site**): revisits pin
 * those tokens so the owner/place stay constant across visits while the job
 * (objective/asset/action) is rolled fresh. `label` is the name from the most
 * recent generation.
 *
 * `tier` / `scoreTarget` reserve one slot for Phase 3's "Score target" site.
 */
export type LocationSite = {
  /** Stable, seed-derived id — the roster key. */
  id: string;
  /** Deterministic map seed (stringified contract seed). */
  seed: string;
  /** Persisted combat map width. Missing in legacy saves normalizes to 24. */
  mapWidth: number;
  /** Persisted combat map height. Missing in legacy saves normalizes to 16. */
  mapHeight: number;
  /** Flavor label carried over from the contract that first visited. */
  label: string;
  /** Roster tier — `'score'` is reserved for Phase 3 and never evicted. */
  tier: 'score' | 'roster';
  /** Phase 3 hook — true for the single campaign Score target. */
  scoreTarget: boolean;
  /** Accumulated terrain mutations replayed on revisit. */
  mutationDeltas: TileDelta[];
  /** Coordinate keys ("x,y") explored across all prior visits. */
  seenKeys: string[];
  /** `campaign.completedJobs` at the most recent visit (eviction ordering). */
  lastVisitedJob: number;
  /**
   * Owning principal token — the location's identity. Pinned on revisit so the
   * place keeps a consistent operator. Optional for pre-pinning saves.
   */
  principal?: LocationToken;
  /** Site token (e.g. "Sublevel 3"), when the originating recipe used one. */
  site?: LocationToken;
};

export type GameOverCrewStub = { callsign: string; archetype: string; flatlined: boolean };

/** Terminal campaign loss — crew wipe, clock deadline, or last-operator death. */
export type GameOverTelemetry = {
  campaignEndReason?: Exclude<CampaignEndReason, 'score-complete'>;
  campaignTerminal?: boolean;
  crewRoster?: GameOverCrewStub[];
  salvage?: import('./game/salvage.js').TypedSalvage;
  seed?: number;
  cause?: string | null;
  archetype?: string;
};

export type Telemetry = {
  outcome: 'death' | 'exit' | 'campaign-over';
  campaignEndReason?: CampaignEndReason;
  campaignTerminal?: boolean;
  crewRoster?: GameOverCrewStub[];
  /** Typed-salvage wallet snapshot at the moment the run/campaign ends. */
  salvage?: import('./game/salvage.js').TypedSalvage;
  archetype?: string;
  turn?: number;
  kills?: number;
  cause?: string | null;
  seed?: number;
  hpAtDeath?: number | null;
  hpAtDamage?: number | null;
  lastDamageSource?: string | null;
  lastAttacker?: string | null;
};
