import type { CampaignEndReason } from '../types.js';

export const CAMPAIGN_HISTORY_CAP = 50;

export type CampaignSummaryResult = 'win' | 'loss';

export type CampaignSummaryCrew = {
  callsign: string;
  archetype: string;
  flatlined: boolean;
};

export type CampaignSummary = {
  campaignId: string;
  completedAt: string;
  result: CampaignSummaryResult;
  endReason: CampaignEndReason;
  seed: number;
  completedJobs: number;
  rep: number;
  credits: number;
  crewRoster: CampaignSummaryCrew[];
};

type EndedCampaignLike = {
  id: string;
  state: string;
  endReason: CampaignEndReason | null;
  seed: number;
  completedJobs: number;
  rep: number;
  credits: number;
  crew: Array<{
    id: string;
    callsign: string | null;
    archetype: string;
    flatlined: boolean;
  }>;
};

const END_REASONS: readonly CampaignEndReason[] = [
  'crew-wipe',
  'clock-expired',
  'decker-flatlined-score',
  'score-complete',
];

export function buildCampaignSummary(
  campaign: EndedCampaignLike,
  completedAt: string
): CampaignSummary {
  if (!campaign || typeof campaign !== 'object') {
    throw new TypeError('buildCampaignSummary requires a Campaign-like object');
  }
  if (campaign.state !== 'ENDED') {
    throw new Error(`buildCampaignSummary requires an ENDED campaign, got ${campaign.state}`);
  }
  if (!campaign.endReason) {
    throw new Error('buildCampaignSummary requires a campaign end reason');
  }

  return validateCampaignSummary({
    campaignId: campaign.id,
    completedAt,
    result: campaign.endReason === 'score-complete' ? 'win' : 'loss',
    endReason: campaign.endReason,
    seed: campaign.seed,
    completedJobs: campaign.completedJobs,
    rep: campaign.rep,
    credits: campaign.credits,
    crewRoster: campaign.crew.map(member => ({
      callsign: member.callsign ?? member.id,
      archetype: member.archetype,
      flatlined: member.flatlined,
    })),
  });
}

export function validateCampaignSummary(value: unknown): CampaignSummary {
  if (!isPlainObject(value)) {
    throw new TypeError('CampaignSummary must be a plain object');
  }
  const summary = value as Record<string, unknown>;
  requireExactKeys(summary, [
    'campaignId',
    'completedAt',
    'result',
    'endReason',
    'seed',
    'completedJobs',
    'rep',
    'credits',
    'crewRoster',
  ]);
  const campaignId = requireNonEmptyString(summary.campaignId, 'CampaignSummary.campaignId');
  const completedAt = requireIsoTimestamp(summary.completedAt);
  if (summary.result !== 'win' && summary.result !== 'loss') {
    throw new Error(`CampaignSummary.result must be win or loss, got ${summary.result}`);
  }
  if (!END_REASONS.includes(summary.endReason as CampaignEndReason)) {
    throw new Error(`CampaignSummary.endReason is invalid: ${summary.endReason}`);
  }
  const endReason = summary.endReason as CampaignEndReason;
  const expectedResult: CampaignSummaryResult = endReason === 'score-complete' ? 'win' : 'loss';
  if (summary.result !== expectedResult) {
    throw new Error(`CampaignSummary ${endReason} must have result ${expectedResult}`);
  }
  const seed = requireFiniteNumber(summary.seed, 'CampaignSummary.seed');
  const completedJobs = requireNonNegativeInteger(
    summary.completedJobs,
    'CampaignSummary.completedJobs'
  );
  const rep = requireNonNegativeInteger(summary.rep, 'CampaignSummary.rep');
  const credits = requireNonNegativeInteger(summary.credits, 'CampaignSummary.credits');
  if (!Array.isArray(summary.crewRoster)) {
    throw new TypeError('CampaignSummary.crewRoster must be an array');
  }
  const crewRoster = summary.crewRoster.map((member, index) => validateCrew(member, index));

  return {
    campaignId,
    completedAt,
    result: summary.result,
    endReason,
    seed,
    completedJobs,
    rep,
    credits,
    crewRoster,
  };
}

export function normalizeCampaignHistory(value: unknown): CampaignSummary[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError('campaignHistory must be an array');
  }
  const seen = new Set<string>();
  const history: CampaignSummary[] = [];
  for (const candidate of value) {
    const summary = validateCampaignSummary(candidate);
    if (seen.has(summary.campaignId)) continue;
    seen.add(summary.campaignId);
    history.push(summary);
    if (history.length === CAMPAIGN_HISTORY_CAP) break;
  }
  return history;
}

export function archiveCampaignSummary(
  history: readonly CampaignSummary[],
  candidate: CampaignSummary
): { history: CampaignSummary[]; summary: CampaignSummary; added: boolean } {
  const normalized = normalizeCampaignHistory(history);
  const summary = validateCampaignSummary(candidate);
  const existing = normalized.find(entry => entry.campaignId === summary.campaignId);
  if (existing) {
    return { history: normalized, summary: existing, added: false };
  }
  return {
    history: [summary, ...normalized].slice(0, CAMPAIGN_HISTORY_CAP),
    summary,
    added: true,
  };
}

export function cloneCampaignSummary(summary: CampaignSummary): CampaignSummary {
  return {
    ...summary,
    crewRoster: summary.crewRoster.map(member => ({ ...member })),
  };
}

function validateCrew(value: unknown, index: number): CampaignSummaryCrew {
  if (!isPlainObject(value)) {
    throw new TypeError(`CampaignSummary.crewRoster[${index}] must be a plain object`);
  }
  const member = value as Record<string, unknown>;
  requireExactKeys(member, ['callsign', 'archetype', 'flatlined']);
  if (typeof member.flatlined !== 'boolean') {
    throw new TypeError(`CampaignSummary.crewRoster[${index}].flatlined must be boolean`);
  }
  return {
    callsign: requireNonEmptyString(
      member.callsign,
      `CampaignSummary.crewRoster[${index}].callsign`
    ),
    archetype: requireNonEmptyString(
      member.archetype,
      `CampaignSummary.crewRoster[${index}].archetype`
    ),
    flatlined: member.flatlined,
  };
}

function requireIsoTimestamp(value: unknown): string {
  const timestamp = requireNonEmptyString(value, 'CampaignSummary.completedAt');
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error(`CampaignSummary.completedAt must be an ISO timestamp, got ${timestamp}`);
  }
  return timestamp;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return value as number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`CampaignSummary keys must be exactly ${wanted.join(', ')}`);
  }
}
