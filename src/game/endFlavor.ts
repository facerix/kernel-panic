/**
 * Campaign end-screen flavor pools (P3 polish).
 *
 * Every outcome's overlay does distinct narrative work — verdict, cold readout,
 * crew fate, (on a win) the stolen prize — instead of restating one idea. Copy
 * is drawn deterministically from per-seed pools, so a given campaign always
 * ends the same way but different campaigns vary; each slot draws from its own
 * `salt` so the lines don't move in lockstep.
 *
 * Losses stay *cause-aware*: each end reason has its own banner/reason/detail
 * pool, so a clock-expired loss never borrows a death-implying banner.
 */

import type { CampaignEndReason } from '../types.js';
import type { CampaignSummary } from './campaignSummary.js';

/** The verdict — pairs visually with the loss banner treatment. */
export const WIN_BANNERS = [
  'EXFIL CLEAN',
  "WE'RE GHOSTS",
  'CLEAN BREAK',
  'PAYDAY',
  'RUN COMPLETE',
] as const;

/** The cold system readout. */
export const WIN_REASONS = [
  'Payload secured. Trail cold.',
  "Exfil confirmed — you're a ghost.",
  'The Score is yours.',
  'Jacked out clean. No tail.',
] as const;

/** The crew's fate — the human line. */
export const WIN_DETAILS = [
  "Your crew jacked out before the ICE closed. The data's already moving on the black market.",
  "Nobody flatlined on the way out. The corp won't know what's missing until the quarterlies.",
  "Payload fenced, trail cold, crew breathing. That's a good night in this city.",
] as const;

/** The loot label above the stolen blueprint. */
export const WIN_REWARD_KICKERS = [
  'PAYLOAD DECRYPTED',
  'HOT OFF THE WIRE',
  'STOLEN BLUEPRINT',
  'FENCED INTEL',
] as const;

/**
 * P3.6 Partial — the *costly win*. The Score landed and the payload walked out,
 * but somebody didn't. The tone is a wake, not a failure report: never imply
 * the job was abandoned or the payload lost, because neither is true.
 */
export const PARTIAL_BANNERS = [
  'BOUGHT IN BLOOD',
  'ONE DIDN’T COME BACK',
  'COSTLY SCORE',
  'PAID IN FULL',
] as const;

export const PARTIAL_REASONS = [
  'The Score landed. The crew did not.',
  'You got the payload. You lost an operator.',
  'The job closed clean. The crew came back short.',
] as const;

export const PARTIAL_DETAILS = [
  'The payload cleared the fence and the blueprint is yours. It cost you someone who will not be spending the cut.',
  'The target is gone, the data is stolen, and there is an empty chair at the table. The street calls that a win. Barely.',
  'Everything the job asked for, delivered. The price was an operator who never made the exit.',
] as const;

/** The loot label above a blueprint that cost somebody their life. */
export const PARTIAL_REWARD_KICKERS = [
  'PAID FOR IN BLOOD',
  'THEIR LAST SCORE',
  'STOLEN AT A PRICE',
] as const;

/** P3.6 Aborted — walked out of the Score empty-handed. Nothing was secured. */
export const ABORTED_BANNERS = ['WALKED AWAY', 'SCORE ABANDONED', 'GAME OVER'] as const;

export const ABORTED_REASONS = [
  'You walked out of the Score with nothing.',
  'The crew aborted the finale.',
  'The Score was left on the table.',
] as const;

export const ABORTED_DETAILS = [
  'The payload never left its rack. The target is locked down for good and the campaign ends here.',
  'You made the exit and nothing else. The corp patched the hole you left behind.',
  'The one shot at the Score is spent. Nothing to fence, nothing to show.',
] as const;

type FlavorPool = {
  banners: readonly string[];
  reasons: readonly string[];
  details: readonly string[];
};

/**
 * Loss pools keyed by end reason. `crew-wipe` is the default bucket for any
 * loss that isn't a closed window or a dead Decker.
 */
