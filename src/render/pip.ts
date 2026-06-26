/**
 * P3.M3.7 / P3.M4.5 — simstim PIP (picture-in-picture of the *inactive* layer).
 *
 * While the Decker is jacked in, the shell paints the layer the player is **not**
 * currently driving into a small read-only overlay:
 *   - viewing Cyberspace  → PIP shows Meatspace (the body/partner CCTV feed)
 *   - viewing Meatspace    → PIP shows Cyberspace (the avatar on the grid)
 *
 * M3.7 shipped the meat-only feed; M4.5 generalizes it to whichever layer is
 * inactive after the flip. The feed follows the inactive *operator* — the meat
 * partner while they're alive, falling back to the Decker's frozen body once the
 * partner flatlines (or on a solo Decker run), and the cyber avatar on the grid.
 */
import { formatHpSegments } from './combatHud.js';
import { cameraFor, type Camera, type Viewport } from './frame.js';
import type { Entity } from '../game/Entity.js';
import type { World } from '../game/World.js';
import type { Crew } from '../game/Crew.js';

/** Matches `#pip-canvas` pixel size at `PIP_CELL_SIZE` (160×100). */
export const PIP_VIEWPORT_TILES = Object.freeze({ width: 16, height: 10 });
export const PIP_CELL_SIZE = 10;

export type PipFeed = 'meat' | 'cyber';

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
  cyberspace?: { phase: PipCyberspacePhase; layer?: { world: World; avatar: Entity } } | null;
  world?: World | null;
  /** Decker body while jacked in (`Run.player`). */
  player?: Entity | null;
  /** Reserved/fielded meat partner on a dual-deploy (`Run.partnerMember`). */
  partnerMember?: Entity | null;
  /** Which layer holds input — `'cyber'` only while flipped to the grid. */
  activeLayer?: PipFeed;
};

/**
 * The layer the PIP should render — the one the player is *not* driving — or
 * null when there is no second layer (no active jack-in). The active view is
 * `activeLayer`; absent (legacy / solo) it defaults to `'cyber'`, so the PIP
 * shows the meat body feed exactly as in M3.7.
 */
export function pipFeedFor(run: PipRunView | null | undefined): PipFeed | null {
  if (run?.cyberspace?.phase !== 'active') return null;
  return (run.activeLayer ?? 'cyber') === 'cyber' ? 'meat' : 'cyber';
}

/**
 * The Meatspace operator the CCTV feed follows: the living partner if there is
 * one, otherwise the Decker's frozen body. Resolution order is deliberate — once
 * the partner flatlines the camera falls back to the body the corp is chewing on.
 */
export function pipMeatFollow(run: PipRunView | null | undefined): Entity | null {
  const partner = run?.partnerMember;
  if (partner && partner.alive) return partner;
  return run?.player ?? null;
}

export function pipWorldOf(run: PipRunView | null | undefined): World | null {
  const feed = pipFeedFor(run);
  if (feed === 'meat') return run!.world ?? null;
  if (feed === 'cyber') return run!.cyberspace?.layer?.world ?? null;
  return null;
}

export function pipFollowTargetOf(run: PipRunView | null | undefined): Entity | Crew | null {
  const feed = pipFeedFor(run);
  if (feed === 'meat') return pipMeatFollow(run);
  if (feed === 'cyber') return run!.cyberspace?.layer?.avatar ?? null;
  return null;
}

export function shouldShowPip(run: PipRunView | null | undefined): boolean {
  return pipWorldOf(run) != null && pipFollowTargetOf(run) != null;
}

export function pipViewport(): Viewport {
  return { width: PIP_VIEWPORT_TILES.width, height: PIP_VIEWPORT_TILES.height };
}

/**
 * Center on the followed operator, then clamp so the viewport stays inside the
 * grid when they stand near a map edge.
 */
export function pipCameraFor(
  follow: Entity,
  world: World,
  viewport: Viewport = pipViewport()
): Camera {
  const camera = cameraFor(follow, viewport);
  const maxX = Math.max(0, world.grid.width - viewport.width);
  const maxY = Math.max(0, world.grid.height - viewport.height);
  return {
    ...camera,
    x: Math.max(0, Math.min(camera.x, maxX)),
    y: Math.max(0, Math.min(camera.y, maxY)),
  };
}

const MEAT_ACCENT = Object.freeze({
  color: '#9ff3da',
  glowColor: '#6ae8c8',
  accentColor: 'rgba(0, 217, 165, 0.5)',
});
const CYBER_ACCENT = Object.freeze({
  color: '#ff8ad8',
  glowColor: '#ff5cc6',
  accentColor: 'rgba(255, 92, 198, 0.5)',
});

/** Feed chrome: label + vitals for the inactive operator the PIP is following. */
export function pipChrome(run: PipRunView | null | undefined): PipHudRow[] {
  const feed = pipFeedFor(run);
  const follow = pipFollowTargetOf(run);
  if (!feed || !follow) return [];
  if (feed === 'cyber') {
    return [
      { text: '// GRID //', anchor: 'top-left', row: 0, uppercase: true, ...CYBER_ACCENT },
      {
        text: formatHpSegments({ hp: follow.hp, maxHp: follow.maxHp, label: 'RAM' }),
        anchor: 'top-right',
        row: 3,
        ...CYBER_ACCENT,
      },
    ];
  }
  // Meat CCTV feed: BODY when following the frozen Decker, PARTNER otherwise.
  const label = follow === run?.player ? 'BODY' : `${(follow as Crew)?.callsign ?? 'PARTNER'}`;
  return [
    { text: '// CCTV //', anchor: 'top-left', row: 0, uppercase: true, ...MEAT_ACCENT },
    {
      text: formatHpSegments({ hp: follow.hp, maxHp: follow.maxHp, label }),
      anchor: 'top-right',
      row: 3,
      ...MEAT_ACCENT,
    },
  ];
}
