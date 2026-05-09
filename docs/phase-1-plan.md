# Phase 1 Plan — Meatspace MVP

Living plan for Phase 1 of Kernel Panic. Source of truth for milestone scope, current progress, and decisions we've already locked in. See [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the design vision and [game-overview.md](game-overview.md) for the elevator pitch.

## Current status

| Milestone | Status |
|---|---|
| M1 — Core grid & turn engine | ✅ Done |
| M2 — Canvas ASCII renderer + CRT post-pass | ✅ Done |
| M3 — Input controller + Merc archetype (Vault) | ✅ Done |
| M4 — Line of Sight + ranged combat | ✅ Done |
| M5 — A* drone AI | ✅ Done |
| M6 — Razor archetype + melee/stealth | ✅ Done |
| **M7 — Hub, Curator, run lifecycle, death screen** | **▶ Next** |
| M8 — Touch / on-screen keypad (Phase 1.5) | ⏳ |

Test count after M6 sweep-up: **273 passing**, lint clean.

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

### M4 — Line of Sight + ranged combat ✅

- `src/rng.js`: `mulberry32` seeded PRNG wrapped in an `Rng` class. Exposes `state` for the M7 save and a labelled `fork(label)` for stable substreams. INVARIANT: `state` mirrors the closure's internal counter; both must move together if mulberry stepping ever changes.
- `src/game/LineOfSight.js`: Bresenham `tilesBetween` plus `hasLineOfSight` (symmetric — traces both directions and requires both to clear) and `hasCoverBetween` for combat. Walls and **live entities** block LOS via the `{ blockers }` option; cover doesn't. Exports `withinRange` — the shared Euclidean-radius check used by Combat, Vision, and the harness.
- `src/game/Vision.js`: per-viewer `VisionField` with `visible`/`seen` sets, recomputed each player move. Bounded by `SIGHT_RANGE` and a circular FOV. Accepts `{ blockers }` so a body on the line breaks the sightline.
- `src/game/Combat.js`: `canFireRanged` + `resolveRanged(world, attacker, target, rng)`. Cover lowers hit threshold by `COVER_HIT_PENALTY`. Throws on illegal preconditions *before* debiting AP — no "ghost shots." Threshold is validated to stay in `[0,1]` so degenerate tuning crashes loudly. Tunable via `BASE_HIT_CHANCE` / `COVER_HIT_PENALTY` / `RANGED_DAMAGE`.
- `src/game/World.js`: `blockerKeys()` returns coordinate keys for every live entity (LOS occlusion). `canMoveEntity` rejects dead actors and crashes on non-integer offsets.
- `Entity` gains `maxHp` / `hp` / `damage(amount)`. Damage clamps to 0 HP and flips `alive=false`; further damage on a corpse throws.
- Renderer: `frame.js` accepts an optional `vision`. Visible cells render normally; remembered cells render the dim tile glyph (no entity); never-seen cells render as `UNSEEN_GLYPH` — a faint mid-dot so the foreground actually paints (the prior `' '` sentinel was skipped by the renderer). `palette.js` adds `dimColor` / `dimGlyph` / `MEMORY_DIM`.
- Input: keymap adds `FIRE_AIM` mode behind `f` + direction → `{ type: 'fire', dx, dy }`.
- Debug harness wires fog-of-war + targeting: `f`+dir scans the line and shoots the first hostile in LOS, sharing `withinRange` and `blockerKeys` with Combat so it can never offer a target Combat would later reject.

### M5 — A* drone AI ✅

