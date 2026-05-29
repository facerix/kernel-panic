# Look / Inspect — map glyph identification

## Context

Corpses and breach rubble both render as `%` (`glyphForCorpse` and `TILE.RUBBLE` share the same character). The combat key-help legend lists `%` as “rubble” only. Space-interact resolves **adjacent lootable corpses** but does not identify tiles at range, non-lootable corpses, or rubble with no body attached.

**Goal:** A **Look** mode with a **roaming cursor** so the player can point at a glyph and read a short identification line in the log feed — especially to disambiguate `%`.

**Scope:** Tier 2 (ship-quality): cursor highlight, keyboard + touch pad, pure describe module, unit tests, key-help fix, debug harness parity.

**Out of scope:** Canvas tap-to-inspect, HP/id dumps, chronicle-flavoured breach prose, corp-turn Look (see decisions below).

## Locked decisions

| Topic | Decision |
|-------|----------|
| Targeting | **Roaming cursor** — enter Look, move cursor with direction keys / touch d-pad, description updates on each move |
| Corp turn | **Disallowed** — same gate as other player intents; no Look-specific input path during corp turn |
| Detail level | **Minimal+** — faction / label / state (locked, sliced, salvageable, …); no HP, entity ids, or door ids |
| Floor tiles | **No-op** — `TILE.FLOOR` produces no log line in Hub or Combat (`.` needs no explanation) |
| AP cost | **0** — observation only; does not end the player's turn |

## Player flow

```
l  (or touch LOOK)  →  enter MODE.LOOK; cursor starts on player tile
direction keys      →  move cursor one Chebyshev step (clamp to map + visibility rules)
                    →  if tile is describable, flash one line to the log; floor = silent
Esc / CANCEL        →  exit MODE.LOOK, clear cursor
```

Status bar shows `LOOK` while active (mirror `AIM FIRE` / `AIM SPECIAL` banner pattern).

**Corp turn:** if the queue belongs to CORP, Look entry is rejected with the same “controls locked” messaging as move/fire (no special-case wiring).

## Visibility rules (Combat)

Mirror fog-of-war honesty from `frame.ts` / `VisionField`:

| Tile state | Cursor may move here? | Describe? |
|------------|----------------------|-----------|
| **Visible** (`vision.isVisible`) | Yes | Full detail (entities + terrain except floor no-op) |
| **Memory** (`hasSeen`, not visible) | Yes | Terrain only (rubble, cover, exit, smoke, hazard, wall). **Memorised corpse:** if `vision.memorisedCorpses` has the coord **and** a dead entity still occupies the tile → minimal+ corpse line tagged `(memory)`. No live-entity intel. |
| **Never seen** | No — cursor clamp skips these cells | — |

**Hub:** no fog. Cursor roams the full hub grid. Hub NPC tiles describe by role label (Curator, Finn, Patch, Terminal). Floor = no-op.

## Describe logic — `src/game/describe.ts` (new, pure)

```typescript
describeTileAt(
  world: World,
  tx: number,
  ty: number,
  options?: { vision?: VisionField }
): string | null
```

Returns a **single log-ready string** (no leading `>` — shell adds that), or **`null`** for no-op (floor, or nothing to say).

### Resolution priority (topmost wins)

Use the same entity stacking order as `buildFrame` (dead → passable live → impassable live). Add **`World.entitiesAt(x, y): Entity[]`** so stacked occupants are ordered deterministically; describe the topmost visible layer. Defer “Also here: …” to a future polish pass unless a test proves it’s needed.

When the tile is not inspectable (never seen, or out-of-bounds): return a refusal string.

### Entity lines (Minimal+)

Reuse `entityLabel` from `Entity.ts`. Add state clauses via `instanceof` / known fields — **not** raw ids:

