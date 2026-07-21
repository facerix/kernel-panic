# Vendored: TONEBENCH synthesis engine

`tonebenchEngine.js` is a third-party, dependency-free Web Audio **synthesizer**
authored in Rylee's **ToneBench** application and copied here wholesale. It imports
nothing from Kernel Panic and touches only `BaseAudioContext` plus standard JS/DOM
globals.

This is the repo's first vendored library. The convention it establishes:

```
src/vendor/<lib>/
  <lib>.js      # the upstream source, byte-for-byte — DO NOT EDIT locally
  <lib>.d.ts    # OUR hand-written typed boundary (how strict TS consumes it)
  README.md     # this provenance record
```

## Provenance

| | |
|---|---|
| **Upstream** | ToneBench (Rylee's synth-design app) |
| **Vendored** | 2026-07-17 |
| **Form** | Compiled ES module, plain JS (no local modifications) |

## Rules

- **Do not edit `tonebenchEngine.js` locally.** To pick up upstream changes, re-vendor
  the whole file from ToneBench (a clean overwrite) and reconcile `tonebenchEngine.d.ts`.
- The `.d.ts` is ours and is the single reviewed API surface. A re-vendor that changes
  the engine's exports should surface as a build error against this boundary — that is
  intended.
- `tsc` never compiles this `.js` (`allowJs` is off). It is treated as a static asset:
  `scripts/copy-assets.mjs` copies it into `dist/`, and `sw-core.js` precaches it.

## What Kernel Panic actually uses

At runtime the game imports **`playSound`** and the **types** (`SynthParams`, `WaveType`,
`FilterType`) via `src/audio/sounds.ts` and `src/audio/AudioManager.ts`. The authoring-only
exports (`renderToWav`, `bufferToWav`, `mutate`, `sliderToFreq`, `freqToSlider`) ship
unused — they are part of the untouched upstream file and are intentionally not trimmed.
