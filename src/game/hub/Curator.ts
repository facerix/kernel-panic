/**
 * Curator NPC — the static figure who hands out contracts in the Hub.
 *
 * Role-wise the Curator is closer to a kiosk than a combatant: NEUTRAL
 * faction, immobile, no AI hooks. The player approaches and presses
 * `interact`; the Hub harness calls `generateContracts(rng, campaign)` and
 * feeds the result into `<contract-select>`.
 *
 * Contracts carry a single objective (`reach-exit`), a tiered difficulty,
 * a threat budget, and a reward bundle. Future quests (rescue / heist /
 * sabotage) extend the `objective` enum without changing the Curator's
 * interface.
 *
 * `generateContracts` is deterministic on the supplied Rng — the Curator
 * doesn't roll behind your back. That's what makes the M8 save flow
 * round-trippable: snapshot the rng state, restore, and the same contract
 * comes out.
 */

import { Entity } from '../Entity.js';
import { CONTRACT_DIFFICULTY, FACTION, SALVAGE_TO_CRED_RATE } from '../constants.js';
import type { Rng } from '../../rng.js';
import type { EntityInit } from '../Entity.js';
import type { ContractDifficulty } from '../constants.js';

export const OBJECTIVES = Object.freeze({
  REACH_EXIT: 'reach-exit',
});

const KNOWN_OBJECTIVES = new Set(Object.values(OBJECTIVES));
type Objective = (typeof OBJECTIVES)[keyof typeof OBJECTIVES];

const CONTRACT_LABELS = Object.freeze([
  'Sublevel 3 cache',
  'Vuong Holdings server farm',
  'Black market dropoff — Pier 9',
  'Glassed clinic data dump',
  'Spinning Fox warehouse',
  'Matsuda payroll mirror',
  'Transit authority dead drop',
  'Harbor node sweep',
]);

const CURATOR_GLYPH = 'C';
const CONTRACTS_PER_VISIT = 3;

const DIFFICULTY_ORDER: readonly ContractDifficulty[] = Object.freeze([
  CONTRACT_DIFFICULTY.STANDARD,
  CONTRACT_DIFFICULTY.ELEVATED,
  CONTRACT_DIFFICULTY.CRITICAL,
]);

type DifficultySpec = {
  threatCount: number;
  repDelta: number;
  credits: { min: number; max: number };
};

const DIFFICULTY_SPEC: Readonly<Record<ContractDifficulty, DifficultySpec>> = Object.freeze({
  [CONTRACT_DIFFICULTY.STANDARD]: Object.freeze({
    threatCount: 2,
    repDelta: 4,
    credits: Object.freeze({ min: 20, max: 40 }),
  }),
  [CONTRACT_DIFFICULTY.ELEVATED]: Object.freeze({
    threatCount: 3,
    repDelta: 7,
    credits: Object.freeze({ min: 40, max: 70 }),
  }),
  [CONTRACT_DIFFICULTY.CRITICAL]: Object.freeze({
    threatCount: 4,
    repDelta: 10,
    credits: Object.freeze({ min: 70, max: 110 }),
  }),
});

const BASE_DIFFICULTY_POOL: readonly ContractDifficulty[] = Object.freeze([
  CONTRACT_DIFFICULTY.STANDARD,
  CONTRACT_DIFFICULTY.STANDARD,
  CONTRACT_DIFFICULTY.STANDARD,
  CONTRACT_DIFFICULTY.STANDARD,
  CONTRACT_DIFFICULTY.STANDARD,
  CONTRACT_DIFFICULTY.ELEVATED,
  CONTRACT_DIFFICULTY.ELEVATED,
  CONTRACT_DIFFICULTY.ELEVATED,
  CONTRACT_DIFFICULTY.CRITICAL,
]);