| Kind | Example output |
|------|----------------|
| Live hostile (`Hostile`, turret, relay) | `[Corp] Drone` |
| Corpse + salvage | `[Corp] Drone corpse — salvageable` (+ optional compact salvage via `formatSalvageCompact` if loot present) |
| Corpse, no salvage | `[Corp] Drone corpse — stripped` |
| `Door` | `[Neutral] Door — locked` / `… — open` |
| `Terminal` | `[Neutral] Terminal — armed` / `… — sliced` |
| `Pickup` / objective | `[Neutral] Pickup — unsecured` / `… — secured` |
| `Contact` | `[Neutral] Contact — handoff pending` / `… — complete` |
| `SyncPad` | `[Neutral] Sync Pad — pending` / `… — synced` |
| `ConsumablePickup` | `[Neutral] Field cache` (or pickup label if authored) |
| `KeyCard` | `[Neutral] Access keycard` |
| `BreachingCharge` | `[Neutral] Breaching charge — armed` |
| `EscortNpc` | `[Neutral] Escort — linked` / `… — waiting` |
| `DenyTarget` | `[Corp] Asset` (live) |
| Hub NPCs (shell passes hub entity map or hard-coded ids) | `Curator`, `Finn — shop`, `Patch — clinic`, `Crew terminal` |

Memorised corpse out of LOS: append `(memory)` to the corpse line; omit salvage detail if not currently visible (player hasn’t re-entered LOS).

### Terrain lines (non-floor)

| Tile | Example output |
|------|----------------|
| `RUBBLE` | `Rubble — breach debris (2 AP to enter)` |
| `WALL` | `Wall — impassable` |
| `COVER` | `Cover — blocks line of sight` |
| `EXIT` | `Exit — extraction point` |
| `SMOKE` | `Smoke — blocks line of sight` |
| `HAZARD` | `Hazard — damage if you stand here` |
| `FLOOR` | **`null` (no-op)** |

## Input layer

### `src/input/keymap.ts`

- Add `MODE.LOOK = 'LOOK'`.
- **`l`** in `MODE.IDLE` → `{ intent: null, nextMode: MODE.LOOK, aimKind: null }` (mode entry handled by shell on mode change, same as entering aim without immediate intent).
- In `MODE.LOOK`:
  - Direction keys → `{ intent: { type: 'look-move', dx, dy }, nextMode: MODE.LOOK, aimKind: null }`
  - `Escape` → `{ intent: { type: 'cancel' }, nextMode: MODE.IDLE, aimKind: null }`
- **`look-move` is not routed through `applyIntent`** — shell handles it before/alongside intent dispatch (like help toggle). Keeps the combat applier closed and avoids corp-turn exceptions inside `applyIntent`.

Alternative if we want zero new intent types: shell intercepts direction keys while `mode === MODE.LOOK` before calling `KeyboardController` / touch dispatch. Either way, **no world mutation**.

### `src/input/keyHelp.ts`

Add combat + hub row:

```typescript
{ keys: ['l'], label: 'Look — inspect map (move cursor, Esc to exit)', scope: 'both', group: 'action' }
```

Update sentinel test in `tests/unit/input/keyHelp.test.ts`.

### `src/input/touchpad.ts` + `components/TouchPad.ts`

- New action button: `{ id: 'look', label: 'LOOK', shortcut: 'l' }` in the action column (after INTERACT or before WAIT — tune for thumb reach).
- Banner while active: `LOOK — move cursor (Esc to cancel)`.
- `dispatchTouchAction('look', …)` from IDLE: synthetic `'l'` to enter mode; in LOOK, d-pad slots emit direction keys through the same path as keyboard.

### Corp-turn gate (shell)

In the intent/mode handler (before mode entry and before `look-move`):

```typescript
if (run.state === RUN_STATE.COMBAT && run.queue.currentFaction !== FACTION.PLAYER) {
  if (enteringLook || lookMove) {
    flash('CORP TURN — controls locked until security finishes.');
    return;
  }
}
```

## Shell wiring (`index.ts`)

**Module state:**

```typescript
let lookCursor: { x: number; y: number } | null = null;
```

- **`enterLookMode()`** — set cursor to player position; set keyboard + touch pad to `MODE.LOOK`; `flash('LOOK — move cursor (Esc to cancel).')`; `paint()`.
- **`exitLookMode()`** — clear cursor; `resetInputModes()`; `paint()`.
- **`handleLookMove(dx, dy)`** — corp-turn guard; clamp cursor; if move blocked (never-seen), optional silent no-op or `flash('You haven't been there.')` once; else `const line = describeTileAt(...)`; if `line`, `flash(line)`.
- **`cancel`** intent while in LOOK → `exitLookMode()` (extend existing cancel handler / `resetInputModes`).
- **`resetInputModes()`** — also clear `lookCursor`.

Pass `lookCursor` into `renderer.draw(..., { lookCursor })`.

