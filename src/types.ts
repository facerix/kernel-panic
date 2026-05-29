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

/**
 * M7.1 terrain-relevant mutations captured during a run. M7.2 location memory
 * consumes these deltas when it persists site changes across revisits.
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

/** Movement yields from `CorpDrone` pathing (`#stepToward`). */
export type CorpDroneMoveKind = 'engage' | 'investigate' | 'patrol';

export type CorpDroneMoveStep = {
  type: `move-${CorpDroneMoveKind}`;
  to: GridPoint;
};

/**
 * One yield from `CorpDrone#takeTurnSteps` — a discrete committed mutation or
 * a no-AP status line the shell can still pace (patrol-arrived, etc.).
 */
export type CorpDroneTurnStep =
  | { type: 'fire'; target: string; result: RangedAttackResult }
  | { type: 'fire-blocked'; reason: string }
  | { type: 'investigate-cleared' }
  | { type: 'investigate-abandoned' }
  | { type: 'patrol-arrived'; waypoint: GridPoint }
  | { type: 'patrol-skipped'; waypoint: GridPoint }
  | CorpDroneMoveStep;

/** CorpCivilian alarm step — yielded when a corp non-combatant spots the player. */
export type CorpCivilianTurnStep = { type: 'alarm'; target: string };

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
export type TurnActionStep = CorpDroneTurnStep | CorpCivilianTurnStep | NeutralCivilianTurnStep;

/**
 * Generator contract for entities the corp turn driver paces one yield at a
 * time (`takeTurnSteps`). Completion value is always `void`; callers only
 * read `IteratorResult.value`.
 */
export type TurnActionSteps = Generator<TurnActionStep, void, undefined>;

/**
 * M6.2: Key-item — keycards used to unlock doors. Comes in two scopes:
 *   - **Campaign-scoped** (`siteId` set): stored in `Campaign.keyItems`,
 *     survives across runs. Not consumed on use (M7.2 revisit).
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
  /** Optional site id — populated by M7.2 location memory. */
  siteId?: string;
};

/**
 * Structural mirror of Curator's `ContractContextToken` (this file stays
 * import-free). A tagged lexicon token: stable id, display label, group tags.
 */
export type LocationToken = { id: string; label: string; groups: string[] };

/**
 * M7.2: A remembered combat location in the campaign's site roster. When the
 * Curator sends the player back to a roster site, the map is rebuilt from
 * `seed` and the accumulated `mutationDeltas` (breach holes, removed doors)
 * are replayed onto the fresh geometry before fresh enemies/objectives spawn.
 *
 * A location's *identity* is its **principal** (and **site**): revisits pin
 * those tokens so the owner/place stay constant across visits while the job
 * (objective/asset/action) is rolled fresh. `label` is the name from the most
 * recent generation.
 *
 * `tier` / `scoreTarget` reserve one slot for Phase 3's "Score target" site;
 * M7 never sets `scoreTarget` true.
 */
export type LocationSite = {
  /** Stable, seed-derived id — the roster key. `String(seed)` in M7. */
  id: string;
  /** Deterministic map seed (stringified contract seed). */
  seed: string;
  /** Flavor label carried over from the contract that first visited. */
  label: string;
  /** Roster tier — `'score'` is reserved for Phase 3 and never evicted. */
  tier: 'score' | 'roster';
  /** Phase 3 hook — always false in M7. */
  scoreTarget: boolean;
  /** Accumulated terrain mutations replayed on revisit. */
  mutationDeltas: TileDelta[];
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

export type Telemetry = {
  outcome: 'death' | 'exit' | 'campaign-over';
  campaignTerminal?: boolean;
  crewRoster?: { callsign: string; archetype: string; flatlined: boolean }[];
  /** M4.2: typed-salvage wallet snapshot at the moment the run/campaign ends. */
  salvage?: import('./game/salvage.js').TypedSalvage;
  archetype?: string;
  turn?: number;
  kills?: number;
  cause?: string;
  seed?: number;
  hpAtDeath?: number | null;
  hpAtDamage?: number | null;
  lastDamageSource?: string | null;
  lastAttacker?: string | null;
};
