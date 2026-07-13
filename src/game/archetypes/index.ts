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
import { Decker, CALLSIGNS as DECKER_CALLSIGNS } from './Decker.js';
import { Berserk, CALLSIGNS as BERSERK_CALLSIGNS } from './Berserk.js';
import type { Rng } from '../../rng.js';
import type { FactionId } from '../constants.js';
import type { CrewInit } from '../Crew.js';

export type Archetype = Merc | Razor | Tech | Decker | Berserk;

/**
 * Display order is also the starter crew order in `Campaign.buildCrew`.
 * Merc first so new players hit the simpler ranged archetype on first load;
 * Tech last since its gadget loop is the most involved kit to learn.
 *
 * The **Decker is deliberately absent** (P3.M2): it is a mid-campaign narrative
 * recruit, never a starter pick or selector option. Its metadata still lives in
 * `ARCHETYPES`/`BUILDERS` so `buildCrewMember('decker', …)` and snapshot
 * round-trips work — it just isn't offered through the normal selection paths.
 */
export const ARCHETYPE_IDS = Object.freeze(['merc', 'razor', 'tech']);

/**
 * Weighted archetype pool for recruitment. 40% Merc, 40% Razor, 20% Tech.
 * Expressed as a flat array so `rng.pick()` gives the correct distribution.
 * The Decker is **not** in this pool — normal random recruitment must never
 * roll one; it joins only through the Act-2 narrative beat (P3.M2 / P3.M1).
 */
export const RECRUIT_ARCHETYPE_POOL = Object.freeze([
  'merc',
  'merc',
  'razor',
  'razor',
  'tech',
  'berserk',
]);

/**
 * All three archetypes share a single perk key (`x`) — the keymap collapses
 * vault/slide/deploy into one `MODE.AIM` / `aimKind: 'special'` flow that dispatches by
 * archetype at the intent layer (`applyIntent.doSpecial`). The per-archetype
 * `perkLabel` is what `<key-help>` surfaces in the combat intro text, so
 * the visible verb stays archetype-specific even though the keystroke doesn't.
 */
export const ARCHETYPES = Object.freeze({
  merc: Object.freeze({
    id: 'merc',
    name: 'MERC',
    blurb: 'Long-range pressure. Break creates space under fire.',
    perks: Object.freeze(['vault']),
    perkName: 'BREAK',
    perkLabel: 'Mercs can BREAK: hop cover / knock enemies back',
    perkAim: 'directional',
  }),
  razor: Object.freeze({
    id: 'razor',
    name: 'RAZOR',
    blurb: 'Close-quarters ghost. Slide in, cut out.',
    perks: Object.freeze(['slide']),
    perkName: 'SLIDE',
    perkLabel: 'Razors can SLIDE: dash 2 tiles and go silent for a turn',
    perkAim: 'directional',
  }),
  tech: Object.freeze({
    id: 'tech',
    name: 'TECH',
    blurb: "Field engineer. Turrets hold what you can't.",
    perks: Object.freeze(['deploy']),
    perkName: 'DEPLOY',
    perkLabel: 'Techs can DEPLOY: place a turret that will fire on enemies',
    perkAim: 'directional',
  }),
  decker: Object.freeze({
    id: 'decker',
    name: 'DECKER',
    blurb: 'Console cowboy. Fries a room with an EMP; jacks into Cyberspace.',
    perks: Object.freeze(['emp']),
    perkName: 'EMP',
    perkLabel: 'Deckers can EMP: stun everyone around you for a turn',
    // Self-centered blast — the perk key fires it immediately, no aim step.
    perkAim: 'self',
  }),
  berserk: Object.freeze({
    id: 'berserk',
    name: 'BERSERK',
    blurb: 'Volatile assault. Surge hard, then endure the crash.',
    perks: Object.freeze(['surge']),
    perkName: 'SURGE',
    perkLabel: 'Berserks can SURGE: gain damage and AP before crashing',
    perkAim: 'self',
  }),
});

export type ArchetypeInfo = (typeof ARCHETYPES)[keyof typeof ARCHETYPES];

/** Per-archetype perk aim requirement — see `keymap.PerkAim`. */
export type PerkAim = 'directional' | 'self';

/**
 * Resolve how an archetype's `special` perk aims. Accepts either the lowercase
 * registry id (`'decker'`) or the class-cased `Crew.archetype` (`'Decker'`).
 * Throws on an unknown archetype — a crew member always has a registered
 * archetype, so an unknown one is a wiring bug, not a value to paper over.
 */
export function perkAimForArchetype(archetype: string): PerkAim {
  const key = archetype.toLowerCase();
  const info = ARCHETYPES[key as keyof typeof ARCHETYPES];
  if (!info) {
    throw new Error(`perkAimForArchetype: unknown archetype "${archetype}"`);
  }
  return info.perkAim as PerkAim;
}

const BUILDERS = Object.freeze({
  merc: Merc,
  razor: Razor,
  tech: Tech,
  decker: Decker,
  berserk: Berserk,
});

/**
 * Per-archetype callsign pool, mirrored from each archetype module. Kept as a
 * single map so `buildCrewMember` doesn't need a per-archetype branch — and
 * so `Campaign.buildCrew` can iterate archetypes and dedupe across the
 * union in one pass.
 */
export const CALLSIGNS_BY_ARCHETYPE = Object.freeze({
  merc: MERC_CALLSIGNS,
  razor: RAZOR_CALLSIGNS,
  tech: TECH_CALLSIGNS,
  decker: DECKER_CALLSIGNS,
  berserk: BERSERK_CALLSIGNS,
});

export function isArchetypeId(value: string) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BUILDERS, value);
}

/**
 * Pick a callsign for `archetypeId` using `rng`, excluding any names in
 * `excludeCallsigns` (a Set). Throws if the pool is empty after filtering —
 * we'd rather crash than silently hand back a duplicate or a placeholder.
 * Pure helper so `Campaign.buildCrew` can call it directly when seeding
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
 * Set so callers (`Campaign.buildCrew`, `Campaign.generateRecruits`) can dedupe
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
