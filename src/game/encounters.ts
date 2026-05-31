import { Rng } from '../rng.js';
import {
  CONTRACT_DIFFICULTY,
  ENEMY_ROLE,
  enemyTierForDifficulty,
  type ContractDifficulty,
  type EnemyRole,
  type EnemyTier,
} from './constants.js';

export const ENEMY_ARCHETYPE = Object.freeze({
  SKIRMISHER: 'skirmisher',
  GUARD: 'guard',
  SNIPER: 'sniper',
  SPOTTER: 'spotter',
  MEDIC: 'medic',
  BRUISER: 'bruiser',
  JUGGERNAUT: 'juggernaut',
  FLANKER: 'flanker',
});

export type EnemyArchetype = (typeof ENEMY_ARCHETYPE)[keyof typeof ENEMY_ARCHETYPE];

export type EncounterRoleEntry = Readonly<{
  archetype: EnemyArchetype;
  role: EnemyRole;
  tier: EnemyTier;
}>;

export type EncounterComposition = Readonly<{
  tier: EnemyTier;
  difficulty: ContractDifficulty;
  fodderCount: number;
  entries: readonly EncounterRoleEntry[];
}>;

export type ComposeEncounterOptions = Readonly<{
  seed: number;
  difficulty: ContractDifficulty;
  fodderCount: number;
}>;

const FODDER_ARCHETYPES = Object.freeze([ENEMY_ARCHETYPE.SKIRMISHER, ENEMY_ARCHETYPE.GUARD]);
const SPECIALIST_ARCHETYPES = Object.freeze([
  ENEMY_ARCHETYPE.SNIPER,
  ENEMY_ARCHETYPE.SPOTTER,
  ENEMY_ARCHETYPE.MEDIC,
]);
const ELITE_ARCHETYPES = Object.freeze([
  ENEMY_ARCHETYPE.BRUISER,
  ENEMY_ARCHETYPE.JUGGERNAUT,
  ENEMY_ARCHETYPE.FLANKER,
]);
const DURABLE_PATIENT_ARCHETYPES: ReadonlySet<EnemyArchetype> = new Set([
  ENEMY_ARCHETYPE.BRUISER,
  ENEMY_ARCHETYPE.JUGGERNAUT,
]);

export function composeEncounter({
  seed,
  difficulty,
  fodderCount,
}: ComposeEncounterOptions): EncounterComposition {
  if (!Number.isFinite(seed)) {
    throw new TypeError(`composeEncounter seed must be finite, got ${seed}`);
  }
  if (!Number.isInteger(fodderCount) || fodderCount < 0) {
    throw new RangeError(
      `composeEncounter fodderCount must be a non-negative integer, got ${fodderCount}`
    );
  }

  const tier = enemyTierForDifficulty(difficulty);
  const rng = new Rng(seed).fork('encounter-composition');
  const entries: EncounterRoleEntry[] = rollFodder(rng, tier, fodderCount);

  if (difficulty === CONTRACT_DIFFICULTY.STANDARD) {
    return freezeComposition({ tier, difficulty, fodderCount, entries });
  }

  if (difficulty === CONTRACT_DIFFICULTY.ELEVATED) {
    entries.push(makeEntry(rollSpecialist(rng, entries), ENEMY_ROLE.SPECIALIST, tier));
    return freezeComposition({ tier, difficulty, fodderCount, entries });
  }

  if (difficulty === CONTRACT_DIFFICULTY.CRITICAL) {
    const elite = rollElite(rng);
    entries.push(
      makeEntry(
        rollSpecialist(rng, [...entries, makeEntry(elite, ENEMY_ROLE.ELITE, tier)]),
        ENEMY_ROLE.SPECIALIST,
        tier
      )
    );
    entries.push(makeEntry(elite, ENEMY_ROLE.ELITE, tier));
    return freezeComposition({ tier, difficulty, fodderCount, entries });
  }

  throw new Error(`composeEncounter: unknown difficulty "${difficulty}"`);
}

export function hasDurableMedicPatient(entries: readonly EncounterRoleEntry[]): boolean {
  return entries.some(entry => DURABLE_PATIENT_ARCHETYPES.has(entry.archetype));
}

function rollFodder(rng: Rng, tier: EnemyTier, count: number): EncounterRoleEntry[] {
  const entries: EncounterRoleEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push(makeEntry(rng.pick(FODDER_ARCHETYPES), ENEMY_ROLE.FODDER, tier));
  }
  return entries;
}

function rollSpecialist(rng: Rng, existingEntries: readonly EncounterRoleEntry[]): EnemyArchetype {
  const pool = hasDurableMedicPatient(existingEntries)
    ? SPECIALIST_ARCHETYPES
    : SPECIALIST_ARCHETYPES.filter(archetype => archetype !== ENEMY_ARCHETYPE.MEDIC);
  return rng.pick(pool);
}

function rollElite(rng: Rng): EnemyArchetype {
  return rng.pick(ELITE_ARCHETYPES);
}

function makeEntry(
  archetype: EnemyArchetype,
  role: EnemyRole,
  tier: EnemyTier
): EncounterRoleEntry {
  return Object.freeze({ archetype, role, tier });
}

function freezeComposition(composition: {
  tier: EnemyTier;
  difficulty: ContractDifficulty;
  fodderCount: number;
  entries: EncounterRoleEntry[];
}): EncounterComposition {
  return Object.freeze({
    ...composition,
    entries: Object.freeze([...composition.entries]),
  });
}
