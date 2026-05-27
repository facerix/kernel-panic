/**
 * M5.4 — Progressive Hub feature introductions.
 *
 * Reveal definitions are ordered: the first unseen entry whose trigger
 * qualifies fires once per `enterHub`, sets its flag, and returns Curator copy
 * for the shell. Phase 3 adds entries here without changing the check loop.
 */

import { REP } from '../constants.js';
import { totalSalvage } from '../salvage.js';
import type { Campaign } from '../Campaign.js';

export type HubReveals = {
  finnIntroduced?: boolean;
  terminalExplained?: boolean;
  clinicIntroduced?: boolean;
};

export type HubRevealId = 'finn' | 'terminal' | 'clinic';

export type HubRevealMessage = {
  id: HubRevealId;
  title: string;
  lines: readonly string[];
};

type HubRevealFlag = keyof HubReveals;

type HubRevealDefinition = {
  id: HubRevealId;
  flag: HubRevealFlag;
  title: string;
  qualifies: (campaign: Campaign) => boolean;
  lines: readonly string[];
};

const HUB_REVEAL_DEFINITIONS: readonly HubRevealDefinition[] = [
  {
    id: 'finn',
    flag: 'finnIntroduced',
    title: '── FENCE CONTACT ──',
    qualifies(campaign) {
      return (
        campaign.completedJobs > 0 || campaign.credits > 0 || totalSalvage(campaign.salvage) > 0
      );
    },
    lines: [
      "CURATOR: Finn's on the floor now — fence, back row.",
      'CURATOR: Salvage to Creds. Walk up and [Space] when you need to liquidate.',
    ],
  },
  {
    id: 'clinic',
    flag: 'clinicIntroduced',
    title: '── CLINIC OPEN ──',
    qualifies(campaign) {
      return campaign.crew.some(member => !member.flatlined && member.hp < member.maxHp);
    },
    lines: [
      'CURATOR: Patch is in — clinic, bottom-left.',
      'CURATOR: Crew took hits. [Space] at ⧰ to patch up for Creds between jobs.',
    ],
  },
  {
    id: 'terminal',
    flag: 'terminalExplained',
    title: '── ROSTER ACCESS ──',
    qualifies(campaign) {
      return campaign.rep >= REP.RECRUIT_THRESHOLD || campaign.pendingRecruitReward;
    },
    lines: [
      "CURATOR: Terminal's live for roster work.",
      "CURATOR: Rep's high enough — [Space] at the ‡ glyph to recruit or review crew.",
    ],
  },
];

export function emptyHubReveals(): HubReveals {
  return {};
}

export function normalizeHubReveals(raw: unknown, context = 'hubReveals'): HubReveals {
  if (raw === undefined || raw === null) return emptyHubReveals();
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`${context} must be a plain object`);
  }
  const record = raw as Record<string, unknown>;
  const out: HubReveals = {};
  for (const key of ['finnIntroduced', 'terminalExplained', 'clinicIntroduced'] as const) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== 'boolean') {
      throw new TypeError(`${context}.${key} must be a boolean when present`);
    }
    out[key] = record[key];
  }
  return out;
}

export function shouldSpawnFinn(reveals: HubReveals): boolean {
  return !!reveals.finnIntroduced;
}

export function shouldSpawnClinic(reveals: HubReveals): boolean {
  return !!reveals.clinicIntroduced;
}

export function isTerminalRecruitmentUnlocked(reveals: HubReveals): boolean {
  return !!reveals.terminalExplained;
}

/**
 * Evaluate reveal triggers in definition order. Sets the first qualifying
 * unseen flag on `campaign.hubReveals` and returns its message. Does not persist.
 */
export function applyFirstHubReveal(campaign: Campaign): HubRevealMessage | null {
  for (const def of HUB_REVEAL_DEFINITIONS) {
    if (campaign.hubReveals[def.flag]) continue;
    if (!def.qualifies(campaign)) continue;
    campaign.hubReveals[def.flag] = true;
    return { id: def.id, title: def.title, lines: def.lines };
  }
  return null;
}
