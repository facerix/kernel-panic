/**
 * P2.5.M5.4 — Progressive Hub feature introductions.
 *
 * Reveal definitions are ordered: the first unseen entry whose trigger
 * qualifies fires once per `enterHub`, sets its flag, and returns Curator copy
 * for the shell. Phase 3 adds entries here without changing the check loop.
 */

import { REP } from '../constants.js';
import { totalSalvage } from '../salvage.js';
import { clockRevealLines, act3RevealLines, scoreRevealLines } from './arcSurface.js';
import type { Campaign } from '../Campaign.js';

export type HubReveals = {
  finnIntroduced?: boolean;
  /** Crew roster / inventory access at the hub terminal. */
  terminalExplained?: boolean;
  /** Rep-gated recruitment channel on the terminal. */
  terminalRecruitmentExplained?: boolean;
  clinicIntroduced?: boolean;
  /** Curator has presented the Phase 3 Score target reveal. */
  scoreBriefingPresented?: boolean;
  /** Curator has explained Clock heat and the Score window deadline. */
  clockBriefingPresented?: boolean;
  /** Curator has presented Act 3 final prep and THE SCORE availability. */
  act3BriefingPresented?: boolean;
};

export type HubRevealId =
  | 'finn'
  | 'terminal'
  | 'terminal-recruit'
  | 'clinic'
  | 'score-reveal'
  | 'clock-reveal'
  | 'act-3-reveal';

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
  lines: readonly string[] | ((campaign: Campaign) => readonly string[]);
};

/** Reveal flags committed when the shell dismisses the Curator briefing, not when queued. */
const HUB_REVEAL_DEFER_FLAG_COMMIT = new Set<HubRevealId>([
  'score-reveal',
  'clock-reveal',
  'act-3-reveal',
]);

/** Arc beats checked before lower-priority Hub intros; order within this list matters. */
const PRIORITY_HUB_REVEALS: readonly HubRevealId[] = [
  'score-reveal',
  'clock-reveal',
  'act-3-reveal',
];

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
    id: 'score-reveal',
    flag: 'scoreBriefingPresented',
    title: '── THE SCORE / THE DECKER ──',
    qualifies(campaign) {
      return campaign.arc.scoreRevealed;
    },
    lines: scoreRevealLines,
  },
  {
    id: 'clock-reveal',
    flag: 'clockBriefingPresented',
    title: '── THE CLOCK ──',
    qualifies(campaign) {
      return (
        campaign.arc.clockStarted &&
        !!campaign.hubReveals.scoreBriefingPresented &&
        !campaign.hubReveals.clockBriefingPresented
      );
    },
    lines: clockRevealLines,
  },
  {
    id: 'act-3-reveal',
    flag: 'act3BriefingPresented',
    title: '── FINAL PREP / THE SCORE ──',
    qualifies(campaign) {
      return !!campaign.hubReveals.scoreBriefingPresented && campaign.canAttemptScore();
    },
    lines: act3RevealLines,
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
    'scoreBriefingPresented',
    'clockBriefingPresented',
    'act3BriefingPresented',
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
  if (reveals.scoreBriefingPresented) out.scoreBriefingPresented = true;
  if (reveals.clockBriefingPresented) out.clockBriefingPresented = true;
  if (reveals.act3BriefingPresented) out.act3BriefingPresented = true;
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

function buildHubRevealMessage(
  def: HubRevealDefinition,
  campaign: Campaign,
  commitFlag: boolean
): HubRevealMessage {
  if (commitFlag) {
    campaign.hubReveals[def.flag] = true;
  }
  const lines = typeof def.lines === 'function' ? def.lines(campaign) : def.lines;
  return { id: def.id, title: def.title, lines };
}

export function hubRevealCommitsOnDismiss(id: HubRevealId): boolean {
  return HUB_REVEAL_DEFER_FLAG_COMMIT.has(id);
}

/** Persist a Hub reveal flag after the player dismisses its Curator briefing. */
export function commitHubReveal(campaign: Campaign, id: HubRevealId): void {
  const def = HUB_REVEAL_DEFINITIONS.find(entry => entry.id === id);
  if (!def) {
    throw new Error(`hubReveals: unknown reveal id "${id}"`);
  }
  campaign.hubReveals[def.flag] = true;
}

/**
 * Evaluate reveal triggers in definition order. Sets the first qualifying
 * unseen flag on `campaign.hubReveals` and returns its message. Does not persist.
 * Score and Clock reveals are checked first so arc beats are not crowded out by
 * lower-priority intros on the same visit. Their briefing flags commit on dismiss.
 */
export function applyFirstHubReveal(campaign: Campaign): HubRevealMessage | null {
  for (const id of PRIORITY_HUB_REVEALS) {
    const def = HUB_REVEAL_DEFINITIONS.find(entry => entry.id === id);
    if (!def || campaign.hubReveals[def.flag] || !def.qualifies(campaign)) continue;
    return buildHubRevealMessage(def, campaign, !HUB_REVEAL_DEFER_FLAG_COMMIT.has(def.id));
  }

  for (const def of HUB_REVEAL_DEFINITIONS) {
    if (PRIORITY_HUB_REVEALS.includes(def.id)) continue;
    if (campaign.hubReveals[def.flag]) continue;
    if (!def.qualifies(campaign)) continue;
    return buildHubRevealMessage(def, campaign, true);
  }
  return null;
}
