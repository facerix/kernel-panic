import { Rng } from '../rng.js';
import { World } from './World.js';
import { TurnQueue } from './TurnQueue.js';
import { EventBus } from './events.js';
import { Entity } from './Entity.js';
import {
  CONTRACT_DIFFICULTY,
  FACTION,
  REP,
  RECRUIT,
  SALVAGE_SELL_RATE,
  CLINIC_COST_PER_HP,
} from './constants.js';
import {
  SALVAGE_TYPES,
  addSalvage,
  emptySalvage,
  migrateSalvage,
  totalSalvage,
  type SalvageType,
  type TypedSalvage,
} from './salvage.js';
import { buildCrewMember, RECRUIT_ARCHETYPE_POOL } from './archetypes/index.js';
import { CONTRACT_LEXICON, Curator, contractRequiresCyberspace } from './hub/Curator.js';
import { OBJECTIVES } from './hub/Curator.js';
import { Terminal } from './hub/Terminal.js';
import { Finn } from './hub/Finn.js';
import { Clinic } from './hub/Clinic.js';
import {
  applyFirstHubReveal,
  normalizeHubReveals,
  shouldSpawnClinic,
  shouldSpawnFinn,
  type HubRevealMessage,
  type HubReveals,
} from './hub/hubReveals.js';
import { buildHub } from './hub/SafeSpace.js';
import { getItemById, ITEM_SCOPE, metaKeyFor } from './items.js';
import { OUTCOME, Run } from './Run.js';
import {
  generateSiteId,
  mergeSiteDeltas as mergeDeltas,
  mergeSiteSeenKeys as mergeSeen,
  normalizeLocationSite,
} from './locations.js';
import { resolveMapDimensions } from './procgen/mapDimensions.js';
import type { Contract } from './hub/Curator.js';
import type { Crew } from './Crew.js';
import type {
  CampaignArcStage,
  CampaignEndReason,
  GridPoint,
  KeyItem,
  LocationSite,
  LocationToken,
  TileDelta,
} from '../types.js';
import type { RunResult, Outcome } from './Run.js';

/** Max remembered combat locations (P2.5.M7.2). One slot is reserved for Phase 3's score target. */
export const SITE_ROSTER_CAP = 6;
/** Minimum Rep to leave Act 1 — proven-operator bar (65). Recruitment opens earlier at KNOWN (50). */
export const ARC_ACT_2_MIN_REP = 65;
export const ARC_ACT_2_MIN_COMPLETED_JOBS = 4;
export const ARC_ACT_3_MIN_COMPLETED_JOBS = 9;
/** Minimum *living* crew size before the Score's final-prep stage unlocks. Starter 2 + Decker = 3, so 4 requires at least one additional recruit who hasn't flatlined. */
export const ARC_ACT_3_MIN_CREW_ALIVE = 4;
/** Visited sites sharing the Score target's principal required for Act 3. Includes the target itself. */
export const ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED = 3;
/** Act-2/3 deploys taken before corp heat starts (successful or not). */
export const CLOCK_ACT2_GRACE_JOBS = 3;
/** Deploys after grace before the Score window closes (Act 3 only). */
export const CLOCK_HEAT_WINDOW_JOBS = 5;
/** Total act-2/3 deploys allowed before clock loss (`grace + window`). */
export const CLOCK_ACT2_DEADLINE_JOBS = CLOCK_ACT2_GRACE_JOBS + CLOCK_HEAT_WINDOW_JOBS;
/** Act 3 deploy budget guaranteed when final prep unlocks — room for prep + THE SCORE. */
export const CLOCK_ACT3_MIN_JOBS_REMAINING = 3;

/** Clock expiry applies only during Act 3 final prep; Act 2 casing can run past the old deadline. */
export function clockDeadlineApplies(arcStage: CampaignArcStage): boolean {
  return arcStage === 'act-3';
}
/** Campaign-ending payday for completing THE SCORE. */
export const SCORE_CREDITS_REWARD = 5_000;
const SYNTHETIC_SCORE_TARGET_DIFFICULTY = CONTRACT_DIFFICULTY.CRITICAL;

export const CAMPAIGN_STATE = Object.freeze({
  HUB: 'HUB',
  COMBAT: 'COMBAT',
  ENDED: 'ENDED',
});

const STARTER_ARCHETYPES = Object.freeze(['merc', 'razor', 'tech']);

export type CampaignState = (typeof CAMPAIGN_STATE)[keyof typeof CAMPAIGN_STATE];
// `expandedCatalog` and `betterContracts` were removed in P2.5.M5.1 — Rep
// tiers replace them. Old saves may still carry those keys as dead data; the
// type is a plain Record so they don't cause a type error on restore.
export type CampaignMeta = Record<string, unknown>;

export type CampaignArc = {
  arcStage: CampaignArcStage;
  deckerRecruited: boolean;
  scoreRevealed: boolean;
  clockStarted: boolean;
  scoreAttempted: boolean;
  scoreCompleted: boolean;
};

const CAMPAIGN_ARC_STAGES: readonly CampaignArcStage[] = ['act-1', 'act-2', 'act-3', 'score'];

export function defaultCampaignArc(): CampaignArc {
  return {
    arcStage: 'act-1',
    deckerRecruited: false,
    scoreRevealed: false,
    clockStarted: false,
    scoreAttempted: false,
    scoreCompleted: false,
  };
}

export type CampaignOptions = {
  id?: string;
  seed?: unknown;
  crew?: unknown;
  salvage?: unknown;
  credits?: unknown;
  rep?: unknown;
  meta?: unknown;
  arc?: unknown;
  hubReveals?: unknown;
  completedJobs?: unknown;
  /** Act-2/3 job deploys that drive the Clock (not completedJobs). */
  clockJobsTaken?: unknown;
  keyItems?: unknown;
  siteRoster?: unknown;
  onPersist?: unknown;
  onResult?: unknown;
};

type CampaignLike = {
  crew: { flatlined: boolean }[];
  activeRun?: { contract: Contract | null } | null;
  arc?: Pick<CampaignArc, 'scoreRevealed' | 'scoreAttempted' | 'arcStage'>;
  clockJobsTaken?: number;
};

/**
 * True when a `DEATH` outcome is campaign-terminal: either the last living
 * operator is gone, or the Decker flatlines during the Score.
 *
 * @param {{ crew: { flatlined: boolean }[] }} campaign
 */
export function willEndCampaignOnThisDeath(campaign: CampaignLike): boolean {
  if (!campaign || typeof campaign !== 'object' || !Array.isArray(campaign.crew)) {
    throw new TypeError('willEndCampaignOnThisDeath requires a Campaign-like object with crew[]');
  }
  return (
    campaign.crew.filter(member => !member.flatlined).length === 1 ||
    (campaign.activeRun?.contract !== null &&
      campaign.activeRun?.contract !== undefined &&
      isScoreContract(campaign.activeRun.contract))
  );
}

/**
 * True when settling this job result will transition the campaign to ENDED.
 * The shell uses this before showing a debrief so terminal outcomes can bypass
 * `<crash-dump>` and proceed directly to the Chronicle summary.
 */