**Hub describe:** pass hub NPC entity refs from `campaign` into `describeTileAt` via options, or a thin `describeHubTileAt(campaign, tx, ty)` wrapper that delegates to the same module.

## Renderer — cursor highlight

**`src/render/frame.ts`** (or `AsciiRenderer` post-pass):

- New draw option: `lookCursor?: { x: number; y: number }`.
- If cursor cell is in the current camera viewport, render with a distinct treatment:
  - **Preferred:** bracket the glyph — e.g. `{` + char + `}` with accent fg `#00d9a5`, or invert fg/bg on that cell only.
  - Must remain readable on UNSEEN/MEMORY dims — cursor only moves to seen/visible cells in combat, so normal case is full or memory tile.

Unit test in `tests/unit/render/frame.test.ts`: frame with `lookCursor` set marks the expected cell index.

## Key help — `%` legend fix

In `components/KeyHelp.ts` combat universal tiles:

```diff
- h('dd', { textContent: 'rubble' }),
+ h('dd', { textContent: 'rubble or corpse' }),
```

Optional footnote in intro: “Corpses and rubble share `%` — use Look (`l`) to tell them apart.”

## Debug harness (`debug/index.ts`)

Parity with M8 shell:

- Wire `l` / LOOK mode and cursor state.
- Log describe lines to the harness feed.
- Corp-turn rejection message matches shell.

## Tests

### `tests/unit/game/describe.test.ts` (new)

- Rubble tile → breach debris line, mentions 2 AP enter
- Corpse with salvage → label + salvageable (+ compact salvage)
- Stripped corpse → stripped / empty wording
- Live drone on tile → live label, not corpse
- Floor → `null`
- Unseen coord → refusal string
- Memory + memorised corpse + body still present → corpse line with `(memory)`
- Memory + corpse salvaged away → terrain line only (no phantom corpse)
- Door locked / open state clauses
- Terminal sliced / armed
- Hub Curator tile → `Curator` (via hub wrapper or options)

### `tests/unit/game/World.test.ts`

- `entitiesAt` ordering matches frame builder precedence

### `tests/unit/input/keymap.test.ts` (or extend existing)

- `l` from IDLE → `MODE.LOOK`
- direction in LOOK → `look-move` intent
- Esc in LOOK → cancel + IDLE

### `tests/unit/render/frame.test.ts`

- Cursor highlight on expected cell

## Service worker

Add `/src/game/describe.js` to `sw-core.js` `getCoreResources()` when the module ships. Bump SW cache version if needed.

## File summary

| File | Action |
|------|--------|
| `src/game/describe.ts` | **New** — pure `describeTileAt` |
| `src/game/World.ts` | Add `entitiesAt(x, y)` |
| `src/input/keymap.ts` | `MODE.LOOK`, `l`, `look-move` intent shape |
| `src/input/keyHelp.ts` | Look row |
| `src/input/touchpad.ts` | `look` action |
| `components/TouchPad.ts` | LOOK button + banner |
| `components/KeyHelp.ts` | `%` legend + optional intro note |
| `src/render/frame.ts` | `lookCursor` highlight |
| `src/render/AsciiRenderer.ts` | Pass through `lookCursor` |
| `index.ts` | Look mode state, handlers, corp gate, paint |
| `debug/index.ts` | Harness parity |
| `sw-core.js` | Precache new module |
| `tests/unit/game/describe.test.ts` | **New** |
| `tests/unit/game/World.test.ts` | `entitiesAt` |
| `tests/unit/input/keyHelp.test.ts` | Sentinel update |
| `tests/unit/render/frame.test.ts` | Cursor highlight |

## Verification

1. `npm run format` → `npm run lint` → `npm test` — all green
2. Manual combat: breach a wall → `%` rubble; kill drone → `%` corpse; **`l`**, move cursor to each → distinct lines
3. Duck out of LOS: memorised corpse still describable with `(memory)`; live drone hidden
4. Corp turn: **`l` rejected**; cursor cannot move
5. Hub: **`l`** on Curator / Finn / floor — NPCs describe, floor silent
6. Touch: LOOK button enters mode; d-pad moves cursor; CANCEL exits
7. Key help shows `l` and updated `%` entry

## Kaizen follow-up

When shipped, update [`docs/kaizen.md`](./kaizen.md): move the Look item to **✓ Closed** with a pointer to this doc and the shipped module.
