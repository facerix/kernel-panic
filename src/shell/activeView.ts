/**
 * P3.M3.6 active-view seam. While the Decker is jacked in, presentation and
 * input look through these helpers at the cyber layer; in Meatspace (and the
 * Hub) they are identity functions.
 *
 * P3.M4.3: the simstim flip splits "the cyber layer exists" (`isJackedIn`)
 * from "the player is currently *viewing/controlling* the cyber layer"
 * (`isCyberView`). Render, input, vision, and HUD follow the active view;
 * body vulnerability and the dual-layer turn orchestration follow layer
 * existence.
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
  /** P3.M4.2/M4.3: the controllable Meatspace crew (partner after a dual jack-in). */
  meatActor?: Entity | null;
  /** P3.M4.3: which layer holds input — `'cyber'` only while flipped to the grid. */
  activeLayer?: 'meat' | 'cyber';
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

/** True while a cyber layer exists (jacked in) — regardless of which side is on screen. */
export function isJackedIn(scene: ActiveViewScene | null): boolean {
  return cyberLayerOf(scene) !== null;
}

/**
 * P3.M4.3: True when the player is currently viewing/controlling Cyberspace —
 * jacked in *and* flipped to the grid. Render/input/vision/HUD key off this;
 * `isJackedIn` (layer existence) drives body vulnerability + turn plumbing.
 */
export function isCyberView(scene: ActiveViewScene | null): boolean {
  return cyberLayerOf(scene) !== null && scene?.activeLayer === 'cyber';
}

/** The controllable Meatspace crew — the partner after a dual jack-in, else the body/operator. */
export function meatActorOf(scene: ActiveViewScene): Entity | null {
  return scene.meatActor ?? scene.player;
}

export function activeWorldOf(scene: ActiveViewScene): World | null {
  return isCyberView(scene) ? cyberLayerOf(scene)!.world : scene.world;
}

export function activeActorOf(scene: ActiveViewScene): Entity | null {
  return isCyberView(scene) ? cyberLayerOf(scene)!.avatar : meatActorOf(scene);
}

export function pickActiveVisionField(
  scene: ActiveViewScene | null,
  meatVision: VisionField,
  cyberVisionField: VisionField
): VisionField {
  return isCyberView(scene) ? cyberVisionField : meatVision;
}

export function activeTileset(scene: ActiveViewScene | null): TilesetId {
  return isCyberView(scene) ? 'cyber' : 'meat';
}
