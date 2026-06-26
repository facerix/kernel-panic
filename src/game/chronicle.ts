import type { CampaignArcStage } from '../types.js';

export type CampaignChronicleEntryKind = 'milestone' | 'job';

export type CampaignChronicleEntry = {
  id: string;
  sequence: number;
  kind: CampaignChronicleEntryKind;
  stage: CampaignArcStage;
  title: string;
  summary: string;
  detailLines: string[];
};

export type PendingChronicleRun = {
  sequence: number;
  stage: CampaignArcStage;
  contractLabel: string;
  objectiveTitle: string;
  scoreTargetName: string | null;
  principalLabel: string | null;
  isScore: boolean;
  isCasing: boolean;
  repBefore: number;
  creditsBefore: number;
  completedJobsBefore: number;
  flatlinedCrewIdsBefore: string[];
};

const ARC_STAGES: readonly CampaignArcStage[] = ['act-1', 'act-2', 'act-3', 'score'];
const ENTRY_KINDS: readonly CampaignChronicleEntryKind[] = ['milestone', 'job'];

export function cloneChronicleEntry(entry: CampaignChronicleEntry): CampaignChronicleEntry {
  return {
    ...entry,
    detailLines: [...entry.detailLines],
  };
}

export function normalizeCampaignChronicle(value: unknown): CampaignChronicleEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError('Campaign.chronicle must be an array');
  }
  return value.map((entry, index) => validateChronicleEntry(entry, index));
}

export function validateChronicleEntry(
  value: unknown,
  index = 0,
  context = 'Campaign.chronicle'
): CampaignChronicleEntry {
  if (!isPlainObject(value)) {
    throw new TypeError(`${context}[${index}] must be a plain object`);
  }
  const entry = value as Record<string, unknown>;
  const id = requireNonEmptyString(entry.id, `${context}[${index}].id`);
  const sequence = requireNonNegativeInteger(entry.sequence, `${context}[${index}].sequence`);
  const kind = requireEntryKind(entry.kind, `${context}[${index}].kind`);
  const stage = requireArcStage(entry.stage, `${context}[${index}].stage`);
  const title = requireNonEmptyString(entry.title, `${context}[${index}].title`);
  const summary = requireNonEmptyString(entry.summary, `${context}[${index}].summary`);
  if (!Array.isArray(entry.detailLines)) {
    throw new TypeError(`${context}[${index}].detailLines must be an array`);
  }
  const detailLines = entry.detailLines.map((line, lineIndex) =>
    requireNonEmptyString(line, `${context}[${index}].detailLines[${lineIndex}]`)
  );
  return { id, sequence, kind, stage, title, summary, detailLines };
}

export function normalizePendingChronicleRun(
  value: unknown,
  context = 'Campaign.pendingChronicleRun'
): PendingChronicleRun | null {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw new TypeError(`${context} must be a plain object when supplied`);
  }
  const pending = value as Record<string, unknown>;
  const scoreTargetName = requireNullableString(
    pending.scoreTargetName,
    `${context}.scoreTargetName`
  );
  const principalLabel = requireNullableString(pending.principalLabel, `${context}.principalLabel`);
  if (!Array.isArray(pending.flatlinedCrewIdsBefore)) {
    throw new TypeError(`${context}.flatlinedCrewIdsBefore must be an array`);
  }
  return {
    sequence: requireNonNegativeInteger(pending.sequence, `${context}.sequence`),
    stage: requireArcStage(pending.stage, `${context}.stage`),
    contractLabel: requireNonEmptyString(pending.contractLabel, `${context}.contractLabel`),
    objectiveTitle: requireNonEmptyString(pending.objectiveTitle, `${context}.objectiveTitle`),
    scoreTargetName,
    principalLabel,
    isScore: requireBoolean(pending.isScore, `${context}.isScore`),
    isCasing: requireBoolean(pending.isCasing, `${context}.isCasing`),
    repBefore: requireNonNegativeInteger(pending.repBefore, `${context}.repBefore`),
    creditsBefore: requireNonNegativeInteger(pending.creditsBefore, `${context}.creditsBefore`),
    completedJobsBefore: requireNonNegativeInteger(
      pending.completedJobsBefore,
      `${context}.completedJobsBefore`
    ),
    flatlinedCrewIdsBefore: pending.flatlinedCrewIdsBefore.map((id, index) =>
      requireNonEmptyString(id, `${context}.flatlinedCrewIdsBefore[${index}]`)
    ),
  };
}

function requireArcStage(value: unknown, context: string): CampaignArcStage {
  if (typeof value !== 'string' || !ARC_STAGES.includes(value as CampaignArcStage)) {
    throw new Error(`${context} "${String(value)}" is not known`);
  }
  return value as CampaignArcStage;
}

function requireEntryKind(value: unknown, context: string): CampaignChronicleEntryKind {
  if (typeof value !== 'string' || !ENTRY_KINDS.includes(value as CampaignChronicleEntryKind)) {
    throw new Error(`${context} "${String(value)}" is not known`);
  }
  return value as CampaignChronicleEntryKind;
}

function requireNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${context} must be a non-empty string`);
  }
  return value;
}

function requireNullableString(value: unknown, context: string): string | null {
  if (value === null || value === undefined) return null;
  return requireNonEmptyString(value, context);
}

function requireNonNegativeInteger(value: unknown, context: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${context} must be a non-negative integer`);
  }
  return value as number;
}

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${context} must be boolean`);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
