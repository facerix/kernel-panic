import { buildFrame, cameraFor } from './frame.js';
import type { Viewport, Camera, BuildFrameOptions, Frame } from './frame.js';

/**
 * Canvas glyph painter. Owns *only* drawing — no game logic, no input. Pairs
 * with a pure `Frame` from `frame.js`; the CRT post-pass runs separately
 * after `draw()` returns.
 *
 * Defaults assume a 640x400 canvas (per index.html) with a 20px cell, giving
 * a 32x20 viewport. Override via the constructor for the debug harness or
 * future zoom levels.
 */
import type { World } from '../game/World.js';
import type { Entity } from '../game/Entity.js';

type NowFn = () => number;
type AsciiRendererOptions = {
  cellSize?: number;
  fontSize?: number;
  fontFamily?: string;
  bg?: string;
  glow?: number;
  now?: NowFn;
};

type DrawOptions = BuildFrameOptions & {
  camera?: Camera;
};
type FlashCellOptions = {
  duration?: number;
  char?: string;
  color?: string;
  fontScale?: number;
};

type Flash = {
  worldX: number;
  worldY: number;
  expiresAt: number;
  char: string;
  color: string;
  fontScale: number;
};

export class AsciiRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  cellSize: number;
  fontSize: number;
  fontFamily: string;
  bg: string;
  glow: number;
  lastCamera: Camera | null;
  activeFlashes: Flash[] = [];
  viewport: Viewport | null = null;
  now: NowFn = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  constructor(canvas: HTMLCanvasElement, options: AsciiRendererOptions = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new TypeError('AsciiRenderer requires a canvas element');
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellSize = options.cellSize ?? 20;
    this.fontSize = options.fontSize ?? 18;
    this.fontFamily =
      options.fontFamily ?? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    this.bg = options.bg ?? '#06090a';
    // Soft glow for that CRT-phosphor look — matches the colour of each glyph.
    this.glow = options.glow ?? 6;

    /**
     * Captured camera from the most recent `draw()` so M0's muzzle-flash
     * overlay (`flashCell`) can translate world coords back into screen
     * pixels without re-doing `cameraFor`. Cleared until the first draw.
     */
    this.lastCamera = null;

    /**
     * Active muzzle-flash overlays. Each draw() paints non-expired entries
     * on top of the regular frame so the flash *survives* the next redraw
     * (the shell calls `paint()` right after the bus event that registers
     * the flash — without this, the redraw would wipe an immediate paint
     * before the browser ever flushes the canvas to screen).
     */
    this.activeFlashes = [];

    /** Time source — injectable so unit tests can pin a deterministic clock. */
    if (typeof options.now === 'function') {
      this.now = options.now;
    }

    this.#syncViewport();
  }

  #syncViewport() {
    this.viewport = {
      width: Math.floor(this.canvas.width / this.cellSize),
      height: Math.floor(this.canvas.height / this.cellSize),
    };
  }

  /**
   * Render a world centred on `followTarget` (any object with x, y), unless
   * `options.camera` is set — then that rectangle (world tile coords) is drawn
   * in full, which sizes the visible tile count (use for whole-map debug views).
   * Pass `options.vision` (a `VisionField`) for fog-of-war fading.
   */
  draw(world: World, followTarget: Entity, options: DrawOptions = {}) {
    this.#syncViewport();
    const { camera: cameraOverride, ...frameOpts } = options;
    const camera = cameraOverride ?? cameraFor(followTarget, this.viewport!);
    const frame = buildFrame(world, camera, frameOpts);
    this.#drawFrame(frame);
    this.lastCamera = camera;
    this.#paintActiveFlashes();
  }

  /**
   * Register a single-cell flash overlay — the M0 muzzle-flash effect.
   * The next `draw()` paints it on top of the regular frame; the flash
   * is dropped automatically once `expiresAt` passes (the shell schedules
   * a `paint()` at expiry via `animations.runMuzzleFlash`).
   *
   * Painting at draw-time (rather than immediately) is critical: the shell
   * calls `paint()` right after applyIntent returns, in the same synchronous
   * tick as this registration. An "overpaint now" approach would be wiped
   * by that next draw before the browser ever flushed the canvas to screen.
   *
   * Returns `true` so callers can keep the `flashCell()` → `runMuzzleFlash`
   * contract uniform; throws on malformed coords (no silent fallback).
   */
  flashCell(worldX: number, worldY: number, options: FlashCellOptions = {}) {
    if (!Number.isInteger(worldX) || !Number.isInteger(worldY)) {
      throw new TypeError(`flashCell: world coords must be integers, got (${worldX}, ${worldY})`);
    }
    const { duration = 80, char = '*', color = '#ffff66', fontScale = 1.6 } = options;
    if (!Number.isFinite(duration) || duration < 0) {
      throw new RangeError(`flashCell: duration must be non-negative, got ${duration}`);
    }
    this.activeFlashes.push({
      worldX,
      worldY,
      expiresAt: this.now() + duration,
      char,
      color,
      fontScale,
    });
    return true;
  }

  /**
   * Paint every non-expired flash entry on top of the freshly-drawn frame.
   * Expired entries are filtered out in the same pass so the list stays
   * O(active flashes) — never more than a handful in practice.
   */
  #paintActiveFlashes() {
    if (!this.activeFlashes.length) return;
    const tNow = this.now();
    this.activeFlashes = this.activeFlashes.filter(f => f.expiresAt > tNow);
    if (!this.activeFlashes.length || !this.lastCamera) return;

    const { x: cx, y: cy, width, height } = this.lastCamera;
    const { ctx, cellSize, fontSize, fontFamily, glow } = this;
    ctx!.save();
    ctx!.textAlign = 'center';
    ctx!.textBaseline = 'middle';
    for (const flash of this.activeFlashes) {
      const dx = flash.worldX - cx;
      const dy = flash.worldY - cy;
      if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
      const px = dx * cellSize + cellSize / 2;
      const py = dy * cellSize + cellSize / 2;
      // Larger glyph + heavier glow than a normal cell so the flash reads
      // as an explosive burst even when the shooter's own @ sits underneath.
      ctx!.font = `${Math.round(fontSize * flash.fontScale)}px ${fontFamily}`;
      ctx!.shadowBlur = glow * 3;
      ctx!.shadowColor = flash.color;
      ctx!.fillStyle = flash.color;
      ctx!.fillText(flash.char, px, py);
    }
    ctx!.restore();
  }

  #drawFrame(frame: Frame) {
    const { ctx, cellSize, fontSize, fontFamily, bg, glow } = this;

    ctx!.fillStyle = bg;
    ctx!.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx!.font = `${fontSize}px ${fontFamily}`;
    ctx!.textAlign = 'center';
    ctx!.textBaseline = 'middle';

    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const cell = frame.cells[y * frame.width + x];
        if (!cell || !cell.char || cell.char === ' ') continue;
        const px = x * cellSize + cellSize / 2;
        const py = y * cellSize + cellSize / 2;
        // Two-pass glow: a soft shadow pass for bloom, then crisp glyph.
        ctx!.shadowBlur = glow;
        ctx!.shadowColor = cell.fg;
        ctx!.fillStyle = cell.fg;
        ctx!.fillText(cell.char, px, py);
      }
    }
    ctx!.shadowBlur = 0;
  }
}
