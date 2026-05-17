import { Crew } from '../Crew.js';
import { FACTION, AP_COST, SALVAGE_PER_IMPROVISED_TURRET } from '../constants.js';
import { Turret } from '../Turret.js';
import type { CrewInit } from '../Crew.js';
import type { World } from '../World.js';

/**
 * Curated callsign pool for the Tech archetype. See `Merc.js` CALLSIGNS for
 * the design rationale. Tech names lean technical / surveillance-adjacent to
 * match the deploy-and-engineer fantasy.
 */
export const CALLSIGNS = Object.freeze([
  'Glitch',
  'Static',
  'Vector',
  'Tessa',
  'Patch',
  'Spark',
  'Wire',
  'Daemon',
  'Quartz',
  'Volt',
  'Nyx',
  'Beacon',
]);

/**
 * Tech — gadget / engineer archetype. Phase-2 perk: **Deploy Turret**.
 *
 * Starts each job with one pre-built turret (`turretReady = true`) that can
 * be dropped onto an adjacent passable tile for `AP_COST.DEPLOY`. The turret
 * is a placed grid entity (`src/game/Turret.js`), not a status effect: once
 * placed it persists until destroyed or the job ends, and the shell drives
 * its `autoFire(world, rng)` at the end of every player turn.
 *
 * `turretReady` flips false on `deployTurret`. M3 adds an `improviseTurret`
 * verb that builds new turrets mid-job by spending salvage; that's tracked
 * on `Crew.inventory.salvage` and not represented here yet.
 *
 * Why a separate `turretReady` flag rather than a count? In Phase 2 a Tech
 * has at most one pre-built turret per job — the "ready" boolean documents
 * intent clearly. M3 will replace this with a salvage-gated counter if and
 * when the design pulls in that direction; we can migrate the flag without
 * breaking the deployTurret contract.
 */
export class Tech extends Crew {
  turretReady: boolean;
  private _improvisedTurretCount: number;

  constructor(props: CrewInit) {
    super({ ...props, glyph: '@' });
    /**
     * The pre-built turret token. Refilled at job start by `Campaign`
     * (M2); for now the debug harness re-instantiates Tech on each scenario
     * rebuild so this stays at `true` until the player deploys.
     */
    this.turretReady = true;
    /** Counter for unique improvised turret ids within a job. */
    this._improvisedTurretCount = 0;
  }

