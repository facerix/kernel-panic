/**
 * "Showcase slot" follow-up to P3.5.M7 (added 2026-07-14).
 *
 * The first new campaign started after an archetype unlock reserves crew
 * candidate slot 0 for an instance of that archetype (`Campaign.
 * generateInitialCandidates`), so a clean Score win is immediately
 * followed by a guaranteed chance to try what was just unlocked — not a
 * "maybe, eventually" the ordinary roll-then-derive pipeline would give.
 *
 * `pendingArchetypeShowcase` is a single nullable id (not a list, unlike
 * `unlockedArchetypes`) — at most one showcase can ever be pending at a
 * time, since the only way to unlock an archetype (winning a Score) always
 * ends the campaign in the same step, so there is always a "next campaign
 * start" between any two unlocks in normal play.
 */

/**
 * Validate and normalize a persisted `pendingArchetypeShowcase` value.
 *
 *   - `undefined` or `null` (key absent, or explicitly cleared) → `null`.
 *   - Anything other than a non-empty string → throw.
 */
export function normalizePendingArchetypeShowcase(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('pendingArchetypeShowcase must be a non-empty string or null');
  }
  return value;
}
