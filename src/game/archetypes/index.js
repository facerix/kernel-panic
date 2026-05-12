/**
 * Archetype registry.
 *
 * `Merc` and `Razor` live as classes in their own files (combat/perk logic
 * stays close to the entity). This module is the *metadata* layer those
 * classes don't carry: display name, blurb, perk id, and the key that fires
 * the perk in the current keymap. The three consumers:
 *
 *   - `<character-select>`        reads `ARCHETYPES` to render the modal
 *   - `<key-help>`                reads `ARCHETYPES[id].perkKey` for labels
 *   - `Run.setArchetype / Run`    calls `buildPlayer` to instantiate a player
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

/**
 * Display order is also the default-focus order in <character-select>.
 * Merc first so new players hit the simpler ranged archetype on first load.
 */
export const ARCHETYPE_IDS = Object.freeze(['merc', 'razor']);

export const ARCHETYPES = Object.freeze({
  merc: Object.freeze({
    id: 'merc',
    name: 'MERC',
    blurb: 'Ranged specialist. Trades position for line-of-fire control.',
    perks: Object.freeze(['vault']),
    perkKey: 'v',
    perkLabel: 'VAULT — hop cover & fire',
  }),
  razor: Object.freeze({
    id: 'razor',
    name: 'RAZOR',
    blurb: 'Stealth / melee. Cuts angles drones can’t cover.',
    perks: Object.freeze(['slide']),
    perkKey: 't',
    perkLabel: 'SLIDE — 2-tile silent dash',
  }),
});

const BUILDERS = Object.freeze({
  merc: Merc,
  razor: Razor,
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
});

export function isArchetypeId(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BUILDERS, value);
}

/**
 * Pick a callsign for `archetypeId` using `rng`, excluding any names in
 * `excludeCallsigns` (a Set). Throws if the pool is empty after filtering —
 * we'd rather crash than silently hand back a duplicate or a placeholder.
 * Pure helper so M2's `Campaign.buildCrew` can call it directly when seeding
 * the starter trio.
 */
export function pickCallsign(archetypeId, rng, excludeCallsigns = new Set()) {
  if (!isArchetypeId(archetypeId)) {
    throw new Error(`pickCallsign: unknown archetype "${archetypeId}"`);
  }
  if (!rng || typeof rng.pick !== 'function') {
    throw new TypeError('pickCallsign requires an Rng with a pick() method');
  }
  if (!(excludeCallsigns instanceof Set)) {
    throw new TypeError('pickCallsign: excludeCallsigns must be a Set');
  }
  const pool = CALLSIGNS_BY_ARCHETYPE[archetypeId];
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
 * Build a named crew member. The Phase-2 replacement for `buildPlayer`:
 * threads a campaign-scoped `Rng` so the callsign is reproducible from the
 * campaign seed, and accepts an `excludeCallsigns` Set so callers
 * (`Campaign.buildCrew`, future recruitment in M6) can dedupe against
 * campaign history.
 *
 * `buildPlayer` stays as a thin back-compat wrapper around this function for
 * the debug harness and existing `Run.js` call sites; M2 will swap those over
 * and delete `buildPlayer`.
 */
export function buildCrewMember(archetypeId, spawn, rng, options = {}) {
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
  const Ctor = BUILDERS[archetypeId];
  const props = {
    id: options.id ?? archetypeId,
    x: spawn.x,
    y: spawn.y,
    callsign,
  };
  if (spawn.maxAp !== undefined) props.maxAp = spawn.maxAp;
  if (spawn.maxHp !== undefined) props.maxHp = spawn.maxHp;
  return new Ctor(props);
}

/**
 * Instantiate the player entity for `id` at the given spawn tile.
 *
 * `spawn.maxAp` is honoured (Run uses the project-wide 4-AP default); other
 * Entity options pass through unchanged. Throws on unknown archetype or a
 * malformed spawn — the rest of the engine would corrupt silently with a
 * partial player object.
 *
 * **Deprecated in M1, removed in M2.** Kept while `Run.js` still calls
 * `#makePlayer` without a campaign Rng. Constructs the entity without a
 * callsign so existing tests and the debug harness keep working unchanged.
 */
export function buildPlayer(id, spawn) {
  if (!isArchetypeId(id)) {
    throw new Error(`buildPlayer: unknown archetype "${id}"`);
  }
  if (!spawn || typeof spawn !== 'object') {
    throw new TypeError('buildPlayer: spawn must be an object with finite {x, y}');
  }
  if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.y)) {
    throw new TypeError(`buildPlayer: spawn must have finite x,y; got (${spawn.x}, ${spawn.y})`);
  }
  const Ctor = BUILDERS[id];
  const props = {
    id,
    x: spawn.x,
    y: spawn.y,
  };
  if (spawn.maxAp !== undefined) props.maxAp = spawn.maxAp;
  if (spawn.maxHp !== undefined) props.maxHp = spawn.maxHp;
  return new Ctor(props);
}
