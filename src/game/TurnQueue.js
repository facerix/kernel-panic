import { EVENT } from './events.js';

/**
 * Faction-based turn queue. The blueprint specifies "purely turn-based" —
 * V1 keeps it simple: a fixed faction order (player → corp), with each
 * faction getting one full activation per slot. Per-entity initiative can
 * layer on later if we need it.
 *
 * `endTurn` refreshes AP for the *incoming* faction so the just-finished
 * faction's leftover AP doesn't carry over (matches the blueprint's
 * AP-per-turn budget model). When `world.events` is present, also emits
 * `turn:ended` *after* the AP refresh so subscribers see the post-state.
 */
export class TurnQueue {
  constructor(factionOrder) {
    if (!Array.isArray(factionOrder) || factionOrder.length === 0) {
      throw new TypeError('TurnQueue requires a non-empty factionOrder array');
    }
    this.factionOrder = [...factionOrder];
    this.index = 0;
    this.turnNumber = 1;
  }

  get currentFaction() {
    return this.factionOrder[this.index];
  }

  endTurn(world) {
    const previous = this.currentFaction;
    this.index = (this.index + 1) % this.factionOrder.length;
    if (this.index === 0) {
      this.turnNumber += 1;
    }
    const incoming = this.currentFaction;
    for (const e of world.entities.values()) {
      if (e.alive && e.faction === incoming) {
        e.refreshAp();
      }
    }
    world.events?.emit(EVENT.TURN_ENDED, {
      previous,
      next: incoming,
      turn: this.turnNumber,
    });
  }
}
