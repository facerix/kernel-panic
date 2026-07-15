/**
 * P3.5.M6: roll-then-derive crew stat generation.
 *
 * Core stats (hit chance, dodge chance, armor) are rolled first; the
 * archetype is derived from the resulting (hitChance, dodgeChance) point via
 * nearest-anchor classification. Replaces the old "pick an archetype, get
 * fixed stats" flow (`RECRUIT_ARCHETYPE_POOL`, retired this milestone). See
 * `docs/phase-3.5-plan.md` § P3.5.M6 for the full design rationale — in
 * particular *why* `CREW_STAT_ANCHORS` is a separate table from each
 * archetype's own default base stats (old-save safety: retuning the
 * defaults to fix the classification partition would silently restore
 * legacy Merc/Razor/Tech saves to stats they never had).
 *
 * The Decker is deliberately absent from `CREW_STAT_ANCHORS` — it stays a
 * forced, narrative-only mid-campaign recruit, never rolled.
 */
import { Rng } from '../rng.js';
import {
  buildCrewMember,
  type BuildCrewMemberOptions,
  type BuildCrewMemberSpawn,
} from './archetypes/index.js';
import type { Crew } from './Crew.js';
import type { CrewArchetypeId } from './Run.js';
import {
  CREW_HIT_CHANCE_ROLL_MIN,
  CREW_HIT_CHANCE_ROLL_MAX,
  CREW_DODGE_CHANCE_ROLL_MIN,
  CREW_DODGE_CHANCE_ROLL_MAX,
  CREW_ARMOR_ROLL_CHANCE,
  DODGE_CHANCE,
  MERC_DEFAULT_HIT_CHANCE,
  RAZOR_DEFAULT_HIT_CHANCE,
  RAZOR_DEFAULT_DODGE_CHANCE,
  TECH_DEFAULT_HIT_CHANCE,
  DECKER_DEFAULT_HIT_CHANCE,
  BERSERK_DEFAULT_HIT_CHANCE,
  BERSERK_DEFAULT_DODGE_CHANCE,
  ADEPT_DEFAULT_HIT_CHANCE,
  ADEPT_DEFAULT_DODGE_CHANCE,
  CHIMERA_DEFAULT_HIT_CHANCE,
  CHIMERA_DEFAULT_DODGE_CHANCE,
} from './constants.js';

export type CrewStatAnchor = {
  archetype: CrewArchetypeId;
  hitChance: number;
  dodgeChance: number;
};

/**
 * Nearest-anchor classification table (P3.5.M6). Tuned for an even six-way
 * partition of the roll domain — this is NOT the same table as each
 * archetype's default base stats (`DEFAULT_HIT_CHANCE_BY_ARCHETYPE` below).
 * Armor plays no role in classification; agility (dodge) is the primary
 * spread axis — the "fast" pair (Berserk, Razor) owns the high-dodge
 * region, Merc sits mid-dodge, and the "slow" trio (Chimera, Tech, Adept)
 * fills the low-dodge band separated along the hit axis.
 */
export const CREW_STAT_ANCHORS: readonly CrewStatAnchor[] = Object.freeze([
  { archetype: 'merc', hitChance: 0.83, dodgeChance: 0.27 },
  { archetype: 'berserk', hitChance: 0.78, dodgeChance: 0.36 },
  { archetype: 'razor', hitChance: 0.68, dodgeChance: 0.36 },
  { archetype: 'chimera', hitChance: 0.79, dodgeChance: 0.2 },
  { archetype: 'tech', hitChance: 0.73, dodgeChance: 0.19 },
  { archetype: 'adept', hitChance: 0.67, dodgeChance: 0.2 },
]);

/**
 * Fixed tie-break priority for exact anchor-distance ties. Deterministic,
 * not gameplay-significant — Voronoi-boundary points are measure-zero on a
 * continuous roll, but the 0.01 rounding grid lands on them often enough
 * that `deriveArchetype` needs a documented, stable rule.
 */
const TIE_BREAK_ORDER: readonly CrewArchetypeId[] = [
  'merc',
  'razor',
  'adept',
  'tech',
  'berserk',
  'chimera',
];

