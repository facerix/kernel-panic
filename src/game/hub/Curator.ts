/**
 * Curator NPC — the static figure who hands out contracts in the Hub.
 *
 * Role-wise the Curator is closer to a kiosk than a combatant: NEUTRAL
 * faction, immobile, no AI hooks. The player approaches and presses
 * `interact`; the Hub harness calls `generateContracts(rng, campaign)` and
 * feeds the result into `<contract-select>`.
 *
 * Contracts carry a tagged objective, a tiered difficulty, a threat budget,
 * and a reward bundle. The objective's `kind` is the mechanical family; the
 * text fields are what the job board / briefing can surface without keeping a
 * second copy table in UI code.
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
  RETRIEVE: 'retrieve',
  HANDOFF: 'handoff',
  TERMINAL_SLICE: 'terminal-slice',
  DENY: 'deny',
  SWEEP: 'sweep',
  DUAL_SITE: 'dual-site',
});

const KNOWN_OBJECTIVE_KINDS = new Set(Object.values(OBJECTIVES));
export type ObjectiveKind = (typeof OBJECTIVES)[keyof typeof OBJECTIVES];
export type ObjectiveParams = Record<string, string | number | boolean>;
export type ContractObjective = {
  kind: ObjectiveKind;
  title: string;
  briefing: string;
  params?: ObjectiveParams;
};

const CONTRACT_LABELS = Object.freeze([
  'Sublevel 3 cache',
  'Vuong Holdings server farm',
  'Black market dropoff — Pier 9',
  'Glassed clinic data dump',
  'Spinning Fox warehouse',
  'Matsuda payroll mirror',
  'Transit authority dead drop',
  'Harbor node sweep',
  'Ransomware sinkhole — District 4',
  'Cryo convoy manifest',
  'Sentinel maintenance window',
  'Yutani water table tap',
  'Ghost auction ledger',
  'Basement floodgate override',
  'Skybridge relay blind',
]);

const REACH_EXIT_OBJECTIVE: ContractObjective = Object.freeze({
  kind: OBJECTIVES.REACH_EXIT,
  title: 'Extract clean',
  briefing: 'Reach the exit (¤) with the stolen data.',
});

const OBJECTIVE_BY_LABEL: Readonly<Record<string, ContractObjective>> = Object.freeze({
  'Sublevel 3 cache': Object.freeze({
    kind: OBJECTIVES.RETRIEVE,
    title: 'Secure cache',
    briefing: 'Find the buried cache, secure it, then extract.',
    params: Object.freeze({ target: 'cache' }),
  }),
  'Vuong Holdings server farm': Object.freeze({
    kind: OBJECTIVES.TERMINAL_SLICE,
    title: 'Slice server rack',
    briefing: 'Reach the server terminal, complete the slice, then extract.',
    params: Object.freeze({ target: 'server-rack', count: 1 }),
  }),
  'Black market dropoff — Pier 9': Object.freeze({
    kind: OBJECTIVES.HANDOFF,
    title: 'Make the handoff',
    briefing: 'Locate the Pier 9 contact, complete the transfer, then extract.',
    params: Object.freeze({ contact: 'Pier 9 fence' }),
  }),
  'Glassed clinic data dump': Object.freeze({
    kind: OBJECTIVES.RETRIEVE,
    title: 'Recover clinic records',
    briefing: 'Recover the clinic records from the hit site, then extract.',
    params: Object.freeze({ target: 'clinic-records', hazardFlavor: 'glass-debris' }),
  }),
  'Spinning Fox warehouse': Object.freeze({
    kind: OBJECTIVES.DENY,
    title: 'Disable shipment',
    briefing: 'Find and disable the marked shipment before extraction.',
    params: Object.freeze({ target: 'shipment' }),
  }),
  'Matsuda payroll mirror': Object.freeze({
    kind: OBJECTIVES.DUAL_SITE,
    title: 'Sync payroll mirrors',
    briefing: 'Touch both payroll mirrors on-site before extraction.',
    params: Object.freeze({ target: 'payroll-mirror', count: 2 }),
  }),
  'Transit authority dead drop': Object.freeze({
    kind: OBJECTIVES.RETRIEVE,
    title: 'Collect dead drop',
    briefing: 'Find the transit authority dead drop, collect it, then extract.',
    params: Object.freeze({ target: 'dead-drop' }),
  }),
  'Harbor node sweep': Object.freeze({
    kind: OBJECTIVES.SWEEP,
    title: 'Sweep harbor nodes',
    briefing: 'Clear the harbor relay nodes or local threats before extraction.',
    params: Object.freeze({ target: 'relay-node' }),
  }),
  'Ransomware sinkhole — District 4': Object.freeze({
    kind: OBJECTIVES.TERMINAL_SLICE,
    title: 'Locate and slice ransomware terminal',
    briefing: 'Discover the ransomware terminal, complete the slice, get out clean.',
    params: Object.freeze({ target: 'server-rack', count: 1 }),
  }),
  'Cryo convoy manifest': Object.freeze({
    kind: OBJECTIVES.HANDOFF,
    title: 'Deliver manifest to journo',
    briefing: 'Find our indie journalist contact and hand off the convoy manifest.',
    params: Object.freeze({ target: 'cryo-manifest' }),
  }),
  'Sentinel maintenance window': Object.freeze({
    kind: OBJECTIVES.TERMINAL_SLICE,
    title: 'Slice sentinel terminal',
    briefing: 'Slice the sentinel terminal before maintenance window expires.',
    params: Object.freeze({ target: 'sentinel-terminal', turnLimit: 15 }),
  }),
  'Yutani water table tap': Object.freeze({
    kind: OBJECTIVES.DUAL_SITE,
    title: 'Dual-site sampling bores',
    briefing: 'Tap both sampling bores and return with the material.',
    params: Object.freeze({ target: 'sampling-bore', count: 2, hazardFlavor: 'tainted-water' }),
  }),
  'Ghost auction ledger': Object.freeze({
    kind: OBJECTIVES.RETRIEVE,
    title: 'Retrieve ledger from auction',
    briefing: 'Retrieve the auction ledger to facilitate handoff of purchaser data.',
    params: Object.freeze({ target: 'auction-ledger' }),
  }),
  'Basement floodgate override': Object.freeze({
    kind: OBJECTIVES.DENY,
    title: 'Destroy floodgate pump',
    briefing: 'Destroy the floodgate pump to prevent basement access.',
    params: Object.freeze({ target: 'floodgate' }),
  }),
  'Skybridge relay blind': Object.freeze({
    kind: OBJECTIVES.SWEEP,
    title: 'Sweep skybridge of relays',
    briefing: 'Clear the skybridge of surveillance relays before extraction.',
    params: Object.freeze({ target: 'skybridge-relay' }),
  }),
});

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
  objective: ContractObjective;
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
        objective: objectiveForLabel(baseLabel),
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

export function isObjectiveKind(value: string): value is ObjectiveKind {
  return KNOWN_OBJECTIVE_KINDS.has(value as ObjectiveKind);
}

export function isObjective(value: unknown): value is ContractObjective {
  try {
    normalizeObjective(value);
    return true;
  } catch {
    return false;
  }
}

export function cloneObjective(objective: ContractObjective): ContractObjective {
  return {
    kind: objective.kind,
    title: objective.title,
    briefing: objective.briefing,
    ...(objective.params ? { params: { ...objective.params } } : {}),
  };
}

export function normalizeObjective(value: unknown): ContractObjective {
  if (typeof value === 'string') {
    if (value !== OBJECTIVES.REACH_EXIT) {
      throw new Error(`contract objective "${value}" is not a known objective`);
    }
    return cloneObjective(REACH_EXIT_OBJECTIVE);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('contract objective must be an object');
  }
  const candidate = value as Partial<ContractObjective>;
  if (!candidate.kind || !isObjectiveKind(candidate.kind)) {
    throw new Error(`contract objective kind "${candidate.kind}" is not known`);
  }
  if (typeof candidate.title !== 'string' || candidate.title.length === 0) {
    throw new TypeError('contract objective title must be a non-empty string');
  }
  if (typeof candidate.briefing !== 'string' || candidate.briefing.length === 0) {
    throw new TypeError('contract objective briefing must be a non-empty string');
  }
  if (candidate.params !== undefined) {
    validateObjectiveParams(candidate.params);
  }
  return cloneObjective(candidate as ContractObjective);
}

/**
 * Throws if `CONTRACT_LABELS` and `OBJECTIVE_BY_LABEL` drift apart. Called from
 * unit tests so label additions fail fast without duplicating the mapping table.
 */
