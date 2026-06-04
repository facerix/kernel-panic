# Phase 2.8 Plan — Combat HUD on canvas

Living plan for the post–Phase 2.7, pre–Phase 2.9 polish slice: move the **highest-signal combat status** off the DOM status bar and onto the **canvas renderer**, where the player's eyes already are. **Target release: `v0.2.8`.** See [phase-2.7-plan.md](phase-2.7-plan.md) for the hostile roster this HUD reflects, [phase-2.9-plan.md](phase-2.9-plan.md) for principal theming (blocked until this lands), and [phase-2.5-plan.md](phase-2.5-plan.md) M7.2 for the existing top-left location chip pattern.

## Why this phase exists

Playtesting after Phase 2.7 surfaced a readability gap: the status bar below the canvas packs identity, AP/HP, objective state, turn phase, alerts, hazards, and two activity rows into a narrow band that **competes for attention** with the map. On tablet-first layouts the bar is easy to miss entirely — especially AP/HP during a corp turn when controls lock.

Phase 2.5 already trained corner-reading with the **location chip** (`AsciiRenderer` `locationLabel`, top-left row 1). Phase 2.8 extends that pattern: persistent combat chrome painted **inside** the canvas frame, legible over map glyphs via the same dark backing + accent underline treatment.

**Direction chosen:**

- **Glyphs over numbers for vitals** — HP and AP render as segment/pip rows (`□`/`■`, `○`/`●`) instead of `2/3` text. Faster at-a-glance parsing; matches the ASCII-plus terminal aesthetic (no emoji in shipped glyphs).
- **Corners own persistent state; the DOM bar owns transient narrative** — objective, identity, vitals, and turn phase move to canvas; alerts, hazards, proximity hints, corp mood, and action lines stay in `#game-status`.
- **Retire the corp static overlay** — the CSS grain layer (`.game-canvas-static.kp-corp-static`) is replaced by an explicit bottom-left turn indicator so corp phase reads even when hostiles act off-screen.

---

## HUD layout (combat only)

All chrome is **combat-scoped** — Hub / briefing / debrief keep their existing DOM status lines.

```
┌─ LOCATION (existing M7.2) ──────────────── CALLSIGN [CLASS] ─┐
│  OBJ Title [TODO|DONE] [TURN:n] [MAP:x/y]                    │
│                                              HP □■■           │
│                                              ○○●●           │
│                                                               │
│                     (map glyphs)                              │
│                                                               │
│ TURN 12                    or              HOSTILES ACTIVE    │
└───────────────────────────────────────────────────────────────┘
```

| Zone | Row | Content | Example |
|------|-----|---------|---------|
| Top-left | 1 | Site label (existing) | `VUONG HOLDINGS SERVER FARM` |
| Top-left | 2 | Objective name + status | `OBJ Sentinel window [TODO] [TURN:4]` |
| Top-right | 1 | Operative callsign + class | `Patch [TECH]` |
| Top-right | 2 | HP segments | `HP □■■` (1 empty / 3 max) |
| Top-right | 3 | AP pips | `○○●●` (2 remaining / 4 max) |
| Bottom-left | 1 | Turn phase | Player: `TURN 12` · Corp: `HOSTILES ACTIVE` |

**Alignment:** top-left rows left-aligned; top-right rows right-aligned; bottom-left turn indicator left-aligned. Each row gets the location-chip backing box so text stays legible over bright glyphs.

**Colors (initial lean):**

| Element | Color | Notes |
|---------|-------|-------|
| Location / objective labels | `#9ff3da` / accent `#6ae8c8` | Match existing location chip |
| Objective `[DONE]` | `#7dff9d` | Same as `.objective-tag .done` |
| Objective `[TODO]` / turn budget | `#ff7a66` or existing `.todo` hue | Match DOM tags |
| Identity | `#6ae8c8` | Match `.game-shell__stats` |
| HP filled segments | `#6ae8c8` | Player vitals green |
| HP empty segments | `#2a4a42` dim | Low-contrast empty slot |
| AP remaining pips | `#6ae8c8` | Active AP |
| AP spent pips | `#ff7a66` | Spent / unavailable (user sketch used red) |
| Turn indicator (player) | `#b8f5e2` | Neutral phase read |
| Turn indicator (corp) | `#ff7a66` | Hostile phase — replaces static grain as the "something is happening" signal |

