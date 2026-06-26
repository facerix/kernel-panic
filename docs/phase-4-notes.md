# Phase 4 notes — multi-floor maps (June 6, 2026)

Exploratory notes from a feasibility assessment. Not a living plan — see [phase-3-plan.md](phase-3-plan.md) for official Phase 3 scope and deferrals.

## Context

[phase-3-plan.md](phase-3-plan.md) defers **multi-level / sublevel maps** to Phase 4:

> Vertical map depth (multiple floors, stairs, elevators) is deferred. Labels like "Sublevel 3 cache" remain flavor. Multi-level is a natural extension once persistent locations and Cyberspace are stable — potentially Phase 4.

**Status of that deferral condition (June 2026):**

- **Persistent locations** — shipped (Phase 2.5 M7: `LocationSite`, `mutationDeltas`, `seenKeys`, revisit merge).
- **Cyberspace** — not yet stable (Phase 3 in flight).
- **Simulation / mapgen / UI** — still single 2D grid throughout.

---

## Short answer

Multi-floor maps are **feasible but cross-cutting** — roughly half a phase, not a weekend.

| Scope | Rough effort | What you get |
|-------|--------------|--------------|
| **Thin MVP** | ~2–3 focused weeks | 2 floors, hand-linked prefabs, stair/elevator interactable, per-floor fog, save/load |
| **Shippable vertical maps** | ~5–8 weeks | Procgen multi-floor, connectivity validation, recon/dual-site across floors, site memory per floor, content |
| **Full vision + Phase 3 interplay** | Phase 4-sized | Above + Cyberspace/Meatspace sync rules, mixed-floor AI policy, tower contracts, balance pass |

---

## What exists today

Combat is **one flat `Grid` per run**, wired through every layer:

```
buildMap() → single Grid
  → World { grid, entities }
    → Pathfinding / LOS / Vision / Combat
    → RunSnapshot + LocationSite
    → frame.ts → AsciiRenderer
```

Key facts:

- [`Grid`](../src/game/Grid.ts): `width × height` flat `Uint8Array`; no layer index.
- [`GridPoint`](../src/types.ts): `{ x, y }` only; coord keys are `"x,y"` everywhere ([`mapConnectivity.ts`](../src/game/mapConnectivity.ts), [`Vision.ts`](../src/game/Vision.ts), [`locations.ts`](../src/game/locations.ts)).
- [`World`](../src/game/World.ts): one `grid`, `entityAt(x,y)`, `blockerKeys()` as `"x,y"` set.
- [`Run.enterCombat`](../src/game/Run.ts): `buildMap()` once → spawn everything on that grid.
- **"Sublevel 3"** is flavor only ([`LocationSite.site`](../src/types.ts)); `DUAL_SITE` = two pads on the **same** floor.
- **Doors** are the only connectivity gate today; no stair/elevator tile or prefab anchor type.
- **Renderer**: one tactical canvas; camera centers on player `(x,y)` ([`frame.ts`](../src/render/frame.ts)).

There is **no latent z-axis** to flip on — this is a foundational coordinate-system change.

---

## What got easier since the deferral

Real seams that reduce incremental cost (not multi-floor themselves):

| Seam | Why it helps |
|------|--------------|
| **Site memory** (`LocationSite`: `mutationDeltas`, `seenKeys`) | Per-floor deltas/seen keys are a schema extension, not greenfield |
| **Doors + terminals** | Pattern for gated transitions; stairs/elevators fit `Interactable` |
| **`Entity.passable`** ([`Entity.ts`](../src/game/Entity.ts)) | Comment already reserves floor signs / location markers |
| **`mapConnectivity`** | Reusable per-floor; extend for "spawn → stairs → exit on floor 2" |
| **Dual-site / recon objectives** | Multi-anchor logic exists; needs floor-aware keys |
| **Hub vs combat grids** ([`SafeSpace.ts`](../src/game/hub/SafeSpace.ts)) | Precedent for "swap active grid" at scene boundaries |

---

## Architectural fork (decide first)

### Option A — Multiple grids + active floor index (recommended)

```typescript
type FloorId = number;
World {
  floors: Map<FloorId, Grid>;
  activeFloor: FloorId;
  entities: Map<string, Entity & { floor: FloorId }>;
}
```

- **Pros:** Each floor keeps current map sizes (24×16); fog/pathfinding/LOS stay floor-local; matches "Sublevel 3" fiction.
- **Cons:** Floor transitions are explicit; cross-floor queries need `floor` on every entity/coord key.

### Option B — One mega-grid with floor as metadata

- **Pros:** Minimal change to `Grid` API.
- **Cons:** Breaks current size caps, camera, and "tower" feel; coord collisions; worse for persistence and revisit.

**Recommendation:** Option A — matches how Hub already treats combat as a separate grid.

---

## Systems touched (breadth)

Roughly **~35–45 production modules** and **~45 test files** assume single-floor `(x,y)`:

