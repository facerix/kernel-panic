import { Crew } from '../Crew.js';
import { FACTION, AP_COST } from '../constants.js';
import { EVENT } from '../events.js';

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
 * Stealth lifecycle:
 *   slide() → this.stealthed = true
 *   refreshAp() → this.stealthed = false   (turn rotation clears it)
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
  constructor(props = {}) {
    super({ faction: FACTION.PLAYER, glyph: '@', ...props });
  }

  /**
   * Pre-flight check. Returns `{ ok, reason }`. Crashes on non-integer
   * offsets (data-corruption guard, mirrors `World.canMoveEntity`).
   */
  canSlide(world, dx, dy) {
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
      throw new TypeError(`canSlide requires integer offsets, got (${dx}, ${dy})`);
    }
    if (dx === 0 && dy === 0) {
      return { ok: false, reason: 'no-op' };
    }
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      return { ok: false, reason: 'too-far' };
    }
    if (!this.canAfford(AP_COST.SLIDE)) {
      return { ok: false, reason: 'insufficient-ap' };
    }
    if (!this.alive) {
      return { ok: false, reason: 'dead' };
    }

    const stepX = this.x + dx;
    const stepY = this.y + dy;
    const landX = this.x + 2 * dx;
    const landY = this.y + 2 * dy;

    // Both the intermediate tile *and* the landing tile must be clear floor
    // and unoccupied. Slide is two consecutive moves under the hood — if you
    // can't legally walk through the first tile, you can't slide over it.
    if (!world.grid.isPassable(stepX, stepY)) {
      return { ok: false, reason: 'blocked-step' };
    }
    if (world.entityAt(stepX, stepY)) {
      return { ok: false, reason: 'occupied-step' };
    }
    if (!world.grid.isPassable(landX, landY)) {
      return { ok: false, reason: 'blocked' };
    }
    if (world.entityAt(landX, landY)) {
      return { ok: false, reason: 'occupied' };
    }
    return { ok: true };
  }

  /**
   * Commit a slide. Throws on illegal pre-conditions (no AP burned). On
   * success: debits SLIDE AP, mutates position to the landing tile, sets
   * `stealthed = true`, and emits `entity:moved` so vision/AI listeners see
   * the post-slide state. **Does not** emit `noise` — the perk is silent.
   */
  slide(world, dx, dy) {
    const check = this.canSlide(world, dx, dy);
    if (!check.ok) {
      throw new Error(`Illegal slide for ${this.id}: ${check.reason}`);
    }
    const from = { x: this.x, y: this.y };
    this.spendAp(AP_COST.SLIDE);
    this.x += 2 * dx;
    this.y += 2 * dy;
    this.stealthed = true;
    world.events?.emit(EVENT.ENTITY_MOVED, {
      entity: this,
      from,
      to: { x: this.x, y: this.y },
    });
  }

  /**
   * Override AP refresh to also clear the slide stealth flag. Called by
   * `TurnQueue.endTurn` on the incoming faction's entities, so stealth set
   * on the player's turn N persists through the corp turn between N and N+1
   * and clears as turn N+1 begins.
   */
  refreshAp() {
    super.refreshAp();
    this.stealthed = false;
  }
}
