import { FACTION } from '../game/constants.js';
import { CAMPAIGN_STATE } from '../game/Campaign.js';
import { RUN_STATE } from '../game/Run.js';
import { aimKindLabel, MODE } from '../input/keymap.js';
import type { AimKind, Mode } from '../input/keymap.js';
import { formatCombatHudA11ySummary } from '../render/combatHud.js';
import type { CombatHudSummaryInput } from '../render/combatHud.js';
import { statusActionRows } from '../statusActivityRows.js';

export type StatusLineInputState = {
  mode: Mode;
  aimKind: AimKind | null;
};

export type CorpMoodSnapshot = {
  hostileTag: string;
  body: string;
};

export type StatusLineSnapshot = {
  stateLabel: string;
  sceneState: string | null | undefined;
  input: StatusLineInputState;
  hasPlayer: boolean;
  hasQueue: boolean;
  combatHud?: CombatHudSummaryInput | null;
  contextHtml: string;
  hubIdentity?: string;
  proximityHint?: string;
  /** Hostile-turn mood row — builder sets when queue is on hostile faction. */
  corpMood?: CorpMoodSnapshot | null;
  /** Latched mood shown on player slice until flushed. */
  latchedCorpMood?: CorpMoodSnapshot | null;
  actionHistory: readonly string[];
  pendingActionCount: number;
};

export type StatusLineResult = {
  html: string;
  /** Updated latch after rendering hostile-turn mood. */
  nextCorpMoodBody: string | null;
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

export function joinStatusParts(parts: Array<string | null | undefined>): string {
  return parts
    .filter(part => part && part.trim().length > 0)
    .join(' <span class="status-sep">|</span> ');
}

export function stateLabelForSceneState(state: string | null | undefined): string {
  if (!state) return 'BOOTING';
  switch (state) {
    case CAMPAIGN_STATE.HUB:
      return '[HUB]';
    case RUN_STATE.BRIEFING:
      return '[BRIEFING]';
    case RUN_STATE.COMBAT:
      return '[COMBAT]';
    case RUN_STATE.RESULT:
      return '[DEBRIEF]';
    case CAMPAIGN_STATE.ENDED:
      return '[ENDED]';
    default:
      return state;
  }
}

export function formatStatusLine(snapshot: StatusLineSnapshot): StatusLineResult {
  if (!snapshot.hasPlayer || !snapshot.hasQueue) {
    return { html: snapshot.stateLabel, nextCorpMoodBody: null };
  }

  const aim =
    snapshot.input.mode === MODE.AIM && snapshot.input.aimKind
      ? `AIM ${aimKindLabel(snapshot.input.aimKind)}`
      : '';
  const look = snapshot.input.mode === MODE.LOOK ? 'LOOK' : '';
  const isCombat = snapshot.sceneState === RUN_STATE.COMBAT;

  let combatA11y = '';
  if (isCombat && snapshot.combatHud) {
    combatA11y = `<span class="u-sr-only">Combat status: ${escapeHtml(
      formatCombatHudA11ySummary(snapshot.combatHud)
    )}</span>`;
  }

  const modeTag = look && !isCombat ? look : '';
  const statsInner = isCombat
    ? joinStatusParts([snapshot.stateLabel, aim, look])
    : joinStatusParts([snapshot.stateLabel, snapshot.hubIdentity, modeTag]);
  const stats = `<span class="game-shell__stats">${statsInner}</span>`;
  const contextRow = `<span class="game-shell__context">${snapshot.contextHtml}</span>`;

  let ephemeral = '';
  let nextCorpMoodBody: string | null = null;

  if (snapshot.proximityHint) {
    ephemeral = `<span class="game-shell__activity hint">${escapeHtml(snapshot.proximityHint)}</span>`;
  } else if (snapshot.corpMood) {
    const { hostileTag, body } = snapshot.corpMood;
    nextCorpMoodBody = body;
    ephemeral = `<span class="game-shell__activity corp"><span class="faction-tag">${hostileTag}</span> — ${body}</span>`;
  } else if (snapshot.latchedCorpMood) {
    const { hostileTag, body } = snapshot.latchedCorpMood;
    ephemeral = `<span class="game-shell__activity corp"><span class="faction-tag">${hostileTag}</span> — ${body}</span>`;
  }

  const activityRows = statusActionRows(
    snapshot.actionHistory,
    snapshot.pendingActionCount,
    !!ephemeral
  );
  const [upper, lower] = activityRows.map(row => {
    if (row.source === 'ephemeral') return ephemeral;
    return `<span class="game-shell__activity">${escapeHtml(row.text)}</span>`;
  });

  return {
    html: combatA11y + stats + contextRow + upper + lower,
    nextCorpMoodBody,
  };
}

export function formatAlertTag(alarm: {
  phase: string;
  holdTurnsRemaining?: number;
  cooldownTurnsRemaining?: number;
}): string {
  if (alarm.phase === 'alert') {
    return `<span class="alert-tag">ALERT ${alarm.holdTurnsRemaining ?? 0}</span>`;
  }
  if (alarm.phase === 'cooldown') {
    return `<span class="alert-tag">COOL ${alarm.cooldownTurnsRemaining ?? 0}</span>`;
  }
  return '';
}

export function formatHazardTag(onHazard: boolean): string {
  return onHazard ? '<span class="hazard-tag">▓ HAZARD — move or take damage</span>' : '';
}

export function hostileMoodTag(jackedIn: boolean, hostileFaction: string): string {
  return jackedIn ? 'ICE' : hostileFaction.toUpperCase();
}

/** Whether the queue is on the hostile slice (corp or ICE while jacked in). */
export function isHostileTurnSlice(
  sceneState: string | null | undefined,
  currentFaction: string,
  hostileFaction: string,
  jackedIn: boolean
): boolean {
  if (sceneState !== RUN_STATE.COMBAT) return false;
  return jackedIn ? currentFaction === FACTION.CORP : currentFaction === hostileFaction;
}

export function isPlayerTurnSlice(
  sceneState: string | null | undefined,
  currentFaction: string
): boolean {
  return sceneState === RUN_STATE.COMBAT && currentFaction === FACTION.PLAYER;
}