/**
 * Old-save fallback + each archetype's own un-rolled constructor default.
 * Frozen to the pre-P3.5 shipped values for Merc/Razor/Tech/Decker — see
 * `constants.ts`'s doc comment on `MERC_DEFAULT_HIT_CHANCE` et al. — and
 * free for the three P3.5-new archetypes (no pre-P3.5 saves exist for them).
 * `restoreCrewMember` (`persistence.ts`) reads these when a
 * `CampaignCrewSnapshot` predates P3.5.M6 and carries no rolled stats.
 */
export const DEFAULT_HIT_CHANCE_BY_ARCHETYPE: Record<CrewArchetypeId, number> = Object.freeze({
  merc: MERC_DEFAULT_HIT_CHANCE,
  razor: RAZOR_DEFAULT_HIT_CHANCE,
  tech: TECH_DEFAULT_HIT_CHANCE,
  decker: DECKER_DEFAULT_HIT_CHANCE,
  berserk: BERSERK_DEFAULT_HIT_CHANCE,
  adept: ADEPT_DEFAULT_HIT_CHANCE,
  chimera: CHIMERA_DEFAULT_HIT_CHANCE,
});

export const DEFAULT_DODGE_CHANCE_BY_ARCHETYPE: Record<CrewArchetypeId, number> = Object.freeze({
  merc: DODGE_CHANCE,
  razor: RAZOR_DEFAULT_DODGE_CHANCE,
  tech: DODGE_CHANCE,
  decker: DODGE_CHANCE,
  berserk: BERSERK_DEFAULT_DODGE_CHANCE,
  adept: ADEPT_DEFAULT_DODGE_CHANCE,
  chimera: CHIMERA_DEFAULT_DODGE_CHANCE,
});

function roundToHundredth(value: number): number {
  return Math.round(value * 100) / 100;
}

export type RolledCrewStats = {
  hitChance: number;
  dodgeChance: number;
  armor: number;
};

/**
 * Roll core combat stats for a fresh crew member. Continuous uniform rolls,
 * rounded to 0.01 so the HUD reads clean percents and `deriveArchetype`'s
 * classification domain stays finite and enumerable (21 × 26 = 546 tuples).
 * These ranges deliberately overrun `CREW_STAT_ANCHORS`' hull (hit
 * 0.67–0.83, dodge 0.19–0.36) — see the `constants.ts` doc comment on
 * `CREW_HIT_CHANCE_ROLL_MIN` for why that's intentional.
 */
export function rollCrewStats(rng: Rng): RolledCrewStats {
  if (!rng || typeof rng.next !== 'function' || typeof rng.chance !== 'function') {
    throw new TypeError('rollCrewStats requires an Rng');
  }
  const hitChance = roundToHundredth(
    CREW_HIT_CHANCE_ROLL_MIN + rng.next() * (CREW_HIT_CHANCE_ROLL_MAX - CREW_HIT_CHANCE_ROLL_MIN)
  );
  const dodgeChance = roundToHundredth(
    CREW_DODGE_CHANCE_ROLL_MIN +
      rng.next() * (CREW_DODGE_CHANCE_ROLL_MAX - CREW_DODGE_CHANCE_ROLL_MIN)
  );
  const armor = rng.chance(CREW_ARMOR_ROLL_CHANCE) ? 1 : 0;
  return { hitChance, dodgeChance, armor };
}

/**
 * Classify a rolled (hitChance, dodgeChance) point to the nearest archetype
 * anchor by squared Euclidean distance; minimum wins. `anchors` defaults to
 * the full six-archetype table; P3.5.M7 passes a lock-filtered subset so a
 * locked archetype's anchor is simply absent from the search — every roll
 * that would've landed there saturates to its nearest *unlocked* neighbor,
 * the same mechanism that already handles rolls overrunning the anchor
 * hull. Throws on an empty anchor list — never silently returns an
 * unclassifiable result.
 */