- `src/game/Pathfinding.js`: 8-neighbour A* over current passable tiles with a Chebyshev heuristic and an internal binary min-heap. Live entities block by default; the `goal` tile is allowed to be occupied (`allowOccupiedGoal: true`) so an engaging drone can plan a route to the player's tile and take the first step. No caching across calls — destruction in M7 will mutate the grid.
- `src/game/ai/CorpDrone.js`: `patrol → investigate (last known position) → engage` state machine. Acquires via LOS+range (sharing `withinRange` + `blockerKeys` with Combat so visibility and fire-resolution can never disagree). Engage prefers `resolveRanged` over a step; losing LOS drops to investigate; reaching last-known empty-handed reverts to patrol. Subscribes to `noise` events to set `lastKnownTarget`; engaging drones ignore noise so a clatter can't pull them off a live target. A safety counter inside `takeTurn` crashes loudly if the loop ever fails to spend AP — silent stuck-drone bugs were the obvious failure mode to guard against.
- `src/game/events.js`: tiny synchronous pub/sub bus with a closed event-type set (`entity:moved`, `entity:damaged`, `noise`, `turn:ended`). Unknown types throw on `on`/`off`/`emit` — typo-protection. Listeners run in registration order; exceptions propagate; the iteration set is snapshotted so a listener can safely unsubscribe mid-dispatch.
- Wiring: `World.moveEntity` emits `entity:moved` with `{ entity, from, to }` *after* commit; `Combat.resolveRanged` emits `entity:damaged` only on a connected hit; `TurnQueue.endTurn` emits `turn:ended` after the AP refresh. The bus is optional on `World` — tests that don't care pay nothing.
- Debug harness: replaces the corp auto-pass with `runCorpTurn()` driving every CORP entity through `takeTurn`. Subscribes player vision to `entity:moved` so a drone walking into LOS appears immediately (closes the M4 deferred-fix). Drone HUD now shows `[PATROL/INVESTIGATE/ENGAGE]`.

### M6 — Razor archetype + melee/stealth ✅

- `src/game/archetypes/Razor.js`: `canSlide` / `slide(world, dx, dy)` — 2-tile reposition through floor for `AP_COST.SLIDE` (2). Both the intermediate and landing tiles must be passable + unoccupied; cover and walls block (Slide goes through, not over). Sets `stealthed = true` and emits `entity:moved` (no noise — the perk is silent). Overrides `refreshAp` so stealth clears on the player's next AP refresh, which means it persists exactly through the corp turn that follows the slide and lifts as the player's turn comes back around — "for the rest of this turn" in TurnQueue terms.
- Generic stealth lives on `Entity`: `stealthed` flag (default false) + `isSpottableBy(observer)` returning false when stealthed and the observer isn't Chebyshev-adjacent. Generic so future cyberware (cloak, ghost-protocol) can flip the same field without reaching into archetype code. `CorpDrone.acquireTarget` honours it after its existing LOS+range checks.
- `src/game/Combat.js`: adds `canMelee` / `resolveMelee` mirroring the ranged pair. Adjacency is Chebyshev (matches movement); LOS isn't required (impossible to interpose terrain at distance ≤1). Damage is flat `MELEE_DAMAGE = 2` (one above ranged — melee costs you positioning), no roll, no RNG. Throws on illegal preconditions before debiting AP. Emits `entity:damaged` with `source: 'melee'` and a `noise` event.
- Noise model. New `NOISE_RADIUS = { MOVE: 3, MELEE: 5, RANGED: SIGHT_RANGE }` constants. `World.moveEntity` emits a `noise` event after every move (suppressible via `{ silent: true }` — Slide is the canonical silent path; the harness's `applyIntent('slide')` doesn't go through `moveEntity` anyway). `Combat.resolveRanged` emits noise on every shot, hit or miss (a missed bullet still cracks the room). `Combat.resolveMelee` emits noise. `CorpDrone.#onNoise` now filters: same-faction sources (no friendly footstep panic), origins outside the noise's `radius` (Euclidean), and engaging drones still ignore noise (existing rule).
- `Merc.vault` now also emits `entity:moved` — closes the M5 deferred fix where vision didn't update after a vault without an inline harness call.
- Input: keymap adds `MELEE_AIM` (`m` + dir) and `SLIDE_AIM` (`t` + dir, picked because `s` is WASD-down). The vault key (`v`) is unchanged.
- Debug harness: archetype switch (`1` Merc, `2` Razor; `?archetype=razor` URL override) defaults to Razor on M6 to showcase Slide. Status line shows `[CLOAKED]` when stealth is active. Melee resolves via `m` + dir for either archetype.
- Tests: Razor slide validation matrix (`Razor.test.js`, 18 cases), `Entity.isSpottableBy`, `Combat.canMelee`/`resolveMelee` adjacency + AP + faction + emissions, `World.moveEntity` noise emission and `silent` opt-out, `CorpDrone` stealth-respect + same-faction filter + radius filter, keymap melee/slide modes.

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

