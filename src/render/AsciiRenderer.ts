import {
  COMBAT_HUD_GLYPHS,
  formatApPips,
  formatHpSegments,
  formatIdentityHud,
  fitObjectiveHudLine,
  formatObjectiveHud,
  formatTurnLabel,
} from './combatHud.js';
import { FACTION } from '../game/constants.js';
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
import type { CombatHudSummaryInput } from './combatHud.js';

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
  /**
   * M7.2: persistent location chip painted top-left of the canvas — the
   * site flavor label in combat, "Safe House" in the Hub. Trains the player
   * to read the corner as "where am I". Omitted = no chip this frame.
   */
  locationLabel?: string;
  /** Renderer-owned canvas chrome rows, painted after the map and flashes. */
  hudRows?: readonly HudRow[];
  /** Structured combat chrome, painted in the canonical combat HUD positions. */
  combatHud?: CombatHudSummaryInput | null;
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

type HudRowAnchor = 'top-left' | 'top-right' | 'bottom-left';
type HudTextSegment = {
  text: string;
  color: string;
  glowColor?: string;
};
type HudRow = {
  text: string;
  anchor: HudRowAnchor;
  /** Zero-based row from the chosen edge. */
  row?: number;
  color?: string;
  glowColor?: string;
  accentColor?: string;
  uppercase?: boolean;
  /** Maximum backing-box width in CSS pixels. Text is truncated to fit. */
  maxWidth?: number;
  /** When set, objective tags stay visible and only the title ellipsizes. */
  preserveObjectiveTags?: boolean;
  segments?: readonly HudTextSegment[];
};

