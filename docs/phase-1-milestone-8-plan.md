# M8 — Hub, Curator, Run lifecycle, Death screen

## Context

Phase 1's playable surface today is the M7 debug harness with a hand-built map. M8 is the milestone that turns the engine into a *run*: a procedurally-generated mission with a beginning (Hub + Curator briefing), a middle (combat on a BSP+prefab-stamped map), an end (death or exit), and a cradle that survives a refresh (autosave-on-turn-end + resume prompt). It also promotes `/index.html` from the M0 scaffold into the real game shell — the debug harness stays as the engineer-facing surface, but a fresh visitor lands on a real game.

The locked-in decisions from `docs/phase-1-plan.md` we're honoring:

- **Procgen:** prefab-hybrid (BSP + authored prefab leaves), seeded `mulberry32` so maps are reproducible in tests.
- **Save flow:** autosave on `turn:ended`. Resume prompt via `<confirmation-modal>` (already exists). Death clears the save. `beforeunload` is *not* used.
- **Crash > silent fallback:** illegal state transitions, missing entities on restore, unknown event types — all throw.

User choices on this milestone:

- **Save model:** full snapshot (grid bytes + entities + Rng state + run state). Survives any future non-determinism.
- **App shell:** promote `/index.html` now.
- **Briefing/Result UI:** DOM panels above the canvas; canvas paints during HUB/COMBAT only.
- **Procgen scope:** lean — 3 prefabs, single mission map per run.
- **Character select:** dismissable Shadow-DOM modal that mounts on every `enterHub()`. Player can re-open it from the Hub by interacting with a fixed Terminal entity. Choice persists until next Hub entry; archetype lives implicitly on the player entity (glyph/perks), so no new snapshot field is needed.
- **Help overlay:** `?` toggles a `<key-help>` Shadow-DOM panel. Available in HUB and COMBAT only (suppressed while BRIEFING / RESULT / character-select / resume-confirm modals are mounted). `?` or `Esc` closes it.

## Approach

### File layout (all new)

```
src/game/
  Run.js                       — state machine (HUB → BRIEFING → COMBAT → RESULT)
  persistence.js               — pure snapshot/restore round-trip
  procgen/
    bsp.js                     — pure recursive region splitter (rng + region → leaves)
    mapBuild.js                — pure: buildMap({rng, width, height}) → { grid, spawns, drones, exitTile }
    prefabs/
      index.js                 — PREFABS registry; each prefab is { id, w, h, tiles, anchors }
      office.js
      server-room.js
      hallway.js
  hub/
    SafeSpace.js               — buildHub() → { grid, playerSpawn, curatorSpawn, terminalSpawn, exitTile }
    Curator.js                 — Entity subclass; faction NEUTRAL; generateContract(rng) → { seed, objective, threatCount }
    Terminal.js                — Entity subclass; faction NEUTRAL, immobile, glyph 'T'; interact re-opens character select
  archetypes.js                — ARCHETYPES registry: { id, name, glyph, blurb, perks, baseStats }; one entry each for Merc and Razor

src/input/
  keyHelp.js                   — describeKeymap() → [{ key, intent, label, scope: 'hub'|'combat'|'both' }] for <key-help> to render

components/
  CrashDump.js                 — <crash-dump> Shadow-DOM panel; faux kernel-panic stack
  RunBriefing.js               — <run-briefing> Shadow-DOM panel; CONTRACT box + JACK IN button
  CharacterSelect.js           — <character-select> Shadow-DOM modal; lists archetypes with blurb + perks; emits `pick` CustomEvent
  KeyHelp.js                   — <key-help> Shadow-DOM panel; renders describeKeymap() filtered by current Run.state

index.js                       — NEW: game shell entry; mounts Run, wires DataStore + bus + UI
index.html                     — UPDATE: mount components, replace caption with game body
```

### Module responsibilities

**`src/game/procgen/bsp.js`** (pure)
- `splitRegion(rng, region, opts)` — recursive BSP. Returns a tree of leaf rects.
- Tunables: `MIN_LEAF`, `MAX_LEAF`, `SPLIT_RATIO_RANGE`. Throws if region < `MIN_LEAF`.
- Pure function over an `Rng`; same seed → same tree.

