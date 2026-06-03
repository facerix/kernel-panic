/**
 * Player-facing status copy while the CORP faction is taking its turn.
 * Counts how many live corp units sit on a tile the viewer currently sees,
 * and formats per-step log lines for the sidebar game log.
 */

import { FACTION } from './constants.js';
import type { Entity } from './Entity.js';
import { Flanker } from './ai/Flanker.js';
import { Turret } from './Turret.js';
import { isConcealedFromPlayer } from './playerPerception.js';
import type { World } from './World.js';
import type { TurnActionStep } from '../types.js';

type IsVisibleFn = (x: number, y: number) => boolean;

const GENERIC_STATUS_MESSAGES = [
  'You hear movement nearby.',
  'A dull thud echoes through the ductwork — then silence.',
  'Distant servos cycle; a status LED strobes somewhere you cannot see.',
  'Your comms burp with clipped traffic — encrypted, wrong subnet.',
  'Cold air pushes past — climate control routing around a sealed zone.',
  'Footfalls on grated decking, then nothing. Wrong rhythm for civ traffic.',
  'A PA line crackles with a truncated all-clear.',
  'Magnetic locks chatter in sequence down the corridor.',
  'The lights dip — load shedding, or heavy gear cycling out of frame.',
  'A camera motor whines; the lens hunts a sector you are not in.',
  'Your HUD throws a ghost tag: proximity, no fix.',
  'The floor thrums once — low frequency, something massive repositioning.',
];

/**
 * @param {Iterable<{ alive?: boolean, faction?: string, x: number, y: number }>} entities
 * @param {(x: number, y: number) => boolean} isTileVisible
 * @returns {number}
 */
export function countVisibleCorpEntities(
  entities: Iterable<Entity>,
  isTileVisible: IsVisibleFn
): number {
  let n = 0;
  for (const e of entities) {
    if (!e?.alive || e.faction !== FACTION.CORP) continue;
    if (isTileVisible(e.x, e.y)) n++;
  }
  return n;
}

const corpNoiseForTurn = new Map<number, string>();

/** Reset the per-turn status message cache. Call between runs. */
export function resetCorpTurnStatusCache(): void {
  corpNoiseForTurn.clear();
}
/**
 * Plain-text line body after the "CORP" label (no HTML).
 * If any corp entities are visible, we show a specific status text.
 * Otherwise, we select a generic tone-setting message once that will be displayed for that full turn.
 *
 * @param {number} visibleCorpCount
 * @param {number} turnNumber
 * @returns {string}
 */
export function corpTurnStatusBody(visibleCorpCount: number, turnNumber: number): string {
  if (visibleCorpCount >= 2) {
    return 'Multiple hostiles in sight — units repositioning.';
  }
  if (visibleCorpCount === 1) {
    return 'A corp asset is active in your sightline.';
  }

  if (corpNoiseForTurn.has(turnNumber)) {
    return corpNoiseForTurn.get(turnNumber)!;
  }
  // not using Rng here because which message is shown doesn't need to be re-playable for a given seed.
  const messageForUnseenCorp =
    GENERIC_STATUS_MESSAGES[Math.floor(Math.random() * GENERIC_STATUS_MESSAGES.length)];
  corpNoiseForTurn.set(turnNumber, messageForUnseenCorp);
  return messageForUnseenCorp;
}

/**
 * Whether a corp-turn log line for this step should reach the player-facing feed.
 * Activity from actors the player cannot currently see is omitted (fog-of-war).
 * Incoming fire on the player is always narrated — you still feel the shot.
 * Destroying a deployable you own (turret) is always narrated — uplink / damage
 * feed the Tech expects even when the shooter tile is unseen.
 */
export function isCorpTurnStepLogVisibleToPlayer(
  world: World,
  playerId: string,
  entityId: string,
  step: TurnActionStep,
  isTileVisible: IsVisibleFn
): boolean {
  const actor = world.entities.get(entityId);
  if (!actor?.alive) return false;
  const player = world.entities.get(playerId);
  if (actor instanceof Flanker && player && isConcealedFromPlayer(actor, player, world)) {
    return false;
  }

  if (
    (step.type === 'fire' ||
      step.type === 'melee' ||
      step.type === 'suppress' ||
      step.type === 'shove') &&
    step.target === playerId
  ) {
    return true;
  }

  // A lookout marking the player is felt even when the lookout itself is unseen
  // — "this fireteam is coordinating on you right now." Surface it like a shot.
  if (step.type === 'spot' && step.target === playerId) {
    return true;
  }

  // A sniper's aim telegraph must reach the player even when the sniper tile is
  // unseen (range conceal) — the whole point is the red dot from the dark.
  if (step.type === 'aim' && step.target === playerId) {
    return true;
  }

  // kaizen: decide if we should surface this just on kills or also on hits
  if ((step.type === 'fire' || step.type === 'melee') && step.result.killed) {
    const victim = world.entities.get(step.target);
    if (victim instanceof Turret && victim.ownerId === playerId) {
      return true;
    }
  }

  return isTileVisible(actor.x, actor.y);
}

