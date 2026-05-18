/**
 * CRT post-pass — scanlines + vignette overlay applied on top of the rendered
 * glyph layer. Runs once per render, draws onto the same canvas (no offscreen
 * compositing — we redraw on turn ticks, not animation frames).
 *
 * Effects are intentionally subtle: the playfield should still be readable on
 * cheap screens. Crank `scanlineAlpha` / `vignetteAlpha` through options if we
 * want a heavier look later.
 *
 * When `alertTint` is true, a faint red wash overlays the vignette to signal
 * that the facility alarm is active (`world.alarmActive`). The tint is subtle
 * enough not to impair readability but shifts the mood of the whole canvas.
 */

type CrtFilterOptions = {
  scanlineAlpha?: number;
  scanlineSpacing?: number;
  vignetteAlpha?: number;
  alertTintAlpha?: number;
};

export class CrtFilter {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scanlineAlpha: number;
  scanlineSpacing: number;
  vignetteAlpha: number;
  alertTintAlpha: number;

  /** Set by the shell before each `apply()`. */
  alertTint: boolean = false;

  constructor(canvas: HTMLCanvasElement, options: CrtFilterOptions = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.scanlineAlpha = options.scanlineAlpha ?? 0.18;
    this.scanlineSpacing = options.scanlineSpacing ?? 2;
    this.vignetteAlpha = options.vignetteAlpha ?? 0.45;
    this.alertTintAlpha = options.alertTintAlpha ?? 0.06;
  }
  apply(): void {
    this.#drawScanlines();
    this.#drawVignette();
    if (this.alertTint) {
      this.#drawAlertTint();
    }
  }

  #drawScanlines() {
    const { ctx, canvas, scanlineAlpha, scanlineSpacing } = this;
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${scanlineAlpha})`;
    for (let y = 0; y < canvas.height; y += scanlineSpacing) {
      ctx.fillRect(0, y, canvas.width, 1);
    }
    ctx.restore();
  }

  #drawVignette() {
    const { ctx, canvas, vignetteAlpha } = this;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const inner = Math.min(canvas.width, canvas.height) * 0.35;
    const outer = Math.hypot(canvas.width, canvas.height) / 2;
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, `rgba(0, 0, 0, ${vignetteAlpha})`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /** Faint red wash over the entire canvas — facility alarm is active. */
  #drawAlertTint() {
    const { ctx, canvas, alertTintAlpha } = this;
    ctx.save();
    ctx.fillStyle = `rgba(255, 60, 60, ${alertTintAlpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}
