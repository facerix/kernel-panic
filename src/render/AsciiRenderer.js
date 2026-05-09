import { buildFrame, cameraFor } from './frame.js';

/**
 * Canvas glyph painter. Owns *only* drawing — no game logic, no input. Pairs
 * with a pure `Frame` from `frame.js`; the CRT post-pass runs separately
 * after `draw()` returns.
 *
 * Defaults assume a 640x400 canvas (per index.html) with a 20px cell, giving
 * a 32x20 viewport. Override via the constructor for the debug harness or
 * future zoom levels.
 */
export class AsciiRenderer {
  constructor(canvas, options = {}) {
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

    this.viewport = {
      width: Math.floor(canvas.width / this.cellSize),
      height: Math.floor(canvas.height / this.cellSize),
    };
  }

  /**
   * Render a world centred on `followTarget` (any object with x, y). Pass
   * `options.vision` (a `VisionField`) for fog-of-war fading.
   */
  draw(world, followTarget, options = {}) {
    const camera = cameraFor(followTarget, this.viewport);
    const frame = buildFrame(world, camera, options);
    this.#drawFrame(frame);
  }

  #drawFrame(frame) {
    const { ctx, cellSize, fontSize, fontFamily, bg, glow } = this;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const cell = frame.cells[y * frame.width + x];
        if (!cell || !cell.char || cell.char === ' ') continue;
        const px = x * cellSize + cellSize / 2;
        const py = y * cellSize + cellSize / 2;
        // Two-pass glow: a soft shadow pass for bloom, then crisp glyph.
        ctx.shadowBlur = glow;
        ctx.shadowColor = cell.fg;
        ctx.fillStyle = cell.fg;
        ctx.fillText(cell.char, px, py);
      }
    }
    ctx.shadowBlur = 0;
  }
}
