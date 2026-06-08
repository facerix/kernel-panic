# Phase 1 Plan — Meatspace MVP

Living plan for Phase 1 of Kernel Panic. Source of truth for milestone scope, current progress, and decisions we've already locked in. See [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the design vision and [game-overview.md](game-overview.md) for the elevator pitch.

**Phase prefix:** `P1` — use `P1.MN` when referencing milestones from this phase in other documents.

## Current status

| Milestone | Status |
|---|---|
| M1 — Core grid & turn engine | ✅ Done |
| M2 — Canvas ASCII renderer + CRT post-pass | ✅ Done |
| M3 — Input controller + Merc archetype (Vault) | ✅ Done |
| M4 — Line of Sight + ranged combat | ✅ Done |
| M5 — A* drone AI | ✅ Done |
| M6 — Razor archetype + melee/stealth | ✅ Done |
| M7 — Touch / on-screen keypad | ✅ Done |
| M8 — Hub, Curator, run lifecycle, death screen | ✅ Done |

**Phase 1 complete** when *all three* of:

1. Every milestone box ticked ✅ (above).
2. `/index.html` plays a full Hub → Briefing → Combat → Death/Exit loop offline on iOS Safari + Chrome desktop (PWA install, no network).
3. `v0.1.0` tagged in git.

Test count after M8: **409 passing**, lint clean, prettier clean. Remaining "Recorded problems" are intentional deferrals.

## Locked-in decisions

These were settled in chat before any code landed. Re-open only with a reason.

- **Procedural generation:** prefab-hybrid — BSP layout + authored room prefabs stamped into leaves. Cover placement is authored, variety is procedural. Seeded PRNG (`mulberry32`) so maps are reproducible in tests.
- **Save flow:** autosave-on-turn-end to DataStore. `beforeunload` only triggers the browser's native warning (custom modals don't work there). On load, if a saved run exists, prompt via `<confirmation-modal>`: *Resume / Abandon*. Death screen clears the save.
- **Archetype order:** Merc first (M3), Razor in M6.
- **Input:** keyboard-only for V1; touch / on-screen pad as M7.
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

- `src/rng.js`: `mulberry32` seeded PRNG wrapped in an `Rng` class. Exposes `state` for the M8 save and a labelled `fork(label)` for stable substreams. INVARIANT: `state` mirrors the closure's internal counter; both must move together if mulberry stepping ever changes.
- `src/game/LineOfSight.js`: Bresenham `tilesBetween` plus `hasLineOfSight` (symmetric — traces both directions and requires both to clear) and `hasCoverBetween` for combat. Walls and **live entities** block LOS via the `{ blockers }` option; cover doesn't. Exports `withinRange` — the shared Euclidean-radius check used by Combat, Vision, and the harness.
- `src/game/Vision.js`: per-viewer `VisionField` with `visible`/`seen` sets, recomputed each player move. Bounded by `SIGHT_RANGE` and a circular FOV. Accepts `{ blockers }` so a body on the line breaks the sightline.
- `src/game/Combat.js`: `canFireRanged` + `resolveRanged(world, attacker, target, rng)`. Cover lowers hit threshold by `COVER_HIT_PENALTY`. Throws on illegal preconditions *before* debiting AP — no "ghost shots." Threshold is validated to stay in `[0,1]` so degenerate tuning crashes loudly. Tunable via `BASE_HIT_CHANCE` / `COVER_HIT_PENALTY` / `RANGED_DAMAGE`.
- `src/game/World.js`: `blockerKeys()` returns coordinate keys for every live entity (LOS occlusion). `canMoveEntity` rejects dead actors and crashes on non-integer offsets.
- `Entity` gains `maxHp` / `hp` / `damage(amount)`. Damage clamps to 0 HP and flips `alive=false`; further damage on a corpse throws.
- Renderer: `frame.js` accepts an optional `vision`. Visible cells render normally; remembered cells render the dim tile glyph (no entity); never-seen cells render as `UNSEEN_GLYPH` — a faint mid-dot so the foreground actually paints (the prior `' '` sentinel was skipped by the renderer). `palette.js` adds `dimColor` / `dimGlyph` / `MEMORY_DIM`.
- Input: keymap adds `FIRE_AIM` mode behind `f` + direction → `{ type: 'fire', dx, dy }`.
- Debug harness wires fog-of-war + targeting: `f`+dir scans the line and shoots the first hostile in LOS, sharing `withinRange` and `blockerKeys` with Combat so it can never offer a target Combat would later reject.