export function willEndCampaignAfterResult(
  campaign: CampaignLike,
  outcome: Outcome,
  completed: boolean
): boolean {
  if (outcome !== OUTCOME.DEATH && outcome !== OUTCOME.EXIT) {
    throw new Error(`willEndCampaignAfterResult: unknown outcome "${outcome}"`);
  }
  if (typeof completed !== 'boolean') {
    throw new TypeError('willEndCampaignAfterResult: completed must be boolean');
  }
  if (outcome === OUTCOME.DEATH && willEndCampaignOnThisDeath(campaign)) return true;
  const contract = campaign.activeRun?.contract;
  if (outcome === OUTCOME.EXIT && completed && contract && isScoreContract(contract)) return true;
  return Boolean(
    campaign.arc?.scoreRevealed &&
    clockDeadlineApplies(campaign.arc.arcStage) &&
    (campaign.clockJobsTaken ?? 0) >= CLOCK_ACT2_DEADLINE_JOBS &&
    !campaign.arc.scoreAttempted
  );
}

export function buildCrew(rng: Rng): Crew[] {
  if (!rng || typeof rng.pick !== 'function') {
    throw new TypeError('buildCrew requires an Rng');
  }
  const usedCallsigns = new Set<string>();
  return STARTER_ARCHETYPES.map(archetypeId => {
    const member = buildCrewMember(archetypeId, { x: 0, y: 0 }, rng, {
      id: `crew-${archetypeId}`,
      excludeCallsigns: usedCallsigns,
    });
    if (member.callsign) usedCallsigns.add(member.callsign);
    return member;
  });
}

export class Campaign {
  id: string;
  seed: number;
  rng: Rng;
  crew: Crew[];
  salvage: TypedSalvage;
  credits: number;
  rep: number;
  meta: CampaignMeta;
  arc: CampaignArc;
  state: CampaignState;
  activeRun: Run | null;
  deployedMemberId: string | null;
  availableRecruits: Crew[];
  recruitedThisVisit: boolean;
  pendingRecruitReward: boolean;
  rewardRecruitIds: Set<string>;
  initialCandidates: Crew[];
  onPersist: ((campaign: Campaign) => void) | null;
  onResult: ((result: RunResult) => void) | null;
  world: World | null;
  queue: TurnQueue | null;
  bus: EventBus | null;
  player: Entity | null;
  curator: Curator | null;
  finn: Finn | null;
  terminal: Terminal | null;
  clinic: Clinic | null;
  healedThisVisit: Set<string>;
  hubReveals: HubReveals;
  completedJobs: number;
  /** Deploys taken during Act 2 / Act 3 casing prep — drives Clock heat and deadline. */
  clockJobsTaken: number;
  /** Persistent key-item inventory (P2.5.M6.2) — keycards survive across runs. */
  keyItems: KeyItem[];
  /** Remembered combat locations / site roster (P2.5.M7.2), max `SITE_ROSTER_CAP`. */
  siteRoster: LocationSite[];
  /** Set by the latest `enterHub` when a reveal message fired; shell reads and clears. */
  lastHubReveal: HubRevealMessage | null;
  exitTile: GridPoint | null;

  constructor({
    id,
    seed,
    crew,
    salvage = 0,
    credits = 0,
    rep = REP.START,
    meta = {},
    arc,
    hubReveals,
    completedJobs = 0,
    clockJobsTaken = 0,
    keyItems,
    siteRoster,
    onPersist,
    onResult,
  }: CampaignOptions = {}) {
    if (typeof seed !== 'number' || !Number.isFinite(seed)) {
      throw new TypeError(`Campaign requires a finite numeric seed, got ${seed}`);
    }
    if (crew !== undefined && !Array.isArray(crew)) {
      throw new TypeError('Campaign: crew must be an array when supplied');
    }
    // Salvage is a TypedSalvage wallet (pre-P2.5.M4.2 saves stored a number).
    // `migrateSalvage` accepts either a legacy non-negative integer (bucketed
    // into scrap) or a valid TypedSalvage. Anything else crashes.
    const salvageWallet =
      salvage === undefined || salvage === 0
        ? emptySalvage()
        : migrateSalvage(salvage, 'Campaign salvage');
    if (typeof credits !== 'number' || !Number.isInteger(credits) || credits < 0) {
      throw new RangeError(`Campaign credits must be a non-negative integer, got ${credits}`);
    }
    if (typeof rep !== 'number' || !Number.isInteger(rep) || rep < 0 || rep > 100) {
      throw new RangeError(`Campaign rep must be an integer in [0, 100], got ${rep}`);
    }
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
      throw new TypeError('Campaign meta must be a plain object');
    }
    if (
      completedJobs !== undefined &&
      (!Number.isInteger(completedJobs) || (completedJobs as number) < 0)
    ) {
      throw new RangeError(
        `Campaign completedJobs must be a non-negative integer, got ${completedJobs}`
      );
    }
    if (
      clockJobsTaken !== undefined &&
      (!Number.isInteger(clockJobsTaken) || (clockJobsTaken as number) < 0)
    ) {
      throw new RangeError(
        `Campaign clockJobsTaken must be a non-negative integer, got ${clockJobsTaken}`
      );
    }
    if (onPersist !== undefined && typeof onPersist !== 'function') {
      throw new TypeError('Campaign: onPersist must be a function');
    }
    if (onResult !== undefined && typeof onResult !== 'function') {
      throw new TypeError('Campaign: onResult must be a function');
    }

    this.id = id ?? makeCampaignId(seed);
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.crew = (crew as Crew[] | undefined) ?? buildCrew(this.rng);
    this.salvage = salvageWallet;
    this.credits = credits;
    this.rep = rep;
    this.meta = { ...(meta as CampaignMeta) };
    this.arc = normalizeCampaignArc(arc);
    this.hubReveals = normalizeHubReveals(hubReveals, 'Campaign hubReveals');
    this.completedJobs = (completedJobs as number) ?? 0;
    this.clockJobsTaken = (clockJobsTaken as number) ?? 0;
    this.keyItems = normalizeKeyItems(keyItems);
    this.siteRoster = normalizeSiteRoster(siteRoster);
    this.state = CAMPAIGN_STATE.HUB;
    this.activeRun = null;
    this.deployedMemberId = null;
    this.availableRecruits = [];
    this.recruitedThisVisit = false;
    this.pendingRecruitReward = false;
    this.rewardRecruitIds = new Set();
    this.initialCandidates = [];
    this.onPersist = (onPersist as ((campaign: Campaign) => void) | undefined) ?? null;
    this.onResult = (onResult as ((result: RunResult) => void) | undefined) ?? null;

    this.world = null;
    this.queue = null;
    this.bus = null;
    this.player = null;
    this.curator = null;
    this.finn = null;
    this.terminal = null;
    this.clinic = null;
    this.healedThisVisit = new Set();
    this.lastHubReveal = null;
    this.exitTile = null;