**`src/game/procgen/mapBuild.js`** (pure)
- `buildMap({ rng, width, height })` →  `{ grid: Grid, spawns: { player: {x,y} }, drones: [{x,y, waypoints:[…]}], exitTile: {x,y} }`.
- Steps: BSP → stamp a prefab into each leaf → carve corridors between sibling-leaf centroids → place player spawn in first leaf, exit tile in last leaf, drones at prefab-declared anchors.
- Uses `rng.fork('mapgen')` so the combat RNG stream isn't perturbed by future procgen tweaks.

**`src/game/procgen/prefabs/`** — 3 prefabs:
- `office.js` — 5×4 with 1–2 cover desks, 1 drone anchor.
- `server-room.js` — 6×5 with rack-aligned cover columns, 1 drone anchor.
- `hallway.js` — 8×3 corridor with cover at thirds, 0 drone anchors.
- Each prefab is `{ id, w, h, tiles: Uint8Array, anchors: { drones: [{x,y,waypoints}], cover: […] } }`. Hand-authored as ASCII strings parsed at module load (one parser in `prefabs/index.js`).

**`src/game/hub/SafeSpace.js`** (pure)
- `buildHub()` — small fixed room (12×8). Walls, a door tile that's the exit, Curator at (3,3), Terminal at (9,3), player spawn at (6,5). No procgen — hub is authored.
- Returns `{ grid, playerSpawn, curatorSpawn, terminalSpawn, exitTile }`.

**`src/game/hub/Curator.js`**
- `class Curator extends Entity` — faction `NEUTRAL`, glyph `'C'`, immobile.
- `generateContract(rng)` → `{ seed: rng.intRange(0, 0x7fffffff), objective: 'reach-exit', threatCount: 2, label: 'Sublevel 3 cache' }`. Stub for now — single objective type.
- Player triggers via `interact` intent (the `i` key, already in keymap) when adjacent. Hub harness wires `interact` → `Run.beginBriefing(curator.generateContract(rng))`.

**`src/game/hub/Terminal.js`**
- `class Terminal extends Entity` — faction `NEUTRAL`, glyph `'T'`, immobile.
- No `generate*` method; the Hub shell wires `interact` on this entity → re-mounts `<character-select>`. Fictionally the "loadout terminal."

**`src/game/archetypes.js`**
- Exports `ARCHETYPES = { merc: {...}, razor: {...} }`. Each entry: `{ id, name, glyph, blurb, perks: ['vault'|'slide'], baseStats: { hp, ap, … } }`.
- `buildPlayer(archetypeId, { x, y })` → `Entity` configured with the archetype's glyph, stats, and perk bindings. Merc → `vault` (key `v`, already implemented); Razor → `slide` (key `t`, already implemented). The Hub and `Run.enterCombat()` both use this — archetype identity is implicit in the resulting `Entity`, so no separate snapshot field is needed.
- Throws on unknown `archetypeId` (silent-fallback rule).

**Archetype preference (cross-run)**
- DataStore `prefs`: `{ archetype: 'merc'|'razor' }`. Separate from the run records so it survives death/exit (which delete run records).
- On `enterHub()`: read `DataStore.prefs.archetype`; if missing (first ever load), default to `'merc'`, mount `<character-select>` with the merc highlighted as default; otherwise use the stored value.
- On `<character-select>` `pick` event: `Run.setArchetype(id)` **and** update persist via `DataStore.setPref('archetype', newValue)`.
- `restore()` does not need to touch prefs — the restored player entity already encodes its archetype via glyph/perks.

**`src/game/Run.js`**
- `class Run` — owns `state ∈ { HUB, BRIEFING, COMBAT, RESULT }`, current `Rng`, current `World`, current `TurnQueue`, current player Entity, current contract, current `archetypeId` (latched from character select; defaults to `null` until first pick).
- Transitions are explicit methods that throw on illegal source state:
  - `enterHub()` — only from `null`/`RESULT`/save-load. Emits `hub:entered` so the shell mounts `<character-select>` once per visit.
  - `setArchetype(id)` — legal from `HUB` only. Rebuilds the Hub player entity via `archetypes.buildPlayer(id, hub.playerSpawn)`.
  - `enterBriefing(contract)` — only from `HUB`. Throws if `archetypeId === null` (character select must have resolved at least once).
  - `enterCombat()` — only from `BRIEFING`. Builds map via `mapBuild`, calls `archetypes.buildPlayer(archetypeId, spawn)` for the combat player, places drones, swaps the active world.
  - `enterResult({ outcome, telemetry })` — only from `COMBAT`. Outcome ∈ `{ DEATH, EXIT }`.