| Layer | Files / areas | Work |
|-------|---------------|------|
| **Core model** | `Grid`, `World`, `types.ts`, `Entity`, `coordKey` helpers | Add `floor`; scope occupancy, blockers, movement |
| **Simulation** | `Pathfinding`, `LineOfSight`, `Vision`, `Combat`, `slide`, `knockback`, `Smoke`, `mapConnectivity` | All queries scoped to `activeFloor` (or entity's floor) |
| **AI** | All `src/game/ai/*`, `PatrolHostile`, `corpTurnDriver` | Design decision: simulate off-floor hostiles or freeze them? |
| **Run lifecycle** | `Run.enterCombat`, `placement.ts`, objective placement, exit detection in `index.ts` | Multi-floor spawn, floor-aware exit, transition hooks |
| **Mapgen** | [`mapBuild.ts`](../src/game/procgen/mapBuild.ts), prefabs, BSP | Largest greenfield chunk: per-floor layout + vertical links |
| **Persistence** | `RunSnapshot`, `persistence.ts`, `Campaign`, `locations.ts` | `{ floor, x, y }` keys; migration for old saves |
| **Input / shell** | `applyIntent.ts`, describe/look cursor, combat HUD | New intent: use stairs/elevator; floor indicator in HUD |
| **Render** | `frame.ts`, `AsciiRenderer`, `cameraFor` | Show one floor at a time; optional floor label ("Sublevel 2") |

[`coordKey`](../src/game/mapConnectivity.ts) appears in ~8 modules directly; ad-hoc `` `${x},${y}` `` strings appear in ~20+ more (AI blockers, frame entity index, vision seen sets).

---

## Suggested milestone breakdown

### M0 — Design locks (~2–3 days)

Decisions that change implementation size:

1. **Off-floor hostiles:** frozen vs full sim vs "dormant until player enters floor"
2. **Transition cost:** 1 AP interact? free? elevator requires keycard?
3. **Cross-floor LOS/noise/alarm:** none (simplest) vs muffled vs full
4. **Recon scope:** per-floor fog reset vs unified site memory
5. **Max floors per contract:** 2 for MVP vs N

### M1 — Foundation (~1 week)

- `FloorId` + `LocatedPoint { floor, x, y }`
- `coordKey(floor, x, y)` — single helper, replace ad-hoc strings
- `World` multi-grid + `activeFloor` + floor-scoped `entityAt` / `canMoveEntity`
- Snapshot schema v2 with save migration (default `floor: 0`)

### M2 — Floor transitions (~3–5 days)

- `Stairs` / `Elevator` interactable: `{ targetFloor, targetX, targetY }`
- Player transition in `applyIntent` / `World.relocateEntity`
- Reset or fork fog episode on floor change (`VisionField.resetFogState` pattern already exists)

### M3 — Render + HUD (~3–5 days)

- Frame builder reads `world.activeFloor` grid only
- HUD floor label; combat log copy ("descends to Sublevel 3")
- Input: interact on stair glyph when adjacent

### M4 — Mapgen (thin vs full)

**Thin (~1 week):** hand-authored 2-floor prefab pairs linked by fixed stair anchors; `buildMap` returns `{ floors: Grid[], links: FloorLink[] }`.

**Full (~2–3 weeks):** BSP per floor, stair/elevator placement, `mapIsFullyConnectedFromSpawn` extended to multi-floor graph, prefab schema for vertical-link glyphs.

### M5 — Objectives + site memory (~1 week)

- Recon: `mapSeen` keys include floor
- Retrieve/cache on floor 2; exit on floor 1
- `LocationSite.seenKeys` / `mutationDeltas` floor-aware merge on extract/revisit

### M6 — AI policy + tests (~1–2 weeks)

- Pick off-floor behavior; update patrol paths per floor
- Regression: pathfinding, LOS, recon, doors, breach restore, persistence round-trip
- Procgen connectivity sweep per floor count

---

## Lower-cost alternatives (no multi-floor)

Ways to honor "Sublevel 3" **flavor** without vertical simulation:

- **Hidden pocket / false wall room** on one map (already supported by prefabs + doors)
- **Separate contracts** for "Sublevel 2" vs "Sublevel 3" as `LocationSite` revisits with different seeds
- **Taller 2D maps** (28×16, 30×18) for sniper verticality — already in [phase-2.7-plan.md](phase-2.7-plan.md)

These do **not** deliver floor-switching tactics but cover some narrative gap at ~0 incremental architecture cost.

---

## Sequencing

**Why wait for Phase 3 (or do MVP in parallel):**

- Phase 3 adds **dual-control attention** — multi-floor Meatspace increases cognitive load while Cyberspace is also demanding.
- No blueprint spec for cross-layer floor sync.
- Phase 2.9 deferred **mixed encounters** for similar complexity reasons.

**Why you could start now:**

- Location persistence is ready — the original deferral condition is partially met.
- "Sublevel 3 cache" and recon objectives would finally match their names.
- M1–M3 are mostly orthogonal to Cyberspace if kept Meatspace-only.

Suggested order: **Phase 3 Cyberspace → multi-floor MVP → full vertical maps**.

If the goal is *"Sublevel 3 reads true in combat"* soon, start with **M0 design locks + M1 foundation + hand-authored 2-floor prefab** before investing in full procgen vertical connectivity.

---

## Risks

| Risk | Severity |
|------|----------|
| Save migration / corrupt snapshots | High — tier-1 boundary territory per [AGENTS.md](../AGENTS.md) |
| Recon soft-lock across floors | Medium — `mapConnectivity` must validate full graph |
| Off-floor AI edge cases | Medium — alarm propagation, turret LOS across floors |
| Test churn | Medium — ~45 test files construct flat grids |
| Scope creep into Phase 3 | High — if Cyberspace needs "jack into floor-2 terminal" semantics |

---

## Bottom line

Multi-floor is **not blocked by missing persistence anymore**, but it **is still a foundational coordinate-system change** touching mapgen, simulation, persistence, render, and input. A disciplined **2-floor MVP** is ~**2–3 weeks**; making it feel like a first-class Kernel Panic system (procgen, objectives, revisit memory, AI policy) is ~**5–8 weeks** — comparable to a slice the size of Phase 2.5 M6–M7.
