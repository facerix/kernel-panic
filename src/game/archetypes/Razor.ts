import { Crew } from '../Crew.js';
import {
  HEAVY_MELEE_DAMAGE,
  RAZOR_DEFAULT_HIT_CHANCE,
  RAZOR_DEFAULT_DODGE_CHANCE,
} from '../constants.js';
import { canSlideTwoTiles, slideTwoTiles } from '../slide.js';
import type { CrewInit } from '../Crew.js';
import type { World } from '../World.js';

/**
 * Curated callsign pool for the Razor archetype. See `Merc.js` CALLSIGNS for
 * the design rationale. Razor names skew quieter / sharper to match the
 * stealth-melee tone.
 */
export const CALLSIGNS = Object.freeze([
  'Cipher',
  'Wren',
  'Mantis',
  'Saint',
  'Pale',
  'Sable',
  'Sliver',
  'Hush',
  'Mercury',
  'Lark',
  'Smoke',
  'Veil',
]);

/**
 * Razor — melee/stealth archetype. Phase-1 perk: **Slide**.
 *
 * Slide repositions the Razor 2 tiles in any cardinal/diagonal direction for
 * 2 AP, *and* sets a stealth flag so drones need Chebyshev adjacency to spot
 * her until her next AP refresh. The intermediate tile and landing tile must
 * both be passable (FLOOR) and unoccupied — Slide goes *through* terrain, not
 * over it (that's Vault's job). Walls and cover both block.
 *
 * The slide is silent: it bypasses `World.moveEntity`'s default `noise`
 * emission. It still emits `entity:moved` so vision and AI hooks see the
 * post-slide state — but no NOISE event, so a sentry doesn't latch onto the
 * tiles she passed through. That asymmetry is the whole point of the perk.
 *
 * Stealth lifecycle (P3.5.M1: now on the generic effect channel):
 *   slide() → this.stealthed = true   (arms STATUS_EFFECT.STEALTH, duration 1)
 *   refreshAp() → base Entity.tickEffects() clears it one refresh later
 *
 * `refreshAp` runs on the incoming-faction's entities at `TurnQueue.endTurn`,
 * so stealth holds through the corp turn that immediately follows a Slide and
 * clears at the start of the player's next turn — exactly "for the rest of
 * this turn" as the milestone plan describes it.
 *
 * Design note — `slide → wait → slide` re-cloaking: a second slide in the
 * same turn re-arms `stealthed = true` (the first slide's flag was about to
 * clear at refreshAp anyway). Not a bug, just a lifecycle to be aware of.
 */
export class Razor extends Crew {
  override archetype = 'Razor';

  override get meleeDamage(): number {
    return HEAVY_MELEE_DAMAGE;
  }

  constructor(props: CrewInit) {
    super({
      baseHitChance: RAZOR_DEFAULT_HIT_CHANCE,
      baseDodgeChance: RAZOR_DEFAULT_DODGE_CHANCE,
      ...props,
      glyph: '@',
    });
  }

  /**
   * Pre-flight check. Returns `{ ok, reason }`. Crashes on non-integer
   * offsets (data-corruption guard, mirrors `World.canMoveEntity`).
   */
  canSlide(world: World, dx: number, dy: number) {
    return canSlideTwoTiles(world, this, dx, dy);
  }

  /**
   * Commit a slide. Throws on illegal pre-conditions (no AP burned). On
   * success: debits SLIDE AP, mutates position to the landing tile, sets
   * `stealthed = true`, and emits `entity:moved` so vision/AI listeners see
   * the post-slide state. **Does not** emit `noise` — the perk is silent.
   */
  slide(world: World, dx: number, dy: number) {
    const check = this.canSlide(world, dx, dy);
    if (!check.ok) {
      throw new Error(`Illegal slide for ${this.id}: ${check.reason}`);
    }
    slideTwoTiles(world, this, dx, dy);
    this.stealthed = true;
  }
}
