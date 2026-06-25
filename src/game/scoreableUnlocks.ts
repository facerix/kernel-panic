/**
 * Meta-progression store helpers for "Stolen Blueprints" (P3.M6).
 *
 * `unlockedScoreableItems` is a cross-campaign record of which scoreable item
 * blueprints the meta-crew has stolen via clean Score heists. It is an ordered
 * list of item IDs (acquisition order, newest-last) persisted by `DataStore`.
 *
 * These are pure functions — no DOM, no mutation of inputs — mirroring the
 * relationship `campaignSummary.ts` has with `DataStore`. They validate
 * structure only: catalog membership (an id naming a real `SCOREABLE_ITEMS`
 * entry) is a later-slice concern (M6.2/M6.4) once that catalog exists.
 *
 * Per the global directive — silent fallbacks corrupt data — a structurally
 * invalid store throws rather than resetting to an empty list.
 */

/**
 * Validate and normalize a persisted `unlockedScoreableItems` value.
 *
 *   - `undefined` (key absent in a legacy save) → `[]`.
 *   - Not an array → throw.
 *   - Any element that is not a non-empty string → throw.
 *   - De-duplicates, preserving first-seen (acquisition) order.
 *
 * Returns a fresh array — never the caller-owned reference.
 */
export function normalizeUnlockedScoreableItems(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError('unlockedScoreableItems must be an array');
  }
  const seen = new Set<string>();
  const items: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string' || candidate.length === 0) {
      throw new TypeError('unlockedScoreableItems entries must be non-empty strings');
    }
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    items.push(candidate);
  }
  return items;
}

/**
 * Append a newly-stolen scoreable item id to the unlock list. Idempotent:
 * archiving an id already present is a no-op (`added: false`) — the blueprint
 * is stolen once. The input list is validated; the id must be a non-empty
 * string. Returns a fresh list and whether anything changed.
 */
export function archiveScoreableItem(
  list: readonly string[],
  id: string
): { list: string[]; added: boolean } {
  const normalized = normalizeUnlockedScoreableItems(list);
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('archiveScoreableItem: id must be a non-empty string');
  }
  if (normalized.includes(id)) {
    return { list: normalized, added: false };
  }
  return { list: [...normalized, id], added: true };
}
