/**
 * P3.M3.2 — Jack-in point: the Meatspace door into Cyberspace.
 *
 * Placed for `data-node-slice` contracts. Only a Decker can link (capability
 * sniff on `canJackIn`); a successful link spends interact AP, latches
 * `linked`, and emits `EVENT.JACK_IN` exactly once — `Run` listens and spawns
 * the Cyberspace layer (P3.M3.3). Re-interacting a linked port is *redundant
 * input*, not corruption: it returns a logged refusal and never throws.
 *
 * The id is namespaced `jack-in-*` deliberately — `Run`'s TERMINAL_SLICE
 * satisfaction counts terminals by the `/^terminal-\d+$/` id pattern, and this
 * port must never satisfy a slice quota.
 */
import { Interactable, type InteractableInit, type InteractResult } from './Interactable.js';
import { AP_COST, JACK_IN_GLYPH } from '../constants.js';
import { EVENT } from '../events.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

export interface JackInPointInit extends Omit<InteractableInit, 'glyph' | 'label'> {
  label?: string;
  linked?: boolean;
  burned?: boolean;
}

/** P2.7.M6.2: JackInPoint snapshot `extra`. */
export type JackInPointSnapshot = {
  label: string;
  linked: boolean;
  burned: boolean;
};

export class JackInPoint extends Interactable {
  linked: boolean;
  /**
   * P3.M3 S5: latched by `Run.jackOut()` once the avatar routes back out —
   * the link is dead and re-jack-in is refused with burn flavor. A burned
   * port is always a linked port (`burn()` enforces it).
   */
  burned: boolean;

  constructor({
    label = 'Jack-in port',
    linked = false,
    burned = false,
    ...props
  }: JackInPointInit) {
    super({
      ...props,
      glyph: JACK_IN_GLYPH,
      label,
      secured: linked,
      armed: !linked,
    });
    if (burned && !linked) {
      throw new Error(`JackInPoint ${props.id}: burned without linked is corrupt state`);
    }
    this.linked = !!linked;
    this.burned = !!burned;
  }

  /** Kill the link after jack-out. Burning an unlinked port is corrupt state. */
  burn(): void {
    if (!this.linked) {
      throw new Error(`JackInPoint ${this.id}: cannot burn an unlinked port`);
    }
    this.burned = true;
  }

  override interact(world: World, actor: Entity): InteractResult {
    if (this.burned) {
      return {
        ok: false,
        reason: 'link-burned',
        message: `${this.label}: LINK BURNED — the connection is dead.`,
      };
    }
    if (this.linked) {
      return { ok: false, reason: 'already-linked', message: `${this.label}: already linked.` };
    }
    const check = this.canInteract(actor);
    if (!check.ok) {
      return { ok: false, reason: check.reason, message: `${this.label}: ${check.reason}.` };
    }
    if ((actor as { canJackIn?: boolean }).canJackIn !== true) {
      return {
        ok: false,
        reason: 'no-cyberdeck',
        message: `${this.label}: no cyberdeck — only a Decker can jack in.`,
      };
    }
    actor.spendAp(AP_COST.INTERACT);
    this.linked = true;
    this.secured = true;
    this.armed = false;
    world.events?.emit(EVENT.JACK_IN, { point: this, actor });
    return { ok: true, message: `${this.label}: link established.` };
  }
}