**Stealth:** append `[CLOAKED]` to the identity row (or a dim suffix on row 1) when `player.stealthed` — same signal today lives in the stats line.

**Recon / turn-limit objective extras:** carry forward the optional suffixes already built in `objectiveStatusTag()` — `[TURN:n]` turn budget, `[MAP:x/y]` recon progress — on the objective row only.

---

## Current status

| Milestone | Status |
|---|---|
| M1 — Canvas combat chrome (`AsciiRenderer`) | 🔲 Not started |
| M1.1 — Objective chip (top-left, row 2) | 🔲 Not started |
| M1.2 — Operative identity (top-right, row 1) | 🔲 Not started |
| M1.3 — HP segment bar (top-right, row 2) | 🔲 Not started |
| M1.4 — AP pip row (top-right, row 3) | 🔲 Not started |
| M1.5 — Turn indicator + retire static overlay (bottom-left) | 🔲 Not started |
| M2 — Shell integration & status bar slim-down | 🔲 Not started |
| M2.1 — `CombatHud` draw options + `paint()` wiring | 🔲 Not started |
| M2.2 — Strip moved fields from `statusLine()` | 🔲 Not started |
| M2.3 — Accessibility: screen-reader summary preserved | 🔲 Not started |

**Phase 2.8** is complete when:

1. Every milestone above is ✅.
2. During combat, objective / identity / HP / AP / turn phase render on-canvas every frame; DOM status bar no longer duplicates those fields.
3. Corp turn shows `HOSTILES ACTIVE` bottom-left; `.game-canvas-static` grain overlay and `updateCorpWaitChrome` static path removed (or reduced to a no-op shim until dead code is deleted).
4. Hub → briefing → combat → debrief loop remains playable offline on iOS Safari + Chrome desktop.
5. `v0.2.8` tagged in git.

---

## Milestones — detail

### M1 — Canvas combat chrome

**Goal:** `AsciiRenderer.draw()` accepts a structured HUD payload and paints all combat chrome after the map frame (same paint order as `locationLabel` today — always on top).

#### M1.1 — Objective chip (top-left, row 2)

- New draw helper (or generalised `#drawHudRow`) positioned below the location chip box.
- Text: `OBJ {title} [{DONE|TODO}]` plus optional `[TURN:n]` / `[MAP:x/y]` suffixes.
- Data source mirrors `objectiveStatusTag()` in `index.ts` — extract shared pure formatter (e.g. `formatObjectiveHud(run)`) so canvas and any remaining DOM fallback stay in sync.
- **TDD:** formatter covers satisfied / unsatisfied, turn-limit, recon progress, empty contract guard.

#### M1.2 — Operative identity (top-right, row 1)

- Format: `{callsign} [{ARCHETYPE}]` — e.g. `Patch [TECH]`. Fall back to archetype alone when callsign missing (current shell behavior).
- Right-aligned; backing box anchored to canvas width.
- **TDD:** draw call records right-aligned x coordinate; stealth suffix when stealthed.

#### M1.3 — HP segment bar (top-right, row 2)

- Prefix `HP ` then `maxHp` segment chars: filled `■`, empty `□` (or palette-approved alternates if font coverage is thin on iOS).
- Counts derive from `player.hp` / `player.maxHp` — no numeric fraction in the HUD string.
- **TDD:** 3/3 → `HP ■■■`; 1/3 → `HP □□■` (or consistent empty-first ordering — pick one, document).

#### M1.4 — AP pip row (top-right, row 3)

- `maxAp` pips: remaining `○` (active green), spent `●` (spent coral) — order left-to-right as remaining-first or spent-first; **decided: remaining left, spent right** (`○○●●` = 2 of 4 left).
- Separate fill colors per pip state in the draw loop (not a single `fillStyle` for the whole string).
- **TDD:** 4/4, 0/4, mid values; color assignment per index.

#### M1.5 — Turn indicator + retire static overlay (bottom-left)

- Player faction (`FACTION.PLAYER`): `TURN {turnNumber}`.
- Corp faction (`FACTION.CORP`): `HOSTILES ACTIVE` (fixed string — no turn number during lockout).
- Remove reliance on `canvasStaticEl` / `setCorpStaticActive` / `.kp-corp-static` for corp-phase signaling. Delete overlay DOM node wiring if nothing else uses it.
- **TDD:** hud payload faction flips label; static overlay helper no longer toggled from `paint()`.

