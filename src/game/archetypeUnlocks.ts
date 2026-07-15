/**
 * Meta-progression store helpers for archetype unlocks (P3.5.M7).
 *
 * `unlockedArchetypes` is a cross-campaign record of which of the three
 * P3.5-gated archetypes (Berserk, Adept, Chimera) the meta-crew has
 * unlocked via a clean Score win. It is an ordered list of archetype ids
 * (acquisition order, newest-last) persisted by `DataStore`, wholly
 * independent of `unlockedScoreableItems` — nothing grandfathers in from
 * item-unlock history (design decision locked 2026-07-13; see
 * `docs/phase-3.5-plan.md` § P3.5.M7).
 *
 * Mirrors `scoreableUnlocks.ts` exactly: same validation contract, same
 * "absent → [], malformed → throw, idempotent archive" shape. Per the
 * global directive — silent fallbacks corrupt data — a structurally
 * invalid store throws rather than resetting to an empty list.
 */

/**
 * Validate and normalize a persisted `unlockedArchetypes` value.
 *
 *   - `undefined` (key absent — every pre-M7 save) → `[]`.
 *   - Not an array → throw.
 *   - Any element that is not a non-empty string → throw.
 *   - De-duplicates, preserving first-seen (acquisition) order.
 *
 * Returns a fresh array — never the caller-owned reference.
 */
export function normalizeUnlockedArchetypes(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError('unlockedArchetypes must be an array');
  }
  const seen = new Set<string>();
  const archetypes: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string' || candidate.length === 0) {
      throw new TypeError('unlockedArchetypes entries must be non-empty strings');
    }
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    archetypes.push(candidate);
  }
  return archetypes;
}

/**
 * Append a newly-unlocked archetype id to the unlock list. Idempotent:
 * archiving an id already present is a no-op (`added: false`) — an
 * archetype unlocks once. The input list is validated; the id must be a
 * non-empty string. Returns a fresh list and whether anything changed.
 */
export function archiveUnlockedArchetype(
  list: readonly string[],
  id: string
): { list: string[]; added: boolean } {
  const normalized = normalizeUnlockedArchetypes(list);
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('archiveUnlockedArchetype: id must be a non-empty string');
  }
  if (normalized.includes(id)) {
    return { list: normalized, added: false };
  }
  return { list: [...normalized, id], added: true };
}