    // Skip enterHub when crew is empty — the shell drives initial recruitment
    // (Phase B) and calls enterHub() after the player picks their starter crew.
    // No persist until then, so a refresh before picking just restarts.
    if (this.crew.length > 0) {
      this.enterHub();
    }
  }

  get arcStage(): CampaignArcStage {
    return this.arc.arcStage;
  }

  get clockHeat(): number {
    if (!this.arc.clockStarted) return 0;
    return Math.max(0, this.clockJobsTaken - CLOCK_ACT2_GRACE_JOBS);
  }

  /**
   * P3.M3.1: whether the roster carries a non-flatlined Decker. Gates
   * Cyberspace-capable contract generation (`Curator` reads this through the
   * `ContractCampaign` surface) and is the precondition for jack-in.
   */
  get hasLivingDecker(): boolean {
    return this.crew.some(member => member.archetype === 'Decker' && !member.flatlined);
  }

  get scoreDeadlineJobsRemaining(): number {
    return Math.max(0, CLOCK_ACT2_DEADLINE_JOBS - this.clockJobsTaken);
  }

  /** Set when `state === ENDED`; null while the campaign is still live. */
  get endReason(): CampaignEndReason | null {
    if (this.state !== CAMPAIGN_STATE.ENDED) return null;
    if (this.arc.scoreCompleted) return 'score-complete';
    if (this.arc.scoreAttempted && this.arc.arcStage === 'score') {
      return 'decker-flatlined-score';
    }
    if (this.#clockExpired()) {
      return 'clock-expired';
    }
    return 'crew-wipe';
  }

  enterHub(): void {
    if (this.state !== CAMPAIGN_STATE.HUB && this.state !== CAMPAIGN_STATE.COMBAT) {
      throw new Error(`Campaign.enterHub: illegal transition from ${this.state}`);
    }
    this.#advanceArcTransitions();
    if (this.arc.scoreCompleted || this.#clockExpired()) {
      this.state = CAMPAIGN_STATE.ENDED;
      this.#tearDownHubWorld();
      this.#persist();
      return;
    }
    this.recruitedThisVisit = false;
    this.healedThisVisit = new Set();
    this.lastHubReveal = null;
    this.#tearDownHubWorld();
    const hub = buildHub();
    this.bus = new EventBus();
    this.world = new World(hub.grid, { events: this.bus });
    this.player = new Entity({
      id: 'hub-operator',
      x: hub.playerSpawn.x,
      y: hub.playerSpawn.y,
      faction: FACTION.PLAYER,
      glyph: '@',
    });
    this.curator = new Curator({
      id: 'curator',
      x: hub.curatorSpawn.x,
      y: hub.curatorSpawn.y,
    });
    this.terminal = new Terminal({
      id: 'terminal',
      x: hub.terminalSpawn.x,
      y: hub.terminalSpawn.y,
    });
    this.lastHubReveal = applyFirstHubReveal(this);
    if (shouldSpawnFinn(this.hubReveals)) {
      this.finn = new Finn({
        id: 'finn',
        x: hub.finnSpawn.x,
        y: hub.finnSpawn.y,
      });
    } else {
      this.finn = null;
    }
    if (shouldSpawnClinic(this.hubReveals)) {
      this.clinic = new Clinic({
        id: 'clinic',
        x: hub.clinicSpawn.x,
        y: hub.clinicSpawn.y,
      });
    } else {
      this.clinic = null;
    }
    this.world.addEntity(this.player);
    this.world.addEntity(this.curator);
    this.world.addEntity(this.terminal);
    if (this.finn) this.world.addEntity(this.finn);
    if (this.clinic) this.world.addEntity(this.clinic);
    this.queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
    this.exitTile = { ...hub.exitTile };
    this.state = CAMPAIGN_STATE.HUB;
    this.rewardRecruitIds.clear();
    this.availableRecruits = this.generateRecruits();
    this.#persist();
  }

  /**
   * If Rep meets the recruitment threshold but `availableRecruits` is still
   * empty (legacy saves from the pre-fix shell order, or edge timing), fill
   * the pool. No-op when not in HUB, already recruited this visit, Rep is
   * low, or candidates already exist.
   */
  backfillRecruitsIfEligible(): void {
    if (this.state !== CAMPAIGN_STATE.HUB) return;
    if (this.recruitedThisVisit) return;
    if (
      this.rep < REP.RECRUIT_THRESHOLD &&
      !this.pendingRecruitReward &&
      !this.#needsReplacementDecker()
    ) {
      return;
    }
    if (this.availableRecruits.length > 0) return;
    this.availableRecruits = this.generateRecruits();
    this.#persist();
  }

  deployCrewMember(memberId: string, contract: Contract): Run {
    if (this.state !== CAMPAIGN_STATE.HUB) {
      throw new Error(`Campaign.deployCrewMember: illegal from ${this.state}`);
    }
    const member = this.getCrewMember(memberId);
    if (!member) {
      throw new Error(`Campaign.deployCrewMember: unknown crew member "${memberId}"`);
    }
    if (member.flatlined) {
      throw new Error(`Campaign.deployCrewMember: ${member.callsign ?? member.id} is flatlined`);
    }
    // P3.M3.1: a Cyberspace contract is unwinnable without the one operator who
    // can jack in — fail loudly at the Hub boundary instead of starting it.
    if (contractRequiresCyberspace(contract) && member.archetype !== 'Decker') {
      throw new Error(
        `Campaign.deployCrewMember: contract "${contract.label}" requires a living Decker to jack in`
      );
    }
    if (isScoreContract(contract)) {
      this.#beginScoreAttempt(contract);
    } else if (this.arc.arcStage === 'act-2' || this.arc.arcStage === 'act-3') {
      this.clockJobsTaken += 1;
    }
    const deployedContract = this.#contractWithRememberedDimensions(contract);
    this.#tearDownHubWorld();
    this.deployedMemberId = member.id;
    this.activeRun = new Run({
      crewMember: member,
      seed: deployedContract.seed,
      // Replay prior-visit terrain mutations on revisits ([] for first visits).
      priorMutationDeltas: this.priorDeltasForContract(deployedContract),
      priorSeenKeys: this.priorSeenKeysForContract(deployedContract),
      priorKeyItems: this.priorKeyItemsForContract(deployedContract),
      onPersist: () => this.#persist(),
      onResult: (result: RunResult) => {
        this.onResult?.(result);
      },
    });
    this.activeRun.enterBriefing(deployedContract);
    // Remember this location (or refresh its visit marker) on deploy.
    this.#rememberLocation(deployedContract);
    // Breach contracts auto-grant a breaching charge so the objective is always
    // completable, even before Finn's shop is unlocked.
    if (
      deployedContract.objective.params?.requiresBreach &&
      !member.inventory?.consumables.some(c => c.id === 'breaching-charge')
    ) {
      member.addConsumable('breaching-charge');
    }
    this.state = CAMPAIGN_STATE.COMBAT;
    this.#persist();
    return this.activeRun;
  }

  onJobEnd({
    outcome,
    salvage,
    completed = outcome === OUTCOME.EXIT,
  }: {
    outcome?: Outcome;
    salvage?: TypedSalvage;
    completed?: boolean;
  } = {}): void {
    if (this.state !== CAMPAIGN_STATE.COMBAT || !this.activeRun || !this.deployedMemberId) {
      throw new Error(`Campaign.onJobEnd: no active job from ${this.state}`);
    }
    if (outcome !== OUTCOME.DEATH && outcome !== OUTCOME.EXIT) {
      throw new Error(`Campaign.onJobEnd: unknown outcome "${outcome}"`);
    }
    // Salvage payload is typed (P2.5.M4.2). Default to empty (no carry-out on
    // death; shell omits the param). Validate structure when provided so a
    // malformed call crashes here rather than corrupting the wallet.
    const extracted = salvage ?? emptySalvage();
    if (
      typeof extracted !== 'object' ||
      extracted === null ||
      !SALVAGE_TYPES.every(t => Number.isInteger(extracted[t]) && (extracted[t] as number) >= 0)
    ) {
      throw new RangeError(`Campaign.onJobEnd: salvage must be a TypedSalvage wallet`);
    }
    if (typeof completed !== 'boolean') {
      throw new TypeError(`Campaign.onJobEnd: completed must be boolean`);
    }

    const completedScoreRun =
      this.activeRun.contract !== null &&
      isScoreContract(this.activeRun.contract) &&
      outcome === OUTCOME.EXIT &&
      completed;
    const failedScoreRun =
      this.activeRun.contract !== null &&
      isScoreContract(this.activeRun.contract) &&
      outcome === OUTCOME.DEATH;

    if (outcome === OUTCOME.DEATH) {
      this.flatlineMember(this.deployedMemberId);
    } else {
      // Persist this run's terrain mutations into the site roster before
      // returning to the Hub — breach holes survive even on an aborted exit.
      this.#mergeRunDeltasIntoRoster(this.activeRun);
      this.#mergeRunSeenIntoRoster(this.activeRun);
      if (completed) {
        this.completedJobs += 1;
        addSalvage(this.salvage, extracted);
        const reward = this.activeRun.contract?.reward;
        this.credits += reward?.credits ?? 0;
        if (reward) this.adjustRep(reward.repDelta);
        if (reward?.recruit) this.pendingRecruitReward = true;
      } else {
        // Abort extraction: objective abandoned — rep penalty, no rewards.
        this.adjustRep(REP.ABORT_PENALTY);
      }
    }
    // Clear job-scoped salvage (extracted or forfeited on death).
    // Consumables persist in the crew member's inventory until used —
    // they're a permanent part of the loadout, not job-scoped.
    const member = this.getCrewMember(this.deployedMemberId);
    if (member?.inventory) {
      member.inventory.salvage = emptySalvage();
    }

    this.activeRun = null;
    this.deployedMemberId = null;

    if (failedScoreRun) {
      this.state = CAMPAIGN_STATE.ENDED;
      this.#tearDownHubWorld();
      this.#persist();
      return;
    }

    if (this.crew.every(member => member.flatlined)) {
      this.state = CAMPAIGN_STATE.ENDED;
      this.#tearDownHubWorld();
      this.#persist();
      return;
    }

    if (completedScoreRun) {
      this.arc.scoreCompleted = true;
      this.arc.arcStage = 'score';
      this.state = CAMPAIGN_STATE.ENDED;
      this.#tearDownHubWorld();
      this.#persist();
      return;
    }

    this.state = CAMPAIGN_STATE.HUB;
    this.enterHub();
  }

  canAttemptScore(): boolean {
    if (this.state !== CAMPAIGN_STATE.HUB) return false;
    if (this.arc.arcStage !== 'act-3') return false;
    if (this.arc.scoreAttempted || this.arc.scoreCompleted) return false;
    if (!this.hasLivingDecker) return false;
    return this.#scoreTargetSiteOrNull() !== null;
  }

  buildScoreContract(): Contract {
    if (!this.canAttemptScore()) {
      throw new Error('Campaign.buildScoreContract: Score is not available');
    }
    const target = this.#scoreTargetSiteOrNull();
    if (!target) {
      throw new Error('Campaign.buildScoreContract: no Score target designated');
    }
    if (!target.principal) {
      throw new Error('Campaign.buildScoreContract: Score target is missing principal identity');
    }
    const seed = Number(target.seed);
    if (!Number.isInteger(seed) || seed < 0) {
      throw new Error(`Campaign.buildScoreContract: Score target seed "${target.seed}" is invalid`);
    }
    const principal = locationContextToken(target.principal);
    const site = target.site ? locationContextToken(target.site) : undefined;
    const heatThreat = Math.min(6, 4 + this.clockHeat);
    const objectiveKind = OBJECTIVES.DATA_NODE_SLICE;
    return {
      seed,
      mapWidth: target.mapWidth,
      mapHeight: target.mapHeight,
      objective: {
        kind: objectiveKind,
        title: 'The Score',
        briefing: `Hit ${target.label
          .replace(/^\/\//, '')
          .replace(/\s+-\s+Score target$/i, '')
          .trim()} and extract with the crew alive.`,
        params: {
          requiresCyberspace: true,
          count: 1,
        },
      },
      difficulty: CONTRACT_DIFFICULTY.CRITICAL,
      threatCount: heatThreat,
      label: `${target.label.replace(/\s+-\s+Score target$/i, '')} - THE SCORE`,
      context: {
        recipeId: 'score-final',
        principal,
        ...(site ? { site } : {}),
        asset: { id: 'score-target', label: 'Score target', groups: ['score'] },
        action: { id: 'score-run', label: 'run', groups: ['score'] },
        tags: ['score', 'meatspace', `objective:${objectiveKind}`, `principal:${principal.id}`],
        arcStage: 'score',
        locationSiteId: target.id,
      },
      reward: { credits: SCORE_CREDITS_REWARD, repDelta: 0 },
    };
  }

  flatlineMember(memberId: string): void {
    const member = this.getCrewMember(memberId);
    if (!member) {
      throw new Error(`Campaign.flatlineMember: unknown crew member "${memberId}"`);
    }
    member.flatlined = true;
  }

  /**
   * Adjust the campaign Rep meter by `delta` (positive or negative), clamped
   * to [0, 100]. Returns the actual delta applied after clamping — callers
   * can use this to build accurate feed messages.
   */
  adjustRep(delta: number): number {
    if (!Number.isFinite(delta)) {
      throw new TypeError(`Campaign.adjustRep: delta must be a finite number, got ${delta}`);
    }
    const before = this.rep;
    this.rep = Math.max(REP.MIN, Math.min(REP.MAX, this.rep + delta));
    return this.rep - before;
  }

  /**
   * Sell salvage to Finn for Creds. Each salvage type has a distinct
   * Cred-per-unit rate via `SALVAGE_SELL_RATE`. When `type` is provided, sells
   * exactly that type at its rate. When omitted, draws from buckets in
   * `SALVAGE_TYPES` priority order (scrap → chips → bio → data), applying each
   * type's rate as units are drawn. Throws on all illegal preconditions.
   */
  sellSalvage(quantity: number, type?: SalvageType): void {
    if (this.state !== CAMPAIGN_STATE.HUB) {
      throw new Error(`Campaign.sellSalvage: illegal from ${this.state}`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new RangeError(`Campaign.sellSalvage: quantity must be a positive integer`);
    }
    if (type !== undefined) {
      if (!(SALVAGE_TYPES as readonly string[]).includes(type)) {
        throw new RangeError(`Campaign.sellSalvage: unknown salvage type "${type}"`);
      }
      if (this.salvage[type] < quantity) {
        throw new Error(
          `Campaign.sellSalvage: insufficient ${type} (have ${this.salvage[type]}, tried ${quantity})`
        );
      }
      this.salvage[type] -= quantity;
      this.credits += quantity * SALVAGE_SELL_RATE[type];
      this.#persist();
      return;
    }
    // Untyped sell — draw from buckets in `SALVAGE_TYPES` order, applying
    // each type's rate as units are drawn. Crashes loudly if the total wallet
    // is short.
    const have = totalSalvage(this.salvage);
    if (quantity > have) {
      throw new Error(
        `Campaign.sellSalvage: insufficient salvage (have ${have}, tried ${quantity})`
      );
    }
    let remaining = quantity;
    let earned = 0;
    for (const t of SALVAGE_TYPES) {
      if (remaining === 0) break;
      const draw = Math.min(this.salvage[t], remaining);
      this.salvage[t] -= draw;
      earned += draw * SALVAGE_SELL_RATE[t];
      remaining -= draw;
    }
    this.credits += earned;
    this.#persist();
  }

  // ─── Recruitment ──────────────────────────────────────────────────────────

  /**
   * Collect every callsign ever used by any crew member (living or flatlined)
   * and any current recruit candidate. Prevents callsign recycling within a
   * campaign.
   */
  allUsedCallsigns(): Set<string> {
    const used = new Set<string>();
    for (const member of this.crew) {
      if (member.callsign) used.add(member.callsign);
    }
    for (const recruit of this.availableRecruits) {
      if (recruit.callsign) used.add(recruit.callsign);
    }
    return used;
  }

  /**
   * Generate a pool of recruit candidates. Called on each `enterHub()`.
   * Returns an empty array when Rep is below the recruitment threshold.
   */
  generateRecruits(): Crew[] {
    if (this.#needsReplacementDecker()) {
      const replacement = buildCrewMember('decker', { x: 0, y: 0 }, this.rng, {
        id: `recruit-decker-${this.rng.intRange(0, 0xffff).toString(16)}`,
        excludeCallsigns: this.allUsedCallsigns(),
      });
      this.rewardRecruitIds.add(replacement.id);
      return [replacement];
    }
    const rewardRecruit = this.pendingRecruitReward;
    if (this.rep < REP.RECRUIT_THRESHOLD && !rewardRecruit) return [];
    const count =
      rewardRecruit && this.rep < REP.RECRUIT_THRESHOLD
        ? 1
        : this.rng.intRange(RECRUIT.POOL_MIN, RECRUIT.POOL_MAX + 1);
    const usedCallsigns = this.allUsedCallsigns();
    const recruits: Crew[] = [];
    for (let i = 0; i < count; i++) {
      const archetypeId = this.rng.pick(RECRUIT_ARCHETYPE_POOL as unknown as string[]);
      const recruit = buildCrewMember(archetypeId, { x: 0, y: 0 }, this.rng, {
        id: `recruit-${i}-${this.rng.intRange(0, 0xffff)}`,
        excludeCallsigns: usedCallsigns,
      });
      if (recruit.callsign) usedCallsigns.add(recruit.callsign);
      if (rewardRecruit) this.rewardRecruitIds.add(recruit.id);
      recruits.push(recruit);
    }
    if (rewardRecruit) this.pendingRecruitReward = false;
    return recruits;
  }

  /**
   * Recruit a candidate from `availableRecruits` into the permanent crew.
   * Limited to one recruitment per hub visit. Throws on all illegal
   * preconditions — crash over silent fallback.
   */
  recruit(recruitId: string): void {
    if (this.state !== CAMPAIGN_STATE.HUB) {
      throw new Error(`Campaign.recruit: illegal from ${this.state}`);
    }
    if (this.recruitedThisVisit) {
      throw new Error('Campaign.recruit: already recruited this visit');
    }
    if (this.rep < REP.RECRUIT_THRESHOLD && !this.rewardRecruitIds.has(recruitId)) {
      throw new Error(`Campaign.recruit: rep ${this.rep} below threshold ${REP.RECRUIT_THRESHOLD}`);
    }
    const idx = this.availableRecruits.findIndex(r => r.id === recruitId);
    if (idx === -1) {
      throw new Error(`Campaign.recruit: unknown recruit "${recruitId}"`);
    }
    const [recruit] = this.availableRecruits.splice(idx, 1);
    this.rewardRecruitIds.delete(recruit.id);
    this.crew.push(recruit);
    this.recruitedThisVisit = true;
    this.#persist();
  }

  // ─── Initial recruitment ──────────────────────────────────────────────────

  /**
   * Generate the starter candidate pool for a fresh campaign. Returns
   * `RECRUIT.INITIAL_CANDIDATES` (3) candidates with weighted archetype
   * distribution (40/40/20). Stores them on `initialCandidates` for
   * `recruitInitial()` to consume. Does NOT require Rep gate — this is
   * the campaign-start exception.
   */
  generateInitialCandidates(): Crew[] {
    const usedCallsigns = this.allUsedCallsigns();
    const candidates: Crew[] = [];
    for (let i = 0; i < RECRUIT.INITIAL_CANDIDATES; i++) {
      const archetypeId = this.rng.pick(RECRUIT_ARCHETYPE_POOL as unknown as string[]);
      const candidate = buildCrewMember(archetypeId, { x: 0, y: 0 }, this.rng, {
        id: `crew-init-${i}`,
        excludeCallsigns: usedCallsigns,
      });
      if (candidate.callsign) usedCallsigns.add(candidate.callsign);
      candidates.push(candidate);
    }
    this.initialCandidates = candidates;
    return candidates;
  }

  /**
   * Commit the player's initial crew picks. Exactly `RECRUIT.INITIAL_PICKS`
   * (2) IDs from `initialCandidates` must be provided. Moves selected
   * candidates into `crew`, discards the rest, clears `initialCandidates`.
   * Does NOT call `enterHub()` — the shell does that after this returns.
   */
  recruitInitial(memberIds: string[]): void {
    if (!Array.isArray(memberIds) || memberIds.length !== RECRUIT.INITIAL_PICKS) {
      throw new Error(
        `Campaign.recruitInitial: exactly ${RECRUIT.INITIAL_PICKS} IDs required, got ${memberIds?.length ?? 0}`
      );
    }
    const selected: Crew[] = [];
    for (const id of memberIds) {
      const idx = this.initialCandidates.findIndex(c => c.id === id);
      if (idx === -1) {
        throw new Error(`Campaign.recruitInitial: unknown candidate "${id}"`);
      }
      selected.push(this.initialCandidates[idx]);
    }
    this.crew.push(...selected);
    this.initialCandidates = [];
  }

  /**
   * Purchase an item from Finn's shop. Deducts Creds, applies the item
   * effect, and persists. Throws on all illegal preconditions (insufficient
   * Creds, unknown item, duplicate meta purchase) — crash over silent
   * fallback.
   *
   * @param {{ itemId: string, targetMemberId?: string }} opts
   */
  purchase({ itemId, targetMemberId }: { itemId?: string; targetMemberId?: string } = {}): void {
    if (this.state !== CAMPAIGN_STATE.HUB) {
      throw new Error(`Campaign.purchase: illegal from ${this.state}`);
    }
    if (typeof itemId !== 'string' || itemId.length === 0) {
      throw new TypeError('Campaign.purchase: itemId must be a non-empty string');
    }
    const item = getItemById(itemId);
    if (this.credits < item.cost) {
      throw new Error(
        `Campaign.purchase: insufficient Creds (have ${this.credits}, need ${item.cost})`
      );
    }
    // Validate target for items that need one.
    let target: Crew | null = null;
    if (item.needsTarget) {
      if (!targetMemberId) {
        throw new Error(`Campaign.purchase: "${itemId}" requires a target crew member`);
      }
      target = this.getCrewMember(targetMemberId);
      if (!target) {
        throw new Error(`Campaign.purchase: unknown crew member "${targetMemberId}"`);
      }
      if (target.flatlined) {
        throw new Error(`Campaign.purchase: ${target.callsign ?? target.id} is flatlined`);
      }
    }
    // Prevent duplicate unique meta purchases.
    if (item.unique && item.scope === ITEM_SCOPE.META) {
      const key = metaKeyFor(itemId);
      if (key && this.meta[key]) {
        throw new Error(`Campaign.purchase: meta upgrade "${itemId}" already purchased`);
      }
    }

    // Commit: deduct Creds first, then apply effect.
    this.credits -= item.cost;

    switch (item.scope) {
      case ITEM_SCOPE.JOB:
        // Consumables go into the crew member's inventory and persist until
        // used (not cleared on job end despite the JOB scope label).
        if (!target)
          throw new Error(`Campaign.purchase: "${itemId}" requires a target crew member`);
        target.addConsumable(itemId);
        break;
      case ITEM_SCOPE.CAMPAIGN:
        // Campaign-scoped gear applies a permanent bonus to the crew member.
        if (!target)
          throw new Error(`Campaign.purchase: "${itemId}" requires a target crew member`);
        target.applyGear(itemId);
        break;
      case ITEM_SCOPE.META: {
        // Meta upgrades set a flag on the campaign meta object.
        const key = metaKeyFor(itemId);
        if (key) this.meta[key] = true;
        break;
      }
      default:
        throw new Error(`Campaign.purchase: unknown scope "${item.scope}"`);
    }

    this.#persist();
  }

  /**
   * Restore a crew member to full HP at Patch's clinic. Once per Hub visit
   * per member. Cost is `(maxHp - hp) * CLINIC_COST_PER_HP`. Throws on all
   * illegal preconditions — crash over silent fallback.
   */
  healMember(memberId: string): void {
    if (this.state !== CAMPAIGN_STATE.HUB) {
      throw new Error(`Campaign.healMember: illegal from ${this.state}`);
    }
    const member = this.getCrewMember(memberId);
    if (!member) {
      throw new Error(`Campaign.healMember: unknown crew member "${memberId}"`);
    }
    if (member.flatlined) {
      throw new Error(`Campaign.healMember: ${member.callsign ?? member.id} is flatlined`);
    }
    if (member.hp >= member.maxHp) {
      throw new Error(`Campaign.healMember: ${member.callsign ?? member.id} is at full HP`);
    }
    if (this.healedThisVisit.has(memberId)) {
      throw new Error(
        `Campaign.healMember: ${member.callsign ?? member.id} already healed this visit`
      );
    }
    const cost = (member.maxHp - member.hp) * CLINIC_COST_PER_HP;
    if (this.credits < cost) {
      throw new Error(
        `Campaign.healMember: insufficient Creds (have ${this.credits}, need ${cost})`
      );
    }
    this.credits -= cost;
    member.hp = member.maxHp;
    this.healedThisVisit.add(memberId);
    this.#persist();
  }

  // ─── Key items (P2.5.M6.2) ──────────────────────────────────────────────

  /**
   * Add a key item to the campaign's persistent inventory. Key items survive
   * across runs and are never consumed on use — a keycard that unlocks a door
   * stays in the inventory for revisit matching.
   */
  addKeyItem(item: KeyItem): void {
    if (!item || typeof item !== 'object') {
      throw new TypeError('Campaign.addKeyItem: item must be an object');
    }
    if (typeof item.id !== 'string' || item.id.length === 0) {
      throw new TypeError('Campaign.addKeyItem: item.id must be a non-empty string');
    }
    if (typeof item.label !== 'string' || item.label.length === 0) {
      throw new TypeError('Campaign.addKeyItem: item.label must be a non-empty string');
    }
    if (typeof item.doorId !== 'string' || item.doorId.length === 0) {
      throw new TypeError('Campaign.addKeyItem: item.doorId must be a non-empty string');
    }
    if (this.keyItems.some(k => k.id === item.id)) {
      throw new Error(`Campaign.addKeyItem: duplicate key item "${item.id}"`);
    }
    this.keyItems.push({ ...item });
    this.#persist();
  }

  /**
   * Check whether the campaign inventory holds a key item that unlocks the
   * given door id. Returns the matching `KeyItem` or `null`.
   */
  keyItemForDoor(doorId: string): KeyItem | null {
    return this.keyItems.find(k => k.doorId === doorId) ?? null;
  }

  // ─── Location memory / site roster (P2.5.M7.2) ───────────────────────────

  /** Look up a remembered site by its `LocationSite.id`. */
  findRosterSite(siteId: string): LocationSite | null {
    return this.siteRoster.find(s => s.id === siteId) ?? null;
  }

  /**
   * Add a remembered site to the roster, or refresh `lastVisitedJob` if it is
   * already present. At capacity, evict the oldest `roster`-tier site (lowest
   * `lastVisitedJob`); `score`-tier sites are never evicted. If the roster is
   * full of score-tier sites (degenerate — one Phase 3 score slot exists),
   * the add is skipped with a warning rather than evicting the Phase 3 target.
   */
  addSiteToRoster(site: LocationSite): void {
    const normalized = normalizeLocationSite(site);
    const existing = this.findRosterSite(normalized.id);
    if (existing) {
      existing.lastVisitedJob = normalized.lastVisitedJob;
      // Backfill identity tokens for pre-pinning roster entries so a legacy
      // site becomes revisit-pinnable once it's deployed to again.
      if (!existing.principal && normalized.principal) {
        existing.principal = normalized.principal;
        if (normalized.site) existing.site = normalized.site;
      }
      this.#persist();
      return;
    }
    if (this.siteRoster.length >= SITE_ROSTER_CAP) {
      let evictIdx = -1;
      let oldest = Infinity;
      for (let i = 0; i < this.siteRoster.length; i++) {
        const candidate = this.siteRoster[i]!;
        if (candidate.tier === 'score') continue;
        if (candidate.lastVisitedJob < oldest) {
          oldest = candidate.lastVisitedJob;
          evictIdx = i;
        }
      }
      if (evictIdx === -1) {
        console.warn(
          'Campaign.addSiteToRoster: roster full of score-tier sites; skipping add of',
          normalized.id
        );
        return;
      }
      this.siteRoster.splice(evictIdx, 1);
    }
    this.siteRoster.push(normalized);
    this.#persist();
  }

  /**
   * Merge a finished run's terrain mutations into the named roster site,
   * deduplicating by coordinate (latest wins). Throws if the site is unknown —
   * a missing roster entry on a revisit is a bug, not a recoverable state.
   */
  mergeSiteDeltas(siteId: string, deltas: TileDelta[]): void {
    const site = this.findRosterSite(siteId);
    if (!site) {
      throw new Error(`Campaign.mergeSiteDeltas: unknown site "${siteId}"`);
    }
    site.mutationDeltas = mergeDeltas(site.mutationDeltas, deltas);
    this.#persist();
  }

  /** Merge exploration memory from a finished run into the named roster site. */
  mergeSiteSeenKeys(siteId: string, seenKeys: string[]): void {
    const site = this.findRosterSite(siteId);
    if (!site) {
      throw new Error(`Campaign.mergeSiteSeenKeys: unknown site "${siteId}"`);
    }
    site.seenKeys = mergeSeen(site.seenKeys, seenKeys);
    this.#persist();
  }

  /**
   * Resolve the stable roster id for a contract's target location. Revisit
   * contracts carry an explicit `locationSiteId`; fresh contracts derive one
   * from the map seed (`generateSiteId`), which also lets a fresh contract that
   * happens to reuse a remembered seed pick up that site's prior geometry.
   */
  locationSiteIdForContract(contract: Contract): string {
    return contract.context.locationSiteId ?? generateSiteId(contract.seed);
  }

  /**
   * Prior-visit terrain deltas for a contract's target location. Empty for a
   * first visit. Used to seed `Run.priorMutationDeltas` on deploy and restore.
   */
  priorDeltasForContract(contract: Contract): TileDelta[] {
    const site = this.findRosterSite(this.locationSiteIdForContract(contract));
    return site ? site.mutationDeltas.map(d => ({ ...d })) : [];
  }

  /**
   * Prior-visit exploration memory for a contract's target location. Empty for
   * a first visit. Used to seed `Run.priorSeenKeys` on deploy and restore.
   */
  priorSeenKeysForContract(contract: Contract): string[] {
    const site = this.findRosterSite(this.locationSiteIdForContract(contract));
    return site ? [...site.seenKeys] : [];
  }

  /**
   * Campaign key items already held for a contract's target location. Used to
   * skip respawning pickup keycards on revisit (player re-opens via interact).
   */
  priorKeyItemsForContract(contract: Contract): KeyItem[] {
    const siteId = contract.context.locationSiteId;
    if (!siteId) return [];
    return this.keyItems.filter(k => k.siteId === siteId).map(k => ({ ...k }));
  }

  /** Add or refresh the roster entry for a deployed contract's location. */
  #rememberLocation(contract: Contract): void {
    const siteId = this.locationSiteIdForContract(contract);
    const existing = this.findRosterSite(siteId);
    this.addSiteToRoster({
      id: siteId,
      seed: String(contract.seed),
      mapWidth: existing?.mapWidth ?? contract.mapWidth,
      mapHeight: existing?.mapHeight ?? contract.mapHeight,
      label: contract.label,
      tier: existing?.tier ?? 'roster',
      scoreTarget: existing?.scoreTarget ?? false,
      mutationDeltas: existing ? existing.mutationDeltas : [],
      seenKeys: existing ? existing.seenKeys : [],
      lastVisitedJob: this.completedJobs,
      // A location's identity is its principal (+ site). Stored on first visit
      // so revisits can pin them and regenerate a coherent label.
      principal: contract.context.principal,
      ...(contract.context.site ? { site: contract.context.site } : {}),
    });
  }

  #contractWithRememberedDimensions(contract: Contract): Contract {
    const site = this.findRosterSite(this.locationSiteIdForContract(contract));
    if (!site) return contract;
    return { ...contract, mapWidth: site.mapWidth, mapHeight: site.mapHeight };
  }

  /**
   * Merge an extracted run's terrain mutations into its roster site. Tolerant
   * of a missing entry (e.g. a save deployed before P2.5.M7.2 then extracted
   * after the upgrade) by creating the entry first — this is a migration gap,
   * not corruption, so we heal rather than crash.
   */
  #mergeRunDeltasIntoRoster(run: Run): void {
    if (!run.contract) return;
    const deltas = run.mutationDeltas;
    if (deltas.length === 0) return;
    const siteId = this.locationSiteIdForContract(run.contract);
    if (!this.findRosterSite(siteId)) {
      this.#rememberLocation(run.contract);
    }
    this.mergeSiteDeltas(siteId, deltas);
  }

  #mergeRunSeenIntoRoster(run: Run): void {
    if (!run.contract) return;
    const seen = run.mapSeenKeys();
    if (seen.length === 0) return;
    const siteId = this.locationSiteIdForContract(run.contract);
    if (!this.findRosterSite(siteId)) {
      this.#rememberLocation(run.contract);
    }
    this.mergeSiteSeenKeys(siteId, seen);
  }

  getCrewMember(memberId: string): Crew | null {
    return this.crew.find(member => member.id === memberId) ?? null;
  }

  #advanceArcTransitions(): void {
    if (this.crew.some(member => member.archetype === 'Decker')) {
      this.arc.deckerRecruited = true;
    }

    if (this.arc.arcStage === 'act-1' && this.#qualifiesForAct2()) {
      this.arc.arcStage = 'act-2';
      this.arc.scoreRevealed = true;
    }

    // Invariant: once the Score is revealed, the Curator's Decker is on the
    // crew. Holds for fresh act-2 transitions and for restores/constructs that
    // land in a revealed state with a crew that's missing the operative.
    if (this.arc.scoreRevealed) {
      this.#assignDecker();
      this.#ensureScoreTargetDesignated();
    }

    if (this.arc.arcStage === 'act-2' && this.#qualifiesForAct3()) {
      this.arc.arcStage = 'act-3';
      this.#ensureAct3ScoreWindow();
    }

    if (this.arc.scoreRevealed && this.clockJobsTaken >= CLOCK_ACT2_GRACE_JOBS) {
      this.arc.clockStarted = true;
    }
  }

  #qualifiesForAct2(): boolean {
    return this.rep >= ARC_ACT_2_MIN_REP && this.completedJobs >= ARC_ACT_2_MIN_COMPLETED_JOBS;
  }

  #qualifiesForAct3(): boolean {
    if (this.completedJobs < ARC_ACT_3_MIN_COMPLETED_JOBS) return false;
    const livingCrew = this.crew.filter(m => !m.flatlined).length;
    if (livingCrew < ARC_ACT_3_MIN_CREW_ALIVE) return false;

    const scoreTarget = this.siteRoster.find(site => site.scoreTarget);
    if (!scoreTarget?.principal?.id) return false;

    const principalId = scoreTarget.principal.id;
    const visitedPrincipalSites = this.siteRoster.filter(
      site => site.principal?.id === principalId && site.lastVisitedJob > 0
    ).length;
    return visitedPrincipalSites >= ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED;
  }

  /**
   * Assign a Decker to the crew as part of the Act 2 narrative beat. The Curator
   * "finds" a Decker for the player — no choice modal, just a named operative.
   * Callsign is deduped against existing crew. Idempotent: skips if a Decker is
   * already on the roster (e.g. from a restored save that already transitioned).
   */
  #assignDecker(): void {
    // Guard on the actual roster, not the `deckerRecruited` flag: a restored
    // save (or a constructed campaign) can carry the flag while the crew lacks
    // the operative, and the Score reveal requires a real Decker present.
    if (this.crew.some(member => member.archetype === 'Decker')) return;

    const decker = buildCrewMember('decker', { x: 0, y: 0 }, this.rng, {
      id: `crew-decker-${this.rng.intRange(0, 0xffff).toString(16)}`,
      excludeCallsigns: this.allUsedCallsigns(),
    });
    this.crew.push(decker);
    this.arc.deckerRecruited = true;
  }

  /** A pre-Score flatline opens one free Terminal lead instead of dead-ending the campaign. */
  #needsReplacementDecker(): boolean {
    return this.arc.scoreRevealed && !this.arc.scoreAttempted && !this.hasLivingDecker;
  }

  #ensureScoreTargetDesignated(): void {
    const scoreTargets = this.siteRoster.filter(site => site.scoreTarget);
    if (scoreTargets.length > 1) {
      throw new Error('Campaign arc: multiple Score targets in site roster');
    }
    const scoreTierNonTargets = this.siteRoster.filter(
      site => site.tier === 'score' && !site.scoreTarget
    );
    if (scoreTierNonTargets.length > 0) {
      throw new Error('Campaign arc: score-tier roster site missing scoreTarget');
    }
    if (scoreTargets.length === 1) {
      scoreTargets[0]!.tier = 'score';
      return;
    }

    const target = this.#synthesizeScoreTarget();
    target.scoreTarget = true;
    target.tier = 'score';
  }

  #scoreTargetSiteOrNull(): LocationSite | null {
    const scoreTargets = this.siteRoster.filter(site => site.scoreTarget);
    if (scoreTargets.length > 1) {
      throw new Error('Campaign arc: multiple Score targets in site roster');
    }
    if (this.siteRoster.some(site => site.tier === 'score' && !site.scoreTarget)) {
      throw new Error('Campaign arc: score-tier roster site missing scoreTarget');
    }
    return scoreTargets[0] ?? null;
  }

  #beginScoreAttempt(contract: Contract): void {
    if (this.arc.arcStage !== 'act-3') {
      throw new Error('Campaign.deployCrewMember: Score can only be attempted from Act 3');
    }
    if (this.arc.scoreAttempted) {
      throw new Error('Campaign.deployCrewMember: Score has already been attempted');
    }
    if (this.arc.scoreCompleted) {
      throw new Error('Campaign.deployCrewMember: Score is already complete');
    }
    const target = this.#scoreTargetSiteOrNull();
    if (!target || contract.context.locationSiteId !== target.id) {
      throw new Error('Campaign.deployCrewMember: Score contract does not target the Score site');
    }
    this.arc.scoreAttempted = true;
    this.arc.arcStage = 'score';
  }

  #clockExpired(): boolean {
    return (
      this.arc.scoreRevealed &&
      clockDeadlineApplies(this.arc.arcStage) &&
      this.clockJobsTaken >= CLOCK_ACT2_DEADLINE_JOBS &&
      !this.arc.scoreAttempted &&
      !this.arc.scoreCompleted
    );
  }

  /** Guarantee deploy headroom once THE SCORE can appear — casing failures must not stillborn Act 3. */
  #ensureAct3ScoreWindow(): void {
    const maxTaken = CLOCK_ACT2_DEADLINE_JOBS - CLOCK_ACT3_MIN_JOBS_REMAINING;
    if (this.clockJobsTaken > maxTaken) {
      this.clockJobsTaken = maxTaken;
    }
  }

  #synthesizeScoreTarget(): LocationSite {
    const seed = this.rng.intRange(0, 0x7fffffff);
    const principal = this.rng.pick(
      CONTRACT_LEXICON.principals.filter(token => token.groups.includes('corp'))
    );
    const site = this.rng.pick(
      CONTRACT_LEXICON.sites.filter(token =>
        token.groups.some(group =>
          ['corp', 'data', 'security', 'infrastructure', 'hidden'].includes(group)
        )
      )
    );
    const dimensions = resolveMapDimensions({
      seed,
      difficulty: SYNTHETIC_SCORE_TARGET_DIFFICULTY,
    });
    const target = normalizeLocationSite({
      id: `score-${generateSiteId(seed)}`,
      seed: String(seed),
      mapWidth: dimensions.width,
      mapHeight: dimensions.height,
      label: `// ${principal.label} ${site.label} - Score target`,
      tier: 'score',
      scoreTarget: true,
      mutationDeltas: [],
      seenKeys: [],
      lastVisitedJob: 0,
      principal: locationTokenFromLexicon(principal),
      site: locationTokenFromLexicon(site),
    });
    this.siteRoster.push(target);
    return target;
  }

  #persist(): void {
    this.onPersist?.(this);
  }

  #tearDownHubWorld(): void {
    if (this.world) {
      for (const e of this.world.entities.values()) {
        const maybeBound = e as Entity & { unbind?: () => void };
        if (typeof maybeBound.unbind === 'function') maybeBound.unbind();
      }
    }
    this.world = null;
    this.queue = null;
    this.bus = null;
    this.player = null;
    this.curator = null;
    this.finn = null;
    this.terminal = null;
    this.clinic = null;
    this.exitTile = null;
  }
}

