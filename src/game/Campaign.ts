import { Rng } from '../rng.js';
import { World } from './World.js';
import { TurnQueue } from './TurnQueue.js';
import { EventBus } from './events.js';
import { Entity } from './Entity.js';
import { FACTION, REP } from './constants.js';
import { buildCrewMember } from './archetypes/index.js';
import { Curator } from './hub/Curator.js';
import { Terminal } from './hub/Terminal.js';
import { Finn } from './hub/Finn.js';
import { buildHub } from './hub/SafeSpace.js';
import { getItemById, ITEM_SCOPE, metaKeyFor } from './items.js';
import { OUTCOME, Run } from './Run.js';
import type { Contract } from './hub/Curator.js';
import type { Crew } from './Crew.js';
import type { GridPoint } from '../types.js';
import type { RunResult, Outcome } from './Run.js';

export const CAMPAIGN_STATE = Object.freeze({
  HUB: 'HUB',
  COMBAT: 'COMBAT',
  ENDED: 'ENDED',
});

const STARTER_ARCHETYPES = Object.freeze(['merc', 'razor', 'tech']);

export type CampaignState = (typeof CAMPAIGN_STATE)[keyof typeof CAMPAIGN_STATE];
export type CampaignMeta = Record<string, unknown> & {
  expandedCatalog?: boolean;
};

export type CampaignOptions = {
  id?: string;
  seed?: unknown;
  crew?: unknown;
  salvage?: unknown;
  rep?: unknown;
  meta?: unknown;
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
  salvage: number;
  rep: number;
  meta: CampaignMeta;
  state: CampaignState;
  activeRun: Run | null;
  deployedMemberId: string | null;
  onPersist: ((campaign: Campaign) => void) | null;
  onResult: ((result: RunResult) => void) | null;
  world: World | null;
  queue: TurnQueue | null;
  bus: EventBus | null;
  player: Entity | null;
  curator: Curator | null;
  finn: Finn | null;
  terminal: Terminal | null;
  exitTile: GridPoint | null;

  constructor({
    id,
    seed,
    crew,
    salvage = 0,
    rep = 50,
    meta = {},
    onPersist,
    onResult,
  }: CampaignOptions = {}) {
    if (typeof seed !== 'number' || !Number.isFinite(seed)) {
      throw new TypeError(`Campaign requires a finite numeric seed, got ${seed}`);
    }
    if (crew !== undefined && !Array.isArray(crew)) {
      throw new TypeError('Campaign: crew must be an array when supplied');
    }
    if (typeof salvage !== 'number' || !Number.isInteger(salvage) || salvage < 0) {
      throw new RangeError(`Campaign salvage must be a non-negative integer, got ${salvage}`);
    }
    if (typeof rep !== 'number' || !Number.isInteger(rep) || rep < 0 || rep > 100) {
      throw new RangeError(`Campaign rep must be an integer in [0, 100], got ${rep}`);
    }
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
      throw new TypeError('Campaign meta must be a plain object');
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
    this.salvage = salvage;
    this.rep = rep;
    this.meta = { ...(meta as CampaignMeta) };
    this.state = CAMPAIGN_STATE.HUB;
    this.activeRun = null;
    this.deployedMemberId = null;
    this.onPersist = (onPersist as ((campaign: Campaign) => void) | undefined) ?? null;
    this.onResult = (onResult as ((result: RunResult) => void) | undefined) ?? null;

    this.world = null;
    this.queue = null;
    this.bus = null;
    this.player = null;
    this.curator = null;
    this.finn = null;
    this.terminal = null;
    this.exitTile = null;

    this.enterHub();
  }

  enterHub(): void {
    if (this.state !== CAMPAIGN_STATE.HUB && this.state !== CAMPAIGN_STATE.COMBAT) {
      throw new Error(`Campaign.enterHub: illegal transition from ${this.state}`);
    }
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
    this.finn = new Finn({
      id: 'finn',
      x: hub.finnSpawn.x,
      y: hub.finnSpawn.y,
    });
    this.terminal = new Terminal({
      id: 'terminal',
      x: hub.terminalSpawn.x,
      y: hub.terminalSpawn.y,
    });
    this.world.addEntity(this.player);
    this.world.addEntity(this.curator);
    this.world.addEntity(this.finn);
    this.world.addEntity(this.terminal);
    this.queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
    this.exitTile = { ...hub.exitTile };
    this.state = CAMPAIGN_STATE.HUB;
    this.#persist();
  }

  deployCrewMember(
    memberId: string,
    contract: Pick<Contract, 'seed'> & Record<string, unknown>
  ): Run {
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
    this.#tearDownHubWorld();
    this.deployedMemberId = member.id;
    this.activeRun = new Run({
      crewMember: member,
      seed: contract.seed,
      onPersist: () => this.#persist(),
      onResult: (result: RunResult) => {
        this.onResult?.(result);
      },
    });
    this.activeRun.enterBriefing(contract);
    this.state = CAMPAIGN_STATE.COMBAT;
    this.#persist();
    return this.activeRun;
  }

  onJobEnd({ outcome, salvage = 0 }: { outcome?: Outcome; salvage?: number } = {}): void {
    if (this.state !== CAMPAIGN_STATE.COMBAT || !this.activeRun || !this.deployedMemberId) {
      throw new Error(`Campaign.onJobEnd: no active job from ${this.state}`);
    }
    if (outcome !== OUTCOME.DEATH && outcome !== OUTCOME.EXIT) {
      throw new Error(`Campaign.onJobEnd: unknown outcome "${outcome}"`);
    }
    if (!Number.isInteger(salvage) || salvage < 0) {
      throw new RangeError(`Campaign.onJobEnd: salvage must be a non-negative integer`);
    }

    if (outcome === OUTCOME.DEATH) {
      this.flatlineMember(this.deployedMemberId);
    } else {
      this.salvage += salvage;
    }
    // Clear job-scoped salvage (extracted or forfeited on death).
    // Consumables persist in the crew member's inventory until used —
    // they're a permanent part of the loadout, not job-scoped.
    const member = this.getCrewMember(this.deployedMemberId);
    if (member?.inventory) {
      member.inventory.salvage = 0;
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
   * Purchase an item from Finn's shop. Deducts salvage, applies the item
   * effect, and persists. Throws on all illegal preconditions (insufficient
   * salvage, unknown item, duplicate meta purchase) — crash over silent
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
    if (this.salvage < item.cost) {
      throw new Error(
        `Campaign.purchase: insufficient salvage (have ${this.salvage}, need ${item.cost})`
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

    // Commit: deduct salvage first, then apply effect.
    this.salvage -= item.cost;

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
    this.exitTile = null;
  }
}

function makeCampaignId(seed: number): string {
  return `campaign-${(seed >>> 0).toString(16)}-${Date.now().toString(36)}`;
}
