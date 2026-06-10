/**
 * P3.M3.3 — Exit port: the Cyberspace door back into Meatspace.
 *
 * Anchored at the avatar's entry point on the cyber grid. The avatar (and
 * only the avatar — capability sniff on `isCyberAvatar`) interacts to route
 * out: spends interact AP and emits `EVENT.JACK_OUT` on the *cyber* bus.
 * `Run.jackOut()` listens, latches the objective outcome, and resolves the
 * layer (voluntary jack-out pulled forward from P3.M4.6; scope decision #2).
 *
 * Unlike the meat-side `JackInPoint`, the port does not latch on use — the
 * resolve latch lives on `Run.cyberspace` (the layer is torn down with it).
 */
import {
  Interactable,
  type InteractableInit,
  type InteractResult,
} from '../entities/Interactable.js';
import { AP_COST, ENTRY_PORT_GLYPH } from '../constants.js';
import { EVENT } from '../events.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

export interface EntryPortInit extends Omit<InteractableInit, 'glyph' | 'label'> {
  label?: string;
}

/** P2.7.M6.2: exit-port snapshot `extra`. */
export type EntryPortSnapshot = {
  label: string;
};

export class EntryPort extends Interactable {
  constructor({ label = 'Exit port', ...props }: EntryPortInit) {
    super({ ...props, glyph: ENTRY_PORT_GLYPH, label });
  }

  override interact(world: World, actor: Entity): InteractResult {
    const check = this.canInteract(actor);
    if (!check.ok) {
      return { ok: false, reason: check.reason, message: `${this.label}: ${check.reason}.` };
    }
    if ((actor as { isCyberAvatar?: boolean }).isCyberAvatar !== true) {
      return {
        ok: false,
        reason: 'not-an-avatar',
        message: `${this.label}: only the avatar can route out.`,
      };
    }
    actor.spendAp(AP_COST.INTERACT);
    world.events?.emit(EVENT.JACK_OUT, { port: this, actor });
    return { ok: true, message: `${this.label}: connection dropped — jacking out.` };
  }
}
