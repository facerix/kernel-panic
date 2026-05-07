# Phase 1 Plan — Meatspace MVP

Living plan for Phase 1 of Kernel Panic. Source of truth for milestone scope, current progress, and decisions we've already locked in. See [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the design vision and [game-overview.md](game-overview.md) for the elevator pitch.

## Current status

| Milestone | Status |
|---|---|
| M1 — Core grid & turn engine | ✅ Done |
| M2 — Canvas ASCII renderer + CRT post-pass | ✅ Done |
| M3 — Input controller + Merc archetype (Vault) | ✅ Done |
| **M4 — Line of Sight + ranged combat** | **▶ Next** |
| M5 — A* drone AI | ⏳ |
| M6 — Razor archetype + melee/stealth | ⏳ |
| M7 — Hub, Curator, run lifecycle, death screen | ⏳ |
| M8 — Touch / on-screen keypad (Phase 1.5) | ⏳ |

Test count after M2: **74 passing**, lint clean.

## Locked-in decisions

These were settled in chat before any code landed. Re-open only with a reason.

- **Procedural generation:** prefab-hybrid — BSP layout + authored room prefabs stamped into leaves. Cover placement is authored, variety is procedural. Seeded PRNG (`mulberry32`) so maps are reproducible in tests.
- **Save flow:** autosave-on-turn-end to DataStore. `beforeunload` only triggers the browser's native warning (custom modals don't work there). On load, if a saved run exists, prompt via `<confirmation-modal>`: *Resume / Abandon*. Death screen clears the save.
- **Archetype order:** Merc first (M3), Razor in M6.
- **Input:** keyboard-only for V1; touch / on-screen pad as M8.
- **Renderer:** canvas + CRT post-pass (scanlines + vignette + per-glyph glow).
- **AP costs:** Move 1, Ranged 2, Melee 1, Interact 1, Vault 3, Slide 2. `DEFAULT_AP = 4` per turn. All tunable in `src/game/constants.js`.
- **Cover:** blocks movement (so Vault is a real perk), does *not* block LOS (will grant a defender hit-modifier in M4).
- **Movement:** Chebyshev (8-neighbourhood), diagonal cost == orthogonal in V1.
- **Turns:** faction-wide rotation (player → corp), not per-entity initiative. AP refreshes for the *incoming* faction; leftover AP doesn't carry over.
- **Errors:** crash > silent fallback. Illegal AP spend, OOB tile access, unknown palette ids all throw.

## Architecture conventions

- **Pure / DOM split.** Game logic and pure rendering helpers (`src/game/`, `src/render/frame.js`, `src/render/palette.js`) have **no DOM imports** and are exhaustively unit-tested under `node --test`. DOM-aware classes (`AsciiRenderer`, `CrtFilter`, future input/UI) are thin wrappers verified visually via the debug harness.
- **Imports.** Inside `src/`: relative paths (`./constants.js`). From outside `src/` (HTML pages, `components/`, `debug/`): absolute paths (`/src/...`) — they resolve through live-server and break otherwise.
- **DataStore + `h()` + Web Components** per `AGENTS.md` for any UI we add.
- Tests live under `tests/unit/<area>/`. They must be able to fail — no smoke-only assertions.

## Milestones — detail

### M1 — Core grid & turn engine ✅

Headless model + tests. No rendering.

- `src/game/constants.js` — TILE / FACTION / AP_COST / DEFAULT_AP.
- `src/game/Grid.js` — `Uint8Array`-backed; `inBounds`, `tileAt`, `setTile`, `isPassable`, `blocksLineOfSight`.
- `src/game/Entity.js` — id, position, faction, AP; throws on overspend.
- `src/game/World.js` — owns grid + entities; `canMoveEntity` returns `{ ok, reason }`, `moveEntity` throws on illegal commits.
- `src/game/TurnQueue.js` — faction rotation; refreshes AP for incoming faction; `turnNumber` increments per round.

### M2 — Canvas ASCII renderer + CRT post-pass ✅

Pure frame builder + thin canvas painter.

- `src/render/palette.js` — pure: tile/entity → `{ char, fg }`; distinct faction colours.
- `src/render/frame.js` — pure: `buildFrame(world, camera)` returns a flat glyph array; `cameraFor(target, viewport)` centers on a target. OOB cells map to a sentinel glyph.
- `src/render/AsciiRenderer.js` — DOM: paints a frame to canvas with shadow-blur phosphor glow.
- `src/render/CrtFilter.js` — DOM: scanlines + radial vignette overlay.
- `debug/index.{html,js}` — canvas-based smoke harness; corp turn auto-passes (no AI yet).