export function deriveArchetype(
  stats: { hitChance: number; dodgeChance: number },
  anchors: readonly CrewStatAnchor[] = CREW_STAT_ANCHORS
): CrewArchetypeId {
  if (!anchors || anchors.length === 0) {
    throw new Error('deriveArchetype: anchors list is empty');
  }
  let bestArchetype: CrewArchetypeId | null = null;
  let bestDist = Infinity;
  let bestPriority = Infinity;
  for (const anchor of anchors) {
    const dh = stats.hitChance - anchor.hitChance;
    const dd = stats.dodgeChance - anchor.dodgeChance;
    const dist = dh * dh + dd * dd;
    const priority = TIE_BREAK_ORDER.indexOf(anchor.archetype);
    if (dist < bestDist || (dist === bestDist && priority < bestPriority)) {
      bestDist = dist;
      bestArchetype = anchor.archetype;
      bestPriority = priority;
    }
  }
  if (bestArchetype === null) {
    // Unreachable given the length guard above; keeps the return type honest.
    throw new Error('deriveArchetype: no archetype resolved');
  }
  return bestArchetype;
}

/**
 * Roll stats, derive the archetype, and construct the crew member in one
 * call. Stat rolling goes through `rng.fork('crew-stats')` — a substream
 * derived from (but not consuming) the caller's `rng` — so adding this roll
 * doesn't perturb any other roll sequence (callsign pick, combat, …) that
 * already reads from `rng` (`rng.ts`'s documented "add a mechanic without
 * perturbing other rolls" fork use case). Armor is applied post-construction
 * via the already-settable `damageReduction` field — it's rolled but is NOT
 * a `deriveArchetype` classifier.
 */
export function buildCrewMemberFromRoll(
  spawn: BuildCrewMemberSpawn,
  rng: Rng,
  options: BuildCrewMemberOptions = {},
  anchors: readonly CrewStatAnchor[] = CREW_STAT_ANCHORS
): Crew {
  const statsRng = rng.fork('crew-stats');
  const stats = rollCrewStats(statsRng);
  const archetypeId = deriveArchetype(stats, anchors);
  const member = buildCrewMember(archetypeId, spawn, rng, {
    ...options,
    baseHitChance: stats.hitChance,
    baseDodgeChance: stats.dodgeChance,
  });
  member.damageReduction += stats.armor;
  return member;
}

/** Generous crash-over-hang backstop for {@link buildCrewMemberFromRollForArchetype}'s rejection loop — not a tuned budget. */
const FORCED_ARCHETYPE_ROLL_MAX_ATTEMPTS = 2000;

/**
 * Showcase-slot follow-up to P3.5.M7 (added 2026-07-14): roll stats by
 * rejection sampling until they classify to `archetypeId` under `anchors`,
 * then construct the crew member — used to guarantee a specific archetype
 * (the first campaign-start candidate pool after that archetype's Score
 * unlock reserves slot 0 for it) while still keeping natural roll variance,
 * rather than pinning the archetype's exact anchor point every time.
 *
 * `deriveArchetype`'s classification domain is finite (546 rounded grid
 * tuples) and every registered archetype covers a double-digit percentage
 * of it (M6's partition guarantee — see `crewStatRoll.test.ts`), so this
 * converges in a handful of attempts in practice. Throws if `archetypeId`
 * has no anchor in the supplied table (e.g. it's actually locked — callers
 * must check gating themselves; this function does not silently ignore a
 * request it cannot satisfy) or if `maxAttempts` is exhausted.
 */
export function buildCrewMemberFromRollForArchetype(
  spawn: BuildCrewMemberSpawn,
  rng: Rng,
  archetypeId: CrewArchetypeId,
  anchors: readonly CrewStatAnchor[] = CREW_STAT_ANCHORS,
  options: BuildCrewMemberOptions = {},
  maxAttempts: number = FORCED_ARCHETYPE_ROLL_MAX_ATTEMPTS
): Crew {
  if (!anchors.some(anchor => anchor.archetype === archetypeId)) {
    throw new Error(
      `buildCrewMemberFromRollForArchetype: "${archetypeId}" has no anchor in the supplied table`
    );
  }
  const statsRng = rng.fork('crew-stats');
  let stats: RolledCrewStats | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = rollCrewStats(statsRng);
    if (deriveArchetype(candidate, anchors) === archetypeId) {
      stats = candidate;
      break;
    }
  }
  if (!stats) {
    throw new Error(
      `buildCrewMemberFromRollForArchetype: could not roll "${archetypeId}" in ${maxAttempts} attempts`
    );
  }
  const member = buildCrewMember(archetypeId, spawn, rng, {
    ...options,
    baseHitChance: stats.hitChance,
    baseDodgeChance: stats.dodgeChance,
  });
  member.damageReduction += stats.armor;
  return member;
}
