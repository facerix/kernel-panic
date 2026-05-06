/**
 * CRT post-pass — scanlines + vignette overlay applied on top of the rendered
 * glyph layer. Runs once per render, draws onto the same canvas (no offscreen
 * compositing — we redraw on turn ticks, not animation frames).
 *
 * Effects are intentionally subtle: the playfield should still be readable on
 * cheap screens. Crank `scanlineAlpha` / `vignetteAlpha` through options if we
 * want a heavier look later.
 */
export class CrtFilter {
  constructor(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new TypeError('CrtFilter requires a canvas element');
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scanlineAlpha = options.scanlineAlpha ?? 0.18;
    this.scanlineSpacing = options.scanlineSpacing ?? 2;
    this.vignetteAlpha = options.vignetteAlpha ?? 0.45;
  }

  apply() {
    this.#drawScanlines();
    this.#drawVignette();
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
}
