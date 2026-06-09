import type { Contract } from './Curator.js';
import type { Campaign } from '../Campaign.js';
import type { CampaignArcStage, LocationSite } from '../../types.js';
import type { Decker } from '../archetypes/Decker.js';
import type { Crew } from '../Crew.js';

type ArcSurfaceCampaign = Pick<Campaign, 'arc' | 'siteRoster' | 'crew'>;

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
  const parts = [formatArcStageLabel(campaign.arc.arcStage)];
  if (campaign.arc.scoreRevealed) {
    const target = findScoreTargetSite(campaign.siteRoster);
    if (!target) {
      throw new Error('arcSurface: score revealed without a Score target site');
    }
    parts.push(`SCORE: ${scoreTargetDisplayName(target)}`);
  }
  return parts.join(' | ');
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
    'CURATOR: Contracts touching that site are casing work now. Watch for SCORE SITE on the board.',
    `CURATOR: You'll need a Decker to crack the ICE; I've got ${deckerName} for you.`,
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

export function scoreTargetSiteId(campaign: ArcSurfaceCampaign): string | null {
  return findScoreTargetSite(campaign.siteRoster)?.id ?? null;
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