  /**
   * Pre-flight check for placing the pre-built turret on the adjacent tile in
   * direction (dx, dy). Returns `{ ok, reason }` matching the Combat and
   * Razor pattern. Validates:
   *   - integer offsets (data-corruption guard)
   *   - non-zero direction (no-op)
   *   - Chebyshev step ≤ 1 (must be adjacent)
   *   - Tech is alive and has AP for `DEPLOY`
   *   - `turretReady` flag — the pre-built turret hasn't already been dropped
   *   - target tile is in-bounds, passable, and unoccupied
   *
   * Does *not* validate "improvised" salvage-gated turrets — M3 adds that as
   * a separate `improviseTurret(world, dx, dy)` verb that shares the tile
   * checks but gates on `Crew.inventory.salvage` instead of `turretReady`.
   */
  canDeploy(world: World, dx: number, dy: number) {
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
      throw new TypeError(`canDeploy requires integer offsets, got (${dx}, ${dy})`);
    }
    if (!this.alive) {
      return { ok: false, reason: 'dead' };
    }
    if (dx === 0 && dy === 0) {
      return { ok: false, reason: 'no-op' };
    }
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      return { ok: false, reason: 'too-far' };
    }
    if (!this.canAfford(AP_COST.DEPLOY)) {
      return { ok: false, reason: 'insufficient-ap' };
    }
    if (!this.turretReady) {
      return { ok: false, reason: 'no-turret' };
    }
    const tx = this.x + dx;
    const ty = this.y + dy;
    if (!world.grid.inBounds(tx, ty)) {
      return { ok: false, reason: 'out-of-bounds' };
    }
    if (!world.grid.isPassable(tx, ty)) {
      return { ok: false, reason: 'blocked' };
    }
    if (world.entityAt(tx, ty)) {
      return { ok: false, reason: 'occupied' };
    }
    return { ok: true };
  }

  /**
   * Commit a turret deployment. Throws on illegal pre-conditions (no AP burned,
   * no turret consumed). On success: debits DEPLOY AP, flips `turretReady`
   * false, adds a `Turret` entity to the world on the target tile, and
   * returns the new turret so the shell can wire its autofire.
   *
   * The new turret's id is `<tech-id>-turret`; M3 may need a counter once
   * Tech can drop additional improvised turrets. We crash on a duplicate id
   * (World.addEntity already does so) rather than silently overwriting an
   * existing turret — that would be a bug, not a feature.
   */
  deployTurret(world: World, dx: number, dy: number) {
    const check = this.canDeploy(world, dx, dy);
    if (!check.ok) {
      throw new Error(`Illegal deploy for ${this.id}: ${check.reason}`);
    }
    const tx = this.x + dx;
    const ty = this.y + dy;
    this.spendAp(AP_COST.DEPLOY);
    this.turretReady = false;
    const turret = new Turret({
      id: `${this.id}-turret`,
      x: tx,
      y: ty,
      faction: FACTION.PLAYER,
      ownerId: this.id,
    });
    world.addEntity(turret);
    return turret;
  }

  /**
   * Pre-flight check for placing an improvised turret. Same tile validation as
   * `canDeploy`, but gates on `inventory.salvage >= SALVAGE_PER_IMPROVISED_TURRET`
   * instead of the `turretReady` flag.
   */
  canImproviseTurret(world: World, dx: number, dy: number) {
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
      throw new TypeError(`canImproviseTurret requires integer offsets, got (${dx}, ${dy})`);
    }
    if (!this.alive) {
      return { ok: false, reason: 'dead' };
    }
    if (dx === 0 && dy === 0) {
      return { ok: false, reason: 'no-op' };
    }
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      return { ok: false, reason: 'too-far' };
    }
    if (!this.canAfford(AP_COST.DEPLOY)) {
      return { ok: false, reason: 'insufficient-ap' };
    }
    if (!this.inventory) {
      return { ok: false, reason: 'no-inventory' };
    }
    if (this.inventory.salvage < SALVAGE_PER_IMPROVISED_TURRET) {
      return { ok: false, reason: 'insufficient-salvage' };
    }
    const tx = this.x + dx;
    const ty = this.y + dy;
    if (!world.grid.inBounds(tx, ty)) {
      return { ok: false, reason: 'out-of-bounds' };
    }
    if (!world.grid.isPassable(tx, ty)) {
      return { ok: false, reason: 'blocked' };
    }
    if (world.entityAt(tx, ty)) {
      return { ok: false, reason: 'occupied' };
    }
    return { ok: true };
  }

  /**
   * Commit an improvised turret deployment. Costs `AP_COST.DEPLOY` AP and
   * `SALVAGE_PER_IMPROVISED_TURRET` salvage from inventory. Throws on all
   * illegal preconditions before mutating state.
   */
  improviseTurret(world: World, dx: number, dy: number) {
    const check = this.canImproviseTurret(world, dx, dy);
    if (!check.ok) {
      throw new Error(`Illegal improvise for ${this.id}: ${check.reason}`);
    }
    const tx = this.x + dx;
    const ty = this.y + dy;
    this.spendAp(AP_COST.DEPLOY);
    this.inventory!.salvage -= SALVAGE_PER_IMPROVISED_TURRET;
    this._improvisedTurretCount++;
    const turret = new Turret({
      id: `${this.id}-imp-turret-${this._improvisedTurretCount}`,
      x: tx,
      y: ty,
      faction: FACTION.PLAYER,
      ownerId: this.id,
    });
    world.addEntity(turret);
    return turret;
  }
}