const HUD_FONT_PX = 12;
const HUD_PAD_X = 6;
const HUD_PAD_Y = 5;
const HUD_ROW_GAP = 3;
const HUD_BOTTOM_LEFT_INSET = 24;
const HUD_BACKING = 'rgba(6, 9, 10, 0.72)';
const HUD_ACCENT = 'rgba(0, 217, 165, 0.5)';
const HUD_TEXT = '#9ff3da';
const HUD_GLOW = '#6ae8c8';
const TRUNCATION_MARK = '...';
const HUD_OBJECTIVE_DONE = '#7dff9d';
const HUD_OBJECTIVE_TODO = '#ff7a66';
const HUD_IDENTITY = '#6ae8c8';
const HUD_HP_EMPTY = '#2a4a42';
const HUD_HP_FILLED = '#6ae8c8';
const HUD_AP_SPENT = '#ff7a66';
const HUD_AP_AVAILABLE = '#6ae8c8';
const HUD_TURN_PLAYER = '#b8f5e2';
const HUD_TURN_CORP = '#ff7a66';
/** Reserve top-right chrome so the objective row does not sit under identity/vitals. */
const OBJECTIVE_RIGHT_GUTTER = 200;

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
    const { camera: cameraOverride, locationLabel, combatHud, hudRows, ...frameOpts } = options;
    const camera = cameraOverride ?? cameraFor(followTarget, this.viewport!);
    const frame = buildFrame(world, camera, frameOpts);
    this.#drawFrame(frame);
    this.lastCamera = camera;
    this.#paintActiveFlashes();
    // Painted last so persistent chrome is never occluded by glyphs/flashes.
    this.#drawLocationLabel(locationLabel);
    this.#drawCombatHud(combatHud);
    this.#drawHudRows(hudRows);
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

  /**
   * Paint the persistent location chip in the top-left corner. A dark backing
   * keeps it legible over map glyphs; a thin accent underline ties it to the
   * terminal aesthetic. No-op when no label is supplied.
   */
  #drawLocationLabel(label?: string) {
    if (!label) return;
    this.#drawHudRow({ text: label, anchor: 'top-left', uppercase: true });
  }

  #drawHudRows(rows?: readonly HudRow[]) {
    if (!rows) return;
    for (const row of rows) {
      this.#drawHudRow(row);
    }
  }

  #drawCombatHud(hud?: CombatHudSummaryInput | null) {
    if (!hud) return;
    const objective = formatObjectiveHud(hud.objective);
    if (objective) {
      this.#drawHudRow({
        text: objective,
        anchor: 'top-left',
        row: 1,
        color: hud.objective?.done ? HUD_OBJECTIVE_DONE : HUD_OBJECTIVE_TODO,
        glowColor: hud.objective?.done ? HUD_OBJECTIVE_DONE : HUD_OBJECTIVE_TODO,
        maxWidth: Math.max(0, this.canvas.width - OBJECTIVE_RIGHT_GUTTER),
        preserveObjectiveTags: true,
      });
    }
    this.#drawHudRow({
      text: formatIdentityHud(hud.identity),
      anchor: 'top-right',
      row: 0,
      color: HUD_IDENTITY,
      glowColor: HUD_IDENTITY,
    });
    const hpText = formatHpSegments(hud.hp);
    this.#drawHudRow({
      text: hpText,
      anchor: 'top-right',
      row: 1,
      segments: hpSegments(hpText),
    });
    const apText = formatApPips(hud.ap);
    this.#drawHudRow({
      text: apText,
      anchor: 'top-right',
      row: 2,
      segments: apSegments(apText),
    });
    const turnLabel = formatTurnLabel(hud.turn);
    const isCorpTurn = hud.turn.currentFaction === FACTION.CORP;
    this.#drawHudRow({
      text: turnLabel,
      anchor: 'bottom-left',
      row: 0,
      color: isCorpTurn ? HUD_TURN_CORP : HUD_TURN_PLAYER,
      glowColor: isCorpTurn ? HUD_TURN_CORP : HUD_TURN_PLAYER,
    });
  }

  #drawHudRow(row: HudRow) {
    const ctx = this.ctx;
    if (!ctx || !row.text) return;
    const rowIndex = row.row ?? 0;
    if (!Number.isInteger(rowIndex) || rowIndex < 0) {
      throw new RangeError(`HUD row index must be a non-negative integer, got ${rowIndex}`);
    }
    if (row.maxWidth !== undefined && (!Number.isFinite(row.maxWidth) || row.maxWidth < 0)) {
      throw new RangeError(`HUD maxWidth must be non-negative, got ${row.maxWidth}`);
    }

    const rawText = row.uppercase ? row.text.toUpperCase() : row.text;
    const boxH = HUD_FONT_PX + HUD_PAD_Y * 2;
    const insetX = row.anchor === 'bottom-left' ? HUD_BOTTOM_LEFT_INSET : 0;
    const defaultMaxWidth =
      row.anchor === 'top-right' ? this.canvas.width : Math.max(0, this.canvas.width - insetX);
    const maxBoxW = Math.max(
      0,
      Math.min(row.maxWidth ?? defaultMaxWidth, this.canvas.width - insetX)
    );

    ctx.save();
    ctx.font = `${HUD_FONT_PX}px ${this.fontFamily}`;
    ctx.textBaseline = 'top';
    const maxTextWidth = Math.max(0, maxBoxW - HUD_PAD_X * 2);
    const text = row.preserveObjectiveTags
      ? fitObjectiveHudLine(rawText, t => ctx.measureText(t).width, maxTextWidth)
      : this.#truncateHudText(rawText, maxTextWidth);
    const boxW = Math.min(maxBoxW, Math.ceil(ctx.measureText(text).width) + HUD_PAD_X * 2);
    const boxX = row.anchor === 'top-right' ? this.canvas.width - boxW : insetX;
    const boxY =
      row.anchor === 'bottom-left'
        ? this.canvas.height - 1 - boxH - rowIndex * (boxH + HUD_ROW_GAP)
        : rowIndex * (boxH + HUD_ROW_GAP);
    const textX = row.anchor === 'top-right' ? boxX + boxW - HUD_PAD_X : boxX + HUD_PAD_X;

    ctx.textAlign = row.anchor === 'top-right' ? 'right' : 'left';
    ctx.shadowBlur = 0;
    ctx.fillStyle = HUD_BACKING;
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = row.accentColor ?? HUD_ACCENT;
    ctx.fillRect(boxX, boxY + boxH, boxW, 1);
    ctx.shadowBlur = this.glow;
    if (row.segments && text === rawText) {
      this.#drawHudSegments(row.segments, text, boxX, boxW, boxY);
    } else {
      ctx.shadowColor = row.glowColor ?? HUD_GLOW;
      ctx.fillStyle = row.color ?? HUD_TEXT;
      ctx.fillText(text, textX, boxY + HUD_PAD_Y);
    }
    ctx.restore();
  }

  #drawHudSegments(
    segments: readonly HudTextSegment[],
    text: string,
    boxX: number,
    boxW: number,
    boxY: number
  ) {
    const ctx = this.ctx;
    if (!ctx) return;
    let x = boxX + boxW - HUD_PAD_X - ctx.measureText(text).width;
    ctx.textAlign = 'left';
    for (const segment of segments) {
      if (!segment.text) continue;
      ctx.shadowColor = segment.glowColor ?? segment.color;
      ctx.fillStyle = segment.color;
      ctx.fillText(segment.text, x, boxY + HUD_PAD_Y);
      x += ctx.measureText(segment.text).width;
    }
  }

  #truncateHudText(text: string, maxTextWidth: number): string {
    const ctx = this.ctx;
    if (!ctx || ctx.measureText(text).width <= maxTextWidth) return text;
    if (maxTextWidth <= 0) return '';
    const markerWidth = ctx.measureText(TRUNCATION_MARK).width;
    if (markerWidth > maxTextWidth) return '';
    let next = text;
    while (next.length > 0 && ctx.measureText(`${next}${TRUNCATION_MARK}`).width > maxTextWidth) {
      next = next.slice(0, -1);
    }
    return `${next}${TRUNCATION_MARK}`;
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
        if (cell.bg) {
          ctx!.shadowBlur = 0;
          ctx!.fillStyle = cell.bg;
          ctx!.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
        // Two-pass glow: a soft shadow pass for bloom, then crisp glyph.
        ctx!.shadowBlur = glow;
        ctx!.shadowColor = cell.fg;
        ctx!.fillStyle = cell.fg;
        ctx!.fillText(cell.char, px, py);
        if (cell.overlay) {
          ctx!.font = `${Math.round(fontSize * 1.15)}px ${fontFamily}`;
          ctx!.shadowBlur = glow * 2;
          ctx!.shadowColor = cell.overlay.fg;
          ctx!.fillStyle = cell.overlay.fg;
          ctx!.fillText(cell.overlay.char, px, py);
          ctx!.font = `${fontSize}px ${fontFamily}`;
        }
      }
    }
    ctx!.shadowBlur = 0;
  }
}