/**
 * Format a single corp-turn step into a player-facing log line.
 * Returns `null` for steps that don't warrant a log entry (patrol noise, etc.).
 *
 * `resolve` maps a raw entity ID to a display label (callsign for crew,
 * `[Faction]Kind` for hostiles/neutrals). The caller supplies it — typically
 * a closure over the world's entity map.
 */
export function formatCorpTurnStep(
  actorLabel: string,
  step: TurnActionStep,
  resolve: (id: string) => string = id => id
): string | null {
  switch (step.type) {
    case 'fire': {
      const r = step.result;
      const targetLabel = resolve(step.target);
      return (
        `${actorLabel} fires at ${targetLabel} — ` +
        `${r.hit ? 'HIT' : 'miss'} (roll ${r.roll.toFixed(2)} vs ${r.threshold.toFixed(2)}` +
        `${r.inCover ? ', cover' : ''}).` +
        (r.killed ? ` ${targetLabel.toUpperCase()} DOWN.` : '')
      );
    }
    case 'melee': {
      const r = step.result;
      const targetLabel = resolve(step.target);
      return (
        `${actorLabel} strikes ${targetLabel} — ` +
        `${r.hit ? 'HIT' : r.dodged ? 'dodged' : 'miss'} ` +
        `(roll ${r.roll.toFixed(2)} vs ${r.dodgeThreshold.toFixed(2)}${r.inCover ? ', cover' : ''}).` +
        (step.knockback
          ? ` ${targetLabel} is shoved to (${step.knockback.x}, ${step.knockback.y}).`
          : '') +
        (r.killed ? ` ${targetLabel.toUpperCase()} DOWN.` : '')
      );
    }
    case 'suppress': {
      const r = step.result;
      const targetLabel = resolve(step.target);
      return (
        `${actorLabel} lays down suppressing fire on ${targetLabel} — ` +
        `${r.hit ? 'HIT' : 'miss'} (roll ${r.roll.toFixed(2)} vs ${r.threshold.toFixed(2)}` +
        `${r.inCover ? ', cover' : ''}).` +
        (r.killed ? ` ${targetLabel.toUpperCase()} DOWN.` : '')
      );
    }
    case 'shove': {
      const targetLabel = resolve(step.target);
      return `${actorLabel} body-checks ${targetLabel} back to (${step.to.x}, ${step.to.y}) — making room to fire.`;
    }
    case 'slide':
      return null;
    case 'fire-blocked':
      return `${actorLabel} targets locked — ${step.reason}.`;
    case 'move-engage':
      return `${actorLabel} advances to (${step.to.x}, ${step.to.y}).`;
    case 'move-investigate':
      return `${actorLabel} investigates (${step.to.x}, ${step.to.y}).`;
    case 'investigate-cleared':
      return `${actorLabel} clears lead — resuming patrol.`;
    case 'investigate-abandoned':
      return `${actorLabel} abandons pursuit — resuming patrol.`;
    case 'alarm':
      return `${actorLabel} trips the facility alarm — corp net hot.`;
    case 'spot': {
      const targetLabel = resolve(step.target);
      return `${actorLabel} marks ${targetLabel} — fire converging on your position.`;
    }
    case 'aim': {
      // Deliberately anonymous — the sniper may be range-concealed; the tell is
      // the targeting laser, not a named, located shooter.
      const targetLabel = resolve(step.target);
      return `A targeting laser settles on ${targetLabel} — incoming fire.`;
    }
    case 'aim-cancelled':
      return `${actorLabel} loses the shot — ${step.reason}.`;
    // Patrol movement and waypoint chatter are noise; skip them.
    case 'move-patrol':
    case 'patrol-arrived':
    case 'patrol-skipped':
      return null;
    default:
      return null;
  }
}
