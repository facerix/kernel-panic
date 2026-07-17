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
import { COMBAT_HUD_COLORS } from './combatHud.js';
import {
  BURN_FLASH_FG,
  CRASH_FLASH_FG,
  HEAL_FLASH_FG,
  INCENDIARY_IMPACT_FG,
  STUNNED_FG,
  SURGE_FLASH_FG,
} from './palette.js';

export const ANIMATION_DURATIONS = Object.freeze({
  SHAKE: 150,
  DAMAGE_FLASH: 300,
  MITIGATION_FLASH: 300,
  /** Cyan discharge pulse when a Decker detonates an EMP (P3.5.M2). */
  EMP_FLASH: 220,
  /** Blaze-orange spike when a Berserk arms Surge (P3.5.M3). */
  SURGE_FLASH: 220,
  /** Ashen comedown pulse when a Berserk's Surge expires into Crash (P3.5.M3). */
  CRASH_FLASH: 260,
  /**
   * Green pulse for any HP-restoring action — a Chimera converting scrap
   * into HP (P3.5.M5) or a crew member using a STIM (P3.5.M5).
   */
  HEAL_FLASH: 220,
  // Original plan suggested "~80ms" but at 60fps that's ~5 frames — perceptually
  // borderline, especially with the shooter's own glyph sitting underneath.
  // 120ms (~7 frames) is still snappy and reads clearly as a burst.
  MUZZLE_FLASH: 120,
  /** Brief burst when an interactable flips to its secured / activated colour. */
  INTERACT_SECURED_FLASH: 150,
  /** Hazard-glyph breaching-charge blast overlay (presentation only). */
  BREACH_BLAST_OVERLAY: 100,
  /**
   * Gold single-cell burst on the occupant's tile when a Merc's Vault lands a
   * body-check (P3.5.M5). Same pacing as the muzzle flash — a snappy impact
   * beat, not a lingering one.
   */
  VAULT_IMPACT_FLASH: 120,
  /**
   * Violet single-cell burst on the target's tile when a mind-influence roll
   * resolves — Adept Influence or CyberAvatar Override (P3.5.M5). Held
   * slightly longer than a muzzle flash: a domination attempt is a bigger
   * beat than a gunshot, win or lose.
   */
  MIND_INFLUENCE_FLASH: 200,
  /**
   * Pale mint single-cell burst on a Razor's own landing tile as Slide
   * engages the cloak (P3.5.M5). Between the muzzle flash and the
   * mind-influence beat — long enough to read as "something changed about
   * you," short enough to stay a subtle self-cue, not a screen-wide event.
   */
  CLOAK_FLASH: 160,
  /**
   * Ignition burst on a thrown molotov's impact tile (P3.6). Longer than the
   * muzzle flash — a bottle breaking is a heavier beat than a gunshot, and the
   * burst has to register *before* the eye settles on the fire it leaves
   * behind. Matched to MIND_INFLUENCE_FLASH rather than the 120ms impacts.
   */
  INCENDIARY_IMPACT_FLASH: 200,
  /**
   * Ember burst on a body taking fire damage (P3.6) — the ignition tick and
   * every standing tick after. Shorter than the impact burst: this one can
   * fire several times in a round (one per burning entity), so it stays brief
   * enough not to hold the input lock open across a crowded aftermath.
   */
  BURN_FLASH: 140,
});

export const SHAKE_CLASS = 'kp-shake';
export const DAMAGE_CLASS = 'kp-damage-flash';
export const MITIGATION_FLASH_CLASS = 'kp-mitigation-flash';
const IMPACT_FLASH_COLOR_PROPERTY = '--kp-impact-flash-color';

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
  stageEl.classList.remove(MITIGATION_FLASH_CLASS);
  stageEl.style.removeProperty(IMPACT_FLASH_COLOR_PROPERTY);
  return restartCssAnimation(stageEl, DAMAGE_CLASS, ANIMATION_DURATIONS.DAMAGE_FLASH, timers);
}

/**
 * Cyan full-screen discharge pulse for a Decker EMP (P3.5.M2). Reuses the
 * parametrized colored-vignette primitive (the same class + color property the
 * mitigation flash drives) tinted electric cyan — the same hue a stunned glyph
 * takes, so the blast and its aftermath read as one effect.
 */
export function triggerEmpFlash(stageEl: HTMLElement, timers = defaultTimers) {
  stageEl.classList.remove(DAMAGE_CLASS);
  stageEl.style.setProperty(IMPACT_FLASH_COLOR_PROPERTY, `${STUNNED_FG}8c`);
  return restartCssAnimation(
    stageEl,
    MITIGATION_FLASH_CLASS,
    ANIMATION_DURATIONS.EMP_FLASH,
    timers
  );
}

/**
 * Blaze-orange discharge pulse when a Berserk arms Surge (P3.5.M3). Reuses the
 * same parametrized colored-vignette primitive the EMP and mitigation flashes
 * drive — the surge spike and its later Crash comedown share this one screen
 * effect, tinted differently, so the ability reads as a single arc.
 */