### M5 — A* drone AI ✅

- `src/game/Pathfinding.js`: 8-neighbour A* over current passable tiles with a Chebyshev heuristic and an internal binary min-heap. Live entities block by default; the `goal` tile is allowed to be occupied (`allowOccupiedGoal: true`) so an engaging drone can plan a route to the player's tile and take the first step. No caching across calls — destruction in M8 will mutate the grid.
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

### M7 — Touch / on-screen keypad ✅

- `src/input/touchpad.js`: pure dispatcher. Maps button ids (`N`/`NE`/…/`fire`/`melee`/`vault`/`slide`/`wait`/`end-turn`/`cancel`) to synthetic keymap keystrokes, then runs them through the existing `dispatch` machine — single source of truth with the keyboard. Throws on unknown buttons.
- `components/TouchPad.js`: `<touch-pad>` Shadow-DOM web component. 3×3 d-pad + action button column, `pointerdown` (skips the 300ms tap delay and lets us suppress emulated mouse events that would double-fire). Aim banner ("FIRE — pick a direction") and active-button highlight mirror the current mode. Hidden by default; auto-shows under `@media (pointer: coarse)`. Desktop testing override via `?touch=force` URL param or `force-show` attribute. Emits `intent` and `mode-change` CustomEvents — the same shape `KeyboardController` produces, so the harness wires both inputs to one `applyIntent`/`logModeChange` path.
- Debug harness: mounts `<touch-pad>`; `resetInputModes()` clears both controllers on reset/archetype switch and on every `cancel` intent (so a CANCEL/Esc from either side wipes any aim mode the other side was holding — patches the per-input drift caveat for the cancel case specifically).
- Tests: `tests/unit/input/touchpad.test.js` — 24 cases covering button → synthetic-key resolution, all eight directions, all seven actions, action button → aim mode → direction → targeted intent for fire/melee/vault/slide, cancel exits every aim mode, sticky-aim on noise (wait/end-turn inside aim modes is a no-op), unknown button throws. `<touch-pad>` itself is verified visually via the harness, per the "DOM-aware classes — visual verification" rule.

### M8 — Hub, Curator, run lifecycle, death screen ✅

Full milestone plan: `docs/phase-1-milestone-8-plan.md`. Landed in two phases (same milestone, two sessions).

**Phase 1 — pure game-logic layers + tests.**
- `src/game/procgen/bsp.js` — BSP recursive split, deterministic on `Rng`.
- `src/game/procgen/prefabs/` — three authored prefabs (`office`, `server-room`, `hallway`) parsed at load.
- `src/game/procgen/mapBuild.js` — BSP → prefab stamp → corridor carve → spawn/exit/drone placement. Forks the caller rng with `'mapgen'` so combat rolls aren't perturbed by future procgen tweaks.
- `src/game/hub/SafeSpace.js` — authored 12×8 hub with door tile.
- `src/game/hub/Curator.js` — NEUTRAL Curator NPC; `generateContract(rng)` rolls a `{seed, objective, threatCount, label}` (single objective `reach-exit` for now).
- `src/game/Run.js` — `Run` state machine (`HUB → BRIEFING → COMBAT → RESULT`). Owns rng/world/queue/player. Throws on every illegal transition. Surfaces autosave + result via `onPersist` / `onResult` callbacks (no DOM, no DataStore — the shell wires those).
- `src/game/persistence.js` — `snapshot(run)` (delegates to `Run#snapshot`) and `restore(record)` round-trip; corrupt records throw with useful messages. Grid bytes serialised as a plain JS array (cross-runtime portable, see deferred-fix list).
- `src/input/applyIntent.js` — extracted from the M7 debug harness so the new game shell and the harness share one intent-application path.
- 76 new tests under `tests/unit/game/{procgen,hub}/`, `tests/unit/game/{Run,persistence}.test.js`, and `tests/unit/input/applyIntent.test.js`.

