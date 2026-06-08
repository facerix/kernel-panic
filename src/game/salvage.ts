/**
 * Typed salvage wallet (P2.5.M4.2). Four buckets replace the old single
 * `salvage: number` on `Crew.inventory`, `Campaign`, and `LootableEntity.loot`,
 * letting Finn and crafting hooks price/spend distinct components.
 *
 *   - **Scrap** — generic mechanical parts. Drone corpses, breached props,
 *     improvised-turret cost (`Tech.improviseTurret`).
 *   - **Chips** — electronics. Corp turrets, relay nodes.
 *   - **Bio** — organic samples. Clinic / bio-flavored retrieve pickups.
 *   - **Data** — informational. Dossier/dead-drop retrieve, ledger handoffs.
 *
 * Schema invariants (enforced by `validateSalvage`):
 *   - every field is a non-negative integer (no fractional yields, no debts)
 *   - no extra keys (catch typos at restore time, not at sell time)
 *
 * Migration: pre-P2.5.M4.2 snapshots store `salvage: number` and are
 * converted by `migrateSalvage` — all legacy units bucket into **scrap**.
 * The numeric total is preserved; only the type tag is inferred (scrap is the
 * most defensible default for a generic legacy counter).
 *
 * Silent fallbacks are bugs (per CLAUDE.md). `validateSalvage` throws on
 * malformed input; `migrateSalvage` only accepts a finite non-negative
 * integer or a structurally valid `TypedSalvage`, and crashes loudly
 * otherwise.
 */

export const SALVAGE_TYPES = Object.freeze(['scrap', 'chips', 'bio', 'data'] as const);
export type SalvageType = (typeof SALVAGE_TYPES)[number];

export type TypedSalvage = {
  scrap: number;
  chips: number;
  bio: number;
  data: number;
};

/** Fresh empty wallet — `{ scrap: 0, chips: 0, bio: 0, data: 0 }`. */
export function emptySalvage(): TypedSalvage {
  return { scrap: 0, chips: 0, bio: 0, data: 0 };
}

/** Sum across all four buckets. Used for total displays + "sell any" flow. */
export function totalSalvage(s: TypedSalvage): number {
  return s.scrap + s.chips + s.bio + s.data;
}

/** True when every bucket is zero. */
export function isEmptySalvage(s: TypedSalvage): boolean {
  return totalSalvage(s) === 0;
}

/**
 * Add `b` into `a` in place. Returns `a` for chaining. Both operands must be
 * valid TypedSalvage (call `validateSalvage` first if untrusted).
 */
export function addSalvage(a: TypedSalvage, b: TypedSalvage): TypedSalvage {
  a.scrap += b.scrap;
  a.chips += b.chips;
  a.bio += b.bio;
  a.data += b.data;
  return a;
}

/** Shallow clone — keeps callers from mutating shared references. */
export function cloneSalvage(s: TypedSalvage): TypedSalvage {
  return { scrap: s.scrap, chips: s.chips, bio: s.bio, data: s.data };
}

/**
 * Build a TypedSalvage from a partial set of overrides. Missing fields default
 * to 0. Useful for test fixtures and entity loot definitions:
 *
 *   makeSalvage({ scrap: 2 })        // { scrap: 2, chips: 0, bio: 0, data: 0 }
 *   makeSalvage({ chips: 1, data: 1 })
 */
export function makeSalvage(parts: Partial<TypedSalvage>): TypedSalvage {
  const s = emptySalvage();
  for (const t of SALVAGE_TYPES) {
    if (parts[t] !== undefined) {
      if (!Number.isInteger(parts[t]) || (parts[t] as number) < 0) {
        throw new RangeError(`makeSalvage: ${t} must be a non-negative integer, got ${parts[t]}`);
      }
      s[t] = parts[t] as number;
    }
  }
  return s;
}

/**
 * Validate that `value` is a structurally-correct TypedSalvage. Returns the
 * value cast as TypedSalvage on success; throws TypeError/RangeError on
 * failure (no silent coercion — per project policy).
 */
export function validateSalvage(value: unknown, ctx: string): TypedSalvage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${ctx}: TypedSalvage must be a plain object, got ${typeof value}`);
  }
  const v = value as Record<string, unknown>;
  for (const t of SALVAGE_TYPES) {
    if (!(t in v)) {
      throw new TypeError(`${ctx}: TypedSalvage missing required field "${t}"`);
    }
    if (!Number.isInteger(v[t]) || (v[t] as number) < 0) {
      throw new RangeError(`${ctx}: TypedSalvage.${t} must be a non-negative integer, got ${v[t]}`);
    }
  }
  // Reject extra keys so typos at restore surface immediately instead of
  // silently vanishing into the wallet.
  for (const key of Object.keys(v)) {
    if (!(SALVAGE_TYPES as readonly string[]).includes(key)) {
      throw new TypeError(`${ctx}: TypedSalvage has unknown field "${key}"`);
    }
  }
  return {
    scrap: v.scrap as number,
    chips: v.chips as number,
    bio: v.bio as number,
    data: v.data as number,
  };
}

/**
 * Accept either a legacy `number` (pre-P2.5.M4.2 saves) or a TypedSalvage
 * shape, and return a freshly-allocated TypedSalvage. Legacy units all bucket
 * into `scrap`; the numeric total is preserved. Throws if `value` is neither
 * a non-negative integer nor a valid TypedSalvage — silent fallbacks would
 * corrupt saves.
 */
export function migrateSalvage(value: unknown, ctx: string): TypedSalvage {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${ctx}: legacy salvage must be a non-negative integer, got ${value}`);
    }
    return { scrap: value, chips: 0, bio: 0, data: 0 };
  }
  return validateSalvage(value, ctx);
}

/** Format helper — compact status-bar string like `S:12 C:3 B:0 D:1`. */
export function formatSalvageCompact(s: TypedSalvage): string {
  return `S:${s.scrap} C:${s.chips} B:${s.bio} D:${s.data}`;
}