export function triggerSurgeFlash(stageEl: HTMLElement, timers = defaultTimers) {
  stageEl.classList.remove(DAMAGE_CLASS);
  stageEl.style.setProperty(IMPACT_FLASH_COLOR_PROPERTY, `${SURGE_FLASH_FG}8c`);
  return restartCssAnimation(
    stageEl,
    MITIGATION_FLASH_CLASS,
    ANIMATION_DURATIONS.SURGE_FLASH,
    timers
  );
}

/**
 * Ashen violet-grey pulse when a Berserk's Surge expires into Crash (P3.5.M3).
 * The comedown twin of {@link triggerSurgeFlash} on the shared vignette class.
 */
export function triggerCrashFlash(stageEl: HTMLElement, timers = defaultTimers) {
  stageEl.classList.remove(DAMAGE_CLASS);
  stageEl.style.setProperty(IMPACT_FLASH_COLOR_PROPERTY, `${CRASH_FLASH_FG}8c`);
  return restartCssAnimation(
    stageEl,
    MITIGATION_FLASH_CLASS,
    ANIMATION_DURATIONS.CRASH_FLASH,
    timers
  );
}

/**
 * Green discharge pulse for any HP-restoring action — the Chimera's Nanite
 * Repair (P3.5.M5) and the STIM consumable both drive this. Reuses the same
 * parametrized colored-vignette primitive as the EMP/Surge/Crash flashes,
 * tinted for "HP restored" generically — a beat of feedback beyond the
 * HP-tick itself, same shape as `triggerSurgeFlash`.
 */
export function triggerHealFlash(stageEl: HTMLElement, timers = defaultTimers) {
  stageEl.classList.remove(DAMAGE_CLASS);
  stageEl.style.setProperty(IMPACT_FLASH_COLOR_PROPERTY, `${HEAL_FLASH_FG}8c`);
  return restartCssAnimation(
    stageEl,
    MITIGATION_FLASH_CLASS,
    ANIMATION_DURATIONS.HEAL_FLASH,
    timers
  );
}

export type MitigationFlashKind = 'armor' | 'shield';

/**
 * Use the HUD's defense color for a hit that was fully stopped before HP.
 * The alpha suffix keeps the vignette at the same intensity as damage red.
 */
export function triggerMitigationFlash(
  stageEl: HTMLElement,
  kind: MitigationFlashKind,
  timers = defaultTimers
) {
  const color = kind === 'shield' ? COMBAT_HUD_COLORS.SHIELD_CHARGED : COMBAT_HUD_COLORS.ARMOR;
  stageEl.classList.remove(DAMAGE_CLASS);
  stageEl.style.setProperty(IMPACT_FLASH_COLOR_PROPERTY, `${color}8c`);
  return restartCssAnimation(
    stageEl,
    MITIGATION_FLASH_CLASS,
    ANIMATION_DURATIONS.MITIGATION_FLASH,
    timers
  );
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

type RunFireFlashOptions = {
  duration?: number;
  timers?: typeof defaultTimers;
};

/**
 * Ignition burst where a thrown molotov breaks (P3.6). Fires on the impact tile
 * whatever landed there — a body, bare floor, or the ground short of a wall —
 * so a throw always has a visible beat even when it catches nobody.
 *
 * `*` rather than the HAZARD tile's own `▓`: the fire cluster is stamped onto
 * this cell in the same frame, so reusing its glyph would make the burst
 * invisible. The star reads as the bottle shattering, then resolves into fire.
 */
export function runIncendiaryImpactFlash(
  renderer: AsciiRenderer,
  repaint: () => void,
  worldX: number,
  worldY: number,
  options: RunFireFlashOptions = {}
) {
  const { duration = ANIMATION_DURATIONS.INCENDIARY_IMPACT_FLASH, timers = defaultTimers } =
    options;
  return runMuzzleFlash(renderer, repaint, worldX, worldY, {
    duration,
    timers,
    char: '*',
    color: INCENDIARY_IMPACT_FG,
  });
}

/**
 * Ember burst on a body being eaten by fire (P3.6) — the molotov's ignition
 * tick and every standing tick on a HAZARD tile after it.
 *
 * Paints the entity's *own* glyph tinted ember, the `MIND_INFLUENCED` /
 * `RAZOR_CLOAKED` shape: this is something happening to a body, and the player
 * needs to read *which* body at a glance when three drones are burning at once.
 * Overpainting with a fire glyph would erase exactly that information — and the
 * tile underneath is already drawn as fire anyway.
 */
export function runBurnFlash(
  renderer: AsciiRenderer,
  repaint: () => void,
  worldX: number,
  worldY: number,
  glyphChar: string,
  options: RunFireFlashOptions = {}
) {
  const { duration = ANIMATION_DURATIONS.BURN_FLASH, timers = defaultTimers } = options;
  return runMuzzleFlash(renderer, repaint, worldX, worldY, {
    duration,
    timers,
    char: glyphChar,
    color: BURN_FLASH_FG,
  });
}
