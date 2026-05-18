/**
 * Archetype registry.
 *
 * `Merc` and `Razor` live as classes in their own files (combat/perk logic
 * stays close to the entity). This module is the *metadata* layer those
 * classes don't carry: display name, blurb, perk id, and the key that fires
 * the perk in the current keymap. The three consumers:
 *
 *   - `<crew-roster>` / Hub UI    reads `ARCHETYPES` for labels
 *   - `<key-help>`                reads `ARCHETYPES[id].perkLabel` for intro text
 *   - `Campaign.buildCrew`        calls `buildCrewMember` to instantiate crew
 *
 * In-world glyph is `'@'` for both archetypes (the player avatar is consistent
 * regardless of pick). Archetype identity surfaces through the entity *class*
 * — snapshot's `archetype` field, perk-key availability, and HUD copy.
 *
 * If a future milestone adds a third archetype, register it here, add an
 * entry to `ARCHETYPE_IDS` in the order it should appear in the selector,
 * and the rest of the game picks it up automatically.
 */

import { Merc, CALLSIGNS as MERC_CALLSIGNS } from './Merc.js';
import { Razor, CALLSIGNS as RAZOR_CALLSIGNS } from './Razor.js';
import { Tech, CALLSIGNS as TECH_CALLSIGNS } from './Tech.js';
import type { Rng } from '../../rng.js';
import type { FactionId } from '../constants.js';
import type { CrewInit } from '../Crew.js';

export type Archetype = Merc | Razor | Tech;

/**
 * Display order is also the starter crew order in `Campaign.buildCrew`.
 * Merc first so new players hit the simpler ranged archetype on first load;
 * Tech last since its gadget loop is the most involved kit to learn.
 */
export const ARCHETYPE_IDS = Object.freeze(['merc', 'razor', 'tech']);

/**
 * Weighted archetype pool for recruitment (M6). 40% Merc, 40% Razor, 20% Tech.
 * Expressed as a flat array so `rng.pick()` gives the correct distribution.
 */
export const RECRUIT_ARCHETYPE_POOL = Object.freeze(['merc', 'merc', 'razor', 'razor', 'tech']);

/**
 * All three archetypes share a single perk key (`x`) — the keymap collapses
 * vault/slide/deploy into one `MODE.SPECIAL_AIM` aim mode that dispatches by
 * archetype at the intent layer (`applyIntent.doSpecial`). The per-archetype
 * `perkLabel` is what `<key-help>` surfaces in the combat intro text, so
 * the visible verb stays archetype-specific even though the keystroke doesn't.
 */
export const ARCHETYPES = Object.freeze({
  merc: Object.freeze({
    id: 'merc',
    name: 'MERC',
    blurb: 'Long-range pressure. Vault repositions under fire.',
    perks: Object.freeze(['vault']),
    perkName: 'VAULT',
    perkLabel: 'VAULT — hop cover & fire',
  }),
  razor: Object.freeze({
    id: 'razor',
    name: 'RAZOR',
    blurb: 'Close-quarters ghost. Slide in, cut out.',
    perks: Object.freeze(['slide']),
    perkName: 'SLIDE',
    perkLabel: 'SLIDE — 2-tile silent dash',
  }),
  tech: Object.freeze({
    id: 'tech',
    name: 'TECH',
    blurb: "Field engineer. Turrets hold what you can't.",
    perks: Object.freeze(['deploy']),
    perkName: 'DEPLOY',
    perkLabel: 'DEPLOY — place a turret',
  }),
});

export type ArchetypeInfo = (typeof ARCHETYPES)[keyof typeof ARCHETYPES];

const BUILDERS = Object.freeze({
  merc: Merc,
  razor: Razor,
  tech: Tech,
});

/**
 * Per-archetype callsign pool, mirrored from each archetype module. Kept as a
 * single map so `buildCrewMember` doesn't need a per-archetype branch — and
 * so `Campaign.buildCrew` (M2) can iterate archetypes and dedupe across the
 * union in one pass.
 */
export const CALLSIGNS_BY_ARCHETYPE = Object.freeze({
  merc: MERC_CALLSIGNS,
  razor: RAZOR_CALLSIGNS,
  tech: TECH_CALLSIGNS,
});

export function isArchetypeId(value: string) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BUILDERS, value);
}

/**
 * Pick a callsign for `archetypeId` using `rng`, excluding any names in
 * `excludeCallsigns` (a Set). Throws if the pool is empty after filtering —
 * we'd rather crash than silently hand back a duplicate or a placeholder.
 * Pure helper so M2's `Campaign.buildCrew` can call it directly when seeding
 * the starter trio.
 */
export function pickCallsign(archetypeId: string, rng: Rng, excludeCallsigns = new Set()) {
  if (!isArchetypeId(archetypeId)) {
    throw new Error(`pickCallsign: unknown archetype "${archetypeId}"`);
  }
  if (!rng || typeof rng.pick !== 'function') {
    throw new TypeError('pickCallsign requires an Rng with a pick() method');
  }
  if (!(excludeCallsigns instanceof Set)) {
    throw new TypeError('pickCallsign: excludeCallsigns must be a Set');
  }
  const pool = CALLSIGNS_BY_ARCHETYPE[archetypeId as keyof typeof CALLSIGNS_BY_ARCHETYPE];
  const available = pool.filter(name => !excludeCallsigns.has(name));
  if (available.length === 0) {
    throw new Error(
      `pickCallsign: no callsigns available for "${archetypeId}" ` +
        `(pool size ${pool.length}, excluded ${excludeCallsigns.size})`
    );
  }
  return rng.pick(available);
}

/**
 * Build a named crew member. Threads a campaign-scoped `Rng` so the callsign
 * is reproducible from the campaign seed, and accepts an `excludeCallsigns`
 * Set so callers (`Campaign.buildCrew`, future recruitment in M6) can dedupe
 * against campaign history.
 */
type BuildCrewMemberOptions = {
  excludeCallsigns?: Set<string>;
  id?: string;
  maxAp?: number;
  maxHp?: number;
  faction?: FactionId;
};
type BuildCrewMemberSpawn = {
  x: number;
  y: number;
  maxAp?: number;
  maxHp?: number;
  faction?: FactionId;
};
export function buildCrewMember(
  archetypeId: string,
  spawn: BuildCrewMemberSpawn,
  rng: Rng,
  options: BuildCrewMemberOptions = { excludeCallsigns: new Set() }
) {
  if (!isArchetypeId(archetypeId)) {
    throw new Error(`buildCrewMember: unknown archetype "${archetypeId}"`);
  }
  if (!spawn || typeof spawn !== 'object') {
    throw new TypeError('buildCrewMember: spawn must be an object with finite {x, y}');
  }
  if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.y)) {
    throw new TypeError(
      `buildCrewMember: spawn must have finite x,y; got (${spawn.x}, ${spawn.y})`
    );
  }
  if (!rng || typeof rng.pick !== 'function') {
    throw new TypeError('buildCrewMember requires an Rng with a pick() method');
  }
  const exclude = options.excludeCallsigns ?? new Set();
  const callsign = pickCallsign(archetypeId, rng, exclude);
  const Ctor = BUILDERS[archetypeId as keyof typeof BUILDERS];
  const props: CrewInit = {
    id: options.id ?? archetypeId,
    x: spawn.x,
    y: spawn.y,
    callsign,
  };
  if (spawn.maxAp !== undefined) props.maxAp = spawn.maxAp;
  if (spawn.maxHp !== undefined) props.maxHp = spawn.maxHp;
  return new Ctor(props);
}
