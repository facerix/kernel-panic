import { Rng } from '../rng.js';
import { World } from './World.js';
import { TurnQueue } from './TurnQueue.js';
import { EventBus } from './events.js';
import { Entity } from './Entity.js';
import { FACTION, REP, RECRUIT, SALVAGE_SELL_RATE, CLINIC_COST_PER_HP } from './constants.js';
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
import { Curator } from './hub/Curator.js';
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
  normalizeLocationSite,
} from './locations.js';
import type { Contract } from './hub/Curator.js';
import type { Crew } from './Crew.js';
import type { GridPoint, KeyItem, LocationSite, TileDelta } from '../types.js';
import type { RunResult, Outcome } from './Run.js';

/** M7.2: max remembered combat locations. One slot is reserved for Phase 3's score target. */
export const SITE_ROSTER_CAP = 6;

export const CAMPAIGN_STATE = Object.freeze({
  HUB: 'HUB',
  COMBAT: 'COMBAT',
  ENDED: 'ENDED',
});

const STARTER_ARCHETYPES = Object.freeze(['merc', 'razor', 'tech']);

export type CampaignState = (typeof CAMPAIGN_STATE)[keyof typeof CAMPAIGN_STATE];
// M5.1: `expandedCatalog` and `betterContracts` removed — Rep tiers replace
// them. Old saves may still carry those keys as dead data; the type is a
// plain Record so they don't cause a type error on restore.
export type CampaignMeta = Record<string, unknown>;

export type CampaignOptions = {
  id?: string;
  seed?: unknown;
  crew?: unknown;
  salvage?: unknown;
  credits?: unknown;
  rep?: unknown;
  meta?: unknown;
  hubReveals?: unknown;
  completedJobs?: unknown;
  keyItems?: unknown;
  siteRoster?: unknown;
  onPersist?: unknown;
  onResult?: unknown;
};

type CampaignLike = {
  crew: { flatlined: boolean }[];
};

/**
 * True when exactly one crew member is not yet `flatlined` — the operator
 * currently on a job. A `DEATH` outcome on `Campaign.onJobEnd` would flatline
 * them and set `Campaign.state` to `ENDED`. The shell uses this to swap the
 * debrief overlay before `onJobEnd` runs.
 *
 * @param {{ crew: { flatlined: boolean }[] }} campaign
 */
export function willEndCampaignOnThisDeath(campaign: CampaignLike): boolean {
  if (!campaign || typeof campaign !== 'object' || !Array.isArray(campaign.crew)) {
    throw new TypeError('willEndCampaignOnThisDeath requires a Campaign-like object with crew[]');
  }
  return campaign.crew.filter(member => !member.flatlined).length === 1;
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
  /** M6.2: persistent key-item inventory — keycards survive across runs. */
  keyItems: KeyItem[];
  /** M7.2: remembered combat locations (max `SITE_ROSTER_CAP`). */
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
    hubReveals,
    completedJobs = 0,
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
    // M4.2: salvage is now a TypedSalvage wallet. `migrateSalvage` accepts
    // either a legacy non-negative integer (buckets entirely into scrap) or a
    // structurally valid TypedSalvage. Anything else crashes.
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
    this.hubReveals = normalizeHubReveals(hubReveals, 'Campaign hubReveals');
    this.completedJobs = (completedJobs as number) ?? 0;
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

  enterHub(): void {
    if (this.state !== CAMPAIGN_STATE.HUB && this.state !== CAMPAIGN_STATE.COMBAT) {
      throw new Error(`Campaign.enterHub: illegal transition from ${this.state}`);
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
    if (this.rep < REP.RECRUIT_THRESHOLD && !this.pendingRecruitReward) return;
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
    const deployedContract = this.#contractWithRememberedDimensions(contract);
    this.#tearDownHubWorld();
    this.deployedMemberId = member.id;
    this.activeRun = new Run({
      crewMember: member,
      seed: deployedContract.seed,
      // M7.2: replay prior-visit terrain on revisits ([] for first visits).
      priorMutationDeltas: this.priorDeltasForContract(deployedContract),
      priorKeyItems: this.priorKeyItemsForContract(deployedContract),
      onPersist: () => this.#persist(),
      onResult: (result: RunResult) => {
        this.onResult?.(result);
      },
    });
    this.activeRun.enterBriefing(deployedContract);
    // M7.2: remember this location (or refresh its visit marker) on deploy.
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
    // M4.2: salvage payload is now typed. Default to empty (no carry-out on
    // a death; shell omits the param). Validate structure when provided so a
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

    if (outcome === OUTCOME.DEATH) {
      this.flatlineMember(this.deployedMemberId);
    } else {
      // M7.2: persist this run's terrain mutations into the site roster before
      // returning to the Hub — breach holes survive even on an aborted exit.
      this.#mergeRunDeltasIntoRoster(this.activeRun);
      this.completedJobs += 1;
      if (completed) {
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

    if (this.crew.every(member => member.flatlined)) {
      this.state = CAMPAIGN_STATE.ENDED;
      this.#tearDownHubWorld();
      this.#persist();
      return;
    }

    this.state = CAMPAIGN_STATE.HUB;
    this.enterHub();
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
   * Sell salvage to Finn for Creds.
   *
   * M5.2: each salvage type has a distinct Cred-per-unit rate via
   * `SALVAGE_SELL_RATE`. When `type` is provided, sells exactly that type at
   * its rate. When omitted, draws from buckets in `SALVAGE_TYPES` priority
   * order (scrap → chips → bio → data), applying each type's rate as units
   * are drawn. Throws on all illegal preconditions.
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

  // ─── Recruitment (M6) ─────────────────────────────────────────────────────

  /**
   * Collect every callsign ever used by any crew member (living or flatlined)
   * and any current recruit candidate. Used to prevent callsign recycling
   * within a campaign — the kaizen item from M2.
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

  // ─── Initial recruitment (M6 Phase B) ────────────────────────────────────

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

  // ─── Key items (M6.2) ───────────────────────────────────────────────────

  /**
   * Add a key item to the campaign's persistent inventory. Key items survive
   * across runs and are never consumed on use (a keycard that unlocks a door
   * stays in the inventory for revisit matching in M7.2).
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

  // ─── Location memory / site roster (M7.2) ─────────────────────────────────

  /** Look up a remembered site by its `LocationSite.id`. */
  findRosterSite(siteId: string): LocationSite | null {
    return this.siteRoster.find(s => s.id === siteId) ?? null;
  }

  /**
   * Add a remembered site to the roster, or refresh `lastVisitedJob` if it is
   * already present. At capacity, evict the oldest `roster`-tier site (lowest
   * `lastVisitedJob`); `score`-tier sites are never evicted. If the roster is
   * full of score-tier sites (degenerate — only one score slot exists in M7),
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
      lastVisitedJob: this.completedJobs,
      // M7.2: a location's identity is its principal (+ site). Stored on first
      // visit so revisits can pin them and regenerate a coherent label.
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
   * of a missing entry (e.g. a save deployed before M7.2 then extracted after
   * the upgrade) by creating the entry first — this is a migration gap, not
   * corruption, so we heal rather than crash.
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

  getCrewMember(memberId: string): Crew | null {
    return this.crew.find(member => member.id === memberId) ?? null;
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
 * M6.2: Normalize key items from a snapshot (or undefined for pre-M6.2 saves).
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
 * M7.2: Normalize the site roster from a snapshot (or undefined for pre-M7.2
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

function makeCampaignId(seed: number): string {
  return `campaign-${(seed >>> 0).toString(16)}-${Date.now().toString(36)}`;
}