/**
 * Normalize key items from a snapshot (or undefined for pre-P2.5.M6.2 saves).
 * Validates structure. Crashes on malformed entries per project policy.
 */
function normalizeKeyItems(raw: unknown): KeyItem[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new TypeError('Campaign: keyItems must be an array when supplied');
  }
  return (raw as KeyItem[]).map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new TypeError(`Campaign: keyItems[${i}] must be an object`);
    }
    if (typeof item.id !== 'string' || item.id.length === 0) {
      throw new TypeError(`Campaign: keyItems[${i}].id must be a non-empty string`);
    }
    if (typeof item.label !== 'string' || item.label.length === 0) {
      throw new TypeError(`Campaign: keyItems[${i}].label must be a non-empty string`);
    }
    if (typeof item.doorId !== 'string' || item.doorId.length === 0) {
      throw new TypeError(`Campaign: keyItems[${i}].doorId must be a non-empty string`);
    }
    const result: KeyItem = { id: item.id, label: item.label, doorId: item.doorId };
    if (item.siteId !== undefined) {
      if (typeof item.siteId !== 'string' || item.siteId.length === 0) {
        throw new TypeError(`Campaign: keyItems[${i}].siteId must be a non-empty string when set`);
      }
      result.siteId = item.siteId;
    }
    return result;
  });
}

