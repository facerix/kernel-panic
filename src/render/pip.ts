/**
 * P3.M3.7 — Jacked-in body CCTV (PIP) helpers.
 *
 * Pure presentation seam: the shell paints meatspace in a small overlay while
 * the Decker is on the grid. M4 will swap `pipFollowTargetOf` / `pipWorldOf`
 * to track whichever layer is *inactive* after the simstim flip.
 */
import { formatHpSegments } from './combatHud.js';
import { cameraFor, type Camera, type Viewport } from './frame.js';
import type { Entity } from '../game/Entity.js';
import type { World } from '../game/World.js';

/** Matches `#pip-canvas` pixel size at `PIP_CELL_SIZE` (160×100). */
export const PIP_VIEWPORT_TILES = Object.freeze({ width: 16, height: 10 });
export const PIP_CELL_SIZE = 10;

export type PipHudRow = {
  text: string;
  anchor: 'top-left' | 'top-right';
  row?: number;
  color?: string;
  glowColor?: string;
  accentColor?: string;
  uppercase?: boolean;
  segments?: readonly { text: string; color: string; glowColor?: string }[];
};

export type PipCyberspacePhase = 'dormant' | 'active' | 'resolved';

export type PipRunView = {
  cyberspace?: { phase: PipCyberspacePhase } | null;
  world?: World | null;
  player?: Entity | null;
};

export function shouldShowPip(run: PipRunView | null | undefined): boolean {
  return run?.cyberspace?.phase === 'active' && run.world != null && run.player != null;
}

/** Inactive layer world while jacked in — meat body feed until M4 flip. */
export function pipWorldOf(run: PipRunView | null | undefined): World | null {
  return shouldShowPip(run) ? (run!.world ?? null) : null;
}

export function pipFollowTargetOf(run: PipRunView | null | undefined): Entity | null {
  return shouldShowPip(run) ? (run!.player ?? null) : null;
}

export function pipViewport(): Viewport {
  return { width: PIP_VIEWPORT_TILES.width, height: PIP_VIEWPORT_TILES.height };
}

/**
 * Center on the body, then clamp so the viewport stays inside the grid when
 * the jack-in terminal is near a map edge.
 */
export function pipCameraFor(
  body: Entity,
  world: World,
  viewport: Viewport = pipViewport()
): Camera {
  const camera = cameraFor(body, viewport);
  const maxX = Math.max(0, world.grid.width - viewport.width);
  const maxY = Math.max(0, world.grid.height - viewport.height);
  return {
    ...camera,
    x: Math.max(0, Math.min(camera.x, maxX)),
    y: Math.max(0, Math.min(camera.y, maxY)),
  };
}

export function pipChrome(body: Entity): PipHudRow[] {
  const hpText = formatHpSegments({ hp: body.hp, maxHp: body.maxHp, label: 'BODY' });
  return [
    {
      text: '// CCTV //',
      anchor: 'top-left',
      uppercase: true,
      color: '#9ff3da',
      glowColor: '#6ae8c8',
      accentColor: 'rgba(0, 217, 165, 0.5)',
    },
    {
      text: hpText,
      anchor: 'top-right',
      color: '#6ae8c8',
      glowColor: '#6ae8c8',
      accentColor: 'rgba(0, 217, 165, 0.5)',
    },
  ];
}