- Subscribes to `turn:ended` → calls `persistence.snapshot()` and `DataStore.updateRun(snapshot)`.
- Subscribes to `entity:damaged` → if player dies, `enterResult({ outcome: DEATH, telemetry })`.
- Tracks telemetry: turn count, kills, archetype, last damage source, seed, hp at death.

**`src/game/persistence.js`** (pure)
- `snapshot(run)` → plain JSON record:
  ```js
  {
    id: <stable run id>,
    type: 'run',
    state: 'COMBAT',
    turnNumber, currentFaction,
    rng: { seed, state },
    contract: { seed, objective, threatCount, label },
    grid: { w, h, tiles: <base64 of Uint8Array> },
    entities: [{ archetype, id, x, y, faction, hp, maxHp, ap, maxAp, stealthed, drone?: {state, lastKnown} }, …],
    telemetry: { turn, kills, … },
  }
  ```
- `restore(record)` → `{ rng, world, turnQueue, run, player }`. Crashes loudly on missing fields, unknown archetype, OOB entity, grid byte length mismatch.
- Pure — no DOM, no DataStore. Tested via round-trip.

### UI

**`/index.html`** — game shell:
- Mounts: `<canvas id="game-canvas">`, `<run-briefing>`, `<crash-dump>`, `<confirmation-modal>`, `<touch-pad>`, `<update-notification>` (existing).
- `index.js` (new) — instantiates `KeyboardController`, `Run`, subscribes to `confirmation-modal` confirm/cancel for resume prompt, drives the canvas `AsciiRenderer` + `CrtFilter` per current `Run.state`.
- Hub renders on canvas (same renderer); BRIEFING and RESULT are DOM overlays (canvas hidden via `hidden` attr or CSS).

**`<run-briefing>`** — Shadow-DOM panel built with `h()`. Properties: `setContract({seed, label, threatCount, objective})`. Emits `jack-in` CustomEvent on the JACK IN button. Mirrors the user's selected ASCII preview style:

```
┌────────── CONTRACT ──────────┐
│ TARGET:  Sublevel 3 cache    │
│ SEED:    0x1A4F22B9          │
│ THREAT:  2 drones            │
│ OBJ:     Reach exit tile     │
│         [ JACK IN ]          │
└──────────────────────────────┘
```

**`<crash-dump>`** — Shadow-DOM panel. `setTelemetry({archetype, turn, kills, cause, seed, hpAtDeath})` → renders as a faux kernel panic:

```
*** KERNEL PANIC ***
fault:  unhandled_exception_in_meatspace
addr:   0x00000@meatspace
trace:
  0x01  merc::take_damage(2)            <killed>
  0x02  combat::resolveRanged(drone#3)
  …
seed:   0x1A4F22B9
turn:   24
kills:  3
[ NEW RUN ]
```

Emits `new-run` on the button. The shell handler clears the save and calls `Run.enterHub()`.

**`<character-select>`** — Shadow-DOM modal built with `h()`. Properties: `setArchetypes(list)`. Emits `pick` CustomEvent with `{ archetypeId }` and `dismiss` on Esc / outside-click. Dismissable: the player can close it without picking (the previously-chosen archetype, or the default if none, stays in effect). Re-opened from the Hub by `interact` adjacent to the Terminal entity.

```
┌─────── SELECT OPERATOR ───────┐
│ > MERC                        │
│     ranged specialist         │
│     perk: VAULT (v) — hop     │
│           cover & fire        │
│                               │
│   RAZOR                       │
│     stealth / melee           │
│     perk: SLIDE (t) — 2-tile  │
│           silent dash         │
│                               │
│   [ ENTER to confirm  Esc ]   │
└───────────────────────────────┘
```

The in-world player glyph stays `'@'` for both archetypes (matches the existing `Merc`/`Razor` constructors). Archetype identity surfaces in three places only: the character-select panel, the snapshot record (`archetype: 'merc'|'razor'`), and the key-help panel (perk-key row label changes).

**`<key-help>`** — Shadow-DOM panel built with `h()`. Reads `describeKeymap()` from `/src/input/keyHelp.js` and renders rows grouped by scope, filtered to the current `Run.state` (HUB or COMBAT). `?` or `Esc` closes; the same key opens it. The shell suppresses `?` while any other modal (`<run-briefing>`, `<crash-dump>`, `<character-select>`, `<confirmation-modal>`) is mounted, so help never overlays a blocking dialog.

