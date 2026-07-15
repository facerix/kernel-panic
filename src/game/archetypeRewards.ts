/**
 * Score-unlockable archetype reward catalog (P3.5.M7).
 *
 * Sibling to `items.ts`'s `SCOREABLE_ITEMS` — but an archetype reward has no
 * `cost`/`scope`/`needsTarget`, since it isn't a shop purchase: winning it
 * unlocks the archetype for every future stat roll (`crewStatRoll.ts`'s
 * `deriveArchetype`), campaign-wide, forever. `Campaign.ts`'s `pickScorePayload`
 * draws from a pool merging this catalog with `SCOREABLE_ITEMS` — a clean Score
 * nets either a new item or a new archetype, never both.
 *
 * `flavor` reads as "what got reverse-engineered" — matching the
 * `SCOREABLE_ITEMS` convention (e.g. Monoblade's "a monomolecular blade
 * schematic") — not as a description of the archetype's kit. Chimera's stays
 * deliberately ambiguous per that archetype's unresolved human-or-machine
 * fiction (see `archetypes/Chimera.ts`).
 */
import type { CrewArchetypeId } from './Run.js';

export type ArchetypeReward = {
  id: CrewArchetypeId;
  label: string;
  flavor: string;
};

export const SCOREABLE_ARCHETYPES: readonly ArchetypeReward[] = Object.freeze([
  Object.freeze({
    id: 'berserk',
    label: 'Combat-Stim Rig',
    flavor:
      'A black-clinic surge-stim rig, seized mid-titration — the crash it demands is baked into the chemistry.',
  }),
  Object.freeze({
    id: 'adept',
    label: 'Psychic Interface Cradle',
    flavor:
      'A cortical interface cradle for directed will-projection, still humming with someone else’s trained discipline.',
  }),
  Object.freeze({
    id: 'chimera',
    label: 'Nanite Culture Sample',
    flavor:
      'A sealed nanite culture sample — self-sustaining, self-replicating, and utterly silent on whether it was ever meant for a human host.',
  }),
]);

/** Frozen id set for the archetype-reward pool — O(1) membership checks. */
export const SCOREABLE_ARCHETYPE_IDS: ReadonlySet<CrewArchetypeId> = Object.freeze(
  new Set(SCOREABLE_ARCHETYPES.map(reward => reward.id))
) as ReadonlySet<CrewArchetypeId>;
