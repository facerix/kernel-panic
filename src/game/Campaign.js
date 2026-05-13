import { Rng } from '../rng.js';
import { World } from './World.js';
import { TurnQueue } from './TurnQueue.js';
import { EventBus } from './events.js';
import { Entity } from './Entity.js';
import { FACTION } from './constants.js';
import { buildCrewMember } from './archetypes/index.js';
import { Curator } from './hub/Curator.js';
import { Terminal } from './hub/Terminal.js';
import { buildHub } from './hub/SafeSpace.js';
import { OUTCOME, Run } from './Run.js';

export const CAMPAIGN_STATE = Object.freeze({
  HUB: 'HUB',
  COMBAT: 'COMBAT',
  ENDED: 'ENDED',
});

const STARTER_ARCHETYPES = Object.freeze(['merc', 'razor', 'tech']);

/**
 * True when exactly one crew member is not yet `flatlined` — the operator
 * currently on a job. A `DEATH` outcome on `Campaign.onJobEnd` would flatline
 * them and set `Campaign.state` to `ENDED`. The shell uses this to swap the
 * debrief overlay before `onJobEnd` runs.
 *
 * @param {{ crew: { flatlined: boolean }[] }} campaign
 */
export function willEndCampaignOnThisDeath(campaign) {
  if (!campaign || typeof campaign !== 'object' || !Array.isArray(campaign.crew)) {
    throw new TypeError('willEndCampaignOnThisDeath requires a Campaign-like object with crew[]');
  }
  return campaign.crew.filter(member => !member.flatlined).length === 1;
}

export function buildCrew(rng) {
  if (!rng || typeof rng.pick !== 'function') {
    throw new TypeError('buildCrew requires an Rng');
  }
  const usedCallsigns = new Set();
  return STARTER_ARCHETYPES.map(archetypeId => {
    const member = buildCrewMember(archetypeId, { x: 0, y: 0 }, rng, {
      id: `crew-${archetypeId}`,
      excludeCallsigns: usedCallsigns,
    });
    usedCallsigns.add(member.callsign);
    return member;
  });
}

export class Campaign {
  constructor({ id, seed, crew, salvage = 0, vouch = 50, meta = {}, onPersist, onResult } = {}) {
    if (!Number.isFinite(seed)) {
      throw new TypeError(`Campaign requires a finite numeric seed, got ${seed}`);
    }
    if (crew !== undefined && !Array.isArray(crew)) {
      throw new TypeError('Campaign: crew must be an array when supplied');
    }
    if (!Number.isInteger(salvage) || salvage < 0) {
      throw new RangeError(`Campaign salvage must be a non-negative integer, got ${salvage}`);
    }
    if (!Number.isInteger(vouch) || vouch < 0 || vouch > 100) {
      throw new RangeError(`Campaign vouch must be an integer in [0, 100], got ${vouch}`);
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
    this.crew = crew ?? buildCrew(this.rng);
    this.salvage = salvage;
    this.vouch = vouch;
    this.meta = { ...meta };
    this.state = CAMPAIGN_STATE.HUB;
    this.activeRun = null;
    this.deployedMemberId = null;
    this.onPersist = onPersist ?? null;
    this.onResult = onResult ?? null;

    this.world = null;
    this.queue = null;
    this.bus = null;
    this.player = null;
    this.curator = null;
    this.terminal = null;
    this.exitTile = null;

    this.enterHub();
  }

  enterHub() {
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
    this.terminal = new Terminal({
      id: 'terminal',
      x: hub.terminalSpawn.x,
      y: hub.terminalSpawn.y,
    });
    this.world.addEntity(this.player);
    this.world.addEntity(this.curator);
    this.world.addEntity(this.terminal);
    this.queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
    this.exitTile = { ...hub.exitTile };
    this.state = CAMPAIGN_STATE.HUB;
    this.#persist();
  }

  deployCrewMember(memberId, contract) {
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
      onResult: result => {
        this.onResult?.(result);
      },
    });
    this.activeRun.enterBriefing(contract);
    this.state = CAMPAIGN_STATE.COMBAT;
    this.#persist();
    return this.activeRun;
  }

  onJobEnd({ outcome, salvage = 0 } = {}) {
    if (this.state !== CAMPAIGN_STATE.COMBAT || !this.activeRun || !this.deployedMemberId) {
      throw new Error(`Campaign.onJobEnd: no active job from ${this.state}`);
    }
    if (!Object.values(OUTCOME).includes(outcome)) {
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

  flatlineMember(memberId) {
    const member = this.getCrewMember(memberId);
    if (!member) {
      throw new Error(`Campaign.flatlineMember: unknown crew member "${memberId}"`);
    }
    member.flatlined = true;
  }

  getCrewMember(memberId) {
    return this.crew.find(member => member.id === memberId) ?? null;
  }

  #persist() {
    this.onPersist?.(this);
  }

  #tearDownHubWorld() {
    if (this.world) {
      for (const e of this.world.entities.values()) {
        if (typeof e.unbind === 'function') e.unbind();
      }
    }
    this.world = null;
    this.queue = null;
    this.bus = null;
    this.player = null;
    this.curator = null;
    this.terminal = null;
    this.exitTile = null;
  }
}

function makeCampaignId(seed) {
  return `campaign-${(seed >>> 0).toString(16)}-${Date.now().toString(36)}`;
}