```
┌──────────── KEYS ────────────┐
│  MOVE                        │
│   W A S D / arrows  step     │
│  ACTION                      │
│   f                  fire    │
│   space              melee   │
│   i                  interact│
│   v                  vault   │
│   t                  slide   │
│  SYSTEM                      │
│   ?                  this    │
│   Esc                cancel  │
└──────────────────────────────┘
```

`?` is handled by a top-level keydown listener in `index.js`, **not** routed through `applyIntent` — it's a UI concern, not a game intent, so the keymap stays focused on simulation keys. The same listener owns the open/close/scope-filter logic.

### Save / resume flow

- On boot: `await DataStore.init()` → get the most recent run via `DataStore.currentRun`. If a run exists, mount `<confirmation-modal>` with `Resume your last run?`. **Confirm** → `persistence.restore()` → `Run.enterCombat(restoredWorld)`. **Cancel** → `DataStore.deleteRun(id)` → `Run.enterHub()`.
- Each `turn:ended` event → `DataStore.updateRun(snapshot(run))`. ID is stable across turns (assigned on first `addRun`).
- On `Run.enterResult({ DEATH })` → `DataStore.deleteRun(id)`, then mount `<crash-dump>`.
- On `Run.enterResult({ EXIT })` → also clear save (run is over). Show a brief result panel or skip straight to crash-dump-style debrief — for M8, reuse `<crash-dump>` styled as "JACK OUT" with the same kill/seed/turn fields. (Keeps component count down.)

### Integration touch points (no behavior changes, wiring only)

- `Run` constructs the `EventBus` and passes it to `World` / `CorpDrone.bindToBus` exactly as the harness does today.
- `index.js` reuses the existing `applyIntent` shape from `/debug/index.js` — lift that helper into `src/input/applyIntent.js` so both shells share it. (Nice cleanup, not strictly required; flag if we want to defer to M9.)

### Tests

New under `tests/unit/`:

- `game/procgen/bsp.test.js` — split on a fixed seed produces a known leaf tree; every leaf rect is inside the parent; min-leaf invariant holds; throws on too-small input.
- `game/procgen/mapBuild.test.js` — same seed → identical grid bytes (determinism); player spawn ≠ exit tile; every floor cell reachable from spawn via `Pathfinding.findPath`; drone count matches threat budget.
- `game/procgen/prefabs.test.js` — every prefab parses; declared anchors are inside its bounds; tile bytes only contain known TILE values.
- `game/hub/Curator.test.js` — `generateContract` is deterministic on the same Rng state; threat count > 0; objective in the known set.
- `game/Run.test.js` — every legal transition succeeds; every illegal transition throws (e.g. `HUB → COMBAT` direct, `COMBAT → HUB`, double `enterHub`); `enterBriefing` throws if `archetypeId` is still null; `setArchetype('merc')` rebuilds the Hub player entity with the merc glyph/stats; `enterHub()` with no prefs record defaults archetype to `merc`; `enterHub()` with `prefs.lastArchetypeId === 'razor'` defaults to razor; `setArchetype(id)` writes back to the prefs record; `enterResult(DEATH)` clears the run record but leaves prefs intact; `turn:ended` triggers a snapshot write; player-killed `entity:damaged` triggers `enterResult(DEATH)`.
- `game/persistence.test.js` — `snapshot → restore → snapshot` is byte-for-byte stable; corrupt records (missing rng, OOB entity, bad grid length) throw with a useful message; restored Rng produces the same next 5 numbers as the live one before save.
- `game/archetypes.test.js` — `buildPlayer('merc', {x,y})` and `buildPlayer('razor', {x,y})` produce entities with the expected glyph, hp/ap, and perk tags; unknown id throws.
- `game/hub/SafeSpace.test.js` — `buildHub()` places Curator, Terminal, and player spawn on walkable tiles; Curator and Terminal are not on the same tile; exit tile is reachable from spawn.
- `input/keyHelp.test.js` — `describeKeymap()` returns one row per bound key in `keymap.js` (no orphan rows, no missing keys); every row has a non-empty `label` and a valid `scope`.

`<crash-dump>`, `<run-briefing>`, `<character-select>`, and `<key-help>` follow the project rule for DOM-aware classes: visually verified via the shell, not unit-tested. (Same as `<touch-pad>` in M7.)

### Critical reuses (already exist — do not reinvent)

