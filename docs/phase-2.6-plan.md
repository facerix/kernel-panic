# Phase 2.6 Plan — Resilience & error-handling foundations

Living plan for a small, focused slice between Phase 2.5 and the enemy-roles work: harden how Kernel Panic handles failure on a **tablet-first offline PWA with no visible JS console**, and land the entity-agnostic placement/persistence consolidation already built locally. **Target release: `v0.2.6`.** See [phase-2.5-plan.md](phase-2.5-plan.md) for the completed Meatspace-depth slice, [phase-2.7-plan.md](phase-2.7-plan.md) for the enemy roles + tier work this unblocks, and [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall vision.

## Why this phase exists

Two threads converged:

1. We have **entity-agnostic infrastructure already built locally** — placement-anchor consolidation, a `World.addEntity` that recovers from collisions, and an `Entity.heal()` primitive — that's mergeable on its own and shrinks the surface area of the enemy-roles work that follows.
2. Reviewing that work surfaced a tension in our standing principle, *"silent fallbacks are a mistake; crashing is preferred over data corruption."* On a tablet PWA with no console, a raw `throw` that white-screens the tab is **itself a silent failure** — the player loses their session and we get no signal. The principle is right; "crash" was the wrong implementation of it.

This phase resolves that tension into a concrete doctrine + the **error boundary** that makes "fail loud" survivable on a tablet, and ships the consolidation alongside it.

## Error-handling doctrine

The goal was never "throw an exception" — it was *don't let bad state propagate silently*. An unguarded crash on a tablet violates that spirit. So: **fail loud, but recover.** Three tiers:

### Tier 1 — Invariant violation / would-corrupt-the-save → fail loud, caught at a boundary
A negative `heal` amount, a snapshot that won't round-trip, a save-write that fails validation. These mean we shipped a logic bug, and *continuing* risks persisting garbage that compounds across sessions. Still throw — but to a **top-level error boundary** that:
- preserves the last known-good save,
- emits a dev-channel signal (console + telemetry),
- degrades the player to "something glitched — returning to the Hub, your progress is safe" rather than a dead tab.

Crash the **run**, not the **app**.

### Tier 2 — Expected recoverable runtime situation → deterministic fallback + loud dev warning
An anchor collision during procgen, a transient pathing miss. These are *known to happen*; recovering and `console.warn`-ing is the **correct** behavior, not a compromise. Play continues. `nudgeIfOccupied` (M1.1) is the canonical example: it relocates the entity and warns.

### Tier 3 — Forbidden: a tier-2 fallback that feeds corrupt state into persistence
This is where the two failure modes meet and where silence actually bites. A "graceful" fallback that produces an un-persistable entity, then gets snapshotted, is data corruption wearing a fallback's clothing. **Rule:** if a fallback can't produce a valid, persistable state, it is a tier-1 case and must escalate to the boundary.

### Cross-cutting requirements
- **The boundary is the bridge.** "Fail loud" and "don't show a tablet player a dead tab" are only compatible *because* the boundary converts every tier-1 throw into a graceful degrade with the save intact. The boundary is therefore a prerequisite for the policy, not an optional nicety.
- **Determinism.** Tier-2 fallbacks must stay seed-deterministic so saves remain reproducible (the standard set in Phase 2.5).

This doctrine is codified in `AGENTS.md` → "Error handling — fail loud, but recover"; this doc holds the rationale and the boundary's spec.

## Current status

| Milestone | Status |
|---|---|
| M1 — Placement & persistence consolidation | 🟡 Built locally (unmerged) |
| M1.1 — Consolidated anchor nudging (`nearestEmptyFloorTile`/`nudgeIfOccupied`) | 🟡 Built locally (unmerged) |
| M1.2 — `World.addEntity` nudges instead of throwing | 🟡 Built locally (unmerged) |
| M1.3 — `Entity.heal()` primitive | 🟡 Built locally (unmerged) |
| M2 — Top-level error boundary | 🔲 Not started |
| M2.1 — Audit for any existing app-level boundary | 🔲 Not started |
| M2.2 — Boundary: preserve save + signal + graceful degrade | 🔲 Not started |
| M2.3 — Reconcile existing throws against the three-tier policy | 🔲 Not started |

**Phase 2.6** is complete when:

1. Every milestone above is ✅.
2. The three-tier doctrine is codified in `AGENTS.md` and any tier-1 throw on a tablet degrades to "returning to Hub, progress safe" rather than a white screen.
3. Full campaign loop from Phase 2.5 remains playable offline on iOS Safari + Chrome desktop.
4. `v0.2.6` tagged in git.

## Milestones — detail

### M1 — Placement & persistence consolidation (built locally, unmerged)

**Goal:** Land the entity-agnostic infrastructure already written, independent of any new enemy. Tests already exist (`placement.test.ts`, `World.test.ts`, `Entity.test.ts`).

#### M1.1 — Consolidated anchor nudging

- `nearestEmptyFloorTile(world, x, y)` and `nudgeIfOccupied(entity, world)` now live in `placement.ts` as the single authoritative anchor-collision resolver (cardinal BFS through occupied tiles to the nearest empty passable floor).
- Replaces two prior copies: `Run`'s `resolveEntitySpawnTile` and `persistence`'s `NUDGE_OFFSETS` block.
- **This is the canonical tier-2 fallback:** it relocates and `console.warn`s rather than throwing. The prior `Run.resolveEntitySpawnTile` *threw* when no empty floor existed; the consolidated `nudgeIfOccupied` returns `false` and lets the caller decide. On merge, confirm every call site handles `false` deliberately — and per tier 3, if a caller can't recover into a persistable state, it must escalate to the boundary (M2), not silently skip.

#### M1.2 — `World.addEntity` nudges instead of throwing

- On an occupied-tile collision, `addEntity` calls `nudgeIfOccupied` and only throws (`Tile already occupied`) when no empty floor is reachable. Passable props (keycards, consumables) still share tiles; impassable entities don't.
- The remaining throw is a **tier-1** case (no valid placement exists) and must route through the boundary once M2 lands.

#### M1.3 — `Entity.heal()` primitive

- Mirror of `Entity.damage`: clamps to `maxHp`, **crashes** on negative/non-integer input (a negative heal is disguised damage — a **tier-1** invariant violation), and **refuses to revive a corpse** (resurrection is a deliberate action, never a repair-tick side effect). Returns HP actually restored.
- The primitive the medic and any future shield/heal work (Phase 2.7) builds on; clean enough to merge ahead of that work.

### M2 — Top-level error boundary

**Goal:** Build the boundary that makes tier-1 "fail loud" survivable on a tablet. Without it, the doctrine can't be honored — an uncaught throw is a white screen.

#### M2.1 — Audit for any existing app-level boundary

- Confirmed at planning time: **no** global handlers exist (`window.onerror`, `unhandledrejection`, component-level boundary). This milestone re-verifies before building, so we don't duplicate.

#### M2.2 — Boundary: preserve save + signal + graceful degrade

- Install a top-level handler (window `error` + `unhandledrejection`, plus the appropriate seam around the run/turn loop) that, on a tier-1 failure:
  1. ensures the last known-good save is intact (never write the corrupt state),
  2. emits a dev-channel signal — `console.error` + a telemetry hook,
  3. degrades the UI to a "something glitched — returning to the Hub, your progress is safe" state rather than a dead tab.
- Web Component + Shadow DOM per project conventions; no framework.
- **TDD:** a thrown tier-1 error during a run triggers the degrade path; the persisted save equals the last known-good snapshot (not the corrupt one); the app remains interactive (returns to Hub).

#### M2.3 — Reconcile existing throws against the three-tier policy

- Sweep current `throw` sites and classify each tier-1 (route to boundary) vs. tier-2 (should be a deterministic fallback + warn). Fix miscategorized ones.
- **TDD:** representative tier-2 sites recover + warn rather than throw; representative tier-1 sites still throw and are caught by the boundary.

## Out of scope

- Enemy roles, tiers, and the new hostile rebuilds (Phase 2.7).
- Telemetry *backend* — M2.2 only needs a hook/seam; where signals are sent is a later concern.

## Open questions / kaizen notes

- **Telemetry sink:** the boundary emits a signal, but to where? A no-op hook now, wired to a real sink later — record the seam so it's not forgotten.
- **Degrade granularity:** does every tier-1 dump the whole run, or can some (e.g. a single bad entity restore) recover the rest of the run? Start coarse (whole run → Hub), refine if it proves too blunt.
- **Save-write atomicity:** M2.2 assumes we can guarantee the last known-good save is untouched on crash — confirm `DataStore` writes are atomic enough that a mid-write crash can't leave a partial record.
