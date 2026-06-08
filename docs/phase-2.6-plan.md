# Phase 2.6 Plan — Resilience & error-handling foundations

Living plan for a small, focused slice between Phase 2.5 and the enemy-roles work: harden how Kernel Panic handles failure on a **tablet-first offline PWA with no visible JS console**, and land the entity-agnostic placement/persistence consolidation already built locally. **Target release: `v0.2.6`.** See [phase-2.5-plan.md](phase-2.5-plan.md) for the completed Meatspace-depth slice, [phase-2.7-plan.md](phase-2.7-plan.md) for the enemy roles + tier work this unblocks, and [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall vision.

**Phase prefix:** `P2.6` — use `P2.6.MN` when referencing milestones from this phase in other documents.

## Why this phase exists

Two threads converged:

1. We have **entity-agnostic infrastructure already built locally** — placement-anchor consolidation and a `World.addEntity` that recovers from collisions — that's mergeable on its own and shrinks the surface area of the enemy-roles work that follows.
2. Reviewing that work surfaced a tension in our standing principle, *"silent fallbacks are a mistake; crashing is preferred over data corruption."* On a tablet PWA with no console, a raw `throw` that white-screens the tab is **itself a silent failure** — the player loses their session and we get no signal. The principle is right; "crash" was the wrong implementation of it.

This phase resolves that tension into a concrete doctrine + the **error boundary** that makes "fail loud" survivable on a tablet, and ships the consolidation alongside it.

## Error-handling doctrine

The goal was never "throw an exception" — it was *don't let bad state propagate silently*. An unguarded crash on a tablet violates that spirit. So: **fail loud, but recover.** Three tiers:

### Tier 1 — Invariant violation / would-corrupt-the-save → fail loud, caught at a boundary
A snapshot that won't round-trip, a save-write that fails validation, an entity restored into an impossible state. These mean we shipped a logic bug, and *continuing* risks persisting garbage that compounds across sessions. Still throw — but to a **top-level error boundary** that:
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
| M1 — Placement & persistence consolidation | ✅ |
| M1.1 — Consolidated anchor nudging (`nearestEmptyFloorTile`/`nudgeIfOccupied`) | ✅ |
| M1.2 — `World.addEntity` nudges instead of throwing | ✅ |
| M2 — Top-level error boundary | ✅ |
| M2.1 — Audit for any existing app-level boundary | ✅ |
| M2.2 — Boundary: preserve save + signal + graceful degrade | ✅ |
| M2.3 — Reconcile existing throws against the three-tier policy | ✅ |

**Phase 2.6** is complete when:

1. Every milestone above is ✅.
2. The three-tier doctrine is codified in `AGENTS.md` and any tier-1 throw on a tablet degrades to "returning to Hub, progress safe" rather than a white screen.
3. Full campaign loop from Phase 2.5 remains playable offline on iOS Safari + Chrome desktop.
4. `v0.2.6` tagged in git.

## Milestones — detail

### M1 — Placement & persistence consolidation (built locally, unmerged)

**Goal:** Land the entity-agnostic infrastructure already written, independent of any new enemy. Tests already exist (`placement.test.ts`, `World.test.ts`).

#### M1.1 — Consolidated anchor nudging

- `nearestEmptyFloorTile(world, x, y)` and `nudgeIfOccupied(entity, world)` now live in `placement.ts` as the single authoritative anchor-collision resolver (cardinal BFS through occupied tiles to the nearest empty passable floor).
- Replaces two prior copies: `Run`'s `resolveEntitySpawnTile` and `persistence`'s `NUDGE_OFFSETS` block.
- **This is the canonical tier-2 fallback:** it relocates and `console.warn`s rather than throwing. The prior `Run.resolveEntitySpawnTile` *threw* when no empty floor existed; the consolidated `nudgeIfOccupied` returns `false` and lets the caller decide. On merge, confirm every call site handles `false` deliberately — and per tier 3, if a caller can't recover into a persistable state, it must escalate to the boundary (M2), not silently skip.

#### M1.2 — `World.addEntity` nudges instead of throwing

- On an occupied-tile collision, `addEntity` calls `nudgeIfOccupied` and only throws (`Tile already occupied`) when no empty floor is reachable. Passable props (keycards, consumables) still share tiles; impassable entities don't.
- The remaining throw is a **tier-1** case (no valid placement exists) and must route through the boundary once M2 lands.

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

**Audit result (2026-05):** no miscategorizations required a code change. Summary:

| Bucket | Examples | Tier |
|---|---|---|
| **Tier-2 fallback (canonical)** | `placement.nudgeIfOccupied` — relocates + `console.warn` | 2 |
| **Tier-2 callers** | `World.addEntity` nudges first; only throws when nudge returns `false` | 1 at boundary |
| **Restore / snapshot validation** | `persistence.ts` validate/restore throws on corrupt or impossible saves | 1 |
| **Constructor / API misuse** | `TypeError`/`RangeError` on bad args to modules, entities, drivers | 1 (dev-time; boundary still catches if reached in prod) |
| **State-machine invariants** | `Run.enterCombat`, `Campaign.enterHub`, illegal transitions | 1 |
| **Procgen / content parse** | prefab parse, Curator recipe/lexicon resolution | 1 |
| **Combat resolve guards** | `Combat.resolveRanged/Melee` after `can*` checks in `applyIntent` | 1 (defensive; UI pre-checks first) |
| **Logic-bug sentinels** | `CorpDrone` iteration cap | 1 |

**In-app boundary verify (dev):** load `http://localhost:8099/?triggerFault=corp`, enter combat, end your turn — fault screen should appear, Return to Hub should land in Hub with the last turn-end save intact. `?triggerFault=rejection` exercises the `unhandledrejection` path once at boot.

**Resilience hardening (2026-05):** restore no longer drops entities on placement failure (tier-1 throw); fault path invalidates combat pumps + resets animLock; fault return skips persist when hub restore failed; key-help blocks touch input.

## Out of scope

- Enemy roles, tiers, and the new hostile rebuilds (Phase 2.7).
- Telemetry *backend* — M2.2 only needs a hook/seam; where signals are sent is a later concern.

## Open questions / kaizen notes

- **Telemetry sink:** the boundary emits a signal, but to where? A no-op hook now, wired to a real sink later — record the seam so it's not forgotten.
- **Degrade granularity:** does every tier-1 dump the whole run, or can some (e.g. a single bad entity restore) recover the rest of the run? **Decided for 2.6: coarse — whole run → Hub.** The run is the blast radius; the campaign (crew, salvage, history, site state) survives. Refine to granular only if coarse proves too blunt in play.
- **Save-write atomicity:** **Resolved.** `DataStore.#saveData()` is a single synchronous `localStorage.setItem('kp:data', …)`. localStorage gives per-`setItem` atomicity, so a mid-write crash can't leave a partial record — the write lands whole or not at all. The real corruption risk is therefore *not* a torn write but snapshotting already-corrupt in-memory state over the good save; the boundary's prime directive is **don't call the autosave seam on a tier-1 fault** (the last turn-end snapshot on disk is already the known-good copy).
- **Single-key vs. split storage (kaizen):** considered splitting `kp:data` into `activeRun` / `crew` / `siteRoster` / `campaign` keys. **Keeping the single key for 2.6.** Split storage's only real win is granular per-run recovery, which (a) we explicitly opted out of above, and (b) `snapshotCampaign` already nests `activeRun` as its own sub-object, so even coarse recovery can null just that field within one atomic write. Splitting would *cost* the atomicity guarantee (4 keys = 4 non-atomic `setItem`s, so a crash mid-save can tear cross-references like `activeRun.crewMemberId` → crew) and require a write-coordinator + a migration for every existing player's blob. Revisit only if we later need granular per-run recovery or independent crew/roster persistence — and only behind a transactional multi-key DataStore.

## Notes from the M2 build (audit + design decisions)

- **Doctrine already codified.** The three-tier policy is already written in `AGENTS.md` → "Error handling — fail loud, but recover." M2 is therefore *just the boundary*, not "doctrine + boundary."
- **M2.1 audit result:** confirmed **no** global handlers exist anywhere (`window.onerror`, `unhandledrejection`, `addEventListener('error')`) and no app-level boundary component. The real entry/bootstrap is root `index.ts` (no `entries/` dir); `DataStore` is `src/DataStore.ts`.
- **Fault screen is non-diegetic, separate from `CrashDump`.** `components/CrashDump.ts` is the *in-fiction* death/exit/campaign-over modal (faux "KERNEL PANIC" stack trace). Routing a real bug through it would disguise the bug as an in-universe death — itself a silent failure. The boundary gets its own deliberately out-of-fiction `<fault-screen>`: "Something glitched — returning to the Hub, your progress is safe," single `[ RETURN TO HUB ]`.
- **Architecture (honors no-logic-in-components):** browser-free `src/errorBoundary.ts` (installs handlers on an injected `EventTarget`, normalizes the thrown value, fires `onSignal` = console.error + no-op telemetry seam, invokes a coarse `degrade()` callback, re-entrancy guarded, returns an uninstall fn) + thin `components/FaultScreen.ts` + `index.ts` wiring. Node 22 lacks `ErrorEvent`/`PromiseRejectionEvent`, so the module duck-types the payload (`.error ?? .reason ?? event`) and stays testable under `node --test` with a plain `EventTarget`.
- **Corp-slice cold resume:** autosave fires at the player→corp `turn:ended` before the animated aftermath/corp driver runs. On reload with `currentFaction: corp`, the shell calls `resumePendingCombatSliceIfNeeded()` (`advanceFromPlayerTurn` with `resumeFromCorpSlice: true`) so the save doesn't load into a stuck "CORP TURN — controls locked" state with no driver running.
