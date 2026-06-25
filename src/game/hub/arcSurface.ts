import type { Contract } from './Curator.js';
import type { Campaign } from '../Campaign.js';
import type { HubReveals } from './hubReveals.js';
import {
  CLOCK_ACT2_DEADLINE_JOBS,
  CLOCK_ACT2_GRACE_JOBS,
  clockDeadlineApplies,
} from '../Campaign.js';
import type { CampaignArcStage, LocationSite } from '../../types.js';
import type { Decker } from '../archetypes/Decker.js';
import type { Crew } from '../Crew.js';

type ArcSurfaceCampaign = Pick<Campaign, 'arc' | 'siteRoster' | 'crew'> &
  Partial<
    Pick<Campaign, 'completedJobs' | 'clockJobsTaken' | 'clockHeat' | 'scoreDeadlineJobsRemaining'>
  > & {
    hubReveals?: HubReveals;
  };

export type HubArcStatusLines = readonly [summary: string, clock: string | null];

const ARC_STAGE_LABELS: Record<CampaignArcStage, string> = Object.freeze({
  'act-1': 'STAGE 1: STREET LEVEL',
  'act-2': 'STAGE 2: CASING',
  'act-3': 'STAGE 3: FINAL PREP',
  score: 'THE SCORE',
});

export function findScoreTargetSite(sites: readonly LocationSite[]): LocationSite | null {
  const targets = sites.filter(site => site.scoreTarget);
  if (targets.length > 1) {
    throw new Error('arcSurface: multiple Score targets in site roster');
  }
  return targets[0] ?? null;
}

export function scoreTargetDisplayName(site: LocationSite): string {
  const principal = cleanLabel(site.principal?.label);
  const place = cleanLabel(site.site?.label);
  if (principal && place) return `${principal} ${place}`;
  if (principal) return principal;
  if (place) return place;
  return cleanSiteLabel(site.label);
}

export function formatArcStageLabel(stage: CampaignArcStage): string {
  const label = ARC_STAGE_LABELS[stage];
  if (!label) {
    throw new Error(`arcSurface: unknown arc stage "${stage}"`);
  }
  return label;
}

