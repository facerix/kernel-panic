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

/**
 * Discriminated union of every paced turn-step yield today. New step-aware
 * AIs should extend this union (e.g. `| TurretTurnStep`) so `corpTurnDriver`
 * and tests can treat generators uniformly.
 */
export type TurnActionStep = CorpDroneTurnStep;

/**
 * Generator contract for entities the corp turn driver paces one yield at a
 * time (`takeTurnSteps`). Completion value is always `void`; callers only
 * read `IteratorResult.value`.
 */
export type TurnActionSteps = Generator<TurnActionStep, void, undefined>;

export type Telemetry = {
  outcome: 'death' | 'exit' | 'campaign-over';
  campaignTerminal?: boolean;
  crewRoster?: { callsign: string; archetype: string; flatlined: boolean }[];
  salvage?: number;
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