const BETTER_CONTRACTS_POOL: readonly ContractDifficulty[] = Object.freeze([
  CONTRACT_DIFFICULTY.STANDARD,
  CONTRACT_DIFFICULTY.STANDARD,
  CONTRACT_DIFFICULTY.ELEVATED,
  CONTRACT_DIFFICULTY.ELEVATED,
  CONTRACT_DIFFICULTY.ELEVATED,
  CONTRACT_DIFFICULTY.ELEVATED,
  CONTRACT_DIFFICULTY.CRITICAL,
  CONTRACT_DIFFICULTY.CRITICAL,
  CONTRACT_DIFFICULTY.CRITICAL,
]);

export type Contract = {
  seed: number;
  objective: Objective;
  difficulty: ContractDifficulty;
  threatCount: number;
  label: string;
  reward: { credits: number; repDelta: number; recruit?: true };
};

type ContractCampaign = { meta?: { betterContracts?: boolean } } | null | undefined;

type CuratorInit = Omit<EntityInit, 'faction' | 'glyph' | 'maxAp' | 'maxHp' | 'id' | 'x' | 'y'> & {
  id?: string;
  x?: number;
  y?: number;
};
export class Curator extends Entity {
  constructor(props: CuratorInit = {}) {
    super({
      id: props.id ?? 'curator',
      x: props.x ?? 0,
      y: props.y ?? 0,
      faction: FACTION.NEUTRAL,
      glyph: CURATOR_GLYPH,
      // The Curator never spends AP — give her the bare minimum the Entity
      // contract requires (positive HP, zero AP).
      maxAp: 0,
      maxHp: 1,
    });
  }

  /**
   * Roll three job-board contracts for the current Hub visit.
   */
  generateContracts(rng: Rng, campaign?: ContractCampaign): Contract[] {
    if (!rng || typeof rng.next !== 'function') {
      throw new TypeError('Curator.generateContracts requires an Rng');
    }
    const betterContracts = !!campaign?.meta?.betterContracts;
    const pool = betterContracts ? BETTER_CONTRACTS_POOL : BASE_DIFFICULTY_POOL;
    const contracts: Contract[] = [];
    const labelsUsed = new Set<string>();

    for (let i = 0; i < CONTRACTS_PER_VISIT; i++) {
      const difficulty = rng.pick([...pool]);
      const spec = DIFFICULTY_SPEC[difficulty];
      const baseLabel = pickUniqueLabel(rng, labelsUsed);
      const seed = rng.intRange(0, 0x7fffffff);
      const rewardFloorBump = betterContracts ? 2 * SALVAGE_TO_CRED_RATE : 0;
      const credits = rng.intRange(
        spec.credits.min + rewardFloorBump,
        spec.credits.max + rewardFloorBump + 1
      );
      const reward: Contract['reward'] = { credits, repDelta: spec.repDelta };
      if (difficulty === CONTRACT_DIFFICULTY.CRITICAL) reward.recruit = true;
      contracts.push({
        seed,
        objective: OBJECTIVES.REACH_EXIT,
        difficulty,
        threatCount: spec.threatCount,
        label: `// ${baseLabel}`,
        reward,
      });
    }

    return contracts.sort(
      (a, b) => DIFFICULTY_ORDER.indexOf(a.difficulty) - DIFFICULTY_ORDER.indexOf(b.difficulty)
    );
  }

  /**
   * Backward-compatible single-contract API for older tests/debug code. New
   * shell code uses `generateContracts`.
   */
  generateContract(rng: Rng, campaign?: ContractCampaign): Contract {
    return this.generateContracts(rng, campaign)[0]!;
  }
}

export function isObjective(value: string): value is Objective {
  return KNOWN_OBJECTIVES.has(value as Objective);
}

export function isContractDifficulty(value: string): value is ContractDifficulty {
  return (Object.values(CONTRACT_DIFFICULTY) as string[]).includes(value);
}

function pickUniqueLabel(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < CONTRACT_LABELS.length; i++) {
    const label = rng.pick([...CONTRACT_LABELS]);
    if (!used.has(label)) {
      used.add(label);
      return label;
    }
  }
  const fallback = rng.pick([...CONTRACT_LABELS]);
  used.add(fallback);
  return fallback;
}
