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
 * doesn't roll behind your back. Snapshot the rng state, restore, and the
 * same contract comes out.
 */

import { Entity } from '../Entity.js';
import { CONTRACT_DIFFICULTY, FACTION, REP, repTierForRep } from '../constants.js';
import { resolveMapDimensions } from '../procgen/mapDimensions.js';
import type { Rng } from '../../rng.js';
import type { EntityInit } from '../Entity.js';
import type { ContractDifficulty } from '../constants.js';
import type { LocationSite, LocationToken } from '../../types.js';

export const OBJECTIVES = Object.freeze({
  REACH_EXIT: 'reach-exit',
  RETRIEVE: 'retrieve',
  HANDOFF: 'handoff',
  TERMINAL_SLICE: 'terminal-slice',
  DENY: 'deny',
  SWEEP: 'sweep',
  DUAL_SITE: 'dual-site',
  RECON: 'recon',
  ESCORT_EXTRACT: 'escort-extract',
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

export type ContractArcStage = 'act-1' | 'act-2' | 'act-3' | 'score';

export type ContractContextToken = {
  id: string;
  label: string;
  groups: string[];
};

export type ContractContext = {
  recipeId: string;
  principal: ContractContextToken;
  site?: ContractContextToken;
  siteState?: ContractContextToken;
  asset: ContractContextToken;
  action: ContractContextToken;
  tags: string[];
  arcStage?: ContractArcStage;
  /**
   * References a `LocationSite.id` in the campaign roster when the Curator
   * targets a remembered site for a revisit (P2.5.M7.2). Distinct from the
   * `site` lexicon token (flavor) — this is the map-memory key. Absent for
   * fresh maps.
   */
  locationSiteId?: string;
};

type ContractRecipeContext = {
  arcStage?: ContractArcStage;
};

type ContractToken = {
  id: string;
  label: string;
  groups: readonly string[];
  labelPrefix?: string;
  target?: string;
  contact?: string;
  hazardFlavor?: string;
  turnLimit?: number;
  method?: string;
  requiresBreach?: boolean;
  titleNoun?: string;
};

type ContractRecipeTokens = {
  principal: ContractToken;
  site?: ContractToken;
  siteState?: ContractToken;
  asset: ContractToken;
  action: ContractToken;
};

type ContractRecipe = {
  id: string;
  objectiveKind: Exclude<ObjectiveKind, typeof OBJECTIVES.REACH_EXIT>;
  tags: readonly string[];
  principalGroups: readonly string[];
  siteGroups?: readonly string[];
  siteStateGroups?: readonly string[];
  assetGroups: readonly string[];
  actionGroups: readonly string[];
  title: (tokens: ContractRecipeTokens) => string;
  briefing: (tokens: ContractRecipeTokens) => string;
  params: (tokens: ContractRecipeTokens) => ObjectiveParams | undefined;
};

const REACH_EXIT_OBJECTIVE: ContractObjective = Object.freeze({
  kind: OBJECTIVES.REACH_EXIT,
  title: 'Extract clean',
  briefing: 'Reach the exit (¤) with the stolen data.',
});

export const CONTRACT_LEXICON = Object.freeze({
  principals: Object.freeze([
    token('matsuda', 'Matsuda', ['corp', 'finance']),
    token('vuong-holdings', 'Vuong Holdings', ['corp', 'data']),
    token('spinning-fox', 'Spinning Fox', ['corp', 'logistics']),
    token('yutani', 'Yutani', ['corp', 'infrastructure']),
    token('kestrel-dynamics', 'Kestrel Dynamics', ['corp', 'security']),
    token('sable-kline', 'Sable-Kline Systems', ['corp', 'finance', 'data']),
    token('heliodyne', 'HelioDyne Combine', ['corp', 'infrastructure']),
    token('orchid-vector', 'Orchid Vector', ['corp', 'medical']),
    token('northstar-civic', 'Northstar Civic', ['corp', 'civic', 'infrastructure']),
    token('marrowgate', 'Marrowgate Logistics', ['corp', 'logistics']),
    token('bayline-transit', 'Bayline Transit Authority', ['civic', 'infrastructure']),
    token('district-water-board', 'District Water Board', ['civic', 'infrastructure']),
    token('civic-grid-office', 'Civic Grid Office', ['civic', 'infrastructure']),
    token('port-warden-bureau', 'Port Warden Bureau', ['civic', 'security']),
    token('chrome-choir', 'Chrome Choir', ['rival', 'street']),
    token('redline-union', 'Redline Union', ['rival', 'logistics']),
    token('null-saints', 'Null Saints', ['rival', 'data']),
  ]),
  sites: Object.freeze([
    token('contractor-annex', 'contractor annex', ['corp', 'finance']),
    token('server-farm', 'server farm', ['corp', 'data']),
    token('block-9', 'Block 9', ['district', 'street', 'infrastructure']),
    token('pier-7', 'Pier 7', ['infrastructure', 'street']),
    token('clinic', 'clinic', ['street', 'medical']),
    token('warehouse', 'warehouse', ['logistics', 'street']),
    token('transit-hub', 'transit hub', ['infrastructure', 'civic']),
    token('harbor', 'harbor', ['infrastructure', 'street']),
    token('district-4', 'District 4', ['district', 'street']),
    token('water-table', 'water table', ['infrastructure']),
    token('auction-floor', 'auction floor', ['street', 'finance']),
    token('basement', 'basement', ['infrastructure', 'street']),
    token('skybridge', 'skybridge', ['infrastructure', 'security']),
    token('sublevel-3', 'Sublevel 3', ['infrastructure', 'hidden']),
  ]),
  siteStates: Object.freeze([
    token('active', 'active', ['normal'], { labelPrefix: '' }),
    token('gassed', 'Gassed', ['damaged', 'medical'], { labelPrefix: 'Gassed' }),
    token('flooded', 'Flooded', ['damaged', 'infrastructure'], { labelPrefix: 'Flooded' }),
    token('blacked-out', 'Blacked-out', ['damaged', 'security'], { labelPrefix: 'Blacked-out' }),
    token('quarantined', 'Quarantined', ['medical', 'security'], { labelPrefix: 'Quarantined' }),
    token('abandoned', 'Abandoned', ['street', 'hidden'], { labelPrefix: 'Abandoned' }),
  ]),
  assets: Object.freeze([
    token('cache', 'cache', ['retrieve', 'data'], { target: 'cache' }),
    token('server-farm', 'server farm', ['terminal', 'data'], { target: 'server-rack' }),
    token('dead-drop', 'dead drop', ['retrieve', 'handoff'], { target: 'dead-drop' }),
    token('clinic-records', 'records', ['retrieve', 'medical', 'data'], {
      target: 'clinic-records',
      hazardFlavor: 'suppression-gas',
    }),
    token('shipment', 'shipment', ['deny', 'logistics'], { target: 'shipment' }),
    token('payroll', 'payroll', ['dual-site', 'finance'], { target: 'payroll-mirror' }),
    token('relay-node', 'relay nodes', ['sweep', 'security'], { target: 'relay-node' }),
    token('ransomware-terminal', 'ransomware terminal', ['terminal', 'data'], {
      target: 'server-rack',
    }),
    token('cryo-manifest', 'cryo convoy manifest', ['handoff', 'logistics'], {
      target: 'cryo-manifest',
      contact: 'indie journalist',
    }),
    token('sentinel-terminal', 'sentinel terminal', ['terminal', 'security'], {
      target: 'sentinel-terminal',
      turnLimit: 15,
    }),
    token('sampling-bore', 'sampling bore', ['dual-site', 'infrastructure'], {
      target: 'sampling-bore',
      hazardFlavor: 'tainted-water',
    }),
    token('auction-ledger', 'auction ledger', ['retrieve', 'finance', 'data'], {
      target: 'auction-ledger',
    }),
    token('floodgate-pump', 'floodgate pump', ['deny', 'infrastructure'], {
      target: 'floodgate',
    }),
    token('floodgate-bulkhead', 'floodgate bulkhead', ['breach', 'infrastructure'], {
      target: 'floodgate',
      method: 'breach',
      requiresBreach: true,
    }),
    token('skybridge-relay', 'skybridge relays', ['sweep', 'security'], {
      target: 'skybridge-relay',
    }),
    token('community-power', 'community power', ['deny', 'infrastructure'], {
      target: 'power-siphon',
    }),
    token('identity-spool', 'identity spool', ['terminal', 'data'], { target: 'server-rack' }),
    token('hostile-cache', 'hostile cache', ['sweep', 'security'], { target: 'hostile-all' }),
    token('site-layout', 'site layout', ['recon', 'infrastructure'], { target: 'site-layout' }),
    token('patrol-map', 'patrol route', ['recon', 'security'], { target: 'patrol-map' }),
    token('service-plan', 'service plan', ['recon', 'data'], { target: 'service-plan' }),
    token('clinic-witness', 'clinic witness', ['escort', 'medical'], {
      target: 'clinic-witness',
      contact: 'clinic witness',
    }),
    token('transit-whistleblower', 'transit whistleblower', ['escort', 'civic'], {
      target: 'transit-whistleblower',
      contact: 'transit whistleblower',
    }),
    token('redline-courier', 'Redline courier', ['escort', 'logistics'], {
      target: 'redline-courier',
      contact: 'Redline courier',
    }),
  ]),
  actions: Object.freeze([
    token('cache', 'cache', ['retrieve']),
    token('recover', 'recovery', ['retrieve']),
    token('lift', 'lift', ['retrieve']),
    token('extract', 'extraction', ['retrieve']),
    token('handoff', 'handoff', ['handoff']),
    token('drop', 'drop', ['handoff']),
    token('relay', 'relay', ['handoff']),
    token('slice', 'slice', ['terminal']),
    token('spike', 'spike', ['terminal']),
    token('jack', 'jack', ['terminal']),
    token('burn', 'burn', ['deny']),
    token('override', 'override', ['deny', 'terminal']),
    token('brick', 'brick', ['deny']),
    token('torch', 'torch', ['deny']),
    token('demolish', 'demolition', ['breach']),
    token('mirror', 'mirror', ['dual-site']),
    token('tap', 'tap', ['dual-site']),
    token('bridge', 'bridge', ['dual-site']),
    token('splice', 'splice', ['dual-site']),
    token('sweep', 'sweep', ['sweep']),
    token('blind', 'blind', ['sweep']),
    token('eliminate', 'eliminate', ['sweep']),
    token('purge', 'purge', ['sweep']),
    token('survey', 'survey', ['recon']),
    token('trace', 'trace', ['recon']),
    token('map', 'map', ['recon']),
    token('escort', 'escort', ['escort']),
    token('extract-person', 'extraction', ['escort']),
    token('exfil', 'exfil', ['escort']),
  ]),
});

export const CONTRACT_RECIPES: readonly ContractRecipe[] = Object.freeze([
  {
    id: 'retrieve-asset',
    objectiveKind: OBJECTIVES.RETRIEVE,
    tags: Object.freeze(['meatspace', 'field-objective', 'loot']),
    principalGroups: Object.freeze(['corp', 'civic', 'rival']),
    siteGroups: Object.freeze(['street', 'district', 'infrastructure', 'medical', 'hidden']),
    siteStateGroups: Object.freeze(['normal', 'damaged', 'medical', 'hidden']),
    assetGroups: Object.freeze(['retrieve']),
    actionGroups: Object.freeze(['retrieve']),
    title: ({ asset }) => `Secure ${noun(asset)}`,
    briefing: ({ principal, site, asset }) =>
      `Find ${possessive(principal.label)} ${asset.label} at ${sitePhrase({ site })}, secure it, then extract.`,
    params: ({ asset }) => targetParams(asset),
  },
  {
    id: 'handoff-transfer',
    objectiveKind: OBJECTIVES.HANDOFF,
    tags: Object.freeze(['meatspace', 'contact', 'social']),
    principalGroups: Object.freeze(['corp', 'civic', 'rival', 'street']),
    siteGroups: Object.freeze(['street', 'infrastructure', 'civic', 'logistics']),
    siteStateGroups: Object.freeze(['normal', 'abandoned']),
    assetGroups: Object.freeze(['handoff']),
    actionGroups: Object.freeze(['handoff']),
    title: ({ asset }) => `Make ${noun(asset)} handoff`,
    briefing: ({ principal, site, asset }) =>
      `Locate the ${principal.label} contact near ${sitePhrase({ site })}, complete the ${asset.label} transfer, then extract.`,
    params: ({ principal, asset }) => ({
      ...targetParams(asset),
      contact: asset.contact ?? `${principal.label} contact`,
    }),
  },
  {
    id: 'terminal-slice',
    objectiveKind: OBJECTIVES.TERMINAL_SLICE,
    tags: Object.freeze(['meatspace', 'digital', 'slice']),
    principalGroups: Object.freeze(['corp', 'civic', 'rival']),
    siteGroups: Object.freeze(['corp', 'data', 'district', 'security']),
    siteStateGroups: Object.freeze(['normal', 'terminal', 'security']),
    assetGroups: Object.freeze(['terminal']),
    actionGroups: Object.freeze(['terminal']),
    title: ({ asset }) => `Slice ${noun(asset)}`,
    briefing: ({ principal, site, asset, action }) =>
      `Reach ${possessive(principal.label)} ${asset.label} at ${sitePhrase({ site })}, complete the ${action.label}, then extract.`,
    params: ({ asset }) => ({ ...targetParams(asset), count: 1 }),
  },
  {
    id: 'deny-asset',
    objectiveKind: OBJECTIVES.DENY,
    tags: Object.freeze(['meatspace', 'sabotage']),
    principalGroups: Object.freeze(['corp', 'civic', 'rival']),
    siteGroups: Object.freeze(['district', 'infrastructure', 'street', 'logistics']),
    siteStateGroups: Object.freeze(['normal', 'damaged', 'infrastructure', 'street']),
    assetGroups: Object.freeze(['deny']),
    actionGroups: Object.freeze(['deny']),
    title: ({ asset }) => `Disable ${noun(asset)}`,
    briefing: ({ principal, site, asset, action }) =>
      `Find ${possessive(principal.label)} ${asset.label} at ${sitePhrase({ site })}, execute the ${action.label}, then extract.`,
    params: ({ asset }) => targetParams(asset),
  },
  {
    id: 'demolition-breach',
    objectiveKind: OBJECTIVES.DENY,
    tags: Object.freeze(['meatspace', 'sabotage', 'breach']),
    principalGroups: Object.freeze(['corp', 'civic', 'rival']),
    siteGroups: Object.freeze(['infrastructure', 'street']),
    siteStateGroups: Object.freeze(['normal', 'damaged', 'infrastructure']),
    assetGroups: Object.freeze(['breach']),
    actionGroups: Object.freeze(['breach']),
    title: ({ asset }) => `Breach ${noun(asset)}`,
    briefing: ({ principal, site, asset }) =>
      `Plant a breaching charge on ${possessive(principal.label)} ${asset.label} at ${sitePhrase({ site })}, then extract.`,
    params: ({ asset }) => ({ ...targetParams(asset), method: 'breach', requiresBreach: true }),
  },
  {
    id: 'sweep-nodes',
    objectiveKind: OBJECTIVES.SWEEP,
    tags: Object.freeze(['meatspace', 'clearance']),
    principalGroups: Object.freeze(['corp', 'civic', 'rival']),
    siteGroups: Object.freeze(['infrastructure', 'security', 'corp', 'street']),
    siteStateGroups: Object.freeze(['normal', 'security', 'damaged']),
    assetGroups: Object.freeze(['sweep']),
    actionGroups: Object.freeze(['sweep']),
    title: ({ asset }) => `Sweep ${noun(asset)}`,
    briefing: ({ principal, site, asset }) =>
      `Clear ${possessive(principal.label)} ${asset.label} coverage around ${sitePhrase({ site })} before extraction.`,
    params: ({ asset }) => targetParams(asset),
  },
  {
    id: 'dual-site-sync',
    objectiveKind: OBJECTIVES.DUAL_SITE,
    tags: Object.freeze(['meatspace', 'routing', 'sync']),
    principalGroups: Object.freeze(['corp', 'civic']),
    siteGroups: Object.freeze(['corp', 'finance', 'infrastructure']),
    siteStateGroups: Object.freeze(['normal']),
    assetGroups: Object.freeze(['dual-site']),
    actionGroups: Object.freeze(['dual-site']),
    title: ({ asset }) => `Sync ${pluralNoun(asset)}`,
    briefing: ({ principal, site, asset }) =>
      `Touch both ${principal.label} ${asset.label} sites around ${sitePhrase({ site })} before extraction.`,
    params: ({ asset }) => ({ ...targetParams(asset), count: 2 }),
  },
  {
    id: 'recon-map',
    objectiveKind: OBJECTIVES.RECON,
    tags: Object.freeze(['meatspace', 'recon', 'mapping']),
    principalGroups: Object.freeze(['corp', 'civic', 'rival']),
    siteGroups: Object.freeze(['corp', 'district', 'infrastructure', 'security', 'hidden']),
    siteStateGroups: Object.freeze(['normal', 'damaged', 'security', 'hidden']),
    assetGroups: Object.freeze(['recon']),
    actionGroups: Object.freeze(['recon']),
    title: ({ asset }) => `Map ${noun(asset)}`,
    briefing: ({ principal, site, asset }) =>
      `Build a complete map of ${possessive(principal.label)} ${asset.label} around ${sitePhrase({ site })}, then extract.`,
    params: ({ asset }) => targetParams(asset),
  },
  {
    id: 'escort-extract',
    objectiveKind: OBJECTIVES.ESCORT_EXTRACT,
    tags: Object.freeze(['meatspace', 'escort', 'extraction']),
    principalGroups: Object.freeze(['corp', 'civic', 'rival']),
    siteGroups: Object.freeze(['street', 'medical', 'infrastructure', 'civic', 'logistics']),
    siteStateGroups: Object.freeze(['normal', 'damaged', 'medical', 'abandoned']),
    assetGroups: Object.freeze(['escort']),
    actionGroups: Object.freeze(['escort']),
    title: ({ asset }) => `Extract ${noun(asset)}`,
    briefing: ({ principal, site, asset }) =>
      `Find ${possessive(principal.label)} ${asset.label} around ${sitePhrase({ site })}, link them up, and reach extraction together.`,
    params: ({ asset }) => ({
      ...targetParams(asset),
      contact: asset.contact ?? asset.label,
    }),
  },
]);

const CURATOR_GLYPH = 'C';
const CONTRACTS_PER_VISIT = 3;
const MAX_UNIQUE_CONTRACT_ATTEMPTS = 60;

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

/** P2.5.M6.1: objective families whose props can route behind a locked prefab door. */
const DOOR_ROUTING_OBJECTIVE_KINDS: ReadonlySet<ObjectiveKind> = new Set([
  OBJECTIVES.RETRIEVE,
  OBJECTIVES.HANDOFF,
  OBJECTIVES.DENY,
  OBJECTIVES.DUAL_SITE,
  OBJECTIVES.RECON,
  OBJECTIVES.ESCORT_EXTRACT,
]);

/** P2.5.M6.1: contract tiers that opt into prefab door spawn + door-linked routing. */
const DOOR_ROUTING_DIFFICULTIES: ReadonlySet<ContractDifficulty> = new Set([
  CONTRACT_DIFFICULTY.ELEVATED,
  CONTRACT_DIFFICULTY.CRITICAL,
]);

/**
 * Whether a generated contract should spawn prefab doors and apply door routing
 * params (`requiresUnlock` → `door-0` in Run).
 */
export function contractUsesDoorRouting(
  objective: ContractObjective,
  difficulty: ContractDifficulty
): boolean {
  return (
    DOOR_ROUTING_DIFFICULTIES.has(difficulty) && DOOR_ROUTING_OBJECTIVE_KINDS.has(objective.kind)
  );
}

function applyDoorRoutingToObjective(
  objective: ContractObjective,
  difficulty: ContractDifficulty
): ContractObjective {
  if (!contractUsesDoorRouting(objective, difficulty)) {
    return objective;
  }
  if (objective.params?.doorId !== undefined || objective.params?.requiresUnlock === true) {
    return objective;
  }
  return {
    ...objective,
    params: { ...objective.params, requiresUnlock: true },
  };
}

// P2.5.M5.1: difficulty pools moved to REP_TIERS in constants.ts. Each Rep tier
// carries its own pool — the Curator reads `campaign.rep` to select it.

export type Contract = {
  seed: number;
  mapWidth: number;
  mapHeight: number;
  objective: ContractObjective;
  difficulty: ContractDifficulty;
  threatCount: number;
  label: string;
  context: ContractContext;
  reward: { credits: number; repDelta: number; recruit?: true };
};

type ContractCampaign =
  | {
      rep?: number;
      meta?: Record<string, unknown>;
      arcStage?: ContractArcStage | null;
      /** Remembered combat locations the Curator may steer revisits toward (P2.5.M7.2). */
      siteRoster?: LocationSite[];
    }
  | null
  | undefined;

/**
 * Probability that a generated contract targets an existing roster site
 * (deterministic from the seeded board rng) instead of a fresh seed (P2.5.M7.2).
 * The map memory is the payoff — difficulty and objective are still freshly rolled.
 */
export const SITE_REVISIT_CHANCE = 0.4;

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
   *
   * The difficulty pool is driven by the campaign's Rep tier instead of the
   * old `betterContracts` meta flag (P2.5.M5.1). Higher Rep → harder (more
   * lucrative) contracts. TRUSTED tier also gets a Cred floor bump.
   */
  generateContracts(rng: Rng, campaign?: ContractCampaign): Contract[] {
    if (!rng || typeof rng.next !== 'function') {
      throw new TypeError('Curator.generateContracts requires an Rng');
    }
    const rep = campaign?.rep ?? REP.START;
    const tier = repTierForRep(rep);
    const pool = tier.pool;
    const contracts: Contract[] = [];
    const labelsUsed = new Set<string>();
    const revisitedSiteIds = new Set<string>();
    const context = contractRecipeContext(campaign);
    const roster = campaign?.siteRoster ?? [];

    for (let i = 0; i < CONTRACTS_PER_VISIT; i++) {
      const difficulty = rng.pick([...pool]);
      const spec = DIFFICULTY_SPEC[difficulty];

      // Revisit biasing (P2.5.M7.2) — reuse a remembered location. The site's
      // principal (+ site) are *pinned* so the place keeps a consistent owner
      // across visits, while the objective/asset/action (the job) are rolled
      // fresh and the label is regenerated coherently from the pinned tokens.
      // Only roll when the roster is non-empty so empty-roster generation is
      // unchanged (no extra rng draws) and pre-P2.5.M7.2 determinism holds.
      let revisitSite: LocationSite | undefined;
      let built: RenderedContract | undefined;
      let seed: number;
      if (roster.length > 0 && rng.chance(SITE_REVISIT_CHANCE)) {
        const candidate = rng.pick(roster);
        // Pinnable only if it carries identity tokens and isn't already on this
        // board. Otherwise fall through to a fresh contract.
        if (candidate.principal && !revisitedSiteIds.has(candidate.id)) {
          built = generateRevisitContract(rng, labelsUsed, context, candidate) ?? undefined;
          if (built) {
            revisitSite = candidate;
            revisitedSiteIds.add(candidate.id);
          }
        }
      }
      if (!built) {
        built = generateRecipeContract(rng, labelsUsed, context);
        seed = rng.intRange(0, 0x7fffffff);
      } else {
        seed = siteSeedToContractSeed(revisitSite!);
      }
      const dimensions = revisitSite
        ? { width: revisitSite.mapWidth, height: revisitSite.mapHeight }
        : resolveMapDimensions({ seed, difficulty });

      const credits = rng.intRange(
        spec.credits.min + tier.rewardFloorBump,
        spec.credits.max + tier.rewardFloorBump + 1
      );
      const reward: Contract['reward'] = { credits, repDelta: spec.repDelta };
      if (difficulty === CONTRACT_DIFFICULTY.CRITICAL) reward.recruit = true;
      contracts.push({
        seed,
        mapWidth: dimensions.width,
        mapHeight: dimensions.height,
        objective: applyDoorRoutingToObjective(built.objective, difficulty),
        difficulty,
        threatCount: spec.threatCount,
        label: built.label,
        context: revisitSite ? { ...built.context, locationSiteId: revisitSite.id } : built.context,
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
 * Throws if recipes, lexicon, and objective coverage drift apart. Called from
 * unit tests so content additions fail fast without string-parsing labels back
 * into mechanics.
 */
export function assertLabelObjectiveRegistryInSync(): void {
  const coveredKinds = new Set<ObjectiveKind>();
  const fixtureDifficulty = CONTRACT_DIFFICULTY.STANDARD;
  for (const recipe of CONTRACT_RECIPES) {
    coveredKinds.add(recipe.objectiveKind);
    const principal = firstCompatibleToken(
      CONTRACT_LEXICON.principals,
      recipe.principalGroups,
      recipe.id
    );
    const site = recipe.siteGroups
      ? firstCompatibleToken(CONTRACT_LEXICON.sites, recipe.siteGroups, recipe.id)
      : undefined;
    const siteState = recipe.siteStateGroups
      ? firstCompatibleToken(CONTRACT_LEXICON.siteStates, recipe.siteStateGroups, recipe.id)
      : undefined;
    const asset = firstCompatibleToken(CONTRACT_LEXICON.assets, recipe.assetGroups, recipe.id);
    const action = firstCompatibleToken(CONTRACT_LEXICON.actions, recipe.actionGroups, recipe.id);
    const contract = buildContractRecipeFixture({
      recipeId: recipe.id,
      principalId: principal.id,
      siteId: site?.id,
      siteStateId: siteState?.id,
      assetId: asset.id,
      actionId: action.id,
      difficulty: fixtureDifficulty,
      seed: 0,
    });
    validateRenderedContract(contract);
  }
  for (const kind of Object.values(OBJECTIVES)) {
    if (kind !== OBJECTIVES.REACH_EXIT && !coveredKinds.has(kind)) {
      throw new Error(`Curator: no contract recipe covers objective kind "${kind}"`);
    }
  }
}

export function normalizeContractContext(value: unknown): ContractContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('contract context must be an object');
  }
  const candidate = value as Partial<ContractContext>;
  const recipeId = stringField(candidate.recipeId, 'recipeId');
  if (candidate.arcStage !== undefined && !isArcStage(candidate.arcStage)) {
    throw new Error(`contract context arcStage "${candidate.arcStage}" is not known`);
  }
  if (!Array.isArray(candidate.tags) || !candidate.tags.every(isNonEmptyString)) {
    throw new TypeError('contract context tags must be an array of non-empty strings');
  }
  if (
    candidate.locationSiteId !== undefined &&
    (typeof candidate.locationSiteId !== 'string' || candidate.locationSiteId.length === 0)
  ) {
    throw new TypeError('contract context locationSiteId must be a non-empty string when set');
  }
  const tags = [...new Set(candidate.tags)];
  return {
    recipeId,
    principal: normalizeContextToken(candidate.principal, 'principal'),
    ...(candidate.site ? { site: normalizeContextToken(candidate.site, 'site') } : {}),
    ...(candidate.siteState
      ? { siteState: normalizeContextToken(candidate.siteState, 'siteState') }
      : {}),
    asset: normalizeContextToken(candidate.asset, 'asset'),
    action: normalizeContextToken(candidate.action, 'action'),
    tags,
    ...(candidate.arcStage ? { arcStage: candidate.arcStage } : {}),
    ...(candidate.locationSiteId ? { locationSiteId: candidate.locationSiteId } : {}),
  };
}

export function buildContractRecipeFixture({
  recipeId,
  principalId,
  siteId,
  siteStateId,
  assetId,
  actionId,
  difficulty,
  seed,
  arcStage,
}: {
  recipeId: string;
  principalId: string;
  siteId?: string;
  siteStateId?: string;
  assetId: string;
  actionId: string;
  difficulty: ContractDifficulty;
  seed: number;
  arcStage?: ContractArcStage;
}): Contract {
  if (!isContractDifficulty(difficulty)) {
    throw new Error(`Curator fixture: unknown difficulty "${difficulty}"`);
  }
  if (!Number.isInteger(seed) || seed < 0) {
    throw new RangeError(`Curator fixture: seed must be a non-negative integer, got ${seed}`);
  }
  const recipe = lookupRecipe(recipeId);
  const tokens = {
    principal: lookupCompatibleToken(
      CONTRACT_LEXICON.principals,
      principalId,
      recipe.principalGroups,
      recipe.id
    ),
    ...(recipe.siteGroups
      ? {
          site: siteId
            ? lookupCompatibleToken(CONTRACT_LEXICON.sites, siteId, recipe.siteGroups, recipe.id)
            : firstCompatibleToken(CONTRACT_LEXICON.sites, recipe.siteGroups, recipe.id),
        }
      : {}),
    ...(recipe.siteStateGroups
      ? {
          siteState: siteStateId
            ? lookupCompatibleToken(
                CONTRACT_LEXICON.siteStates,
                siteStateId,
                recipe.siteStateGroups,
                recipe.id
              )
            : firstCompatibleToken(CONTRACT_LEXICON.siteStates, recipe.siteStateGroups, recipe.id),
        }
      : {}),
    asset: lookupCompatibleToken(CONTRACT_LEXICON.assets, assetId, recipe.assetGroups, recipe.id),
    action: lookupCompatibleToken(
      CONTRACT_LEXICON.actions,
      actionId,
      recipe.actionGroups,
      recipe.id
    ),
  };
  const spec = DIFFICULTY_SPEC[difficulty];
  const partial = buildContractFromRecipe(recipe, tokens, { arcStage });
  const reward: Contract['reward'] = { credits: spec.credits.min, repDelta: spec.repDelta };
  if (difficulty === CONTRACT_DIFFICULTY.CRITICAL) reward.recruit = true;
  const dimensions = resolveMapDimensions({ seed, difficulty });
  return {
    ...partial,
    objective: applyDoorRoutingToObjective(partial.objective, difficulty),
    seed,
    mapWidth: dimensions.width,
    mapHeight: dimensions.height,
    difficulty,
    threatCount: spec.threatCount,
    reward,
  };
}

export function isContractDifficulty(value: string): value is ContractDifficulty {
  return (Object.values(CONTRACT_DIFFICULTY) as string[]).includes(value);
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

function token(
  id: string,
  label: string,
  groups: readonly string[],
  options: Omit<ContractToken, 'id' | 'label' | 'groups'> = {}
): ContractToken {
  return Object.freeze({ id, label, groups: Object.freeze([...groups]), ...options });
}

function targetParams(token: ContractToken): ObjectiveParams {
  return {
    ...(token.target ? { target: token.target } : {}),
    ...(token.hazardFlavor ? { hazardFlavor: token.hazardFlavor } : {}),
    ...(token.turnLimit ? { turnLimit: token.turnLimit } : {}),
    ...(token.method ? { method: token.method } : {}),
    ...(token.requiresBreach === true ? { requiresBreach: true } : {}),
  };
}

function noun(token: ContractToken): string {
  return token.titleNoun ?? token.label;
}

function pluralNoun(token: ContractToken): string {
  const value = noun(token);
  if (value.endsWith('s')) return value;
  if (value.endsWith('y')) return `${value.slice(0, -1)}ies`;
  return `${value}s`;
}

function sitePhrase({ site, siteState }: Pick<ContractRecipeTokens, 'site' | 'siteState'>): string {
  if (!site) return 'the site';
  const prefix = siteState?.labelPrefix ?? siteState?.label ?? '';
  return prefix ? `${prefix} ${site.label}` : site.label;
}

function possessive(value: string): string {
  return value.endsWith('s') ? `${value}'` : `${value}'s`;
}

/**
 * A `LocationSite.seed` is the stringified contract seed that first built the
 * map (P2.5.M7.2). Convert it back to the numeric seed `buildMap` expects so
 * the geometry is byte-identical on revisit. A non-numeric seed is corrupt
 * data — crash rather than build a mismatched map.
 */
function siteSeedToContractSeed(site: LocationSite): number {
  const seed = Number(site.seed);
  if (!Number.isInteger(seed) || seed < 0) {
    throw new Error(`Curator: roster site "${site.id}" has a non-numeric seed "${site.seed}"`);
  }
  return seed;
}

function contractRecipeContext(campaign: ContractCampaign): ContractRecipeContext {
  const arcStage = campaign?.arcStage ?? undefined;
  if (arcStage !== undefined && !isArcStage(arcStage)) {
    throw new Error(`Curator.generateContracts: unknown arcStage "${arcStage}"`);
  }
  return arcStage ? { arcStage } : {};
}

function isArcStage(value: unknown): value is ContractArcStage {
  return value === 'act-1' || value === 'act-2' || value === 'act-3' || value === 'score';
}

function normalizeContextToken(value: unknown, fieldName: string): ContractContextToken {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`contract context ${fieldName} must be an object`);
  }
  const candidate = value as Partial<ContractContextToken>;
  const groups = candidate.groups;
  if (!Array.isArray(groups) || !groups.every(isNonEmptyString)) {
    throw new TypeError(`contract context ${fieldName}.groups must be non-empty strings`);
  }
  return {
    id: stringField(candidate.id, `${fieldName}.id`),
    label: stringField(candidate.label, `${fieldName}.label`),
    groups: [...new Set(groups)],
  };
}

function stringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`contract context ${fieldName} must be a non-empty string`);
  }
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

type RenderedContract = Pick<Contract, 'objective' | 'label' | 'context'>;

function generateRecipeContract(
  rng: Rng,
  labelsUsed: Set<string>,
  context: ContractRecipeContext
): RenderedContract {
  for (let i = 0; i < MAX_UNIQUE_CONTRACT_ATTEMPTS; i++) {
    const recipe = rng.pick(CONTRACT_RECIPES);
    const tokens = {
      principal: pickCompatibleToken(
        rng,
        CONTRACT_LEXICON.principals,
        recipe.principalGroups,
        recipe.id
      ),
      ...(recipe.siteGroups
        ? {
            site: pickCompatibleToken(rng, CONTRACT_LEXICON.sites, recipe.siteGroups, recipe.id),
          }
        : {}),
      ...(recipe.siteStateGroups
        ? {
            siteState: pickCompatibleToken(
              rng,
              CONTRACT_LEXICON.siteStates,
              recipe.siteStateGroups,
              recipe.id
            ),
          }
        : {}),
      asset: pickCompatibleToken(rng, CONTRACT_LEXICON.assets, recipe.assetGroups, recipe.id),
      action: pickCompatibleToken(rng, CONTRACT_LEXICON.actions, recipe.actionGroups, recipe.id),
    };
    const contract = buildContractFromRecipe(recipe, tokens, context);
    if (labelsUsed.has(contract.label)) continue;
    labelsUsed.add(contract.label);
    return contract;
  }
  throw new Error(
    `Curator: exhausted recipe label pool after ${MAX_UNIQUE_CONTRACT_ATTEMPTS} attempts`
  );
}

/**
 * Generate a fresh job for a *remembered* location (P2.5.M7.2). The site's
 * principal (and site token, when present) are pinned — only recipes compatible
 * with that identity are eligible — so the owner/place stay constant while the
 * objective, asset, and action are rolled fresh and the label is re-rendered
 * coherently.
 *
 * Returns `null` when the pinned identity admits no compatible recipe, or no
 * unique label can be produced — the caller then falls back to a fresh contract.
 */
function generateRevisitContract(
  rng: Rng,
  labelsUsed: Set<string>,
  context: ContractRecipeContext,
  site: LocationSite
): RenderedContract | null {
  if (!site.principal) return null;
  const principal = lexiconTokenFrom(site.principal);
  const siteToken = site.site ? lexiconTokenFrom(site.site) : undefined;
  // Recipes the pinned identity can satisfy: principal groups must intersect,
  // and any site-using recipe needs a remembered site compatible with it.
  const candidates = CONTRACT_RECIPES.filter(recipe => {
    if (!groupsIntersect(principal.groups, recipe.principalGroups)) return false;
    if (recipe.siteGroups) {
      return !!siteToken && groupsIntersect(siteToken.groups, recipe.siteGroups);
    }
    return true;
  });
  if (candidates.length === 0) return null;
  for (let i = 0; i < MAX_UNIQUE_CONTRACT_ATTEMPTS; i++) {
    const recipe = rng.pick(candidates);
    // No site-state roll on revisits: a remembered place reads stably (no
    // transient "Gassed/Flooded" prefix muddying its identity).
    const asset = pickCompatibleToken(rng, CONTRACT_LEXICON.assets, recipe.assetGroups, recipe.id);
    const action = pickCompatibleToken(
      rng,
      CONTRACT_LEXICON.actions,
      recipe.actionGroups,
      recipe.id
    );
    const tokens = {
      principal,
      ...(recipe.siteGroups ? { site: siteToken! } : {}),
      asset,
      action,
    };
    const label = renderContractLabel(tokens);
    if (labelsUsed.has(label)) continue;
    const contract = buildContractFromRecipe(recipe, tokens, context);
    labelsUsed.add(label);
    return { ...contract, label };
  }
  return null;
}

/**
 * Contract label: `// <principal> <site> - <state?> <asset> <action>`.
 * Site is omitted when the recipe has no site token; transient site state
 * (Gassed, Flooded, …) sits after the dash so the place identity reads stably
 * on revisits (no site-state roll) and fresh contracts alike.
 */
function renderContractLabel(tokens: ContractRecipeTokens): string {
  const { principal, site, siteState, asset, action } = tokens;
  const place = site ? `${principal.label} ${site.label}` : principal.label;
  const statePrefix =
    siteState && siteState.id !== 'active' ? (siteState.labelPrefix ?? siteState.label) : '';
  const job = `${asset.label} ${action.label}`;
  const tail = statePrefix ? `${statePrefix} ${job}` : job;
  return `// ${place} - ${tail}`;
}

/** Rebuild a `ContractToken` from a stored location identity token. */
function lexiconTokenFrom(token: LocationToken): ContractToken {
  return { id: token.id, label: token.label, groups: [...token.groups] };
}

function groupsIntersect(groups: readonly string[], allowed: readonly string[]): boolean {
  return groups.some(group => allowed.includes(group));
}

function buildContractFromRecipe(
  recipe: ContractRecipe,
  tokens: ContractRecipeTokens,
  context: ContractRecipeContext
): Pick<Contract, 'objective' | 'label' | 'context'> {
  const params = recipe.params(tokens);
  const objective = normalizeObjective({
    kind: recipe.objectiveKind,
    title: recipe.title(tokens),
    briefing: recipe.briefing(tokens),
    ...(params ? { params } : {}),
  });
  const label = renderContractLabel(tokens);
  const contractContext = normalizeContractContext({
    recipeId: recipe.id,
    principal: contextToken(tokens.principal),
    ...(tokens.site ? { site: contextToken(tokens.site) } : {}),
    ...(tokens.siteState && tokens.siteState.id !== 'active'
      ? { siteState: contextToken(tokens.siteState) }
      : {}),
    asset: contextToken(tokens.asset),
    action: contextToken(tokens.action),
    tags: contractTags(recipe, tokens),
    ...(context.arcStage ? { arcStage: context.arcStage } : {}),
  });
  const contract = { objective, label, context: contractContext };
  validateRenderedContract(contract);
  return contract;
}

function contextToken(tokenValue: ContractToken): ContractContextToken {
  return {
    id: tokenValue.id,
    label: tokenValue.label,
    groups: [...tokenValue.groups],
  };
}

function contractTags(recipe: ContractRecipe, tokens: ContractRecipeTokens): string[] {
  const tags = new Set<string>(recipe.tags);
  tags.add(`objective:${recipe.objectiveKind}`);
  addTokenTags(tags, 'principal', tokens.principal);
  if (tokens.site) addTokenTags(tags, 'site', tokens.site);
  if (tokens.siteState && tokens.siteState.id !== 'active') {
    addTokenTags(tags, 'site-state', tokens.siteState);
  }
  addTokenTags(tags, 'asset', tokens.asset);
  addTokenTags(tags, 'action', tokens.action);
  return [...tags];
}

function addTokenTags(tags: Set<string>, axis: string, tokenValue: ContractToken): void {
  tags.add(`${axis}:${tokenValue.id}`);
  for (const group of tokenValue.groups) tags.add(`${axis}:${group}`);
}

function validateRenderedContract(
  contract: Pick<Contract, 'objective' | 'label' | 'context'>
): void {
  if (typeof contract.label !== 'string' || contract.label.length <= 3) {
    throw new Error('Curator: recipe rendered an empty contract label');
  }
  for (const value of [
    contract.label,
    contract.objective.title,
    contract.objective.briefing,
    contract.context.principal.label,
    contract.context.site?.label ?? '',
    contract.context.siteState?.label ?? '',
    contract.context.asset.label,
    contract.context.action.label,
  ]) {
    if (value.includes('{{') || value.includes('}}')) {
      throw new Error(`Curator: unresolved template slot in "${value}"`);
    }
  }
  normalizeObjective(contract.objective);
  normalizeContractContext(contract.context);
}

function pickCompatibleToken(
  rng: Rng,
  tokens: readonly ContractToken[],
  allowedGroups: readonly string[],
  recipeId: string
): ContractToken {
  const compatible = compatibleTokens(tokens, allowedGroups);
  if (compatible.length === 0) {
    throw new Error(`Curator: recipe "${recipeId}" has no compatible lexicon tokens`);
  }
  return rng.pick(compatible);
}

function firstCompatibleToken(
  tokens: readonly ContractToken[],
  allowedGroups: readonly string[],
  recipeId: string
): ContractToken {
  const compatible = compatibleTokens(tokens, allowedGroups);
  if (compatible.length === 0) {
    throw new Error(`Curator: recipe "${recipeId}" has no compatible lexicon tokens`);
  }
  return compatible[0]!;
}

function compatibleTokens(
  tokens: readonly ContractToken[],
  allowedGroups: readonly string[]
): ContractToken[] {
  return tokens.filter(tokenValue =>
    tokenValue.groups.some(group => allowedGroups.includes(group))
  );
}

function lookupRecipe(recipeId: string): ContractRecipe {
  const recipe = CONTRACT_RECIPES.find(candidate => candidate.id === recipeId);
  if (!recipe) throw new Error(`Curator fixture: unknown recipe "${recipeId}"`);
  return recipe;
}

function lookupCompatibleToken(
  tokens: readonly ContractToken[],
  tokenId: string,
  allowedGroups: readonly string[],
  recipeId: string
): ContractToken {
  const found = tokens.find(candidate => candidate.id === tokenId);
  if (!found) throw new Error(`Curator fixture: unknown token "${tokenId}"`);
  if (!found.groups.some(group => allowedGroups.includes(group))) {
    throw new Error(`Curator fixture: token "${tokenId}" is not compatible with "${recipeId}"`);
  }
  return found;
}
