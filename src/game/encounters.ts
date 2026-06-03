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
  LOOKOUT: 'lookout',
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

/**
 * Allowlist of specialist/elite archetypes the resolver is permitted to roll.
 * Phase 2.7 ships role classes incrementally; the spawn site passes only the
 * archetypes that have a buildable class so the resolver never composes a
 * hostile we'd have to reskin or silently drop. Omitting a list (or passing
 * `undefined`) means "the full conceptual roster" — the default used by
 * composition unit tests that exercise the whole pool.
 */
export type AvailableArchetypes = Readonly<{
  specialists?: readonly EnemyArchetype[];
  elites?: readonly EnemyArchetype[];
}>;

export type ComposeEncounterOptions = Readonly<{
  seed: number;
  difficulty: ContractDifficulty;
  fodderCount: number;
  available?: AvailableArchetypes;
}>;

const FODDER_ARCHETYPES = Object.freeze([ENEMY_ARCHETYPE.SKIRMISHER, ENEMY_ARCHETYPE.GUARD]);
const SPECIALIST_ARCHETYPES = Object.freeze([
  ENEMY_ARCHETYPE.SNIPER,
  ENEMY_ARCHETYPE.LOOKOUT,
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
  available,
}: ComposeEncounterOptions): EncounterComposition {
  if (!Number.isFinite(seed)) {
    throw new TypeError(`composeEncounter seed must be finite, got ${seed}`);
  }
  if (!Number.isInteger(fodderCount) || fodderCount < 0) {
    throw new RangeError(
      `composeEncounter fodderCount must be a non-negative integer, got ${fodderCount}`
    );
  }

  // Resolve the allowlists once. `resolvePool` keeps the canonical archetype
  // order so the RNG pick index is independent of caller array ordering, and
  // an omitted list defaults to the full roster.
  const specialistPool = resolvePool(available?.specialists, SPECIALIST_ARCHETYPES);
  const elitePool = resolvePool(available?.elites, ELITE_ARCHETYPES);

  const tier = enemyTierForDifficulty(difficulty);
  const rng = new Rng(seed).fork('encounter-composition');
  const entries: EncounterRoleEntry[] = rollFodder(rng, tier, fodderCount);

  if (difficulty === CONTRACT_DIFFICULTY.STANDARD) {
    return freezeComposition({ tier, difficulty, fodderCount, entries });
  }

  if (difficulty === CONTRACT_DIFFICULTY.ELEVATED) {
    const specialist = rollSpecialist(rng, entries, specialistPool);
    if (specialist) entries.push(makeEntry(specialist, ENEMY_ROLE.SPECIALIST, tier));
    return freezeComposition({ tier, difficulty, fodderCount, entries });
  }

  if (difficulty === CONTRACT_DIFFICULTY.CRITICAL) {
    // Roll the elite first (draw order preserved from the original resolver so
    // the full-roster default stays byte-deterministic) so the medic patient
    // gate can see it. With no buildable elite available, the encounter simply
    // carries no elite — never a reskin.
    const elite = rollElite(rng, elitePool);
    const eliteEntry = elite ? makeEntry(elite, ENEMY_ROLE.ELITE, tier) : null;
    const specialist = rollSpecialist(
      rng,
      eliteEntry ? [...entries, eliteEntry] : entries,
      specialistPool
    );
    if (specialist) entries.push(makeEntry(specialist, ENEMY_ROLE.SPECIALIST, tier));
    if (eliteEntry) entries.push(eliteEntry);
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

/**
 * Filter `requested` down to the canonical pool, preserving canonical order so
 * the RNG pick index does not depend on the caller's array ordering. An
 * `undefined` request means "the whole canonical pool".
 */
function resolvePool(
  requested: readonly EnemyArchetype[] | undefined,
  canonical: readonly EnemyArchetype[]
): readonly EnemyArchetype[] {
  if (!requested) return canonical;
  const allowed = new Set(requested);
  return canonical.filter(archetype => allowed.has(archetype));
}

/**
 * Pick one specialist from `pool`, honouring the medic patient gate (medic is
 * removed unless a durable patient is already in the encounter). Returns `null`
 * when the (post-gate) pool is empty — the caller then composes no specialist.
 */
function rollSpecialist(
  rng: Rng,
  existingEntries: readonly EncounterRoleEntry[],
  pool: readonly EnemyArchetype[]
): EnemyArchetype | null {
  const gated = hasDurableMedicPatient(existingEntries)
    ? pool
    : pool.filter(archetype => archetype !== ENEMY_ARCHETYPE.MEDIC);
  if (gated.length === 0) return null;
  return rng.pick(gated);
}

function rollElite(rng: Rng, pool: readonly EnemyArchetype[]): EnemyArchetype | null {
  if (pool.length === 0) return null;
  return rng.pick(pool);
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
