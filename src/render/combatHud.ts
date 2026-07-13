import { FACTION } from '../game/constants.js';
import type { FactionId } from '../game/constants.js';
import type { ObjectiveProgress } from '../game/objectiveProgress.js';

export const COMBAT_HUD_GLYPHS = Object.freeze({
  HP_FILLED: '■',
  HP_EMPTY: '□',
  AP_AVAILABLE: '●',
  AP_SPENT: '○',
  SHIELD_CHARGED: '◆',
  SHIELD_SPENT: '◇',
});

/** Shared defense palette for HUD chrome and mitigation feedback. */
export const COMBAT_HUD_COLORS = Object.freeze({
  SHIELD_CHARGED: '#c8b6ff',
  SHIELD_SPENT: '#68757b',
  ARMOR: '#d49a3a',
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
  /** P3.5.M2: the controlled actor is EMP-stunned (0 AP next refresh). */
  stunned?: boolean;
}>;

export type CombatHudVitalInput = Readonly<{
  hp: number;
  maxHp: number;
  /** P3.M3.6: pane label — `HP` (default) in Meatspace, `RAM` on the grid. */
  label?: string;
}>;

export type CombatHudApInput = Readonly<{
  ap: number;
  maxAp: number;
}>;

export type CombatHudDefenseInput = Readonly<{
  /** Persistent flat damage reduction. Omitted when the actor has no armor. */
  armor?: number;
  /** Equipped shield capacity plus its current live charge. */
  shield?: Readonly<{ current: number; capacity: number }>;
}>;

export type CombatHudTurnInput = Readonly<{
  currentFaction: FactionId;
  turnNumber: number;
}>;

export type CombatHudSummaryInput = Readonly<{
  objective?: CombatHudObjectiveInput | null;
  identity: CombatHudIdentityInput;
  hp: CombatHudVitalInput;
  defense?: CombatHudDefenseInput;
  ap: CombatHudApInput;
  turn: CombatHudTurnInput;
  cyber: boolean;
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

export const HUD_TRUNCATION_MARK = '...';

export type MeasureTextWidth = (text: string) => number;

/**
 * Shrinks an objective HUD line to fit while keeping bracketed tags (status,
 * turn budget, MAP/SWEEP meters). Truncates the title only; falls back to
 * end-truncation when even tags do not fit.
 */
export function fitObjectiveHudLine(
  line: string,
  measure: MeasureTextWidth,
  maxTextWidth: number
): string {
  if (!line) return '';
  if (maxTextWidth <= 0) return '';
  if (measure(line) <= maxTextWidth) return line;

  const tagsStart = line.indexOf(' [');
  if (tagsStart < 0) {
    return truncateHudLineEnd(line, measure, maxTextWidth);
  }

  const head = line.slice(0, tagsStart);
  const suffix = line.slice(tagsStart);
  const headPrefix = head.startsWith('OBJ ') ? 'OBJ ' : '';
  let title = headPrefix ? head.slice(4) : head;
  const marker = HUD_TRUNCATION_MARK;

  while (title.length > 0) {
    const candidate = `${headPrefix}${title}${marker}${suffix}`;
    if (measure(candidate) <= maxTextWidth) return candidate;
    title = title.slice(0, -1);
  }

  const minimal = `${headPrefix}${marker}${suffix}`;
  if (measure(minimal) <= maxTextWidth) return minimal;

  return truncateHudLineEnd(line, measure, maxTextWidth);
}

export function formatIdentityHud(identity: CombatHudIdentityInput): string {
  const archetype = requireNonEmptyString(identity.archetype, 'identity.archetype').toUpperCase();
  const callsign = identity.callsign?.trim();
  let label = callsign ? `${callsign} [${archetype}]` : archetype;
  if (identity.stealthed) label += ' [CLOAKED]';
  if (identity.stunned) label += ' [STUNNED]';
  return label;
}

export function formatHpSegments(vitals: CombatHudVitalInput): string {
  validateCounter(vitals.hp, vitals.maxHp, 'hp', 'maxHp');
  return `${vitals.label ?? 'HP'} ${rightFilledSegments(
    vitals.hp,
    vitals.maxHp,
    COMBAT_HUD_GLYPHS.HP_FILLED,
    COMBAT_HUD_GLYPHS.HP_EMPTY
  )}`;
}

export function formatDefenseHud(defense: CombatHudDefenseInput | null | undefined): string {
  if (!defense) return '';
  const parts: string[] = [];
  if (defense.shield) {
    validateCounter(
      defense.shield.current,
      defense.shield.capacity,
      'shield.current',
      'shield.capacity'
    );
    if (defense.shield.capacity <= 0) {
      throw new RangeError(`shield.capacity must be >= 1, got ${defense.shield.capacity}`);
    }
    parts.push(
      `SH ${rightFilledSegments(
        defense.shield.current,
        defense.shield.capacity,
        COMBAT_HUD_GLYPHS.SHIELD_CHARGED,
        COMBAT_HUD_GLYPHS.SHIELD_SPENT
      )}`
    );
  }
  if (defense.armor !== undefined) {
    assertIntegerInRange(defense.armor, 'armor', { min: 1 });
    parts.push(`ARM ${defense.armor}`);
  }
  return parts.join('  ');
}

export function formatApPips(vitals: CombatHudApInput): string {
  validateCounter(vitals.ap, vitals.maxAp, 'ap', 'maxAp');
  return `AP ${rightFilledSegments(
    vitals.ap,
    vitals.maxAp,
    COMBAT_HUD_GLYPHS.AP_AVAILABLE,
    COMBAT_HUD_GLYPHS.AP_SPENT
  )}`;
}

export function formatTurnLabel(turn: CombatHudTurnInput): string {
  assertIntegerInRange(turn.turnNumber, 'turn.turnNumber', { min: 1 });
  switch (turn.currentFaction) {
    case FACTION.PLAYER:
      return `TURN ${turn.turnNumber}`;
    case FACTION.CORP:
    case FACTION.RIVAL:
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
    `${summary.hp.hp} of ${summary.hp.maxHp} ${summary.hp.label ?? 'HP'}`,
  ];
  const defenseText = defenseA11yText(summary.defense);
  if (defenseText) parts.push(...defenseText);
  parts.push(`${summary.ap.ap} of ${summary.ap.maxAp} AP`, turnA11yText(summary.turn));
  if (summary.identity.stealthed) parts.push('cloaked');
  if (summary.identity.stunned) parts.push('stunned');
  const objectiveText = objectiveA11yText(summary.objective);
  if (objectiveText) parts.push(objectiveText);
  return parts.join(', ');
}

function defenseA11yText(defense: CombatHudDefenseInput | null | undefined): string[] {
  if (!defense) return [];
  // Reuse the visible formatter's validation so visual and screen-reader paths
  // fail on the same corrupt input.
  formatDefenseHud(defense);
  const parts: string[] = [];
  if (defense.shield) {
    parts.push(
      defense.shield.current === 0
        ? 'shield spent'
        : `shield ${defense.shield.current} of ${defense.shield.capacity}`
    );
  }
  if (defense.armor !== undefined) parts.push(`armor ${defense.armor}`);
  return parts;
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

function truncateHudLineEnd(line: string, measure: MeasureTextWidth, maxTextWidth: number): string {
  const marker = HUD_TRUNCATION_MARK;
  if (measure(marker) > maxTextWidth) return '';
  let next = line;
  while (next.length > 0 && measure(`${next}${marker}`) > maxTextWidth) {
    next = next.slice(0, -1);
  }
  return `${next}${marker}`;
}

function turnA11yText(turn: CombatHudTurnInput): string {
  assertIntegerInRange(turn.turnNumber, 'turn.turnNumber', { min: 1 });
  switch (turn.currentFaction) {
    case FACTION.PLAYER:
      return `turn ${turn.turnNumber}`;
    case FACTION.CORP:
    case FACTION.RIVAL:
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