function hpSegments(text: string): HudTextSegment[] {
  const prefix = 'HP ';
  const glyphs = text.startsWith(prefix) ? text.slice(prefix.length) : text;
  const segments: HudTextSegment[] = text.startsWith(prefix)
    ? [{ text: prefix, color: HUD_TEXT, glowColor: HUD_GLOW }]
    : [];
  for (const char of glyphs) {
    if (char === COMBAT_HUD_GLYPHS.HP_EMPTY) {
      segments.push({ text: char, color: HUD_HP_EMPTY });
    } else if (char === COMBAT_HUD_GLYPHS.HP_FILLED) {
      segments.push({ text: char, color: HUD_HP_FILLED });
    } else {
      segments.push({ text: char, color: HUD_TEXT, glowColor: HUD_GLOW });
    }
  }
  return segments;
}

function apSegments(text: string): HudTextSegment[] {
  return [...text].map(char => {
    if (char === COMBAT_HUD_GLYPHS.AP_SPENT) return { text: char, color: HUD_AP_SPENT };
    if (char === COMBAT_HUD_GLYPHS.AP_AVAILABLE) {
      return { text: char, color: HUD_AP_AVAILABLE };
    }
    return { text: char, color: HUD_TEXT, glowColor: HUD_GLOW };
  });
}