/**
 * Normalize the site roster from a snapshot (or undefined for pre-P2.5.M7.2
 * saves). Validates every entry and its deltas. Crashes on malformed data per
 * project policy (crash over silent bad map).
 */
function normalizeSiteRoster(raw: unknown): LocationSite[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new TypeError('Campaign: siteRoster must be an array when supplied');
  }
  return raw.map(entry => normalizeLocationSite(entry));
}

export function isCampaignArcStage(value: unknown): value is CampaignArcStage {
  return typeof value === 'string' && CAMPAIGN_ARC_STAGES.includes(value as CampaignArcStage);
}

export function normalizeCampaignArc(raw: unknown, context = 'Campaign arc'): CampaignArc {
  if (raw === undefined) return defaultCampaignArc();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`${context} must be an object when supplied`);
  }

  const candidate = raw as Partial<Record<keyof CampaignArc, unknown>>;
  if (!isCampaignArcStage(candidate.arcStage)) {
    throw new Error(`${context}.arcStage "${candidate.arcStage}" is not known`);
  }

  const readBooleanArcFlag = (flag: keyof Omit<CampaignArc, 'arcStage'>): boolean => {
    const value = candidate[flag];
    if (typeof value !== 'boolean') {
      throw new TypeError(`${context}.${flag} must be boolean`);
    }
    return value;
  };

  return {
    arcStage: candidate.arcStage,
    deckerRecruited: readBooleanArcFlag('deckerRecruited'),
    scoreRevealed: readBooleanArcFlag('scoreRevealed'),
    clockStarted: readBooleanArcFlag('clockStarted'),
    scoreAttempted: readBooleanArcFlag('scoreAttempted'),
    scoreCompleted: readBooleanArcFlag('scoreCompleted'),
  };
}

function locationTokenFromLexicon(token: {
  id: string;
  label: string;
  groups: readonly string[];
}): LocationToken {
  return {
    id: token.id,
    label: token.label,
    groups: [...token.groups],
  };
}

function locationContextToken(token: LocationToken) {
  return {
    id: token.id,
    label: token.label,
    groups: [...token.groups],
  };
}

function isScoreContract(contract: Contract): boolean {
  return contract.context.tags.includes('score') && contract.context.recipeId === 'score-final';
}

function makeCampaignId(seed: number): string {
  return `campaign-${(seed >>> 0).toString(16)}-${Date.now().toString(36)}`;
}
