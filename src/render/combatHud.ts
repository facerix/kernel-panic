import { FACTION } from '../game/constants.js';
import type { FactionId } from '../game/constants.js';
import type { ObjectiveProgress } from '../game/objectiveProgress.js';

export const COMBAT_HUD_GLYPHS = Object.freeze({
  HP_FILLED: '■',
  HP_EMPTY: '□',
  AP_AVAILABLE: '●',
  AP_SPENT: '○',
});

export type CombatHudObjectiveInput = Readonly<{
  title: string;
  done: boolean;
  turnsRemaining?: number | null;
  progress?: ObjectiveProgress | null;
}>;

export type CombatHudIdentityInput = Readonly<{
  callsign?: string | null;
  archetype: string;
  stealthed: boolean;
}>;

export type CombatHudVitalInput = Readonly<{
  hp: number;
  maxHp: number;
}>;

export type CombatHudApInput = Readonly<{
  ap: number;
  maxAp: number;
}>;

export type CombatHudTurnInput = Readonly<{
  currentFaction: FactionId;
  turnNumber: number;
}>;

export type CombatHudSummaryInput = Readonly<{
  objective?: CombatHudObjectiveInput | null;
  identity: CombatHudIdentityInput;
  hp: CombatHudVitalInput;
  ap: CombatHudApInput;
  turn: CombatHudTurnInput;
}>;

export function formatObjectiveHud(objective: CombatHudObjectiveInput | null | undefined): string {
  if (!objective) return '';
  const title = requireNonEmptyString(objective.title, 'objective.title');
  const status = objective.done ? 'DONE' : 'TODO';
  const parts = [`OBJ ${title}`, `[${status}]`];
  if (
    !objective.done &&
    objective.turnsRemaining !== null &&
    objective.turnsRemaining !== undefined
  ) {
    assertIntegerInRange(objective.turnsRemaining, 'objective.turnsRemaining', {
      min: 0,
    });
    parts.push(`[TURN:${objective.turnsRemaining}]`);
  }
  if (objective.progress) {
    parts.push(formatProgressSuffix(objective.progress));
  }
  return parts.join(' ');
}

export function formatIdentityHud(identity: CombatHudIdentityInput): string {
  const archetype = requireNonEmptyString(identity.archetype, 'identity.archetype').toUpperCase();
  const callsign = identity.callsign?.trim();
  const base = callsign ? `${callsign} [${archetype}]` : archetype;
  return identity.stealthed ? `${base} [CLOAKED]` : base;
}

export function formatHpSegments(vitals: CombatHudVitalInput): string {
  validateCounter(vitals.hp, vitals.maxHp, 'hp', 'maxHp');
  return `HP ${rightFilledSegments(
    vitals.hp,
    vitals.maxHp,
    COMBAT_HUD_GLYPHS.HP_FILLED,
    COMBAT_HUD_GLYPHS.HP_EMPTY
  )}`;
}

export function formatApPips(vitals: CombatHudApInput): string {
  validateCounter(vitals.ap, vitals.maxAp, 'ap', 'maxAp');
  return rightFilledSegments(
    vitals.ap,
    vitals.maxAp,
    COMBAT_HUD_GLYPHS.AP_AVAILABLE,
    COMBAT_HUD_GLYPHS.AP_SPENT
  );
}

export function formatTurnLabel(turn: CombatHudTurnInput): string {
  assertIntegerInRange(turn.turnNumber, 'turn.turnNumber', { min: 1 });
  switch (turn.currentFaction) {
    case FACTION.PLAYER:
      return `TURN ${turn.turnNumber}`;
    case FACTION.CORP:
      return 'HOSTILES ACTIVE';
    default:
      throw new Error(`formatTurnLabel: unsupported faction "${turn.currentFaction}"`);
  }
}

export function formatCombatHudA11ySummary(summary: CombatHudSummaryInput): string {
  const archetype = requireNonEmptyString(summary.identity.archetype, 'identity.archetype');
  const name = summary.identity.callsign?.trim() || archetype;
  validateCounter(summary.hp.hp, summary.hp.maxHp, 'hp', 'maxHp');
  validateCounter(summary.ap.ap, summary.ap.maxAp, 'ap', 'maxAp');
  const parts = [
    name,
    archetype.toUpperCase(),
    `${summary.hp.hp} of ${summary.hp.maxHp} HP`,
    `${summary.ap.ap} of ${summary.ap.maxAp} AP`,
    turnA11yText(summary.turn),
  ];
  if (summary.identity.stealthed) parts.push('cloaked');
  const objectiveText = objectiveA11yText(summary.objective);
  if (objectiveText) parts.push(objectiveText);
  return parts.join(', ');
}

function rightFilledSegments(count: number, max: number, filled: string, empty: string): string {
  return `${empty.repeat(max - count)}${filled.repeat(count)}`;
}

function formatProgressSuffix(progress: ObjectiveProgress): string {
  const label = requireNonEmptyString(progress.label, 'objective.progress.label').toUpperCase();
  assertIntegerInRange(progress.current, 'objective.progress.current', { min: 0 });
  assertIntegerInRange(progress.total, 'objective.progress.total', { min: 0 });
  if (progress.current > progress.total) {
    throw new RangeError(
      `objective.progress.current must be <= objective.progress.total, got ${progress.current}/${progress.total}`
    );
  }
  return `[${label}:${progress.current}/${progress.total}]`;
}

function objectiveA11yText(objective: CombatHudObjectiveInput | null | undefined): string {
  if (!objective) return '';
  const title = requireNonEmptyString(objective.title, 'objective.title');
  const parts = [`objective ${title} ${objective.done ? 'DONE' : 'TODO'}`];
  if (
    !objective.done &&
    objective.turnsRemaining !== null &&
    objective.turnsRemaining !== undefined
  ) {
    assertIntegerInRange(objective.turnsRemaining, 'objective.turnsRemaining', {
      min: 0,
    });
    parts.push(`${objective.turnsRemaining} turns remaining`);
  }
  if (objective.progress) {
    const { label, current, total } = objective.progress;
    requireNonEmptyString(label, 'objective.progress.label');
    assertIntegerInRange(current, 'objective.progress.current', { min: 0 });
    assertIntegerInRange(total, 'objective.progress.total', { min: 0 });
    if (current > total) {
      throw new RangeError(
        `objective.progress.current must be <= objective.progress.total, got ${current}/${total}`
      );
    }
    parts.push(`${label.toLowerCase()} ${current} of ${total}`);
  }
  return parts.join(', ');
}

function turnA11yText(turn: CombatHudTurnInput): string {
  assertIntegerInRange(turn.turnNumber, 'turn.turnNumber', { min: 1 });
  switch (turn.currentFaction) {
    case FACTION.PLAYER:
      return `turn ${turn.turnNumber}`;
    case FACTION.CORP:
      return 'hostiles active';
    default:
      throw new Error(`turnA11yText: unsupported faction "${turn.currentFaction}"`);
  }
}

function validateCounter(count: number, max: number, countLabel: string, maxLabel: string): void {
  assertIntegerInRange(max, maxLabel, { min: 0 });
  assertIntegerInRange(count, countLabel, { min: 0, max });
}

function assertIntegerInRange(
  value: number,
  label: string,
  options: Readonly<{ min: number; max?: number }>
): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer, got ${value}`);
  }
  if (value < options.min) {
    throw new RangeError(`${label} must be >= ${options.min}, got ${value}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new RangeError(`${label} must be <= ${options.max}, got ${value}`);
  }
}

function requireNonEmptyString(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return trimmed;
}