export function formatHubArcStatus(campaign: ArcSurfaceCampaign): string {
  return formatHubArcStatusLines(campaign)
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function formatHubArcStatusLines(campaign: ArcSurfaceCampaign): HubArcStatusLines {
  const parts = [formatArcStageLabel(campaign.arc.arcStage)];
  if (campaign.arc.scoreRevealed) {
    const target = findScoreTargetSite(campaign.siteRoster);
    if (!target) {
      throw new Error('arcSurface: score revealed without a Score target site');
    }
    parts.push(`SCORE: ${scoreTargetDisplayName(target)}`);
  }
  return [parts.join(' | '), formatClockStatus(campaign)];
}

/** Clock HUD line — only after the Curator briefing, and only while heat is active. */
export function formatClockStatus(campaign: ArcSurfaceCampaign): string | null {
  if (!campaign.hubReveals?.clockBriefingPresented) return null;
  if (!campaign.arc.clockStarted) return null;
  if (campaign.arc.scoreAttempted || campaign.arc.scoreCompleted) return null;

  const clockJobsTaken = campaign.clockJobsTaken ?? 0;
  const heat = campaign.clockHeat ?? Math.max(0, clockJobsTaken - CLOCK_ACT2_GRACE_JOBS);

  if (!clockDeadlineApplies(campaign.arc.arcStage)) {
    return `CLOCK: HEAT ${heat}`;
  }

  if (clockJobsTaken >= CLOCK_ACT2_DEADLINE_JOBS) return null;

  const jobsRemaining =
    campaign.scoreDeadlineJobsRemaining ?? Math.max(0, CLOCK_ACT2_DEADLINE_JOBS - clockJobsTaken);
  return `CLOCK: HEAT ${heat} / ${jobsRemaining} JOBS LEFT`;
}

export function scoreRevealLines(campaign: ArcSurfaceCampaign): readonly string[] {
  if (!campaign.arc.scoreRevealed) {
    throw new Error('arcSurface: cannot build Score reveal copy before scoreRevealed');
  }
  const target = findScoreTargetSite(campaign.siteRoster);
  if (!target) {
    throw new Error('arcSurface: cannot build Score reveal copy without a Score target');
  }
  const targetName = scoreTargetDisplayName(target);
  const deckerName = findDecker(campaign.crew).callsign;
  return [
    `CURATOR: We found it: ${targetName}. The Score has a door.`,
    'CURATOR: Jobs tagged CASING on the board hit the Score org — take those to learn the target.',
    `CURATOR: You'll need a Decker to crack the ICE; I've got ${deckerName} for you.`,
  ];
}

export function clockRevealLines(campaign: ArcSurfaceCampaign): readonly string[] {
  if (!campaign.arc.clockStarted) {
    throw new Error('arcSurface: cannot build Clock reveal copy before clockStarted');
  }
  const principal = scorePrincipalLabel(campaign);
  return [
    'CURATOR: The Score window is live — corp security is tracking the org.',
    `CURATOR: Every job you take from here adds heat: more hostiles, tighter alarms.`,
    `CURATOR: Run ${principal} before the window closes or the contract goes cold.`,
  ];
}

export function act3RevealLines(): readonly string[] {
  return [
    "CURATOR: You're ready. Our window is open, but it's tight.",
    'CURATOR: Do your final prep, watch your heat, and grab THE SCORE from the board while you can.',
  ];
}

export function findDecker(crew: readonly Crew[]): Decker {
  const decker = crew.find(crew => crew.archetype === 'Decker');
  if (!decker) {
    throw new Error('arcSurface: cannot build Score reveal copy without a Decker');
  }
  return decker as Decker;
}

export function isScoreSiteContract(
  contract: Contract,
  scoreTargetSiteId: string | null | undefined
): boolean {
  return !!scoreTargetSiteId && contract.context.locationSiteId === scoreTargetSiteId;
}

export function isScorePrincipalContract(
  contract: Contract,
  scorePrincipalId: string | null | undefined,
  scoreTargetSiteId: string | null | undefined
): boolean {
  if (!scorePrincipalId || contract.context.principal?.id !== scorePrincipalId) return false;
  if (isScoreSiteContract(contract, scoreTargetSiteId)) return false;
  if (contract.context.recipeId === 'score-final') return false;
  return true;
}

/**
 * A location badge for the job board. `variant` maps to the CSS modifier the
 * renderer appends after the base `known` class (`'revisit'` is the bare
 * `known` styling).
 */
export interface ContractLocationBadge {
  variant: 'score-site' | 'casing' | 'revisit';
  text: string;
}

/**
 * Ordered location badges for a contract. Score-intel status (SCORE SITE /
 * CASING) and revisit memory (`// known site`) are *independent* facts: a
 * casing job at the score principal can also be a place we've already cased, so
 * both badges surface together.
 *
 * The Score *target* is excluded from the revisit badge. This is sound because
 * the target is always net-new when the board renders: the Score is a one-shot
 * that ends the campaign on any outcome (so it's never deployed to twice), and
 * no normal run can accrue memory onto it — its roster id is namespaced
 * (`score-…`) out of reach of `generateSiteId(seed)`, and the Curator filters
 * the target out of revisit rolls. The suppression is belt-and-suspenders
 * against a double-badge, not a correctness dependency. Non-target `score`-tier
 * sites are *not* special-cased — they can be cased/revisited like any other.
 */
export function contractLocationBadges(
  contract: Contract,
  scoreTargetSiteId: string | null | undefined,
  scorePrincipalId: string | null | undefined
): ContractLocationBadge[] {
  const badges: ContractLocationBadge[] = [];
  const scoreSite = isScoreSiteContract(contract, scoreTargetSiteId);
  if (scoreSite) {
    badges.push({ variant: 'score-site', text: 'SCORE SITE' });
  } else if (isScorePrincipalContract(contract, scorePrincipalId, scoreTargetSiteId)) {
    badges.push({ variant: 'casing', text: 'CASING' });
  }
  if (contract.context.locationSiteId && !scoreSite) {
    badges.push({ variant: 'revisit', text: '// known site' });
  }
  return badges;
}

export function scoreTargetSiteId(campaign: ArcSurfaceCampaign): string | null {
  return findScoreTargetSite(campaign.siteRoster)?.id ?? null;
}

export function scorePrincipalId(campaign: ArcSurfaceCampaign): string | null {
  return findScoreTargetSite(campaign.siteRoster)?.principal?.id ?? null;
}

function scorePrincipalLabel(campaign: ArcSurfaceCampaign): string {
  const target = findScoreTargetSite(campaign.siteRoster);
  if (!target) {
    throw new Error('arcSurface: cannot build Clock reveal copy without a Score target');
  }
  return cleanLabel(target.principal?.label) || scoreTargetDisplayName(target);
}

function cleanLabel(label: string | undefined): string {
  return label?.trim() ?? '';
}

function cleanSiteLabel(label: string): string {
  return label
    .replace(/^\/\//, '')
    .replace(/\/\/$/, '')
    .replace(/\s+-\s+Score target$/i, '')
    .trim();
}