**Phase 2 — UI shell, components, and character/help affordances added in chat.**
- `/index.html` promoted from M0 scaffold into the real game shell. DOM panels mount above the canvas; canvas paints during HUB/COMBAT only.
- `<run-briefing>` Web Component — CONTRACT box + JACK IN button.
- `<crash-dump>` Web Component — faux kernel-panic stack trace from telemetry; emits `new-run`.
- `<character-select>` Web Component — modal letting the player pick Merc or Razor; ↑/↓/W/S nav, Enter confirm, Esc/backdrop dismiss. Mounted on first-ever load and on every post-death return-to-Hub; re-openable from a fixed Terminal entity (`‡` glyph) in the Hub. Subsequent refreshes with a sticky prefs archetype skip the modal — the player can still open it explicitly via the Terminal.
- `<key-help>` Web Component — `?` toggles a scope-filtered keybindings overlay (HUB vs COMBAT rows). Shell suppresses `?` while any other modal owns focus, and swallows all keys while `<key-help>` itself is open so held WASD doesn't pump moves into the game underneath.
- `src/game/archetypes/index.js` — `ARCHETYPES` metadata registry (name, blurb, perk key/label) + `buildPlayer(id, spawn)` factory. `Run`, `<character-select>`, and `<key-help>` all read from this single source of truth.
- `src/input/keyHelp.js` — hand-authored `HELP_ROWS` table + `describeKeymap(scope)`. A drift-guard unit test fails CI if `keymap.js` grows a binding without a corresponding help row.
- `src/game/hub/Terminal.js` — NEUTRAL, immobile `‡` kiosk entity placed at `(9,2)` in the Hub. Interact (`i`) when adjacent re-opens `<character-select>`.
- `Run.setArchetype(id)` — legal from `null` / `HUB` only. Rebuilds the Hub player entity in place (preserving the spawn tile), updates telemetry, fires `onPrefsChange`. Snapshots store the archetype implicitly via the player entity class (no extra field).
- `index.js` — wires Run/persistence/DataStore: `onPersist` → `dataStore.addRun/updateRun`; death/exit → `deleteRun`; `onPrefsChange` → `setPref('archetype', id)`. Starting archetype resolves in priority order: URL override (`?archetype=…`) → `dataStore.prefs.archetype` → `'merc'` default. Global `?` keydown listener at window-capture phase owns the `<key-help>` lifecycle (above the keymap so Esc inside help doesn't double-fire as a cancel intent).
- 36 more tests under `tests/unit/game/{archetypes,hub/Terminal}.test.js`, `tests/unit/input/keyHelp.test.js`, plus extensions to `hub/Curator.test.js`, `Run.test.js`, and `persistence.test.js`. **Total: 409 passing** after M8.

## Recorded problems (deferred fixes)

Moved to [`docs/kaizen.md`](./kaizen.md) as Phase 1 closes — that file is the living register, organised into ▶ Phase 2 candidates / ◇ Monitored / ✓ Closed buckets. Phase 1 deliverables are unblocked by any open item; each ▶ entry is a design decision waiting for the Phase 2 plan.

## Test/lint expectations

- `npm test` — `node --test` over `tests/`. Must be green before a milestone is "done."
- `npm run lint` — oxlint, must be 0 warnings 0 errors.
- `npm run format` — prettier (don't commit unformatted files).

## Run scripts

- `npm start` — live-server on :8099. `/index.html` is the M8 game shell (Hub → Briefing → Combat → Death/Exit, with character-select + key-help). `/debug/` is the engineer-facing harness — single hand-built scenario, log feed, archetype hot-swap.