export const LOSS_FLAVOR = {
  'clock-expired': {
    banners: ['TIME OUT', 'WINDOW CLOSED', 'GAME OVER'],
    reasons: ['The Score window closed.', 'The clock beat you to it.', 'You ran out of runway.'],
    details: [
      'Corp security caught up. The contract is cold and this campaign is over.',
      'The window slammed shut and the corp locked everything down. Nothing left to hit.',
      "The schedule slipped one job too many. The Score's gone cold.",
    ],
  },
  'decker-flatlined-score': {
    banners: ['FLATLINED', 'LINK SEVERED', 'GAME OVER'],
    reasons: [
      'The Decker flatlined during the Score.',
      'Your Decker bricked on the ICE.',
      'The Decker never jacked back out.',
    ],
    details: [
      'The intrusion channel is gone. Nobody can finish the Score.',
      'Black ICE took your Decker, and the only way in died with them.',
      'No Decker, no door. The Score is sealed for good.',
    ],
  },
  'score-aborted': {
    banners: ABORTED_BANNERS,
    reasons: ABORTED_REASONS,
    details: ABORTED_DETAILS,
  },
  'crew-wipe': {
    banners: ['GAME OVER', 'CREW DOWN', 'NO SURVIVORS'],
    reasons: ['No surviving operators.', 'The whole crew is gone.', 'Nobody walked away.'],
    details: [
      'Every crew slot on the roster is flatlined. Their story ends here.',
      'The street took all of them. This campaign ends in the morgue.',
      'No operators left standing. The corp wins this one.',
    ],
  },
} as const satisfies Record<string, FlavorPool>;

/** Per-slot salts keep the lines decorrelated for a given seed. */
const SALT = {
  banner: 0,
  reason: 1,
  detail: 2,
  rewardKicker: 3,
} as const;

/**
 * Deterministic integer mix of `seed` and `salt`. A plain `seed % length` would
 * couple every slot to the same index; mixing in a salt and avalanching the bits
 * decorrelates them while staying stable across reloads.
 */
function mix(seed: number, salt: number): number {
  let x = (Math.trunc(seed) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Pick a stable member of `options` for the given `seed`/`salt`. */
export function pickFlavor<T>(seed: number, salt: number, options: readonly T[]): T {
  if (options.length === 0) {
    throw new Error('pickFlavor requires a non-empty pool');
  }
  return options[mix(seed, salt) % options.length];
}

export type EndFlavor = {
  banner: string;
  reason: string;
  detail: string;
  /** Loot kicker — present only on a win. */
  rewardKicker?: string;
};

/** Resolve the loss bucket for an end reason, defaulting to the crew-wipe pool. */
function lossPool(endReason: CampaignEndReason): FlavorPool {
  if (
    endReason === 'clock-expired' ||
    endReason === 'decker-flatlined-score' ||
    endReason === 'score-aborted'
  ) {
    return LOSS_FLAVOR[endReason];
  }
  return LOSS_FLAVOR['crew-wipe'];
}

/** Resolve every end-screen line for a campaign summary. */
export function selectEndFlavor(summary: CampaignSummary): EndFlavor {
  const { seed } = summary;
  if (summary.result === 'win') {
    return {
      banner: pickFlavor(seed, SALT.banner, WIN_BANNERS),
      reason: pickFlavor(seed, SALT.reason, WIN_REASONS),
      detail: pickFlavor(seed, SALT.detail, WIN_DETAILS),
      rewardKicker: pickFlavor(seed, SALT.rewardKicker, WIN_REWARD_KICKERS),
    };
  }
  if (summary.result === 'partial') {
    return {
      banner: pickFlavor(seed, SALT.banner, PARTIAL_BANNERS),
      reason: pickFlavor(seed, SALT.reason, PARTIAL_REASONS),
      detail: pickFlavor(seed, SALT.detail, PARTIAL_DETAILS),
      // P3.6: a costly Score still steals the blueprint, so it still earns a
      // loot kicker — just one that names what it cost.
      rewardKicker: pickFlavor(seed, SALT.rewardKicker, PARTIAL_REWARD_KICKERS),
    };
  }
  const pool = lossPool(summary.endReason);
  return {
    banner: pickFlavor(seed, SALT.banner, pool.banners),
    reason: pickFlavor(seed, SALT.reason, pool.reasons),
    detail: pickFlavor(seed, SALT.detail, pool.details),
  };
}