- **Diagonal movement cost** equals orthogonal — drone AI didn't expose obvious cheese in M5 (path lengths feel right), but √2 rounding will probably go in alongside Razor's Slide if positional play gets tighter.
- **`World.entityAt` is O(n) linear scan.** Acceptable for V1; revisit if entity count crosses ~hundreds. M5 hits it from both `findPath` (per neighbour) and `acquireTarget`; still fine at one drone, watch when M6+ adds more.
- **CRT vignette uses canvas dimensions directly.** Will look off if the canvas is non-uniformly CSS-stretched. Currently scaled uniformly so it's fine.
- **Renderer redraws the whole canvas per turn.** No dirty-cell tracking. Reconsider only if/when we animate moves.
- **Vault-while-firing combo not implemented.** The blueprint has Vault doubling as a fire action. Currently Vault is purely a movement perk; folding in a free shot waits until M5/M6 when targeting UI exists. (Logged in `Merc.js` as a TODO.)
- **Ranged targeting in the harness is "first hostile along Bresenham."** Fine for a single-drone debug map; a real reticle / target-cycle UI lands with the M5 AI work. Now shares `withinRange` + `blockerKeys` with Combat so the harness can no longer offer targets Combat would reject.
- **Vision recomputed every entity move.** Cheap at V1 grid sizes (~24×16) but it's an O(R²·R) per recompute (each cell does a per-pixel LOS trace), and M5 now triggers it on *any* `entity:moved` so a multi-drone scene compounds the cost. Revisit if maps grow past ~128² or sight range past 16 — shadowcasting would be the swap.
- ~~**Vault doesn't go through `World.moveEntity`.**~~ Closed in M6 — `Merc.vault` now emits `entity:moved` directly so vision/AI listeners see the post-vault state without the harness calling `recomputeVision()` inline. The vault-while-firing combo is still pending.
- **Stealth doesn't break on attack.** A Razor who slides and then melees / fires keeps her cloak until refresh. Narratively that's wrong — a swing or a gunshot should drop the veil. Cheap to add (set `stealthed = false` in Combat.resolveMelee/resolveRanged when `attacker.stealthed`), but it interacts with the noise model and we want one tuning pass before locking that in.
- **Melee always hits.** Deterministic in V1 by design; will get parry/dodge math when archetype kits expand. `MELEE_DAMAGE` is the one knob today.
- **Slide stealth doesn't re-engage on `slide → wait → slide`.** Fine — each slide re-arms `stealthed`, so the second slide in the same turn re-cloaks. No bug, just noting the lifecycle.
- **Corpse positions aren't memorised.** Live and dead entities follow the same "we don't track where things were" rule — duck out of LOS and the corpse vanishes from memory until you can see the tile again. Logically a corpse doesn't move, so memorising them would be more honest. Cheap to add (a `seenCorpses` map on `VisionField` + a memory-mode branch in `frame.js`); revisit when M7 telemetry needs the data.
- **NEUTRAL faction is shootable by anyone.** `canFireRanged` only blocks same-faction targets — civilians can be hit by player or corp shots. Intentional today (narrative consequences); revisit when noise/Vouch lands and we have UI to express the cost. Noted in `Combat.js`.

## Test/lint expectations

- `npm test` — `node --test` over `tests/`. Must be green before a milestone is "done."
- `npm run lint` — oxlint, must be 0 warnings 0 errors.
- `npm run format` — prettier (don't commit unformatted files).

## Run scripts

- `npm start` — live-server on :8099. Open `/debug/` for the milestone debug harness.
- Main app shell at `/index.html` is currently the M0 scaffold; promoted to a real game shell in M7.
