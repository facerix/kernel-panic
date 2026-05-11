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

import { Merc } from './Merc.js';
import { Razor } from './Razor.js';

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

export function isArchetypeId(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BUILDERS, value);
}

/**
 * Instantiate the player entity for `id` at the given spawn tile.
 *
 * `spawn.maxAp` is honoured (Run uses the project-wide 4-AP default); other
 * Entity options pass through unchanged. Throws on unknown archetype or a
 * malformed spawn — the rest of the engine would corrupt silently with a
 * partial player object.
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