- `<confirmation-modal>` — `/components/ConfirmationModal.js`, `showModal(message, context)`, `confirm`/`cancel` events.
- `DataStore` — `/src/DataStore.js`. `currentRun` getter, `addRun(run)`, `updateRun(run)`, `deleteRun(id)`, `prefs` getter, `setPref(key, value)`, addEventListener('change')` for reactivity.
- `Rng.fork(label)` — `/src/rng.js`. Use `'mapgen'` for procgen substream; the main stream stays for combat.
- `EventBus` (events.js) — closed type set; `turn:ended` already emitted by `TurnQueue.endTurn`.
- `h()` — `/src/domUtils.js`. All new DOM goes through it (no `createElement`).
- `Pathfinding.findPath` — `/src/game/Pathfinding.js`. Reused in the BSP connectivity test (every floor reachable from spawn).
- `frame.buildFrame` / `cameraFor` — `/src/render/frame.js`. Hub and combat render through the same path; only the world differs.
- Existing `applyIntent` logic in `/debug/index.js` — copy-or-extract into a shared helper.

### Open caveats / deferred problems to log

- Map destruction during a run (cover blown apart) is in scope only for the snapshot side — procgen produces the initial grid; mid-run grid mutations land in the snapshot's `grid.tiles` field and replay correctly. Actual destructible-cover mechanics are still post-M8 per the blueprint.
- HP carry-over Hub→Combat→Hub: M8 starts a combat run with full HP and discards the player on death. Persistent character HP between runs is a Phase-2 concern.
- `Run` only knows `objective: 'reach-exit'` for now — Curator quest stub is intentionally narrow.
- Stealth-on-attack (recorded problem #131 in phase-1-plan.md) remains deferred; not part of M8.
- Character select is binary (Merc / Razor) and per-run; no progression, no unlock gating, no archetype-specific Curator dialogue. Phase-2 concerns.
- `<key-help>` reads `describeKeymap()` at render time; if a future milestone adds new bindings, the help panel updates automatically, but the `scope` field on each row is hand-tagged — easy to drift. Worth a lint-ish test that every keymap entry has a corresponding `keyHelp` row (covered above in `keyHelp.test.js`).

## Verification

End-to-end (manual, on `/index.html` via `npm start`):

1. **Fresh load (first ever)** → Hub renders on canvas; `<character-select>` mounts with Merc highlighted as default; Curator at (3,3), Terminal at (9,3), player spawn at (6,5). Pressing Enter (or clicking Merc) closes it; player glyph is `@`. Esc dismisses with Merc still in effect. DataStore `prefs` now has `archetype: 'merc'`.
2. **Re-open character select** → walk adjacent to Terminal, press `i` → `<character-select>` re-mounts with Merc highlighted; pick Razor → the Hub player entity is rebuilt as a `Razor` instance (in-world glyph still `'@'`); prefs record updated to `razor`.
3. **Subsequent fresh load** → reload page; `<character-select>` does not mount, as Razor (last pick) is still active.
4. **Briefing** → `i` adjacent to Curator opens `<run-briefing>` with seed/objective/threat count. (Confirm `enterBriefing` did not throw — at least one archetype was picked.)
5. **JACK IN** → canvas swaps to a procedurally-generated map; spawn placement valid; drones present; combat works (M3–M7 features all still functional); the player entity class matches the chosen archetype; the perk key (`v` for Merc, `t` for Razor) fires the archetype perk, and the *other* perk key is inert.
6. **Help overlay** → pressing `?` in Hub or Combat mounts `<key-help>` with the correct scope's keys; `?` or Esc dismisses it. Pressing `?` while `<run-briefing>` / `<crash-dump>` / `<character-select>` / `<confirmation-modal>` is mounted is a no-op.
7. **Turn end** → DataStore `runs` array shows a run record with current state; `rng.state` advances each turn.
8. **Refresh mid-combat** → `<confirmation-modal>` mounts. Confirm → exact same world restored (entity HP, AP, drone state, RNG continuation, turn number, player archetype class, working perk key). Cancel → run record deleted, lands in Hub with same archetype as in the dropped run.
9. **Death** (let drones down player) → `<crash-dump>` shows seed/turn/kills/cause/archetype name; run record deleted; `prefs` preserved; `New Run` button returns to Hub with last-selected prefs archetype still active.
10. **Exit-tile reach** → same flow, JACK OUT framing.

Automated:

- `npm test` — green; new tests above pass; existing 297 still pass.
- `npm run lint` — 0 warnings 0 errors.
- `npm run format` — clean.

Then `docs/phase-1-plan.md`: flip M8 to ✅, add the new test count, log any new deferred problems we surfaced during implementation.
