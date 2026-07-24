import type { CampaignEndReason } from '../types.js';
import { SCOREABLE_ITEMS } from './items.js';
import { SCOREABLE_ARCHETYPES } from './archetypeRewards.js';

export const CAMPAIGN_HISTORY_CAP = 50;

export type CampaignSummaryResult = 'win' | 'partial' | 'loss';

export type CampaignSummaryCrew = {
  callsign: string;
  archetype: string;
  flatlined: boolean;
};

/**
 * Reward won by a winning Score (P3.M6.4; P3.5.M7 extends the draw to
 * archetypes too), captured self-contained (id + display copy) so the record
 * reads correctly forever even if the catalog changes. Absent on losses,
 * partials, and abstract (exhausted-pool) Scores. Item and archetype rewards
 * share this shape — there's no `kind` discriminator, since the win
 * screen/Chronicle render both identically (id/label/flavor).
 */
export type CampaignSummaryScoreReward = {
  id: string;
  label: string;
  flavor: string;
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
  /** Optional — present only when a win stole a specific blueprint. */
  scoreReward?: CampaignSummaryScoreReward;
};

type EndedCampaignLike = {
  id: string;
  state: string;
  endReason: CampaignEndReason | null;
  seed: number;
  completedJobs: number;
  rep: number;
  credits: number;
  /** The stolen blueprint id (P3.M6.4); resolved to display copy in the summary. */
  scoreUnlockedItemId?: string | null;
  /** The unlocked archetype id (P3.5.M7); resolved to display copy in the summary. */
  scoreUnlockedArchetypeId?: string | null;
  crew: Array<{
    id: string;
    callsign: string | null;
    archetype: string;
    flatlined: boolean;
  }>;
};

/**
 * Resolve a completed Score's drawn reward to a self-contained summary
 * record (or undefined). At most one of `itemId`/`archetypeId` is ever
 * non-null — `Campaign.onJobEnd` writes exactly one of the two meta fields
 * per Score (P3.5.M7).
 */
function resolveScoreReward(
  itemId: string | null | undefined,
  archetypeId: string | null | undefined
): CampaignSummaryScoreReward | undefined {
  if (typeof itemId === 'string') {
    const item = SCOREABLE_ITEMS.find(entry => entry.id === itemId);
    if (item) return { id: item.id, label: item.label, flavor: item.flavor ?? '' };
  }
  if (typeof archetypeId === 'string') {
    const reward = SCOREABLE_ARCHETYPES.find(entry => entry.id === archetypeId);
    if (reward) return { id: reward.id, label: reward.label, flavor: reward.flavor };
  }
  return undefined;
}

const END_REASONS: readonly CampaignEndReason[] = [
  'crew-wipe',
  'clock-expired',
  'decker-flatlined-score',
  'score-partial',
  'score-aborted',
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

  const scoreReward = resolveScoreReward(
    campaign.scoreUnlockedItemId,
    campaign.scoreUnlockedArchetypeId
  );
  return validateCampaignSummary({
    campaignId: campaign.id,
    completedAt,
    result: resultForEndReason(campaign.endReason),
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
    ...(scoreReward ? { scoreReward } : {}),
  });
}

export function validateCampaignSummary(value: unknown): CampaignSummary {
  if (!isPlainObject(value)) {
    throw new TypeError('CampaignSummary must be a plain object');
  }
  const summary = value as Record<string, unknown>;
  requireKeys(
    summary,
    [
      'campaignId',
      'completedAt',
      'result',
      'endReason',
      'seed',
      'completedJobs',
      'rep',
      'credits',
      'crewRoster',
    ],
    ['scoreReward']
  );
  const campaignId = requireNonEmptyString(summary.campaignId, 'CampaignSummary.campaignId');
  const completedAt = requireIsoTimestamp(summary.completedAt);
  if (summary.result !== 'win' && summary.result !== 'partial' && summary.result !== 'loss') {
    throw new Error(`CampaignSummary.result must be win, partial, or loss, got ${summary.result}`);
  }
  if (!END_REASONS.includes(summary.endReason as CampaignEndReason)) {
    throw new Error(`CampaignSummary.endReason is invalid: ${summary.endReason}`);
  }
  const endReason = summary.endReason as CampaignEndReason;
  const expectedResult = resultForEndReason(endReason);
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
  const scoreReward = validateScoreReward(summary.scoreReward);

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
    ...(scoreReward ? { scoreReward } : {}),
  };
}

function validateScoreReward(value: unknown): CampaignSummaryScoreReward | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new TypeError('CampaignSummary.scoreReward must be a plain object when present');
  }
  requireKeys(value, ['id', 'label', 'flavor'], [], 'CampaignSummary.scoreReward');
  if (typeof value.flavor !== 'string') {
    throw new TypeError('CampaignSummary.scoreReward.flavor must be a string');
  }
  return {
    id: requireNonEmptyString(value.id, 'CampaignSummary.scoreReward.id'),
    label: requireNonEmptyString(value.label, 'CampaignSummary.scoreReward.label'),
    flavor: value.flavor,
  };
}

function resultForEndReason(endReason: CampaignEndReason): CampaignSummaryResult {
  if (endReason === 'score-complete') return 'win';
  if (endReason === 'score-partial') return 'partial';
  return 'loss';
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
    ...(summary.scoreReward ? { scoreReward: { ...summary.scoreReward } } : {}),
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

/**
 * Like {@link requireExactKeys} but tolerant of optional keys: every `required`
 * key must be present, and no key outside `required ∪ optional` may appear.
 * Lets the schema gain optional fields (e.g. `scoreReward`) without rejecting
 * older summaries that predate them.
 */
function requireKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label = 'CampaignSummary'
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} has unexpected key "${key}"`);
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      throw new TypeError(`${label} is missing required key "${key}"`);
    }
  }
}
