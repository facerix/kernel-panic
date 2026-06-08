/**
 * P2.5.M5.4 — Progressive Hub feature introductions.
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
  /** Crew roster / inventory access at the hub terminal. */
  terminalExplained?: boolean;
  /** Rep-gated recruitment channel on the terminal. */
  terminalRecruitmentExplained?: boolean;
  clinicIntroduced?: boolean;
};

export type HubRevealId = 'finn' | 'terminal' | 'terminal-recruit' | 'clinic';

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
    id: 'terminal',
    flag: 'terminalExplained',
    title: '── CREW TERMINAL ──',
    qualifies(campaign) {
      return campaign.crew.length > 0;
    },
    lines: [
      "CURATOR: Terminal's online — crew readout.",
      'CURATOR: [Space] at the ‡ glyph to review operatives, gear, and salvage.',
    ],
  },
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
    id: 'terminal-recruit',
    flag: 'terminalRecruitmentExplained',
    title: '── ROSTER ACCESS ──',
    qualifies(campaign) {
      return campaign.rep >= REP.RECRUIT_THRESHOLD || campaign.pendingRecruitReward;
    },
    lines: [
      'CURATOR: Recruitment channel open on the terminal.',
      "CURATOR: Rep's high enough — [Space] at the ‡ glyph to recruit new operatives.",
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
  for (const key of [
    'finnIntroduced',
    'terminalExplained',
    'terminalRecruitmentExplained',
    'clinicIntroduced',
  ] as const) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== 'boolean') {
      throw new TypeError(`${context}.${key} must be a boolean when present`);
    }
    out[key] = record[key];
  }
  return out;
}

/**
 * Pre-split snapshots used `terminalExplained` for the combined roster +
 * recruitment unlock. Call from persistence restore only — not on live
 * `Campaign` construction where `terminalExplained` now means crew access.
 */
export function migrateLegacyHubReveals(
  raw: unknown,
  context: { rep?: number; pendingRecruitReward?: boolean } = {}
): unknown {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }
  const record = raw as Record<string, unknown>;
  if (record.terminalExplained === true && !('terminalRecruitmentExplained' in record)) {
    const rep = context.rep ?? REP.START;
    const pending = context.pendingRecruitReward ?? false;
    // Pre-split saves only set terminalExplained when recruitment unlocked (Rep ≥ 65).
    if (rep >= REP.RECRUIT_THRESHOLD || pending) {
      return { ...record, terminalRecruitmentExplained: true };
    }
  }
  return raw;
}

/** Persist hub reveal flags; always writes `terminalRecruitmentExplained` so restore can distinguish new saves from legacy. */
export function snapshotHubReveals(reveals: HubReveals): HubReveals {
  const out: HubReveals = {
    terminalRecruitmentExplained: reveals.terminalRecruitmentExplained ?? false,
  };
  if (reveals.finnIntroduced) out.finnIntroduced = true;
  if (reveals.terminalExplained) out.terminalExplained = true;
  if (reveals.clinicIntroduced) out.clinicIntroduced = true;
  return out;
}

export function shouldSpawnFinn(reveals: HubReveals): boolean {
  return !!reveals.finnIntroduced;
}

export function shouldSpawnClinic(reveals: HubReveals): boolean {
  return !!reveals.clinicIntroduced;
}

export function isTerminalAccessible(reveals: HubReveals): boolean {
  return !!reveals.terminalExplained;
}

export function isTerminalRecruitmentUnlocked(reveals: HubReveals): boolean {
  return !!reveals.terminalRecruitmentExplained;
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
