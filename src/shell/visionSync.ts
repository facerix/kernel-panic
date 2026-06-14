import { RUN_STATE } from '../game/Run.js';
import type { Run } from '../game/Run.js';
import type { CyberspaceLayer } from '../game/cyber/CyberspaceLayer.js';
import type { Entity } from '../game/Entity.js';
import type { World } from '../game/World.js';
import type { VisionField } from '../game/Vision.js';
import { cyberLayerOf, isRunScene } from './activeView.js';
import type { ActiveViewScene } from './activeView.js';

export type VisionSyncInput = {
  scene: ActiveViewScene | null;
  meatVision: VisionField;
  cyberVision: VisionField;
};

export type VisionSyncResult = {
  /** When set, caller should record map-seen keys on the active run. */
  recordMeatSeen: boolean;
  /** Visible keys from the meat recompute — pass to `Run.recordMapSeen`. */
  meatVisible?: ReadonlySet<string>;
};

/**
 * Recompute meat (and cyber, when jacked in) vision fields. Returns hints
 * for persistence side-effects the shell owns.
 */
export function syncVisionFields(input: VisionSyncInput): VisionSyncResult {
  const { scene, meatVision, cyberVision } = input;
  if (!scene) return { recordMeatSeen: false };

  let recordMeatSeen = false;
  let meatVisible: ReadonlySet<string> | undefined;

  if (scene.world && scene.player) {
    meatVision.recompute(scene.world.grid, scene.player, undefined, {
      blockers: scene.world.blockerKeys(),
    });
    meatVisible = meatVision.visible;
    if (isRunScene(scene) && scene.state === RUN_STATE.COMBAT) {
      recordMeatSeen = true;
    }
  }

  const layer = cyberLayerOf(scene);
  if (layer) {
    cyberVision.recompute(layer.world.grid, layer.avatar, undefined, {
      blockers: layer.world.blockerKeys(),
    });
    layer.recordSeen(cyberVision.visible);
  }

  return { recordMeatSeen, meatVisible };
}

export type ActiveWorldPair = {
  meatWorld: World | null;
  meatPlayer: Entity | null;
  layer: CyberspaceLayer | null;
};

export function meatWorldPair(scene: ActiveViewScene | null): ActiveWorldPair {
  if (!scene) {
    return { meatWorld: null, meatPlayer: null, layer: null };
  }
  return {
    meatWorld: scene.world,
    meatPlayer: scene.player,
    layer: cyberLayerOf(scene),
  };
}

/** Record map-seen on a combat run after meat vision sync. */
export function applyMeatSeenRecord(run: Run, visible: ReadonlySet<string>): void {
  if (run.state === RUN_STATE.COMBAT) {
    run.recordMapSeen(visible);
  }
}
