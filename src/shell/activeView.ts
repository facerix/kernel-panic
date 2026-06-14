/**
 * P3.M3.6 active-view seam. While the Decker is jacked in, presentation and
 * input look through these helpers at the cyber layer; in Meatspace (and the
 * Hub) they are identity functions.
 */
import type { CyberspaceLayer } from '../game/cyber/CyberspaceLayer.js';
import type { Run } from '../game/Run.js';
import type { Entity } from '../game/Entity.js';
import type { World } from '../game/World.js';
import type { VisionField } from '../game/Vision.js';
import type { TilesetId } from '../render/palette.js';

/** Minimal scene shape for active-view resolution (Run or Campaign hub scene). */
export type ActiveViewScene = {
  world: World | null;
  player: Entity | null;
  cyberspace?: Run['cyberspace'];
  state?: Run['state'] | string | null;
} & Partial<Pick<Run, 'archetype'>>;

export function isRunScene(
  scene: ActiveViewScene
): scene is ActiveViewScene & Pick<Run, 'archetype'> {
  return 'archetype' in scene && scene.archetype !== undefined;
}

export function cyberLayerOf(scene: ActiveViewScene | null): CyberspaceLayer | null {
  if (!scene || !isRunScene(scene)) return null;
  return scene.cyberspace?.phase === 'active' ? scene.cyberspace.layer : null;
}

export function isJackedIn(scene: ActiveViewScene | null): boolean {
  return cyberLayerOf(scene) !== null;
}

export function activeWorldOf(scene: ActiveViewScene): World | null {
  return cyberLayerOf(scene)?.world ?? scene.world;
}

export function activeActorOf(scene: ActiveViewScene): Entity | null {
  return cyberLayerOf(scene)?.avatar ?? scene.player;
}

export function pickActiveVisionField(
  scene: ActiveViewScene | null,
  meatVision: VisionField,
  cyberVisionField: VisionField
): VisionField {
  return isJackedIn(scene) ? cyberVisionField : meatVision;
}

export function activeTileset(scene: ActiveViewScene | null): TilesetId {
  return isJackedIn(scene) ? 'cyber' : 'meat';
}
