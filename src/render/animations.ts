/**
 * Combat feedback animations.
 *
 * Three effects, all wired to bus events in the game shell:
 *
 *   - **Screen shake** — CSS keyframes on the stage element (~150ms). Fires
 *     on `entity:damaged` where the player is the target.
 *   - **Damage reddening** — a red radial vignette overlaid on the stage
 *     (~300ms). Same trigger as shake.
 *   - **Muzzle flash** — a single-cell overpaint on the canvas via
 *     `AsciiRenderer.flashCell` (~120ms). Fires on `noise` events whose
 *     `kind` is `ranged` or `melee` (i.e. a committed attack), regardless
 *     of which faction shot — players want to see drones shoot at them too.
 *   - **Interact secured flash** — same overlay path, brief white burst on
 *     the interactable's glyph when a secured flip succeeds (slice, sync,
 *     handoff, escort link).
 *
 * The lock is the shared "input is animating" gate. The shell pushes
 * durations onto it from each listener; the longest outstanding window
 * wins (animations overlap rather than stack), and the controllers ask
 * `isLocked()` to early-return while it holds.
 *
 * Everything that touches a timer or a DOM element is injectable so the
 * pure tests can run under `node --test` without a browser. The defaults
 * are the real `performance.now`/`setTimeout`; the canvas overlay itself
 * lives inside `AsciiRenderer` (the only place that needs the canvas).
 * The muzzle flash is registered with the renderer at trigger time and
 * the renderer overlays it on every `draw()` until its expiry passes,
 * which is what makes the flash survive the shell's post-action redraw.
 */

import type { AsciiRenderer } from './AsciiRenderer.js';

export const ANIMATION_DURATIONS = Object.freeze({
  SHAKE: 150,
  DAMAGE_FLASH: 300,
  // Original plan suggested "~80ms" but at 60fps that's ~5 frames — perceptually
  // borderline, especially with the shooter's own glyph sitting underneath.
  // 120ms (~7 frames) is still snappy and reads clearly as a burst.
  MUZZLE_FLASH: 120,
  /** Brief burst when an interactable flips to its secured / activated colour. */
  INTERACT_SECURED_FLASH: 150,
  /** Hazard-glyph breaching-charge blast overlay (presentation only). */
  BREACH_BLAST_OVERLAY: 100,
});

export const SHAKE_CLASS = 'kp-shake';
export const DAMAGE_CLASS = 'kp-damage-flash';

const defaultTimers = Object.freeze({
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
});

/**
 * Toggle a CSS animation class on `el` for `duration` ms. The remove-then-
 * re-add dance with a forced reflow is what lets the same animation
 * retrigger when two damage events land back-to-back — without it, the
 * second add is a no-op because the class is already present.
 */
export function restartCssAnimation(
  el: HTMLElement,
  className: string,
  duration: number,
  timers = defaultTimers
) {
  if (!el || !el.classList || typeof className !== 'string') return false;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError(`restartCssAnimation: duration ${duration} must be non-negative`);
  }
  el.classList.remove(className);
  // Force reflow so the browser registers the removal before the re-add —
  // otherwise modern engines coalesce the two and skip the restart. Reading
  // `offsetWidth` is the cheap, well-documented incantation. JSDOM stubs
  // expose offsetWidth so tests work too.
  if (typeof el.offsetWidth === 'number') {
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
  }
  el.classList.add(className);
  timers.setTimeout(() => el.classList.remove(className), duration);
  return true;
}

export function triggerShake(stageEl: HTMLElement, timers = defaultTimers) {
  return restartCssAnimation(stageEl, SHAKE_CLASS, ANIMATION_DURATIONS.SHAKE, timers);
}

export function triggerDamageFlash(stageEl: HTMLElement, timers = defaultTimers) {
  return restartCssAnimation(stageEl, DAMAGE_CLASS, ANIMATION_DURATIONS.DAMAGE_FLASH, timers);
}

/**
 * Create an animation-lock token. The shell pushes durations onto it from
 * each listener; `isLocked()` returns true while any pushed window is still
 * in flight. Overlapping pushes don't extend by addition — the longest
 * outstanding deadline wins ("queued or overlapped, not
 * stacked in duration").
 */
export function createAnimationLock(timers = defaultTimers) {
  let until = 0;
  return {
    push(durationMs: number) {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError(
          `animation lock: push duration ${durationMs} must be a non-negative number`
        );
      }
      const target = timers.now() + durationMs;
      if (target > until) until = target;
    },
    isLocked() {
      return timers.now() < until;
    },
    /** Clear any outstanding lock deadline (e.g. fault recovery). */
    reset() {
      until = 0;
    },
    /** Test seam — peek at the internal deadline. */
    _deadline() {
      return until;
    },
  };
}

/**
 * Drive a muzzle-flash sequence: paint the overlay glyph via the renderer,
 * then schedule a repaint after `duration` so the cell falls back to its
 * normal glyph on the next frame. `repaint` is the shell's `paint()` —
 * cleanest seam since the renderer doesn't know world state.
 *
 * Returns false when the renderer can't position the flash (no draw has
 * happened yet) so the shell can skip extending the lock.
 */
type RunMuzzleFlashOptions = {
  duration?: number;
  timers?: typeof defaultTimers;
  char?: string;
  color?: string;
  fontScale?: number;
};
export function runMuzzleFlash(
  renderer: AsciiRenderer,
  repaint: () => void,
  worldX: number,
  worldY: number,
  options: RunMuzzleFlashOptions = {}
) {
  const {
    duration = ANIMATION_DURATIONS.MUZZLE_FLASH,
    timers = defaultTimers,
    ...flashOpts
  } = options;
  if (!renderer || typeof renderer.flashCell !== 'function') {
    throw new TypeError('runMuzzleFlash: renderer must expose flashCell');
  }
  if (typeof repaint !== 'function') {
    throw new TypeError('runMuzzleFlash: repaint must be a function');
  }
  // Pass duration through so the renderer's per-flash expiry stays in sync
  // with the scheduled cleanup repaint — otherwise the entry would expire
  // at the renderer's default 80ms while the cleanup paint runs later, or
  // vice versa, and the flash would either flicker out early or linger.
  const painted = renderer.flashCell(worldX, worldY, { duration, ...flashOpts });
  if (!painted) return false;
  timers.setTimeout(() => repaint(), duration);
  return true;
}

type RunInteractSecuredFlashOptions = {
  duration?: number;
  timers?: typeof defaultTimers;
  color?: string;
};

/**
 * Success pulse on a secured interactable — white overpaint of the prop's own
 * glyph so it reads on both neutral lavender and post-activate mint.
 */
export function runInteractSecuredFlash(
  renderer: AsciiRenderer,
  repaint: () => void,
  worldX: number,
  worldY: number,
  glyphChar: string,
  options: RunInteractSecuredFlashOptions = {}
) {
  const {
    duration = ANIMATION_DURATIONS.INTERACT_SECURED_FLASH,
    timers = defaultTimers,
    color = '#ffffff',
  } = options;
  return runMuzzleFlash(renderer, repaint, worldX, worldY, {
    duration,
    timers,
    char: glyphChar,
    color,
  });
}