### M2 — Shell integration & status bar slim-down

**Goal:** `index.ts` builds one HUD snapshot per paint; DOM bar keeps narrative/context only.

#### M2.1 — `CombatHud` draw options + `paint()` wiring

- Add typed options to `AsciiRenderer.draw()` — e.g. `combatHud?: CombatHudSnapshot | null` (combat-only; `null` in Hub).
- `paint()` assembles snapshot from `run`, `run.queue`, `run.contract`, `run.player` — parallel to today's `statusLine()` combat branch.
- **TDD:** integration test via renderer stub — snapshot fields reach draw calls.

#### M2.2 — Strip moved fields from `statusLine()`

Remove from DOM output (combat branch):

- `identity`, `aphp`, `turnInfo` rows in `game-shell__stats`
- `objectiveTag` from `game-shell__context`
- `control-lock` tag (superseded by canvas turn indicator)

**Keep** in DOM:

- `alert-tag`, `hazard-tag`, activity rows, corp mood, proximity hints, AIM/LOOK mode tags
- Hub crew / creds / rep line unchanged

#### M2.3 — Accessibility: screen-reader summary preserved

- `#game-status` keeps `aria-live="polite"`. Option A: hidden compact text node updated each paint with the same facts (`Patch, TECH, 2 of 3 HP, 2 of 4 AP, turn 12, objective TODO`). Option B: `aria-label` on `#game-canvas` during combat. Pick one in implementation; **must not** regress screen-reader awareness of vitals/objective/phase.
- **Manual check:** VoiceOver / NVDA reads vitals and objective after slim-down.

---

## Where this lands in code (anticipated)

| Area | Change |
|------|--------|
| `src/render/AsciiRenderer.ts` | Generalise `#drawLocationLabel` → shared HUD row helper; add `#drawCombatHud`; extend `DrawOptions` |
| `src/render/combatHud.ts` (new) | Pure formatters: objective line, identity line, HP segments, AP pips, turn label; types for snapshot |
| `index.ts` | `buildCombatHudSnapshot(run)` in `paint()`; slim `statusLine()`; remove / simplify `updateCorpWaitChrome` |
| `src/render/animations.ts` | Deprecate or delete `setCorpStaticActive` if unused |
| `main.css` | Remove `.game-canvas-static` rules once overlay node is gone |
| `tests/unit/render/AsciiRenderer.test.ts` | HUD row placement, colors, combat-only guard |
| `tests/unit/render/combatHud.test.ts` (new) | Pure formatter coverage |

---

## Out of scope

- Principal aliases / mixed allegiance ([phase-2.9-plan.md](phase-2.9-plan.md)).
- Redesigning activity rows, corp mood copy, or alert/hazard presentation in the DOM bar.
- Cyberspace dual-grid HUD / PIP ([phase-3-plan.md](phase-3-plan.md)).
- Animated HUD transitions (segment drain animations, turn pulse) — static glyphs only unless playtest demands motion.
- Touch keypad layout changes.
- Salvage wallet display (stays in `<item-inventory>` overlay per M4.2 revision).

## Open questions / kaizen notes

- **Segment char font coverage:** verify `■□○●` render consistently in `ui-monospace` on iOS Safari; fall back to `[]` / `#` / `o` / `*` if needed.
- **HP segment order:** empty-first vs filled-first — pick one and match AP pip convention.
- **Corp turn label copy:** `HOSTILES ACTIVE` vs `CORP TURN` vs `[CORP]` — current lean is the user's sketch; revisit if playtesters miss that controls are locked.
- **Objective row width:** long Curator titles may need truncation + ellipsis at ~28–32 chars to avoid overlapping top-right HUD on narrow viewports.
- **Debrief / pause states:** confirm HUD hidden whenever `run.state !== RUN_STATE.COMBAT`.

---

## References

- Location chip: `AsciiRenderer.#drawLocationLabel`, `paint()` → `currentLocationLabel()` in `index.ts`
- Status assembly: `statusLine()`, `objectiveStatusTag()` in `index.ts`
- Corp static overlay (to retire): `updateCorpWaitChrome`, `setCorpStaticActive` in `index.ts` / `src/render/animations.ts`
- DOM status styling: `.game-shell__status` in `main.css`
