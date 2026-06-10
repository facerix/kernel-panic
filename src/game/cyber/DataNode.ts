/**
 * P3.M3.4 — DataNode: the slice target the Decker's avatar came for.
 *
 * Interacting adds the actor's `intrusionStrength` to `sliceProgress`; the
 * node is sliced once progress reaches `sliceDifficulty` (2/3/4 by contract
 * difficulty). This is scope decision #4 made concrete — intrusion strength
 * is *the* stat that moves the objective. Only the avatar can slice
 * (capability sniff on `isCyberAvatar`, same rule as `EntryPort`: the Decker
 * body also carries `intrusionStrength`, so the stat must not be the sniff).
 *
 * Slicing is silent — ICE detection (P3.M3.5), not the slice itself, raises
 * the cyber alarm. `sliceProgress` is raw (not clamped to the threshold) so
 * persisted state never loses information.
 */
import {
  Interactable,
  type InteractableInit,
  type InteractResult,
} from '../entities/Interactable.js';
import { AP_COST, DATA_NODE_GLYPH, type ContractDifficulty } from '../constants.js';
import type { Entity } from '../Entity.js';
import type { World } from '../World.js';

/** Intrusion needed to slice a node, by contract difficulty. */
const SLICE_DIFFICULTY: Record<ContractDifficulty, number> = Object.freeze({
  standard: 2,
  elevated: 3,
  critical: 4,
});

export function sliceDifficultyFor(difficulty: ContractDifficulty): number {
  const threshold = SLICE_DIFFICULTY[difficulty];
  if (threshold === undefined) {
    throw new RangeError(`sliceDifficultyFor: unknown contract difficulty "${difficulty}"`);
  }
  return threshold;
}

export interface DataNodeInit extends Omit<InteractableInit, 'glyph' | 'label'> {
  label?: string;
  /** Intrusion threshold to slice. Required — derived from contract difficulty. */
  sliceDifficulty: number;
  sliceProgress?: number;
}

/** P2.7.M6.2: data-node snapshot `extra`. */
export type DataNodeSnapshot = {
  label: string;
  sliceDifficulty: number;
  sliceProgress: number;
};

export class DataNode extends Interactable {
  sliceDifficulty: number;
  sliceProgress: number;

  constructor({ label = 'Data node', sliceDifficulty, sliceProgress = 0, ...props }: DataNodeInit) {
    if (!Number.isInteger(sliceDifficulty) || sliceDifficulty <= 0) {
      throw new RangeError(
        `DataNode sliceDifficulty must be a positive integer, got ${sliceDifficulty}`
      );
    }
    if (!Number.isInteger(sliceProgress) || sliceProgress < 0) {
      throw new RangeError(
        `DataNode sliceProgress must be a non-negative integer, got ${sliceProgress}`
      );
    }
    const sliced = sliceProgress >= sliceDifficulty;
    super({
      ...props,
      glyph: DATA_NODE_GLYPH,
      label,
      secured: sliced,
      armed: !sliced,
    });
    this.sliceDifficulty = sliceDifficulty;
    this.sliceProgress = sliceProgress;
  }

  get sliced(): boolean {
    return this.sliceProgress >= this.sliceDifficulty;
  }

  override interact(_world: World, actor: Entity): InteractResult {
    if (this.sliced) {
      return { ok: false, reason: 'already-sliced', message: `${this.label}: already sliced.` };
    }
    const check = this.canInteract(actor);
    if (!check.ok) {
      return { ok: false, reason: check.reason, message: `${this.label}: ${check.reason}.` };
    }
    if ((actor as { isCyberAvatar?: boolean }).isCyberAvatar !== true) {
      return {
        ok: false,
        reason: 'not-an-avatar',
        message: `${this.label}: only the avatar can slice.`,
      };
    }
    actor.spendAp(AP_COST.INTERACT);
    // The sniff above guarantees a CyberAvatar, which validates the stat.
    this.sliceProgress += (actor as unknown as { intrusionStrength: number }).intrusionStrength;
    if (this.sliced) {
      this.secured = true;
      this.armed = false;
      return { ok: true, message: `${this.label} sliced.` };
    }
    return {
      ok: true,
      message: `${this.label}: intrusion ${this.sliceProgress}/${this.sliceDifficulty}.`,
    };
  }
}