### M3 — Input controller + Merc archetype ✅

Goal: a playable Merc on the existing engine, with Vault working end-to-end.

- `src/input/KeyboardController.js`: arrows + WASD orthogonal, `q`/`e`/`z`/`c` diagonal, `f` ranged-fire (M4 stub for now), `m` melee (M6 stub), `i` interact, `.` wait, `space` end turn, `escape` cancel pending action. Pure dispatch table that emits action intents — game loop applies them.
- `src/game/archetypes/Merc.js`: inherits Entity; `vault(world, dx, dy)` — must clear a single COVER tile and land on a passable, unoccupied tile two squares away; debits 3 AP; counts as a fire action for M4 hit-resolution.
- Tests: input keymap dispatches expected intents; Vault legality (must clear cover, no walls in path, target tile passable + unoccupied, AP ≥ 3); Vault commits cleanly and AP debits.
- Debug harness: bind Vault to `v`+direction so it's playable.

### M4 — Line of Sight + ranged combat ▶ Next

- `src/rng.js`: `mulberry32` seeded PRNG. Tests assert reproducibility from a seed.
- `src/game/LineOfSight.js`: symmetric Bresenham (or shadowcasting if Bresenham asymmetry bites). Walls block; cover does not.
- `src/game/Combat.js`: deterministic hit roll; cover gives defender a configurable hit-penalty when the cover tile is between attacker and defender.
- Renderer: dim non-visible tiles; remember last-seen state ("memory") for tactical readability.

### M5 — A* drone AI

- `src/game/Pathfinding.js`: A* over current passable tiles. No path caching across moves — destruction in M7 will mutate the grid.
- `src/game/ai/CorpDrone.js`: `patrol → investigate (last known position) → engage`. Uses LOS to acquire; investigates noise events.
- `src/game/events.js`: small event bus (`entity:moved`, `entity:damaged`, `noise`, `turn:ended`) so AI + UI subscribe without coupling.

### M6 — Razor archetype + melee/stealth

- `src/game/archetypes/Razor.js`: `slide(world, dx, dy)` — 2-tile reposition; for the rest of this turn, drones need adjacency to spot. 2 AP.
- Noise model: melee/movement emits `noise` events with origin + radius; drones investigate.
- Tests: Slide visibility rules, noise propagation, melee adjacency required.

### M7 — Hub, Curator, run lifecycle, death screen

- `src/game/procgen/`: BSP + prefab stamping. Authored prefabs in `src/game/procgen/prefabs/` (each annotated with size, spawn anchors, drone patrol waypoints, cover placement).
- `src/game/hub/SafeSpace.js`: non-combat map. `Curator` NPC offers a single quest stub that seeds the run.
- `src/game/Run.js`: state machine (HUB → BRIEFING → COMBAT → RESULT). Persists per-turn to DataStore. On load, surface resume prompt via `<confirmation-modal>`.
- `<crash-dump>` web component (Shadow DOM, kebab-case): faux kernel-panic stack trace built from run telemetry; clears the save.
- Tests: BSP connectivity (every floor reachable), run state machine, crash-dump renders required telemetry fields.

### M8 — Touch / on-screen keypad (Phase 1.5)

- `<touch-pad>` web component overlay: 8-direction directional pad, action buttons (fire / melee / interact / wait / end-turn). Visible only when `(pointer: coarse)`.
- Same intent stream as `KeyboardController` so the game loop is input-agnostic.

## Recorded problems (deferred fixes)

Things the standard we walk by has flagged but that are out of current scope:

- **Diagonal movement cost** equals orthogonal — may need √2 rounding once drone behaviour exposes it.
- **No event bus yet.** Lands in M5 alongside AI; renderer currently re-renders the whole frame on demand, which is fine at this scale.
- **`World.entityAt` is O(n) linear scan.** Acceptable for V1; revisit if entity count crosses ~hundreds.
- **CRT vignette uses canvas dimensions directly.** Will look off if the canvas is non-uniformly CSS-stretched. Currently scaled uniformly so it's fine.
- **Renderer redraws the whole canvas per turn.** No dirty-cell tracking. Reconsider only if/when we animate moves.

## Test/lint expectations

- `npm test` — `node --test` over `tests/`. Must be green before a milestone is "done."
- `npm run lint` — oxlint, must be 0 warnings 0 errors.
- `npm run format` — prettier (don't commit unformatted files).

## Run scripts

- `npm start` — live-server on :8099. Open `/debug/` for the milestone debug harness.
- Main app shell at `/index.html` is currently the M0 scaffold; promoted to a real game shell in M7.