export function assertLabelObjectiveRegistryInSync(): void {
  const labels = new Set(CONTRACT_LABELS);
  for (const label of CONTRACT_LABELS) {
    const objective = OBJECTIVE_BY_LABEL[label];
    if (!objective) {
      throw new Error(`Curator: no objective mapping for contract label "${label}"`);
    }
    normalizeObjective(objective);
  }
  for (const label of Object.keys(OBJECTIVE_BY_LABEL)) {
    if (!labels.has(label)) {
      throw new Error(`Curator: objective mapping for unknown contract label "${label}"`);
    }
  }
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

function objectiveForLabel(label: string): ContractObjective {
  const objective = OBJECTIVE_BY_LABEL[label];
  if (!objective) {
    throw new Error(`Curator: no objective mapping for contract label "${label}"`);
  }
  return cloneObjective(objective);
}

function validateObjectiveParams(params: unknown): asserts params is ObjectiveParams {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new TypeError('contract objective params must be a plain object');
  }
  for (const [key, value] of Object.entries(params)) {
    const kind = typeof value;
    if (kind !== 'string' && kind !== 'number' && kind !== 'boolean') {
      throw new TypeError(`contract objective param "${key}" must be string, number, or boolean`);
    }
    if (kind === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`contract objective param "${key}" must be finite`);
    }
  }
}
