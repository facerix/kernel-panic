// Game state → musical tension. The policy layer between the run and the score.
//
// Kept here, pure and separate from the wiring, for two reasons. First, it is
// real logic worth testing without a DOM or an AudioContext. Second, it is
// consumed from two directions that must agree:
//
//   - `sceneListeners` reacts to ALARM_CHANGED *events* while a scene is live.
//   - `shellRuntime` derives tension from persisted *state* on scene entry and
//     on campaign resume.
//
// If those two disagreed, a mid-alarm save would reload scored as calm and stay
// that way until the next alarm transition happened to fire. Both call into the
// functions below so there is exactly one mapping.

import { ALARM_PHASE } from '../game/World.js';
import type { MusicPaletteName, MusicTension } from '../audio/music.js';

/** The hub is never scored as tense — no run is underway. */
export const HUB_TENSION: MusicTension = 0;

/** The hub is meatspace: Finn's shop is a room, not a grid. */
export const HUB_PALETTE: MusicPaletteName = 'meat';

/**
 * Which palette scores a run.
 *
 * A run carrying a cyberspace component is scored cyber for its *whole* length —
 * `dormant`, `active`, and `resolved` alike — not merely while the grid is on
 * screen. The fiction is that the job is a net run from the moment it is taken;
 * the score sets that expectation before the Decker ever jacks in, and does not
 * snap back the instant they jack out.
 *
 * This deliberately keys off layer *existence* rather than `isCyberView`
 * (flipped to the grid) or `isJackedIn` (layer currently live): both of those
 * flicker several times within a single run, and a palette that flipped with
 * them would churn the key underneath the player.
 */
export function paletteForRun(
  scene: { cyberspace?: unknown } | null | undefined
): MusicPaletteName {
  return scene?.cyberspace ? 'cyber' : 'meat';
}

/**
 * Tension for a live run, from the facility alarm's current phase.
 *
 * COOLDOWN stays at full tension deliberately: the alarm has stopped escalating
 * but hostiles are still converging, and dropping the score the instant the
 * phase flips would tell the player they are safe a turn or two before they are.
 *
 * An absent phase (older saves predate the alarm cadence) reads as quiet — the
 * conservative default, since guessing "alarmed" would score a calm run as a
 * firefight.
 */
export function tensionForAlarmPhase(phase: string | null | undefined): MusicTension {
  if (!phase || phase === ALARM_PHASE.QUIET) return 1;
  return 2;
}

/**
 * Tension for an ALARM_CHANGED transition, or `null` if the transition carries
 * no musical meaning (so callers can leave the current tension alone rather than
 * guessing at one).
 *
 * The three transitions the World emits are `raised` (World.raiseAlarm),
 * and `cooldown` / `quiet` (World.tickAlarm).
 */
export function tensionForAlarmTransition(
  transition: string | null | undefined
): MusicTension | null {
  switch (transition) {
    case 'raised':
      return 2;
    case 'cooldown':
      return 2;
    case 'quiet':
      return 1;
    default:
      return null;
  }
}
